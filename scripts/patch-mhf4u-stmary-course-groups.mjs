import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const COURSE = "MHF4U";
const COURSE_ID = 49;
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const SECTION_DIR = resolve(REPO_ROOT, "inbox", "mhf4u-stmary-sections");
const MANIFEST_PATH = join(COURSE_ROOT, "course-manifest.json");
const BASE_URL = normalizeBaseUrl(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58");

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
        if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    }
  }
  header() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar();
const downloadCache = new Map();
const downloadFailures = [];

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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
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
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function slug(value) {
  return decodeEntities(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/&/g, "and")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80) || "activity";
}

function typeFromName(name, contentType = "") {
  const ext = extname(name).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/presentationml|powerpoint/i.test(contentType)) return "pptx";
  if (/spreadsheetml|excel/i.test(contentType)) return "xlsx";
  return "bin";
}

function filenameFromUrl(url, fallback = "file") {
  const parsed = new URL(url);
  const raw = decodeURIComponent(parsed.pathname.split("/").pop() || "").trim();
  return raw || `${slug(fallback)}.bin`;
}

function hasValidSignature(buffer, filename, contentType = "") {
  const type = typeFromName(filename, contentType);
  if (!buffer?.length) return false;
  const pk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const pdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (type === "pdf") return pdf;
  if (type === "docx") return pk || ole;
  if (["pptx", "xlsx", "h5p"].includes(type)) return pk;
  if (["doc", "ppt", "xls"].includes(type)) return ole;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(type)) return true;
  return !/text\/html/i.test(contentType);
}

function maybePreviewPath(resource) {
  if (!resource?.path) return resource;
  const ext = extname(resource.path).toLowerCase();
  if ([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) resource.previewPath = resource.path;
  else {
    const previewPath = `previews-html/${toPosix(resource.path)}.html`;
    if (existsSync(join(COURSE_ROOT, previewPath))) resource.previewPath = previewPath;
  }
  return resource;
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-mhf4u-stmary-patcher/1.0");
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
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St.Mary Moodle login failed.");
}

function extractBalancedElement(html, start, tagName) {
  const tag = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "ig");
  token.lastIndex = start;
  let depth = 0;
  let first = true;
  for (const match of html.matchAll(token)) {
    const index = match.index || 0;
    if (index < start) continue;
    const text = match[0];
    if (first && !new RegExp(`^<${tag}\\b`, "i").test(text)) return "";
    first = false;
    if (new RegExp(`^<${tag}\\b`, "i").test(text) && !/\/\s*>$/.test(text)) depth += 1;
    else if (new RegExp(`^</${tag}\\b`, "i").test(text)) depth -= 1;
    if (!first && depth === 0) return html.slice(start, index + text.length);
  }
  return "";
}

function extractByMarker(html, markerPattern, tagName = "div") {
  const marker = markerPattern.exec(html);
  if (!marker) return "";
  return extractBalancedElement(html, marker.index || 0, tagName) || "";
}

function extractMainHtml(html) {
  return (
    extractByMarker(html, /<div\b[^>]*\bid=["']intro["'][^>]*>/i, "div") ||
    extractByMarker(html, /<div\b[^>]*\brole=["']main["'][^>]*>/i, "div") ||
    extractByMarker(html, /<section\b[^>]*\bid=["']region-main["'][^>]*>/i, "section") ||
    extractByMarker(html, /<div\b[^>]*\bclass=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>/i, "div") ||
    html
  );
}

function cleanHtml(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<div\b[^>]*(?:id=["'](?:fitem_id|assign_files_tree|yui)[^"']*["']|class=["'][^"']*(?:activity-information|completion-info|gradingsummary|fileuploadsubmissiontime|submissionstatustable|continuebutton|modified|urlselect|singlebutton|tertiary-navigation)[^"']*["'])[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/\sdata-localized-(?:href|src|link)=["'][^"']*["']/gi, "")
    .replace(/\sid=["'][^"']*["']/gi, "")
    .replace(/\s(?:width|height|cellpadding|cellspacing|border)=["'][^"']*["']/gi, "")
    .replace(/<p\b[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*<\/p>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function links(html, pageUrl) {
  const rows = [];
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /\bhref=["']([^"']+)["']/i.exec(match[1] || "")?.[1];
    if (!href) continue;
    rows.push({ href: new URL(decodeEntities(href), pageUrl).toString(), text: stripTags(match[2]) });
  }
  return rows;
}

function isDownloadable(url) {
  const absolute = new URL(decodeEntities(url), BASE_URL).toString();
  if (new URL(absolute).host !== new URL(BASE_URL).host) return false;
  if (!/\/(?:pluginfile|draftfile)\.php\//i.test(absolute)) return false;
  if (/\/theme(?:\/|_)|\/logo\/|\/icon\b|\/core\/|\/user\//i.test(absolute)) return false;
  return true;
}

async function downloadResource(url, targetRelDir, label = "") {
  const absoluteUrl = new URL(decodeEntities(url), BASE_URL).toString();
  if (downloadCache.has(absoluteUrl)) return downloadCache.get(absoluteUrl);
  const fileName = filenameFromUrl(absoluteUrl, label || "file");
  const targetRel = toPosix(join(targetRelDir, `${sha10(absoluteUrl)}-${fileName}`));
  const targetAbs = join(COURSE_ROOT, targetRel);
  mkdirSync(dirname(targetAbs), { recursive: true });
  try {
    let bytes = existsSync(targetAbs) ? readFileSync(targetAbs) : null;
    if (!bytes || !hasValidSignature(bytes, fileName)) {
      const response = await request(absoluteUrl, { headers: { referer: `${BASE_URL}/course/view.php?id=${COURSE_ID}` } });
      bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !hasValidSignature(bytes, fileName, contentType)) {
        throw new Error(`invalid-download status=${response.status} type=${contentType} bytes=${bytes.length}`);
      }
      writeFileSync(targetAbs, bytes);
    }
    const resource = maybePreviewPath({
      label: fileName,
      type: typeFromName(fileName),
      category: "moodle_file",
      role: "attachment",
      path: targetRel,
      downloadPath: targetRel,
      source: absoluteUrl,
      bytes: bytes.length,
    });
    downloadCache.set(absoluteUrl, resource);
    return resource;
  } catch (error) {
    downloadFailures.push({ url: absoluteUrl, targetRel, reason: String(error?.message || error) });
    downloadCache.set(absoluteUrl, null);
    return null;
  }
}

function renderPage(title, body, attachments, pageRel) {
  const attachmentList = attachments.length
    ? `<h2>Files</h2><ul class="attachments">${attachments.map((item) => {
        const href = toPosix(posix.relative(posix.dirname(pageRel), item.path));
        const previewHref = item.previewPath ? toPosix(posix.relative(posix.dirname(pageRel), item.previewPath)) : "";
        return `<li><span>${htmlEscape(item.label)}</span><span class="actions">${previewHref ? `<a href="${htmlEscape(previewHref, true)}">View</a>` : ""}<a href="${htmlEscape(href, true)}" download>Download</a></span></li>`;
      }).join("")}</ul>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { background: #f5f7fb; color: #102033; font-family: Arial, Helvetica, sans-serif; line-height: 1.6; margin: 0; }
    main { margin: 0 auto; max-width: 980px; padding: 40px 20px 64px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; }
    h1 { border-bottom: 1px solid #edf1f6; color: #002f5f; font-size: 28px; margin: 0 0 18px; padding-bottom: 14px; }
    h2 { color: #14395c; font-size: 20px; margin-top: 26px; }
    a { color: #00396f; font-weight: 700; }
    table { border-collapse: collapse; max-width: 100%; }
    td, th { border: 1px solid #d8e2ef; padding: 8px 10px; vertical-align: top; }
    .body { overflow-wrap: anywhere; }
    .attachments { display: grid; gap: 8px; list-style: none; padding: 0; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; justify-content: space-between; padding: 10px 12px; }
    .actions { display: inline-flex; flex: 0 0 auto; gap: 10px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <div class="body">${body || "<p>No additional instructions were provided by the source activity.</p>"}</div>
      ${attachmentList}
    </article>
  </main>
</body>
</html>
`;
}

function extractRenderedBody(html) {
  const match = String(html || "").match(/<div\b[^>]*\bclass=["']body["'][^>]*>([\s\S]*?)<\/div>\s*(?:<h2>Files<\/h2>|<\/article>)/i);
  return match?.[1]?.trim() || "";
}

function findLessonDownload(manifest, unitNo, kind) {
  const pattern = kind === "kwl" ? /Unit[-\s]*\d+[-\s]*KWL[-\s]*Chart\.docx/i : /Unit[-\s]*\d+[-\s]*End[-\s]*of[-\s]*Unit[-\s]*Reflection\.docx/i;
  for (const unit of manifest.units || []) {
    if (Number(unit.unit) !== Number(unitNo)) continue;
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) {
        const text = `${item.label || ""} ${item.path || ""}`;
        if (pattern.test(text)) return item;
      }
    }
  }
  return null;
}

function attachmentFromLessonDownload(item) {
  if (!item) return null;
  return {
    label: String(item.label || "").replace(/^DOCUMENT\s*-\s*/i, "") || item.path?.split(/[\\/]/).pop() || "Attachment",
    type: item.type || typeFromName(item.path || item.label || ""),
    category: "localized_moodle_attachment",
    role: "attachment",
    path: item.path,
    downloadPath: item.downloadPath || item.path,
    source: item.source,
    bytes: item.bytes,
    previewPath: item.previewPath,
  };
}

function attachReflectionDocuments(manifest, reflectionItems) {
  let attached = 0;
  for (const item of reflectionItems) {
    const kind = item.role === "reflection_kwl" ? "kwl" : item.role === "reflection_summary" ? "reflection" : "";
    if (!kind || !item.unit) continue;
    const attachment = attachmentFromLessonDownload(findLessonDownload(manifest, item.unit, kind));
    if (!attachment?.path) continue;
    item.attachments = [attachment];
    const pageAbs = join(COURSE_ROOT, item.path);
    const current = existsSync(pageAbs) ? readFileSync(pageAbs, "utf8") : "";
    const body = extractRenderedBody(current) || `<p>${htmlEscape(item.label)} files from the St.Mary Moodle source.</p>`;
    writeFileSync(pageAbs, renderPage(item.label, body, item.attachments, item.path), "utf8");
    item.bytes = statSync(pageAbs).size;
    item.textPreview = stripTags(body).slice(0, 800);
    attached += 1;
  }
  return attached;
}

function activityMeta(link) {
  const url = new URL(link.href);
  const id = url.searchParams.get("id") || "";
  const mod = /\/mod\/([^/]+)\//i.exec(url.pathname)?.[1] || "activity";
  const label = normalizeHomeworkLabel(stripTags(link.text || ""));
  return { id, mod, label, source: link.href };
}

function normalizeHomeworkLabel(label) {
  return String(label || "").replace(/Lesson(\d+)/i, "Lesson $1").replace(/\s+/g, " ").trim();
}

function numberedPosition(label) {
  const match = /^Unit\s+(\d+)\s*-\s*Lesson\s+(\d+)(?:\s*\((Answer)\))?/i.exec(normalizeHomeworkLabel(label));
  return match ? { unit: Number(match[1]), lesson: Number(match[2]), answer: match[3] ? 1 : 0 } : null;
}

function isHomework(label) {
  return Boolean(numberedPosition(label));
}

function isEvaluation(label) {
  return /\b(?:Quiz|Test|Assignment)\s*\(AOL\)|\bAssignment\s*\(AOL\)/i.test(label);
}

function isReflectionLog(label) {
  return /\b(?:KWL|Reflection Summary)\s+Dropbox\b/i.test(label);
}

function roleFor(meta, sectionName) {
  const position = numberedPosition(meta.label);
  if (position?.answer) return "homework_answer_page";
  if (position) return "homework_submission_page";
  if (/^Answer Keys$/i.test(meta.label)) return "teacher_packet";
  if (isEvaluation(meta.label)) return "evaluation";
  if (/KWL\s+Dropbox/i.test(meta.label)) return "reflection_kwl";
  if (/Reflection Summary\s+Dropbox/i.test(meta.label)) return "reflection_summary";
  return sectionName === "Teacher Packet" ? "teacher_packet" : "moodle_activity";
}

function evaluationType(label) {
  if (/Quiz/i.test(label)) return "quiz";
  if (/Test/i.test(label)) return "test";
  if (/Assignment/i.test(label)) return "assignment";
  return "evaluation";
}

function unitFromLabel(label) {
  const unit = /^Unit\s+(\d+)/i.exec(label || "")?.[1];
  return unit ? Number(unit) : undefined;
}

async function localizeActivity(link, sectionName) {
  const meta = activityMeta(link);
  const relDir = toPosix(join("localized-moodle-activities", meta.mod, `${meta.mod}-${meta.id}-${slug(meta.label)}`));
  const pageRel = toPosix(join(relDir, "index.html"));
  const filesRelDir = toPosix(join(relDir, "files"));
  const response = await request(meta.source, { headers: { referer: `${BASE_URL}/course/view.php?id=${COURSE_ID}` } });
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${meta.source}`);
  if (/name=["']password["']|logintoken/i.test(html)) throw new Error(`Login page returned: ${meta.source}`);

  const main = extractMainHtml(html);
  const downloadableLinks = links(main, meta.source).filter((item) => isDownloadable(item.href));
  const attachments = [];
  const seen = new Set();
  for (const item of downloadableLinks) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    const downloaded = await downloadResource(item.href, filesRelDir, item.text || meta.label);
    if (downloaded) attachments.push(downloaded);
  }

  const role = roleFor(meta, sectionName);
  const position = numberedPosition(meta.label);
  let body = cleanHtml(main);
  for (const attachment of attachments) {
    if (!attachment.source) continue;
    const href = toPosix(posix.relative(posix.dirname(pageRel), attachment.path));
    body = body.replaceAll(attachment.source.replaceAll("&", "&amp;"), href).replaceAll(attachment.source, href);
  }
  if (role === "teacher_packet") {
    body = "<p>Teacher Packet answer key files from the St.Mary Moodle source.</p>";
  }

  const page = renderPage(meta.label, body, attachments, pageRel);
  const pageAbs = join(COURSE_ROOT, pageRel);
  mkdirSync(dirname(pageAbs), { recursive: true });
  writeFileSync(pageAbs, page, "utf8");

  const item = {
    title: meta.label,
    label: meta.label,
    type: "html",
    category: `moodle_${meta.mod}`,
    role,
    path: pageRel,
    source: meta.source,
    moodleActivityId: meta.id,
    bytes: statSync(pageAbs).size,
    attachments: attachments.map(maybePreviewPath),
    textPreview: stripTags(body).slice(0, 800),
  };
  if (position) {
    item.unit = position.unit;
    item.lesson = position.lesson;
    item.parentSection = "Homework Submission Folder";
    item.sourceGroup = "homework_submission_folder";
    item.stmaryParentSection = sectionName;
    if (position.answer) {
      item.teacherOnly = true;
      item.teacherUse = "homework_answer_reference";
    } else {
      item.teacherUse = "student_submission";
    }
  } else if (role === "teacher_packet") {
    item.parentSection = "Teacher Packet";
    item.sourceGroup = "teacher_packet";
    item.teacherOnly = true;
    item.teacherUse = "answer_key_reference";
  } else if (role === "evaluation") {
    item.unit = unitFromLabel(meta.label);
    item.evaluationType = evaluationType(meta.label);
    item.parentSection = "Evaluation";
    item.sourceGroup = "evaluation";
    item.teacherUse = "student_evaluation";
  } else if (role === "reflection_kwl" || role === "reflection_summary") {
    item.unit = unitFromLabel(meta.label);
    item.parentSection = "Reflection / Learning Log";
    item.sourceGroup = "reflection_learning_log";
    item.teacherUse = "student_reflection";
  }
  return item;
}

function section(no) {
  return readJson(join(SECTION_DIR, `section-${String(no).padStart(2, "0")}.json`));
}

function uniqueBySource(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.source || item.path || item.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortHomework(items) {
  return [...items].sort((a, b) => {
    const left = numberedPosition(a.label) || { unit: 999, lesson: 999, answer: 0 };
    const right = numberedPosition(b.label) || { unit: 999, lesson: 999, answer: 0 };
    return left.unit - right.unit || left.lesson - right.lesson || left.answer - right.answer || String(a.label).localeCompare(String(b.label));
  });
}

function sortEvaluations(items) {
  const rank = (item) => ({ quiz: 1, test: 2, assignment: 3 }[item.evaluationType || evaluationType(item.label || "")] || 9);
  return [...items].sort((a, b) => Number(a.unit || 999) - Number(b.unit || 999) || rank(a) - rank(b) || String(a.label).localeCompare(String(b.label)));
}

function sortReflectionLogs(items) {
  const rank = (item) => (item.role === "reflection_kwl" ? 1 : item.role === "reflection_summary" ? 2 : 9);
  return [...items].sort((a, b) => Number(a.unit || 999) - Number(b.unit || 999) || rank(a) - rank(b) || String(a.label).localeCompare(String(b.label)));
}

await login();

const homeworkLinks = [];
const evaluationLinks = [];
const reflectionLinks = [];
for (let sectionNo = 2; sectionNo <= 5; sectionNo += 1) {
  const current = section(sectionNo);
  const unitNo = sectionNo - 1;
  for (const link of current.modLinks || []) {
    const label = normalizeHomeworkLabel(link.text || "");
    if (!new RegExp(`^Unit\\s+${unitNo}\\b`, "i").test(label)) continue;
    if (isHomework(label)) homeworkLinks.push({ ...link, text: label, sectionName: current.heading || `Unit ${unitNo}` });
    else if (isEvaluation(label)) evaluationLinks.push({ ...link, text: label, sectionName: current.heading || `Unit ${unitNo}` });
    else if (isReflectionLog(label)) reflectionLinks.push({ ...link, text: label, sectionName: current.heading || `Unit ${unitNo}` });
  }
}
for (const link of section(6).modLinks || []) {
  const label = normalizeHomeworkLabel(link.text || "");
  if (/^Unit\s+4\b/i.test(label) && isEvaluation(label)) evaluationLinks.push({ ...link, text: label, sectionName: section(6).heading });
}
const teacherLinks = (section(8).modLinks || []).filter((link) => /^Answer Keys$/i.test(stripTags(link.text || ""))).map((link) => ({ ...link, sectionName: "Teacher Packet" }));

const homeworkItems = sortHomework(uniqueBySource(await Promise.all(homeworkLinks.map((link) => localizeActivity(link, link.sectionName)))));
const evaluationItems = sortEvaluations(uniqueBySource(await Promise.all(evaluationLinks.map((link) => localizeActivity(link, link.sectionName)))));
const reflectionItems = sortReflectionLogs(uniqueBySource(await Promise.all(reflectionLinks.map((link) => localizeActivity(link, link.sectionName)))));
const teacherItems = uniqueBySource(await Promise.all(teacherLinks.map((link) => localizeActivity(link, link.sectionName))));

const manifest = readJson(MANIFEST_PATH);
const reflectionAttachments = attachReflectionDocuments(manifest, reflectionItems);
const nonHomeworkCourseDownloads = (manifest.courseDownloads || []).filter((item) => String(item.sourceGroup || item.parentSection || item.role || "").toLowerCase().indexOf("homework") === -1 && !isHomework(item.label || ""));
manifest.courseDownloads = uniqueBySource([...nonHomeworkCourseDownloads, ...homeworkItems]);
manifest.teacherResources = teacherItems;

for (const unit of manifest.units || []) {
  const unitNo = Number(unit.unit || 0);
  const existing = unit.unitResources || {};
  unit.unitResources = {
    ...existing,
    evaluations: evaluationItems.filter((item) => Number(item.unit) === unitNo),
    reflectionAndLogs: reflectionItems.filter((item) => Number(item.unit) === unitNo),
  };
}
manifest.evaluations = evaluationItems;

manifest.sourceAudit ||= {};
manifest.sourceAudit.stMaryMhf4uCourseGroups = {
  patchedAt: new Date().toISOString(),
  sourceCoursePage: `${BASE_URL}/course/view.php?id=${COURSE_ID}`,
  sourceCourseId: COURSE_ID,
  homeworkSubmissionFolder: {
    normalizedParentSection: "Homework Submission Folder",
    sourceParentSections: ["Unit 1", "Unit 2", "Unit 3", "Unit 4"],
    count: homeworkItems.length,
    note: "St.Mary MHF4U lists standalone Unit X - Lesson Y and Unit X - Lesson Y (Answer) activities inside Unit sections. They are normalized into the MDM4U Homework Submission Folder course group for portal display.",
  },
  evaluations: {
    count: evaluationItems.length,
    byUnit: [1, 2, 3, 4].map((unit) => ({ unit, count: evaluationItems.filter((item) => Number(item.unit) === unit).length })),
  },
  reflectionAndLogs: {
    count: reflectionItems.length,
    attachmentCount: reflectionAttachments,
    byUnit: [1, 2, 3, 4].map((unit) => ({ unit, count: reflectionItems.filter((item) => Number(item.unit) === unit).length })),
    note: "Unit KWL and Reflection Summary documents are displayed as attachments on their owning St.Mary dropbox activities, matching the MDM4U display shape.",
  },
  teacherPacket: {
    sourceParentSection: "Teacher Packet",
    count: teacherItems.length,
    attachmentCount: teacherItems.reduce((sum, item) => sum + (item.attachments?.length || 0), 0),
  },
  downloadFailures,
};
manifest.generatedAt = new Date().toISOString();

writeJson(MANIFEST_PATH, manifest);

console.log(JSON.stringify({
  course: COURSE,
  homeworkSubmissionItems: homeworkItems.length,
  evaluations: evaluationItems.length,
  reflectionAndLogs: reflectionItems.length,
  reflectionAttachments,
  teacherResources: teacherItems.length,
  teacherAttachments: teacherItems.reduce((sum, item) => sum + (item.attachments?.length || 0), 0),
  downloadFailures: downloadFailures.length,
}, null, 2));
