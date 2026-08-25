import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isStandaloneNumberedLessonActivity(item) {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+(?:\s*\(Answer\))?$/i.test(String(item?.label || "").trim());
}

function isAttachableFile(item) {
  const type = String(item?.type || "").toLowerCase();
  if (!item?.path) return false;
  if (isStandaloneNumberedLessonActivity(item)) return false;
  return /^(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|txt|rtf|gif|png|jpg|jpeg)$/i.test(type) || /\.(pdf|docx?|pptx?|xlsx?|zip|txt|rtf|gif|png|jpe?g)$/i.test(item.path);
}

function sectionStem(section) {
  return toPosix(section?.path || "")
    .split("/")
    .pop()
    ?.replace(/\.html$/i, "")
    .toLowerCase();
}

function downloadSectionStem(item) {
  return toPosix(item?.path || "")
    .toLowerCase()
    .match(/\/book_sections\/files\/([^/]+)\//)?.[1];
}

function classifyFlowValue(value, fallback = "") {
  const scope = String(value || "").toLowerCase();
  if (!scope) return fallback;
  if (scope.includes("expectation")) return "expectations";
  if (scope.includes("handson") || scope.includes("hands_on") || scope.includes("hands on") || scope.includes("hands-on")) return "hands_on";
  if (scope.includes("consolidation") || scope.includes("consoldation")) return "consolidation";
  if (scope.includes("homework")) return "homework";
  if (scope.includes("lesson")) return "lesson";
  return fallback;
}

function flowKey(value) {
  const structured = classifyFlowValue(value?.sectionLabel)
    || classifyFlowValue(value?.role)
    || classifyFlowValue(value?.category);
  if (structured) return structured;
  return classifyFlowValue([value?.label, value?.path].join(" "));
}

function sourceBookChapterId(value) {
  const source = String(value?.source || value?.url || "");
  return source.match(/[?&]chapterid=(\d+)/i)?.[1]
    || source.match(/\/mod_book\/chapter\/(\d+)\//i)?.[1]
    || "";
}

function attachmentIdentity(item) {
  return item.path || item.downloadPath || item.previewPath || item.source || item.label;
}

function uniqueAttachments(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = attachmentIdentity(item);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, item);
  }
  return [...byKey.values()];
}

function asAttachment(item) {
  const next = {
    label: item.label,
    type: item.type,
    category: item.category,
    role: item.role || "attachment",
    path: item.path,
    bytes: item.bytes,
    source: item.source,
    previewPath: item.previewPath,
    downloadPath: item.downloadPath || item.path,
  };
  return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function relativeHref(courseRoot, pagePath, targetRel) {
  return toPosix(relative(dirname(pagePath), join(courseRoot, targetRel)));
}

function fileSectionHtml(courseRoot, pagePath, attachments, variant = "eng3u") {
  const rows = attachments
    .map((attachment) => {
      const viewTarget = attachment.previewPath || attachment.path;
      const downloadTarget = attachment.downloadPath || attachment.path;
      const viewHref = viewTarget ? relativeHref(courseRoot, pagePath, viewTarget) : "";
      const downloadHref = downloadTarget ? relativeHref(courseRoot, pagePath, downloadTarget) : "";
      if (variant === "legacy") {
        const actions = [
          viewHref ? `<a class="button" href="${escapeHtml(viewHref)}">View</a>` : "",
          downloadHref ? `<a class="button" href="${escapeHtml(downloadHref)}" download>Download</a>` : "",
        ]
          .filter(Boolean)
          .join("");
        return `<div class="file-row"><div class="file-label">${escapeHtml(attachment.label || attachment.path)}</div><div class="actions">${actions}</div></div>`;
      }
      const actions = [
        viewHref ? `<a class="file-action" href="${escapeHtml(viewHref)}">查看</a>` : "",
        downloadHref ? `<a class="file-action" href="${escapeHtml(downloadHref)}" download>下载</a>` : "",
      ]
        .filter(Boolean)
        .join("");
      return `<li><span class="file-label">${escapeHtml(attachment.label || attachment.path)}</span><span class="file-actions">${actions}</span></li>`;
    })
    .join("");
  if (variant === "legacy") return `\n    <section class="files"><h2>Files</h2>${rows}</section>\n`;
  return `\n    <section class="attachments files"><h2>Files</h2><ul>${rows}</ul></section>\n`;
}

function upsertFilesSection(html, filesHtml) {
  const cleanHtml = html
    .replace(/\s*<section\b(?=[^>]*class=["'][^"']*\bfiles\b)[^>]*>[\s\S]*?<\/section>\s*/gi, "\n")
    .replace(/\s*<section\b(?=[^>]*class=["'][^"']*\battachments\b)[^>]*>\s*<h2>\s*Files\s*<\/h2>[\s\S]*?<\/section>\s*/gi, "\n");
  if (!/<section\b[^>]*class=["'][^"']*\bmoodle-section\b/i.test(cleanHtml)) {
    if (/<\/main>/i.test(cleanHtml)) return cleanHtml.replace(/<\/main>/i, `${filesHtml}  </main>`);
    if (/<\/body>/i.test(cleanHtml)) return cleanHtml.replace(/<\/body>/i, `${filesHtml}</body>`);
    return `${cleanHtml}\n${filesHtml}`;
  }
  const mainEnd = cleanHtml.search(/<\/main>/i);
  const sectionEnd = mainEnd >= 0 ? cleanHtml.toLowerCase().lastIndexOf("</section>", mainEnd) : cleanHtml.toLowerCase().lastIndexOf("</section>");
  if (sectionEnd >= 0) {
    return `${cleanHtml.slice(0, sectionEnd)}${filesHtml}${cleanHtml.slice(sectionEnd)}`;
  }
  if (/<\/main>/i.test(cleanHtml)) return cleanHtml.replace(/<\/main>/i, `${filesHtml}  </main>`);
  if (/<\/body>/i.test(cleanHtml)) return cleanHtml.replace(/<\/body>/i, `${filesHtml}</body>`);
  return `${cleanHtml}\n${filesHtml}`;
}

function ensureShellCss(courseRoot) {
  const target = join(courseRoot, "_assets", "course-page-shell.css");
  if (existsSync(target)) return false;
  const fallbacks = [
    join(workspaceRoot, "courseware", "ENG3U", "_assets", "course-page-shell.css"),
    join(workspaceRoot, "courseware", "ENG4U", "_assets", "course-page-shell.css"),
    join(workspaceRoot, "courseware", "MDM4U", "_assets", "course-page-shell.css"),
  ];
  const source = fallbacks.find((candidate) => existsSync(candidate));
  if (!source) throw new Error("Could not find course-page-shell.css fallback");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return true;
}

const course = safeCourse(readArg("--course"));
const dryRun = hasFlag("--dry-run");

if (!course) {
  console.error("Usage: node scripts/repair-book-section-attachments.mjs --course ENG1D [--dry-run]");
  process.exit(2);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
if (!existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const backupRoot = join(courseRoot, "_backups", `${new Date().toISOString().replace(/[:.]/g, "-")}-before-book-section-attachments-repair`);
const changes = [];
let cssAdded = false;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const attachable = (lesson.downloads || []).filter((item) => isAttachableFile(item) && existsSync(join(courseRoot, item.path)));
    for (const section of lesson.bookSections || []) {
      const stem = sectionStem(section);
      if (!stem || !section.path) continue;
      const sectionFlow = flowKey(section);
      const sectionChapterId = sourceBookChapterId(section);
      const matches = attachable
        .filter((item) => {
          const itemStem = downloadSectionStem(item);
          if (itemStem && itemStem === stem) return true;
          const itemChapterId = sourceBookChapterId(item);
          if (itemChapterId && sectionChapterId && itemChapterId === sectionChapterId) return true;
          if (!itemStem && !itemChapterId && sectionFlow && flowKey(item) === sectionFlow) return true;
          return false;
        })
        .map(asAttachment);
      const sectionAttachable = (section.attachments || [])
        .filter((item) => isAttachableFile(item) && existsSync(join(courseRoot, item.path || item.downloadPath || "")))
        .map(asAttachment);
      if (!matches.length && !sectionAttachable.length) continue;

      const existing = new Map((section.attachments || []).map((item) => [attachmentIdentity(item), item]));
      const added = [];
      for (const attachment of matches) {
        const key = attachmentIdentity(attachment);
        if (!key || existing.has(key)) continue;
        existing.set(key, attachment);
        added.push(attachment);
      }
      if (added.length) {
        section.attachments = [...existing.values()];
      }

      const pagePath = join(courseRoot, section.path);
      const pageExists = existsSync(pagePath);
      let htmlChanged = false;
      const currentAttachments = uniqueAttachments([...sectionAttachable, ...matches]);
      if (pageExists) {
        const before = readFileSync(pagePath, "utf8");
        const usesEng3uShell = /data-course-shell=["']eng3u-course-shell-v2["']|<section\b[^>]*class=["'][^"']*\bmoodle-section\b/i.test(before);
        const after = upsertFilesSection(before, fileSectionHtml(courseRoot, pagePath, currentAttachments, usesEng3uShell ? "eng3u" : "legacy"));
        htmlChanged = after !== before;
        if (!dryRun && htmlChanged) {
          if (usesEng3uShell && !cssAdded) cssAdded = ensureShellCss(courseRoot);
          const backupPath = join(backupRoot, section.path);
          mkdirSync(dirname(backupPath), { recursive: true });
          copyFileSync(pagePath, backupPath);
          writeFileSync(pagePath, after, "utf8");
        }
      }

      if (!added.length && !htmlChanged) continue;

      changes.push({
        unit: unit.unit,
        lesson: lesson.lesson,
        lessonTitle: lesson.title,
        sectionLabel: section.sectionLabel,
        path: section.path,
        added: added.map((item) => item.label),
        htmlChanged,
      });
    }
  }
}

if (!dryRun && changes.length) {
  manifest.sourceAudit = manifest.sourceAudit || {};
  manifest.sourceAudit.bookSectionAttachmentsRepairedAt = new Date().toISOString();
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ course, dryRun, backupRoot: dryRun ? null : backupRoot, cssAdded, changedSections: changes.length, samples: changes.slice(0, 20) }, null, 2));
