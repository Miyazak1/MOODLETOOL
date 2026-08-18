import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const workspaceRoot = resolve("D:/工作文件/SUNNYBROOK");
const courseRoot = join(workspaceRoot, "courseware", "CGC1D");
const sourceOverviewRoot = join(workspaceRoot, "courseware", "SNC1D", "ispring-localized", "unit-00", "course-overview");
const targetOverviewRoot = join(courseRoot, "ispring-localized", "unit-00", "CourseOverview");
const manifestPath = join(courseRoot, "course-manifest.json");
const templateNames = ["End of Unit Reflection.docx", "KWL Chart.docx", "Learning Log.docx", "Exit Slip.docx"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function decodePlayerDataLiteral(value) {
  return JSON.parse(JSON.parse(`"${value}"`));
}

function encodePlayerDataLiteral(data) {
  return JSON.stringify(JSON.stringify(data)).slice(1, -1);
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relativeHref(fromRel, toRel) {
  return toPosix(relative(dirname(fromRel), toRel))
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function displayType(item) {
  if (item.role === "course_overview_ispring") return "HTML";
  return String(item.type || item.format || "file").toUpperCase();
}

function renderFileRow(item, overviewRel) {
  const label = htmlEscape(item.label || item.title || item.path);
  const type = htmlEscape(displayType(item));
  const viewTarget = item.previewPath || item.path;
  const viewHref = htmlEscape(relativeHref(overviewRel, viewTarget));
  const downloadTarget = item.downloadPath || item.path;
  const downloadHref = htmlEscape(relativeHref(overviewRel, downloadTarget));
  const downloadButton = item.role === "course_overview_ispring"
    ? ""
    : `<a class="button" href="${downloadHref}" download>Download</a>`;

  return `<div class="file-row"><div class="file-label">${label}<span class="file-type">${type}</span></div><div class="actions"><a class="button" href="${viewHref}">View</a>${downloadButton}</div></div>`;
}

function renderFilesSection(attachments, overviewRel) {
  return `<section class="files"><h2>Files</h2>${attachments.map((item) => renderFileRow(item, overviewRel)).join("")}</section>`;
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  for (const child of Object.values(value)) walk(child, visitor);
}

function patchHtml(path) {
  let html = readFileSync(path, "utf8");
  html = html.replace(/"en-US":"lng\/en-US\.[^"]+\.json"/, '"en-US":"lng/en-US.c9165f.json"');
  html = html.replace(/const playerData = "([\s\S]*?)";\n/, (_match, literal) => {
    const data = decodePlayerDataLiteral(literal);
    data.playerI18nUrl = "lng/en-US.c9165f.json";
    walk(data, (node) => {
      if (!node.fn || !templateNames.includes(node.fn)) return;
      node.s = `templates/${node.fn}`;
      node.iL = false;
    });
    return `const playerData = "${encodePlayerDataLiteral(data)}";\n`;
  });
  writeFileSync(path, html, "utf8");
}

mkdirSync(join(targetOverviewRoot, "lng"), { recursive: true });
copyFileSync(
  join(sourceOverviewRoot, "lng", "en-US.c9165f.json"),
  join(targetOverviewRoot, "lng", "en-US.c9165f.json"),
);

mkdirSync(join(targetOverviewRoot, "resources", "templates"), { recursive: true });
for (const name of templateNames) {
  copyFileSync(
    join(sourceOverviewRoot, "resources", "templates", name),
    join(targetOverviewRoot, "resources", "templates", name),
  );
}

for (const htmlFile of ["index.html", "presentation.html"]) {
  const path = join(targetOverviewRoot, htmlFile);
  if (existsSync(path)) patchHtml(path);
}

const manifest = readJson(manifestPath);
const overviewRecord = (manifest.courseDownloads || []).find((item) => item.role === "course_overview");
const overviewRel = "course-sections/course-overview/index.html";
const overviewHtmlPath = join(courseRoot, overviewRel);
const overviewIspringRel = "ispring-localized/unit-00/CourseOverview/presentation.html";
const templateRecords = templateNames.map((name) => {
  const rel = `ispring-localized/unit-00/CourseOverview/resources/templates/${name}`;
  return {
    label: name,
    mode: "file",
    type: "docx",
    category: "template",
    role: "course_overview_template",
    path: rel,
    downloadPath: rel,
    bytes: statSync(join(courseRoot, rel)).size,
    source: "Course Overview iSpring internal template",
  };
});

if (overviewRecord) {
  overviewRecord.attachments ||= [];
  overviewRecord.resources ||= [];
  const overviewIspringRecords = [...overviewRecord.attachments, ...overviewRecord.resources]
    .filter((item) => item.role === "course_overview_ispring" || item.path === overviewIspringRel);
  for (const record of overviewIspringRecords) {
    record.localizationStatus = "localized";
    record.failedAssets = [];
    record.path = overviewIspringRel;
    record.previewPath = overviewIspringRel;
    record.bytes = statSync(join(courseRoot, overviewIspringRel)).size;
  }
  for (const record of templateRecords) {
    const index = overviewRecord.attachments.findIndex((item) => item.path === record.path || item.label === record.label);
    if (index >= 0) overviewRecord.attachments[index] = { ...overviewRecord.attachments[index], ...record };
    else overviewRecord.attachments.push(record);
  }

  const existingHtml = readFileSync(overviewHtmlPath, "utf8");
  const filesSection = renderFilesSection(overviewRecord.attachments, overviewRel);
  const nextHtml = existingHtml.match(/<section class="files">[\s\S]*?<\/section>/)
    ? existingHtml.replace(/<section class="files">[\s\S]*?<\/section>/, filesSection)
    : existingHtml.replace(/\s*<\/main>/, `\n    ${filesSection}\n  </main>`);
  writeFileSync(overviewHtmlPath, nextHtml, "utf8");
  overviewRecord.bytes = statSync(overviewHtmlPath).size;
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewIspring ||= {};
manifest.sourceAudit.courseOverviewIspring.status = "localized";
manifest.sourceAudit.courseOverviewIspring.languagePack = "ispring-localized/unit-00/CourseOverview/lng/en-US.c9165f.json";
manifest.sourceAudit.courseOverviewIspring.internalTemplates = templateRecords.map((item) => item.path);
manifest.sourceAudit.courseOverviewIspring.repairedAt = new Date().toISOString();
manifest.sourceAudit.ispringComplete = 22;
manifest.sourceAudit.ispringPartial = 0;
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course: "CGC1D",
  languagePack: "lng/en-US.c9165f.json",
  templates: templateRecords.length,
  presentationBytes: statSync(join(targetOverviewRoot, "presentation.html")).size,
}, null, 2));
