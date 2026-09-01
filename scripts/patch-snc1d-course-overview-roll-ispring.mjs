import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SNC1D");
const manifestPath = join(courseRoot, "course-manifest.json");
const pageRel = "course-sections/course-overview/index.html";
const targetRootRel = "ispring-localized/unit-00/course-overview";
const targetRoot = join(courseRoot, targetRootRel);
const presentationRel = `${targetRootRel}/presentation.html`;
const presentationPath = join(courseRoot, presentationRel);
const sourceUrl = "https://hexstruct.ispring.com/s/embed_player/0bf86f2c-db30-11ed-92d9-36840ad1f71b";

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

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function extractPlayerData(html) {
  const match = html.match(/const playerData = (.*?);\s*\n/s);
  if (!match) throw new Error("Missing embedded playerData in Course Overview presentation.");
  return JSON.parse(JSON.parse(match[1]));
}

function replacePlayerData(html, data) {
  const serialized = escapeScriptJson(JSON.stringify(data));
  return html.replace(/const playerData = .*?;\s*\n/s, `const playerData = ${serialized};\n`);
}

function findAttachmentBlocks(data) {
  const blocks = [];
  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.t === "a" && typeof value.fn === "string" && value.s) blocks.push(value);
    Object.values(value).forEach(visit);
  }
  visit(data);
  return blocks;
}

function fileType(fileName) {
  return String(fileName).split(".").pop()?.toLowerCase() || "file";
}

function buildFileSection(title, resources) {
  if (!resources.length) return "";
  const rows = resources
    .map((resource) => {
      const viewHref = relativeHref(pageRel, resource.previewPath || resource.path);
      const downloadHref = relativeHref(pageRel, resource.downloadPath || resource.path);
      return `<div class="file-row"><div class="file-label">${escapeHtml(resource.label)}</div><div class="actions"><a class="button" href="${viewHref}">View</a><a class="button" href="${downloadHref}" download>Download</a></div></div>`;
    })
    .join("");
  return `<section class="files"><h2>${escapeHtml(title)}</h2>${rows}</section>`;
}

if (!existsSync(presentationPath)) throw new Error(`Missing Course Overview iSpring: ${presentationRel}`);

let presentationHtml = readFileSync(presentationPath, "utf8");
const playerData = extractPlayerData(presentationHtml);
const attachmentBlocks = findAttachmentBlocks(playerData);
const templateDirRel = `${targetRootRel}/resources/templates`;
const templateDir = join(courseRoot, templateDirRel);
mkdirSync(templateDir, { recursive: true });

const templateResources = [];
for (const block of attachmentBlocks) {
  const sourceRel = `${targetRootRel}/resources/${block.s}`;
  const sourcePath = join(courseRoot, sourceRel);
  if (!existsSync(sourcePath)) throw new Error(`Missing iSpring template asset: ${sourceRel}`);
  const fileName = block.fn;
  const targetRel = `${templateDirRel}/${fileName}`;
  const targetPath = join(courseRoot, targetRel);
  const previewRel = `previews-html/${targetRel}.html`;
  copyFileSync(sourcePath, targetPath);
  block.s = `templates/${fileName}`;
  block.iL = false;
  block.fs = statSync(targetPath).size;
  block.fe = fileType(fileName);
  templateResources.push({
    label: fileName,
    type: fileType(fileName),
    category: "moodle_file",
    role: "course_template",
    path: targetRel,
    bytes: statSync(targetPath).size,
    previewPath: existsSync(join(courseRoot, previewRel)) ? previewRel : targetRel,
    downloadPath: targetRel,
  });
}

presentationHtml = replacePlayerData(presentationHtml, playerData);
writeFileSync(presentationPath, presentationHtml, "utf8");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const overview = (manifest.courseSections || []).find((item) => item.role === "course_overview");
if (!overview) throw new Error("Missing course_overview manifest item.");

const originalAttachments = (overview.attachments || []).filter((item) => item.role !== "course_template");
const fileAttachments = originalAttachments.filter((item) => item.role !== "course_template");
overview.ispring = [
  {
    label: "SNC1D Course Overview iSpring",
    type: "ispring",
    category: "ispring",
    role: "course_overview_ispring",
    mode: "page",
    path: presentationRel,
    packagePath: targetRootRel,
    bytes: statSync(presentationPath).size,
    source: sourceUrl,
    localizationStatus: "localized",
    failedAssets: [],
  },
];
overview.packagePath = targetRootRel;
overview.attachments = [...originalAttachments, ...templateResources];

const pagePath = join(courseRoot, pageRel);
const originalPage = readFileSync(pagePath, "utf8");
let mainContent = originalPage.match(/<article class="content">([\s\S]*?)<\/article>/)?.[1] || "";
mainContent = mainContent.replace(/\s*<h2>Course Overview Presentation<\/h2>\s*<iframe class="localized-ispring"[^>]*><\/iframe>\s*/g, "");
const pageHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Course Overview</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; max-width: 100%; }
    .localized-ispring { border: 0; display: block; height: min(72vh, 760px); margin: 16px 0; width: 100%; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>Course Overview</h1>
    <article class="content">${mainContent}
      <h2>Course Overview Presentation</h2>
      <iframe class="localized-ispring" src="${escapeHtml(relativeHref(pageRel, presentationRel))}" loading="lazy" allowfullscreen></iframe>
    </article>
    ${buildFileSection("Files", fileAttachments)}
    ${buildFileSection("Templates", templateResources)}
  </main>
</body>
</html>
`;
writeFileSync(pagePath, pageHtml, "utf8");
overview.bytes = Buffer.byteLength(pageHtml, "utf8");

manifest.sourceAudit ||= {};
delete manifest.sourceAudit.courseOverviewExternalIspring;
manifest.sourceAudit.courseOverviewIspring = {
  source: sourceUrl,
  path: presentationRel,
  packagePath: targetRootRel,
  localized: true,
  localizedRollTemplates: templateResources.map((item) => item.label),
};
manifest.sourceAudit.note =
  "External H5P embeds are not displayed because local .h5p packages were not available. Lesson iSpring embeds and the Course Overview roll-preview presentation are represented by local mirrored packages only.";
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ presentationRel, templates: templateResources.map((item) => item.path) }, null, 2));
