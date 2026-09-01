import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");

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

function normalizeRelPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relativeFromPage(pageRel, targetRel) {
  return posix.relative(posix.dirname(normalizeRelPath(pageRel)), normalizeRelPath(targetRel)) || ".";
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function identity(item) {
  return normalizeRelPath(item?.path || item?.downloadPath || item?.previewPath || item?.source || item?.url || item?.label);
}

function dedupeAttachments(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const key = identity(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function isOrdinaryFile(item) {
  const type = String(item?.type || "").toLowerCase();
  const path = normalizeRelPath(item?.path || item?.downloadPath || item?.href).toLowerCase();
  if (!item?.path && !item?.downloadPath && !item?.href) return false;
  return !["html", "htm", "h5p", "mp4", "webm", "mov", "m4v", "ispring"].includes(type)
    && !/\.(?:html?|h5p|mp4|webm|mov|m4v)(?:$|[?#])/i.test(path);
}

function isHomeworkSubmission(item) {
  const role = String(item?.role || "").toLowerCase();
  const parentSection = String(item?.parentSection || "").toLowerCase();
  const sourceGroup = String(item?.sourceGroup || "").toLowerCase();
  if (role === "homework_answer_page" || /answer/.test(role)) return false;
  if (role === "homework_submission_page" || role === "homework_submission") return true;
  return /homework[\s_-]*submission[\s_-]*folder/.test(`${parentSection} ${sourceGroup}`);
}

function isHomeworkBookSection(section) {
  const scope = [
    section?.label,
    section?.sectionLabel,
    section?.role,
    section?.category,
    section?.path,
  ].join(" ").toLowerCase().replace(/home[\s_-]*work/g, "homework");
  return scope.includes("homework");
}

function positionKey(item) {
  const labelMatch = String(item?.label || "").match(/unit\s*(\d+)\s*[-–]\s*lesson\s*(\d+)/i);
  const pathMatch = normalizeRelPath(item?.path).match(/U(\d{2})L(\d{2})/i);
  const unit = Number(item?.unit || labelMatch?.[1] || pathMatch?.[1] || 0);
  const lesson = Number(item?.lesson || labelMatch?.[2] || pathMatch?.[2] || 0);
  return unit && lesson ? `${unit}:${lesson}` : "";
}

function attachmentRows(pageRel, attachments) {
  return attachments
    .filter(isOrdinaryFile)
    .map((attachment) => {
      const target = attachment.downloadPath || attachment.path || attachment.href;
      const downloadHref = attachment.href || relativeFromPage(pageRel, target);
      const viewHref = attachment.previewPath ? relativeFromPage(pageRel, attachment.previewPath) : downloadHref;
      const label = attachment.label || normalizeRelPath(target).split("/").pop() || "Attachment";
      return `<li><span class="file-label">${htmlEscape(label)}</span><span class="file-actions"><a class="file-action" href="${htmlEscape(viewHref, true)}">查看</a><a class="file-action" href="${htmlEscape(downloadHref, true)}" download>下载</a></span></li>`;
    })
    .join("");
}

function renderFilesBlock(pageRel, attachments) {
  const rows = attachmentRows(pageRel, attachments);
  return rows ? `<section class="attachments files"><h2>Files</h2><ul>${rows}</ul></section>` : "";
}

function insertFilesBlock(html, filesBlock) {
  if (!filesBlock) return html;
  if (/<section\b(?=[^>]*class=["'][^"']*\b(?:attachments|files)\b)[^>]*>[\s\S]*?<h2>\s*Files\s*<\/h2>/i.test(html)) {
    return html;
  }
  return html.replace(/(\s*<\/div>\s*<\/section>\s*<\/main>\s*)/i, `\n      ${filesBlock}$1`);
}

const course = safeCourse(readArg("--course"));
if (!course) {
  console.error("Usage: node scripts/sync-homework-book-section-attachments.mjs --course COURSE [--dry-run]");
  process.exit(2);
}

const dryRun = hasFlag("--dry-run");
const courseRoot = resolve(readArg("--course-root") || join(coursewareRoot, course));
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const homeworkByPosition = new Map();
for (const item of list(manifest.courseDownloads)) {
  if (!isHomeworkSubmission(item)) continue;
  const key = positionKey(item);
  const attachments = list(item.attachments).filter((attachment) => {
    const rel = normalizeRelPath(attachment?.path || attachment?.downloadPath);
    return isOrdinaryFile(attachment) && (!rel || existsSync(join(courseRoot, rel)));
  });
  if (!key || !attachments.length) continue;
  homeworkByPosition.set(key, dedupeAttachments([...(homeworkByPosition.get(key) || []), ...attachments]));
}

const report = {
  course,
  dryRun,
  matchedHomeworkSubmissions: homeworkByPosition.size,
  scannedHomeworkSections: 0,
  manifestSectionsPatched: 0,
  htmlPagesPatched: 0,
  missingHtmlPages: [],
  unmatchedHomeworkSections: [],
  patched: [],
};

for (const unit of list(manifest.units)) {
  for (const lesson of list(unit.lessons)) {
    const key = `${Number(unit.unit || 0)}:${Number(lesson.lesson || 0)}`;
    const homeworkAttachments = homeworkByPosition.get(key) || [];
    for (const section of list(lesson.bookSections)) {
      if (!isHomeworkBookSection(section)) continue;
      report.scannedHomeworkSections += 1;
      if (!homeworkAttachments.length) {
        report.unmatchedHomeworkSections.push({
          unit: unit.unit,
          lesson: lesson.lesson,
          label: section.label,
          path: section.path,
          reason: "no-homework-submission-attachments",
        });
        continue;
      }

      const beforeAttachments = list(section.attachments).length;
      const mergedAttachments = dedupeAttachments([...list(section.attachments), ...homeworkAttachments]);
      if (mergedAttachments.length !== beforeAttachments) {
        section.attachments = mergedAttachments;
        section.attachmentsReusedFromHomeworkSubmission = true;
        report.manifestSectionsPatched += 1;
      }

      const rel = normalizeRelPath(section.path);
      const htmlPath = join(courseRoot, rel);
      if (!existsSync(htmlPath)) {
        report.missingHtmlPages.push(rel);
        continue;
      }
      const html = readFileSync(htmlPath, "utf8");
      const nextHtml = insertFilesBlock(html, renderFilesBlock(rel, mergedAttachments));
      const htmlPatched = nextHtml !== html;
      if (htmlPatched) {
        if (!dryRun) writeFileSync(htmlPath, nextHtml, "utf8");
        report.htmlPagesPatched += 1;
        section.bytes = dryRun ? section.bytes : statSync(htmlPath).size;
        section.textPreview = stripHtml(nextHtml).slice(0, 240);
      }
      if (mergedAttachments.length !== beforeAttachments || htmlPatched) {
        report.patched.push({
          unit: unit.unit,
          lesson: lesson.lesson,
          label: section.label,
          path: section.path,
          attachments: mergedAttachments.map((attachment) => ({
            label: attachment.label,
            type: attachment.type,
            path: attachment.path,
            previewPath: attachment.previewPath,
          })),
          htmlPatched,
        });
      }
    }
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.homeworkBookSectionAttachmentSync = {
  patchedAt: new Date().toISOString(),
  ...report,
  note: "Homework Submission Folder attachments were synced back to matching lesson Homework book sections so they render inline and on the course overview card.",
};
manifest.generatedAt = new Date().toISOString();

if (!dryRun) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

const reportPath = join(projectRoot, "deployment", `${course}-homework-book-section-attachment-sync-report.json`);
if (!dryRun) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ ...report, reportPath: dryRun ? null : reportPath }, null, 2));
