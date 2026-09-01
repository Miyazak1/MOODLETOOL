import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const COURSE = "ICS3U";
const COURSE_ID = 51;
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const SECTION_DIR = resolve(REPO_ROOT, "inbox", "ics3u-stmary-sections");
const BASE_URL = normalizeBaseUrl(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58");

const UNIT_TITLES = {
  1: "Programming in Java",
  2: "Computer Systems",
  3: "Software Design and Development",
  4: "Computers and Society",
};

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
const downloadCache = new Map();
const activityCache = new Map();
const downloadFailures = [];
const pendingMedia = [];
const MANIFEST_PATH = resolve(COURSE_ROOT, "course-manifest.json");
const PREVIOUS_MANIFEST = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) : {};
const COURSE_INTRO_ACTIVITY_IDS = new Set();

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

function relPath(absPath) {
  return toPosix(relative(COURSE_ROOT, absPath));
}

function ensureDir(absDir) {
  mkdirSync(absDir, { recursive: true });
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
  return decodeEntities(String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function textPreview(value, length = 760) {
  return stripTags(value).replace(/\s+/g, " ").trim().slice(0, length);
}

function sanitizeSegment(value) {
  const clean = decodeEntities(String(value || "resource"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return clean || "resource";
}

function slug(value) {
  return sanitizeSegment(value)
    .replace(/&/g, "and")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90)
    .replace(/-$/g, "") || "resource";
}

function fileNameFromUrl(url, fallback = "resource") {
  const parsed = new URL(url, BASE_URL);
  let name = decodeURIComponent(parsed.pathname.split("/").pop() || fallback);
  name = sanitizeSegment(name);
  if (!extname(name)) {
    const match = /filename="?([^";]+)"?/i.exec(parsed.search);
    if (match) name = sanitizeSegment(match[1]);
  }
  return name || fallback;
}

function typeFromPath(path) {
  const ext = extname(String(path || "")).replace(".", "").toLowerCase();
  if (!ext) return "html";
  if (ext === "jpeg") return "jpg";
  return ext;
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
  if (ext === ".png") return ascii.startsWith("\x89PNG");
  if (ext === ".gif") return ascii.startsWith("GIF8");
  if ([".jpg", ".jpeg"].includes(ext)) return head[0] === 0xff && head[1] === 0xd8;
  if (ext === ".svg") return /<svg\b/i.test(bytes.subarray(0, 2048).toString("utf8"));
  if ([".mp4", ".m4v", ".mov"].includes(ext)) return bytes.subarray(4, 12).toString("latin1").includes("ftyp") || /video\//i.test(contentType);
  if ([".txt", ".csv", ".html", ".htm"].includes(ext)) return true;
  if ([".tif", ".tiff"].includes(ext)) return ascii.startsWith("II*\x00") || ascii.startsWith("MM\x00*");
  return bytes.length > 0;
}

function maybePreviewPath(resource) {
  if (!resource?.path) return resource;
  const ext = extname(resource.path).toLowerCase();
  if ([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".tif", ".tiff"].includes(ext)) resource.previewPath = resource.path;
  return resource;
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-ics3u-stmary-localizer/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      response = await fetch(url, { ...options, headers, redirect: "manual", signal: controller.signal });
      if (![500, 502, 503, 504].includes(response.status)) {
        lastError = null;
        break;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      response = null;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  if (!response) throw lastError;
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

function extractUrls(htmlValue) {
  const urls = new Set();
  for (const match of String(htmlValue || "").matchAll(/\s(?:href|src|poster)=["']([^"']+)["']/gi)) urls.add(decodeEntities(match[1]));
  return [...urls];
}

function isDownloadableMoodleUrl(url) {
  if (!url) return false;
  const absolute = new URL(url, BASE_URL).toString();
  if (new URL(absolute).host !== new URL(BASE_URL).host) return false;
  if (!/\/(?:pluginfile|draftfile)\.php\//i.test(absolute)) return false;
  if (/\/theme(?:\/|_)|\/logo\/|st%20mary\.jpg|st mary\.jpg|\/icon\b/i.test(absolute)) return false;
  return true;
}

function recordExternalMedia(url, context) {
  const absolute = String(url || "");
  if (/hexstruct\.ispring\.com/i.test(absolute)) pendingMedia.push({ kind: "ispring", url: absolute, ...context });
  else if (/welcome\.hexstruct\.com|h5p_embed|\/h5p\//i.test(absolute)) pendingMedia.push({ kind: "h5p", url: absolute, ...context });
  else if (/youtube\.com|youtu\.be|vimeo\.com/i.test(absolute)) pendingMedia.push({ kind: "external_video", url: absolute, ...context });
}

async function downloadResource(url, targetRelDir, label = "") {
  const absoluteUrl = new URL(decodeEntities(url), BASE_URL).toString();
  if (downloadCache.has(absoluteUrl)) return downloadCache.get(absoluteUrl);
  const fileName = fileNameFromUrl(absoluteUrl, label || "resource");
  const targetRel = toPosix(join(targetRelDir, `${sha10(absoluteUrl)}-${fileName}`));
  const targetAbs = join(COURSE_ROOT, targetRel);
  ensureDir(dirname(targetAbs));
  try {
    let bytes;
    if (existsSync(targetAbs)) {
      bytes = readFileSync(targetAbs);
      if (!hasValidSignature(bytes, fileName, "")) bytes = null;
    }
    if (!bytes) {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await request(absoluteUrl, { headers: { referer: `${BASE_URL}/course/view.php?id=${COURSE_ID}` } });
          bytes = Buffer.from(await response.arrayBuffer());
          const contentType = response.headers.get("content-type") || "";
          if (!response.ok || !hasValidSignature(bytes, fileName, contentType)) throw new Error(`invalid-download status=${response.status} type=${contentType} bytes=${bytes.length}`);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
      }
      if (lastError) throw lastError;
      writeFileSync(targetAbs, bytes);
    }
    const resource = maybePreviewPath({
      label: fileName,
      type: typeFromPath(fileName),
      category: "moodle_file",
      role: "attachment",
      path: targetRel,
      bytes: bytes.length,
      source: absoluteUrl,
    });
    if (!["mp4", "m4v", "mov"].includes(resource.type)) resource.downloadPath = targetRel;
    downloadCache.set(absoluteUrl, resource);
    return resource;
  } catch (error) {
    downloadFailures.push({ url: absoluteUrl, targetRel, reason: String(error.message || error) });
    downloadCache.set(absoluteUrl, null);
    return null;
  }
}

function cleanHtmlFragment(htmlValue, attachmentMap = new Map(), context = {}) {
  let body = String(htmlValue || "");
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  body = body.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  body = body.replace(/<form\b[\s\S]*?<\/form>/gi, "");
  body = body.replace(/<nav\b[\s\S]*?<\/nav>/gi, "");
  body = body.replace(/<ul[^>]*class=["'][^"']*\bsection\b[^"']*\bimg-text\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, "");
  body = body.replace(/<div[^>]*class=["'][^"']*(?:navigation-arrows|navtop|navbottom|region_main_settings_menu_proxy|notifications|availabilityinfo|activity-information|completion-info|gradingsummary|fileuploadsubmissiontime|tileiconcontainer|completionhelp)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  body = body.replace(/<div[^>]*id=["'][^"']*(?:nav-drawer|message-drawer|theme_remui-drawers)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  body = body.replace(/<span[^>]*id=["']maincontent["'][^>]*><\/span>/gi, "");
  body = body.replace(/<img[^>]+src=["'][^"']*\/theme\/image\.php[^"']*["'][^>]*>/gi, "");
  for (const url of extractUrls(body)) recordExternalMedia(url, context);
  body = body.replace(/<iframe\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/iframe>/gi, (full, rawSrc) => {
    const src = decodeEntities(rawSrc);
    if (/hexstruct\.ispring\.com/i.test(src)) {
      const local = localIspringHref(context);
      return local ? `<iframe class="localized-ispring" src="${escapeAttr(local)}" loading="lazy" allowfullscreen></iframe>` : "";
    }
    if (/welcome\.hexstruct\.com|h5p_embed|\/h5p\//i.test(src)) {
      const local = localH5pHref(context, src);
      return local ? `<iframe class="localized-h5p" src="${escapeAttr(local)}" loading="lazy" allowfullscreen></iframe>` : full;
    }
    return full;
  });
  body = body.replace(/<div\b[^>]*class=["'][^"']*\bmediaplugin_videojs\b[^"']*["'][^>]*>\s*<div\b[^>]*>\s*(<video\b[\s\S]*?<\/video>)\s*<\/div>\s*<\/div>/gi, (_match, video) => {
    const cleanedVideo = video
      .replace(/<a\b[^>]*class=["'][^"']*\b_blanktarget\b[^"']*["'][^>]*>\s*<\/a>/gi, "")
      .replace(/\sdata-setup-lazy=(["'])[\s\S]*?\1/gi, "")
      .replace(/\sclass=(["'])[^"']*\bvideo-js\b[^"']*\1/gi, "")
      .replace(/\s{2,}/g, " ");
    return `<div class="embedded-video">${cleanedVideo}</div>`;
  });
  body = body.replace(/\s(?:href|src|poster)=["']([^"']+)["']/gi, (full, rawUrl) => {
    const absolute = new URL(decodeEntities(rawUrl), BASE_URL).toString();
    if (attachmentMap.has(absolute)) return full.replace(rawUrl, attachmentMap.get(absolute));
    if (/^(?:https?:)?\/\//i.test(rawUrl) || rawUrl.startsWith("/") || rawUrl.startsWith("view.php") || rawUrl.startsWith("mod/")) return "";
    return full;
  });
  body = body.replace(/\s(?:onclick|data-region|data-id|aria-describedby)=["'][^"']*["']/gi, "");
  body = body.replace(/https?:\/\/(?:34\.30\.231\.58|www\.esunnybrook\.com|welcome\.hexstruct\.com|hexstruct\.ispring\.com)[^\s<"]*/gi, "");
  body = body.replace(/\b(?:Completion requirements|Make a submission|Previous Activity|Next Activity)\b/gi, "");
  return body.trim();
}

function localIspringHref(context = {}) {
  const unit = Number(context.unit || 0);
  const lesson = Number(context.lesson || 0);
  if (!unit || !lesson || !context.pageRel) return "";
  const lessonId = `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`;
  const rel = `ispring-localized/unit-${String(unit).padStart(2, "0")}/${lessonId}/presentation.html`;
  if (!existsSync(join(COURSE_ROOT, rel))) return "";
  return relativeHref(context.pageRel, rel);
}

function previousLesson(unitNo, lessonNo) {
  const unit = (PREVIOUS_MANIFEST.units || []).find((entry) => Number(entry.unit) === Number(unitNo));
  return (unit?.lessons || []).find((entry) => Number(entry.lesson) === Number(lessonNo)) || null;
}

function localH5pHref(context = {}, source = "") {
  const unit = Number(context.unit || 0);
  const lesson = Number(context.lesson || 0);
  if (!unit || !lesson || !context.pageRel) return "";
  const sourceId = /[?&]id=(\d+)/i.exec(source)?.[1] || "";
  const h5pItems = (previousLesson(unit, lesson)?.downloads || []).filter((item) => {
    const combined = `${item.type || ""} ${item.category || ""} ${item.role || ""} ${item.label || ""} ${item.source || ""}`.toLowerCase();
    return combined.includes("h5p");
  });
  const candidates = h5pItems.filter((item) => !sourceId || String(item.source || "").includes(`id=${sourceId}`) || String(item.label || "").includes(sourceId));
  const pool = candidates.length ? candidates : h5pItems;
  const record = pool.find((item) => item.previewPath && existsSync(join(COURSE_ROOT, item.previewPath))) || pool.find((item) => item.path && existsSync(join(COURSE_ROOT, item.path)));
  if (!record) return "";
  const rel = record.previewPath || record.path;
  const suffix = /\.html(?:$|[?#])/i.test(rel) ? "?embed=1" : "";
  return relativeHref(context.pageRel, rel) + suffix;
}

function extractBalancedElement(html, start, tagName) {
  const tag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "ig");
  token.lastIndex = start;
  let depth = 0;
  let sawStart = false;
  for (const match of html.matchAll(token)) {
    const index = match.index || 0;
    if (index < start) continue;
    const text = match[0];
    if (!sawStart && !new RegExp(`^<${tag}\\b`, "i").test(text)) return "";
    sawStart = true;
    if (new RegExp(`^<${tag}\\b`, "i").test(text) && !/\/\s*>$/.test(text)) depth += 1;
    else if (new RegExp(`^</${tag}\\b`, "i").test(text)) depth -= 1;
    if (sawStart && depth === 0) return html.slice(start, index + text.length);
  }
  return "";
}

function extractSectionSummaryFragment(sectionHtml) {
  const html = String(sectionHtml || "");
  const summary = /<div\b[^>]*class=["'][^"']*\bsummary\b[^"']*["'][^>]*>/i.exec(html);
  if (!summary) return html;
  return extractBalancedElement(html, summary.index || 0, "div") || summary[0];
}

function renderPage(title, bodyHtml, attachments = [], pageRel = "index.html") {
  const attachmentHtml = attachments.length
    ? `<section class="files"><h2>Files</h2>${attachments.map((item) => renderAttachmentRow(item, pageRel)).join("")}</section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    h3 { font-size: 18px; margin: 22px 0 10px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; margin-left: auto; margin-right: auto; max-width: 100%; }
    .content .mediaplugin_videojs, .content .mediaplugin_videojs > div { display: block; margin-left: auto; margin-right: auto; max-width: 100%; }
    .localized-ispring { border: 0; display: block; height: min(72vh, 760px); margin: 16px auto; width: 100%; }
    .localized-h5p { border: 1px solid #d6e2f0; display: block; min-height: 520px; margin: 16px auto; width: 100%; }
    .embedded-video { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
    .embedded-video video { background: #000; display: block; margin: 0 auto; max-height: min(72vh, 760px); max-width: 100%; width: min(100%, 960px); }
    .content table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
    .content td, .content th { border: 1px solid #d6e2f0; padding: 8px 10px; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <article class="content">${bodyHtml || "<p>No page text was available from Moodle.</p>"}</article>
    ${attachmentHtml}
  </main>
</body>
</html>
`;
}

function renderAttachmentRow(item, pageRel) {
  const viewPath = existingPreviewPath(item) || item.previewPath || item.path;
  const canDownload = !["mp4", "m4v", "mov"].includes(String(item.type || "").toLowerCase());
  const downloadButton = canDownload ? `<a class="button" href="${escapeAttr(relativeHref(pageRel, item.downloadPath || item.path))}" download>Download</a>` : "";
  return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${escapeAttr(relativeHref(pageRel, viewPath))}">View</a>${downloadButton}</div></div>`;
}

function existingPreviewPath(item) {
  if (!item?.path) return "";
  const rel = toPosix(join("previews-html", `${item.path}.html`));
  return existsSync(join(COURSE_ROOT, rel)) ? rel : "";
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

async function localizeHtmlAssets(htmlValue, targetRelDir, pageRel, context = {}) {
  const attachmentMap = new Map();
  const attachments = [];
  for (const url of extractUrls(htmlValue)) {
    if (!isDownloadableMoodleUrl(url)) continue;
    const resource = await downloadResource(url, targetRelDir, fileNameFromUrl(url));
    if (!resource) continue;
    const abs = new URL(decodeEntities(url), BASE_URL).toString();
    attachmentMap.set(abs, relativeHref(pageRel, resource.previewPath || resource.path));
    attachments.push(resource);
  }
  return {
    html: cleanHtmlFragment(htmlValue, attachmentMap, { ...context, pageRel }),
    attachments: uniqueResources(attachments),
  };
}

function uniqueResources(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.path || seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function parseActivityUrl(url) {
  const parsed = new URL(url, BASE_URL);
  const mod = /\/mod\/([^/]+)\//i.exec(parsed.pathname)?.[1] || "";
  const id = parsed.searchParams.get("id") || "";
  return { mod, id };
}

function extractMainContent(html) {
  const roleMain = /<div\b[^>]*role=["']main["'][^>]*>/i.exec(html);
  if (roleMain) {
    const balanced = extractBalancedElement(html, roleMain.index || 0, "div");
    if (balanced) return balanced.replace(/^<div\b[^>]*role=["']main["'][^>]*>/i, "").replace(/<\/div>\s*$/i, "");
  }
  const region = /<section\b[^>]*\bid=["']region-main["'][^>]*>/i.exec(html);
  if (region) {
    const balanced = extractBalancedElement(html, region.index || 0, "section");
    if (balanced) return balanced.replace(/^<section\b[^>]*\bid=["']region-main["'][^>]*>/i, "").replace(/<\/section>\s*$/i, "");
  }
  return html;
}

async function localizeActivity(link) {
  const { mod, id } = parseActivityUrl(link.href);
  if (!mod || !id || /Exit Card/i.test(link.text || "") || mod === "h5pactivity") return null;
  const key = `${mod}:${id}`;
  if (activityCache.has(key)) return activityCache.get(key);
  const title = (link.text || `${mod} ${id}`).trim();
  console.log(`localize activity ${mod}:${id} ${title}`);
  const relDir = toPosix(join("localized-moodle-activities", mod, `${mod}-${id}-${slug(title)}`));
  try {
    const response = await request(link.href);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (mod === "resource" && !/html/i.test(contentType)) {
      const bytes = Buffer.from(await response.arrayBuffer());
      let fileName = fileNameFromUrl(response.url || link.href, title);
      if (!extname(fileName) && /pdf/i.test(contentType)) fileName = `${slug(title)}.pdf`;
      if (!hasValidSignature(bytes, fileName, contentType)) throw new Error(`invalid-resource-download type=${contentType} bytes=${bytes.length}`);
      const targetRel = toPosix(join(relDir, "files", `${sha10(response.url || link.href)}-${fileName}`));
      const targetAbs = join(COURSE_ROOT, targetRel);
      ensureDir(dirname(targetAbs));
      writeFileSync(targetAbs, bytes);
      const item = maybePreviewPath({
        label: title,
        fileName,
        type: typeFromPath(fileName),
        category: `moodle_${mod}`,
        role: inferActivityRole(title, mod),
        path: targetRel,
        bytes: bytes.length,
        source: link.href,
        moodleActivityId: id,
        mod,
        teacherUse: inferTeacherUse(title),
        attachments: [],
        textPreview: "",
      });
      if (!["mp4", "m4v", "mov"].includes(item.type)) item.downloadPath = targetRel;
      activityCache.set(key, item);
      return item;
    }
    const html = await response.text();
    const main = extractMainContent(html);
    const pageRel = toPosix(join(relDir, "index.html"));
    const localized = await localizeHtmlAssets(main, toPosix(join(relDir, "files")), pageRel, { activityId: id, title });
    const existingAttachmentPaths = new Set(localized.attachments.map((item) => item.path));
    for (const url of extractUrls(html)) {
      if (!isDownloadableMoodleUrl(url)) continue;
      const resource = await downloadResource(url, toPosix(join(relDir, "files")), fileNameFromUrl(url));
      if (resource && !existingAttachmentPaths.has(resource.path)) {
        localized.attachments.push(resource);
        existingAttachmentPaths.add(resource.path);
      }
    }
    const pageHtml = renderPage(title, localized.html, localized.attachments, pageRel);
    const pageAbs = join(COURSE_ROOT, pageRel);
    ensureDir(dirname(pageAbs));
    writeFileSync(pageAbs, pageHtml, "utf8");
    const item = {
      label: title,
      type: "html",
      category: `moodle_${mod}`,
      role: inferActivityRole(title, mod),
      path: pageRel,
      bytes: Buffer.byteLength(pageHtml, "utf8"),
      source: link.href,
      moodleActivityId: id,
      mod,
      teacherUse: inferTeacherUse(title),
      attachments: localized.attachments.map(maybePreviewPath),
      textPreview: textPreview(localized.html),
    };
    if (/\bAnswer\b/i.test(title)) item.teacherOnly = true;
    activityCache.set(key, item);
    return item;
  } catch (error) {
    downloadFailures.push({ url: link.href, reason: `activity-fetch-failed: ${String(error.message || error)}` });
    activityCache.set(key, null);
    return null;
  }
}

function inferActivityRole(title, mod) {
  if (/course outline/i.test(title)) return "course_outline";
  if (/learning log/i.test(title)) return "learning_log";
  if (/culminating/i.test(title)) return "culminating_assignment";
  if (/final|exam/i.test(title)) return "final_exam";
  if (/\b(AOL|Quiz|Test|Lab|Assignment)\b/i.test(title)) return "evaluation";
  if (/reflection|kwl|learning log/i.test(title)) return "reflection_learning_log";
  if (/^answer keys$/i.test(title.trim())) return "answer_keys";
  if (/answer/i.test(title)) return "answer_key";
  return mod === "forum" ? "discussion" : "moodle_activity";
}

function isCourseIntroActivity(item) {
  return item?.moodleActivityId && COURSE_INTRO_ACTIVITY_IDS.has(String(item.moodleActivityId));
}

function isAssessmentActivity(item) {
  if (!item || isCourseIntroActivity(item)) return false;
  return /\b(AOL|Quiz|Test|Lab|Assignment|Exam|Culminating)\b/i.test(item.label || "");
}

function inferTeacherUse(title) {
  if (/answer/i.test(title)) return "teacher_reference";
  if (/assignment|dropbox|final|culminating|quiz|test|lab/i.test(title)) return "assessment_preparation";
  if (/learning log|kwl|reflection/i.test(title)) return "student_tracking_template";
  return "course_instruction";
}

function hasDisplayablePayload(item) {
  return Boolean(
    item?.path ||
    item?.previewPath ||
    item?.downloadPath ||
    item?.url ||
    item?.previewUrl ||
    item?.downloadUrl ||
    item?.attachments?.length
  );
}

function isEmptyTeacherPacketShell(item) {
  if (!item || item.role !== "teacher_packet") return false;
  const label = String(item.label || item.title || "").replace(/\s+/g, " ").trim().toLowerCase();
  const preview = String(item.textPreview || "").replace(/\s+/g, " ").trim().toLowerCase();
  return !item.attachments?.length && label === "teacher packet" && (!preview || preview === "teacher packet");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sectionJson(sectionNo) {
  return readJson(join(SECTION_DIR, `section-${String(sectionNo).padStart(2, "0")}.json`));
}

function filteredLinksForSection(sectionNo) {
  const section = sectionJson(sectionNo);
  const links = section.modLinks || [];
  if (sectionNo >= 2 && sectionNo <= 5) {
    const unitNo = sectionNo - 1;
    return links.filter((link) => {
      if (/Exit Card/i.test(link.text || "")) return false;
      if (/\/mod\/book\//i.test(link.href)) return true;
      return new RegExp(`\\bUnit\\s+${unitNo}\\b`, "i").test(link.text || "");
    });
  }
  if (sectionNo === 6) return links.filter((link) => /Exam|Culminating/i.test(link.text || ""));
  if (sectionNo === 7) return links.filter((link) => /Answer/i.test(link.text || ""));
  return links.filter((link) => !/Exit Card/i.test(link.text || ""));
}

async function buildCourseSection(sectionNo, label, relDir, role) {
  const section = sectionJson(sectionNo);
  const pageRel = toPosix(join(relDir, "index.html"));
  const sectionSummary = extractSectionSummaryFragment(section.fragment || "");
  const localized = await localizeHtmlAssets(sectionSummary, toPosix(join(relDir, "files")), pageRel, { section: sectionNo, title: label });
  const pageHtml = renderPage(label, localized.html, localized.attachments, pageRel);
  const pageAbs = join(COURSE_ROOT, pageRel);
  ensureDir(dirname(pageAbs));
  writeFileSync(pageAbs, pageHtml, "utf8");
  return {
    label,
    type: "html",
    category: "course_document",
    role,
    path: pageRel,
    bytes: Buffer.byteLength(pageHtml, "utf8"),
    source: section.url,
    attachments: localized.attachments.map(maybePreviewPath),
    textPreview: textPreview(localized.html),
  };
}

function previousUnit(unitNo) {
  return (PREVIOUS_MANIFEST.units || []).find((entry) => Number(entry.unit) === Number(unitNo)) || null;
}

function resourceExists(item) {
  return Boolean((item?.path && existsSync(join(COURSE_ROOT, item.path))) || (item?.previewPath && existsSync(join(COURSE_ROOT, item.previewPath))));
}

function refreshedResource(item) {
  if (!item) return item;
  const next = { ...item };
  if (next.path && existsSync(join(COURSE_ROOT, next.path))) next.bytes = statSync(join(COURSE_ROOT, next.path)).size;
  if (!next.previewPath && next.path) {
    const preview = `previews-html/${next.path}.html`;
    if (existsSync(join(COURSE_ROOT, preview))) next.previewPath = toPosix(preview);
  }
  return next;
}

function isPlayableResource(item) {
  const combined = `${item?.type || ""} ${item?.category || ""} ${item?.role || ""} ${item?.label || ""} ${item?.path || ""} ${item?.previewPath || ""}`.toLowerCase();
  return /\b(h5p|ispring|video|mp4|m4v|mov|webm)\b/.test(combined);
}

function previousPlayableDownloads(unitNo, lessonNo) {
  return (previousLesson(unitNo, lessonNo)?.downloads || [])
    .filter((item) => /h5p/i.test(`${item.type || ""} ${item.category || ""} ${item.role || ""} ${item.label || ""}`))
    .filter((item) => !String(item.path || "").includes(" - - ") && resourceExists(item))
    .map(refreshedResource);
}

function previousPlayableUnitResources(unitNo) {
  const buckets = previousUnit(unitNo)?.unitResources || {};
  const result = { evaluations: [], reflectionAndLogs: [], lessonDropboxes: [], answerPages: [], discussions: [] };
  for (const [bucket, items] of Object.entries(buckets)) {
    for (const item of items || []) {
      if (isPlayableResource(item) && resourceExists(item)) (result[bucket] ||= []).push(refreshedResource(item));
    }
  }
  return result;
}

function mergeResourceBuckets(primary, preserved) {
  const result = {};
  for (const bucket of new Set([...Object.keys(primary || {}), ...Object.keys(preserved || {})])) {
    result[bucket] = uniqueByPath([...(primary?.[bucket] || []), ...(preserved?.[bucket] || [])]);
  }
  return result;
}

function previousFileResource(item) {
  return resourceExists(item) ? refreshedResource(item) : null;
}

async function buildBookSections(unitNo) {
  console.log(`render book unit ${unitNo}`);
  const raw = readJson(join(REPO_ROOT, "inbox", `moodle-book-raw-${COURSE}-U${String(unitNo).padStart(2, "0")}.json`));
  const lessons = [];
  for (const lesson of raw.lessons || []) {
    const lessonNo = Number(lesson.lesson);
    const lessonTitle = sanitizeLessonTitle(lesson.title, lessonNo);
    const lessonPath = `Unit ${unitNo}/Lesson ${lessonNo} - ${sanitizeSegment(lessonTitle)}`;
    const bookSections = [];
    const downloads = [];
    for (const section of lesson.sections || []) {
      const label = section.normalizedLabel || section.label || `Section ${section.sectionIndex}`;
      const sectionIndex = Number(section.sectionIndex || bookSections.length + 1);
      const fileName = `${String(sectionIndex).padStart(2, "0")}-${slug(label).toLowerCase()}.html`;
      const pageRel = toPosix(join(lessonPath, "book_sections", fileName));
      const assetRelDir = toPosix(join(lessonPath, "book_sections", "files", `${String(sectionIndex).padStart(2, "0")}-${slug(label).toLowerCase()}`));
      const localized = await localizeHtmlAssets(section.page?.html || "", assetRelDir, pageRel, { unit: unitNo, lesson: lessonNo, section: label });
      downloads.push(...localized.attachments);
      const title = `${COURSE} Unit ${unitNo} Lesson ${lessonNo} - ${label}`;
      const pageHtml = renderPage(title, localized.html, localized.attachments, pageRel);
      const pageAbs = join(COURSE_ROOT, pageRel);
      ensureDir(dirname(pageAbs));
      writeFileSync(pageAbs, pageHtml, "utf8");
      bookSections.push({
        label: `${label} - Lesson ${lessonNo}: ${lessonTitle}`,
        sectionLabel: label,
        sectionIndex,
        type: "html",
        category: "moodle_book_section",
        role: "lesson_book_section",
        path: pageRel,
        bytes: Buffer.byteLength(pageHtml, "utf8"),
        source: section.url || section.page?.url,
        attachments: localized.attachments.map(maybePreviewPath),
        textPreview: textPreview(localized.html),
      });
    }
    lessons.push({
      unitNo,
      lessonNo,
      lessonTitle,
      lessonPath,
      bookSections,
      downloads: uniqueResources([...downloads, ...previousPlayableDownloads(unitNo, lessonNo)]).map(maybePreviewPath),
    });
  }
  return { bookId: raw.bookId, lessons, rawPageCount: raw.lessons?.reduce((sum, lesson) => sum + (lesson.sections?.length || 0), 0) || 0 };
}

function sanitizeLessonTitle(title, lessonNo) {
  return String(title || `Lesson ${lessonNo}`).replace(/^\s*Lesson\s*(?:\d+\.)?\d+\s*(?:[-:：])?\s*/i, "").trim() || `Lesson ${lessonNo}`;
}

function iSpringForLesson(unitNo, lessonNo) {
  const lessonId = `U${String(unitNo).padStart(2, "0")}L${String(lessonNo).padStart(2, "0")}`;
  const rel = `ispring-localized/unit-${String(unitNo).padStart(2, "0")}/${lessonId}/presentation.html`;
  const abs = join(COURSE_ROOT, rel);
  if (!existsSync(abs)) return [];
  return [{
    label: `${COURSE} ${lessonId} iSpring`,
    type: "ispring",
    category: "ispring",
    role: "lesson_ispring",
    mode: "page",
    path: rel,
    packagePath: posix.dirname(rel),
    bytes: statSync(abs).size,
  }];
}

function categorizeUnitActivity(unitNo, items) {
  const buckets = { evaluations: [], reflectionAndLogs: [], lessonDropboxes: [], answerPages: [], discussions: [] };
  for (const item of items) {
    if (!item) continue;
    if (/\bAnswer\b/i.test(item.label || "")) buckets.answerPages.push({ ...item, teacherOnly: true });
    else if (/KWL|Reflection|Learning log/i.test(item.label || "")) buckets.reflectionAndLogs.push(item);
    else if (/\b(AOL|Quiz|Test|Lab|Assignment)\b/i.test(item.label || "")) buckets.evaluations.push(item);
    else if (new RegExp(`Unit\\s+${unitNo}\\s+-\\s+Lesson\\s+\\d+\\s*$`, "i").test(item.label || "")) buckets.lessonDropboxes.push(item);
    else if (/forum/i.test(item.mod || item.category)) buckets.discussions.push(item);
  }
  return buckets;
}

function textResources() {
  return (PREVIOUS_MANIFEST.texts || []).map(previousFileResource).filter(Boolean);
}

function curriculumGuideResources() {
  return (PREVIOUS_MANIFEST.courseDownloads || [])
    .filter((item) => /curriculum/i.test(`${item.category || ""} ${item.role || ""} ${item.label || ""}`))
    .map(previousFileResource)
    .filter(Boolean);
}

async function main() {
  ensureDir(COURSE_ROOT);
  await login();

  const courseStarter = await buildCourseSection(0, "Course Introduction", "course-sections/course-starter-resources", "introduction");
  const courseOverview = await buildCourseSection(1, "Course Overview", "course-sections/course-overview", "course_overview");
  const finalSection = await buildCourseSection(6, "Final Examination & Culminating", "course-sections/final-exam-culminating", "final_examination_culminating");
  const teacherPacket = await buildCourseSection(7, "Teacher Packet", "course-sections/teacher-packet", "teacher_packet");

  const localizedActivities = [];
  for (const sectionNo of [0, 1, 2, 3, 4, 5, 6, 7]) {
    for (const link of filteredLinksForSection(sectionNo)) {
      if (/\/mod\/book\//i.test(link.href)) continue;
      const item = await localizeActivity(link);
      if (item) localizedActivities.push(item);
    }
  }
  const activityById = new Map(localizedActivities.map((item) => [item.moodleActivityId, item]));

  const bookReports = [];
  const units = [];
  for (const unitNo of [1, 2, 3, 4]) {
    const book = await buildBookSections(unitNo);
    bookReports.push({ unit: unitNo, bookId: book.bookId, localizedPages: book.rawPageCount, lessons: book.lessons.length });
    const unitActivities = filteredLinksForSection(unitNo + 1)
      .filter((link) => !/\/mod\/book\//i.test(link.href))
      .map((link) => activityById.get(parseActivityUrl(link.href).id))
      .filter(Boolean);
    const lessons = book.lessons.map((lesson) => {
      const priorLesson = previousLesson(unitNo, lesson.lessonNo) || {};
      const ispring = iSpringForLesson(unitNo, lesson.lessonNo);
      return {
        id: `U${String(unitNo).padStart(2, "0")}L${String(lesson.lessonNo).padStart(2, "0")}`,
        unit: unitNo,
        lesson: lesson.lessonNo,
        title: lesson.lessonTitle,
        path: lesson.lessonPath,
        bookPageCount: lesson.bookSections.length,
        lessonText: priorLesson.lessonText || [],
        textExports: priorLesson.textExports || [],
        lessonPlan: previousFileResource(priorLesson.lessonPlan),
        ispring,
        downloads: lesson.downloads,
        bookSections: lesson.bookSections,
        resourceCounts: {
          downloads: lesson.downloads.length,
          bookSections: lesson.bookSections.length,
          lessonPlan: priorLesson.lessonPlan && resourceExists(priorLesson.lessonPlan) ? 1 : 0,
          ispring: ispring.length,
          h5p: lesson.downloads.filter((item) => isPlayableResource(item) && /h5p/i.test(`${item.type || ""} ${item.category || ""} ${item.label || ""}`)).length,
          video: lesson.downloads.filter((item) => isPlayableResource(item) && /video|mp4|m4v|mov|webm/i.test(`${item.type || ""} ${item.category || ""} ${item.label || ""}`)).length,
        },
      };
    });
    const priorUnit = previousUnit(unitNo) || {};
    const categorizedActivities = categorizeUnitActivity(unitNo, unitActivities);
    units.push({
      unit: unitNo,
      title: UNIT_TITLES[unitNo],
      coreTexts: (priorUnit.coreTexts || []).map(previousFileResource).filter(Boolean),
      unitPlan: previousFileResource(priorUnit.unitPlan),
      unitResources: mergeResourceBuckets(categorizedActivities, previousPlayableUnitResources(unitNo)),
      lessons,
      summary: {
        lessons: lessons.length,
        bookSections: lessons.reduce((sum, lesson) => sum + lesson.bookSections.length, 0),
        downloads: lessons.reduce((sum, lesson) => sum + lesson.downloads.length, 0),
        ispring: lessons.reduce((sum, lesson) => sum + lesson.ispring.length, 0),
        h5p: lessons.reduce((sum, lesson) => sum + lesson.resourceCounts.h5p, 0),
        video: lessons.reduce((sum, lesson) => sum + lesson.resourceCounts.video, 0),
      },
    });
  }

  const courseDownloads = [
    activityById.get("8389"),
    activityById.get("8390"),
    activityById.get("8391"),
    ...curriculumGuideResources(),
  ].filter(Boolean);
  const introductionResources = courseDownloads.filter((item) => item.role === "introduction");
  const teacherResources = uniqueByPath([
    activityById.get("8482"),
    ...localizedActivities.filter((item) => /\bAnswer\b/i.test(item.label || "")),
    ...localizedActivities.filter(isAssessmentActivity),
  ].filter(Boolean).filter(hasDisplayablePayload).map((item) => ({
    ...item,
    role: item.moodleActivityId === "8482" ? "answer_keys" : item.role,
    teacherOnly: item.teacherOnly || /\bAnswer\b/i.test(item.label || "") || item.moodleActivityId === "8482",
  })));

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    course: {
      code: COURSE,
      title: "ICS3U · Introduction to Computer Studies",
      audience: "Teachers preparing OSSD lessons",
      source: "St. Mary Moodle course id 51 and existing legal local source files",
    },
    sourceAudit: {
      moodleHost: BASE_URL,
      moodleCourseId: COURSE_ID,
      moodleCoursePage: `${BASE_URL}/course/view.php?id=${COURSE_ID}`,
      courseStructure: "new-moodle-v2",
      unitCount: units.length,
      lessonCount: units.reduce((sum, unit) => sum + unit.lessons.length, 0),
      bookReports,
      moodleActivityCountLocalized: localizedActivities.length,
      ispringExpectedFromBookRefs: pendingMedia.filter((item) => item.kind === "ispring").length,
      ispringComplete: units.reduce((sum, unit) => sum + unit.summary.ispring, 0),
      h5pPlayableLocal: units.reduce((sum, unit) => sum + unit.summary.h5p, 0) + units.reduce((sum, unit) => sum + Object.values(unit.unitResources || {}).flat().filter((item) => isPlayableResource(item) && /h5p/i.test(`${item.type || ""} ${item.category || ""} ${item.label || ""}`)).length, 0),
      videoPlayableLocal: units.reduce((sum, unit) => sum + unit.summary.video, 0),
      h5pExternalEmbedsSeen: pendingMedia.filter((item) => item.kind === "h5p").length,
      h5pExternalEmbedsWithoutLocalMatch: pendingMedia.filter((item) => item.kind === "h5p" && !localH5pHref(item, item.url)).length,
      textbookReference: {
        title: "ICS3U textbook reference",
        status: "not_manifested",
        reason: "No specific legal textbook file was identified in the existing local ICS3U package or St. Mary Moodle crawl.",
      },
      curriculumGuidance: curriculumGuideResources().map((item) => ({
        title: item.label,
        status: "manifested",
        source: item.source,
        path: item.path,
      })),
      downloadFailures,
      note: "Course was regenerated from St. Mary Moodle id 51. Existing localized ICS3U H5P, video, iSpring, unit plan, and lesson plan files were preserved; ordinary files remain attachments on their owning HTML/activity pages, while only localized playable resources are eligible for standalone display.",
    },
    navigation: { primary: "unit", secondary: "lesson" },
    courseDownloads,
    texts: textResources(),
    units,
    courseSections: [courseStarter, ...introductionResources, courseOverview, finalSection, teacherPacket].filter((item) => !isEmptyTeacherPacketShell(item)),
    teacherResources,
    evaluations: localizedActivities.filter(isAssessmentActivity),
  };

  writeFileSync(join(COURSE_ROOT, "course-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    course: COURSE,
    courseDownloads: courseDownloads.length,
    localizedActivities: localizedActivities.length,
    units: units.length,
    lessons: manifest.sourceAudit.lessonCount,
    ispringComplete: manifest.sourceAudit.ispringComplete,
    h5pPlayableLocal: manifest.sourceAudit.h5pPlayableLocal,
    h5pExternalEmbedsWithoutLocalMatch: manifest.sourceAudit.h5pExternalEmbedsWithoutLocalMatch,
    downloadFailures: downloadFailures.length,
  }, null, 2));
}

function uniqueByPath(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.path || `${item.label}:${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

