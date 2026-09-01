import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

const workspaceRoot = resolve("D:/工作文件/SUNNYBROOK");
const courseRoot = join(workspaceRoot, "courseware", "CGC1D");
const manifestPath = join(courseRoot, "course-manifest.json");

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function chapterIdFromUrl(value) {
  const text = String(value || "");
  return text.match(/\/chapter\/(\d+)\//i)?.[1] || text.match(/[?&]chapterid=(\d+)/i)?.[1] || "";
}

function fileHash(rel) {
  const path = join(courseRoot, rel);
  if (!existsSync(path)) return "";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

function viewPath(item) {
  if (item.previewPath) return item.previewPath;
  return item.path || item.downloadPath || "";
}

function renderFilesSection(items, pageRel) {
  if (!items.length) return "";
  const rows = items.map((item) => {
    const view = relativeHref(pageRel, viewPath(item));
    const download = relativeHref(pageRel, item.downloadPath || item.path);
    return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${escapeHtml(view, true)}">View</a><a class="button" href="${escapeHtml(download, true)}" download>Download</a></div></div>`;
  }).join("");
  return `<section class="files"><h2>Files</h2>${rows}</section>`;
}

function replaceFilesSection(html, sectionHtml) {
  if (/<section class="files">[\s\S]*?<\/section>/i.test(html)) {
    return html.replace(/<section class="files">[\s\S]*?<\/section>/i, sectionHtml);
  }
  return html.replace(/\s*<\/article>/i, `\n    ${sectionHtml}\n    </article>`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const removed = [];
let updatedDownloads = 0;
let rewrittenPages = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const seen = new Map();
    const nextDownloads = [];
    for (const item of lesson.downloads || []) {
      const chapterId = chapterIdFromUrl(item.source);
      const hash = item.path ? fileHash(item.path) : "";
      const key = chapterId && hash
        ? `${chapterId}|${String(item.label || "").toLowerCase()}|${item.bytes || 0}|${hash}`
        : "";
      if (key && seen.has(key)) {
        removed.push({ kept: seen.get(key).path, removed: item.path, label: item.label });
        for (const rel of [item.path, item.previewPath]) {
          if (!rel) continue;
          const path = join(courseRoot, rel);
          if (existsSync(path)) rmSync(path, { force: true });
        }
        continue;
      }
      if (key) seen.set(key, item);
      nextDownloads.push(item);
    }
    if (nextDownloads.length !== (lesson.downloads || []).length) {
      lesson.downloads = nextDownloads;
      updatedDownloads += 1;
    }

    for (const section of lesson.bookSections || []) {
      const pageRel = toPosix(section.path || "");
      if (!pageRel || !existsSync(join(courseRoot, pageRel))) continue;
      const chapterId = chapterIdFromUrl(section.source);
      if (!chapterId) continue;
      const items = (lesson.downloads || []).filter((item) => String(item.source || "").includes(`/chapter/${chapterId}/`));
      if (!items.length) continue;
      const pagePath = join(courseRoot, pageRel);
      const before = readFileSync(pagePath, "utf8");
      const after = replaceFilesSection(before, renderFilesSection(items, pageRel));
      if (after !== before) {
        writeFileSync(pagePath, after, "utf8");
        section.bytes = statSync(pagePath).size;
        rewrittenPages += 1;
      }
    }
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  cgc1dBookFileActionNormalization: {
    normalizedAt: new Date().toISOString(),
    updatedLessons: updatedDownloads,
    rewrittenPages,
    removedDuplicateFiles: removed,
    note: "Deduplicated identical Moodle book-section files within the same chapter and rewrote Files rows so View uses previewPath while Download uses the original file.",
  },
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ updatedDownloads, rewrittenPages, removed }, null, 2));
