import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SNC2D");
const manifestPath = join(courseRoot, "course-manifest.json");
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function walkResources(manifest, visit) {
  for (const item of manifest.courseDownloads || []) visit(item);
  for (const text of manifest.texts || []) {
    visit(text);
    for (const material of text.materials || []) visit(material);
  }
  for (const unit of manifest.units || []) {
    for (const resource of Object.values(unit.unitResources || {})) {
      if (Array.isArray(resource)) {
        for (const item of resource) visit(item, unit);
      } else if (resource) {
        visit(resource, unit);
      }
    }
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) visit(lesson.lessonPlan, unit, lesson);
      for (const item of lesson.downloads || []) visit(item, unit, lesson);
      for (const item of lesson.lessonText || []) visit(item, unit, lesson);
      for (const item of lesson.textExports || []) visit(item, unit, lesson);
      for (const item of lesson.ispring || []) visit(item, unit, lesson);
    }
  }
}

function resourceType(path) {
  return extname(path || "").replace(".", "").toLowerCase() || "file";
}

function countResources(manifest) {
  const counts = { downloads: 0, h5p: 0, docx: 0, pdf: 0, video: 0, html: 0 };
  walkResources(manifest, (item) => {
    if (!item?.path) return;
    counts.downloads += 1;
    const type = String(item.type || resourceType(item.path)).toLowerCase();
    if (type === "h5p") counts.h5p += 1;
    if (["doc", "docx"].includes(type)) counts.docx += 1;
    if (type === "pdf") counts.pdf += 1;
    if (["mp4", "webm", "mov"].includes(type)) counts.video += 1;
    if (type === "html") counts.html += 1;
    for (const attachment of item.attachments || []) {
      const attachmentType = String(attachment.type || resourceType(attachment.path)).toLowerCase();
      if (["doc", "docx"].includes(attachmentType)) counts.docx += 1;
      if (attachmentType === "pdf") counts.pdf += 1;
      if (["mp4", "webm", "mov"].includes(attachmentType)) counts.video += 1;
    }
  });
  return counts;
}

function escapeText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const manifest = readJson(manifestPath);
const unavailableUrls = new Map();
const knownUnavailableResources = [
  {
    url: "https://eclasssunnybrook.com/draftfile.php/7062/user/draft/504074609/Unit%202%20Lab%20Video.mp4",
    localHtml: "localized-moodle-activities/assign/course-7022-a149a893fd/index.html",
  },
  {
    url: "https://eclasssunnybrook.com/draftfile.php/7062/user/draft/61741146/Unit%204%20Lab%20Video.mp4",
    localHtml: "localized-moodle-activities/assign/course-7067-9216bc4b56/index.html",
  },
  {
    url: "https://www.hexstruct.com/pluginfile.php/3333/mod_book/chapter/5222/Step%20by%20step%20guide.pdf",
    localHtml: "localized-moodle-activities/assign/U02L06-7036-84e0106f68/index.html",
  },
  {
    url: "https://eclasssunnybrook.com/draftfile.php/7062/user/draft/162304425/Unit%202%20Lesson%201%20Worksheet%20ANSWERS.pdf",
    localHtml: "localized-moodle-activities/page/U01L01-7002-10c0d8b65e/index.html",
  },
  {
    url: "https://eclasssunnybrook.com/draftfile.php/7062/user/draft/219489585/Unit%201%20Lesson%202%20Worksheet%20ANSWERS.pdf?time=1625809249060",
    localHtml: "localized-moodle-activities/page/U01L02-7004-9738fbe897/index.html",
  },
  {
    url: "https://eclasssunnybrook.com/draftfile.php/7062/user/draft/458100504/Unit%204%20Lesson%202%20Worksheet%20ANSWERS.gif",
    localHtml: "localized-moodle-activities/page/U04L02-7074-3a64edc4fa/index.html",
  },
];
for (const item of knownUnavailableResources) {
  unavailableUrls.set(item.url, {
    ...item,
    status: "login-required",
    reason: "Returned login or redirect during localization check.",
  });
}
const unavailablePattern = /https:\/\/(?:eclasssunnybrook\.com\/draftfile\.php|(?:www\.)?hexstruct\.com\/pluginfile\.php)[^"'<> \n\r)]+/gi;

for (const file of listFiles(join(courseRoot, "localized-moodle-activities")).filter((path) => /\.html?$/i.test(path))) {
  let html = readFileSync(file, "utf8");
  const original = html;
  const found = [...new Set([...html.matchAll(unavailablePattern)].map((match) => match[0].replaceAll("&amp;", "&")))];
  for (const url of found) {
    unavailableUrls.set(url, { url, localHtml: toPosix(relative(courseRoot, file)), status: "login-required", reason: "Returned login or redirect during localization check." });
  }
  html = html.replace(/<a\b[^>]*href=["'](https:\/\/(?:eclasssunnybrook\.com\/draftfile\.php|(?:www\.)?hexstruct\.com\/pluginfile\.php)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, url, label) => {
    unavailableUrls.set(url.replaceAll("&amp;", "&"), { url: url.replaceAll("&amp;", "&"), localHtml: toPosix(relative(courseRoot, file)), status: "login-required", reason: "Returned login or redirect during localization check." });
    const text = label.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "source file";
    return `<span class="unavailable-source">${escapeText(text)} (source unavailable)</span>`;
  });
  html = html.replace(/\s(?:href|src|poster)=["']https:\/\/(?:eclasssunnybrook\.com\/draftfile\.php|(?:www\.)?hexstruct\.com\/pluginfile\.php)[^"']+["']/gi, ' data-unavailable-source="login-required"');
  html = html.replace(/https:\/\/(?:eclasssunnybrook\.com\/draftfile\.php|(?:www\.)?hexstruct\.com\/pluginfile\.php)[^"'<> \n\r)]+/gi, "unavailable external source");
  html = html.replace(/\s(data-pageurl|value)=["']https:\/\/www\.esunnybrook\.com\/[^"']+["']/gi, ' $1=""');
  html = html.replace(/https:\/\/www\.esunnybrook\.com\/(?:mod|pluginfile|h5p|course|theme|lib|webservice)\/[^"'<> \n\r)]+/gi, "localized Moodle source");
  if (!/\.unavailable-source/.test(html)) {
    html = html.replace("</style>", "\n    .unavailable-source { color: #6b3d00; font-weight: 700; }\n  </style>");
  }
  if (html !== original) writeFileSync(file, html, "utf8");
}

walkResources(manifest, (item) => {
  if (!item) return;
  if (item.type === "h5p" || item.category === "moodle_h5pactivity") {
    delete item.attachments;
  }
});

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = lesson.downloads?.length || 0;
    lesson.resourceCounts.h5p = (lesson.downloads || []).filter((item) => item.type === "h5p").length;
    lesson.resourceCounts.docx = (lesson.downloads || []).filter((item) => ["doc", "docx"].includes(String(item.type || "").toLowerCase())).length;
    lesson.resourceCounts.pdf = (lesson.downloads || []).filter((item) => String(item.type || "").toLowerCase() === "pdf").length;
    lesson.resourceCounts.video = (lesson.downloads || []).filter((item) => ["mp4", "webm", "mov"].includes(String(item.type || "").toLowerCase())).length;
  }
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0)
    + Object.values(unit.unitResources || {}).flat().length;
  unit.summary.h5p = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length, 0);
  unit.summary.docx = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => ["doc", "docx"].includes(String(item.type || "").toLowerCase())).length, 0);
  unit.summary.pdf = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => String(item.type || "").toLowerCase() === "pdf").length, 0);
  unit.summary.video = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => ["mp4", "webm", "mov"].includes(String(item.type || "").toLowerCase())).length, 0);
}

const counts = countResources(manifest);
manifest.sourceAudit ||= {};
manifest.sourceAudit.lessonCount = manifest.units.reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0);
manifest.sourceAudit.unitCount = manifest.units.length;
manifest.sourceAudit.localResourceCount = counts.downloads;
manifest.sourceAudit.localDocxCount = counts.docx;
manifest.sourceAudit.localPdfCount = counts.pdf;
manifest.sourceAudit.localH5pCount = counts.h5p;
manifest.sourceAudit.localVideoCount = counts.video;
manifest.sourceAudit.failedExternalResources = [...unavailableUrls.values()].sort((a, b) => `${a.localHtml}|${a.url}`.localeCompare(`${b.localHtml}|${b.url}`));
manifest.sourceAudit.failedExternalResourceCount = manifest.sourceAudit.failedExternalResources.length;
manifest.sourceAudit.finalizedAt = new Date().toISOString();
manifest.generatedAt = new Date().toISOString();

mkdirSync(join(courseRoot, "texts"), { recursive: true });
writeFileSync(
  sourcesPath,
  `# SNC2D Sources

Generated: ${new Date().toISOString()}

- Primary course content source: authenticated SunnyBrook Moodle course shell at https://www.esunnybrook.com/course/view.php?id=67.
- Structure: legacy Moodle activity course with four unit Lessons books, lesson dropboxes/pages, quizzes/tests, labs, final/culminating activities, and H5P exit cards.
- H5P: Moodle h5pactivity packages were downloaded from Moodle package URLs and previewed locally.
- iSpring: no iSpring entries are exposed in the current SNC2D Moodle shell.
- Textbook: no distinct textbook file was exposed in the current Moodle shell during this pass, so no textbook was added.
- Unavailable external draftfile/pluginfile links: ${manifest.sourceAudit.failedExternalResourceCount}; these were removed from local HTML and recorded in course-manifest.json sourceAudit.failedExternalResources.
`,
  "utf8",
);

writeJson(manifestPath, manifest);
console.log(JSON.stringify({
  course: "SNC2D",
  units: manifest.units.length,
  lessons: manifest.sourceAudit.lessonCount,
  localResources: counts.downloads,
  docx: counts.docx,
  pdf: counts.pdf,
  h5p: counts.h5p,
  unavailable: manifest.sourceAudit.failedExternalResourceCount,
}, null, 2));
