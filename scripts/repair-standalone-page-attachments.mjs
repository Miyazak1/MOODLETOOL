import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultWorkspaceRoot = resolve(projectRoot, "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
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

function relativeFromPage(pageRel, targetRel) {
  return posix.relative(posix.dirname(normalizeRelPath(pageRel)), normalizeRelPath(targetRel)) || ".";
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function attachmentList(value) {
  return Array.isArray(value) ? value : [];
}

function isDownloadableAttachment(attachment) {
  const type = String(attachment?.type || "").toLowerCase();
  const path = String(attachment?.path || attachment?.downloadPath || attachment?.href || "").toLowerCase();
  return !["mp4", "webm", "mov", "m4v"].includes(type) && !/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(path);
}

function renderAttachments(pageRel, item) {
  const rows = attachmentList(item.attachments)
    .filter((attachment) => attachment?.path || attachment?.href || attachment?.downloadPath)
    .map((attachment) => {
      const downloadHref = attachment.href || relativeFromPage(pageRel, attachment.downloadPath || attachment.path);
      const viewHref = attachment.previewPath ? relativeFromPage(pageRel, attachment.previewPath) : downloadHref;
      const downloadAction = isDownloadableAttachment(attachment)
        ? `<a class="file-action" href="${htmlEscape(downloadHref, true)}" download>下载</a>`
        : "";
      return `<li><span class="file-label">${htmlEscape(attachment.label || attachment.path || "Attachment")}</span><span class="file-actions"><a class="file-action" href="${htmlEscape(viewHref, true)}">查看</a>${downloadAction}</span></li>`;
    })
    .join("");
  return rows ? `<section class="attachments"><h2>Files</h2><ul>${rows}</ul></section>` : "";
}

function collectStandaloneItems(manifest) {
  const items = [];
  const seen = new Set();
  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const rel = normalizeRelPath(value.path || "");
    const standalone = /^localized-moodle-activities\/(?:page|assign)\/[^/]+\/index\.html$/i.test(rel)
      || /^course-sections\/[^/]+\/index\.html$/i.test(rel);
    if (standalone && !seen.has(rel)) {
      seen.add(rel);
      items.push(value);
    }
    for (const nested of Object.values(value)) visit(nested);
  }
  visit(manifest);
  return items;
}

const course = safeCourse(readArg("--course"));
if (!course) {
  console.error("Usage: node scripts/repair-standalone-page-attachments.mjs --course COURSE");
  process.exit(2);
}

const workspaceRoot = resolve(readArg("--workspace-root") || defaultWorkspaceRoot);
const courseRoot = resolve(readArg("--course-root") || join(workspaceRoot, "courseware", course));
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const report = { course, scanned: 0, patched: 0, skipped: [] };

for (const item of collectStandaloneItems(manifest)) {
  const rel = normalizeRelPath(item.path);
  const attachmentsHtml = renderAttachments(rel, item);
  if (!attachmentsHtml) continue;
  report.scanned += 1;
  const abs = join(courseRoot, rel);
  if (!existsSync(abs)) {
    report.skipped.push({ path: rel, reason: "missing-html" });
    continue;
  }
  const html = readFileSync(abs, "utf8");
  if (!/data-course-shell=["']eng3u-course-shell-v2["']/i.test(html)) {
    report.skipped.push({ path: rel, reason: "non-eng3u-shell" });
    continue;
  }
  if (/<section\b(?=[^>]*class=["'][^"']*\b(?:attachments|files)\b)[^>]*>[\s\S]*?<h2>\s*Files\s*<\/h2>/i.test(html)) {
    report.skipped.push({ path: rel, reason: "already-has-files-block" });
    continue;
  }
  const nextHtml = html.replace(/(\s*<\/div>\s*<\/section>\s*<\/main>\s*)/i, `\n      ${attachmentsHtml}$1`);
  if (nextHtml === html) {
    report.skipped.push({ path: rel, reason: "moodle-content-close-not-found" });
    continue;
  }
  writeFileSync(abs, nextHtml, "utf8");
  item.bytes = statSync(abs).size;
  report.patched += 1;
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.standalonePageAttachmentRepair = {
  patchedAt: new Date().toISOString(),
  ...report,
  note: "Added ENG3U Files blocks to standalone course pages that already used the ENG3U shell but did not render manifest attachments.",
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify(report, null, 2));
