import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BAF3M");
const manifestPath = join(courseRoot, "course-manifest.json");
const targetRootRel = "ispring-localized/unit-00/course-overview";
const targetRoot = join(courseRoot, targetRootRel);
const previewJsonPath = join(projectRoot, "deployment", "BAF3M-course-overview-preview.json");
const pageRel = "course-sections/course-overview/index.html";
const sourceUrl = "https://hexstruct.ispring.com/s/embed_player/38fb0d93-d44a-11ed-8863-3a9a83d567ea";
const origin = "https://hexstruct.ispring.com";

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function removeRollSectionsByTitle(data, titles) {
  const titleSet = new Set(titles.map((title) => title.toLowerCase()));
  const courseState = data?.state?.c;
  const pages = courseState?.B;
  const order = courseState?.o;
  if (!pages || !Array.isArray(order)) return [];

  const removed = [];
  for (const [key, page] of Object.entries(pages)) {
    const title = String(page?.h?.t || "").trim();
    if (!titleSet.has(title.toLowerCase())) continue;
    delete pages[key];
    removed.push(title);
  }

  if (removed.length) {
    courseState.o = order.filter((key) => Object.hasOwn(pages, key));
  }
  return removed;
}

function collectSourcePaths(value, out = new Set()) {
  if (typeof value === "string") {
    if (/^(data|assets|content|res)\//i.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectSourcePaths(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectSourcePaths(item, out);
  }
  return out;
}

async function download(url, rel) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const target = join(targetRoot, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return bytes.length;
}

function existingTemplate(label, type, path, previewPath = path, downloadPath = path) {
  const absolutePath = join(courseRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing local template file: ${path}`);
  }
  return {
    label,
    type,
    category: type === "h5p" ? "h5p" : "moodle_file",
    role: "course_template",
    path,
    bytes: statSync(absolutePath).size,
    previewPath,
    downloadPath,
  };
}

function extForFileName(fileName) {
  return String(fileName).split(".").pop()?.toLowerCase() || "file";
}

function buildTemplateResources() {
  return [
    existingTemplate(
      "Learning Log.docx",
      "docx",
      "localized-moodle-activities/assign/assign-10949-Learning-Log/files/e48715535f-Learning%20Log.docx",
      "previews-html/localized-moodle-activities/assign/assign-10949-Learning-Log/files/e48715535f-Learning_20Log.docx.html",
    ),
    existingTemplate(
      "Learning Log-Sample v1.0.pdf",
      "pdf",
      "localized-moodle-activities/assign/assign-10949-Learning-Log/files/d8fd11dd0e-Learning%20Log-Sample%20v1.0.pdf",
    ),
    existingTemplate(
      "Unit 1 KWL.docx",
      "docx",
      "Unit 1/Lesson 1 - Accounting & Bookkeeping/book_sections/files/02-lesson/c0f34236fc-Unit 1 KWL.docx",
      "previews-html/Unit 1/Lesson 1 - Accounting _ Bookkeeping/book_sections/files/02-lesson/c0f34236fc-Unit 1 KWL.docx.html",
    ),
    existingTemplate(
      "Unit 2 KWL.docx",
      "docx",
      "Unit 2/Lesson 1 - Inventory Principals/book_sections/files/02-lesson/1b6de8c839-Unit 2 KWL.docx",
      "previews-html/Unit 2/Lesson 1 - Inventory Principals/book_sections/files/02-lesson/1b6de8c839-Unit 2 KWL.docx.html",
    ),
    existingTemplate(
      "Unit 3 KWL.docx",
      "docx",
      "Unit 3/Lesson 1 - Internal Control System/book_sections/files/02-lesson/56e84b602a-Unit 3 KWL.docx",
      "previews-html/Unit 3/Lesson 1 - Internal Control System/book_sections/files/02-lesson/56e84b602a-Unit 3 KWL.docx.html",
    ),
    existingTemplate(
      "Unit 4 KWL.docx",
      "docx",
      "Unit 4/Lesson 1 - Accounting Ethics/book_sections/files/02-lesson/5d549ee56a-Unit 4 KWL.docx",
      "previews-html/Unit 4/Lesson 1 - Accounting Ethics/book_sections/files/02-lesson/5d549ee56a-Unit 4 KWL.docx.html",
    ),
    existingTemplate(
      "Unit 1 End-of-Unit Reflection.docx",
      "docx",
      "Unit 1/Lesson 7 - Year End Procedures/book_sections/files/02-lesson/ad7ca673d7-Unit 1 Reflection.docx",
      "previews-html/Unit 1/Lesson 7 - Year End Procedures/book_sections/files/02-lesson/ad7ca673d7-Unit 1 Reflection.docx.html",
    ),
    existingTemplate(
      "Unit 2 End-of-Unit Reflection.docx",
      "docx",
      "Unit 2/Lesson 6 - Accounting Software/book_sections/files/02-lesson/b9ccb19d6b-Unit 2 Reflection.docx",
      "previews-html/Unit 2/Lesson 6 - Accounting Software/book_sections/files/02-lesson/b9ccb19d6b-Unit 2 Reflection.docx.html",
    ),
    existingTemplate(
      "Unit 3 End-of-Unit Reflection.docx",
      "docx",
      "Unit 3/Lesson 7 - Financial Analysis & Decision Making/book_sections/files/02-lesson/28a5e9d01b-Unit 3 Reflection.docx",
      "previews-html/Unit 3/Lesson 7 - Financial Analysis _ Decision Making/book_sections/files/02-lesson/28a5e9d01b-Unit 3 Reflection.docx.html",
    ),
    existingTemplate(
      "Unit 4 End-of-Unit Reflection.docx",
      "docx",
      "Unit 4/Lesson 5 - Careers in Accounting/book_sections/files/02-lesson/af51a8573d-Unit 4 Reflection.docx",
      "previews-html/Unit 4/Lesson 5 - Careers in Accounting/book_sections/files/02-lesson/af51a8573d-Unit 4 Reflection.docx.html",
    ),
    existingTemplate(
      "Exit Slip H5P package",
      "h5p",
      "localized-moodle/h5p-external/0131-title.h5p",
      "localized-moodle/h5p-external/0131-title/index.html",
      "localized-moodle/h5p-external/0131-title.h5p",
    ),
  ];
}

function localizeRollTemplateAttachments(data, resources) {
  const byLabel = new Map(resources.map((item) => [item.label, item]));
  const attachmentMap = new Map([
    ["End of Unit Reflection.docx", { resourceLabel: "Unit 1 End-of-Unit Reflection.docx", playerFileName: "End of Unit Reflection.docx" }],
    ["KWL Chart.docx", { resourceLabel: "Unit 1 KWL.docx", playerFileName: "KWL Chart.docx" }],
    ["Learning Log.docx", { resourceLabel: "Learning Log.docx", playerFileName: "Learning Log.docx" }],
    ["Exit Slip.docx", { resourceLabel: "Exit Slip H5P package", playerFileName: "Exit Slip.h5p" }],
  ]);
  const copied = [];

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    if (value.t === "a" && typeof value.fn === "string" && attachmentMap.has(value.fn)) {
      const mapping = attachmentMap.get(value.fn);
      const resource = byLabel.get(mapping.resourceLabel);
      if (!resource) throw new Error(`Missing template resource mapping: ${mapping.resourceLabel}`);
      const sourcePath = join(courseRoot, resource.downloadPath || resource.path);
      if (!existsSync(sourcePath)) throw new Error(`Missing source template for iSpring: ${resource.downloadPath || resource.path}`);

      const targetRel = `templates/${mapping.playerFileName}`;
      const targetPath = join(targetRoot, "resources", targetRel);
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);

      value.fn = mapping.playerFileName;
      value.fe = extForFileName(mapping.playerFileName);
      value.fs = statSync(targetPath).size;
      value.iL = false;
      value.s = targetRel;
      copied.push({ original: mapping.resourceLabel, fileName: mapping.playerFileName, rel: `resources/${targetRel}` });
    }

    Object.values(value).forEach(visit);
  }

  visit(data);
  return copied;
}

function buildTemplateSection(resources) {
  const rows = resources
    .map((resource) => {
      const viewHref = relativeHref(pageRel, resource.previewPath || resource.path);
      const downloadHref = relativeHref(pageRel, resource.downloadPath || resource.path);
      return `<div class="file-row"><div class="file-label">${escapeHtml(resource.label)}</div><div class="actions"><a class="button" href="${viewHref}">View</a><a class="button" href="${downloadHref}" download>Download</a></div></div>`;
    })
    .join("");
  return `<section class="overview-block templates-local"><h2>Templates</h2><p>These files are the local Moodle copies that correspond to the course templates referenced in the overview presentation. Exit Slip is provided as the local H5P activity package, not as a fixed Word document.</p>${rows}</section>`;
}

if (!existsSync(previewJsonPath)) throw new Error(`Missing preview JSON: ${previewJsonPath}`);
if (!existsSync(join(targetRoot, "index.html"))) throw new Error(`Missing roll preview shell: ${targetRootRel}/index.html`);

const preview = JSON.parse(readFileSync(previewJsonPath, "utf8"));
const playerData = preview.playerData;
if (!playerData) throw new Error("Missing playerData in preview JSON.");
const templateResources = buildTemplateResources();
const localizedRollTemplates = localizeRollTemplateAttachments(playerData, templateResources);

const downloaded = [];
mkdirSync(join(targetRoot, "lng"), { recursive: true });
downloaded.push({
  rel: "lng/en-US.c9165f.json",
  bytes: await download(`${origin}/roll-preview/lng/en-US.c9165f.json`, "lng/en-US.c9165f.json"),
});

const resourceBase = new URL(playerData.resourcesBaseUrl || "/", origin);
for (const rel of collectSourcePaths(playerData)) {
  if (rel.startsWith("data/") && /\.(woff2?|ttf|eot)$/i.test(rel)) continue;
  const localRel = toPosix(join("resources", rel));
  try {
    downloaded.push({ rel: localRel, bytes: await download(new URL(rel, resourceBase).toString(), localRel) });
  } catch (error) {
    downloaded.push({ rel: localRel, error: String(error?.message || error) });
  }
}

playerData.resourcesBaseUrl = "resources/";
playerData.playerI18nUrl = "lng/en-US.c9165f.json";
playerData.editorDocumentUrl = "";

let shell = readFileSync(join(targetRoot, "index.html"), "utf8");
const starter = `
<script>
window.addEventListener("load", () => {
  const playerData = ${escapeScriptJson(JSON.stringify(playerData))};
  const start = () => {
    if (typeof window.createPreviewPlayer === "function") {
      window.createPreviewPlayer(playerData, "en-US");
    } else {
      window.setTimeout(start, 50);
    }
  };
  start();
});
</script>`;

shell = shell.replace(/\s*<\/body>/i, `${starter}\n</body>`);
writeFileSync(join(targetRoot, "presentation.html"), shell, "utf8");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const overview = (manifest.courseSections || []).find((item) => item.role === "course_overview");
if (!overview) throw new Error("Missing course_overview manifest item.");

const entryPath = `${targetRootRel}/presentation.html`;
overview.ispring = [
  {
    label: "BAF3M Course Overview iSpring",
    type: "ispring",
    category: "ispring",
    role: "course_overview_ispring",
    mode: "page",
    path: entryPath,
    packagePath: targetRootRel,
    bytes: statSync(join(courseRoot, entryPath)).size,
    source: sourceUrl,
    localizationStatus: downloaded.some((item) => item.error) ? "partial" : "localized",
    failedAssets: downloaded.filter((item) => item.error),
  },
];
overview.packagePath = targetRootRel;

const pagePath = join(courseRoot, pageRel);
let pageHtml = readFileSync(pagePath, "utf8");
pageHtml = pageHtml.replace(
  /src="(?:\.\.\/\.\.\/)?ispring-localized\/unit-00\/course-overview\/(?:index|presentation)\.html"|src="\/courseware\/BAF3M\/ispring-localized\/unit-00\/course-overview\/(?:index|presentation)\.html"/,
  `src="/courseware/BAF3M/${escapeHtml(entryPath)}"`,
);
pageHtml = pageHtml.replace(/<section class="overview-block templates-local">[\s\S]*?<\/section>/, "");
pageHtml = pageHtml.replace(/<\/article>/, `${buildTemplateSection(templateResources)}</article>`);
writeFileSync(pagePath, pageHtml, "utf8");
overview.bytes = Buffer.byteLength(pageHtml, "utf8");
overview.attachments = [...(overview.attachments || []).filter((item) => item.role !== "course_template"), ...templateResources];

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewIspring = {
  source: sourceUrl,
  path: entryPath,
  packagePath: targetRootRel,
  localized: !downloaded.some((item) => item.error),
  downloadedAssets: downloaded.length,
  failedAssets: downloaded.filter((item) => item.error),
  localizedRollTemplates,
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  entryPath,
  downloadedAssets: downloaded.filter((item) => !item.error).length,
  failedAssets: downloaded.filter((item) => item.error),
  localizedRollTemplates,
}, null, 2));
