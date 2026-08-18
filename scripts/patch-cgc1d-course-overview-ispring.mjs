import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = resolve(workspaceRoot, "courseware", "CGC1D");
const manifestPath = resolve(courseRoot, "course-manifest.json");
const overviewPath = resolve(courseRoot, "course-sections", "course-overview", "index.html");
const reportPath = resolve(projectRoot, "deployment", "CGC1D-course-overview-ispring-localization-report.json");
const sourceUrl = "https://hexstruct.ispring.com/s/embed_player/18c6e759-d743-11ed-97de-aa8a3890fe64";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlHref(fromRelPath, toRelPath) {
  return toPosix(relative(dirname(fromRelPath), toRelPath))
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

const report = readJson(reportPath);
const row = report.rows?.[0];
if (!row?.entryPath || !row?.targetRoot) {
  throw new Error("Missing Course Overview iSpring localization row.");
}

const overviewRel = "course-sections/course-overview/index.html";
const iframe = `<iframe class="localized-ispring" src="${htmlHref(overviewRel, row.entryPath)}" title="${htmlEscape(row.title || "CGC1D Course Overview")}" loading="lazy" allowfullscreen="allowfullscreen"></iframe>`;

let html = readFileSync(overviewPath, "utf8");
let htmlChanged = false;
if (!html.includes(row.entryPath) && !html.includes(htmlHref(overviewRel, row.entryPath))) {
  const before = html;
  html = html.replace(/(<\/h3>\s*)<h3><span><span><span><strong><br><\/strong><\/span><\/span>\s*<\/span>\s*<\/h3>/, `$1${iframe}`);
  if (html === before) {
    html = html.replace(/(<\/article>)/, `${iframe}\n$1`);
  }
  htmlChanged = html !== before;
  if (htmlChanged) writeFileSync(overviewPath, html, "utf8");
}

const manifest = readJson(manifestPath);
const record = {
  label: row.title || "CGC1D Course Overview",
  mode: "page",
  type: "ispring",
  category: "ispring",
  role: "course_overview_ispring",
  path: row.entryPath,
  packagePath: row.targetRoot,
  source: sourceUrl,
  files: row.fileCount,
  bytes: statSync(resolve(courseRoot, row.entryPath)).size,
  localizationStatus: row.status === "localized" ? "localized" : "partial",
  failedAssets: row.failures || [],
};

const overview = (manifest.courseDownloads || []).find((item) => item.role === "course_overview" || item.path === overviewRel);
if (!overview) {
  throw new Error("Course Overview courseDownload record not found.");
}

overview.attachments ||= [];
const existingAttachment = overview.attachments.findIndex((item) => item.source === sourceUrl || item.path === row.entryPath);
if (existingAttachment >= 0) overview.attachments[existingAttachment] = { ...overview.attachments[existingAttachment], ...record };
else overview.attachments.push(record);

overview.resources ||= [];
const existingResource = overview.resources.findIndex((item) => item.source === sourceUrl || item.path === row.entryPath);
if (existingResource >= 0) overview.resources[existingResource] = { ...overview.resources[existingResource], ...record };
else overview.resources.push(record);
overview.bytes = statSync(overviewPath).size;

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewIspring = {
  source: sourceUrl,
  path: row.entryPath,
  packagePath: row.targetRoot,
  status: record.localizationStatus,
  files: row.fileCount,
  failures: row.failures?.length || 0,
  patchedAt: new Date().toISOString(),
};
manifest.sourceAudit.ispringExpected = 22;
manifest.sourceAudit.ispringComplete = 21 + (record.localizationStatus === "localized" ? 1 : 0);
manifest.sourceAudit.ispringPartial = 1;
manifest.sourceAudit.ispringExternalEmbedsPending = 0;
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course: "CGC1D",
  htmlChanged,
  overviewPath: overviewRel,
  entryPath: row.entryPath,
  status: record.localizationStatus,
  failures: row.failures?.length || 0,
}, null, 2));
