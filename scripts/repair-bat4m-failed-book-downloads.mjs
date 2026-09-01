import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BAT4M";
const courseId = 72;
const baseUrl = "http://34.30.231.58";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

loadEnv();

function loadEnv() {
  const envPath = join(projectRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
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

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  store(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      for (const text of String(value).split(/,(?=\s*[^;,]+=)/g)) {
        const pair = text.split(";")[0];
        const index = pair.indexOf("=");
        if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
  }
  header() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar();

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function sha10(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function fileNameFromUrl(url) {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.split("/").pop() || "resource").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
}

function typeFromPath(path) {
  const ext = extname(String(path || "")).replace(".", "").toLowerCase();
  return ext === "jpeg" ? "jpg" : ext || "file";
}

function hasValidSignature(bytes, fileName, contentType = "") {
  const ext = extname(fileName).toLowerCase();
  const head = bytes.subarray(0, 16);
  const ascii = head.toString("latin1");
  const textHead = bytes.subarray(0, 128).toString("utf8").trimStart();
  if (/text\/html/i.test(contentType) || /^<!doctype html|^<html\b/i.test(textHead)) return false;
  if ([".docx", ".xlsx", ".pptx", ".zip", ".h5p"].includes(ext)) return ascii.startsWith("PK") || ascii.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1");
  if ([".doc", ".xls", ".ppt"].includes(ext)) return ascii.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1");
  if (ext === ".pdf") return ascii.startsWith("%PDF");
  return bytes.length > 0;
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-bat4m-repair/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function requestWithRetry(url, options = {}, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request(url, options);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 900));
    }
  }
  throw lastError;
}

async function login() {
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await requestWithRetry(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing STMARY_MOODLE_USERNAME/STMARY_MOODLE_PASSWORD in .env");
  const response = await requestWithRetry(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St. Mary Moodle login failed.");
}

async function fetchFile(url, targetRel) {
  const targetAbs = join(courseRoot, targetRel);
  mkdirSync(dirname(targetAbs), { recursive: true });
  const fileName = fileNameFromUrl(url);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await request(url, { headers: { referer: `${baseUrl}/course/view.php?id=${courseId}` } });
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !hasValidSignature(bytes, fileName, contentType)) throw new Error(`invalid-download status=${response.status} type=${contentType} bytes=${bytes.length}`);
      writeFileSync(targetAbs, bytes);
      return bytes.length;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 600));
    }
  }
}

function resourceFromFailure(failure) {
  const label = fileNameFromUrl(failure.url);
  const type = typeFromPath(label);
  const resource = {
    label,
    type,
    category: "moodle_file",
    role: "attachment",
    path: failure.targetRel,
    bytes: statSync(join(courseRoot, failure.targetRel)).size,
    source: failure.url,
  };
  if (["pdf", "png", "jpg", "gif", "webp", "svg", "tif", "tiff"].includes(type)) resource.previewPath = failure.targetRel;
  if (!["mp4", "m4v", "mov"].includes(type)) resource.downloadPath = failure.targetRel;
  return resource;
}

function addUnique(list, resource) {
  if (!Array.isArray(list)) return [resource];
  if (list.some((item) => item.path === resource.path || item.source === resource.source)) return list;
  return [...list, resource];
}

function patchManifest(manifest, successFailures, remainingFailures) {
  for (const failure of successFailures) {
    const resource = resourceFromFailure(failure);
    const normalizedTarget = toPosix(failure.targetRel);
    const lessonRoot = normalizedTarget.split("/book_sections/files/")[0];
    const sectionName = normalizedTarget.match(/\/book_sections\/files\/([^/]+)\//i)?.[1] || "";
    const sectionHtml = sectionName ? `${lessonRoot}/book_sections/${sectionName}.html` : "";
    const lesson = (manifest.units || []).flatMap((unit) => unit.lessons || []).find((item) => toPosix(item.path) === lessonRoot);
    if (!lesson) continue;
    lesson.downloads = addUnique(lesson.downloads || [], resource);
    const bookSection = (lesson.bookSections || []).find((item) => toPosix(item.path) === sectionHtml);
    if (bookSection) bookSection.attachments = addUnique(bookSection.attachments || [], resource);
    if (/05-homework/i.test(sectionName)) {
      const unit = (manifest.units || []).find((item) => item.unit === lesson.unit);
      const dropbox = (unit?.unitResources?.lessonDropboxes || []).find((item) => new RegExp(`\\bUnit\\s+${lesson.unit}\\s+-\\s+Lesson\\s+${lesson.lesson}\\b`, "i").test(item.label || ""));
      if (dropbox) dropbox.attachments = addUnique(dropbox.attachments || [], resource);
    }
    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = (lesson.downloads || []).length;
  }
  for (const unit of manifest.units || []) {
    unit.summary ||= {};
    unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
    unit.summary.h5p = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length, 0);
  }
  manifest.sourceAudit ||= {};
  manifest.sourceAudit.downloadFailures = remainingFailures;
  manifest.sourceAudit.failedBookDownloadsRepairedAt = new Date().toISOString();
  manifest.sourceAudit.failedBookDownloadsRepaired = successFailures.length;
  manifest.generatedAt = new Date().toISOString();
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const failures = manifest.sourceAudit?.downloadFailures || [];
const repaired = [];
const remaining = [];

await login();

for (const failure of failures) {
  try {
    await fetchFile(failure.url, failure.targetRel);
    repaired.push(failure);
  } catch (error) {
    remaining.push({ ...failure, reason: String(error?.message || error) });
  }
}

patchManifest(manifest, repaired, remaining);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ course, repaired: repaired.length, remaining: remaining.length, remaining }, null, 2));
