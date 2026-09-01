import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLDO";
const moodleCourseId = 74;
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
  headers.set("user-agent", "ossd-course-portal-esldo-course-resources/1.0");
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
  if (!existsSync(abs)) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buffer);
  }
  const record = {
    label: filename,
    type,
    path: rel,
    bytes: statSync(abs).size,
    source: url,
  };
  const previewPath = `previews-html/${rel}.html`;
  if (existsSync(join(courseRoot, previewPath))) record.previewPath = previewPath;
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

function extractSectionBody(rawHtml, sectionId, sectionNumber) {
  const exact = extractElementByToken(rawHtml, new RegExp(`(?:id=["']section-${sectionId}["']|data-sectionid=["']${sectionId}["'])`, "i"));
  if (exact) return exact;
  const byNumber = extractElementByToken(rawHtml, new RegExp(`(?:id=["']section-${sectionNumber}["']|data-number=["']${sectionNumber}["']|data-section=["']${sectionNumber}["'])`, "i"));
  if (byNumber) return byNumber;
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
    .replace(/<div\b[^>]*class=["'][^"']*\bcard-section-(?:left|right)nav\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bprogress-bar-warpper\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "")
    .replace(/<ul\b[^>]*class=["'][^"']*\bactivity-cards\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\b(?:drawer|navbar|breadcrumb|secondary-navigation|courseindex|block-region|edwiser|rating|review|dropdown-menu)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  html = html
    .replace(/\sdata-for=["']sectioninfo["']/gi, "")
    .replace(/\saria-controls=["'][^"']*["']/gi, "")
    .replace(/\sdata-toggle=["'][^"']*["']/gi, "")
    .replace(/\sdata-bs-toggle=["'][^"']*["']/gi, "")
    .replace(/\sid=["']collapseSection-\d+["']/gi, "")
    .replace(/\sid=["']section-\d+["']/gi, "");
  return html;
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

function sectionShell(title, body, attachments) {
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
    h3 { margin-top: 18px; }
    img { max-width: 100%; height: auto; }
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
  let html = body.replace(/\b(href|src)\s*=\s*["']([^"']+)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), source).toString();
      const noQuery = url.replace(/[?#].*$/, "");
      const localFile = localByUrl.get(url) || localByUrl.get(noQuery);
      if (localFile?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, localFile.path), true)}"`;
      const localActivity = localActivityTargets.get(url) || localActivityTargets.get(noQuery);
      if (localActivity) return `${attr}="${htmlEscape(courseRelative(indexRel, localActivity), true)}"`;
      if (/^https?:\/\/www\.esunnybrook\.com\//i.test(url)) return `data-localized-link="removed"`;
    } catch {
      // Keep malformed local links.
    }
    return match;
  });
  html = html
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"');
  return html;
}

async function buildCourseSectionPage({ sectionNumber, sectionId, title, role, targetDir, localActivityTargets }) {
  const source = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=${sectionNumber}`;
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  const bodyRaw = extractSectionBody(rawHtml, sectionId, sectionNumber);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(bodyRaw, source)) {
    const attachment = await downloadFile(url, join(targetDir, "files"));
    attachments.push(attachment);
    localByUrl.set(url, attachment);
    localByUrl.set(url.replace(/[?#].*$/, ""), attachment);
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = cleanSectionBody(bodyRaw);
  body = replaceLocalLinks(body, source, localByUrl, localActivityTargets, indexRel);
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  const attachmentsWithHref = attachments.map((item) => ({ ...item, href: courseRelative(indexRel, item.path) }));
  writeFileSync(abs, sectionShell(title, body, attachmentsWithHref), "utf8");
  return {
    label: title,
    type: "html",
    category: "moodle_course_section",
    role,
    path: indexRel,
    bytes: statSync(abs).size,
    source,
    moodleSectionNumber: sectionNumber,
    moodleSectionId: String(sectionId),
    attachments,
    textPreview: stripTags(body).slice(0, 500),
  };
}

function fileRecord({ label, relPath, role, source, moodleActivityId }) {
  const abs = join(courseRoot, relPath);
  if (!existsSync(abs)) throw new Error(`Missing file: ${abs}`);
  const record = {
    label,
    type: extname(relPath).slice(1).toLowerCase(),
    category: "course_document",
    role,
    path: relPath,
    bytes: statSync(abs).size,
    source,
  };
  if (moodleActivityId) record.moodleActivityId = String(moodleActivityId);
  const previewPath = `previews-html/${relPath}.html`;
  if (existsSync(join(courseRoot, previewPath))) record.previewPath = previewPath;
  return record;
}

function upsertByKey(list, record) {
  const key = record.moodleActivityId ? `activity:${record.moodleActivityId}` : record.path || record.source || record.label;
  const index = list.findIndex((item) => {
    const itemKey = item.moodleActivityId ? `activity:${item.moodleActivityId}` : item.path || item.source || item.label;
    return itemKey === key;
  });
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseDownloads = (manifest.courseDownloads || []).filter(
  (item) => !["course_overview", "learning_log", "final_examination_culminating", "culminating", "culminating_assignment"].includes(item.role),
);
manifest.courseSections = (manifest.courseSections || []).filter(
  (item) => !["course_overview", "final_examination_culminating"].includes(item.role),
);

const outlinePath = "localized-moodle-activities/assign/course-7752-esldo-course-outline/files/ESLDO-Course-Outline-v2.docx";
const learningLogSamplePath = "localized-moodle-activities/assign/course-7753-learning-log/files/Learning-Log-Sample-1.pdf";
const learningLogDocxPath = "localized-moodle-activities/assign/course-7753-learning-log/files/Learning-Log.docx";

const courseOutline = fileRecord({
  label: "ESLDO Course Outline",
  relPath: outlinePath,
  role: "course_outline",
  source: "https://www.esunnybrook.com/pluginfile.php/7957/mod_assign/introattachment/0/ESLDO-Course-Outline-v2.docx?forcedownload=1",
  moodleActivityId: 7752,
});
const learningLogSample = fileRecord({
  label: "Learning-Log-Sample-1.pdf",
  relPath: learningLogSamplePath,
  role: "learning_log_sample",
  source: "https://www.esunnybrook.com/pluginfile.php/7958/mod_assign/introattachment/0/Learning-Log-Sample-1.pdf?forcedownload=1",
  moodleActivityId: 7753,
});
const learningLogDocx = fileRecord({
  label: "Learning-Log.docx",
  relPath: learningLogDocxPath,
  role: "learning_log_file",
  source: "https://www.esunnybrook.com/pluginfile.php/7958/mod_assign/introattachment/0/Learning-Log.docx?forcedownload=1",
  moodleActivityId: 7753,
});

const learningLogIndex = "localized-moodle-activities/assign/course-7753-learning-log/index.html";
mkdirSync(dirname(join(courseRoot, learningLogIndex)), { recursive: true });
writeFileSync(
  join(courseRoot, learningLogIndex),
  sectionShell(
    "Learning Log",
    "<p>This Moodle activity provides the course Learning Log template and sample.</p>",
    [learningLogSample, learningLogDocx].map((item) => ({ ...item, href: courseRelative(learningLogIndex, item.path) })),
  ),
  "utf8",
);
const learningLog = {
  label: "Learning Log",
  type: "html",
  category: "moodle_assign",
  role: "learning_log",
  path: learningLogIndex,
  bytes: statSync(join(courseRoot, learningLogIndex)).size,
  source: "https://www.esunnybrook.com/mod/assign/view.php?id=7753",
  moodleActivityId: "7753",
  attachments: [learningLogSample, learningLogDocx],
  textPreview: "This Moodle activity provides the course Learning Log template and sample.",
};

const localActivityTargets = new Map([
  ["https://www.esunnybrook.com/mod/assign/view.php?id=7752", outlinePath],
  ["https://www.esunnybrook.com/mod/assign/view.php?id=7753", learningLogIndex],
]);

const courseOverview = await buildCourseSectionPage({
  sectionNumber: 1,
  sectionId: 784,
  title: "Course Overview",
  role: "course_overview",
  targetDir: "course-sections/course-overview",
  localActivityTargets,
});
const culminating = await buildCourseSectionPage({
  sectionNumber: 6,
  sectionId: 789,
  title: "Culminating",
  role: "final_examination_culminating",
  targetDir: "course-sections/culminating",
  localActivityTargets: new Map([["https://www.esunnybrook.com/mod/assign/view.php?id=7848", "course-sections/culminating/index.html"]]),
});

const culminatingFile = (culminating.attachments || []).find((item) => /Culminating-Portfolio\.docx/i.test(item.label || item.path || ""));
const culminatingPortfolio = culminatingFile
  ? { ...culminatingFile, category: "course_document", role: "culminating_assignment" }
  : fileRecord({
      label: "Culminating-Portfolio.docx",
      relPath: "course-sections/culminating/files/Culminating-Portfolio.docx",
      role: "culminating_assignment",
      source: "https://www.esunnybrook.com/pluginfile.php/7954/course/section/789/Culminating-Portfolio.docx",
    });

for (const record of [courseOverview, courseOutline, learningLog, culminating, culminatingPortfolio]) {
  upsertByKey(manifest.courseDownloads, record.category === "moodle_course_section" ? { ...record, category: "course_document" } : record);
}
for (const record of [courseOverview, culminating]) upsertByKey(manifest.courseSections, record);

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  courseResourcesFinalizedAt: new Date().toISOString(),
  esldoCourseResourcesPatch: {
    moodleCourseId,
    courseOverviewSection: 1,
    courseOverviewCollapseId: 784,
    learningLogActivityId: 7753,
    culminatingSection: 6,
    culminatingCollapseId: 789,
    culminatingDropboxActivityId: 7848,
    addedCourseDownloads: ["Course Overview", "ESLDO Course Outline", "Learning Log", "Culminating", "Culminating-Portfolio.docx"],
    note: "Course-level pages are extracted from Moodle sections and localized. Exit Cards are excluded.",
  },
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseDownloads: manifest.courseDownloads.map((item) => ({ label: item.label, role: item.role, path: item.path, attachments: item.attachments?.length || 0 })),
  courseSections: manifest.courseSections.map((item) => ({ label: item.label, role: item.role, path: item.path, attachments: item.attachments?.length || 0 })),
}, null, 2));
