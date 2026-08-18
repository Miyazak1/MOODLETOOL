import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  args.set(key.slice(2), process.argv[index + 1]);
  index += 1;
}

const course = args.get("course");
const courseId = args.get("course-id");
if (!course || !courseId) throw new Error("Usage: node scripts/audit-stmary-activity-file-links.mjs --course ESLAO --course-id 50");

const repoRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(repoRoot, "..");
const courseRoot = resolve(workspaceRoot, "courseware", course);
const sectionDir = resolve(repoRoot, "inbox", `${course.toLowerCase()}-stmary-sections`);
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "");

loadEnv();

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

function loadEnv() {
  const envPath = resolve(repoRoot, ".env");
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

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-stmary-file-auditor/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
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
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St. Mary Moodle login failed");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\\\//g, "/");
}

function normalizeFileUrl(value) {
  const absolute = new URL(decodeEntities(value), baseUrl).toString();
  const parsed = new URL(absolute);
  parsed.searchParams.delete("forcedownload");
  return parsed.toString();
}

function extractFileUrls(html) {
  const urls = new Set();
  const text = decodeEntities(html);
  const patterns = [
    /(?:https?:)?\/\/[^"'<>\s]+\/(?:pluginfile|draftfile)\.php\/[^"'<>\s)]+/gi,
    /\/(?:pluginfile|draftfile)\.php\/[^"'<>\s)]+/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0].startsWith("//") ? `http:${match[0]}` : match[0];
      if (/\/theme(?:_[^/]+)?\/|\/logo\/|\/icon\b/i.test(raw)) continue;
      urls.add(normalizeFileUrl(raw));
    }
  }
  return [...urls].sort();
}

function filename(url) {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.split("/").pop() || "resource");
}

function activityLinks() {
  const links = [];
  for (const entry of readDirFiles(sectionDir)) {
    const section = readJson(entry);
    for (const link of section.modLinks || []) {
      if (!/\/mod\/(assign|page|forum|resource)\//i.test(link.href || "")) continue;
      const parsed = new URL(link.href, baseUrl);
      const mod = /\/mod\/([^/]+)\//i.exec(parsed.pathname)?.[1] || "";
      const id = parsed.searchParams.get("id") || "";
      if (!id) continue;
      links.push({ section: section.sectionNumber, title: link.text, href: parsed.toString(), mod, id });
    }
  }
  const seen = new Set();
  return links.filter((link) => {
    const key = `${link.mod}:${link.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readDirFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => join(dir, name));
}

function collectManifestSources(value, map = new Map()) {
  if (!value || typeof value !== "object") return map;
  if (Array.isArray(value)) {
    for (const item of value) collectManifestSources(item, map);
    return map;
  }
  if (value.moodleActivityId) {
    const sources = [];
    collectAttachmentSources(value, sources);
    map.set(String(value.moodleActivityId), new Set(sources.map(normalizeFileUrl)));
  }
  for (const item of Object.values(value)) collectManifestSources(item, map);
  return map;
}

function collectAttachmentSources(value, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentSources(item, out);
    return;
  }
  if (value.source && /\/(?:pluginfile|draftfile)\.php\//i.test(value.source)) out.push(value.source);
  for (const item of Object.values(value)) collectAttachmentSources(item, out);
}

await login();

const manifest = readJson(join(courseRoot, "course-manifest.json"));
const manifestSourcesById = collectManifestSources(manifest);
const rows = [];

for (const link of activityLinks()) {
  const response = await request(link.href, { headers: { referer: `${baseUrl}/course/view.php?id=${courseId}` } });
  const html = await response.text();
  const moodleFiles = extractFileUrls(html);
  const localSources = manifestSourcesById.get(link.id) || new Set();
  const missing = moodleFiles.filter((url) => !localSources.has(url));
  if (moodleFiles.length || missing.length) {
    rows.push({
      section: link.section,
      mod: link.mod,
      id: link.id,
      title: link.title,
      moodleFileCount: moodleFiles.length,
      localManifestFileCount: localSources.size,
      missingCount: missing.length,
      missing: missing.map((url) => ({ url, file: filename(url) })),
    });
  }
}

const missingRows = rows.filter((row) => row.missingCount > 0);
console.log(JSON.stringify({
  course,
  courseId,
  activitiesChecked: activityLinks().length,
  activitiesWithFiles: rows.filter((row) => row.moodleFileCount > 0).length,
  activitiesMissingFiles: missingRows.length,
  missingRows,
}, null, 2));
