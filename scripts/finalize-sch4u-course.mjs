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
const course = "SCH4U";
const moodleCourseId = 82;
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
  for (const attachment of item.attachments || []) withFileStats(attachment);
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

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ");
}

function filenameFromUrl(url) {
  const parsed = new URL(decodeEntities(url));
  const forced = parsed.searchParams.get("forcedownload") ? "" : "";
  const raw = decodeURIComponent(basename(parsed.pathname) || forced || "resource");
  return raw || "resource";
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  for (const match of String(html || "").matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php)[^"']*)["']/gi)) {
    try {
      urls.add(new URL(decodeEntities(match[1]), baseUrl).toString());
    } catch {
      // Ignore malformed Moodle fragment links.
    }
  }
  return [...urls];
}

function extensionFor(filename, contentType) {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/word|officedocument/i.test(contentType)) return "docx";
  if (/html/i.test(contentType)) return "html";
  if (/jpeg/i.test(contentType)) return "jpg";
  if (/png/i.test(contentType)) return "png";
  if (/mp4/i.test(contentType)) return "mp4";
  return "file";
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
    const value = headers.get("set-cookie") || "";
    for (const cookieText of value.split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = cookieText.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar(process.env.MOODLE_COOKIE || "");

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-sch4u-finalizer/1.0");
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
  if (process.env.MOODLE_COOKIE) return;
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

function writeLocalPage({ title, targetDir, body, source, role, category, attachments = [], extra = {} }) {
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
  const attachmentsBlock = attachmentLinks ? `<h2>Attachments</h2>\n<ul>\n${attachmentLinks}\n</ul>` : "";
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
    type: "html",
    category,
    role,
    path: rel,
    source,
    extra: { attachments, textPreview: stripTags(body).slice(0, 800), ...extra },
  });
}

async function localizeCourseSection({ sectionNumber, title, role, targetDir }) {
  const source = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=${sectionNumber}`;
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(rawHtml.slice(0, 2000))) {
    throw new Error(`Moodle login page returned for ${source}`);
  }
  const rawBody = extractSectionBody(rawHtml, sectionNumber);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(rawBody, source)) {
    const attachment = await downloadFile(url, join(targetDir, "files"));
    attachments.push(attachment);
    localByUrl.set(url, attachment);
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    localByUrl.set(parsed.toString(), attachment);
  }
  let body = cleanHtmlBody(rawBody);
  body = body.replace(/\b(href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(decodeEntities(raw), source).toString();
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      const attachment = localByUrl.get(url) || localByUrl.get(parsed.toString());
      if (attachment?.path) {
        const localHref = toPosix(relative(join(courseRoot, targetDir), join(courseRoot, attachment.path)));
        return `${attr}="${htmlEscape(localHref, true)}"`;
      }
    } catch {
      // Keep original match for non-Moodle URLs until cleanup below.
    }
    return match;
  });
  body = body
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/(?:pluginfile|draftfile)\.php[^"']*["']/gi, ' data-localized-link="removed"');
  return writeLocalPage({
    title,
    targetDir,
    body,
    source,
    role,
    category: "moodle_course_section",
    attachments,
    extra: { sectionNumber },
  });
}

function findCourseDownload(manifest, role, unit) {
  return (manifest.courseDownloads || []).find((item) => {
    if (item.role !== role) return false;
    if (!unit) return true;
    return new RegExp(`Unit ${unit}\\b`, "i").test(item.label || "");
  });
}

function annotateActivity(item, extra = {}) {
  const copy = withFileStats({ ...item, ...extra });
  if (copy.source && /\/mod\/([^/]+)\/view\.php\?id=(\d+)/i.test(copy.source)) {
    const match = /\/mod\/([^/]+)\/view\.php\?id=(\d+)/i.exec(copy.source);
    copy.mod = match[1];
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

function countResourceItems(manifest) {
  let checkedCount = 0;
  let okCount = 0;
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    for (const key of ["path", "previewPath", "downloadPath"]) {
      if (!item[key]) continue;
      checkedCount += 1;
      if (existsSync(join(courseRoot, item[key]))) okCount += 1;
    }
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
      for (const item of lesson.downloads || []) visit(item);
      for (const item of lesson.bookSections || []) visit(item);
      for (const item of lesson.textExports || []) visit(item);
      for (const item of lesson.ispring || []) visit(item);
    }
  }
  return { checkedCount, okCount };
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
      for (const item of lesson.downloads || []) visit(item);
      for (const item of lesson.bookSections || []) visit(item);
      for (const item of lesson.textExports || []) visit(item);
      for (const item of lesson.ispring || []) visit(item);
    }
  }
  return count;
}

function scrubMoodleMainLinks(item) {
  if (!item || typeof item !== "object") return;
  for (const key of ["url", "downloadUrl", "previewUrl"]) {
    if (item[key] && /(^|\/\/)www\.esunnybrook\.com/i.test(String(item[key])) && item.path) delete item[key];
  }
  for (const attachment of item.attachments || []) scrubMoodleMainLinks(attachment);
}

function scrubManifestMoodleMainLinks(manifest) {
  const visit = (item) => scrubMoodleMainLinks(item);
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
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseDownloads ||= [];
manifest.courseSections ||= [];
manifest.evaluations ||= [];
manifest.teacherResources ||= [];
manifest.navigation = { primary: "unit", secondary: "lesson" };

const courseSections = [
  await localizeCourseSection({
    sectionNumber: 1,
    title: "Course Overview",
    role: "course_overview",
    targetDir: "course-sections/course-overview",
  }),
  await localizeCourseSection({
    sectionNumber: 7,
    title: "Final Examination & Culminating",
    role: "final_examination_culminating",
    targetDir: "course-sections/final-examination-culminating",
  }),
  await localizeCourseSection({
    sectionNumber: 8,
    title: "Teacher Packet",
    role: "teacher_packet",
    targetDir: "course-sections/teacher-packet",
  }),
];

for (const item of courseSections) {
  upsertByKey(manifest.courseSections, item);
  upsertByKey(manifest.courseDownloads, { ...item, category: "course_document" });
}

const unitTitles = {
  1: "Structure and Properties",
  2: "Chemical Systems and Equilibrium",
  3: "Organic Chemistry",
  4: "Energy Changes and Rates of Reaction",
  5: "Electrochemistry",
};

const courseLevelRoles = new Set([
  "lab_template",
  "course_outline",
  "learning_log",
  "exam_submission",
  "culminating_submission",
  "answer_keys",
  "course_overview",
  "final_examination_culminating",
  "teacher_packet",
]);

manifest.courseDownloads = dedupeList(
  (manifest.courseDownloads || [])
    .map((item) => {
      const copy = annotateActivity(item);
      if (copy.role === "exam_submission") copy.role = "final_exam_submission";
      if (copy.role === "answer_keys") {
        copy.teacherOnly = true;
        copy.teacherUse = "answer_key_reference";
      }
      return copy;
    })
    .filter((item) => courseLevelRoles.has(item.role)),
);

const answerKeys = findCourseDownload(manifest, "answer_keys");
const finalExam = findCourseDownload(manifest, "final_exam_submission");
const culminating = findCourseDownload(manifest, "culminating_submission");

const evaluationRecords = [];
for (const unit of manifest.units || []) {
  const unitNumber = Number(unit.unit);
  unit.title = unitTitles[unitNumber] || unit.title;
  unit.coreTexts ||= [];
  unit.unitResources ||= {};

  const evaluations = [
    findCourseDownload({ courseDownloads: readJson(manifestPath).courseDownloads }, "unit_lab", unitNumber),
    findCourseDownload({ courseDownloads: readJson(manifestPath).courseDownloads }, "quiz", unitNumber),
    (readJson(manifestPath).courseDownloads || []).filter((item) => item.role === "quiz" && new RegExp(`Unit ${unitNumber} - Test`, "i").test(item.label || ""))[0],
    findCourseDownload({ courseDownloads: readJson(manifestPath).courseDownloads }, "unit_assignment", unitNumber),
  ]
    .filter(Boolean)
    .map((item) => cloneForUnit(item, unitNumber, item.role === "unit_lab" ? "aol_lab" : item.role === "unit_assignment" ? "aol_assignment" : "aol_quiz", "teacher_preparation"));

  const reflectionAndLogs = [
    findCourseDownload({ courseDownloads: readJson(manifestPath).courseDownloads }, "kwl_dropbox", unitNumber),
    findCourseDownload({ courseDownloads: readJson(manifestPath).courseDownloads }, "reflection_dropbox", unitNumber),
  ]
    .filter(Boolean)
    .map((item) => cloneForUnit(item, unitNumber, item.role, "teacher_preparation"));

  unit.unitResources.evaluations = dedupeList(evaluations);
  unit.unitResources.reflectionAndLogs = dedupeList(reflectionAndLogs);
  evaluationRecords.push(...unit.unitResources.evaluations);

  const ispringCount = unit.lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0);
  const downloadCount = unit.lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  const h5pCount = countItems({ units: [unit] }, (item) => item.type === "h5p" || /h5p/i.test(item.category || "") || /\.h5p$/i.test(item.path || ""));
  unit.summary = {
    ...(unit.summary || {}),
    downloads: downloadCount + unit.unitResources.evaluations.length + unit.unitResources.reflectionAndLogs.length,
    ispring: ispringCount,
    h5p: h5pCount,
  };
}

manifest.evaluations = dedupeList(evaluationRecords);
manifest.teacherResources = dedupeList([
  ...courseSections.filter((item) => item.role === "teacher_packet"),
  answerKeys,
  finalExam,
  culminating,
  ...evaluationRecords,
].filter(Boolean).map((item) => annotateActivity(item, { teacherUse: item.teacherUse || "teacher_preparation" })));

scrubManifestMoodleMainLinks(manifest);

const resourceValidation = countResourceItems(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  lessonCount: manifest.units.reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
  ispringExpected: 44,
  ispringComplete: countItems(manifest, (item) => item.packagePath && item.path),
  h5pPackages: countItems(manifest, (item) => item.type === "h5p" || /\.h5p$/i.test(item.path || "")),
  videos: countItems(manifest, (item) => item.type === "mp4"),
  teacherResources: manifest.teacherResources.length,
  courseSections: manifest.courseSections.length,
  resourceValidation,
  structureNote: "SCH4U manifest finalized into Course Resources, Unit-level Moodle evaluation/reflection groups, localized lessons, iSpring, H5P, video, and Teacher Resources without Moodle URLs as primary links.",
};

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseDownloads: manifest.courseDownloads.length,
  courseSections: manifest.courseSections.length,
  teacherResources: manifest.teacherResources.length,
  evaluations: manifest.evaluations.length,
  units: manifest.units.map((unit) => ({
    unit: unit.unit,
    title: unit.title,
    evaluations: unit.unitResources.evaluations.length,
    reflectionAndLogs: unit.unitResources.reflectionAndLogs.length,
    lessons: unit.lessons.length,
    ispring: unit.summary.ispring,
  })),
  resourceValidation,
}, null, 2));
