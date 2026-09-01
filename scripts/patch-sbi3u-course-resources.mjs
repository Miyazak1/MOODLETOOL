import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SBI3U");
const manifestPath = join(courseRoot, "course-manifest.json");
const moodleCourseId = 89;
const courseUrl = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=1`;

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

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "resource";
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
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extensionFor(filename, contentType) {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml|msword/i.test(contentType)) return "docx";
  if (/presentationml/i.test(contentType)) return "pptx";
  if (/spreadsheetml/i.test(contentType)) return "xlsx";
  if (/jpe?g/i.test(contentType)) return "jpg";
  if (/png/i.test(contentType)) return "png";
  if (/html/i.test(contentType)) return "html";
  return "bin";
}

function filenameFromHeaders(url, headers, fallback) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fromHeader = utfName || plainName;
  if (fromHeader) return decodeURIComponent(fromHeader);
  try {
    const fromUrl = decodeURIComponent(basename(new URL(url).pathname));
    if (fromUrl && fromUrl !== "view.php" && fromUrl !== "pluginfile.php") return fromUrl;
  } catch {
    // Keep fallback.
  }
  return fallback;
}

function validateSignature(type, buffer, contentType) {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (type === "docx" && !startsWithPk && !startsWithOle) throw new Error("downloaded docx is not an OOXML or legacy Word package");
  if (["xlsx", "pptx"].includes(type) && !startsWithPk) throw new Error(`downloaded ${type} is not an OOXML package`);
  if (type === "pdf" && !startsWithPdf) throw new Error("downloaded file is not a PDF");
  if (type === "doc" && !startsWithOle) throw new Error("downloaded file is not a legacy DOC");
  if (["jpg", "jpeg"].includes(type) && !(buffer[0] === 0xff && buffer[1] === 0xd8)) throw new Error("downloaded file is not a JPEG");
  if (type === "png" && !(buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)) throw new Error("downloaded file is not a PNG");
  if (type === "html" && !/html/i.test(contentType)) throw new Error("downloaded file is not HTML");
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
  headers.set("user-agent", "ossd-course-portal-sbi3u-course-resources/1.0");
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
  const text = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(text)) throw new Error("Moodle login failed.");
}

async function fetchBuffer(url) {
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { response, buffer, contentType };
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  const pattern = /\b(?:href|src)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const raw = match[1].replaceAll("&amp;", "&");
    try {
      const url = new URL(raw, baseUrl).toString();
      if (!/\/(?:theme|webservice)\//i.test(url) && !/\/pluginfile\.php\/\d+\/theme_[^/]+\//i.test(url)) urls.add(url);
    } catch {
      // Ignore malformed URLs.
    }
  }
  return [...urls];
}

function extractCollapseBody(rawHtml, collapseId) {
  const marker = `id="collapseSection-${collapseId}"`;
  const start = rawHtml.indexOf(marker);
  if (start < 0) throw new Error(`Missing collapseSection-${collapseId}`);
  const openStart = rawHtml.lastIndexOf("<div", start);
  if (openStart < 0) throw new Error(`Cannot locate collapseSection-${collapseId} opening div`);
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = openStart;
  let depth = 0;
  for (const match of rawHtml.matchAll(tagPattern)) {
    const tag = match[0];
    if (match.index < openStart) continue;
    if (/^<div\b/i.test(tag)) depth += 1;
    else depth -= 1;
    if (depth === 0) return rawHtml.slice(openStart, match.index + tag.length);
  }
  return rawHtml.slice(openStart);
}

function trimSectionNoise(html) {
  let body = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "")
    .replace(/<button\b[\s\S]*?<\/button>/gi, "")
    .replace(/<a\b[^>]*href=["'](?:javascript:void\(0\)|#|[^"']*course\/view\.php\?id=89[^"']*)["'][^>]*>[\s\S]*?<\/a>/gi, "");
  body = body
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"');
  return body;
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

async function downloadFile(url, targetDir, label) {
  const { response, buffer, contentType } = await fetchBuffer(url);
  const filename = filenameFromHeaders(response.url || url, response.headers, label || `${hashText(url)}.bin`);
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer, contentType);
  const rel = toPosix(join(targetDir, `${hashText(url)}-${sanitizeSegment(filename)}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
  return {
    label: filename,
    type,
    path: rel,
    bytes: buffer.length,
    source: url,
  };
}

function sectionHtml(title, body, attachments) {
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
    img { display: block; max-width: 100%; height: auto; margin: 12px 0; }
    a { color: #00396f; font-weight: 700; }
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

async function buildSectionPage(rawHtml, { collapseId, title, role, targetDir }) {
  const source = `${courseUrl}#collapseSection-${collapseId}`;
  rmSync(join(courseRoot, targetDir), { recursive: true, force: true });
  const bodyRaw = extractCollapseBody(rawHtml, collapseId);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(bodyRaw, courseUrl)) {
    const attachment = await downloadFile(url, join(targetDir, "files"));
    attachments.push(attachment);
    localByUrl.set(url, attachment);
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    localByUrl.set(parsed.toString(), attachment);
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = bodyRaw.replace(/\b(href|src)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), courseUrl).toString();
      const clean = new URL(url);
      clean.search = "";
      clean.hash = "";
      const local = localByUrl.get(url) || localByUrl.get(clean.toString());
      if (local?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, local.path), true)}"`;
    } catch {
      // Fall through.
    }
    return match;
  });
  body = trimSectionNoise(body);
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    sectionHtml(
      title,
      body,
      attachments.map((item) => ({ ...item, href: courseRelative(indexRel, item.path) })),
    ),
    "utf8",
  );
  return {
    label: title,
    type: "html",
    category: "moodle_course_section",
    role,
    path: indexRel,
    bytes: statSync(abs).size,
    source,
    attachments,
    textPreview: stripTags(body).slice(0, 500),
  };
}

async function buildOverviewImagePage(rawHtml) {
  const title = "Course Overview";
  const targetDir = "course-sections/course-overview";
  const source = `${courseUrl}#collapseSection-905`;
  rmSync(join(courseRoot, targetDir), { recursive: true, force: true });
  const urls = pluginfileUrls(rawHtml, courseUrl).filter((url) => /\/course\/section\/905\//i.test(url));
  const attachments = [];
  for (const url of urls) attachments.push(await downloadFile(url, join(targetDir, "files")));
  const indexRel = toPosix(join(targetDir, "index.html"));
  const body = attachments
    .map((item) => `<p><img src="${htmlEscape(courseRelative(indexRel, item.path), true)}" alt="${htmlEscape(item.label, true)}"></p>`)
    .join("\n");
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    sectionHtml(
      title,
      body,
      attachments.map((item) => ({ ...item, href: courseRelative(indexRel, item.path) })),
    ),
    "utf8",
  );
  return {
    label: title,
    type: "html",
    category: "moodle_course_section",
    role: "course_overview",
    path: indexRel,
    bytes: statSync(abs).size,
    source,
    attachments,
    textPreview: "Course overview images from Moodle section 1.",
  };
}

function activityRecord({ label, mod = "assign", id, role, teacherUse = "teacher_preparation", teacherOnly = false, category }) {
  return {
    label,
    type: "html",
    category: category || `moodle_${mod}`,
    role,
    url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    source: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    moodleActivityId: String(id),
    teacherUse,
    ...(teacherOnly ? { teacherOnly: true } : {}),
  };
}

function upsertByKey(list, record) {
  const key = record.moodleActivityId ? `activity:${record.moodleActivityId}` : record.path || record.url || record.source || record.label;
  const index = list.findIndex((item) => {
    const itemKey = item.moodleActivityId ? `activity:${item.moodleActivityId}` : item.path || item.url || item.source || item.label;
    return itemKey === key;
  });
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

await loginIfNeeded();
const response = await request(courseUrl);
const rawHtml = await response.text();
if (!response.ok) throw new Error(`HTTP ${response.status}`);

const manifest = readJson(manifestPath);
manifest.courseSections ||= [];
for (const record of [
  await buildSectionPage(rawHtml, { collapseId: 904, title: "SBI3U Course Resources", role: "course_resources", targetDir: "course-sections/sbi3u-course-resources" }),
  await buildOverviewImagePage(rawHtml),
  await buildSectionPage(rawHtml, { collapseId: 911, title: "Final Exam & Culminating", role: "final_examination_culminating", targetDir: "course-sections/final-exam-culminating" }),
  await buildSectionPage(rawHtml, { collapseId: 913, title: "Teacher Packet", role: "teacher_packet", targetDir: "course-sections/teacher-packet" }),
]) {
  upsertByKey(manifest.courseSections, record);
}

manifest.courseDownloads ||= [];
for (const item of manifest.courseDownloads) {
  if (item.role === "course_outline" || /Course Outline/i.test(item.label || "")) {
    item.category = "moodle_assign";
    item.role = "course_outline";
    item.moodleActivityId ||= "9640";
    item.source ||= "https://www.esunnybrook.com/mod/assign/view.php?id=9640";
    if (item.moodleActivityId === "9640" && item.path && !/^localized-moodle-activities\//i.test(item.path)) {
      delete item.path;
      delete item.previewPath;
      delete item.downloadPath;
      delete item.bytes;
      delete item.attachments;
      item.type = "html";
      item.url = "https://www.esunnybrook.com/mod/assign/view.php?id=9640";
      item.source = item.url;
    }
  }
}

for (const record of [
  activityRecord({ label: "Lab report template", mod: "resource", id: 9638, role: "lab_report_template", teacherUse: "course_preparation" }),
  activityRecord({ label: "Writing Formal Lab Reports", mod: "page", id: 9639, role: "formal_lab_reports", teacherUse: "course_preparation" }),
  activityRecord({ label: "SBI3U Course Outline", id: 9640, role: "course_outline", teacherUse: "course_planning" }),
  activityRecord({ label: "Learning Log", id: 9641, role: "learning_log", teacherUse: "student_progress_tracking" }),
  activityRecord({ label: "Culminating", id: 9770, role: "culminating_assignment", teacherUse: "final_evaluation" }),
  activityRecord({ label: "Final Exam Dropbox", id: 9771, role: "final_exam_submission", teacherUse: "final_evaluation" }),
]) {
  upsertByKey(manifest.courseDownloads, record);
}

manifest.teacherResources ||= [];
upsertByKey(
  manifest.teacherResources,
  activityRecord({ label: "Answer Keys", id: 9800, role: "answer_keys", teacherUse: "teacher_packet", teacherOnly: true }),
);

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseResourcesPatchedAt = new Date().toISOString();
manifest.sourceAudit.courseResourcesSource = courseUrl;
manifest.sourceAudit.courseResourceExpectedActivities = {
  labReportTemplate: 9638,
  writingFormalLabReports: 9639,
  courseOutline: 9640,
  learningLog: 9641,
  culminating: 9770,
  finalExamDropbox: 9771,
  answerKeys: 9800,
};

writeJson(manifestPath, manifest);
console.log(
  JSON.stringify(
    {
      courseSections: manifest.courseSections.length,
      courseDownloads: manifest.courseDownloads.length,
      teacherResources: manifest.teacherResources.length,
      source: courseUrl,
    },
    null,
    2,
  ),
);
