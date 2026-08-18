import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const course = readArg("--course")?.toUpperCase();
const reportPath = readArg("--report") ? resolve(projectRoot, readArg("--report")) : "";
if (!course || !reportPath) {
  console.error("Usage: node scripts/patch-course-overview-ispring.mjs --course COURSE --report deployment/report.json");
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function escapeHtml(value, quote = false) {
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
    .replace(/\s+/g, " ")
    .trim();
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function relativeHref(fromRel, toRel) {
  return posix.relative(posix.dirname(toPosix(fromRel)), toPosix(toRel)).split("/").map(encodeURIComponent).join("/");
}

function ensureOverviewStyles(html) {
  if (/\.localized-ispring iframe\b/i.test(html)) return html;
  const css = [
    "    .overview-block { border-top: 1px solid #e0e8f2; margin-top: 22px; padding-top: 14px; }",
    "    .localized-ispring { display: block; margin: 16px 0 24px; max-width: 100%; width: 100%; }",
    "    .localized-ispring iframe { border: 0; display: block; height: min(72vh, 760px); min-height: 640px; width: 100%; }",
  ].join("\n") + "\n";
  if (/<\/style>/i.test(html)) return html.replace(/<\/style>/i, `${css}  </style>`);
  return html;
}

function patchOverviewHtml(html, pageRel, entryPath, title) {
  let next = ensureOverviewStyles(html);
  next = next.replace(/\s*<section class="overview-block">\s*<h2>Course Overview Presentation<\/h2>[\s\S]*?<\/section>/gi, "");
  const src = relativeHref(pageRel, entryPath);
  const block = `
      <section class="overview-block">
        <h2>Course Overview Presentation</h2>
        <div class="localized-ispring"><iframe src="${escapeHtml(src, true)}" loading="lazy" allowfullscreen="allowfullscreen" title="${escapeHtml(title, true)}"></iframe></div>
      </section>`;
  if (/<\/article>/i.test(next)) return next.replace(/<\/article>/i, `${block}\n    </article>`);
  return next.replace(/(<section class="files">)/i, `${block}\n    $1`);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = readJson(manifestPath);
const report = readJson(reportPath);
const row = (report.rows || []).find((item) => item.course === course && item.lessonId === "course-overview");
if (!row || !["localized", "partial"].includes(row.status)) {
  throw new Error(`No localized course overview iSpring row found in ${reportPath}`);
}

const pageRel = "course-sections/course-overview/index.html";
const pagePath = join(courseRoot, pageRel);
if (!existsSync(join(courseRoot, row.entryPath))) throw new Error(`Missing localized iSpring entry: ${row.entryPath}`);
if (!existsSync(pagePath)) throw new Error(`Missing course overview page: ${pageRel}`);

const overview = (manifest.courseSections || []).find((item) => item.role === "course_overview" || item.path === pageRel);
if (!overview) throw new Error("Manifest is missing Course Overview section.");

const ispringRecord = {
  label: row.title || "Course Overview Presentation",
  mode: "page",
  type: "ispring",
  category: "ispring",
  role: "course_overview_ispring",
  path: row.entryPath,
  packagePath: row.targetRoot,
  source: row.url,
  files: row.fileCount,
  localizationStatus: row.status,
};
overview.ispring = [ispringRecord, ...(overview.ispring || []).filter((item) => item.role !== "course_overview_ispring")];

const html = patchOverviewHtml(readFileSync(pagePath, "utf8"), pageRel, row.entryPath, ispringRecord.label);
writeFileSync(pagePath, html, "utf8");
overview.bytes = statSync(pagePath).size;
overview.textPreview = stripTags(html).slice(0, 800);

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewIspring = {
  source: row.url,
  path: row.entryPath,
  status: row.status,
  files: row.fileCount,
  patchedAt: new Date().toISOString(),
  note: "Course Overview iSpring was localized from the Moodle iframe and embedded in the local Course Overview page. No external playback URL is exposed.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course, page: pageRel, ispring: row.entryPath, status: row.status, files: row.fileCount }, null, 2));
