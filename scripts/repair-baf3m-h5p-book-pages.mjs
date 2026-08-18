import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const COURSE = "BAF3M";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const MANIFEST_PATH = join(COURSE_ROOT, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function stripExternalH5p(html) {
  return String(html || "")
    .replace(/<iframe\b[^>]*h5p_embed(?:&amp;|&)id=\d+[^>]*>\s*<\/iframe>/gi, "")
    .replace(/<script\b[^>]*h5p-resizer\.js[^>]*>\s*<\/script>/gi, "");
}

function h5pIds(html) {
  return [...String(html || "").matchAll(/h5p_embed(?:&amp;|&)id=(\d+)/gi)].map((match) => match[1]);
}

function h5pPreviewPath(id) {
  const slug = `${String(id).padStart(4, "0")}-title`;
  const rel = `localized-moodle/h5p-external/${slug}/index.html`;
  return existsSync(join(COURSE_ROOT, rel)) ? rel : "";
}

function renderH5pEmbeds(pageRel, ids) {
  return ids
    .map((id) => {
      const previewPath = h5pPreviewPath(id);
      if (!previewPath) return "";
      const src = `${relativeHref(pageRel, previewPath)}?embed=1`;
      return `<div class="embedded-h5p"><iframe src="${src}" title="H5P activity ${escapeHtml(id)}" loading="lazy" allowfullscreen="allowfullscreen"></iframe></div>`;
    })
    .filter(Boolean)
    .join("\n");
}

function renderAttachmentRow(item, pageRel) {
  const viewPath = item.previewPath || item.path;
  const viewButton = viewPath ? `<a class="button" href="${relativeHref(pageRel, viewPath)}">View</a>` : "";
  const downloadButton = item.downloadPath || item.path ? `<a class="button" href="${relativeHref(pageRel, item.downloadPath || item.path)}" download>Download</a>` : "";
  return `<div class="file-row"><div class="file-label">${escapeHtml(item.label || item.path)}</div><div class="actions">${viewButton}${downloadButton}</div></div>`;
}

function renderPage(title, bodyHtml, pageRel, ids, attachments = []) {
  const embeds = renderH5pEmbeds(pageRel, ids);
  const attachmentHtml = attachments.length
    ? `<section class="files"><h2>Files</h2>${attachments.map((item) => renderAttachmentRow(item, pageRel)).join("")}</section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    h3 { font-size: 18px; margin: 22px 0 10px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; max-width: 100%; }
    .localized-ispring { border: 0; display: block; height: min(72vh, 760px); margin: 16px 0; width: 100%; }
    .embedded-h5p { display: block; margin: 16px 0 24px; max-width: 100%; width: 100%; }
    .embedded-h5p iframe { border: 0; display: block; min-height: 640px; width: 100%; }
    .content table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
    .content td, .content th { border: 1px solid #d6e2f0; padding: 8px 10px; }
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
    <h1>${escapeHtml(title)}</h1>
    <article class="content">${bodyHtml || "<p>No page text was available from Moodle.</p>"}${embeds ? `\n${embeds}` : ""}</article>
    ${attachmentHtml}
  </main>
  <script>
    window.addEventListener("message", function (event) {
      if (!event.data || event.data.type !== "ossd:h5p-height") return;
      document.querySelectorAll(".embedded-h5p iframe").forEach(function (iframe) {
        if (event.source === iframe.contentWindow) {
          iframe.style.height = Math.max(Number(event.data.height) || 0, 640) + "px";
        }
      });
    });
  </script>
</body>
</html>
`;
}

function textPreview(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

const manifest = readJson(MANIFEST_PATH);
let restored = 0;
const missingPreviews = [];

function chapterIdFromBookUrl(url) {
  const match = String(url || "").match(/[?&]chapterid=(\d+)/i);
  return match ? match[1] : "";
}

function attachmentsForSection(lesson, section) {
  const chapterId = chapterIdFromBookUrl(section.source);
  if (!chapterId) return [];
  return (lesson.downloads || []).filter((item) => String(item.source || "").includes(`/chapter/${chapterId}/`));
}

function localizeKnownAttachmentLinks(html, attachments, pageRel) {
  let out = html;
  for (const item of attachments) {
    if (!item.source || !(item.downloadPath || item.path)) continue;
    out = out.split(item.source).join(relativeHref(pageRel, item.downloadPath || item.path));
  }
  return out;
}

for (const unit of manifest.units || []) {
  const raw = readJson(join(REPO_ROOT, "inbox", `moodle-book-raw-${COURSE}-U${String(unit.unit).padStart(2, "0")}.json`));
  for (const lesson of unit.lessons || []) {
    const rawLesson = (raw.lessons || []).find((item) => Number(item.lesson) === Number(lesson.lesson));
    if (!rawLesson) continue;
    for (const section of lesson.bookSections || []) {
      const abs = join(COURSE_ROOT, section.path);
      const rawSection = (rawLesson.sections || []).find((item) => Number(item.sectionIndex) === Number(section.sectionIndex));
      if (!rawSection) continue;
      const ids = h5pIds(rawSection.page?.html || "");
      if (!ids.length && (!existsSync(abs) || statSync(abs).size >= 100)) continue;
      for (const id of ids) {
        if (!h5pPreviewPath(id)) missingPreviews.push({ path: section.path, id });
      }
      const attachments = attachmentsForSection(lesson, section);
      const bodyHtml = localizeKnownAttachmentLinks(stripExternalH5p(rawSection.page?.html || ""), attachments, section.path);
      const title = `${COURSE} Unit ${unit.unit} Lesson ${lesson.lesson} - ${section.sectionLabel || rawSection.normalizedLabel || rawSection.label}`;
      const html = renderPage(title, bodyHtml, section.path, ids, attachments);
      writeFileSync(abs, html, "utf8");
      section.bytes = Buffer.byteLength(html, "utf8");
      section.textPreview = textPreview(bodyHtml);
      restored += 1;
    }
  }
}

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ course: COURSE, restored, missingPreviews }, null, 2));
