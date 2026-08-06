import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MHF4U";
const moodleCourseId = 79;
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

loadEnvFile(join(projectRoot, ".env"));

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isLoginPageContent(value) {
  return /Welcome to Sunnybrook|Enter your details to log in|Forgot your password|logintoken|用户名|密码/i.test(
    stripTags(value),
  );
}

function sanitizeSegment(value) {
  return (
    String(value || "resource")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "resource"
  );
}

function fileType(filePath) {
  return extname(filePath).replace(".", "").toLowerCase() || "file";
}

function previewPath(resourcePath) {
  const candidate = join(courseRoot, "previews-html", `${resourcePath}.html`);
  return existsSync(candidate) ? `previews-html/${toPosix(resourcePath)}.html` : undefined;
}

function withFileStats(item) {
  if (item.path) {
    const abs = join(courseRoot, item.path);
    if (existsSync(abs)) item.bytes = statSync(abs).size;
    const preview = previewPath(item.path);
    if (preview) item.previewPath = preview;
  }
  return item;
}

function fileRecord({ label, type, category, role, path, source, extra = {} }) {
  return withFileStats({
    label,
    type: type || fileType(path),
    category,
    role,
    path: toPosix(path),
    source,
    ...extra,
  });
}

function activityUrl(mod, id) {
  return `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`;
}

function upsertByKey(list, record) {
  const key = record.path || record.moodleActivityId || record.source || record.label;
  const index = list.findIndex((item) => {
    const itemKey = item.path || item.moodleActivityId || item.source || item.label;
    return itemKey === key || (record.moodleActivityId && item.moodleActivityId === record.moodleActivityId);
  });
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

function dedupeList(list) {
  const seen = new Set();
  const result = [];
  for (const item of list || []) {
    const key = item.path || item.moodleActivityId || item.source || item.url || item.label;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  for (const match of String(html || "").matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi)) {
    try {
      const url = new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString();
      if (!/\/pluginfile\.php\/\d+\/theme_/i.test(url)) urls.add(url);
    } catch {
      // Ignore malformed URLs.
    }
  }
  return [...urls];
}

function filenameFromUrl(url) {
  const parsed = new URL(url);
  return decodeURIComponent(basename(parsed.pathname)) || `${hashText(url)}.bin`;
}

function extensionFor(filename, contentType = "") {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext && ext !== "php") return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  if (/h5p|zip/i.test(contentType)) return "zip";
  return "bin";
}

function validateSignature(type, buffer, contentType = "") {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const startsWithPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (["docx", "pptx", "xlsx", "zip", "h5p"].includes(type) && !startsWithPk) {
    throw new Error(`downloaded ${type} is not a zip-like package`);
  }
  if (type === "pdf" && !startsWithPdf) throw new Error("downloaded file is not a PDF");
  if (["jpg", "jpeg"].includes(type) && !startsWithJpg && !/image\/jpeg/i.test(contentType)) throw new Error("downloaded file is not a JPEG");
  if (type === "png" && !startsWithPng && !/image\/png/i.test(contentType)) throw new Error("downloaded file is not a PNG");
}

class CookieJar {
  constructor(initialCookie) {
    this.cookies = new Map();
    for (const part of String(initialCookie || "").split(";")) {
      const index = part.indexOf("=");
      if (index > 0) this.cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
  }

  store(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      for (const cookieText of String(value).split(/,(?=\s*[^;,]+=)/g)) {
        const [pair] = cookieText.split(";");
        const index = pair.indexOf("=");
        if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar(process.env.MOODLE_COOKIE || "");

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-mhf4u-finalizer/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return { loggedIn: false, reason: "cookie-provided" };
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const text = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(text)) throw new Error("Moodle login failed.");
  return { loggedIn: true, reason: "credentials" };
}

async function downloadFile(url, targetDir) {
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (/text\/html/i.test(contentType) && /name=["']username["']|logintoken/i.test(buffer.subarray(0, 1200).toString("utf8"))) {
    throw new Error(`Moodle login page returned for ${url}`);
  }
  const sourceFilename = filenameFromUrl(url);
  const responseFilename = filenameFromUrl(response.url || url);
  const filename = fileType(responseFilename) === "php" && fileType(sourceFilename) !== "php" ? sourceFilename : responseFilename;
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer, contentType);
  const rel = toPosix(join(targetDir, `${hashText(url)}-${sanitizeSegment(filename)}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (!existsSync(abs) || statSync(abs).size !== buffer.length) writeFileSync(abs, buffer);
  return fileRecord({
    label: filename,
    type,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: rel,
    source: url,
  });
}

function extractMainContent(rawHtml) {
  const region = /<section\b[^>]*id=["']region-main["'][^>]*>([\s\S]*?)<\/section>/i.exec(rawHtml)?.[1];
  if (region) return region;
  const roleMain = /<div\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>\s*(?:<aside|<footer|$)/i.exec(rawHtml)?.[1];
  if (roleMain) return roleMain;
  return rawHtml;
}

function extractSectionBody(rawHtml, sectionNumber) {
  const sectionPattern = new RegExp(
    `<li\\b[^>]*(?:id=["']section-${sectionNumber}["']|data-section=["']${sectionNumber}["']|data-number=["']${sectionNumber}["'])[^>]*>([\\s\\S]*?)(?=<li\\b[^>]*(?:id=["']section-|data-section=|data-number=)|<\\/ul>\\s*<\\/li>|$)`,
    "i",
  );
  return sectionPattern.exec(rawHtml)?.[1] || extractMainContent(rawHtml);
}

function cleanHtmlBody(rawHtml) {
  return String(rawHtml || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<form\b[^>]*(?:action=["'][^"']*course\/jumpto\.php[^"']*["']|id=["']coursesearch["'])[\s\S]*?<\/form>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bcard-section-(?:left|right)nav\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bprogress-bar-warpper\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "")
    .replace(/<ul\b[^>]*class=["'][^"']*\bactivity-cards\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, "");
}

function writeLocalPage({ title, targetDir, body, source, role, category, type = "html", attachments = [], extra = {}, appendAttachments = true }) {
  const rel = toPosix(join(targetDir, "index.html"));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const attachmentLinks = attachments
    .filter((attachment) => attachment.path)
    .map((attachment) => {
      const href = toPosix(relative(join(courseRoot, targetDir), join(courseRoot, attachment.path)));
      return `<li><a href="${htmlEscape(href, true)}" download>${htmlEscape(attachment.label)}</a></li>`;
    })
    .join("\n");
  const attachmentsBlock = appendAttachments && attachmentLinks ? `<h2>Attachments</h2>\n<ul>\n${attachmentLinks}\n</ul>` : "";
  writeFileSync(
    abs,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    h2 { font-size: 20px; margin-top: 24px; }
    img, video, iframe { max-width: 100%; }
    a { color: #00396f; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${body}
      ${attachmentsBlock}
    </article>
  </main>
</body>
</html>
`,
    "utf8",
  );
  return fileRecord({
    label: title,
    type,
    category,
    role,
    path: rel,
    source,
    extra: { attachments, textPreview: stripTags(body).slice(0, 800), ...extra },
  });
}

async function localizeHtmlPage({
  source,
  title,
  role,
  category,
  targetDir,
  type = "html",
  extra = {},
  bodySelector = "main",
  introOnly = true,
  appendAttachments = false,
  hideAttachmentDates = true,
  suppressFailedAttachments = true,
}) {
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(rawHtml.slice(0, 2000)) || isLoginPageContent(rawHtml)) {
    throw new Error(`Moodle login page returned for ${source}`);
  }
  const rawBody = bodySelector === "section" ? extractSectionBody(rawHtml, extra.sectionNumber) : extractMainContent(rawHtml);
  const attachments = [];
  const failedAttachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(rawBody, source)) {
    try {
      const attachment = await downloadFile(url, join(targetDir, "files"));
      attachments.push(attachment);
      localByUrl.set(url, attachment);
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      localByUrl.set(parsed.toString(), attachment);
    } catch (error) {
      failedAttachments.push({
        label: filenameFromUrl(url),
        source: url,
        reason: error.message,
      });
    }
  }
  let body = cleanHtmlBody(rawBody);
  if (introOnly) {
    const introMatch = body.match(/<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<div\b[^>]*\brole=["']main["']/i);
    if (introMatch) body = introMatch[1];
  }
  if (hideAttachmentDates) {
    body = body.replace(/<div\b[^>]*\bclass=["'][^"']*\bfileuploadsubmissiontime\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  }
  body = body.replace(/\b(href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), source).toString();
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      const attachment = localByUrl.get(url) || localByUrl.get(parsed.toString());
      if (attachment?.path) {
        const localHref = toPosix(relative(join(courseRoot, targetDir), join(courseRoot, attachment.path)));
        return `${attr}="${htmlEscape(localHref, true)}"`;
      }
    } catch {
      // Keep original match for non-Moodle URLs until the cleanup below.
    }
    return `data-localized-link="${attr}-unavailable"`;
  });
  body = body
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/(?:www\.)?(?:esunnybrook|hexstruct)\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"');
  if (introOnly) {
    body = body.replace(/<a\b(?=[^>]*\bdata-localized-link=["'][^"']+["'])[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  }
  body = body.replace(/<img\b(?=[^>]*\bdata-localized-link=["'](?:removed|[^"']*-unavailable)["'])[^>]*>\s*/gi, "");
  if (failedAttachments.length && !suppressFailedAttachments) {
    body += `\n<h2>Unavailable Attachments</h2>\n<ul>${failedAttachments
      .map((item) => `<li>${htmlEscape(item.label)} was not packaged because the source did not return a valid file.</li>`)
      .join("")}</ul>`;
  }
  return writeLocalPage({ title, targetDir, body, source, role, category, type, attachments, extra, appendAttachments });
}

function localizedActivityTarget(mod, id, label) {
  return `localized-moodle-activities/${mod}-${id}-${sanitizeSegment(label)}`;
}

async function activityRecord({
  id,
  mod,
  label,
  role,
  unit,
  teacherUse,
  introOnly = false,
  appendAttachments = true,
  hideAttachmentDates = false,
  suppressFailedAttachments = false,
}) {
  const source = activityUrl(mod, id);
  let item = null;
  try {
    item = await localizeHtmlPage({
      source,
      title: label,
      role,
      category: `moodle_${mod}`,
      targetDir: localizedActivityTarget(mod, id, label),
      extra: {
        moodleActivityId: String(id),
        unit,
        teacherUse,
      },
      introOnly,
      appendAttachments,
      hideAttachmentDates,
      suppressFailedAttachments,
    });
  } catch (error) {
    return {
      skipped: true,
      label,
      source,
      moodleActivityId: String(id),
      reason: error.message,
    };
  }
  if (!unit) delete item.unit;
  return item;
}

function localResourceByName(manifest, unitNumber, pattern, role) {
  const unit = (manifest.units || []).find((entry) => Number(entry.unit) === unitNumber);
  for (const lesson of unit?.lessons || []) {
    for (const item of lesson.downloads || []) {
      const haystack = `${item.label || ""} ${item.path || ""}`;
      if (!pattern.test(haystack)) continue;
      return withFileStats({
        ...item,
        role,
        category: "localized_moodle_resource",
        unit: unitNumber,
      });
    }
  }
  return null;
}

function scrubMoodleMainLinks(item) {
  if (!item || typeof item !== "object") return;
  for (const key of ["url", "downloadUrl", "previewUrl"]) {
    if (
      item[key] &&
      /(^|\/\/)(?:www\.esunnybrook\.com|hexstruct\.ispring\.com)/i.test(String(item[key])) &&
      (item.path || item.previewPath || item.downloadPath)
    ) {
      delete item[key];
    }
  }
  for (const attachment of item.attachments || []) scrubMoodleMainLinks(attachment);
}

function scrubManifestMoodleMainLinks(manifest) {
  const visit = (item) => scrubMoodleMainLinks(item);
  for (const item of manifest.courseDownloads || []) visit(item);
  for (const item of manifest.courseSections || []) visit(item);
  for (const item of manifest.evaluations || []) visit(item);
  for (const item of manifest.teacherResources || []) visit(item);
  for (const text of manifest.texts || []) for (const item of text.materials || []) visit(item);
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) visit(unit.unitPlan);
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) visit(lesson.lessonPlan);
      for (const item of lesson.downloads || []) visit(item);
      for (const item of lesson.bookSections || []) visit(item);
      for (const item of lesson.textExports || []) visit(item);
      for (const item of lesson.ispring || []) visit(item);
    }
  }
}

function countPathItems(manifest) {
  let count = 0;
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    if (item.path) count += 1;
    for (const attachment of item.attachments || []) visit(attachment);
  };
  for (const item of manifest.courseDownloads || []) visit(item);
  for (const item of manifest.courseSections || []) visit(item);
  for (const item of manifest.evaluations || []) visit(item);
  for (const item of manifest.teacherResources || []) visit(item);
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) visit(unit.unitPlan);
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) visit(lesson.lessonPlan);
      for (const item of lesson.downloads || []) visit(item);
      for (const item of lesson.bookSections || []) visit(item);
      for (const item of lesson.textExports || []) visit(item);
      for (const item of lesson.ispring || []) visit(item);
    }
  }
  return count;
}

const unitEvaluations = {
  1: [
    { id: 8338, mod: "quiz", label: "Unit 1 - Quiz (AOL)", role: "aol_quiz" },
    { id: 8339, mod: "quiz", label: "Unit 1 - Test (AOL)", role: "aol_quiz" },
    { id: 8340, mod: "assign", label: "Unit 1 Assignment (AOL)", role: "aol_assignment" },
  ],
  2: [
    { id: 8364, mod: "quiz", label: "Unit 2 - Quiz (AOL)", role: "aol_quiz" },
    { id: 8365, mod: "quiz", label: "Unit 2 - Test (AOL)", role: "aol_quiz" },
    { id: 8366, mod: "assign", label: "Unit 2 Assignment (AOL)", role: "aol_assignment" },
  ],
  3: [
    { id: 8395, mod: "quiz", label: "Unit 3 - Quiz (AOL)", role: "aol_quiz" },
    { id: 8396, mod: "quiz", label: "Unit 3 - Test (AOL)", role: "aol_quiz" },
    { id: 8397, mod: "assign", label: "Unit 3 - Assignment (AOL)", role: "aol_assignment" },
  ],
  4: [
    { id: 8417, mod: "quiz", label: "Unit 4 - Quiz (AOL)", role: "aol_quiz" },
    { id: 8418, mod: "quiz", label: "Unit 4 - Test (AOL)", role: "aol_quiz" },
    { id: 9444, mod: "assign", label: "Unit 4 - Assignment (AOL)", role: "aol_assignment" },
  ],
};

const reflectionActivities = {
  1: [
    { id: 8359, mod: "assign", label: "Unit 1 - KWL Dropbox", role: "kwl_dropbox" },
    { id: 8360, mod: "assign", label: "Unit 1 - Reflection Summary Dropbox", role: "reflection_dropbox" },
  ],
  2: [
    { id: 8390, mod: "assign", label: "Unit 2 - KWL Dropbox", role: "kwl_dropbox" },
    { id: 8391, mod: "assign", label: "Unit 2 - Reflection Summary Dropbox", role: "reflection_dropbox" },
  ],
  3: [
    { id: 8412, mod: "assign", label: "Unit 3 - KWL Dropbox", role: "kwl_dropbox" },
    { id: 8413, mod: "assign", label: "Unit 3 - Reflection Summary Dropbox", role: "reflection_dropbox" },
  ],
  4: [
    { id: 8431, mod: "assign", label: "Unit 4 - KWL Dropbox", role: "kwl_dropbox" },
    { id: 8432, mod: "assign", label: "Unit 4 - Reflection Summary Dropbox", role: "reflection_dropbox" },
  ],
};

const answerPages = [];

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseDownloads ||= [];
manifest.courseSections ||= [];
manifest.evaluations ||= [];
manifest.teacherResources ||= [];
const skippedActivities = [];

const courseOverview = await localizeHtmlPage({
  source: `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=1`,
  title: "Course Overview",
  role: "course_overview",
  category: "moodle_course_section",
  targetDir: "course-sections/course-overview",
  bodySelector: "section",
  extra: { sectionNumber: 1 },
});

const finalSection = await localizeHtmlPage({
  source: `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=6`,
  title: "Final Examination & Culminating",
  role: "final_examination_culminating",
  category: "moodle_course_section",
  targetDir: "course-sections/final-examination-culminating",
  bodySelector: "section",
  extra: { sectionNumber: 6 },
});

for (const item of [courseOverview, finalSection]) {
  upsertByKey(manifest.courseSections, item);
  upsertByKey(manifest.courseDownloads, {
    ...item,
    category: "course_document",
    role: item.role === "course_overview" ? "introduction" : item.role,
  });
}

const courseActivities = [
  { id: 8333, mod: "assign", label: "MHF4U Course Outline", role: "course_outline", teacherUse: "course_setup", introOnly: true, appendAttachments: false, hideAttachmentDates: true },
  { id: 8334, mod: "assign", label: "Learning Log", role: "learning_log", teacherUse: "student_tracking_template" },
];

const excludedCourseActivityIds = new Set(["8433", "8434", "9495"]);

const courseActivityRecords = [];
for (const activity of courseActivities) {
  const item = await activityRecord(activity);
  if (item.skipped) {
    skippedActivities.push(item);
    continue;
  }
  courseActivityRecords.push(item);
  upsertByKey(manifest.courseDownloads, item);
}

const evaluationRecords = [];
for (const unit of manifest.units || []) {
  const unitNumber = Number(unit.unit);
  unit.unitResources ||= {};
  const evaluations = [];
  for (const activity of unitEvaluations[unitNumber] || []) {
    const item = await activityRecord({ ...activity, unit: unitNumber, teacherUse: "assessment_preparation" });
    if (item.skipped) {
      skippedActivities.push(item);
      continue;
    }
    evaluations.push(item);
    evaluationRecords.push(item);
  }
  unit.unitResources.evaluations = evaluations;

  const reflectionAndLogs = [
    localResourceByName(manifest, unitNumber, new RegExp(`Unit-${unitNumber}-KWL-Chart`, "i"), "kwl"),
    localResourceByName(manifest, unitNumber, new RegExp(`Unit-${unitNumber}-End-of-Unit-Reflection`, "i"), "unit_reflection"),
  ].filter(Boolean);
  for (const activity of reflectionActivities[unitNumber] || []) {
    const item = await activityRecord({ ...activity, unit: unitNumber, teacherUse: "student_tracking" });
    if (item.skipped) {
      skippedActivities.push(item);
      continue;
    }
    reflectionAndLogs.push(item);
  }
  unit.unitResources.reflectionAndLogs = reflectionAndLogs;
}

const answerKeyRecords = [];
for (const [unit, lesson, id] of answerPages) {
  const item = await activityRecord({
    id,
    mod: "page",
    label: `Unit ${unit} Lesson ${lesson} Answer`,
    role: "answer_keys",
    unit,
    teacherUse: "teacher_packet",
  });
  item.teacherOnly = true;
  item.lesson = lesson;
  answerKeyRecords.push(item);
}

manifest.evaluations = evaluationRecords.map((item) => ({ ...item }));
const managedTeacherActivityIds = new Set([
  ...excludedCourseActivityIds,
  ...Object.values(unitEvaluations).flat().map((item) => String(item.id)),
  ...answerPages.map(([, , id]) => String(id)),
]);

manifest.teacherResources = [
  ...manifest.teacherResources.filter((item) => !item.moodleActivityId || !managedTeacherActivityIds.has(String(item.moodleActivityId))),
  ...courseActivityRecords
    .filter((item) => ["final_exam_submission", "culminating_submission"].includes(item.role))
    .map((item) => ({ ...item })),
  ...evaluationRecords.map((item) => ({
    ...item,
    teacherUse: item.role === "aol_quiz" ? "quiz_review" : "assessment_preparation",
  })),
  ...answerKeyRecords,
];

manifest.courseDownloads = dedupeList(manifest.courseDownloads).filter((item) => !item.moodleActivityId || !excludedCourseActivityIds.has(String(item.moodleActivityId)));
manifest.courseSections = dedupeList(manifest.courseSections);
manifest.evaluations = dedupeList(manifest.evaluations);
manifest.teacherResources = dedupeList(manifest.teacherResources);

scrubManifestMoodleMainLinks(manifest);

manifest.navigation = {
  ...(manifest.navigation || {}),
  primary: "unit",
  secondary: "lesson",
  structureLabel: "Moodle Course Resources",
};

manifest.sourceAudit ||= {};
manifest.sourceAudit.mhf4uFinalizePatch = {
  patchedAt: new Date().toISOString(),
  courseSections: manifest.courseSections.length,
  courseActivities: courseActivities.length,
  evaluations: manifest.evaluations.length,
  reflectionAndLogResources: manifest.units.reduce((sum, unit) => sum + (unit.unitResources?.reflectionAndLogs?.length || 0), 0),
  answerKeys: answerKeyRecords.length,
  skippedLoginActivities: skippedActivities.length,
  skippedLoginActivityLabels: skippedActivities.map((item) => item.label),
  fileResourcesWithPaths: countPathItems(manifest),
  exitCardsExcluded: true,
  notes:
    "Localized MHF4U course overview, final/culminating, course outline, learning log, AOL quiz/test/assignment activities, and KWL/reflection resources. Exit Cards are excluded as formative student activities. Moodle answer page links returned login pages, so they are excluded from Teacher Resources.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify(manifest.sourceAudit.mhf4uFinalizePatch, null, 2));


