import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BAT4M");
const manifestPath = join(courseRoot, "course-manifest.json");
const pageRel = "course-sections/course-overview/index.html";
const overviewRel = "ispring-localized/unit-00/course-overview";
const presentationRel = `${overviewRel}/presentation.html`;
const presentationPath = join(courseRoot, presentationRel);
const sourceLangRel = "ispring-localized/unit-00/course-overview/lng/en-US.c9165f.json";
const sourceUrl = "https://hexstruct.ispring.com/s/embed_player/2bf00563-d44f-11ed-8a26-3a9a83d567ea";
const learningLogRel = "localized-moodle-activities/assign/assign-10812-Learning-Log/index.html";

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function href(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function sanitizeSegment(value) {
  return toPosix(value).replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._/\- ]+/g, "_");
}

function fileType(fileName) {
  return String(fileName).split(".").pop()?.toLowerCase() || "file";
}

function previewPathFor(path) {
  const rel = `previews-html/${sanitizeSegment(path)}.html`;
  return existsSync(join(courseRoot, rel)) ? rel : undefined;
}

function extractPlayerData(html) {
  const match = html.match(/const playerData = (.*?);\s*\n/s);
  if (!match) throw new Error("Missing embedded playerData in BAT4M Course Overview presentation.");
  return JSON.parse(JSON.parse(match[1]));
}

function replacePlayerData(html, data) {
  return html.replace(/const playerData = .*?;\s*\n/s, `const playerData = ${escapeScriptJson(JSON.stringify(data))};\n`);
}

function findAttachmentBlocks(data) {
  const blocks = [];
  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.t === "a" && typeof value.fn === "string" && typeof value.s === "string") blocks.push(value);
    Object.values(value).forEach(visit);
  }
  visit(data);
  return blocks;
}

function resourceRow(fromRel, resource) {
  const viewHref = href(fromRel, resource.previewPath || resource.path);
  const downloadHref = href(fromRel, resource.downloadPath || resource.path);
  return `<div class="file-row"><div class="file-label">${escapeHtml(resource.label)}</div><div class="actions"><a class="button" href="${viewHref}">View</a><a class="button" href="${downloadHref}" download>Download</a></div></div>`;
}

function fileSection(title, resources, fromRel) {
  if (!resources.length) return "";
  return `<section class="files"><h2>${escapeHtml(title)}</h2>${resources.map((item) => resourceRow(fromRel, item)).join("")}</section>`;
}

function makeActivityPage(title, bodyHtml, attachments, rel) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f5f7fb; color: #102033; line-height: 1.6; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 20px 64px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; box-shadow: 0 14px 36px rgba(16, 32, 51, 0.06); }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; color: #002f5f; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #14395c; }
    p { margin: 0 0 14px; }
    a { color: #00396f; font-weight: 700; }
    .activity-body { overflow-wrap: anywhere; }
    .files { border-top: 1px solid #edf1f6; margin-top: 22px; padding-top: 14px; }
    .file-row { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; justify-content: space-between; margin: 8px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { background: #f4f9ff; border: 1px solid #8db0d7; border-radius: 6px; color: #00396f; display: inline-block; font-weight: 700; padding: 5px 10px; text-decoration: none; }
    @media (max-width: 640px) { article { padding: 20px; } .file-row { align-items: flex-start; flex-direction: column; } .actions { flex-wrap: wrap; } }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${escapeHtml(title)}</h1>
      <div class="activity-body">${bodyHtml}</div>
      ${fileSection("Files", attachments, rel)}
    </article>
  </main>
</body>
</html>
`;
}

function copyLangFile() {
  const target = join(courseRoot, sourceLangRel);
  if (existsSync(target)) return sourceLangRel;
  const candidates = [
    join(workspaceRoot, "courseware", "BAF3M", sourceLangRel),
    join(workspaceRoot, "courseware", "SNC1D", sourceLangRel),
    join(workspaceRoot, "courseware", "SES4U", sourceLangRel),
  ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) throw new Error("Missing reusable roll-preview language file en-US.c9165f.json.");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return sourceLangRel;
}

if (!existsSync(presentationPath)) throw new Error(`Missing presentation: ${presentationRel}`);
copyLangFile();

let presentationHtml = readFileSync(presentationPath, "utf8");
const playerData = extractPlayerData(presentationHtml);
const attachmentBlocks = findAttachmentBlocks(playerData);
const templateResources = [];
const seen = new Set();

mkdirSync(join(courseRoot, overviewRel, "resources", "templates"), { recursive: true });
for (const block of attachmentBlocks) {
  const sourceRel = `${overviewRel}/resources/${block.s}`;
  const sourcePath = join(courseRoot, sourceRel);
  if (!existsSync(sourcePath)) throw new Error(`Missing iSpring attachment asset: ${sourceRel}`);
  const fileName = block.fn;
  const targetRel = `${overviewRel}/resources/templates/${fileName}`;
  const targetPath = join(courseRoot, targetRel);
  if (!existsSync(targetPath) || statSync(targetPath).size !== statSync(sourcePath).size) {
    copyFileSync(sourcePath, targetPath);
  }
  block.s = `templates/${fileName}`;
  block.iL = false;
  block.fe = fileType(fileName);
  block.fs = statSync(targetPath).size;
  if (!seen.has(fileName)) {
    seen.add(fileName);
    templateResources.push({
      label: fileName,
      type: fileType(fileName),
      category: "moodle_file",
      role: "course_template",
      path: targetRel,
      bytes: statSync(targetPath).size,
      previewPath: previewPathFor(targetRel),
      downloadPath: targetRel,
      source: sourceUrl,
    });
  }
}

playerData.resourcesBaseUrl = "resources/";
playerData.playerI18nUrl = "lng/en-US.c9165f.json";
playerData.editorDocumentUrl = "";
presentationHtml = replacePlayerData(presentationHtml, playerData);
writeFileSync(presentationPath, presentationHtml, "utf8");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const overview = (manifest.courseSections || []).find((item) => item.role === "course_overview");
if (!overview) throw new Error("Missing course overview in manifest.");
overview.ispring = [
  {
    label: "BAT4M Course Overview iSpring",
    type: "ispring",
    category: "ispring",
    role: "course_overview_ispring",
    mode: "page",
    path: presentationRel,
    packagePath: overviewRel,
    bytes: statSync(presentationPath).size,
    source: sourceUrl,
    localizationStatus: "localized",
    failedAssets: [],
  },
];
overview.packagePath = overviewRel;
overview.attachments = [
  ...(overview.attachments || []).filter((item) => item.role !== "course_template"),
  ...templateResources,
];

const overviewPath = join(courseRoot, pageRel);
let overviewHtml = readFileSync(overviewPath, "utf8");
overviewHtml = overviewHtml.replace(/<section class="files"><h2>Templates<\/h2>[\s\S]*?<\/section>/g, "");
overviewHtml = overviewHtml.replace(/<section class="overview-block templates-local">[\s\S]*?<\/section>/g, "");
overviewHtml = overviewHtml.replace(
  /<div class="localized-ispring"><iframe[^>]*><\/iframe><\/div>/,
  `<div class="localized-ispring"><iframe src="${escapeHtml(href(pageRel, presentationRel))}" loading="lazy" allowfullscreen="allowfullscreen" title="BAT4M Course Overview"></iframe></div>`,
);
overviewHtml = overviewHtml.replace(/\s*<\/main>/, `\n    ${fileSection("Templates", templateResources, pageRel)}\n  </main>`);
writeFileSync(overviewPath, overviewHtml, "utf8");
overview.bytes = Buffer.byteLength(overviewHtml, "utf8");

const learningLog = (manifest.courseDownloads || []).find((item) => item.role === "learning_log" && item.path === learningLogRel);
const learningLogTemplate = templateResources.find((item) => item.label === "Learning Log.docx");
if (learningLog && learningLogTemplate) {
  learningLog.attachments = [learningLogTemplate];
  const body = `<p>After each unit, the student must submit a learning log to track the hours spent on assignments. The learning log is to provide learning accountability from the student and to help the student develop a good study routine. Attached you will find a sample learning log filled out.</p>`;
  const html = makeActivityPage("Learning Log", body, [learningLogTemplate], learningLogRel);
  writeFileSync(join(courseRoot, learningLogRel), html, "utf8");
  learningLog.bytes = Buffer.byteLength(html, "utf8");
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewIspring = {
  source: sourceUrl,
  path: presentationRel,
  packagePath: overviewRel,
  localized: true,
  languageFile: sourceLangRel,
  localizedRollTemplates: templateResources.map((item) => item.path),
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  presentationRel,
  languageFile: sourceLangRel,
  templates: templateResources.map((item) => ({ label: item.label, path: item.path, previewPath: item.previewPath || null })),
  learningLogAttachment: learningLog?.attachments?.[0]?.path || null,
}, null, 2));
