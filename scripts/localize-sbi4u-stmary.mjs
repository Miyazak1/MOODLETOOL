import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const COURSE = "SBI4U";
const COURSE_ID = 66;
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const SECTION_DIR = resolve(REPO_ROOT, "inbox", "sbi4u-stmary-sections");
const BASE_URL = normalizeBaseUrl(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58");
const REQUEST_TIMEOUT_MS = Math.max(10000, Number(process.env.MOODLE_ACTIVITY_TIMEOUT_MS || 60000));

const UNIT_TITLES = {
  1: "Biochemistry",
  2: "Metabolic Processes",
  3: "Molecular Genetics",
  4: "Homeostasis",
  5: "Population Dynamics",
};

const COURSE_ACTIVITY_ROLES = new Map([
  ["10156", { role: "introduction", teacherUse: "course_support" }],
  ["10157", { role: "introduction", teacherUse: "course_support" }],
  ["10158", { role: "course_outline", teacherUse: "course_planning" }],
  ["10159", { role: "learning_log", teacherUse: "student_tracking_template" }],
  ["10260", { role: "final_exam_submission", teacherUse: "assessment_preparation" }],
  ["10261", { role: "culminating_submission", teacherUse: "assessment_preparation" }],
  ["10262", { role: "exam_review", teacherUse: "assessment_preparation" }],
  ["10291", { role: "answer_keys", teacherUse: "teacher_reference", teacherOnly: true }],
]);

const EVALUATION_RE = /\bAssignment\b|\bLab\b|\bTest\b|\bExam\b|Culminating/i;
const REFLECTION_RE = /\b(KWL|Reflection Summary|Learning Log)\b/i;
const LESSON_DROPBOX_RE = /Unit\s+\d+\s*-\s*Lesson\s+\d+$/i;
const ANSWER_RE = /\(Answer\)|Answer Keys/i;
const EXIT_CARD_RE = /Exit Card/i;

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
const COURSE_INTRO_ACTIVITY_IDS = new Set(["10156", "10157"]);

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

function isSubmissionOnlyActivity(title, mod, localized) {
  if (mod !== "assign" || (localized.attachments || []).length) return false;
  const normalized = textPreview(localized.html)
    .replace(new RegExp(`^${String(title || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    .replace(/\bView all submissions\b/gi, "")
    .replace(/\bDownload all submissions\b/gi, "")
    .replace(/\bMake a submission\b/gi, "")
    .replace(/\bAdd submission\b/gi, "")
    .replace(/\bSubmitted\b/gi, "")
    .replace(/\bNeeds grading\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return !normalized;
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

function fileNameFromHeaders(url, headers, fallback = "resource") {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const headerName = utfName || plainName;
  if (headerName) return sanitizeSegment(decodeURIComponent(headerName));
  return fileNameFromUrl(url, fallback);
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
  if ([".html", ".htm"].includes(ext)) return /^<!doctype html|^<html\b|<body\b|<p\b/i.test(textHead);
  if (ext === ".doc" && (ascii.startsWith("PK") || ascii.startsWith("{\\rtf") || /^<!doctype html|^<html\b/i.test(textHead))) return true;
  if (/text\/html/i.test(contentType) || /^<!doctype html|^<html\b/i.test(textHead)) return false;
  if ([".docx", ".xlsx", ".pptx", ".zip", ".h5p"].includes(ext)) return ascii.startsWith("PK") || ascii.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1");
  if ([".doc", ".xls", ".ppt"].includes(ext)) return ascii.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1");
  if (ext === ".pdf") return ascii.startsWith("%PDF");
  if (ext === ".png") return ascii.startsWith("\x89PNG");
  if (ext === ".gif") return ascii.startsWith("GIF8");
  if ([".jpg", ".jpeg"].includes(ext)) return head[0] === 0xff && head[1] === 0xd8;
  if (ext === ".svg") return /<svg\b/i.test(bytes.subarray(0, 2048).toString("utf8"));
  if ([".txt", ".csv", ".html", ".htm"].includes(ext)) return true;
  return bytes.length > 0;
}

function extractEmbeddedResourceUrl(html, pageUrl) {
  const raw =
    /\bdata-url=["']([^"']*\/pluginfile\.php[^"']+)["']/i.exec(html)?.[1] ||
    /\bhref=["']([^"']*\/pluginfile\.php[^"']+)["']/i.exec(html)?.[1];
  return raw ? new URL(decodeEntities(raw), pageUrl || BASE_URL).toString() : "";
}

function officePreviewPath(resource) {
  if (!resource?.path) return "";
  if (![".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(extname(resource.path).toLowerCase())) return "";
  return toPosix(join("previews-html", `${resource.path}.html`));
}

function maybePreviewPath(resource) {
  if (!resource?.path) return resource;
  const ext = extname(resource.path).toLowerCase();
  const officePreview = officePreviewPath(resource);
  if (officePreview) resource.previewPath = officePreview;
  else if ([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) resource.previewPath = resource.path;
  return resource;
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-sbi4u-stmary-localizer/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...options, headers, redirect: "manual", signal: options.signal || controller.signal });
    jar.store(response.headers);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
      return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
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
      downloadPath: targetRel,
    });
    downloadCache.set(absoluteUrl, resource);
    return resource;
  } catch (error) {
    console.warn(`[download-failed] ${absoluteUrl} :: ${String(error.message || error)}`);
    downloadFailures.push({ url: absoluteUrl, targetRel, reason: String(error.message || error) });
    downloadCache.set(absoluteUrl, null);
    return null;
  }
}

async function downloadDirectActivityFile(link, targetRelDir) {
  const absoluteUrl = new URL(link.href, BASE_URL).toString();
  if (downloadCache.has(absoluteUrl)) return downloadCache.get(absoluteUrl);
  const { id } = parseActivityUrl(link.href);
  try {
    const response = await request(absoluteUrl, { headers: { referer: `${BASE_URL}/course/view.php?id=${COURSE_ID}` } });
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    const fileName = fileNameFromHeaders(response.url || absoluteUrl, response.headers, link.text || "resource");
    if (/text\/html/i.test(contentType) && !extname(fileName)) {
      const embeddedUrl = extractEmbeddedResourceUrl(bytes.toString("utf8"), response.url || absoluteUrl);
      if (embeddedUrl) {
        const embedded = await downloadResource(embeddedUrl, targetRelDir, link.text || "resource");
        if (embedded) {
          const roleInfo = COURSE_ACTIVITY_ROLES.get(id) || {};
          const resource = {
            ...embedded,
            label: link.text || embedded.label,
            category: "moodle_resource",
            role: roleInfo.role || "course_support",
            source: absoluteUrl,
            originalSource: embedded.source,
            moodleActivityId: id,
            mod: "resource",
            teacherUse: roleInfo.teacherUse || "course_instruction",
            teacherOnly: roleInfo.teacherOnly || undefined,
          };
          downloadCache.set(absoluteUrl, resource);
          return resource;
        }
      }
    }
    if (!response.ok || !hasValidSignature(bytes, fileName, contentType)) throw new Error(`invalid-direct-resource status=${response.status} type=${contentType} bytes=${bytes.length}`);
    const targetRel = toPosix(join(targetRelDir, `${sha10(response.url || absoluteUrl)}-${fileName}`));
    const targetAbs = join(COURSE_ROOT, targetRel);
    ensureDir(dirname(targetAbs));
    if (!existsSync(targetAbs)) writeFileSync(targetAbs, bytes);
    const roleInfo = COURSE_ACTIVITY_ROLES.get(id) || {};
    const resource = maybePreviewPath({
      label: link.text || fileName,
      type: typeFromPath(fileName),
      category: "moodle_resource",
      role: roleInfo.role || "course_support",
      path: targetRel,
      bytes: bytes.length,
      source: absoluteUrl,
      downloadPath: targetRel,
      moodleActivityId: id,
      mod: "resource",
      teacherUse: roleInfo.teacherUse || "course_instruction",
      teacherOnly: roleInfo.teacherOnly || undefined,
    });
    downloadCache.set(absoluteUrl, resource);
    return resource;
  } catch (error) {
    console.warn(`[direct-resource-failed] ${absoluteUrl} :: ${String(error.message || error)}`);
    downloadFailures.push({ url: absoluteUrl, reason: `direct-resource-failed: ${String(error.message || error)}` });
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
  body = body.replace(/<div[^>]*class=["'][^"']*(?:navigation-arrows|navtop|navbottom|region_main_settings_menu_proxy|notifications|availabilityinfo|activity-information|completion-info|gradingsummary|fileuploadsubmissiontime|tileiconcontainer|completionhelp)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  body = body.replace(/<div[^>]*id=["'][^"']*(?:nav-drawer|message-drawer|theme_remui-drawers)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  body = body.replace(/<span[^>]*id=["']maincontent["'][^>]*><\/span>/gi, "");
  body = body.replace(/<img[^>]+src=["'][^"']*\/theme\/image\.php[^"']*["'][^>]*>/gi, "");
  for (const url of extractUrls(body)) recordExternalMedia(new URL(decodeEntities(url), BASE_URL).toString(), context);
  body = body.replace(/<iframe\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/iframe>/gi, (full, rawSrc) => {
    const src = decodeEntities(rawSrc);
    if (/welcome\.hexstruct\.com|h5p_embed|\/h5p\//i.test(src)) {
      const h5pId = /[?&]id=(\d+)/i.exec(src)?.[1] || "";
      return `<div class="portal-note"${h5pId ? ` data-h5p-id="${escapeAttr(h5pId)}"` : ""}>Interactive media pending local package; external playback was not embedded.</div>`;
    }
    if (/hexstruct\.ispring\.com/i.test(src)) return full;
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
    const url = decodeEntities(rawUrl);
    const absolute = new URL(url, BASE_URL).toString();
    if (attachmentMap.has(absolute)) return full.replace(rawUrl, attachmentMap.get(absolute));
    if (/^(?:https?:)?\/\//i.test(url) || url.startsWith("/") || url.startsWith("view.php") || url.startsWith("mod/")) return "";
    return full;
  });
  body = body.replace(/\s(?:onclick|data-region|data-id|aria-describedby)=["'][^"']*["']/gi, "");
  body = body.replace(/https?:\/\/(?:34\.30\.231\.58|www\.esunnybrook\.com|welcome\.hexstruct\.com|www\.hexstruct\.com|hexstruct\.ispring\.com)[^\s<"]*/gi, "");
  body = body.replace(/\b(?:Completion requirements|Make a submission|Previous Activity|Next Activity)\b/gi, "");
  return body.trim();
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
    .content iframe { max-width: 100%; }
    .content table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
    .content td, .content th { border: 1px solid #d6e2f0; padding: 8px 10px; }
    .portal-note { background: #fff7ed; border: 1px solid #fdba74; border-radius: 6px; color: #7c2d12; margin: 12px 0; padding: 10px 12px; }
    .localized-ispring { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
    .localized-ispring iframe { border: 0; display: block; height: min(72vh, 760px); min-height: 640px; width: 100%; }
    .embedded-video { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
    .embedded-video video { background: #000; display: block; margin: 0 auto; max-height: min(72vh, 760px); max-width: 100%; width: min(100%, 960px); }
    .embedded-h5p-frame { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
    .embedded-h5p-frame iframe { border: 0; display: block; min-height: 640px; width: 100%; }
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
  const downloadButton = `<a class="button" href="${escapeAttr(relativeHref(pageRel, item.downloadPath || item.path))}" download>Download</a>`;
  return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${escapeAttr(relativeHref(pageRel, viewPath))}">View</a>${downloadButton}</div></div>`;
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

async function downloadHtmlAttachments(htmlValue, targetRelDir) {
  const attachments = [];
  for (const url of extractUrls(htmlValue)) {
    if (!isDownloadableMoodleUrl(url)) continue;
    const resource = await downloadResource(url, targetRelDir, fileNameFromUrl(url));
    if (resource) attachments.push(resource);
  }
  return uniqueResources(attachments);
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
  if (!mod || !id) return null;
  if (mod === "resource") return downloadDirectActivityFile(link, "course-sections/course-resources/files");
  const key = `${mod}:${id}`;
  if (activityCache.has(key)) return activityCache.get(key);
  const title = (link.text || `${mod} ${id}`).trim();
  if (mod === "h5pactivity") {
    const item = {
      label: title,
      type: "h5p",
      category: "moodle_h5pactivity",
      role: EXIT_CARD_RE.test(title) ? "exit_card" : "h5p_activity",
      source: link.href,
      moodleActivityId: id,
      mod,
      textPreview: title,
    };
    activityCache.set(key, item);
    return item;
  }
  const relDir = toPosix(join("localized-moodle-activities", mod, `${mod}-${id}-${slug(title)}`));
  try {
    const response = await request(link.href);
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const main = extractMainContent(html);
    const pageRel = toPosix(join(relDir, "index.html"));
    const localized = await localizeHtmlAssets(main, toPosix(join(relDir, "files")), pageRel, { activityId: id, title });
    localized.attachments = uniqueResources([
      ...localized.attachments,
      ...(await downloadHtmlAttachments(html, toPosix(join(relDir, "files")))),
    ]);
    if (isSubmissionOnlyActivity(title, mod, localized)) {
      activityCache.set(key, null);
      return null;
    }
    const pageHtml = renderPage(title, localized.html, localized.attachments, pageRel);
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
      teacherOnly: roleInfo.teacherOnly || ANSWER_RE.test(title) || undefined,
      attachments: localized.attachments.map(maybePreviewPath),
      textPreview: textPreview(localized.html),
    };
    activityCache.set(key, item);
    return item;
  } catch (error) {
    console.warn(`[activity-fetch-failed] ${link.href} :: ${String(error.message || error)}`);
    downloadFailures.push({ url: link.href, reason: `activity-fetch-failed: ${String(error.message || error)}` });
    activityCache.set(key, null);
    return null;
  }
}

function inferActivityRole(title, mod) {
  if (/course outline/i.test(title)) return "course_outline";
  if (/learning log/i.test(title)) return "learning_log";
  if (/exam/i.test(title)) return "final_exam";
  if (EVALUATION_RE.test(title)) return "evaluation";
  if (REFLECTION_RE.test(title)) return "reflection_learning_log";
  if (ANSWER_RE.test(title)) return "answer_key";
  return mod === "forum" ? "discussion" : "moodle_activity";
}

function isCourseIntroActivity(item) {
  return item?.moodleActivityId && COURSE_INTRO_ACTIVITY_IDS.has(String(item.moodleActivityId));
}

function isAssessmentActivity(item) {
  if (!item || isCourseIntroActivity(item)) return false;
  return EVALUATION_RE.test(item.label || "");
}

function inferTeacherUse(title) {
  if (ANSWER_RE.test(title)) return "teacher_reference";
  if (/assignment|dropbox|final|exam/i.test(title)) return "assessment_preparation";
  if (/learning log|kwl|reflection/i.test(title)) return "student_tracking_template";
  return "course_instruction";
}

function roleForBookSection(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("consolidation")) return "consolidation";
  if (value.includes("homework")) return "homework";
  if (value.includes("hands")) return "handsOn";
  if (value.includes("lesson")) return "lesson";
  if (value.includes("introduction") || value.includes("overview") || value.includes("expectation")) return "overview";
  return "lesson_book_section";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sectionJson(sectionNo) {
  return readJson(join(SECTION_DIR, `section-${String(sectionNo).padStart(2, "0")}.json`));
}

function filteredLinksForSection(sectionNo) {
  const links = sectionJson(sectionNo).modLinks || [];
  if (sectionNo >= 2 && sectionNo <= 6) {
    const unitNo = sectionNo - 1;
    return links.filter((link) => {
      if (/\/mod\/book\//i.test(link.href)) return true;
      return new RegExp(`\\bUnit\\s+${unitNo}\\b`, "i").test(link.text || "");
    });
  }
  if (sectionNo === 7) return links.filter((link) => /Final Exam|Culminating|Exam Review/i.test(link.text || ""));
  if (sectionNo === 9) return links.filter((link) => /Answer Keys/i.test(link.text || ""));
  return links;
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
  if (!summary) return "";
  return extractBalancedElement(html, summary.index || 0, "div") || summary[0];
}

async function buildCourseSection(sectionNo, label, relDir, role, options = {}) {
  const section = sectionJson(sectionNo);
  const pageRel = toPosix(join(relDir, "index.html"));
  const sectionSummary = extractSectionSummaryFragment(section.fragment || "");
  const localized = await localizeHtmlAssets(sectionSummary, toPosix(join(relDir, "files")), pageRel, { section: sectionNo, title: label });
  const preview = textPreview(localized.html);
  if (options.optional && !localized.attachments.length && preview.length < 40) return null;
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
    textPreview: preview,
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
      localized.attachments = localized.attachments.map((item) => ({ ...item, role: roleForBookSection(label) }));
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
  return { bookId: raw.bookId, lessons, rawPageCount: raw.lessons?.reduce((sum, item) => sum + (item.sections?.length || 0), 0) || 0 };
}

function sanitizeLessonTitle(title, lessonNo) {
  return String(title || `Lesson ${lessonNo}`).replace(new RegExp(`^\\s*Lesson\\s*${lessonNo}\\s*[:：]?\\s*`, "i"), "").trim() || `Lesson ${lessonNo}`;
}

function categorizeUnitActivity(items) {
  const buckets = { evaluations: [], reflectionAndLogs: [], lessonDropboxes: [], answerPages: [], h5pActivities: [] };
  for (const item of items) {
    if (!item) continue;
    if (item.category === "moodle_h5pactivity") buckets.h5pActivities.push(item);
    else if (ANSWER_RE.test(item.label || "")) buckets.answerPages.push({ ...item, teacherOnly: true });
    else if (REFLECTION_RE.test(item.label || "")) buckets.reflectionAndLogs.push(item);
    else if (LESSON_DROPBOX_RE.test(item.label || "")) buckets.lessonDropboxes.push(item);
    else if (EVALUATION_RE.test(item.label || "")) buckets.evaluations.push(item);
  }
  return buckets;
}

function attachH5pToLessons(unitNo, lessons, h5pActivities) {
  for (const item of h5pActivities || []) {
    const lessonNo = Number(/Lesson\s+(\d+)/i.exec(item.label || "")?.[1] || 0);
    const lesson = lessons.find((entry) => entry.lesson === lessonNo);
    if (!lesson) continue;
    lesson.downloads = uniqueResources([...(lesson.downloads || []), item]);
  }
}

function attachHomeworkDownloadsToDropboxes(unitNo, unitResources, lessons) {
  for (const lesson of lessons || []) {
    const homeworkDownloads = (lesson.downloads || []).filter((item) => String(item.path || "").includes("/book_sections/files/05-homework/"));
    if (!homeworkDownloads.length) continue;
    const homeworkSection = (lesson.bookSections || []).find((item) => String(item.sectionLabel || "").toLowerCase() === "homework");
    if (homeworkSection) homeworkSection.attachments = uniqueResources([...(homeworkSection.attachments || []), ...homeworkDownloads]);
    const dropbox = (unitResources.lessonDropboxes || []).find((item) => new RegExp(`\\bUnit\\s+${unitNo}\\s+-\\s+Lesson\\s+${lesson.lesson}\\b`, "i").test(item.label || ""));
    if (dropbox) dropbox.attachments = uniqueResources([...(dropbox.attachments || []), ...homeworkDownloads]);
  }
}

function copyCurriculumMaterial() {
  const source = resolve(WORKSPACE_ROOT, "courseware", "SBI3U", "texts", "ontario-curriculum", "2009science11_12.pdf");
  if (!existsSync(source)) return null;
  const targetRel = "texts/ontario-curriculum/2009science11_12.pdf";
  const target = join(COURSE_ROOT, targetRel);
  ensureDir(dirname(target));
  if (!existsSync(target)) copyFileSync(source, target);
  return {
    id: "ontario-science-11-12-2008",
    title: "The Ontario Curriculum: Science, Grades 11 and 12, 2008",
    publisher: "Ontario Ministry of Education",
    type: "curriculum",
    units: [1, 2, 3, 4, 5],
    copyrightStatus: "official_public_document",
    sourceStatus: "localized_from_existing_official_source",
    notes: "Official Ontario curriculum reference containing SBI4U Biology, Grade 12, University Preparation.",
    materials: [{
      label: "The Ontario Curriculum: Science, Grades 11 and 12, 2008",
      type: "pdf",
      category: "official_curriculum",
      role: "curriculum_reference",
      path: targetRel,
      previewPath: targetRel,
      downloadPath: targetRel,
      bytes: statSync(target).size,
      source: "https://www.edu.gov.on.ca/eng/curriculum/secondary/2009science11_12.pdf",
    }],
    path: targetRel,
    bytes: statSync(target).size,
    category: "official_curriculum",
    role: "curriculum_reference",
  };
}

function copyTextbookMaterial() {
  const source = resolve(WORKSPACE_ROOT, "docs", "Nelson Biology 12.pdf");
  if (!existsSync(source)) return null;
  const targetRel = "texts/nelson-biology-12/Nelson Biology 12.pdf";
  const target = join(COURSE_ROOT, targetRel);
  ensureDir(dirname(target));
  copyFileSync(source, target);
  return {
    id: "nelson-biology-12-2012",
    title: "Biology 12",
    publisher: "Nelson Education Ltd.",
    type: "textbook",
    role: "core_text",
    units: [1, 2, 3, 4, 5],
    copyrightStatus: "user_provided_legal_copy",
    sourceStatus: "included_from_user_provided_legal_copy",
    notes: "Course Outline identifies the required textbook as Biology 12, Nelson Education Ltd., 2012. Local PDF copy was provided in docs and included for this course.",
    materials: [{
      label: "Biology 12, Nelson Education Ltd., 2012",
      type: "pdf",
      category: "textbook",
      role: "core_text",
      path: targetRel,
      previewPath: targetRel,
      downloadPath: targetRel,
      bytes: statSync(target).size,
      source: "local user-provided legal copy: docs/Nelson Biology 12.pdf",
      textPreview: "Legally obtained local copy of the SBI4U Biology 12 textbook.",
    }],
    path: targetRel,
    bytes: statSync(target).size,
    category: "textbook",
    downloadPath: targetRel,
    previewPath: targetRel,
  };
}

function writeTextbookReferenceFile(hasTextbook) {
  const rel = "texts/biology-12-textbook-reference/index.html";
  const abs = join(COURSE_ROOT, rel);
  ensureDir(dirname(abs));
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SBI4U Biology 12 Textbook Reference</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f4f7fb; color: #001f3f; }
    main { max-width: 920px; margin: 48px auto; background: #fff; border: 1px solid #d8e4f2; border-radius: 8px; padding: 28px; }
    h1 { margin-top: 0; font-size: 30px; }
    h2 { margin-top: 28px; font-size: 20px; }
    p, li { line-height: 1.55; }
    .notice { border: 1px solid #f4c36a; background: #fff8e8; color: #6d4600; border-radius: 6px; padding: 12px 14px; }
    dl { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; }
    dt { font-weight: 700; }
    dd { margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>SBI4U Biology 12 Textbook Reference</h1>
    <p class="notice">${hasTextbook ? "A legally obtained local textbook copy has been provided by the user and included in this SBI4U course package." : "No local textbook copy is included. This page records the textbook named by the Moodle course outline."}</p>
    <h2>Textbook Name</h2>
    <dl>
      <dt>Primary title</dt>
      <dd>Biology 12</dd>
      <dt>Publisher</dt>
      <dd>Nelson Education Ltd.</dd>
      <dt>Course match</dt>
      <dd>SBI4U Biology, Grade 12, University Preparation</dd>
      <dt>Moodle evidence</dt>
      <dd>SBI4U Course Outline from St. Mary Moodle course id 66</dd>
    </dl>
    <h2>Evidence</h2>
    <ul>
      <li>The downloaded SBI4U Course Outline identifies the textbook as <em>Biology 12, Nelson Education Ltd., 2012</em>.</li>
      <li>The local course package includes the user-provided textbook file at <code>texts/nelson-biology-12/Nelson Biology 12.pdf</code>.</li>
      <li>The previous esunnybrook course id 88 was not used as the source for this SBI4U rebuild.</li>
    </ul>
    <h2>Included Official Guidance</h2>
    <p>The official Ontario Ministry curriculum document for Grades 11 and 12 Science is included separately in this course package.</p>
  </main>
</body>
</html>
`;
  writeFileSync(abs, body, "utf8");
  return {
    label: "SBI4U Biology 12 Textbook Reference",
    type: "html",
    category: "textbook_reference",
    role: "textbook_reference",
    path: rel,
    previewPath: rel,
    bytes: statSync(abs).size,
    source: "local source audit based on St. Mary Moodle course outline",
    textPreview: "Records the SBI4U textbook name as Biology 12, Nelson Education Ltd., 2012.",
  };
}

function writeSourceAuditFile() {
  const rel = "texts/SOURCES.md";
  const abs = join(COURSE_ROOT, rel);
  ensureDir(dirname(abs));
  const body = `# SBI4U Sources

- Source Moodle course: ${BASE_URL}/course/view.php?id=${COURSE_ID}
- Moodle sections exported to: ossd-course-portal/inbox/sbi4u-stmary-sections
- Moodle book raw exports:
  - Unit 1: inbox/moodle-book-raw-SBI4U-U01.json
  - Unit 2: inbox/moodle-book-raw-SBI4U-U02.json
  - Unit 3: inbox/moodle-book-raw-SBI4U-U03.json
  - Unit 4: inbox/moodle-book-raw-SBI4U-U04.json
  - Unit 5: inbox/moodle-book-raw-SBI4U-U05.json
- Moodle section 0 course introduction is preserved as a course-level HTML page
  with its banner image and prerequisite text.
- Moodle section 1 Course Overview is preserved with overview, grading, and
  lesson overview images.
- Moodle section 7 Final Exam & Culminating is preserved as course-level
  evaluation resources, not invented as an additional numbered unit.
- Moodle section 8 Exit Cards contains H5P activities, attached back to matching
  unit lessons.
- Moodle section 9 Teacher Packet contains Answer Keys and is teacher-only.
- Official curriculum document: texts/ontario-curriculum/2009science11_12.pdf

Textbook: Biology 12, Nelson Education Ltd., 2012

Included local textbook copy: texts/nelson-biology-12/Nelson Biology 12.pdf
Source: docs/Nelson Biology 12.pdf
Status: included from user-provided legal copy.
`;
  writeFileSync(abs, body, "utf8");
  return {
    id: "sbi4u-source-audit",
    title: "SBI4U Text And Source Audit",
    type: "source_audit",
    units: [1, 2, 3, 4, 5],
    copyrightStatus: "local_audit_note",
    sourceStatus: "created_from_local_source_review",
    notes: "Records Moodle source exports, official curriculum inclusion, section 0/1 preservation, final evaluation resources, H5P exit cards, and Course Outline textbook audit.",
    materials: [{
      label: "SBI4U Text And Source Audit",
      type: "md",
      category: "source_audit",
      role: "source_audit",
      path: rel,
      bytes: Buffer.byteLength(body, "utf8"),
      source: "local source audit",
    }],
    path: rel,
    bytes: Buffer.byteLength(body, "utf8"),
    category: "source_audit",
    role: "source_audit",
  };
}

async function main() {
  ensureDir(COURSE_ROOT);
  await login();

  const courseIntroduction = await buildCourseSection(0, "Course Introduction", "course-sections/course-starter-resources", "introduction");
  const courseOverview = await buildCourseSection(1, "Course Overview", "course-sections/course-overview", "course_overview");
  const finalSection = await buildCourseSection(7, "Final Exam & Culminating", "course-sections/final-exam-culminating", "final_exam_culminating", { optional: true });
  const teacherPacket = await buildCourseSection(9, "Teacher Packet", "course-sections/teacher-packet", "teacher_packet", { optional: true });

  const localizedActivities = [];
  for (const sectionNo of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    for (const link of filteredLinksForSection(sectionNo)) {
      if (/\/mod\/book\//i.test(link.href)) continue;
      const item = await localizeActivity(link);
      if (item) localizedActivities.push(item);
    }
  }
  const activityById = new Map(localizedActivities.map((item) => [item.moodleActivityId, item]));

  const bookReports = [];
  const units = [];
  for (const unitNo of [1, 2, 3, 4, 5]) {
    const book = await buildBookSections(unitNo);
    bookReports.push({ unit: unitNo, bookId: book.bookId, localizedPages: book.rawPageCount, lessons: book.lessons.length });
    const unitActivities = filteredLinksForSection(unitNo + 1)
      .filter((link) => !/\/mod\/book\//i.test(link.href))
      .map((link) => activityById.get(parseActivityUrl(link.href).id))
      .filter(Boolean);
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
      lessonPlan: null,
      ispring: [],
      downloads: lesson.downloads,
      bookSections: lesson.bookSections,
      resourceCounts: {
        downloads: lesson.downloads.length,
        bookSections: lesson.bookSections.length,
        ispring: 0,
        h5p: 0,
      },
    }));
    attachH5pToLessons(unitNo, lessons, unitResources.h5pActivities);
    attachHomeworkDownloadsToDropboxes(unitNo, unitResources, lessons);
    for (const lesson of lessons) {
      lesson.resourceCounts.downloads = lesson.downloads.length;
      lesson.resourceCounts.h5p = lesson.downloads.filter((item) => item.category === "moodle_h5pactivity").length;
    }
    units.push({
      unit: unitNo,
      title: UNIT_TITLES[unitNo],
      coreTexts: ["nelson-biology-12-2012"],
      unitPlan: null,
      unitResources,
      lessons,
      summary: {
        lessons: lessons.length,
        bookSections: lessons.reduce((sum, lesson) => sum + lesson.bookSections.length, 0),
        downloads: lessons.reduce((sum, lesson) => sum + lesson.downloads.length, 0),
        ispring: 0,
        h5p: lessons.reduce((sum, lesson) => sum + lesson.downloads.filter((item) => item.category === "moodle_h5pactivity").length, 0),
      },
    });
  }

  const curriculum = copyCurriculumMaterial();
  const textbook = copyTextbookMaterial();
  const textbookReference = writeTextbookReferenceFile(Boolean(textbook));
  const sourceAuditText = writeSourceAuditFile();
  const finalExam = activityById.get("10260");
  const culminating = activityById.get("10261");
  const examReview = activityById.get("10262");

  const courseDownloads = [
    activityById.get("10156") ? { ...activityById.get("10156"), role: "introduction" } : null,
    activityById.get("10157") ? { ...activityById.get("10157"), role: "introduction" } : null,
    activityById.get("10158"),
    activityById.get("10159"),
    finalExam,
    culminating,
    examReview,
    curriculum?.materials?.[0],
    textbookReference,
    sourceAuditText?.materials?.[0],
    textbook?.materials?.[0],
  ].filter(Boolean);
  const introductionResources = courseDownloads.filter((item) => item.role === "introduction");
  const evaluations = localizedActivities.filter(isAssessmentActivity);
  const teacherResources = uniqueByPath([
    teacherPacket,
    activityById.get("10291"),
    ...localizedActivities.filter((item) => ANSWER_RE.test(item.label || "")),
    ...evaluations,
  ].filter(Boolean).map((item) => ({ ...item, teacherOnly: item.teacherOnly || ANSWER_RE.test(item.label || "") || item.moodleActivityId === "10291" })));

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    course: {
      code: COURSE,
      title: "SBI4U V2.0 - Biology, Grade 12",
      audience: "Teachers preparing OSSD lessons",
      source: "St. Mary Moodle course id 66 and official Ontario curriculum guidance",
    },
    sourceAudit: {
      moodleHost: BASE_URL,
      moodleCourseId: COURSE_ID,
      moodleCoursePage: `${BASE_URL}/course/view.php?id=${COURSE_ID}`,
      courseStructure: "new-moodle-v2",
      unitCount: units.length,
      courseIntroductionPresent: Boolean(courseIntroduction),
      finalSectionPresent: Boolean(finalSection || finalExam || culminating || examReview),
      teacherPacketPresent: Boolean(teacherPacket || activityById.get("10291")),
      exitCardsSectionPresent: true,
      lessonCount: units.reduce((sum, unit) => sum + unit.lessons.length, 0),
      bookReports,
      moodleActivityCountLocalized: localizedActivities.length,
      ispringExternalEmbedsPending: pendingMedia.filter((item) => item.kind === "ispring").length,
      h5pExternalEmbedsPending: pendingMedia.filter((item) => item.kind === "h5p").length,
      h5pActivityExpected: localizedActivities.filter((item) => item.category === "moodle_h5pactivity").length,
      downloadFailures,
      textbookReference: {
        title: "Biology 12",
        status: textbook ? "included_from_user_provided_legal_copy" : "referenced_only",
        publisher: "Nelson Education Ltd.",
        evidence: "SBI4U Course Outline from St. Mary Moodle course id 66 identifies the course text as Biology 12, Nelson Education Ltd., 2012.",
        localPath: textbook ? textbook.path : undefined,
        localReferencePath: textbookReference.path,
      },
      textbookAudit: {
        status: textbook ? "included_from_user_provided_legal_copy" : "referenced_only",
        textbook: "Biology 12, Nelson Education Ltd., 2012",
        policyDocument: "The Ontario Curriculum, Grades 11 and 12: Science, 2008 (Revised)",
        evidence: "SBI4U Course Outline attachment says: Textbook: Biology 12, Nelson Education Ltd., 2012; Policy Document: Science, The Ontario Curriculum, Grades 11 and 12, 2008 (Revised).",
        decision: "Textbook name recorded from St. Mary Moodle source course id 66; esunnybrook course id 88 was not used as the source.",
        localPath: textbook ? textbook.path : undefined,
      },
    },
    navigation: { primary: "unit", secondary: "lesson" },
    courseDownloads,
    texts: [curriculum, sourceAuditText, textbook].filter(Boolean),
    units,
    courseSections: [courseIntroduction, ...introductionResources, courseOverview, finalSection, teacherPacket].filter(Boolean),
    teacherResources,
    evaluations,
  };

  writeFileSync(join(COURSE_ROOT, "course-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    course: COURSE,
    courseDownloads: courseDownloads.length,
    localizedActivities: localizedActivities.length,
    units: units.length,
    lessons: manifest.sourceAudit.lessonCount,
    ispringPending: manifest.sourceAudit.ispringExternalEmbedsPending,
    h5pPending: manifest.sourceAudit.h5pExternalEmbedsPending,
    h5pActivities: manifest.sourceAudit.h5pActivityExpected,
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
