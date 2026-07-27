import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(process.env.COURSE_ACTIVE_ROOT || join(workspaceRoot, "courseware"));
const deploymentRoot = join(projectRoot, "deployment");

const course = readArg("--course", "ENG3U").toUpperCase();
const baseUrl = readArg("--base-url", process.env.EMBED_PUBLIC_ORIGIN || "https://your-domain.com").replace(/\/+$/, "");
const secret = readArg("--secret", process.env.EMBED_TOKEN_SECRET || process.env.ADMIN_SESSION_SECRET || "");
const tokenMaxAgeSeconds = Number(readArg("--max-age-seconds", process.env.EMBED_TOKEN_MAX_AGE_SECONDS || 3650 * 24 * 60 * 60));

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosixPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function dirnamePosix(path) {
  const value = toPosixPath(path);
  const index = value.lastIndexOf("/");
  return index >= 0 ? value.slice(0, index) : "";
}

function encodePathSegments(value) {
  return toPosixPath(value)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signEmbedPayload(payload) {
  if (!secret) throw new Error("Missing --secret or EMBED_TOKEN_SECRET.");
  const body = base64UrlJson(payload);
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function resourceIdFor(path) {
  return createHash("sha1").update(toPosixPath(path)).digest("hex").slice(0, 12);
}

function localResourceCandidatesForLesson(lesson) {
  const candidates = [];
  for (const item of lesson.ispring || []) {
    if (item.path) candidates.push({ kind: "ispring", role: item.role || "lesson_ispring", item });
  }
  for (const item of lesson.downloads || []) {
    if (!item.path) continue;
    const type = String(item.type || "").toLowerCase();
    const kind = type === "mp4" || type === "video" ? "video" : type === "h5p" ? "h5p" : "file";
    candidates.push({ kind, role: item.role || "download", item });
  }
  for (const item of lesson.bookSections || []) {
    if (item.path) candidates.push({ kind: "book-section", role: item.role || "lesson_book_section", item });
  }
  return candidates;
}

function rowForResource(unit, lesson, candidate) {
  const lessonId = `U${String(unit.unit).padStart(2, "0")}L${String(lesson.lesson).padStart(2, "0")}`;
  const item = candidate.item;
  const normalizedPath = toPosixPath(item.path);
  const token = signEmbedPayload({
    v: 1,
    course,
    kind: candidate.kind,
    lessonId,
    label: item.label || "",
    section: item.sectionLabel || candidate.role,
    path: normalizedPath,
    prefix: dirnamePosix(normalizedPath),
    exp: Math.floor(Date.now() / 1000) + tokenMaxAgeSeconds,
  });
  const resourceId = resourceIdFor(normalizedPath);
  const embedUrl = `${baseUrl}/embed/${candidate.kind}/${encodeURIComponent(course)}/${lessonId}/${resourceId}?token=${encodeURIComponent(token)}`;
  const fileUrl = `${baseUrl}/embed/file/${encodeURIComponent(course)}/${lessonId}/${resourceId}?token=${encodeURIComponent(token)}`;
  let status = "ready";
  let moodleHtml = "";
  if (candidate.kind === "ispring") {
    moodleHtml = `<iframe src="${embedUrl}" width="100%" height="720" frameborder="0" scrolling="auto" allowfullscreen="allowfullscreen"></iframe>`;
  } else if (candidate.kind === "video") {
    moodleHtml = `<iframe src="${embedUrl}" width="100%" height="540" frameborder="0" allowfullscreen="allowfullscreen"></iframe>`;
  } else if (candidate.kind === "book-section") {
    moodleHtml = `<iframe src="${embedUrl}" width="100%" height="720" frameborder="0"></iframe>`;
  } else if (candidate.kind === "h5p") {
    moodleHtml = `<a href="${fileUrl}" target="_blank" rel="noopener">${htmlEscape(item.label || "Download H5P")}</a>`;
    status = "needs-h5p-runtime";
  } else if (String(item.type || "").toLowerCase() === "pdf") {
    moodleHtml = `<iframe src="${fileUrl}" width="100%" height="720" frameborder="0"></iframe>`;
  } else {
    moodleHtml = `<a href="${fileUrl}" target="_blank" rel="noopener">${htmlEscape(item.label || "Download resource")}</a>`;
  }
  return {
    course,
    unit: unit.unit,
    lesson: lesson.lesson,
    lessonId,
    lessonTitle: lesson.title || "",
    kind: candidate.kind,
    role: candidate.role,
    label: item.label || "",
    path: normalizedPath,
    source: item.source || "",
    status,
    embedUrl,
    fileUrl,
    moodleHtml,
  };
}

function collectRows(manifest) {
  const rows = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const candidate of localResourceCandidatesForLesson(lesson)) {
        rows.push(rowForResource(unit, lesson, candidate));
      }
    }
  }
  return rows;
}

function renderMarkdown(report) {
  const rows = report.rows.slice(0, 240).map((row) =>
    `| ${row.lessonId} | ${row.kind} | ${row.status} | ${row.label.replaceAll("|", "\\|")} | ${row.path.replaceAll("|", "\\|")} | \`${row.moodleHtml.replaceAll("|", "\\|")}\` |`,
  );
  return `# Moodle Embed Replacement Report

Generated: ${report.generatedAt}

Course: ${report.course}

Base URL: ${report.baseUrl}

| Lesson | Kind | Status | Resource | Local Path | Moodle HTML |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n") || "| - | - | - | - | - | - |"}
`;
}

const manifestPath = join(coursewareRoot, course, "course-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing course manifest: ${manifestPath}`);
  process.exit(1);
}

const rows = collectRows(readJson(manifestPath));
const report = {
  generatedAt: new Date().toISOString(),
  course,
  baseUrl,
  tokenMaxAgeSeconds,
  rows,
  summary: {
    total: rows.length,
    ispring: rows.filter((row) => row.kind === "ispring").length,
    video: rows.filter((row) => row.kind === "video").length,
    files: rows.filter((row) => row.kind === "file").length,
    h5pNeedsRuntime: rows.filter((row) => row.status === "needs-h5p-runtime").length,
    bookSections: rows.filter((row) => row.kind === "book-section").length,
  },
};

const jsonPath = join(deploymentRoot, `moodle-embed-replacement-${course}.json`);
const mdPath = join(deploymentRoot, `moodle-embed-replacement-${course}.md`);
const csvPath = join(deploymentRoot, `moodle-embed-replacement-${course}.csv`);
mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(mdPath, renderMarkdown(report), "utf8");
writeFileSync(
  csvPath,
  [
    "course,unit,lesson,lessonId,kind,status,label,path,source,embedUrl,fileUrl,moodleHtml",
    ...rows.map((row) =>
      [row.course, row.unit, row.lesson, row.lessonId, row.kind, row.status, row.label, row.path, row.source, row.embedUrl, row.fileUrl, row.moodleHtml]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n") + "\n",
  "utf8",
);

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
console.log(`Wrote ${csvPath}`);
console.log(`Moodle embed rows ${report.summary.total}; iSpring ${report.summary.ispring}; video ${report.summary.video}; H5P runtime gaps ${report.summary.h5pNeedsRuntime}`);
