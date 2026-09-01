import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SPH4U";
const moodleCourseId = 84;
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ");
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "resource";
}

function filenameFromUrl(url) {
  const parsed = new URL(decodeEntities(url));
  return decodeURIComponent(basename(parsed.pathname)) || "resource";
}

function extensionFor(filename, contentType = "") {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/presentationml/i.test(contentType)) return "pptx";
  if (/spreadsheetml/i.test(contentType)) return "xlsx";
  if (/jpeg/i.test(contentType)) return "jpg";
  if (/png/i.test(contentType)) return "png";
  return "file";
}

function validateSignature(type, buffer, contentType = "") {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  const startsWithJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const startsWithPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (["docx", "pptx", "xlsx"].includes(type) && !startsWithPk) throw new Error(`downloaded ${type} is not an OOXML package`);
  if (type === "doc" && !startsWithOle) throw new Error("downloaded file is not a legacy DOC");
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
  headers.set("user-agent", "ossd-course-portal-sph4u-finalizer/1.0");
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
  const html = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login failed.");
  return { loggedIn: true, reason: "credentials" };
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  for (const match of String(html || "").matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi)) {
    try {
      const url = new URL(decodeEntities(match[1]), baseUrl).toString();
      if (!/\/pluginfile\.php\/\d+\/theme_/i.test(url)) urls.add(url);
    } catch {
      // Ignore malformed Moodle fragments.
    }
  }
  return [...urls];
}

async function downloadFile(url, targetDir) {
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (/text\/html/i.test(contentType) && /name=["']username["']|logintoken/i.test(buffer.subarray(0, 1200).toString("utf8"))) {
    throw new Error(`Moodle login page returned for ${url}`);
  }
  const filename = filenameFromUrl(response.url || url);
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer, contentType);
  const rel = toPosix(join(targetDir, `${hashText(url)}-${sanitizeSegment(filename)}`));
  const abs = join(courseRoot, rel);
  if (!existsSync(abs) || statSync(abs).size !== buffer.length) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buffer);
  }
  const record = withFileStats({
    label: filename,
    type,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: rel,
    source: url,
  });
  return record;
}

function findMatchingClose(source, openEnd, tagName) {
  const pattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  pattern.lastIndex = openEnd;
  let depth = 1;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const token = match[0];
    if (/^<\//.test(token)) depth -= 1;
    else if (!/\/>$/.test(token)) depth += 1;
    if (depth === 0) return pattern.lastIndex;
  }
  return -1;
}

function extractElementByToken(html, token) {
  const source = String(html || "");
  const tokenIndex = source.search(token);
  if (tokenIndex < 0) return "";
  const openStart = source.lastIndexOf("<li", tokenIndex);
  if (openStart < 0) return "";
  const openEnd = source.indexOf(">", openStart);
  if (openEnd < 0) return "";
  const closeEnd = findMatchingClose(source, openEnd + 1, "li");
  return closeEnd > openEnd ? source.slice(openStart, closeEnd) : "";
}

function extractMainContent(rawHtml) {
  return /<section\b[^>]*id=["']region-main["'][^>]*>([\s\S]*?)<\/section>/i.exec(rawHtml)?.[1]
    || /<div\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>\s*(?:<aside|<footer|$)/i.exec(rawHtml)?.[1]
    || rawHtml;
}

function extractSectionBody(rawHtml, sectionId, sectionNumber) {
  const byId = extractElementByToken(rawHtml, new RegExp(`(?:id=["']section-${sectionId}["']|data-sectionid=["']${sectionId}["'])`, "i"));
  if (byId) return byId;
  const byNumber = extractElementByToken(rawHtml, new RegExp(`(?:id=["']section-${sectionNumber}["']|data-number=["']${sectionNumber}["']|data-section=["']${sectionNumber}["'])`, "i"));
  return byNumber || extractMainContent(rawHtml);
}

function cleanHtmlBody(rawHtml) {
  return String(rawHtml || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "")
    .replace(/<form\b[^>]*(?:action=["'][^"']*course\/jumpto\.php[^"']*["']|id=["']coursesearch["'])[\s\S]*?<\/form>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bcard-section-(?:left|right)nav\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bprogress-bar-warpper\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "")
    .replace(/<ul\b[^>]*class=["'][^"']*\bactivity-cards\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\b(?:drawer|navbar|breadcrumb|secondary-navigation|courseindex|block-region|edwiser|rating|review|dropdown-menu)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/\sid=["']collapseSection-\d+["']/gi, "")
    .replace(/\sid=["']section-\d+["']/gi, "");
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

function standaloneHtml(title, body, attachments = []) {
  const files = attachments.length
    ? `<section class="attachments"><h2>Files</h2><ul>${attachments
        .map((item) => `<li><a href="${htmlEscape(item.href, true)}" download>${htmlEscape(item.label)}</a></li>`)
        .join("")}</ul></section>`
    : "";
  return `<!doctype html>
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
    h2 { font-size: 20px; margin: 18px 0 10px; }
    img, video, iframe { max-width: 100%; }
    a { color: #00396f; font-weight: 700; }
    li { margin: 8px 0; }
    .activity-item, .activity, .activity-instance { border: 1px solid #e3eaf3; border-radius: 6px; padding: 12px; margin: 10px 0; background: #fbfdff; list-style: none; }
    .sectionname, .single-section-title { font-size: 20px; font-weight: 700; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${body}
      ${files}
    </article>
  </main>
</body>
</html>
`;
}

function replaceLocalLinks(body, source, localByUrl, localActivityTargets, indexRel) {
  return body
    .replace(/\b(href|src|poster)\s*=\s*["']([^"']+)["']/gi, (match, attr, raw) => {
      try {
        const url = new URL(decodeEntities(raw), source).toString();
        const noQuery = url.replace(/[?#].*$/, "");
        const localFile = localByUrl.get(url) || localByUrl.get(noQuery);
        if (localFile?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, localFile.path), true)}"`;
        const localActivity = localActivityTargets.get(url) || localActivityTargets.get(noQuery);
        if (localActivity) return `${attr}="${htmlEscape(courseRelative(indexRel, localActivity), true)}"`;
        if (/^https?:\/\/www\.esunnybrook\.com\//i.test(url)) return `data-localized-link="removed"`;
      } catch {
        // Keep non-URL local fragments.
      }
      return match;
    })
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/(?:pluginfile|draftfile)\.php[^"']*["']/gi, ' data-localized-link="removed"');
}

async function localizeCourseSection({ sectionNumber, sectionId, title, role, targetDir, localActivityTargets }) {
  const source = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=${sectionNumber}`;
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(rawHtml.slice(0, 2000))) {
    throw new Error(`Moodle login page returned for ${source}`);
  }
  const rawBody = extractSectionBody(rawHtml, sectionId, sectionNumber);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(rawBody, source)) {
    const attachment = await downloadFile(url, join(targetDir, "files"));
    attachments.push(attachment);
    localByUrl.set(url, attachment);
    localByUrl.set(url.replace(/[?#].*$/, ""), attachment);
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = cleanHtmlBody(rawBody);
  body = replaceLocalLinks(body, source, localByUrl, localActivityTargets, indexRel);
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  const attachmentsWithHref = attachments.map((item) => ({ ...item, href: courseRelative(indexRel, item.path) }));
  writeFileSync(abs, standaloneHtml(title, body, attachmentsWithHref), "utf8");
  return withFileStats({
    label: title,
    type: "html",
    category: "moodle_course_section",
    role,
    path: indexRel,
    source,
    moodleSectionNumber: sectionNumber,
    moodleSectionId: String(sectionId),
    attachments,
    textPreview: stripTags(body).slice(0, 800),
  });
}

function previewPath(resourcePath) {
  const rel = `previews-html/${toPosix(resourcePath)}.html`;
  return existsSync(join(courseRoot, rel)) ? rel : undefined;
}

function withFileStats(item) {
  if (item?.path) {
    const abs = join(courseRoot, item.path);
    if (existsSync(abs)) item.bytes = statSync(abs).size;
    const preview = previewPath(item.path);
    if (preview) item.previewPath = preview;
  }
  for (const attachment of item.attachments || []) withFileStats(attachment);
  return item;
}

function annotateActivity(item, extra = {}) {
  const copy = withFileStats({ ...item, ...extra });
  const source = copy.source || copy.url || "";
  const match = /\/mod\/([^/]+)\/view\.php\?id=(\d+)/i.exec(source);
  if (match) {
    copy.mod = match[1].toLowerCase();
    copy.moodleActivityId = match[2];
  }
  delete copy.url;
  delete copy.downloadUrl;
  delete copy.previewUrl;
  for (const attachment of copy.attachments || []) {
    delete attachment.url;
    delete attachment.downloadUrl;
    delete attachment.previewUrl;
  }
  return copy;
}

function cloneForUnit(item, unit, role, teacherUse) {
  return annotateActivity(item, { unit, role, teacherUse });
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
    const key = item.path || item.moodleActivityId || item.source || item.label;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function findCourseDownload(manifest, role, unit) {
  return (manifest.courseDownloads || []).find((item) => {
    if (item.role !== role) return false;
    if (!unit) return true;
    return new RegExp(`Unit ${unit}\\b`, "i").test(item.label || "");
  });
}

function findCourseDownloads(manifest, role, unit) {
  return (manifest.courseDownloads || []).filter((item) => {
    if (item.role !== role) return false;
    if (!unit) return true;
    return new RegExp(`Unit ${unit}\\b`, "i").test(item.label || "");
  });
}

function buildActivityTargetMap(manifest) {
  const targets = new Map();
  const add = (item) => {
    if (!item?.path) return;
    const id = item.moodleActivityId || /\/mod\/([^/]+)\/view\.php\?id=(\d+)/i.exec(item.source || "")?.[2];
    const mod = item.mod || /\/mod\/([^/]+)\/view\.php\?id=(\d+)/i.exec(item.source || "")?.[1];
    if (!id || !mod) return;
    const url = `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`;
    targets.set(url, item.path);
    targets.set(url.replace(/[?#].*$/, ""), item.path);
  };
  for (const item of manifest.courseDownloads || []) add(item);
  for (const item of manifest.teacherResources || []) add(item);
  for (const unit of manifest.units || []) {
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(add);
      else add(value);
    }
    for (const lesson of unit.lessons || []) for (const item of lesson.downloads || []) add(item);
  }
  return targets;
}

function scrubItem(item) {
  if (!item || typeof item !== "object") return;
  if (item.failedAssets) {
    for (const asset of item.failedAssets) {
      if (asset.url && !asset.source) asset.source = asset.url;
      delete asset.url;
    }
  }
  const isPlayableOnly =
    String(item.type || "").toLowerCase() === "ispring"
    || String(item.category || "").toLowerCase().includes("ispring")
    || String(item.type || "").toLowerCase() === "mp4"
    || String(item.category || "").toLowerCase().includes("video")
    || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(`${item.path || ""} ${item.url || ""} ${item.downloadPath || ""} ${item.downloadUrl || ""}`);
  if (isPlayableOnly) {
    delete item.downloadPath;
    delete item.downloadUrl;
  }
  for (const key of ["url", "downloadUrl", "previewUrl"]) {
    if (item[key] && /(^|\/\/)www\.esunnybrook\.com|hexstruct/i.test(String(item[key])) && item.path) delete item[key];
  }
  for (const attachment of item.attachments || []) scrubItem(attachment);
}

function scrubManifest(manifest) {
  const visit = (item) => scrubItem(item);
  for (const item of manifest.courseDownloads || []) visit(item);
  for (const item of manifest.courseSections || []) visit(item);
  for (const item of manifest.teacherResources || []) visit(item);
  for (const item of manifest.evaluations || []) visit(item);
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) visit(unit.unitPlan);
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) visit(lesson.lessonPlan);
      for (const key of ["downloads", "bookSections", "textExports", "ispring"]) {
        for (const item of lesson[key] || []) visit(item);
      }
    }
  }
}

function countItems(manifest, predicate) {
  let count = 0;
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    if (predicate(item)) count += 1;
    for (const attachment of item.attachments || []) visit(attachment);
  };
  for (const item of manifest.courseDownloads || []) visit(item);
  for (const item of manifest.courseSections || []) visit(item);
  for (const item of manifest.teacherResources || []) visit(item);
  for (const item of manifest.evaluations || []) visit(item);
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) visit(unit.unitPlan);
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) visit(lesson.lessonPlan);
      for (const key of ["downloads", "bookSections", "textExports", "ispring"]) {
        for (const item of lesson[key] || []) visit(item);
      }
    }
  }
  return count;
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseDownloads ||= [];
manifest.courseSections ||= [];
manifest.teacherResources ||= [];
manifest.evaluations ||= [];
manifest.navigation = { primary: "unit", secondary: "lesson" };

manifest.courseDownloads = manifest.courseDownloads.map((item) => annotateActivity(item));
for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    lesson.downloads = (lesson.downloads || []).map((item) => annotateActivity(item));
  }
}
const activityDownloadsForUnitResources = manifest.courseDownloads.map((item) => ({ ...item }));

const localActivityTargets = buildActivityTargetMap(manifest);
const courseSections = [
  await localizeCourseSection({
    sectionNumber: 1,
    sectionId: 868,
    title: "Course Overview",
    role: "course_overview",
    targetDir: "course-sections/course-overview",
    localActivityTargets,
  }),
  await localizeCourseSection({
    sectionNumber: 7,
    sectionId: 893,
    title: "Final Exam and Culminating",
    role: "final_examination_culminating",
    targetDir: "course-sections/final-exam-and-culminating",
    localActivityTargets,
  }),
  await localizeCourseSection({
    sectionNumber: 8,
    sectionId: 874,
    title: "Teacher Packet",
    role: "teacher_packet",
    targetDir: "course-sections/teacher-packet",
    localActivityTargets,
  }),
];

manifest.courseSections = (manifest.courseSections || []).filter(
  (item) => !["course_overview", "final_examination_culminating", "teacher_packet"].includes(item.role),
);
manifest.courseDownloads = (manifest.courseDownloads || []).filter(
  (item) => !["course_overview", "final_examination_culminating", "teacher_packet"].includes(item.role),
);
for (const item of courseSections) {
  upsertByKey(manifest.courseSections, item);
  upsertByKey(manifest.courseDownloads, { ...item, category: "course_document" });
}

const baseCourseRoles = new Set([
  "lab_template",
  "course_outline",
  "learning_log",
  "culminating_submission",
  "final_exam_submission",
  "answer_keys",
  "course_overview",
  "final_examination_culminating",
  "teacher_packet",
]);
manifest.courseDownloads = dedupeList(
  manifest.courseDownloads
    .map((item) => {
      const copy = annotateActivity(item);
      if (copy.role === "answer_keys") {
        copy.teacherOnly = true;
        copy.teacherUse = "answer_key_reference";
      }
      return copy;
    })
    .filter((item) => baseCourseRoles.has(item.role)),
);

const evaluationRecords = [];
const reflectionRecords = [];
const originalDownloads = activityDownloadsForUnitResources;
for (const unit of manifest.units || []) {
  const unitNumber = Number(unit.unit);
  unit.unitResources ||= {};
  const evaluations = [
    ...findCourseDownloads({ courseDownloads: originalDownloads }, "unit_lab", unitNumber),
    ...findCourseDownloads({ courseDownloads: originalDownloads }, "quiz", unitNumber),
  ].map((item) => cloneForUnit(item, unitNumber, item.role === "unit_lab" ? "aol_lab" : "aol_quiz", "teacher_preparation"));
  const reflections = [
    findCourseDownload({ courseDownloads: originalDownloads }, "kwl_dropbox", unitNumber),
    findCourseDownload({ courseDownloads: originalDownloads }, "reflection_dropbox", unitNumber),
  ].filter(Boolean).map((item) => cloneForUnit(item, unitNumber, item.role, "teacher_preparation"));
  unit.unitResources.evaluations = dedupeList(evaluations);
  unit.unitResources.reflectionAndLogs = dedupeList(reflections);
  evaluationRecords.push(...unit.unitResources.evaluations);
  reflectionRecords.push(...unit.unitResources.reflectionAndLogs);
  unit.summary = {
    ...(unit.summary || {}),
    downloads: unit.lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0)
      + unit.unitResources.evaluations.length
      + unit.unitResources.reflectionAndLogs.length,
    ispring: unit.lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0),
    h5p: countItems({ units: [unit] }, (item) => item.type === "h5p" || /h5p/i.test(item.category || "") || /\.h5p$/i.test(item.path || "")),
  };
}

const answerKeys = findCourseDownload(manifest, "answer_keys");
const finalExam = findCourseDownload(manifest, "final_exam_submission");
const culminating = findCourseDownload(manifest, "culminating_submission");

manifest.evaluations = dedupeList(evaluationRecords);
manifest.teacherResources = dedupeList([
  ...courseSections.filter((item) => item.role === "teacher_packet"),
  answerKeys,
  finalExam,
  culminating,
  ...evaluationRecords,
  ...reflectionRecords,
].filter(Boolean).map((item) => annotateActivity(item, { teacherUse: item.teacherUse || "teacher_preparation" })));

scrubManifest(manifest);

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  courseResourcesFinalizedAt: new Date().toISOString(),
  courseSections: manifest.courseSections.length,
  teacherResources: manifest.teacherResources.length,
  evaluations: manifest.evaluations.length,
  sph4uCourseResourcesPatch: {
    moodleCourseId,
    sections: [
      { sectionNumber: 1, sectionId: 868, role: "course_overview" },
      { sectionNumber: 7, sectionId: 893, role: "final_examination_culminating" },
      { sectionNumber: 8, sectionId: 874, role: "teacher_packet" },
    ],
    note: "Course-level sections are extracted from authenticated Moodle section bodies and localized. Unit labs/tests/KWL/reflection are grouped inside their units.",
  },
};

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseDownloads: manifest.courseDownloads.map((item) => ({ label: item.label, role: item.role, path: item.path, attachments: item.attachments?.length || 0 })),
  courseSections: manifest.courseSections.map((item) => ({ label: item.label, role: item.role, path: item.path, attachments: item.attachments?.length || 0 })),
  teacherResources: manifest.teacherResources.length,
  units: manifest.units.map((unit) => ({
    unit: unit.unit,
    evaluations: unit.unitResources?.evaluations?.length || 0,
    reflectionAndLogs: unit.unitResources?.reflectionAndLogs?.length || 0,
    lessons: unit.lessons?.length || 0,
  })),
}, null, 2));
