import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MCR3U";
const moodleCourseId = 76;
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

function filenameFromUrl(url) {
  const parsed = new URL(url);
  return decodeURIComponent(basename(parsed.pathname)) || `${hashText(url)}.bin`;
}

function extensionFor(filename, contentType = "") {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/powerpoint|presentationml/i.test(contentType)) return "pptx";
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  return "bin";
}

function validateSignature(type, buffer, contentType = "") {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  const startsWithJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const startsWithPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (type === "docx" && !startsWithPk && !startsWithOle) throw new Error("downloaded docx is not an OOXML or legacy Word package");
  if (["pptx", "xlsx"].includes(type) && !startsWithPk) throw new Error(`downloaded ${type} is not an OOXML package`);
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
  headers.set("user-agent", "ossd-course-portal-mcr3u-activity-patch/1.0");
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
  if (/name=["']username["']|name=["']password["']/i.test(html)) throw new Error("Moodle login failed.");
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

function extractSectionBody(rawHtml, sectionNumber) {
  const patterns = [
    new RegExp(`<li\\b[^>]*(?:id=["']section-${sectionNumber}["']|data-section=["']${sectionNumber}["'])[^>]*>([\\s\\S]*?)(?=<li\\b[^>]*(?:id=["']section-|data-section=)|<\\/ul>\\s*<\\/li>|$)`, "i"),
    new RegExp(`<div\\b[^>]*id=["']coursecontentcollapse${sectionNumber}["'][^>]*>([\\s\\S]*?)(?=<div\\b[^>]*id=["']coursecontentcollapse\\d+["']|$)`, "i"),
    new RegExp(`<div\\b[^>]*id=["']collapseSection-[^"']+["'][^>]*>([\\s\\S]*?)(?=<div\\b[^>]*id=["']collapseSection-|$)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(rawHtml);
    if (match?.[1]) return match[1];
  }
  return /<section\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/section>/i.exec(rawHtml)?.[1] || rawHtml;
}

function sectionContentOnly(rawHtml) {
  const blocks = [];
  for (const match of String(rawHtml || "").matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const block = match[1] || "";
    if (stripTags(block).length > 10) blocks.push(block);
  }
  return blocks.length ? blocks.join("\n") : rawHtml;
}

function cleanSectionBody(rawHtml) {
  return String(rawHtml || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\b(?:drawer|navbar|breadcrumb|secondary-navigation|courseindex|block-region|edwiser|rating|review|dropdown-menu)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"');
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
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
    img { max-width: 100%; height: auto; }
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

async function buildCourseSectionPage({ sectionNumber, title, role, targetDir }) {
  const source = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=${sectionNumber}`;
  const response = await request(source);
  const rawHtml = await response.text();
  const bodyRaw = extractSectionBody(rawHtml, sectionNumber);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(bodyRaw, source)) {
    const attachment = await downloadFile(url, join(targetDir, "files"));
    attachments.push(attachment);
    localByUrl.set(url, attachment);
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    localByUrl.set(parsed.toString(), attachment);
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = sectionContentOnly(bodyRaw).replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  body = body.replace(/\b(href|src)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), source).toString();
      const key = localByUrl.get(url) || localByUrl.get(url.replace(/[?#].*$/, ""));
      if (key?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, key.path), true)}"`;
    } catch {
      // Keep original below.
    }
    return match;
  });
  body = cleanSectionBody(body);
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

function activityRecord({ label, mod = "assign", id, role, unit, teacherUse = "teacher_preparation", teacherOnly = false }) {
  return {
    label,
    type: "html",
    category: `moodle_${mod}`,
    role,
    source: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    moodleActivityId: String(id),
    teacherUse,
    ...(unit ? { unit } : {}),
    ...(teacherOnly ? { teacherOnly: true } : {}),
  };
}

function localHtmlTextPreview(item) {
  if (!item?.path || !["html", "htm"].includes(String(item.type || "").toLowerCase())) return "";
  const abs = join(courseRoot, item.path);
  if (!existsSync(abs)) return "";
  const html = readFileSync(abs, "utf8");
  const content = /<div\b[^>]*class=["'][^"']*\bmoodle-content\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] || html;
  return stripTags(content).slice(0, 500);
}

function enrichEvaluationTextPreviews(manifest) {
  for (const item of manifest.evaluations || []) {
    const preview = localHtmlTextPreview(item);
    if (preview) item.textPreview = preview;
  }
  for (const unit of manifest.units || []) {
    for (const item of unit.unitResources?.evaluations || []) {
      const preview = localHtmlTextPreview(item);
      if (preview) item.textPreview = preview;
    }
  }
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

function lessonActivityParts(label) {
  const match = /^Unit\s+(\d+)\s+-\s+Lesson\s+(\d+)(?:\s+\(Answer\))?$/i.exec(String(label || "").trim());
  if (!match) return null;
  return {
    unit: Number(match[1]),
    lesson: Number(match[2]),
    answerRank: /\(Answer\)$/i.test(String(label || "").trim()) ? 1 : 0,
  };
}

function homeworkSubmissionSort(a, b) {
  const left = lessonActivityParts(a.label) || { unit: 999, lesson: 999, answerRank: 0 };
  const right = lessonActivityParts(b.label) || { unit: 999, lesson: 999, answerRank: 0 };
  return left.unit - right.unit || left.lesson - right.lesson || left.answerRank - right.answerRank || String(a.label || "").localeCompare(String(b.label || ""));
}

function isHomeworkSubmissionFolderItem(item) {
  const role = String(item?.role || "").toLowerCase();
  const scope = `${item?.parentSection || ""} ${item?.sourceGroup || ""}`.toLowerCase();
  return (
    /homework_submission_folder/.test(scope) ||
    ["homework_submission_page", "homework_answer_page", "lesson_dropbox", "lesson_answer_page"].includes(role) ||
    Boolean(lessonActivityParts(item?.label))
  );
}

function normalizeHomeworkSubmission(item, { answer = false } = {}) {
  const parts = lessonActivityParts(item.label) || {};
  const record = {
    ...item,
    role: answer ? "homework_answer_page" : "homework_submission_page",
    sourceGroup: "homework_submission_folder",
    parentSection: "Homework Submission Folder",
    category: item.category || (answer ? "moodle_page" : "moodle_assign"),
    teacherUse: answer ? "homework_answer_reference" : "student_submission",
    ...(parts.unit ? { unit: parts.unit } : {}),
    ...(parts.lesson ? { lesson: parts.lesson } : {}),
  };
  delete record.teacherOnly;
  return record;
}

const manifest = readJson(manifestPath);
await loginIfNeeded();

const sectionRecords = [
  await buildCourseSectionPage({ sectionNumber: 1, title: "Course Overview", role: "course_overview", targetDir: "course-sections/course-overview" }),
  await buildCourseSectionPage({ sectionNumber: 6, title: "Final Examination & Culminating", role: "final_examination_culminating", targetDir: "course-sections/final-examination-culminating" }),
  await buildCourseSectionPage({ sectionNumber: 7, title: "Teacher Packet", role: "teacher_packet", targetDir: "course-sections/teacher-packet" }),
];

manifest.courseSections = manifest.courseSections || [];
for (const record of sectionRecords) upsertByKey(manifest.courseSections, record);

const courseActivityDownloads = [
  activityRecord({ label: "MCR3U Course Outline", id: 8013, role: "course_outline", teacherUse: "course_planning" }),
  activityRecord({ label: "Learning Log", id: 8014, role: "learning_log", teacherUse: "student_progress_tracking" }),
  activityRecord({ label: "Final Exam Dropbox", id: 8105, role: "final_exam_submission", teacherUse: "assessment_preparation" }),
  activityRecord({ label: "Culminating Assignment Dropbox", id: 8106, role: "culminating_submission", teacherUse: "assessment_preparation" }),
];
manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "plans/course/MCR3U_Course_Outline.docx");
for (const record of courseActivityDownloads) upsertByKey(manifest.courseDownloads, record);

const unitActivities = {
  1: {
    evaluations: [
      ["Unit 1 Assignment (AOL)", "assign", 8018],
      ["Unit 1 - Quiz (AOL)", "quiz", 8019],
      ["Unit 1 - Test (AOL)", "quiz", 8020],
    ],
    reflectionAndLogs: [
      ["Unit 1 - KWL Dropbox", 8040, "kwl_dropbox"],
      ["Unit 1 - Reflection Summary Dropbox", 8041, "reflection_dropbox"],
    ],
    lessonDropboxes: [8022, 8024, 8026, 8028, 8030, 8032, 8034, 8036, 8038].map((id, index) => [`Unit 1 - Lesson ${index + 1}`, id]),
    answerPages: [8023, 8025, 8027, 8029, 8031, 8033, 8035, 8037, 8039].map((id, index) => [`Unit 1 - Lesson ${index + 1} (Answer)`, id]),
  },
  2: {
    evaluations: [
      ["Unit 2 Assignment (AOL)", "assign", 8045],
      ["Unit 2 - Quiz (AOL)", "quiz", 8046],
      ["Unit 2 - Test (AOL)", "quiz", 8047],
    ],
    reflectionAndLogs: [
      ["Unit 2 - KWL Dropbox", 8061, "kwl_dropbox"],
      ["Unit 2 - Reflection Summary Dropbox", 8062, "reflection_dropbox"],
    ],
    lessonDropboxes: [8049, 8051, 8053, 8055, 8057, 8059].map((id, index) => [`Unit 2 - Lesson ${index + 1}`, id]),
    answerPages: [8050, 8052, 8054, 8056, 8058, 8060].map((id, index) => [`Unit 2 - Lesson ${index + 1} (Answer)`, id]),
  },
  3: {
    evaluations: [
      ["Unit 3 Assignment (AOL)", "assign", 8066],
      ["Unit 3 - Quiz (AOL)", "quiz", 8067],
      ["Unit 3 - Test (AOL)", "quiz", 8068],
    ],
    reflectionAndLogs: [
      ["Unit 3 - KWL Dropbox", 8082, "kwl_dropbox"],
      ["Unit 3 - Reflection Summary Dropbox", 8083, "reflection_dropbox"],
    ],
    lessonDropboxes: [8070, 8072, 8074, 8076, 8078, 8080].map((id, index) => [`Unit 3 - Lesson ${index + 1}`, id]),
    answerPages: [8071, 8073, 8075, 8077, 8079, 8081].map((id, index) => [`Unit 3 - Lesson ${index + 1} (Answer)`, id]),
  },
  4: {
    evaluations: [
      ["Unit 4 Assignment (AOL)", "assign", 8087],
      ["Unit 4 - Quiz (AOL)", "quiz", 8088],
      ["Unit 4 - Test (AOL)", "quiz", 8089],
    ],
    reflectionAndLogs: [
      ["Unit 4 - KWL Dropbox", 8103, "kwl_dropbox"],
      ["Unit 4 - Reflection Summary Dropbox", 8104, "reflection_dropbox"],
    ],
    lessonDropboxes: [8091, 8093, 8095, 8097, 8099, 8101].map((id, index) => [`Unit 4 - Lesson ${index + 1}`, id]),
    answerPages: [8092, 8094, 8096, 8098, 8100, 8102].map((id, index) => [`Unit 4 - Lesson ${index + 1} (Answer)`, id]),
  },
};

manifest.evaluations = [];
manifest.teacherResources = manifest.teacherResources || [];
manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => !isHomeworkSubmissionFolderItem(item));
const homeworkSubmissionItems = [];

for (const unit of manifest.units || []) {
  const config = unitActivities[unit.unit];
  if (!config) continue;
  unit.unitResources = unit.unitResources || {};
  unit.unitResources.evaluations = [];
  unit.unitResources.reflectionAndLogs = [];
  unit.unitResources.lessonDropboxes = [];
  unit.unitResources.answerPages = [];
  for (const [label, mod, id] of config.evaluations) {
    const record = {
      ...activityRecord({ label, mod, id, role: "evaluation", unit: unit.unit, teacherUse: "assessment_preparation" }),
      sourceGroup: "unit_evaluation",
      parentSection: "Evaluation",
      unitTitle: unit.title || unit.name,
    };
    upsertByKey(unit.unitResources.evaluations, record);
    upsertByKey(manifest.evaluations, record);
  }
  for (const [label, id, role] of config.reflectionAndLogs) {
    const reflectionRole = /kwl/i.test(role) ? "reflection_kwl" : "reflection_summary";
    upsertByKey(unit.unitResources.reflectionAndLogs, {
      ...activityRecord({ label, id, role: reflectionRole, unit: unit.unit, teacherUse: "student_reflection_tracking" }),
      sourceGroup: "unit_reflection_log",
      parentSection: "Reflection / Learning Log",
      unitTitle: unit.title || unit.name,
    });
  }
  for (const [label, id] of config.lessonDropboxes) {
    const record = normalizeHomeworkSubmission(activityRecord({ label, id, role: "homework_submission_page", unit: unit.unit, teacherUse: "student_submission" }));
    upsertByKey(homeworkSubmissionItems, record);
  }
  for (const [label, id] of config.answerPages) {
    const record = normalizeHomeworkSubmission(activityRecord({ label, mod: "page", id, role: "homework_answer_page", unit: unit.unit, teacherUse: "homework_answer_reference" }), {
      answer: true,
    });
    upsertByKey(homeworkSubmissionItems, record);
  }
  delete unit.unitResources.lessonDropboxes;
  delete unit.unitResources.answerPages;
}

for (const record of homeworkSubmissionItems.sort(homeworkSubmissionSort)) upsertByKey(manifest.courseDownloads, record);

upsertByKey(
  manifest.teacherResources,
  {
    ...activityRecord({ label: "Answer Keys", id: 8107, role: "teacher_packet", teacherUse: "answer_key_reference", teacherOnly: true }),
    sourceGroup: "teacher_packet",
    parentSection: "Teacher Packet",
  },
);

manifest.teacherResources = (manifest.teacherResources || [])
  .filter((item) => {
    const role = String(item.role || "").toLowerCase();
    if (["aol_assessment", "lesson_answer_page", "homework_submission_page", "homework_answer_page"].includes(role)) return false;
    if (item.label === "Teacher Packet" && !(item.attachments || []).length) return false;
    return true;
  })
  .map((item) =>
    /^Answer Keys$/i.test(item.label || "")
      ? { ...item, role: "teacher_packet", sourceGroup: "teacher_packet", parentSection: "Teacher Packet", teacherUse: "answer_key_reference", teacherOnly: true }
      : item,
  );
manifest.courseSections = (manifest.courseSections || []).filter((item) => String(item.role || "").toLowerCase() !== "teacher_packet");
enrichEvaluationTextPreviews(manifest);

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  mcr3uMoodleActivityPatch: {
    patchedAt: new Date().toISOString(),
    courseSections: sectionRecords.length,
    courseDownloads: courseActivityDownloads.length,
    unitEvaluations: Object.values(unitActivities).reduce((sum, item) => sum + item.evaluations.length, 0),
    unitReflectionAndLogs: Object.values(unitActivities).reduce((sum, item) => sum + item.reflectionAndLogs.length, 0),
    lessonDropboxes: Object.values(unitActivities).reduce((sum, item) => sum + item.lessonDropboxes.length, 0),
    answerPages: Object.values(unitActivities).reduce((sum, item) => sum + item.answerPages.length, 0),
    teacherResources: manifest.teacherResources.length,
    shape: "MDM4U-compatible: Homework Submission Folder in courseDownloads, Unit Evaluation in unitResources.evaluations, Teacher Packet only for Answer Keys.",
  },
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify(manifest.sourceAudit.mcr3uMoodleActivityPatch, null, 2));
