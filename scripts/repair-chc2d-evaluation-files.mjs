import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const COURSE = "CHC2D";
const projectRoot = resolve(import.meta.dirname, "..");
const courseRoot = resolve(projectRoot, "..", "courseware", COURSE);
const manifestPath = join(courseRoot, "course-manifest.json");
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "").replace(/\/login\/index\.php$/i, "");
const jar = new Map();
const loggedInOrigins = new Set();

loadEnv(resolve(projectRoot, ".env"));

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

function storeCookies(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    for (const text of String(value).split(/,(?=\s*[^;,]+=)/g)) {
      const pair = text.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

function cookieHeader() {
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(url, options = {}, redirects = 0) {
  const headers = { "user-agent": "ossd-course-portal-chc2d-evaluation-file-repair/1.0", ...(options.headers || {}) };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function login() {
  await loginTo(baseUrl);
}

async function loginTo(origin) {
  const normalizedOrigin = String(origin || "").replace(/\/+$/, "");
  if (!normalizedOrigin || loggedInOrigins.has(normalizedOrigin)) return;
  const loginUrl = `${normalizedOrigin}/login/index.php`;
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
  loggedInOrigins.add(normalizedOrigin);
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
  return decodeEntities(String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sha10(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function sanitizeSegment(value) {
  return decodeEntities(String(value || "resource"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "") || "resource";
}

function fileNameFromUrl(url, fallback = "resource") {
  const parsed = new URL(url, baseUrl);
  let name = sanitizeSegment(decodeURIComponent(parsed.pathname.split("/").pop() || fallback));
  if (!extname(name)) {
    const match = /filename="?([^";]+)"?/i.exec(parsed.search);
    if (match) name = sanitizeSegment(match[1]);
  }
  return name;
}

function typeFromPath(path) {
  const ext = extname(String(path || "")).replace(".", "").toLowerCase();
  return ext === "jpeg" ? "jpg" : ext || "html";
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
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".txt", ".csv"].includes(ext)) return bytes.length > 0;
  return bytes.length > 0;
}

function findExistingCourseFile(fileName) {
  const target = sanitizeSegment(fileName).toLowerCase();
  const stack = [courseRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["previews-html", "_backups"].includes(entry.name)) stack.push(abs);
        continue;
      }
      if (entry.name.toLowerCase().endsWith(target)) {
        const bytes = readFileSync(abs);
        if (hasValidSignature(bytes, fileName)) return abs;
      }
    }
  }
  return "";
}

function maybePreviewPath(resource) {
  const ext = extname(resource.path).toLowerCase();
  if ([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) resource.previewPath = resource.path;
  return resource;
}

function collectEvaluationRefs(manifest) {
  const refs = [];
  const addRefs = (items, scope) => {
    for (const item of items || []) {
      if (!item || typeof item !== "object" || !item.source || !item.path) continue;
      const mod = item.mod || /\/mod\/([^/]+)\//i.exec(item.source)?.[1] || "";
      const id = String(item.moodleActivityId || new URL(item.source, baseUrl).searchParams.get("id") || "");
      if (!mod || !id) continue;
      refs.push({ item, mod, id, scope });
    }
  };
  addRefs(manifest.evaluations, "top");
  for (const unit of manifest.units || []) addRefs(unit.unitResources?.evaluations, unit.unitCode || unit.code || "unit");
  return refs;
}

function isCandidateFileLink(href, label) {
  const text = `${href} ${label}`;
  if (!/\.(?:docx?|pdf|pptx?|xlsx?|zip)(?:[?#]|$)/i.test(text)) return false;
  return /(?:pluginfile|draftfile)\.php|hexstruct\.com|34\.30\.231\.58/i.test(href);
}

function extractFileLinks(html, sourceUrl) {
  const byUrl = new Map();
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[1]);
    const label = stripTags(match[2]);
    if (!isCandidateFileLink(href, label)) continue;
    const absolute = new URL(href, sourceUrl).toString();
    byUrl.set(absolute, { url: absolute, downloadUrl: absolute, fallbackDownloadUrl: normalizeMoodleFileUrl(absolute), label: label && !/^here$/i.test(label) ? label : fileNameFromUrl(absolute) });
  }
  return [...byUrl.values()];
}

function normalizeMoodleFileUrl(url) {
  const parsed = new URL(url, baseUrl);
  if (/hexstruct\.com$/i.test(parsed.hostname) && /\/(?:pluginfile|draftfile)\.php\//i.test(parsed.pathname)) {
    return `${baseUrl}${parsed.pathname}${parsed.search}`;
  }
  return parsed.toString();
}

async function downloadFile(link, targetRelDir) {
  const downloadUrl = link.downloadUrl || link.url;
  const parsedDownloadUrl = new URL(downloadUrl, baseUrl);
  if (/hexstruct\.com$/i.test(parsedDownloadUrl.hostname)) await loginTo(parsedDownloadUrl.origin);
  const fileName = fileNameFromUrl(downloadUrl, link.label || "resource");
  const targetRel = toPosix(posix.join(targetRelDir, `${sha10(downloadUrl)}-${fileName}`));
  const targetAbs = join(courseRoot, targetRel);
  mkdirSync(dirname(targetAbs), { recursive: true });
  let bytes = existsSync(targetAbs) ? readFileSync(targetAbs) : null;
  if (!bytes || !hasValidSignature(bytes, fileName)) {
    const candidates = [...new Set([downloadUrl, link.fallbackDownloadUrl].filter(Boolean))];
    let downloaded = null;
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const response = await request(candidate, { headers: { referer: link.referer || baseUrl } });
        const candidateBytes = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !hasValidSignature(candidateBytes, fileName, contentType)) {
          throw new Error(`invalid download ${response.status} ${contentType} ${candidateBytes.length} bytes from ${candidate}`);
        }
        downloaded = { bytes: candidateBytes, url: candidate };
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!downloaded) {
      const existing = findExistingCourseFile(fileName);
      if (!existing) throw lastError;
      copyFileSync(existing, targetAbs);
      bytes = readFileSync(targetAbs);
    } else {
      bytes = downloaded.bytes;
      writeFileSync(targetAbs, bytes);
    }
  }
  const resource = maybePreviewPath({
    label: fileName,
    type: typeFromPath(fileName),
    category: "moodle_file",
    role: "attachment",
    path: targetRel,
    bytes: bytes.length,
    source: link.url,
    downloadSource: downloadUrl,
    downloadPath: targetRel,
  });
  return resource;
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function renderFileRow(item, pageRel) {
  const viewPath = item.previewPath || item.path;
  return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${relativeHref(pageRel, viewPath)}">View</a><a class="button" href="${relativeHref(pageRel, item.downloadPath || item.path)}" download>Download</a></div></div>`;
}

function patchActivityPage(item) {
  const pageAbs = join(courseRoot, item.path);
  if (!existsSync(pageAbs)) return false;
  let html = readFileSync(pageAbs, "utf8");
  const attachments = item.attachments || [];
  const first = attachments[0];
  if (first) {
    const firstHref = relativeHref(item.path, first.previewPath || first.path);
    html = html.replace(/<a(?![^>]*\bhref=)([^>]*)>\s*HERE\s*<\/a>/i, `<a$1 href="${firstHref}">HERE</a>`);
  }
  const filesHtml = attachments.length ? `<section class="files"><h2>Files</h2>${attachments.map((file) => renderFileRow(file, item.path)).join("")}</section>` : "";
  if (filesHtml) {
    if (/<section class=["']files["'][\s\S]*?<\/section>/i.test(html)) {
      html = html.replace(/<section class=["']files["'][\s\S]*?<\/section>/i, filesHtml);
    } else {
      html = html.replace(/\s*<\/main>/i, `\n    ${filesHtml}\n  </main>`);
    }
  }
  writeFileSync(pageAbs, html, "utf8");
  item.bytes = Buffer.byteLength(html, "utf8");
  return true;
}

function addAttachments(item, files) {
  const seen = new Set((item.attachments || []).map((file) => file.path));
  const attachments = [...(item.attachments || [])];
  for (const file of files) {
    if (seen.has(file.path)) continue;
    attachments.push(file);
    seen.add(file.path);
  }
  item.attachments = attachments;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const refs = collectEvaluationRefs(manifest);
const byKey = new Map();
for (const ref of refs) {
  const key = `${ref.mod}:${ref.id}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(ref);
}

await login();

const repaired = [];
const skipped = [];
const failures = [];
for (const [key, group] of byKey) {
  const { mod, id, item } = group[0];
  const sourceUrl = `${baseUrl}/mod/${mod}/view.php?id=${id}`;
  const response = await request(sourceUrl);
  const html = await response.text();
  const links = extractFileLinks(html, sourceUrl).map((link) => ({ ...link, referer: sourceUrl }));
  if (!links.length) {
    skipped.push({ key, label: item.label, reason: "no source file links" });
    continue;
  }
  const targetRelDir = toPosix(posix.join(posix.dirname(item.path), "files"));
  const files = [];
  for (const link of links) {
    try {
      files.push(await downloadFile(link, targetRelDir));
    } catch (error) {
      failures.push({ key, label: item.label, url: link.url, downloadUrl: link.downloadUrl, fallbackDownloadUrl: link.fallbackDownloadUrl, reason: String(error.message || error) });
    }
  }
  if (!files.length) {
    skipped.push({ key, label: item.label, reason: "source links found but none downloaded" });
    continue;
  }
  for (const ref of group) {
    addAttachments(ref.item, files);
    patchActivityPage(ref.item);
  }
  repaired.push({ key, label: item.label, sourceUrl, links: links.map((link) => link.url), files: files.map((file) => file.path) });
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const report = { repaired: repaired.length, skipped: skipped.length, failures: failures.length, repairedItems: repaired, skippedItems: skipped, failuresList: failures };
writeFileSync(resolve(projectRoot, "deployment", "chc2d-evaluation-file-repair-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
