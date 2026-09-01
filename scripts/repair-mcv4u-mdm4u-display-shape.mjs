import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSEWARE_ROOT = resolve(WORKSPACE_ROOT, "courseware");
const COURSE = "MCV4U";
const courseRoot = join(COURSEWARE_ROOT, COURSE);
const manifestPath = join(courseRoot, "course-manifest.json");

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function escapeHtml(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function relativeHref(fromRel, targetRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(targetRel)))
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function chapterIdFromSource(url) {
  const value = String(url || "");
  return value.match(/[?&]chapterid=(\d+)/i)?.[1] || value.match(/\/chapter\/(\d+)\//i)?.[1] || "";
}

function cleanFileLabel(item) {
  const fallback = String(item.path || item.downloadPath || "").split(/[\\/]/).pop() || item.label || "File";
  return String(item.label || fallback)
    .replace(/^(DOCUMENT|PDF|WORD|POWERPOINT|PRESENTATION|SPREADSHEET|FILE)\s*-\s*/i, "")
    .trim();
}

function isPageFile(item) {
  const type = String(item.type || "").toLowerCase();
  return ["doc", "docx", "pdf", "ppt", "pptx", "xls", "xlsx"].includes(type);
}

function sameAttachment(left, right) {
  return Boolean(left.path && right.path && left.path === right.path) || Boolean(left.source && right.source && left.source === right.source);
}

function asAttachment(item) {
  return {
    label: cleanFileLabel(item),
    type: item.type,
    category: item.category || "localized_moodle_resource",
    role: item.role || "attachment",
    path: item.downloadPath || item.path,
    bytes: item.bytes,
    source: item.source,
    ...(item.previewPath ? { previewPath: item.previewPath } : {})
  };
}

function ensureAttachmentCss(html) {
  html = html.replace(
    /\n\s*\.files \{[^\n]*\n\s*\.files h2 \{[^\n]*\n\s*\.file-row \{[^\n]*\n\s*\.file-label \{[^\n]*\n\s*\.actions \{[^\n]*\n\s*\.button \{[^\n]*\n\s*\.button:hover \{[^\n]*\n\s*@media \(max-width: 640px\) \{[^\n]*\}\n/g,
    "\n"
  );
  if (html.includes(".attachments ul")) return html;
  const css = `
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .file-label { overflow-wrap: anywhere; }
    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }
    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }
    .file-action:hover { background: #eef6ff; }
`;
  return html.replace("</style>", `${css}  </style>`);
}

function renderAttachmentsSection(pageRel, attachments) {
  const rows = attachments
    .filter((item) => item.path)
    .map((item) => {
      const label = escapeHtml(cleanFileLabel(item));
      const viewHref = escapeHtml(relativeHref(pageRel, item.path), true);
      const downloadHref = escapeHtml(relativeHref(pageRel, item.path), true);
      return `<li><span class="file-label">${label}</span><span class="file-actions"><a class="file-action" href="${viewHref}">查看</a><a class="file-action" href="${downloadHref}" download>下载</a></span></li>`;
    })
    .join("\n");
  if (!rows) return "";
  return `<section class="attachments"><h2>Files</h2><ul>\n${rows}\n</ul></section>`;
}

function upsertAttachmentsSection(section, attachments) {
  const pagePath = join(courseRoot, ...toPosix(section.path).split("/"));
  if (!existsSync(pagePath)) return false;
  let html = readFileSync(pagePath, "utf8");
  html = ensureAttachmentCss(html);
  html = html.replace(/\s*<section class="files">[\s\S]*?<\/section>/gi, "");
  html = html.replace(/\s*<section class="attachments">[\s\S]*?<\/section>/gi, "");
  const attachmentsSection = renderAttachmentsSection(section.path, attachments);
  if (!attachmentsSection) return false;
  if (html.includes("</article>")) {
    html = html.replace("</article>", `\n${attachmentsSection}</article>`);
  } else {
    html = html.replace("</main>", `${attachmentsSection}\n  </main>`);
  }
  writeFileSync(pagePath, html, "utf8");
  return true;
}

function ensureExternalCardCss(html) {
  if (html.includes(".embedded-external-card")) return html;
  const css = `
    .embedded-external-card { align-items: center; background: #f4f8fc; border: 1px solid #cfddeb; border-radius: 8px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; margin: 16px auto 24px; max-width: 760px; padding: 14px 16px; }
    .embedded-external-card a { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; font-weight: 700; padding: 8px 12px; text-decoration: none; }
`;
  return html.replace("</style>", `${css}  </style>`);
}

function iframeSrc(attrs) {
  return String(attrs || "").match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2]?.replaceAll("&amp;", "&") || "";
}

function isMcv4uExternalInteractive(src) {
  const value = String(src || "").toLowerCase();
  return /(^|\/\/)(?:stage\.|www\.)?geogebra\.org\/material\/iframe\//.test(value) || /(^|\/\/)webspace\.ship\.edu\/msrenault\/geogebracalculus\//.test(value);
}

function normalizeHandsOnPage(section) {
  if (!/03-hands-on\.html$/i.test(section.path || "")) return false;
  const pagePath = join(courseRoot, ...toPosix(section.path).split("/"));
  if (!existsSync(pagePath)) return false;
  let html = readFileSync(pagePath, "utf8");
  if (!/<iframe\b/i.test(html)) return false;
  let changed = false;
  html = ensureExternalCardCss(html);
  html = html.replace(/<p>\s*<iframe\b([^>]*)>\s*<\/iframe>\s*<\/p>|<iframe\b([^>]*)>\s*<\/iframe>/gi, (match, attrsInP, attrsBare) => {
    const attrs = attrsInP || attrsBare || "";
    const src = iframeSrc(attrs);
    if (!isMcv4uExternalInteractive(src)) return match;
    changed = true;
    const href = escapeHtml(src, true);
    return `<div class="embedded-external-card" data-frame-blocked-reason="external-math-activity-opens-in-new-tab"><strong>External interactive activity</strong><a href="${href}" target="_blank" rel="noopener noreferrer">Open activity in a new tab</a></div>`;
  });
  if (changed) writeFileSync(pagePath, html, "utf8");
  return changed;
}

function handsOnPageHasExternalCard(section) {
  if (!/03-hands-on\.html$/i.test(section.path || "")) return false;
  const pagePath = join(courseRoot, ...toPosix(section.path).split("/"));
  return existsSync(pagePath) && readFileSync(pagePath, "utf8").includes("embedded-external-card");
}

function existingPath(relPath) {
  if (!relPath) return false;
  return existsSync(join(courseRoot, ...toPosix(relPath).split("/")));
}

function summarizeDownloads(unit) {
  const downloads = unit.lessons.flatMap((lesson) => lesson.downloads || []);
  const countType = (type) => downloads.filter((item) => String(item.type || "").toLowerCase() === type).length;
  unit.summary = {
    ...(unit.summary || {}),
    downloads: downloads.length,
    ispring: unit.lessons.reduce((sum, lesson) => sum + (lesson.ispring || []).length, 0),
    docx: downloads.filter((item) => ["doc", "docx"].includes(String(item.type || "").toLowerCase())).length,
    pdf: countType("pdf"),
    video: downloads.filter((item) => ["mp4", "mov", "webm"].includes(String(item.type || "").toLowerCase())).length,
    h5p: countType("h5p")
  };
}

function updateLessonCounts(lesson) {
  const downloads = lesson.downloads || [];
  lesson.resourceCounts = {
    ...(lesson.resourceCounts || {}),
    downloads: downloads.length,
    bookSections: (lesson.bookSections || []).length,
    ispring: (lesson.ispring || []).length,
    h5p: downloads.filter((item) => String(item.type || "").toLowerCase() === "h5p").length,
    video: downloads.filter((item) => ["mp4", "mov", "webm"].includes(String(item.type || "").toLowerCase())).length
  };
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let movedFiles = 0;
let pageFilesAttached = 0;
let sectionsWithFiles = 0;
let handsOnCards = 0;
let missingReferencedPaths = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const sectionsByChapter = new Map();
    for (const section of lesson.bookSections || []) {
      const chapterId = chapterIdFromSource(section.source);
      if (chapterId) sectionsByChapter.set(chapterId, section);
      normalizeHandsOnPage(section);
      if (handsOnPageHasExternalCard(section)) handsOnCards += 1;
    }

    const retainedDownloads = [];
    for (const item of lesson.downloads || []) {
      const chapterId = chapterIdFromSource(item.source);
      const section = sectionsByChapter.get(chapterId);
      if (!section || !isPageFile(item)) {
        retainedDownloads.push(item);
        continue;
      }
      const attachment = asAttachment(item);
      section.attachments = section.attachments || [];
      if (!section.attachments.some((existing) => sameAttachment(existing, attachment))) {
        section.attachments.push(attachment);
      }
      movedFiles += 1;
    }
    lesson.downloads = retainedDownloads;

    for (const section of lesson.bookSections || []) {
      const attachments = (section.attachments || []).filter((item) => item.path);
      if (!attachments.length) continue;
      pageFilesAttached += attachments.length;
      if (upsertAttachmentsSection(section, attachments)) sectionsWithFiles += 1;
      for (const item of attachments) {
        if (!existingPath(item.path) || (item.previewPath && !existingPath(item.previewPath))) missingReferencedPaths += 1;
      }
    }
    updateLessonCounts(lesson);
  }
  summarizeDownloads(unit);
}

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  mcv4uMdm4uDisplayNormalization: {
    patchedAt: new Date().toISOString(),
    pageFilesAttachedToBookSections: pageFilesAttached,
    movedPageFilesFromLessonDownloadsToBookSectionsThisRun: movedFiles,
    bookSectionsWithFiles: sectionsWithFiles,
    handsOnExternalActivitiesConvertedToCards: handsOnCards,
    missingReferencedPaths,
    note: "DOC/PDF Moodle book attachments are displayed inside their source book section pages; H5P and videos remain separate localized interactive/media resources, matching the MDM4U display model."
  }
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course: COURSE,
  movedFiles,
  pageFilesAttached,
  sectionsWithFiles,
  handsOnCards,
  missingReferencedPaths
}, null, 2));
