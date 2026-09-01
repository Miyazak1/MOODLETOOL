import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const COURSE = "OLC4O";
const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", COURSE);
const manifestPath = join(courseRoot, "course-manifest.json");
const sectionZeroPath = join(projectRoot, "inbox", "olc4o-stmary-sections", "section-00.json");
const BASE_URL = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/login\/index\.php$/i, "");

loadEnvFile(join(projectRoot, ".env"));

class CookieJar {
  constructor() {
    this.cookies = new Map();
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

const jar = new CookieJar();

function loadEnvFile(envPath) {
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

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-olc4o-section-repair/1.0");
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
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St. Mary Moodle login failed.");
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

function relFromCourse(absPath) {
  return toPosix(relative(courseRoot, absPath));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function renderPage(title, body, depth = "../..") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${COURSE} - ${escapeHtml(title)} - Course Content</title>
  <link rel="stylesheet" href="${depth}/_assets/course-page-shell.css" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>${COURSE}</p><h1>${escapeHtml(title)}</h1></div>
    <section class="moodle-section">
      <header><p>Course Content</p><h2>${escapeHtml(title)}</h2></header>
      <div class="moodle-content">${body}</div>
    </section>
  </main>
</body>
</html>
`;
}

async function localizeRemoteImages(html, targetRelDir) {
  let output = String(html || "");
  const matches = [...output.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi)];
  for (const match of matches) {
    const sourceUrl = match[1].replaceAll("&amp;", "&");
    const parsed = new URL(sourceUrl);
    const sourceName = decodeURIComponent(basename(parsed.pathname) || "image");
    const extension = extname(sourceName) || ".bin";
    const fileName = `${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 10)}-${sourceName.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")}`;
    const targetRel = `${targetRelDir}/${fileName}`;
    const targetAbs = join(courseRoot, ...targetRel.split("/"));
    mkdirSync(dirname(targetAbs), { recursive: true });

    if (!existsSync(targetAbs)) {
      const response = await request(sourceUrl);
      if (!response.ok) throw new Error(`Failed to download introduction image ${response.status}: ${sourceUrl}`);
      const contentType = response.headers.get("content-type") || "";
      const bytes = Buffer.from(await response.arrayBuffer());
      const textHead = bytes.subarray(0, 128).toString("utf8").trimStart();
      if (/text\/html/i.test(contentType) || /^<!doctype html|^<html\b/i.test(textHead)) {
        throw new Error(`Introduction image resolved to HTML instead of a file: ${sourceUrl}`);
      }
      if (extension === ".bin" && bytes.length === 0) throw new Error(`Empty introduction image download: ${sourceUrl}`);
      writeFileSync(targetAbs, bytes);
    }

    output = output.replaceAll(sourceUrl, toPosix(relative(join(courseRoot, "course-sections", "introduction"), targetAbs)));
  }
  return output;
}

function resourceFromHtml(relPath, label, role, category = "course_document", extra = {}) {
  const absPath = join(courseRoot, ...relPath.split("/"));
  return {
    label,
    type: "html",
    category,
    role,
    path: relPath,
    bytes: statSync(absPath).size,
    textPreview: stripTags(readFileSync(absPath, "utf8")).slice(0, 760),
    ...extra,
  };
}

function attachmentsFor(activityRel) {
  const filesDir = join(courseRoot, ...activityRel.split("/"), "files");
  if (!existsSync(filesDir)) return [];
  return readdirSync(filesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absPath = join(filesDir, entry.name);
      const relPath = relFromCourse(absPath);
      const previewPath = `previews-html/${relPath}.html`;
      const previewAbs = join(courseRoot, ...previewPath.split("/"));
      return {
        label: entry.name.replace(/^[0-9a-f]{10}-/i, ""),
        type: entry.name.split(".").pop()?.toLowerCase() || "file",
        category: "moodle_activity_file",
        role: "attachment",
        path: relPath,
        downloadPath: relPath,
        previewPath: existsSync(previewAbs) ? previewPath : relPath,
        bytes: statSync(absPath).size,
      };
    });
}

function activityResource(activityDir, role) {
  const absDir = join(courseRoot, "localized-moodle-activities", "assign", activityDir);
  const htmlPath = join(absDir, "index.html");
  const html = readFileSync(htmlPath, "utf8");
  const label = stripTags(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || activityDir)
    .replace(/^OLC4O\s*-\s*/i, "")
    .replace(/\s*-\s*Course Content$/i, "");
  const relDir = relFromCourse(absDir);
  const relPath = `${relDir}/index.html`;
  return {
    label,
    type: "html",
    category: "moodle_assign",
    role,
    path: relPath,
    bytes: statSync(htmlPath).size,
    attachments: attachmentsFor(relDir),
    textPreview: stripTags(html).slice(0, 760),
  };
}

function uniqueByPath(items) {
  const seen = new Set();
  const out = [];
  for (const item of items.filter(Boolean)) {
    const key = item.path || item.label;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function writeIntroductionPage() {
  const section = readJson(sectionZeroPath);
  const summary = /<div\b[^>]*class=["'][^"']*\bsummary\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(section.fragment || "")?.[0] || "";
  const localizedSummary = await localizeRemoteImages(summary, "course-sections/introduction/files");
  const body = `<article class="content">${localizedSummary}</article>`;
  const rel = "course-sections/introduction/index.html";
  const abs = join(courseRoot, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, renderPage("Introduction", body), "utf8");
  return resourceFromHtml(rel, "Introduction", "introduction", "course_introduction", {
    source: "http://34.30.231.58/course/view.php?id=69",
  });
}

function writeFinalCulminatingPage(items) {
  const rows = items.map((item) => {
    const href = toPosix(relative(join(courseRoot, "course-sections", "final-examination-culminating"), join(courseRoot, ...item.path.split("/"))));
    const files = (item.attachments || []).map((attachment) => escapeHtml(attachment.label)).join(", ");
    return `<li><a class="file-action" href="${href}">${escapeHtml(item.label)}</a>${files ? `<span class="file-label">${files}</span>` : ""}</li>`;
  }).join("");
  const rel = "course-sections/final-examination-culminating/index.html";
  const abs = join(courseRoot, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, renderPage("Final Examination & Culminating", `<section class="attachments"><h2>Files</h2><ul>${rows}</ul></section>`), "utf8");
  return resourceFromHtml(rel, "Final Examination & Culminating", "final_examination_culminating", "course_document", {
    attachments: items,
    source: "http://34.30.231.58/course/view.php?id=69",
  });
}

function writeTeacherPacketPage(answerKey) {
  const body = `<p>Moodle Teacher Packet section. Teacher-facing activities are listed separately.</p>`;
  const rel = "course-sections/teacher-packet/index.html";
  const abs = join(courseRoot, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, renderPage("Teacher Packet", body), "utf8");
  return resourceFromHtml(rel, "Teacher Packet", "teacher_packet", "teacher_resource", {
    source: "http://34.30.231.58/course/view.php?id=69&section=6",
  });
}

const manifest = readJson(manifestPath);
await login();
const introduction = await writeIntroductionPage();
const finalItems = [
  activityResource("U04L01-580-580-8a5b87d7b1", "culminating_activity"),
  activityResource("U04L02-581-581-f106a40f17", "culminating_assignment"),
  activityResource("U04L04-583-583-cb953401e5", "culminating_dropbox"),
  activityResource("U04L06-585-585-f918a5ecc9", "culminating_dropbox"),
  activityResource("U04L08-587-587-f588c197a8", "culminating_dropbox"),
  activityResource("U04L09-588-588-b83d1d3a09", "culminating_assignment"),
  activityResource("U05L01-589-589-7a3e6a4705", "final_exam"),
  activityResource("U05L02-9389-9389-0bfd5a184c", "final_exam_submission"),
  activityResource("assign-10585-Culminating-Assignment-Dropbox", "culminating_assignment_dropbox"),
];
const finalSection = writeFinalCulminatingPage(finalItems);
const answerKey = activityResource("assign-10586-Answer-Key", "answer_key");
answerKey.teacherOnly = true;
const teacherPacket = writeTeacherPacketPage(answerKey);

manifest.courseSections = uniqueByPath([
  introduction,
  ...(manifest.courseSections || []).filter((item) => !["introduction", "final_examination_culminating", "teacher_packet"].includes(item.role)),
  finalSection,
  teacherPacket,
]);
manifest.teacherResources = uniqueByPath([
  ...(manifest.teacherResources || []).filter((item) => item.role !== "teacher_packet"),
  answerKey,
]);
manifest.evaluations = uniqueByPath([
  ...(manifest.evaluations || []),
  ...finalItems,
]);
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  olc4oCompleteSectionRepair20260823: {
    source: "http://34.30.231.58/course/view.php?id=69",
    addedCourseSections: ["Introduction", "Final Examination & Culminating", "Teacher Packet"],
    addedEvaluationItems: finalItems.map((item) => item.label),
    teacherResourcesRestored: ["Answer Key"],
    teacherPacketDisplayRule: "Teacher Packet is a Moodle section shell only; do not duplicate it as a nested resource card.",
  },
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify({
  course: COURSE,
  courseSections: manifest.courseSections.map((item) => item.label),
  addedFinalItems: finalItems.length,
  teacherResources: manifest.teacherResources.map((item) => item.label),
}, null, 2));
