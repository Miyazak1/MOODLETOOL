import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const rawSectionsRoot = join(courseRoot, "moodle-course-sections-raw");

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

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "resource";
}

function fileRecord({ label, type, category, role, path, source, extra = {} }) {
  const abs = join(courseRoot, path);
  return {
    label,
    type,
    category,
    role,
    path: toPosix(path),
    bytes: existsSync(abs) ? statSync(abs).size : 0,
    source,
    ...extra,
  };
}

function activityRecord(id, label, role, extra = {}) {
  const mod = extra.mod || (/forum/i.test(label) ? "forum" : /quiz/i.test(label) ? "quiz" : "assign");
  return {
    label,
    type: "html",
    category: `moodle_${mod}`,
    role,
    url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    source: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    moodleActivityId: String(id),
    teacherUse: extra.teacherUse || "teacher_preparation",
    ...extra,
  };
}

function directFileRecord(url, label, role, category = "course_document") {
  return {
    label,
    type: extname(label).replace(".", "").toLowerCase() || "file",
    category,
    role,
    url,
    source: url,
    teacherUse: "teacher_preparation",
  };
}

function upsertByKey(list, record) {
  const key = record.path || record.url || record.source || record.label;
  const index = list.findIndex((item) => (item.path || item.url || item.source || item.label) === key || (record.moodleActivityId && item.moodleActivityId === record.moodleActivityId));
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

function setArrayResource(unit, key, records) {
  unit.unitResources = unit.unitResources || {};
  unit.unitResources[key] = records;
}

function extractSectionBody(rawHtml, sectionId) {
  const sectionPattern = new RegExp(`<li\\b[^>]*(?:id=["']section-${sectionId}["']|data-sectionid=["']${sectionId}["'])[^>]*>([\\s\\S]*?)(?=<li\\b[^>]*(?:id=["']section-|data-sectionid=)|<\\/ul>\\s*<\\/li>|$)`, "i");
  return sectionPattern.exec(rawHtml)?.[1] || rawHtml;
}

function cleanSectionBody(rawHtml) {
  return String(rawHtml || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bcard-section-(?:left|right)nav\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bprogress-bar-warpper\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "")
    .replace(/<ul\b[^>]*class=["'][^"']*\bactivity-cards\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, "");
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  for (const match of String(html || "").matchAll(/\b(?:href|src)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi)) {
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
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  return "bin";
}

function validateSignature(type, buffer, contentType = "") {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const startsWithPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (["docx", "pptx", "xlsx"].includes(type) && !startsWithPk) throw new Error(`downloaded ${type} is not an OOXML package`);
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
  headers.set("user-agent", "ossd-course-portal-eng3u-teacher-evaluation-patch/1.0");
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
  if (/name=["']username["']|name=["']password["']/i.test(text)) throw new Error("Moodle login failed.");
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
  const filename = filenameFromUrl(response.url || url);
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

async function buildCourseSectionPage({ sectionNumber, sectionId, title, role, targetDir }) {
  const rawPath = join(rawSectionsRoot, `section-${sectionNumber}.html`);
  const source = `https://www.esunnybrook.com/course/view.php?id=86&section=${sectionNumber}`;
  const rawHtml = existsSync(rawPath) ? readFileSync(rawPath, "utf8") : await (await request(source)).text();
  const bodyRaw = extractSectionBody(rawHtml, sectionId);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(bodyRaw, source)) {
    const attachment = await downloadFile(url, join(targetDir, "files"));
    attachments.push(attachment);
    localByUrl.set(url, attachment);
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      localByUrl.set(parsed.toString(), attachment);
    } catch {
      // Keep the exact URL mapping only.
    }
  }
  let body = cleanSectionBody(bodyRaw);
  body = body.replace(/\b(href|src)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), source).toString();
      const key = localByUrl.get(url) || localByUrl.get(url.replace(/[?#].*$/, ""));
      if (key?.path) {
        const localHref = toPosix(relative(join(courseRoot, targetDir), join(courseRoot, key.path)));
        return `${attr}="${htmlEscape(localHref, true)}"`;
      }
    } catch {
      // Fall through to the original attribute.
    }
    return match;
  });
  body = body
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"');
  for (const attachment of attachments) {
    const href = toPosix(relative(join(courseRoot, targetDir), join(courseRoot, attachment.path)));
    body += `\n<p><a href="${htmlEscape(href, true)}" download>${htmlEscape(attachment.label)}</a></p>`;
  }
  const rel = toPosix(join(targetDir, "index.html"));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
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
    img { max-width: 100%; height: auto; }
    a { color: #00396f; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${body}
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
    category: "moodle_course_section",
    role,
    path: rel,
    source,
    extra: { attachments, textPreview: stripTags(body).slice(0, 500) },
  });
}

function allManifestFileItems(manifest) {
  const items = [];
  const push = (item) => {
    if (!item) return;
    items.push(item);
    for (const attachment of item.attachments || []) push(attachment);
  };
  for (const item of manifest.courseDownloads || []) push(item);
  for (const item of manifest.evaluations || []) push(item);
  for (const item of manifest.teacherResources || []) push(item);
  for (const item of manifest.courseSections || []) push(item);
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) push(unit.unitPlan);
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(push);
      else if (typeof value === "object") push(value);
    }
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) push(lesson.lessonPlan);
      for (const item of lesson.downloads || []) push(item);
      for (const item of lesson.bookSections || []) push(item);
      for (const item of lesson.textExports || []) push(item);
    }
  }
  return items;
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseDownloads ||= [];
manifest.courseSections ||= [];
manifest.evaluations ||= [];
manifest.teacherResources ||= [];

const courseOverview = await buildCourseSectionPage({
  sectionNumber: 1,
  sectionId: 1,
  title: "Course Overview",
  role: "course_overview",
  targetDir: "course-sections/course-overview",
});
const finalSection = await buildCourseSectionPage({
  sectionNumber: 7,
  sectionId: 7,
  title: "Final Examination & Culminating",
  role: "final_examination_culminating",
  targetDir: "course-sections/final-examination-culminating",
});
const teacherPacket = await buildCourseSectionPage({
  sectionNumber: 8,
  sectionId: 8,
  title: "Teacher Packet",
  role: "teacher_packet",
  targetDir: "course-sections/teacher-packet",
});

for (const item of [courseOverview, finalSection, teacherPacket]) {
  upsertByKey(manifest.courseSections, item);
  upsertByKey(manifest.courseDownloads, { ...item, category: "course_document" });
}

const courseLevel = [
  activityRecord(9241, "ENG3U Course Outline", "course_outline", { teacherUse: "course_setup" }),
  activityRecord(9242, "Learning Log", "learning_log", { teacherUse: "student_tracking_template" }),
  directFileRecord("https://www.esunnybrook.com/pluginfile.php/9472/course/section/882/ENG3U-Course-Culminating-Assignment.docx", "ENG3U-Course-Culminating-Assignment.docx", "culminating_assignment"),
  activityRecord(9354, "Exam Submission Dropbox", "final_exam_submission", { teacherUse: "final_evaluation" }),
  activityRecord(9355, "Culminating Submission Dropbox", "culminating_submission", { teacherUse: "final_evaluation" }),
  activityRecord(9356, "Answer Keys", "answer_keys", { teacherUse: "teacher_packet", teacherOnly: true }),
];
for (const item of courseLevel) upsertByKey(manifest.courseDownloads, item);

const unitEvaluations = {
  1: [
    activityRecord(9246, "Unit 1 - Assignment (AOL)", "aol_assignment"),
    activityRecord(9247, "Unit 1 - Assignment (Part 2 - Peer Review and Editing)(AOL)", "aol_peer_review_forum", { mod: "forum" }),
    activityRecord(9248, "Unit 1 - Assignment 2 (AOL)", "aol_assignment"),
    activityRecord(9249, "Unit 1 - Quiz (AOL)", "aol_quiz", { mod: "quiz" }),
  ],
  2: [
    activityRecord(9269, "Unit 2 - Assignment 1 (AOL)", "aol_assignment"),
    activityRecord(9270, "Unit 2 - Assignment 2 (AOL)", "aol_assignment"),
    activityRecord(9271, "Unit 2 - Quiz (AOL)", "aol_quiz", { mod: "quiz" }),
  ],
  3: [
    activityRecord(9294, "Unit 3 - Assignment 1 (AOL)", "aol_assignment"),
    activityRecord(9295, "Unit 3 - Assignment 2 (AOL)", "aol_assignment"),
    activityRecord(9296, "Unit 3 - Quiz (AOL)", "aol_quiz", { mod: "quiz" }),
  ],
  4: [
    activityRecord(9319, "Unit 4 - Assignment 1 (AOL)", "aol_assignment"),
    activityRecord(9320, "Unit 4 - Assignment 2 (AOL)", "aol_assignment"),
    activityRecord(9321, "Unit 4 - Quiz (AOL)", "aol_quiz", { mod: "quiz" }),
  ],
  5: [
    activityRecord(9342, "Unit 5 - Assignment 1 (AOL)", "aol_assignment"),
    activityRecord(9343, "Unit 5 - Assignment 2 (AOL)", "aol_assignment"),
    activityRecord(9344, "Unit 5 - Assignment 3 (AOL)", "aol_assignment"),
  ],
};

const reflectionAndLogs = {
  1: [activityRecord(9264, "Unit 1 - KWL Dropbox", "kwl_dropbox"), activityRecord(9265, "Unit 1 - Reflection Summary Dropbox", "reflection_dropbox")],
  2: [activityRecord(9289, "Unit 2 - KWL Dropbox", "kwl_dropbox"), activityRecord(9290, "Unit 2 - Reflection Summary Dropbox", "reflection_dropbox")],
  3: [activityRecord(9314, "Unit 3 - KWL Dropbox", "kwl_dropbox"), activityRecord(9315, "Unit 3 - Reflection Summary Dropbox", "reflection_dropbox")],
  4: [activityRecord(9337, "Unit 4 - KWL Dropbox", "kwl_dropbox"), activityRecord(9338, "Unit 4 - Reflection Summary Dropbox", "reflection_dropbox")],
  5: [activityRecord(9352, "Unit 5 - KWL Dropbox", "kwl_dropbox"), activityRecord(9353, "Unit 5 - Reflection Summary Dropbox", "reflection_dropbox")],
};

for (const unit of manifest.units || []) {
  setArrayResource(unit, "evaluations", unitEvaluations[unit.unit] || []);
  setArrayResource(unit, "reflectionAndLogs", reflectionAndLogs[unit.unit] || []);
  delete unit.unitResources.extraExitCardPossiblyMismatch;
}

manifest.evaluations = Object.entries(unitEvaluations).flatMap(([unit, items]) => items.map((item) => ({ ...item, unit: Number(unit) })));
manifest.teacherResources = [
  teacherPacket,
  activityRecord(9356, "Answer Keys", "answer_keys", { teacherUse: "teacher_packet", teacherOnly: true }),
  ...Object.entries(unitEvaluations).flatMap(([unit, items]) =>
    items.map((item) => ({ ...item, unit: Number(unit), teacherUse: item.role === "aol_quiz" ? "rubric_and_quiz_review" : "assessment_preparation" })),
  ),
];

manifest.sourceAudit ||= {};
manifest.sourceAudit.eng3uTeacherEvaluationPatch = {
  patchedAt: new Date().toISOString(),
  courseSections: manifest.courseSections.length,
  evaluations: manifest.evaluations.length,
  reflectionAndLogActivities: Object.values(reflectionAndLogs).reduce((sum, items) => sum + items.length, 0),
  teacherResources: manifest.teacherResources.length,
  exitCardsExcluded: true,
  notes: "Teacher-facing ENG3U course overview, final/culminating, teacher packet, AOL, quiz rubrics, KWL and reflection activities were added as localizable teacher preparation resources. Student formative-only activities are excluded.",
};
manifest.sourceAudit.fileResourcesWithTeacherEvaluationPatch = allManifestFileItems(manifest).filter((item) => item.path || item.url).length;
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify(manifest.sourceAudit.eng3uTeacherEvaluationPatch, null, 2));
