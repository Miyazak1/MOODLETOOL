import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLCO";
const moodleCourseId = 73;
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
  headers.set("user-agent", "ossd-course-portal-eslco-activity-patch/1.0");
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
  if (/name=["']username["']|name=["']password["']/i.test(html)) throw new Error("Moodle login failed.");
  return { loggedIn: true, reason: "credentials" };
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
  const idPatterns = [
    new RegExp(`<li\\b[^>]*(?:id=["']section-${sectionNumber}["']|data-section=["']${sectionNumber}["'])[^>]*>([\\s\\S]*?)(?=<li\\b[^>]*(?:id=["']section-|data-section=)|<\\/ul>\\s*<\\/li>|$)`, "i"),
    new RegExp(`<div\\b[^>]*id=["']coursecontentcollapse${sectionNumber}["'][^>]*>([\\s\\S]*?)(?=<div\\b[^>]*id=["']coursecontentcollapse\\d+["']|$)`, "i"),
    new RegExp(`<div\\b[^>]*id=["']collapseSection-[^"']+["'][^>]*>([\\s\\S]*?)(?=<div\\b[^>]*id=["']collapseSection-|$)`, "i"),
  ];
  for (const pattern of idPatterns) {
    const match = pattern.exec(rawHtml);
    if (match?.[1]) return match[1];
  }
  const main = /<section\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/section>/i.exec(rawHtml)?.[1];
  return main || rawHtml;
}

function cleanSectionBody(rawHtml) {
  let html = String(rawHtml || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\b(?:drawer|navbar|breadcrumb|secondary-navigation|courseindex|block-region|edwiser|rating|review|dropdown-menu)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  html = html
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"');
  return html;
}

function sectionContentOnly(rawHtml) {
  const blocks = [];
  for (const match of String(rawHtml || "").matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const block = match[1] || "";
    if (stripTags(block).length > 10) blocks.push(block);
  }
  return blocks.length ? blocks.join("\n") : rawHtml;
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
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      localByUrl.set(parsed.toString(), attachment);
    } catch {
      // Keep exact URL mapping only.
    }
  }
  let body = sectionContentOnly(bodyRaw)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const indexRel = toPosix(join(targetDir, "index.html"));
  body = body.replace(/\b(href|src)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), source).toString();
      const key = localByUrl.get(url) || localByUrl.get(url.replace(/[?#].*$/, ""));
      if (key?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, key.path), true)}"`;
    } catch {
      // Fall through.
    }
    return match;
  });
  body = cleanSectionBody(body);
  const sectionText = stripTags(body).slice(0, 500);
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
    textPreview: sectionText,
  };
}

function activityRecord({ label, mod = "assign", id, role, unit, teacherUse = "teacher_preparation", teacherOnly = false }) {
  return {
    label,
    type: "html",
    category: `moodle_${mod}`,
    role,
    url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    source: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    moodleActivityId: String(id),
    teacherUse,
    ...(unit ? { unit } : {}),
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

const manifest = readJson(manifestPath);
await loginIfNeeded();

const sectionRecords = [
  await buildCourseSectionPage({ sectionNumber: 1, title: "Course Overview", role: "course_overview", targetDir: "course-sections/course-overview" }),
  await buildCourseSectionPage({ sectionNumber: 6, title: "Final Examination & Culminating", role: "final_examination_culminating", targetDir: "course-sections/final-examination-culminating" }),
  await buildCourseSectionPage({ sectionNumber: 8, title: "Teacher Packet", role: "teacher_packet", targetDir: "course-sections/teacher-packet" }),
];

manifest.courseSections = manifest.courseSections || [];
for (const record of sectionRecords) upsertByKey(manifest.courseSections, record);

const courseDownloads = [
  activityRecord({ label: "ESLCO Course Outline", id: 7650, role: "course_outline", teacherUse: "course_planning" }),
  activityRecord({ label: "Learning Log", id: 7651, role: "learning_log", teacherUse: "student_progress_tracking" }),
  activityRecord({ label: "Exam Dropbox", id: 7720, role: "final_exam_submission", teacherUse: "assessment_preparation" }),
  activityRecord({ label: "Culminating Dropbox", id: 7721, role: "culminating_submission", teacherUse: "assessment_preparation" }),
];
manifest.courseDownloads = manifest.courseDownloads || [];
for (const record of courseDownloads) upsertByKey(manifest.courseDownloads, record);

const unitActivities = {
  1: {
    evaluations: [
      ["Unit 1 Assignment 1 (AOL)", 7655],
      ["Unit 1 Assignment 2 (AOL)", 7656],
      ["Unit 1 Assignment 3 (AOL)", 7657],
    ],
    reflectionAndLogs: [
      ["Unit 1 - KWL Dropbox", 7668, "kwl_dropbox"],
      ["Unit 1 - Reflection Summary Dropbox", 7669, "reflection_dropbox"],
    ],
    lessonDropboxes: [
      ["Unit 1 - Lesson 1", 7659],
      ["Unit 1 - Lesson 2", 7661],
      ["Unit 1 - Lesson 3", 7663],
      ["Unit 1 - Lesson 4", 7664],
      ["Unit 1 - Lesson 5", 7666],
    ],
    answerPages: [
      ["Unit 1 - Lesson 1 (Answer)", 7660],
      ["Unit 1 - Lesson 2 (Answer)", 7662],
      ["Unit 1 - Lesson 4 (Answer)", 7665],
      ["Unit 1 - Lesson 5 (Answer)", 7667],
    ],
  },
  2: {
    evaluations: [
      ["Unit 2 Assignment 1 (AOL)", 7673],
      ["Unit 2 Assignment 2 (AOL)", 7674],
      ["Unit 2 Assignment 3 (AOL)", 7675],
    ],
    reflectionAndLogs: [
      ["Unit 2 - KWL Dropbox", 7685, "kwl_dropbox"],
      ["Unit 2 - Reflection Summary Dropbox", 7686, "reflection_dropbox"],
    ],
    lessonDropboxes: [
      ["Unit 2 - Lesson 1", 7677],
      ["Unit 2 - Lesson 2", 7678],
      ["Unit 2 - Lesson 3", 7679],
      ["Unit 2 - Lesson 4", 7680],
      ["Unit 2 - Lesson 5", 7681],
      ["Unit 2 - Lesson 6", 7683],
    ],
    answerPages: [
      ["Unit 2 - Lesson 5 (Answer)", 7682],
      ["Unit 2 - Lesson 6 (Answer)", 7684],
    ],
  },
  3: {
    evaluations: [
      ["Unit 3 Assignment 1 (AOL)", 7690],
      ["Unit 3 Assignment 2 (AOL)", 7691],
      ["Unit 3 Assignment 3 (AOL)", 7692],
    ],
    reflectionAndLogs: [
      ["Unit 3 - KWL Dropbox", 7699, "kwl_dropbox"],
      ["Unit 3 - Reflection Summary Dropbox", 7700, "reflection_dropbox"],
    ],
    lessonDropboxes: [
      ["Unit 3 - Lesson 1", 7694],
      ["Unit 3 - Lesson 2", 7695],
      ["Unit 3 - Lesson 3", 7696],
      ["Unit 3 - Lesson 4", 7697],
      ["Unit 3 - Lesson 5", 7698],
    ],
    answerPages: [],
  },
  4: {
    evaluations: [
      ["Unit 4 Assignment 1 (AOL)", 7704],
      ["Unit 4 Assignment 2 (AOL)", 7705],
      ["Unit 4 Assignment 3 (AOL)", 7706],
    ],
    reflectionAndLogs: [
      ["Unit 4 - KWL Dropbox", 7718, "kwl_dropbox"],
      ["Unit 4 - Reflection Summary Dropbox", 7719, "reflection_dropbox"],
    ],
    lessonDropboxes: [
      ["Unit 4 - Lesson 1", 7708],
      ["Unit 4 - Lesson 2", 7710],
      ["Unit 4 - Lesson 3", 7712],
      ["Unit 4 - Lesson 4", 7714],
      ["Unit 4 - Lesson 5", 7716],
    ],
    answerPages: [
      ["Unit 4 - Lesson 1 (Answer)", 7709],
      ["Unit 4 - Lesson 2 Answer", 7711],
      ["Unit 4 - Lesson 3 Answer", 7713],
      ["Unit 4 - Lesson 4 Answer", 7715],
      ["Unit 4 - Lesson 5 Answer", 7717],
    ],
  },
};

manifest.evaluations = manifest.evaluations || [];
manifest.teacherResources = manifest.teacherResources || [];
upsertByKey(manifest.teacherResources, { ...sectionRecords[2], teacherOnly: true });

for (const unit of manifest.units || []) {
  const config = unitActivities[unit.unit];
  if (!config) continue;
  unit.unitResources = unit.unitResources || {};
  unit.unitResources.evaluations = unit.unitResources.evaluations || [];
  unit.unitResources.reflectionAndLogs = unit.unitResources.reflectionAndLogs || [];
  unit.unitResources.lessonDropboxes = unit.unitResources.lessonDropboxes || [];
  unit.unitResources.answerPages = unit.unitResources.answerPages || [];

  for (const [label, id] of config.evaluations) {
    const record = activityRecord({ label, id, role: "aol_assignment", unit: unit.unit, teacherUse: "assessment_preparation" });
    upsertByKey(unit.unitResources.evaluations, record);
    upsertByKey(manifest.evaluations, record);
    upsertByKey(manifest.teacherResources, { ...record, teacherUse: "assessment_preparation" });
  }
  for (const [label, id, role] of config.reflectionAndLogs) {
    upsertByKey(unit.unitResources.reflectionAndLogs, activityRecord({ label, id, role, unit: unit.unit }));
  }
  for (const [label, id] of config.lessonDropboxes) {
    upsertByKey(unit.unitResources.lessonDropboxes, activityRecord({ label, id, role: "lesson_dropbox", unit: unit.unit }));
  }
  for (const [label, id] of config.answerPages) {
    const record = activityRecord({ label, mod: "page", id, role: "lesson_answer_page", unit: unit.unit, teacherUse: "answer_key_reference", teacherOnly: true });
    upsertByKey(unit.unitResources.answerPages, record);
    upsertByKey(manifest.teacherResources, record);
  }
}

const answerKeys = activityRecord({
  label: "Answer Keys",
  id: 7750,
  role: "answer_keys",
  teacherUse: "answer_key_reference",
  teacherOnly: true,
});
upsertByKey(manifest.teacherResources, answerKeys);

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  eslcoMoodleActivityPatch: {
    patchedAt: new Date().toISOString(),
    courseSections: sectionRecords.length,
    courseDownloads: courseDownloads.length,
    unitEvaluations: Object.values(unitActivities).reduce((sum, item) => sum + item.evaluations.length, 0),
    unitReflectionAndLogs: Object.values(unitActivities).reduce((sum, item) => sum + item.reflectionAndLogs.length, 0),
    lessonDropboxes: Object.values(unitActivities).reduce((sum, item) => sum + item.lessonDropboxes.length, 0),
    answerPages: Object.values(unitActivities).reduce((sum, item) => sum + item.answerPages.length, 0),
    teacherResources: manifest.teacherResources.length,
    exitCardsExcludedByPolicy: 28,
  },
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify(manifest.sourceAudit.eslcoMoodleActivityPatch, null, 2));
