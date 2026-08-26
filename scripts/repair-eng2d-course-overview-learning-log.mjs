import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

const COURSE = "ENG2D";
const COURSE_ID = 75;
const ACTIVITY_ID = "11077";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const BASE_URL = normalizeBaseUrl(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58");
const ACTIVITY_URL = `${BASE_URL}/mod/assign/view.php?id=${ACTIVITY_ID}`;

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
  const envPath = resolve(REPO_ROOT, ".env");
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

function normalizeBaseUrl(value) {
  return String(value || "http://34.30.231.58").trim().replace(/\/+$/, "").replace(/\/login\/index\.php$/i, "");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function sha10(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value) {
  return decodeEntities(String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function sanitizeSegment(value) {
  const clean = decodeEntities(String(value || "resource"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return clean || "resource";
}

function typeFromPath(path) {
  const ext = extname(String(path || "")).replace(".", "").toLowerCase();
  if (ext === "jpeg") return "jpg";
  return ext || "html";
}

function fileNameFromUrl(url, contentDisposition = "") {
  const cdMatch = /filename\*?=(?:UTF-8''|["']?)([^"';]+)/i.exec(contentDisposition || "");
  if (cdMatch) return sanitizeSegment(decodeURIComponent(cdMatch[1]));
  const parsed = new URL(url, BASE_URL);
  return sanitizeSegment(decodeURIComponent(parsed.pathname.split("/").pop() || "Learning Log.docx"));
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
  headers.set("user-agent", "ossd-course-portal-eng2d-repair/1.0");
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
  const loginUrl = `${BASE_URL}/login/index.php`;
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
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St. Mary Moodle login failed.");
}

function extractPluginfileUrls(html) {
  const urls = new Set();
  const text = String(html || "");
  for (const match of text.matchAll(/\s(?:href|src)=["']([^"']*(?:pluginfile|draftfile)\.php\/[^"']+)["']/gi)) {
    urls.add(new URL(decodeEntities(match[1]), BASE_URL).toString());
  }
  for (const match of text.matchAll(/https?:\\?\/\\?\/[^"' <]+(?:pluginfile|draftfile)\.php\\?\/[^"' <)]+/gi)) {
    urls.add(decodeEntities(match[0]).replace(/\\\//g, "/"));
  }
  return [...urls]
    .map((url) => new URL(url, BASE_URL).toString())
    .filter((url) => new URL(url).host === new URL(BASE_URL).host)
    .filter((url) => /\/(?:pluginfile|draftfile)\.php\//i.test(url))
    .filter((url) => !/\/theme(?:_|\/)|\/icon\b/i.test(url));
}

async function downloadFromMoodle(url) {
  const response = await request(url, { headers: { referer: ACTIVITY_URL } });
  const bytes = Buffer.from(await response.arrayBuffer());
  const fileName = fileNameFromUrl(response.url || url, response.headers.get("content-disposition") || "");
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !hasValidSignature(bytes, fileName, contentType)) return null;
  const rel = toPosix(join("localized-moodle-activities", "assign", "assign-11077-Learning-Log", "files", `${sha10(url)}-${fileName}`));
  const abs = join(COURSE_ROOT, rel);
  ensureDir(dirname(abs));
  writeFileSync(abs, bytes);
  return resourceRecord(fileName, rel, bytes.length, url, "moodle_introattachment");
}

function resourceRecord(label, rel, bytes, source, sourceStatus) {
  const type = typeFromPath(label || rel);
  const record = {
    label,
    type,
    category: "moodle_file",
    role: "attachment",
    path: rel,
    bytes,
    source,
    sourceStatus,
    downloadPath: rel,
  };
  if (type === "pdf") {
    record.previewPath = rel;
  } else if (["doc", "docx", "ppt", "pptx", "xls", "xlsx"].includes(type)) {
    record.previewPath = `previews-html/${rel}.html`;
  }
  return record;
}

function recoverFromCourseOverviewIspring() {
  const candidates = [
    join(COURSE_ROOT, "ispring-localized", "unit-00", "course-overview", "resources", "templates", "Learning Log.docx"),
    join(WORKSPACE_ROOT, "courseware", "GLC2O", "ispring-localized", "unit-00", "course-overview", "resources", "templates", "Learning Log.docx"),
  ];
  const sourceAbs = candidates.find((item) => existsSync(item));
  if (!sourceAbs) return null;
  const rel = toPosix(join("localized-moodle-activities", "assign", "assign-11077-Learning-Log", "files", `${sha10(sourceAbs)}-${basename(sourceAbs)}`));
  const targetAbs = join(COURSE_ROOT, rel);
  ensureDir(dirname(targetAbs));
  copyFileSync(sourceAbs, targetAbs);
  const sourceRel = toPosix(relative(COURSE_ROOT, sourceAbs));
  const status = sourceAbs.startsWith(COURSE_ROOT)
    ? "recovered_from_course_overview_ispring_template"
    : "recovered_from_matching_course_overview_template";
  return resourceRecord(basename(sourceAbs), rel, statSync(targetAbs).size, sourceRel, status);
}

function relativeHref(fromRel, toRel) {
  return posix.relative(posix.dirname(toPosix(fromRel)), toPosix(toRel)).split("/").map(encodeURIComponent).join("/");
}

function renderFilesSection(attachments, pageRel) {
  if (!attachments.length) return "";
  const rows = attachments.map((item) => {
    const viewPath = item.previewPath || item.path;
    const download = `<a class="button" href="${escapeHtml(relativeHref(pageRel, item.downloadPath || item.path))}" download>Download</a>`;
    return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${escapeHtml(relativeHref(pageRel, viewPath))}">View</a>${download}</div></div>`;
  }).join("");
  return `<section class="files"><h2>Files</h2>${rows}</section>`;
}

function patchLearningLogPage(attachments) {
  const pageRel = "localized-moodle-activities/assign/assign-11077-Learning-Log/index.html";
  const pagePath = join(COURSE_ROOT, pageRel);
  let html = readFileSync(pagePath, "utf8");
  html = html.replace(/\s*<section class="files">[\s\S]*?<\/section>/gi, "");
  const files = renderFilesSection(attachments, pageRel);
  html = html.replace(/\s*<\/main>/i, `\n    ${files}\n  </main>`);
  writeFileSync(pagePath, html, "utf8");
  return { pageRel, pagePath, bytes: statSync(pagePath).size, textPreview: stripTags(html).slice(0, 760) };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  const downloaded = [];
  let fetchError = "";
  try {
    await login();
    const response = await request(ACTIVITY_URL);
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    for (const url of extractPluginfileUrls(html)) {
      const record = await downloadFromMoodle(url);
      if (record) downloaded.push(record);
    }
  } catch (error) {
    fetchError = String(error?.message || error);
  }

  const attachments = downloaded.filter((item) => /learning\s*log/i.test(`${item.label || ""} ${item.path || ""}`));
  if (!attachments.length) {
    const recovered = recoverFromCourseOverviewIspring();
    if (recovered) attachments.push(recovered);
  }
  if (!attachments.length) throw new Error(`Could not recover Learning Log attachment. Moodle fetch error: ${fetchError || "none"}`);

  const manifestPath = join(COURSE_ROOT, "course-manifest.json");
  const manifest = readJson(manifestPath);
  const activity = (manifest.courseDownloads || []).find((item) => item.moodleActivityId === ACTIVITY_ID || item.role === "learning_log");
  if (!activity) throw new Error("Manifest is missing the Learning Log course download.");
  const attachmentPaths = new Set(attachments.map((item) => item.path));
  activity.attachments = [...attachments, ...(activity.attachments || []).filter((item) => !attachmentPaths.has(item.path) && /learning\s*log/i.test(`${item.label || ""} ${item.path || ""}`))];
  const page = patchLearningLogPage(activity.attachments);
  activity.bytes = page.bytes;
  activity.textPreview = page.textPreview;
  manifest.sourceAudit ||= {};
    manifest.sourceAudit.learningLogAttachmentRepair = {
    activity: ACTIVITY_URL,
    attachments: attachments.map((item) => item.path),
    sources: attachments.map((item) => item.source),
    sourceStatus: [...new Set(attachments.map((item) => item.sourceStatus))],
    moodleFetchError: fetchError || null,
    repairedAt: new Date().toISOString(),
  };
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);

  const report = {
    course: COURSE,
    moodleCourseId: COURSE_ID,
    activity: ACTIVITY_URL,
    attachments,
    downloadedCandidates: downloaded.map((item) => ({ label: item.label, path: item.path, source: item.source })),
    fetchError: fetchError || null,
    page: page.pageRel,
  };
  writeJson(join(REPO_ROOT, "deployment", "ENG2D-learning-log-repair-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
