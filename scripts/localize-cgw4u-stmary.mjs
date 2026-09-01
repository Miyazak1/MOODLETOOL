import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const COURSE = "CGW4U";
const COURSE_ID = 45;
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const SECTION_DIR = resolve(REPO_ROOT, "inbox", "cgw4u-stmary-sections");
const BOOK_DIR = resolve(REPO_ROOT, "inbox", "cgw4u-stmary-books-crawled");
const INITIAL_BOOK_DIR = resolve(REPO_ROOT, "inbox", "cgw4u-stmary-books");

const UNIT_TITLES = {
  1: "World Issues, World Views",
  2: "Interdependence & Inequality",
  3: "Conflict & Cooperation",
  4: "Towards a Sustainable World",
};

const COURSE_ACTIVITY_ROLES = new Map([
  ["7605", { role: "course_outline", teacherUse: "course_planning" }],
  ["7607", { role: "learning_log", teacherUse: "student_tracking_template" }],
  ["7862", { role: "culminating_submission", teacherUse: "assessment_preparation" }],
  ["7864", { role: "final_exam_submission", teacherUse: "assessment_preparation" }],
  ["7917", { role: "answer_keys", teacherUse: "teacher_reference", teacherOnly: true }],
]);

const EVALUATION_IDS = new Set([
  "7619",
  "7620",
  "7621",
  "7668",
  "7679",
  "7681",
  "7736",
  "7739",
  "7742",
  "7823",
  "7826",
  "7827",
]);

const REFLECTION_RE = /\b(KWL|Reflection Summary|Learning Log)\b/i;
const LESSON_DROPBOX_RE = /Unit\s+\d+\s*-\s*Lesson\s+\d+$/i;
const ANSWER_RE = /\(Answer\)/i;
const SKIP_ACTIVITY_RE = /Exit Card/i;

loadEnv();

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  store(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      for (const part of String(value).split(/,(?=\s*[^;,]+=)/g)) {
        const pair = part.split(";")[0];
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
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value || "http://34.30.231.58").trim().replace(/\/+$/, "");
  return raw.replace(/\/login\/index\.php$/i, "");
}

const BASE_URL = normalizeBaseUrl(process.env.STMARY_MOODLE_BASE_URL);

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-cgw4u-localizer/1.0");
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
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) {
    throw new Error("St. Mary Moodle login did not complete");
  }
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
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "tif", "tiff"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
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
  if ([".svg"].includes(ext)) return /<svg\b/i.test(bytes.subarray(0, 2048).toString("utf8"));
  if ([".mp4", ".m4v", ".mov"].includes(ext)) return bytes.subarray(4, 12).toString("latin1").includes("ftyp") || /video\//i.test(contentType);
  if ([".txt", ".csv", ".html", ".htm"].includes(ext)) return true;
  if ([".tif", ".tiff"].includes(ext)) return ascii.startsWith("II*\x00") || ascii.startsWith("MM\x00*");
  return bytes.length > 0;
}

function maybePreviewPath(resource) {
  if (!resource?.path) return resource;
  const ext = extname(resource.path).toLowerCase();
  if (ext === ".docx" || ext === ".h5p") {
    const previewPath = `previews-html/${sanitizePreviewPath(resource.path)}.html`;
    if (existsSync(join(COURSE_ROOT, previewPath))) resource.previewPath = toPosix(previewPath);
  } else if (ext === ".pdf" || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".tif", ".tiff"].includes(ext)) {
    resource.previewPath = resource.path;
  }
  return resource;
}

function sanitizePreviewPath(value) {
  return toPosix(value).replace(/[^A-Za-z0-9._/\- ]+/g, "_").replace(/\\/g, "/");
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
      const response = await request(absoluteUrl, {
        headers: { referer: `${BASE_URL}/course/view.php?id=${COURSE_ID}` },
      });
      bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !hasValidSignature(bytes, fileName, contentType)) {
        throw new Error(`invalid-download status=${response.status} type=${contentType} bytes=${bytes.length}`);
      }
      writeFileSync(targetAbs, bytes);
    }
    const resource = {
      label: fileName,
      type: typeFromPath(fileName),
      category: "moodle_file",
      role: "attachment",
      path: targetRel,
      bytes: bytes.length,
      source: absoluteUrl,
    };
    if (!["mp4", "m4v", "mov"].includes(resource.type)) resource.downloadPath = targetRel;
    maybePreviewPath(resource);
    downloadCache.set(absoluteUrl, resource);
    return resource;
  } catch (error) {
    downloadFailures.push({ url: absoluteUrl, targetRel, reason: String(error.message || error) });
    downloadCache.set(absoluteUrl, null);
    return null;
  }
}

function extractUrls(htmlValue) {
  const urls = new Set();
  const attrRe = /\s(?:href|src|poster)=["']([^"']+)["']/gi;
  let match;
  while ((match = attrRe.exec(htmlValue))) urls.add(decodeEntities(match[1]));
  return [...urls];
}

function isDownloadableMoodleUrl(url) {
  if (!url) return false;
  const absolute = new URL(url, BASE_URL).toString();
  if (new URL(absolute).host !== new URL(BASE_URL).host) return false;
  if (!/\/(?:pluginfile|draftfile)\.php\//i.test(absolute)) return false;
  if (/\/theme\/|\/icon\b/i.test(absolute)) return false;
  return true;
}

function pendingExternalMedia(url, context) {
  const absolute = String(url || "");
  if (/hexstruct\.ispring\.com/i.test(absolute)) {
    pendingMedia.push({ kind: "ispring", url: absolute, ...context });
  } else if (/welcome\.hexstruct\.com|h5p_embed|\/h5p\//i.test(absolute)) {
    pendingMedia.push({ kind: "h5p", url: absolute, ...context });
  } else if (/youtube\.com|youtu\.be|vimeo\.com/i.test(absolute)) {
    pendingMedia.push({ kind: "external_video", url: absolute, ...context });
  }
}

function cleanHtmlFragment(htmlValue, linkMap = new Map(), attachmentMap = new Map(), context = {}) {
  let body = String(htmlValue || "");
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  body = body.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  body = body.replace(/<form\b[\s\S]*?<\/form>/gi, "");
  body = body.replace(/<nav\b[\s\S]*?<\/nav>/gi, "");
  body = body.replace(/<div[^>]*class=["'][^"']*(?:navigation-arrows|navtop|navbottom|region_main_settings_menu_proxy|notifications|availabilityinfo|activity-information)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  body = body.replace(/<span[^>]*id=["']maincontent["'][^>]*><\/span>/gi, "");
  body = body.replace(/<img[^>]+src=["'][^"']*\/theme\/image\.php[^"']*["'][^>]*>/gi, "");
  for (const url of extractUrls(body)) pendingExternalMedia(url, context);

  body = body.replace(/<iframe\b[^>]*(?:hexstruct\.ispring\.com|welcome\.hexstruct\.com|h5p_embed)[^>]*><\/iframe>/gi, '<div class="portal-note">Interactive media pending local package; external playback was not embedded.</div>');
  body = body.replace(/\s(?:href|src|poster)=["']([^"']+)["']/gi, (full, rawUrl) => {
    const url = decodeEntities(rawUrl);
    const absolute = new URL(url, BASE_URL).toString();
    if (attachmentMap.has(absolute)) return full.replace(rawUrl, attachmentMap.get(absolute));
    if (linkMap.has(absolute)) return full.replace(rawUrl, linkMap.get(absolute));
    if (/^(?:https?:)?\/\//i.test(url) || url.startsWith("/") || url.startsWith("view.php") || url.startsWith("mod/")) {
      return "";
    }
    return full;
  });
  body = body.replace(/\s(?:onclick|data-region|data-id|aria-describedby)=["'][^"']*["']/gi, "");
  body = body.replace(/https?:\/\/(?:34\.30\.231\.58|www\.esunnybrook\.com|www\.hexstruct\.com|hexstruct\.ispring\.com)[^\s<"]*/gi, "");
  return body.trim();
}

function renderPage(title, bodyHtml, attachments = [], subtitle = "", pageRel = "index.html") {
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
    .subtitle { color: #526681; font-size: 13px; margin-bottom: 18px; overflow-wrap: anywhere; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; max-width: 100%; }
    .content iframe { max-width: 100%; }
    .content table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
    .content td, .content th { border: 1px solid #d6e2f0; padding: 8px 10px; }
    .portal-note { background: #fff7ed; border: 1px solid #fdba74; border-radius: 6px; color: #7c2d12; margin: 12px 0; padding: 10px 12px; }
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
  const viewPath = item.previewPath || item.path;
  const canDownload = !["mp4", "m4v", "mov"].includes(String(item.type || "").toLowerCase());
  const downloadButton = canDownload ? `<a class="button" href="${escapeAttr(relativeHref(pageRel, item.downloadPath || item.path))}" download>Download</a>` : "";
  return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${escapeAttr(relativeHref(pageRel, viewPath))}">View</a>${downloadButton}</div></div>`;
}

function relativeHref(fromRel, toRel) {
  const fromDir = dirname(toPosix(fromRel));
  return toPosix(relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function extractMainContent(htmlValue) {
  const html = String(htmlValue || "");
  const roleMain = /<div[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|$)/i.exec(html);
  if (roleMain) return roleMain[1];
  const section = /<li[^>]+id=["']section-\d+["'][^>]*>([\s\S]*?)<\/li>/i.exec(html);
  if (section) return section[1];
  const bookContent = /<div[^>]+class=["'][^"']*book_content[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<div class=["']navbottom|$)/i.exec(html);
  if (bookContent) return bookContent[1];
  return html;
}

function extractSectionContent(sectionJson) {
  const html = sectionJson.html || "";
  const li = new RegExp(`<li[^>]+id=["']section-${sectionJson.section}["'][^>]*>([\\s\\S]*?)<\\/li>`, "i").exec(html);
  const fragment = li?.[1] || extractMainContent(html);
  return fragment;
}

async function localizeHtmlAssets(htmlValue, targetRelDir, pageRel, context = {}) {
  const attachmentMap = new Map();
  const attachments = [];
  for (const url of extractUrls(htmlValue)) {
    if (!isDownloadableMoodleUrl(url)) continue;
    const resource = await downloadResource(url, targetRelDir, fileNameFromUrl(url));
    if (!resource) continue;
    const abs = new URL(decodeEntities(url), BASE_URL).toString();
    const href = relativeHref(pageRel, resource.previewPath || resource.path);
    attachmentMap.set(abs, href);
    attachments.push(resource);
  }
  return {
    html: cleanHtmlFragment(htmlValue, new Map(), attachmentMap, context),
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

async function localizeActivity(link) {
  const { mod, id } = parseActivityUrl(link.href);
  if (!mod || !id || SKIP_ACTIVITY_RE.test(link.text || "")) return null;
  const key = `${mod}:${id}`;
  if (activityCache.has(key)) return activityCache.get(key);
  const title = (link.text || `${mod} ${id}`).trim();
  const relDir = toPosix(join("localized-moodle-activities", mod, `${mod}-${id}-${slug(title)}`));
  try {
    const response = await request(link.href);
    const html = await response.text();
    const main = extractMainContent(html);
    const pageRel = toPosix(join(relDir, "index.html"));
    const localized = await localizeHtmlAssets(main, toPosix(join(relDir, "files")), pageRel, { activityId: id, title });
    const pageHtml = renderPage(title, localized.html, localized.attachments, link.href, pageRel);
    const pageAbs = join(COURSE_ROOT, pageRel);
    ensureDir(dirname(pageAbs));
    writeFileSync(pageAbs, pageHtml, "utf8");
    const roleInfo = COURSE_ACTIVITY_ROLES.get(id) || {};
    const item = {
      label: title,
      type: "html",
      category: `moodle_${mod}`,
      role: roleInfo.role || inferActivityRole(title, mod),
      path: pageRel,
      bytes: Buffer.byteLength(pageHtml, "utf8"),
      source: link.href,
      moodleActivityId: id,
      mod,
      teacherUse: roleInfo.teacherUse || inferTeacherUse(title),
      attachments: localized.attachments.map(maybePreviewPath),
      textPreview: textPreview(localized.html),
    };
    if (roleInfo.teacherOnly || ANSWER_RE.test(title)) item.teacherOnly = true;
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
  if (/final exam/i.test(title)) return "final_exam";
  if (/assignment/i.test(title)) return "evaluation";
  if (/reflection|kwl/i.test(title)) return "reflection_learning_log";
  if (/answer/i.test(title)) return "answer_key";
  return mod === "forum" ? "discussion" : "moodle_activity";
}

function inferTeacherUse(title) {
  if (/answer/i.test(title)) return "teacher_reference";
  if (/assignment|dropbox|final|culminating/i.test(title)) return "assessment_preparation";
  if (/learning log|kwl|reflection/i.test(title)) return "student_tracking_template";
  return "course_instruction";
}

function sectionLinks(sectionJson) {
  const seen = new Set();
  return (sectionJson.links || []).filter((link) => {
    if (!link?.href || !/\/mod\/(assign|page|forum|quiz)\//i.test(link.href)) return false;
    const { id, mod } = parseActivityUrl(link.href);
    if (!id || mod === "h5pactivity") return false;
    const key = `${mod}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !SKIP_ACTIVITY_RE.test(link.text || "");
  });
}

function sectionPluginLinks(sectionJson) {
  return (sectionJson.links || []).filter((link) => isDownloadableMoodleUrl(link.href));
}

function extractLessonNo(title) {
  return Number(/Lesson\s*(\d+)/i.exec(title || "")?.[1] || 0);
}

function sectionLabel(page, indexInLesson) {
  let label = (page.tocText || "").replace(/^Next:\s*/i, "").trim();
  if (/^Lesson\s+\d+/i.test(label)) label = "Lesson Expectations";
  if (!label || /^Lesson$/i.test(label)) label = indexInLesson === 0 ? "Lesson Expectations" : "Lesson";
  label = label.replace(/^Consoldation$/i, "Consolidation");
  return label;
}

function lessonSafeTitle(title) {
  return title.replace(/^\s*Lesson\s*\d+\s*:?\s*/i, "").trim() || title;
}

async function buildBookSections(unitNo) {
  const crawled = readJson(join(BOOK_DIR, `unit-${String(unitNo).padStart(2, "0")}-book.json`));
  const initialPath = join(INITIAL_BOOK_DIR, `unit-${String(unitNo).padStart(2, "0")}-book.json`);
  const pages = [];
  if (existsSync(initialPath)) {
    const initial = readJson(initialPath);
    const initialPage = initial.pages?.[0];
    if (initialPage) {
      pages.push({
        ...initialPage,
        title: stripTags(/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(initialPage.html || "")?.[1] || `Lesson 1`),
        tocText: "Lesson Expectations",
        url: `${BASE_URL}/mod/book/view.php?id=${crawled.bookId}`,
        chapterid: `intro-${crawled.bookId}`,
      });
    }
  }
  pages.push(...(crawled.pages || []));

  const grouped = new Map();
  for (const page of pages) {
    const lessonNo = extractLessonNo(page.title || page.tocText);
    if (!lessonNo) continue;
    if (!grouped.has(lessonNo)) grouped.set(lessonNo, []);
    grouped.get(lessonNo).push(page);
  }

  const lessons = [];
  for (const [lessonNo, lessonPages] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    const firstTitle = lessonPages.find((p) => p.title)?.title || `Lesson ${lessonNo}`;
    const lessonTitle = lessonSafeTitle(firstTitle);
    const lessonPath = `Unit ${unitNo}/Lesson ${lessonNo} - ${sanitizeSegment(lessonTitle)}`;
    const bookSections = [];
    const downloads = [];
    let sectionIndex = 1;
    for (const page of lessonPages) {
      const label = sectionLabel(page, sectionIndex - 1);
      const fileName = `${String(sectionIndex).padStart(2, "0")}-${slug(label).toLowerCase()}.html`;
      const pageRel = toPosix(join(lessonPath, "book_sections", fileName));
      const assetRelDir = toPosix(join(lessonPath, "book_sections", "files", `${String(sectionIndex).padStart(2, "0")}-${slug(label).toLowerCase()}`));
      const localized = await localizeHtmlAssets(page.html || "", assetRelDir, pageRel, { unit: unitNo, lesson: lessonNo, chapterid: page.chapterid });
      downloads.push(...localized.attachments);
      const title = `${COURSE} Unit ${unitNo} Lesson ${lessonNo} - ${label}`;
      const pageHtml = renderPage(title, localized.html, localized.attachments, page.url || `${BASE_URL}/mod/book/view.php?id=${crawled.bookId}`, pageRel);
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
        source: page.url || `${BASE_URL}/mod/book/view.php?id=${crawled.bookId}`,
        textPreview: textPreview(localized.html),
      });
      sectionIndex += 1;
    }
    lessons.push({ unitNo, lessonNo, lessonTitle, lessonPath, bookSections, downloads: uniqueResources(downloads).map(maybePreviewPath) });
  }
  return { bookId: crawled.bookId, lessons, rawPageCount: pages.length, crawledPageCount: crawled.pages?.length || 0 };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function planResource(rel, label, role) {
  const abs = join(COURSE_ROOT, rel);
  if (!existsSync(abs)) return null;
  return maybePreviewPath({
    label,
    type: typeFromPath(rel),
    category: "teacher_plan",
    role,
    path: toPosix(rel),
    bytes: statSync(abs).size,
  });
}

function lessonPlan(unit, lesson) {
  const old = readJson(join(COURSE_ROOT, "course-manifest.json"));
  const item = old.units?.find((u) => u.unit === unit)?.lessons?.find((l) => l.lesson === lesson)?.lessonPlan;
  if (!item) return null;
  return maybePreviewPath({ ...item });
}

function unitPlan(unit) {
  return planResource(`plans/source/UNIT PLANS/Unit ${unit} Plan.docx`, `Unit ${unit} Plan.docx`, "plan");
}

function categorizeUnitActivity(unitActivities) {
  const buckets = {
    evaluations: [],
    reflectionAndLogs: [],
    lessonDropboxes: [],
    answerPages: [],
    discussions: [],
  };
  for (const item of unitActivities) {
    if (!item) continue;
    if (EVALUATION_IDS.has(item.moodleActivityId)) buckets.evaluations.push(item);
    else if (ANSWER_RE.test(item.label || "")) buckets.answerPages.push({ ...item, teacherOnly: true });
    else if (REFLECTION_RE.test(item.label || "")) buckets.reflectionAndLogs.push(item);
    else if (LESSON_DROPBOX_RE.test(item.label || "")) buckets.lessonDropboxes.push(item);
    else if (/forum/i.test(item.mod || item.category)) buckets.discussions.push(item);
  }
  return buckets;
}

function resourceCounts(unit, lessons) {
  const downloads = lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  const bookSections = lessons.reduce((sum, lesson) => sum + (lesson.bookSections?.length || 0), 0);
  const docx = JSON.stringify(unit).match(/"type":\s*"docx"/g)?.length || 0;
  const pdf = JSON.stringify(unit).match(/"type":\s*"pdf"/g)?.length || 0;
  const video = JSON.stringify(unit).match(/"type":\s*"mp4"/g)?.length || 0;
  return { downloads, bookSections, ispring: 0, docx, pdf, video, h5p: 0 };
}

async function buildCourseSection(sectionNo, label, relDir, role, extraAttachments = []) {
  const sectionJson = readJson(join(SECTION_DIR, `section-${String(sectionNo).padStart(2, "0")}.json`));
  const sectionFragment = extractSectionContent(sectionJson);
  const pageRel = toPosix(join(relDir, "index.html"));
  const localized = await localizeHtmlAssets(sectionFragment, toPosix(join(relDir, "files")), pageRel, { section: sectionNo, title: label });
  const attachments = uniqueResources([...localized.attachments, ...extraAttachments]).map(maybePreviewPath);
  const pageHtml = renderPage(label, localized.html, attachments, sectionJson.url, pageRel);
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
    source: sectionJson.url,
    attachments,
    textPreview: textPreview(localized.html),
  };
}

async function main() {
  await login();
  const sections = new Map();
  for (let sectionNo = 1; sectionNo <= 8; sectionNo += 1) {
    sections.set(sectionNo, readJson(join(SECTION_DIR, `section-${String(sectionNo).padStart(2, "0")}.json`)));
  }

  const allActivityLinks = [];
  for (const sectionNo of [1, 2, 3, 4, 5, 6, 8]) allActivityLinks.push(...sectionLinks(sections.get(sectionNo)));
  const activities = [];
  for (const link of allActivityLinks) {
    const item = await localizeActivity(link);
    if (item) activities.push(item);
  }
  const activityById = new Map(activities.map((item) => [item.moodleActivityId, item]));

  const finalDirectAttachments = [];
  for (const link of sectionPluginLinks(sections.get(6))) {
    const resource = await downloadResource(link.href, "course-sections/final-exam-culminating/files", link.text || "Culminating");
    if (resource) finalDirectAttachments.push(resource);
  }

  const courseOverview = await buildCourseSection(1, "Course Overview", "course-sections/course-overview", "course_overview");
  const finalSection = await buildCourseSection(6, "Final Examination & Culminating", "course-sections/final-exam-culminating", "final_examination_culminating", finalDirectAttachments);
  const teacherPacket = await buildCourseSection(8, "Teacher Packet", "course-sections/teacher-packet", "teacher_packet");

  const bookReports = [];
  const units = [];
  for (const unitNo of [1, 2, 3, 4]) {
    const book = await buildBookSections(unitNo);
    bookReports.push({ unit: unitNo, bookId: book.bookId, crawledPages: book.crawledPageCount, localizedPages: book.rawPageCount, lessons: book.lessons.length });
    const unitActivityIds = new Set(sectionLinks(sections.get(unitNo + 1)).map((link) => parseActivityUrl(link.href).id));
    const unitActivities = [...unitActivityIds].map((id) => activityById.get(id)).filter(Boolean);
    const unitResources = categorizeUnitActivity(unitActivities);
    const lessons = book.lessons.map((lesson) => ({
      id: `U${String(unitNo).padStart(2, "0")}L${String(lesson.lessonNo).padStart(2, "0")}`,
      unit: unitNo,
      lesson: lesson.lessonNo,
      title: lesson.lessonTitle,
      path: lesson.lessonPath,
      bookPageCount: lesson.bookSections.length,
      lessonText: [],
      textExports: [],
      lessonPlan: lessonPlan(unitNo, lesson.lessonNo),
      ispring: [],
      downloads: lesson.downloads,
      bookSections: lesson.bookSections,
      resourceCounts: {
        downloads: lesson.downloads.length,
        bookSections: lesson.bookSections.length,
        lessonPlan: lessonPlan(unitNo, lesson.lessonNo) ? 1 : 0,
      },
    }));
    const unit = {
      unit: unitNo,
      title: UNIT_TITLES[unitNo],
      coreTexts: [],
      unitPlan: unitPlan(unitNo),
      unitResources,
      lessons,
    };
    unit.summary = resourceCounts(unit, lessons);
    units.push(unit);
  }

  const courseDownloads = [
    courseOverview,
    activityById.get("7605"),
    activityById.get("7607"),
    finalSection,
    activityById.get("7862"),
    activityById.get("7864"),
    teacherPacket,
  ].filter(Boolean);

  const evaluations = activities.filter((item) => EVALUATION_IDS.has(item.moodleActivityId));
  const teacherResources = uniqueByPath([
    teacherPacket,
    activityById.get("7917"),
    ...activities.filter((item) => ANSWER_RE.test(item.label || "")),
    ...evaluations,
    activityById.get("7862"),
    activityById.get("7864"),
  ].filter(Boolean).map((item) => ({ ...item, teacherOnly: item.teacherOnly || ANSWER_RE.test(item.label || "") || item.moodleActivityId === "7917" })));

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    course: {
      code: COURSE,
      title: "CGW4U · World Issues: A Geographic Analysis",
      audience: "Teachers preparing OSSD lessons",
      source: "St. Mary Moodle course id 45 and existing legal local planning files",
    },
    sourceAudit: {
      moodleHost: BASE_URL,
      moodleCourseId: COURSE_ID,
      moodleCoursePage: `${BASE_URL}/course/view.php?id=${COURSE_ID}`,
      courseStructure: "new-moodle-v2",
      lessonCount: units.reduce((sum, unit) => sum + unit.lessons.length, 0),
      unitCount: units.length,
      bookReports,
      moodleActivityCountLocalized: activities.length,
      ispringExpected: 0,
      ispringComplete: 0,
      ispringExternalEmbedsPending: pendingMedia.filter((item) => item.kind === "ispring").length,
      h5pExternalEmbedsPending: pendingMedia.filter((item) => item.kind === "h5p").length,
      exitCardsExcluded: (sections.get(7).links || []).filter((link) => /\/mod\/h5pactivity\//i.test(link.href || "")).length,
      unmatchedLocalLessonPlans: ["plans/source/LESSON PLANS/Unit 1 World Issues, World Views/Unit 1 Lesson 7.docx"],
      downloadFailures,
      note: "External iSpring/H5P embeds were not displayed because local packages are not available yet.",
    },
    navigation: {
      primary: "unit",
      secondary: "lesson",
    },
    courseDownloads,
    texts: [],
    units,
    courseSections: [
      courseOverview,
      finalSection,
      teacherPacket,
    ],
    teacherResources,
    evaluations,
  };

  writeFileSync(join(COURSE_ROOT, "course-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  cleanupKnownBadFailedFiles();
  console.log(JSON.stringify({
    course: COURSE,
    localizedActivities: activities.length,
    units: units.length,
    lessons: manifest.sourceAudit.lessonCount,
    bookReports,
    pendingMedia: manifest.sourceAudit.ispringExternalEmbedsPending + manifest.sourceAudit.h5pExternalEmbedsPending,
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

function cleanupKnownBadFailedFiles() {
  const known = [
    "course-sections/course-overview/files/bc021190e6-Colorful-Clean-and-Simple-Classroom-Rules-and-Online-Etiquette-Education-Presentation-1-.g",
    "course-sections/course-overview/files/369f1e912b-image-4-.png",
    "course-sections/course-overview/files/90eced071f-CGW4U-LO.png",
    "course-sections/final-exam/files/2a286879c7-CGW4U-Culminating-v3.docx",
  ];
  for (const rel of known) {
    const abs = resolve(COURSE_ROOT, rel);
    if (!abs.startsWith(COURSE_ROOT) || !existsSync(abs)) continue;
    const head = readFileSync(abs).subarray(0, 32).toString("utf8").trimStart();
    if (/^<!doctype html|^<html\b/i.test(head)) rmSync(abs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
