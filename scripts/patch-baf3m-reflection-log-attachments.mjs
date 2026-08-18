import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, relative, resolve } from "node:path";

const COURSE = "BAF3M";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const COURSE_ROOT = resolve(REPO_ROOT, "..", "courseware", COURSE);
const MANIFEST_PATH = join(COURSE_ROOT, "course-manifest.json");
const BASE_URL = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "").replace(/\/login\/index\.php$/i, "");

loadEnv(resolve(REPO_ROOT, ".env"));

const jar = new Map();

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
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

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function cookieHeader() {
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

function storeCookies(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    for (const text of String(value).split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = text.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

async function request(url, options = {}, redirects = 0) {
  const headers = { ...(options.headers || {}) };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 5) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function login() {
  const loginUrl = `${BASE_URL}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["']\s+value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing Moodle credentials in .env");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("login failed");
}

function extractActivityFiles(html) {
  const files = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*pluginfile\.php[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = stripTags(match[2]);
    if (!/\.(pdf|docx?|pptx?|xlsx?|h5p|zip|mp4)$/i.test(label)) continue;
    files.push({ label, url: decodeEntities(match[1]) });
  }
  return files;
}

function resourceType(label) {
  return extname(label).replace(".", "").toLowerCase() || "file";
}

function previewPathFor(resource) {
  if (resource.type === "docx" || resource.type === "doc") {
    return toPosix(join("previews-html", `${resource.path}.html`));
  }
  return resource.path;
}

async function downloadLearningLogFiles() {
  const response = await request(`${BASE_URL}/mod/assign/view.php?id=10949`);
  const html = await response.text();
  const files = extractActivityFiles(html);
  const outDir = "localized-moodle-activities/assign/assign-10949-Learning-Log/files";
  const resources = [];
  for (const file of files) {
    const absoluteUrl = new URL(file.url, BASE_URL).toString();
    const bytes = Buffer.from(await (await request(absoluteUrl)).arrayBuffer());
    const hash = createHash("sha1").update(absoluteUrl).digest("hex").slice(0, 10);
    const rel = toPosix(join(outDir, `${hash}-${basename(new URL(absoluteUrl).pathname)}`));
    const abs = join(COURSE_ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    const resource = {
      label: file.label,
      type: resourceType(file.label),
      category: "moodle_file",
      role: "attachment",
      path: rel,
      bytes: bytes.length,
      source: absoluteUrl,
      downloadPath: rel,
    };
    resource.previewPath = previewPathFor(resource);
    resources.push(resource);
  }
  return resources;
}

function addAttachments(resource, attachments) {
  if (!resource || !attachments.length) return 0;
  const existing = new Set((resource.attachments || []).map((item) => item.path || item.downloadPath || item.label));
  const additions = attachments.filter((item) => !existing.has(item.path || item.downloadPath || item.label)).map((item) => ({ ...item }));
  if (!additions.length) return 0;
  resource.attachments = [...(resource.attachments || []), ...additions];
  return additions.length;
}

function ensureFilesSection(pageRel, attachments) {
  const abs = join(COURSE_ROOT, pageRel);
  if (!existsSync(abs) || !attachments.length) return false;
  let html = readFileSync(abs, "utf8");
  if (/<section class="files">|<section class="attachments">/i.test(html)) return false;
  const section = `<section class="files"><h2>Files</h2>${attachments
    .map((item) => {
      const viewPath = item.previewPath || item.path;
      return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${escapeHtml(relativeHref(pageRel, viewPath))}">View</a><a class="button" href="${escapeHtml(relativeHref(pageRel, item.downloadPath || item.path))}" download>Download</a></div></div>`;
    })
    .join("")}</section>`;
  html = html.replace(/\s*<\/main>/i, `\n    ${section}\n  </main>`);
  writeFileSync(abs, html, "utf8");
  return true;
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
await login();
const learningLogFiles = await downloadLearningLogFiles();

let attached = 0;
let pagesPatched = 0;
const learningLogCourseResource = (manifest.courseDownloads || []).find((item) => /Learning Log/i.test(item.label || ""));
attached += addAttachments(learningLogCourseResource, learningLogFiles);
if (learningLogCourseResource && ensureFilesSection(learningLogCourseResource.path, learningLogFiles)) pagesPatched += 1;

for (const unit of manifest.units || []) {
  const kwl = unit.lessons?.[0]?.downloads?.find((item) => new RegExp(`Unit\\s+${unit.unit}\\s+KWL\\.docx`, "i").test(item.label || ""));
  const reflection = [...(unit.lessons || [])].reverse().flatMap((lesson) => lesson.downloads || []).find((item) => new RegExp(`Unit\\s+${unit.unit}\\s+Reflection\\.docx`, "i").test(item.label || ""));
  for (const item of unit.unitResources?.reflectionAndLogs || []) {
    if (/KWL Dropbox/i.test(item.label || "") && kwl) attached += addAttachments(item, [kwl]);
    if (/Reflection Summary Dropbox/i.test(item.label || "") && reflection) attached += addAttachments(item, [reflection]);
    if (/Learning Log Dropbox/i.test(item.label || "")) attached += addAttachments(item, learningLogFiles);
  }
}

manifest.sourceAudit = manifest.sourceAudit || {};
manifest.sourceAudit.reflectionLogAttachmentsPatchedAt = new Date().toISOString();
manifest.sourceAudit.reflectionLogAttachmentsPatched = attached;
manifest.sourceAudit.learningLogFilesLocalized = learningLogFiles.length;

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ course: COURSE, learningLogFiles, attached, pagesPatched }, null, 2));
