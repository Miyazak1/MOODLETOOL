import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "OLC4O";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const folderUrl = "https://www.esunnybrook.com/mod/folder/view.php?id=495";

loadEnvFile(join(projectRoot, ".env"));

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 92) || "resource";
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function filenameFromUrl(url) {
  return decodeURIComponent(basename(new URL(url).pathname));
}

function extensionFor(filename, contentType) {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  return "bin";
}

function validateSignature(type, buffer) {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (["docx", "xlsx", "pptx"].includes(type) && !startsWithPk) throw new Error(`downloaded ${type} is not an OOXML package`);
  if (type === "pdf" && !startsWithPdf) throw new Error("downloaded file is not a PDF");
  if (type === "doc" && !startsWithOle) throw new Error("downloaded file is not a legacy DOC");
}

class CookieJar {
  constructor(initialCookie) {
    this.cookies = new Map();
    for (const part of String(initialCookie || "").split(";")) {
      const index = part.indexOf("=");
      if (index > 0) this.cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
  }

  store(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      for (const cookieText of String(value).split(/,(?=\s*[^;,]+=)/g)) {
        const [pair] = cookieText.split(";");
        const index = pair.indexOf("=");
        if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar(process.env.MOODLE_COOKIE || "");

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-olc4o-folder-downloader/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login failed.");
}

function findFolderItem(manifest) {
  return (manifest.courseDownloads || []).find((item) => item.moodleActivityId === "495" || /OLC4O Lesson Plans/i.test(item.label || ""));
}

await loginIfNeeded();
const page = await request(folderUrl);
const html = await page.text();
if (!page.ok) throw new Error(`Folder page HTTP ${page.status}`);
if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login page returned.");

const links = [];
const seen = new Set();
for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
  const url = new URL(match[1].replaceAll("&amp;", "&"), folderUrl).toString();
  const label = stripTags(match[2]) || filenameFromUrl(url);
  const key = `${label}|${url}`;
  if (seen.has(key)) continue;
  seen.add(key);
  links.push({ label, url });
}

const outDir = join(courseRoot, "localized-moodle-activities", "folder", "course-495-045d59faf3", "files");
mkdirSync(outDir, { recursive: true });
const files = [];
for (const link of links) {
  const response = await request(link.url);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${link.label}: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const filename = filenameFromUrl(link.url) || `${sanitizeSegment(link.label)}.bin`;
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer);
  const rel = `localized-moodle-activities/folder/course-495-045d59faf3/files/${hashText(link.url)}-${sanitizeSegment(filename)}`;
  const abs = join(courseRoot, rel);
  writeFileSync(abs, buffer);
  files.push({
    label: link.label || filename,
    type,
    category: "moodle_folder_file",
    role: "lesson_plan",
    path: rel,
    bytes: statSync(abs).size,
    source: "authenticated SunnyBrook Moodle folder file",
  });
}

const manifest = readJson(manifestPath);
const folderItem = findFolderItem(manifest);
if (!folderItem) throw new Error("OLC4O Lesson Plans folder item not found in manifest.");
folderItem.attachments = files;
folderItem.folderFileCount = files.length;
folderItem.source = "authenticated SunnyBrook Moodle folder activity id 495";
writeJson(manifestPath, manifest);

console.log(`OLC4O lesson plan folder localized: ${files.length} file(s).`);
