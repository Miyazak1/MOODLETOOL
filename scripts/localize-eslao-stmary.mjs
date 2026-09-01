import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const COURSE = "ESLAO";
const COURSE_ID = 50;
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const SECTION_DIR = resolve(REPO_ROOT, "inbox", "eslao-stmary-sections");
const BASE_URL = normalizeBaseUrl(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58");

const UNIT_TITLES = {
  1: "Unit 1: Listening and speaking",
  2: "Unit 2: Reading",
  3: "Unit 3: Writing",
  4: "Unit 4: Media",
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
  headers.set("user-agent", "ossd-course-portal-eslao-stmary-localizer/1.0");
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

function extractUrls(htmlValue) {
  const urls = new Set();
  const text = String(htmlValue || "");
  for (const match of text.matchAll(/\s(?:href|src|poster)=["']([^"']+)["']/gi)) urls.add(decodeEntities(match[1]));
  const decoded = decodeEntities(text).replace(/\\\//g, "/");
  const patterns = [
    /(?:https?:)?\/\/[^"'<>\s]+\/(?:pluginfile|draftfile)\.php\/[^"'<>\s)]+/gi,
    /\/(?:pluginfile|draftfile)\.php\/[^"'<>\s)]+/gi,
  ];
  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      urls.add(match[0].startsWith("//") ? `http:${match[0]}` : match[0]);
    }
  }
  return [...urls];
}

function isDownloadableMoodleUrl(url) {
  if (!url) return false;
  const absolute = new URL(url, BASE_URL).toString();
  if (new URL(absolute).host !== new URL(BASE_URL).host) return false;
  if (!/\/(?:pluginfile|draftfile)\.php\//i.test(absolute)) return false;
  if (/\/theme(?:_[^/]+)?\/|\/logo\/|\/icon\b/i.test(absolute)) return false;
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
      const response = await request(absoluteUrl, { headers: { referer: `${BASE_URL}/course/view.php?id=${COURSE_ID}` } });
      bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !hasValidSignature(bytes, fileName, contentType)) throw new Error(`invalid-download status=${response.status} type=${contentType} bytes=${bytes.length}`);
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
      return local ? `<div class="localized-ispring"><iframe src="${escapeAttr(local)}" width="1500" height="600" frameborder="0" scrolling="auto" loading="lazy" allowfullscreen="allowfullscreen"></iframe></div>` : "";
    }
    if (/welcome\.hexstruct\.com|h5p_embed|\/h5p\//i.test(src)) return "";
    return full;
  });
  body = body.replace(/\s(?:href|src|poster)=["']([^"']+)["']/gi, (full, rawUrl) => {
    const absolute = new URL(decodeEntities(rawUrl), BASE_URL).toString();
    if (attachmentMap.has(absolute)) return full.replace(rawUrl, attachmentMap.get(absolute));
    if (/^(?:https?:)?\/\//i.test(rawUrl) || rawUrl.startsWith("/") || rawUrl.startsWith("view.php") || rawUrl.startsWith("mod/")) return "";
    return full;
  });
  body = body.replace(/\s(?:onclick|data-region|data-id|aria-describedby)=["'][^"']*["']/gi, "");
  body = body.replace(/https?:\/\/(?:34\.30\.231\.58|www\.esunnybrook\.com|welcome\.hexstruct\.com|hexstruct\.ispring\.com)[^\s<"]*/gi, "");
  body = body.replace(/\b(?:Completion requirements|Make a submission|Grade|Previous Activity|Next Activity)\b/gi, "");
  return body.trim();
}

function localIspringHref(context = {}) {
  const unit = Number(context.unit || 0);
  const lesson = Number(context.lesson || 0);
  if (!unit || !lesson || !context.pageRel) return "";
  const lessonId = `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`;
  const sectionRel = `ispring-localized/unit-${String(unit).padStart(2, "0")}/${lessonId}-${ispringSectionSlug(context.section)}/presentation.html`;
  if (existsSync(join(COURSE_ROOT, sectionRel))) return relativeHref(context.pageRel, sectionRel);
  const rel = `ispring-localized/unit-${String(unit).padStart(2, "0")}/${lessonId}/presentation.html`;
  if (!existsSync(join(COURSE_ROOT, rel))) return "";
  return relativeHref(context.pageRel, rel);
}

function ispringSectionSlug(value) {
  return String(value || "ispring").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "ispring";
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
    .content img, .content video { display: block; height: auto; max-width: 100%; }
    .localized-ispring { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
    .localized-ispring iframe { border: 0; display: block; height: min(72vh, 760px); min-height: 640px; width: 100%; }
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
  for (const url of extractUrls(context.sourceHtml || htmlValue)) {
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

function hasMeaningfulResource(item) {
  if (!item) return false;
  if ((item.attachments || []).length > 0) return true;
  const text = String(item.textPreview || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const label = String(item.label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^${label}\\s*(?:View all submissions)?\\s*$`, "i").test(text)) return false;
  if (/^View all submissions$/i.test(text)) return false;
  return true;
}

function parseActivityUrl(url) {
  const parsed = new URL(url, BASE_URL);
  const mod = /\/mod\/([^/]+)\//i.exec(parsed.pathname)?.[1] || "";
  const id = parsed.searchParams.get("id") || "";
  return { mod, id };
}

function extractMainContent(html) {
  const region = /<section\b[^>]*\bid=["']region-main["'][^>]*>([\s\S]*?)<\/section>/i.exec(html)?.[1];
  const roleMain = /<div[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|$)/i.exec(html)?.[1];
  return roleMain || region || html;
}

async function localizeActivity(link) {
  const { mod, id } = parseActivityUrl(link.href);
  if (!mod || !id || /Exit Card/i.test(link.text || "") || mod === "h5pactivity") return null;
  const key = `${mod}:${id}`;
  if (activityCache.has(key)) return activityCache.get(key);
  const title = (link.text || `${mod} ${id}`).trim();
  const relDir = toPosix(join("localized-moodle-activities", mod, `${mod}-${id}-${slug(title)}`));
  try {
    const response = await request(link.href);
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const main = extractMainContent(html);
    const pageRel = toPosix(join(relDir, "index.html"));
    const localized = await localizeHtmlAssets(main, toPosix(join(relDir, "files")), pageRel, { activityId: id, title, sourceHtml: html });
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
  if (/answer/i.test(title)) return "answer_key";
  return mod === "forum" ? "discussion" : "moodle_activity";
}

function inferTeacherUse(title) {
  if (/answer/i.test(title)) return "teacher_reference";
  if (/assignment|dropbox|final|culminating|quiz|test|lab/i.test(title)) return "assessment_preparation";
  if (/learning log|kwl|reflection/i.test(title)) return "student_tracking_template";
  return "course_instruction";
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
      return new RegExp(`\\bUnit\\s*${unitNo}\\b|\\bU\\s*${unitNo}\\s*L\\s*\\d+\\b`, "i").test(link.text || "");
    });
  }
  if (sectionNo === 6) return links.filter((link) => /Culminating|Learning Log/i.test(link.text || ""));
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

async function buildBookSections(unitNo) {
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
        textPreview: textPreview(localized.html),
      });
    }
    lessons.push({ unitNo, lessonNo, lessonTitle, lessonPath, bookSections, downloads: uniqueResources(downloads).map(maybePreviewPath) });
  }
  return { bookId: raw.bookId, lessons, rawPageCount: raw.lessons?.reduce((sum, lesson) => sum + (lesson.sections?.length || 0), 0) || 0 };
}

function sanitizeLessonTitle(title, lessonNo) {
  return String(title || `Lesson ${lessonNo}`).replace(new RegExp(`^\\s*Lesson\\s*${lessonNo}\\s*[:：]?\\s*`, "i"), "").trim() || `Lesson ${lessonNo}`;
}

function iSpringForLesson(unitNo, lessonNo) {
  const lessonId = `U${String(unitNo).padStart(2, "0")}L${String(lessonNo).padStart(2, "0")}`;
  const unitRel = `ispring-localized/unit-${String(unitNo).padStart(2, "0")}`;
  const unitDir = join(COURSE_ROOT, unitRel);
  const sectionOrder = new Map([["lesson", 1], ["hands-on", 2], ["consolidation", 3]]);
  if (existsSync(unitDir)) {
    const sectionPackages = readdirSync(unitDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${lessonId}-`))
      .map((entry) => {
        const rel = `${unitRel}/${entry.name}/presentation.html`;
        const abs = join(COURSE_ROOT, rel);
        if (!existsSync(abs)) return null;
        const section = entry.name.slice(lessonId.length + 1);
        return {
          label: `${COURSE} ${lessonId} ${section.replace(/-/g, " ")} iSpring`,
          sectionLabel: section.replace(/-/g, " "),
          type: "ispring",
          category: "ispring",
          role: "lesson_ispring",
          mode: "page",
          path: rel,
          packagePath: posix.dirname(rel),
          bytes: statSync(abs).size,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (sectionOrder.get(ispringSectionSlug(a.sectionLabel)) || 99) - (sectionOrder.get(ispringSectionSlug(b.sectionLabel)) || 99) || a.path.localeCompare(b.path));
    if (sectionPackages.length) return sectionPackages;
  }
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
    else if (new RegExp(`Unit\\s+${unitNo}\\s+-\\s+Lesson\\s+\\d+\\s*$|\\bU\\s*${unitNo}\\s*L\\s*\\d+\\b`, "i").test(item.label || "")) buckets.lessonDropboxes.push(item);
    else if (/forum/i.test(item.mod || item.category)) buckets.discussions.push(item);
  }
  return buckets;
}

function attachHomeworkDownloadsToDropboxes(unitNo, unitResources, lessons) {
  const resourceKeys = (item) => {
    const keys = [];
    if (item?.path) keys.push(toPosix(item.path).toLowerCase());
    if (item?.downloadPath) keys.push(toPosix(item.downloadPath).toLowerCase());
    if (item?.label) keys.push(String(item.label).trim().toLowerCase());
    return keys;
  };
  for (const lesson of lessons || []) {
    const homeworkDownloads = (lesson.downloads || []).filter((item) => String(item.path || "").includes("/book_sections/files/05-homework/"));
    if (!homeworkDownloads.length) continue;

    const homeworkSection = (lesson.bookSections || []).find((item) => String(item.sectionLabel || "").toLowerCase() === "homework");
    if (homeworkSection) {
      const sectionExisting = new Set((homeworkSection.attachments || []).flatMap(resourceKeys));
      const sectionAdditions = homeworkDownloads.filter((item) => resourceKeys(item).every((key) => !sectionExisting.has(key)));
      if (sectionAdditions.length) homeworkSection.attachments = [...(homeworkSection.attachments || []), ...sectionAdditions];
    }

    const dropbox = (unitResources.lessonDropboxes || []).find((item) => {
      return new RegExp(`\\bUnit\\s+${unitNo}\\s+-\\s+Lesson\\s+${lesson.lesson}\\b|\\bU\\s*${unitNo}\\s*L\\s*${lesson.lesson}\\b`, "i").test(item.label || "");
    });
    if (!dropbox) continue;
    const existing = new Set((dropbox.attachments || []).flatMap(resourceKeys));
    const additions = homeworkDownloads.filter((item) => resourceKeys(item).every((key) => !existing.has(key)));
    if (additions.length) dropbox.attachments = [...(dropbox.attachments || []), ...additions];
  }
  return unitResources;
}

function textResources() {
  const unit2Texts = [
    ["fireflies", "Fireflies", "Faith Cormier", "U02L01", "ispring-localized/unit-02/U02L01", "Unit 2/Lesson 1 - Fireflies by Faith Cormier/book_sections/files/05-homework/7e1bdd7d01-Unit 2 - Lesson 1 - Fireflies by Faith Cormier Homework Handout.docx"],
    ["sorry-sheep", "Sorry, Sheep", "Guy Belleranti", "U02L02", "ispring-localized/unit-02/U02L02", "Unit 2/Lesson 2 - Sorry, Sheep By Guy Belleranti/book_sections/files/05-homework/8f65801c79-Unit 2 - Lesson 2 - Sorry, Sheep By Guy Belleranti Homework Handout.docx"],
    ["whats-the-deal-with-mold", "What's the Deal with Mold", "Lydia Lukidis", "U02L03", "ispring-localized/unit-02/U02L03", "Unit 2/Lesson 3 - What's the Deal with Mold by Lydia Lukidis/book_sections/files/05-homework/79232c0685-Unit 2 - Lesson 3 - What_s the Deal with Mold by Lydia Lukidis Homework Handout.docx"],
    ["how-lewis-discovered-alice", "How Lewis Discovered Alice", "Kimberly M. Hutmacher", "U02L04", "ispring-localized/unit-02/U02L04", "Unit 2/Lesson 4 - How Lewis Discovered Alice by Kimberly M. Hutmacher/book_sections/files/05-homework/42a3c3f529-Unit 2 - Lesson 4 - How Lewis Discovered Alice by Kimberly M. Hutmacher Homework Handout.docx"],
    ["medicine-woman", "Medicine Woman", "Patricia McCord", "U02L05", "ispring-localized/unit-02/U02L05", "Unit 2/Lesson 5 - Medicine Woman By Patricia McCord/book_sections/files/05-homework/ea4ca77a38-Unit 2 - Lesson 5 - Medicine Woman By Patricia McCord Homework Handout.docx"],
    ["leaving-her-mark", "Leaving Her Mark: A True Story", "Liana Mahoney", "U02L06", "ispring-localized/unit-02/U02L06", "Unit 2/Lesson 6 - Leaving Her Mark A True Story, Retold by Liana Mahoney/book_sections/files/05-homework/ab713efa65-Unit 2 - Lesson 6 - Leaving Her Mark A True Story, Retold by Liana Mahoney Homework Handout.docx"],
    ["worlds-largest-seal", "World's Largest Seal", "Guy Belleranti", "U02L07", "ispring-localized/unit-02/U02L07", "Unit 2/Lesson 7 - World_s Largest Seal by Guy Belleranti/book_sections/files/05-homework/5edbccab8b-Unit 2 - Lesson 7 - World_s Largest Seal by Guy Belleranti Homework Handout.docx"],
  ];

  const texts = unit2Texts.map(([id, title, author, lessonId, packagePath, handoutPath]) => {
    const textPage = buildExtractedIspringTextPage({ id, title, author, lessonId, packagePath, handoutPath });
    return {
      id,
      title,
      author,
      type: "short_adapted_text",
      units: [2],
      lessons: [lessonId],
      copyrightStatus: "moodle_course_material",
      sourceStatus: "localized_from_moodle",
      notes: "Reading text content extracted from the localized ESLAO Moodle iSpring lesson package; the original Moodle homework handout is retained as supporting material.",
      materials: [
        htmlTextMaterial(`${title} - extracted reading text`, textPage),
        fileTextMaterial(`${title} - homework handout.docx`, "docx", handoutPath, docxPreviewPath(handoutPath)),
      ],
    };
  });

  texts.push({
    id: "disney-cinderella",
    title: "Disney Cinderella",
    author: "Disney",
    type: "adapted_story_pdf",
    units: [5],
    lessons: ["culminating"],
    copyrightStatus: "moodle_course_material",
    sourceStatus: "localized_from_moodle",
    notes: "Culminating text/material downloaded from the ESLAO Moodle Culminating Assignment Dropbox.",
    materials: [
      fileTextMaterial(
        "Disney Cinderella.pdf",
        "pdf",
        "localized-moodle-activities/assign/assign-8387-Culminating-Assignment-Dropbox/files/b2e6449ba8-Disney Cinderella.pdf",
      ),
      fileTextMaterial(
        "ESLAO - Culminating Activity.docx",
        "docx",
        "localized-moodle-activities/assign/assign-8387-Culminating-Assignment-Dropbox/files/a040b2bcad-ESLAO - Culminating Activity.docx",
        "previews-html/localized-moodle-activities/assign/assign-8387-Culminating-Assignment-Dropbox/files/a040b2bcad-ESLAO - Culminating Activity.docx.html",
      ),
    ],
  });

  return texts;
}

function htmlTextMaterial(label, path) {
  const abs = join(COURSE_ROOT, path);
  return {
    label,
    type: "html",
    category: "text_material",
    role: "reading_text",
    path,
    bytes: existsSync(abs) ? statSync(abs).size : 0,
  };
}

function buildExtractedIspringTextPage({ id, title, author, lessonId, packagePath, handoutPath }) {
  const pageRel = `texts/eslao-unit-2/${id}/index.html`;
  const slides = extractIspringSlideText(packagePath);
  const body = [
    `<p><strong>${escapeHtml(title)}</strong>${author ? ` by ${escapeHtml(author)}` : ""}</p>`,
    `<p>This page contains text extracted from the localized Moodle iSpring lesson package for ${escapeHtml(lessonId)}.</p>`,
    ...slides.map((slide) => {
      const paragraphs = slide.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
      return `<section><h2>Slide ${slide.slide}</h2>${paragraphs}</section>`;
    }),
  ].join("\n");
  const attachments = existsSync(join(COURSE_ROOT, handoutPath))
    ? [fileTextMaterial(`${title} - homework handout.docx`, "docx", handoutPath, docxPreviewPath(handoutPath))]
    : [];
  const html = renderPage(`${title} - Extracted Reading Text`, body, attachments, pageRel);
  const abs = join(COURSE_ROOT, pageRel);
  ensureDir(dirname(abs));
  writeFileSync(abs, html, "utf8");
  return pageRel;
}

function extractIspringSlideText(packagePath) {
  const dataDir = join(COURSE_ROOT, packagePath, "data");
  if (!existsSync(dataDir)) return [];
  return readdirSync(dataDir)
    .filter((name) => /^slide\d+\.js$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .map((name) => {
      const slide = Number(name.match(/\d+/)?.[0] || 0);
      const js = readFileSync(join(dataDir, name), "utf8");
      const match = js.match(/loadHandler&&loadHandler\(\d+,\s*'([\s\S]*?)',\s*'\{"s":/);
      const html = decodeJsString(match?.[1] || "");
      const lines = [...html.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
        .map((item) => decodeEntities(item[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
        .filter(isMeaningfulSlideText);
      return { slide, lines: compactSlideLines(lines) };
    })
    .filter((slide) => slide.lines.length);
}

function decodeJsString(value) {
  return String(value || "")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function isMeaningfulSlideText(value) {
  if (!value) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^[_\-\s]+$/.test(value)) return false;
  if (/^(Minds On|Hands On|Consolidation|Resources|Presenter Info)$/i.test(value)) return false;
  return true;
}

function compactSlideLines(lines) {
  const compact = [];
  for (const line of lines) {
    if (compact[compact.length - 1] === line) continue;
    compact.push(line);
  }
  return compact;
}

function docxPreviewPath(path) {
  return `previews-html/${sanitizePreviewSourcePath(path)}.html`;
}

function sanitizePreviewSourcePath(path) {
  return toPosix(path).replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._/\- ]+/g, "_");
}

function fileTextMaterial(label, type, path, previewPath = path) {
  const abs = join(COURSE_ROOT, path);
  const material = {
    label,
    type,
    category: "text_material",
    role: "core_text",
    path,
    bytes: existsSync(abs) ? statSync(abs).size : 0,
    previewPath,
  };
  if (type !== "html") material.downloadPath = path;
  return material;
}

function curriculumGuideResources() {
  return [];
}

async function main() {
  ensureDir(COURSE_ROOT);
  await login();

  const courseOverview = await buildCourseSection(1, "Course Overview", "course-sections/course-overview", "course_overview");
  const culminatingSection = await buildCourseSection(6, "Culminating", "course-sections/culminating", "culminating");

  const localizedActivities = [];
  for (const sectionNo of [1, 2, 3, 4, 5, 6]) {
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
    const lessons = book.lessons.map((lesson) => ({
      id: `U${String(unitNo).padStart(2, "0")}L${String(lesson.lessonNo).padStart(2, "0")}`,
      unit: unitNo,
      lesson: lesson.lessonNo,
      title: lesson.lessonTitle,
      path: lesson.lessonPath,
      bookPageCount: lesson.bookSections.length,
      lessonText: [],
      textExports: [],
      lessonPlan: null,
      ispring: iSpringForLesson(unitNo, lesson.lessonNo),
      downloads: lesson.downloads,
      bookSections: lesson.bookSections,
      resourceCounts: {
        downloads: lesson.downloads.length,
        bookSections: lesson.bookSections.length,
        ispring: iSpringForLesson(unitNo, lesson.lessonNo).length,
      },
    }));
    const unitResources = attachHomeworkDownloadsToDropboxes(unitNo, categorizeUnitActivity(unitNo, unitActivities), lessons);
    units.push({
      unit: unitNo,
      title: UNIT_TITLES[unitNo],
      coreTexts: [],
      unitPlan: null,
      unitResources,
      lessons,
      summary: {
        lessons: lessons.length,
        bookSections: lessons.reduce((sum, lesson) => sum + lesson.bookSections.length, 0),
        downloads: lessons.reduce((sum, lesson) => sum + lesson.downloads.length, 0),
        ispring: lessons.reduce((sum, lesson) => sum + lesson.ispring.length, 0),
      },
    });
  }

  const courseDownloads = [
    activityById.get("8310"),
    activityById.get("8311"),
    activityById.get("8387"),
  ].filter(hasMeaningfulResource);
  const teacherResources = uniqueByPath([
    ...localizedActivities.filter((item) => /\bAnswer\b/i.test(item.label || "")),
    ...localizedActivities.filter((item) => /\b(AOL|Quiz|Test|Lab|Assignment|Exam|Culminating)\b/i.test(item.label || "")),
  ].filter(hasMeaningfulResource).map((item) => ({ ...item, teacherOnly: item.teacherOnly || /\bAnswer\b/i.test(item.label || "") })));
  const courseSections = [courseOverview, culminatingSection].filter(hasMeaningfulResource);

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    course: {
      code: COURSE,
      title: "ESLAO · English as a Second Language, ESL Level 1, Open",
      audience: "Teachers preparing OSSD lessons",
      source: "St. Mary Moodle course id 50",
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
      h5pExternalEmbedsPending: pendingMedia.filter((item) => item.kind === "h5p").length,
      h5pActivityExitCardsExcluded: 0,
      downloadFailures,
      note: "External H5P embeds are not displayed because local .h5p packages were not available. Lesson iSpring embeds are represented by local mirrored packages only.",
    },
    navigation: { primary: "unit", secondary: "lesson" },
    courseDownloads,
    texts: textResources(),
    units,
    courseSections,
    teacherResources,
    evaluations: localizedActivities.filter((item) => /\b(AOL|Quiz|Test|Lab|Assignment|Exam|Culminating)\b/i.test(item.label || "")),
  };

  writeFileSync(join(COURSE_ROOT, "course-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    course: COURSE,
    courseDownloads: courseDownloads.length,
    localizedActivities: localizedActivities.length,
    units: units.length,
    lessons: manifest.sourceAudit.lessonCount,
    ispringComplete: manifest.sourceAudit.ispringComplete,
    h5pPending: manifest.sourceAudit.h5pExternalEmbedsPending,
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
