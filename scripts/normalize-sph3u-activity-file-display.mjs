import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SPH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function isNormalizedAttachmentPage(item) {
  const path = String(item?.path || "");
  return (
    /^localized-moodle-activities\/(?:assign|page|quiz|resource|folder|h5pactivity)\/.+\/index\.html$/i.test(path) ||
    /^course-sections\/[^/]+\/index\.html$/i.test(path)
  );
}

function isMediaAttachment(item) {
  const type = String(item?.type || "").toLowerCase();
  return ["mp4", "m4v", "mov", "webm", "mp3", "m4a", "wav", "ogg"].includes(type);
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

function mergeAttachment(list, attachment) {
  if (!attachment?.path) return;
  if (list.some((item) => item.path === attachment.path)) return;
  list.push(attachment);
}

function collectActivityPages(value, pages = new Map()) {
  if (!value || typeof value !== "object") return pages;
  if (Array.isArray(value)) {
    for (const item of value) collectActivityPages(item, pages);
    return pages;
  }

  if (isNormalizedAttachmentPage(value)) {
    const existing = pages.get(value.path) || { item: value, attachments: [] };
    for (const attachment of Array.isArray(value.attachments) ? value.attachments : []) mergeAttachment(existing.attachments, attachment);
    pages.set(value.path, existing);
  }

  for (const child of Object.values(value)) collectActivityPages(child, pages);
  return pages;
}

function attachmentRows(pageRel, attachments) {
  return attachments
    .filter((item) => !isMediaAttachment(item))
    .map((item) => {
      const href = courseRelative(pageRel, item.path);
      const view = item.previewPath ? courseRelative(pageRel, item.previewPath) : href;
      return `<li><span class="file-label">${htmlEscape(item.label || item.title || item.path)}</span><span class="file-actions"><a class="file-action" href="${htmlEscape(view, true)}">查看</a><a class="file-action" href="${htmlEscape(href, true)}" download>下载</a></span></li>`;
    })
    .join("");
}

function renderAttachments(pageRel, attachments) {
  const rows = attachmentRows(pageRel, attachments);
  return rows ? `<section class="attachments"><h2>Files</h2><ul>${rows}</ul></section>` : "";
}

function ensureStyles(html) {
  const cleaned = html
    .replace(/\n\s*\.actions\s*\{[^}]*\}/gi, "")
    .replace(/\n\s*\.button\s*\{[^}]*\}/gi, "");
  const styles = [
    "    .file-label { overflow-wrap: anywhere; }",
    "    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }",
    "    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }",
    "    .file-action:hover { background: #eef6ff; }",
  ].filter((line) => !cleaned.includes(line.trim()));

  if (!styles.length) return cleaned;
  return cleaned.replace(/<\/style>/i, `${styles.join("\n")}\n  </style>`);
}

function normalizePage(html, pageRel, attachments) {
  const withoutFiles = html.replace(/\s*<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "");
  const section = renderAttachments(pageRel, attachments);
  const withSection = section ? withoutFiles.replace(/\s*<\/article>/i, `\n      ${section}\n    </article>`) : withoutFiles;
  return ensureStyles(withSection);
}

function updateManifestBytes(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) updateManifestBytes(item);
    return;
  }
  if (isNormalizedAttachmentPage(value)) {
    const abs = join(courseRoot, value.path);
    if (existsSync(abs)) value.bytes = statSync(abs).size;
  }
  for (const child of Object.values(value)) updateManifestBytes(child);
}

const manifest = readJson(manifestPath);
const pages = collectActivityPages(manifest);
const changed = [];

for (const [pageRel, { attachments }] of pages) {
  const abs = join(courseRoot, pageRel);
  if (!existsSync(abs)) continue;
  const before = readFileSync(abs, "utf8");
  const after = normalizePage(before, pageRel, attachments);
  if (after !== before) {
    writeFileSync(abs, after, "utf8");
    changed.push(pageRel);
  }
}

updateManifestBytes(manifest);
manifest.sourceAudit ||= {};
manifest.sourceAudit.activityFileDisplayNormalizedAt = new Date().toISOString();
manifest.sourceAudit.activityFileDisplayNormalized = {
  course,
  style: "MDM4U localized activity attachment rows",
  pagesChecked: pages.size,
  pagesChanged: changed.length,
  notes: "Localized Moodle activity and course-section file rows use file-label/file-actions/file-action and Chinese action labels. Media attachments remain playback-only and are not listed as downloadable files.",
};
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course, pagesChecked: pages.size, pagesChanged: changed.length, changed }, null, 2));
