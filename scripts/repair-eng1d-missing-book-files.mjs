import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG1D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "").replace(/\/login\/index\.php$/i, "");
const jar = new Map();

loadEnv(join(projectRoot, ".env"));

const targets = [
  {
    unit: 4,
    lesson: 5,
    pageRel: "Unit 4/Lesson 5 - Trojan War/book_sections/05-homework.html",
    url: "http://34.30.231.58/pluginfile.php/12742/mod_book/chapter/13742/Step%20by%20step%20guide.pdf",
    targetRel: "Unit 4/Lesson 5 - Trojan War/book_sections/files/05-homework/4b34270417-Step by step guide.pdf",
    label: "Step by step guide.pdf",
    patchText: "Step-By-Step Guide",
  },
  {
    unit: 4,
    lesson: 6,
    pageRel: "Unit 4/Lesson 6 - Norse Mythology/book_sections/05-homework.html",
    url: "http://34.30.231.58/pluginfile.php/12742/mod_book/chapter/13747/ENG1D%20-%20U4L6%20v2.docx",
    targetRel: "Unit 4/Lesson 6 - Norse Mythology/book_sections/files/05-homework/c200ff4e82-ENG1D - U4L6 v2.docx",
    label: "ENG1D - U4L6 v2.docx",
    patchText: "HERE",
  },
];

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function storeCookies(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    for (const cookieText of String(value).split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = cookieText.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-eng1d-missing-file-repair/1.0");
  const cookie = cookieHeader();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function login() {
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing STMARY_MOODLE_USERNAME/STMARY_MOODLE_PASSWORD in .env");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("Moodle login failed");
}

function typeFromPath(path) {
  const ext = extname(path).replace(".", "").toLowerCase();
  return ext === "jpeg" ? "jpg" : ext || "html";
}

function valid(bytes, fileName, contentType) {
  const ext = extname(fileName).toLowerCase();
  const head = bytes.subarray(0, 16);
  const ascii = head.toString("latin1");
  const textHead = bytes.subarray(0, 128).toString("utf8").trimStart();
  if (/text\/html/i.test(contentType) || /^<!doctype html|^<html\b/i.test(textHead)) return false;
  if (ext === ".pdf") return ascii.startsWith("%PDF");
  if ([".docx", ".xlsx", ".pptx", ".zip", ".h5p"].includes(ext)) return ascii.startsWith("PK");
  return bytes.length > 0;
}

function hrefFrom(pageRel, targetRel) {
  return posix.relative(posix.dirname(pageRel), targetRel).split("/").map((part) => encodeURIComponent(part)).join("/");
}

function fileRow(item, href) {
  return `<div class="file-row"><div class="file-label">${item.label}</div><div class="actions"><a class="button" href="${href}">View</a><a class="button" href="${href}" download>Download</a></div></div>`;
}

function addResource(manifest, target, resource) {
  const unit = (manifest.units || []).find((item) => Number(item.unit) === target.unit);
  const lesson = (unit?.lessons || []).find((item) => Number(item.lesson) === target.lesson);
  if (!lesson) return false;
  lesson.downloads ||= [];
  if (!lesson.downloads.some((item) => item.path === resource.path)) lesson.downloads.push(resource);
  const homework = (lesson.bookSections || []).find((item) => String(item.sectionLabel || "").toLowerCase() === "homework");
  if (homework) {
    homework.attachments ||= [];
    if (!homework.attachments.some((item) => item.path === resource.path)) homework.attachments.push(resource);
  }
  return true;
}

function patchHtml(target, resource) {
  const pageAbs = join(courseRoot, target.pageRel);
  let html = readFileSync(pageAbs, "utf8");
  const href = hrefFrom(target.pageRel, target.targetRel);
  if (target.patchText === "Step-By-Step Guide") {
    html = html.replace(/<a target="_blank">Step-By-Step Guide<\/a>/i, `<a href="${href}" target="_blank">Step-By-Step Guide</a>`);
  } else {
    html = html.replace(/<a target="_blank">HERE<\/a>/i, `<a href="${href}" target="_blank">HERE</a>`);
  }
  if (!html.includes(`href="${href}"`) || !html.includes(resource.label)) {
    html = html.replace(/<\/section>\s*<\/main>/i, `${fileRow(resource, href)}</section>\n  </main>`);
  }
  writeFileSync(pageAbs, html, "utf8");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
await login();

const repaired = [];
const failed = [];
for (const target of targets) {
  try {
    const targetAbs = join(courseRoot, target.targetRel);
    mkdirSync(dirname(targetAbs), { recursive: true });
    let bytes = existsSync(targetAbs) ? readFileSync(targetAbs) : null;
    if (!bytes || !valid(bytes, target.label, "")) {
      const response = await request(target.url);
      bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !valid(bytes, target.label, contentType)) throw new Error(`invalid-download status=${response.status} type=${contentType} bytes=${bytes.length}`);
      writeFileSync(targetAbs, bytes);
    }
    const resource = {
      label: target.label,
      type: typeFromPath(target.targetRel),
      category: "moodle_file",
      role: "attachment",
      path: target.targetRel,
      downloadPath: target.targetRel,
      bytes: statSync(targetAbs).size,
      source: target.url,
    };
    if (resource.type === "pdf") resource.previewPath = target.targetRel;
    addResource(manifest, target, resource);
    patchHtml(target, resource);
    repaired.push({ label: target.label, path: target.targetRel, bytes: resource.bytes });
  } catch (error) {
    failed.push({ label: target.label, url: target.url, error: error?.message || String(error) });
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.downloadFailures = (manifest.sourceAudit.downloadFailures || []).filter(
  (failure) => !repaired.some((item) => item.path === failure.targetRel),
);
manifest.sourceAudit.eng1dMissingBookFilesRepair = {
  repairedAt: new Date().toISOString(),
  repaired,
  failed,
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ repaired: repaired.length, failed }, null, 2));
if (failed.length) process.exitCode = 1;
