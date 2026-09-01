import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG2D";
const courseRoot = join(workspaceRoot, "courseware", course);
const stagingRoot = join(projectRoot, "deployment", "course-package-staging", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRelPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function relativeFromPage(pageRel, targetRel) {
  return posix.relative(posix.dirname(normalizeRelPath(pageRel)), normalizeRelPath(targetRel)) || ".";
}

function extractTitle(html, fallback) {
  return (
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() ||
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() ||
    fallback
  );
}

function extractIntro(html) {
  const introStart = html.search(/<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>/i);
  if (introStart < 0) return "";
  const fromIntro = html.slice(introStart);
  const bounded = fromIntro.match(
    /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*(?:<\/div>\s*)?<div\b[^>]*\brole=["']main["']/i,
  );
  if (bounded) return bounded[1];
  const loose = fromIntro.match(/<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  return loose?.[1] || "";
}

function extractRoleMain(html) {
  const match = html.match(
    /<div\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)(?:<div\b[^>]*\bclass=["'][^"']*\bmodified\b[^"']*["'][^>]*>|<nav\b[^>]*\bclass=["'][^"']*\bactivity-navigation\b|<\/section>\s*<\/div>\s*<\/div>)/i,
  );
  return match?.[1] || "";
}

function extractExistingArticleBody(html) {
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] || "";
  if (!article) return "";
  return article
    .replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, "")
    .replace(/<section\b[^>]*\bclass=["'][^"']*\battachments\b[^"']*["'][\s\S]*?<\/section>/gi, "");
}

function removeDuplicateHeading(body, title) {
  const titleText = stripTags(title).toLowerCase();
  return String(body || "").replace(/^\s*<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>\s*/i, (full, heading) =>
    stripTags(heading).toLowerCase() === titleText ? "" : full,
  );
}

function cleanBody(body, title) {
  let cleaned = String(body || "");
  cleaned = cleaned.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<form\b[\s\S]*?<\/form>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>[\s\S]*$/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bclass=["'][^"']*\bfileuploadsubmission(?:time)?\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/<img\b[^>]*(?:data-localized-link|data-localized-src)=["'][^"']*["'][^>]*>/gi, "");
  cleaned = cleaned.replace(/<a\b([^>]*?)\sdata-localized-link=["'][^"']+["']([^>]*)>([\s\S]*?)<\/a>/gi, "$3");
  cleaned = cleaned.replace(/\sdata-localized-(?:link|src)=["'][^"']*["']/gi, "");
  cleaned = cleaned.replace(/\s+yuiConfig='[^']*'/gi, "");
  cleaned = cleaned.replace(/\s+id=["']yui_[^"']*["']/gi, "");
  cleaned = cleaned.replace(/\s(?:width|height|cellspacing|cellpadding|border)=["'][^"']*["']/gi, "");
  cleaned = cleaned.replace(/<p\b[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*<\/p>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*>\s*(?:<ul>\s*(?:<li>\s*)?<\/li>\s*<\/ul>\s*)?<\/div>/gi, "");
  cleaned = cleaned.replace(/(?:<br\b[^>]*>\s*){3,}/gi, "<br><br>");
  cleaned = cleaned.replace(/\s+/g, " ");
  cleaned = removeDuplicateHeading(cleaned, title).trim();
  if (!stripTags(cleaned)) return "";
  return cleaned;
}

function isDownloadable(attachment) {
  const type = String(attachment?.type || "").toLowerCase();
  const path = String(attachment?.path || attachment?.href || "").toLowerCase();
  return !["mp4", "webm", "mov", "m4v"].includes(type) && !/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(path);
}

function renderAttachments(pageRel, item) {
  const rows = (item.attachments || [])
    .filter((attachment) => attachment?.path || attachment?.href)
    .map((attachment) => {
      const originalHref = attachment.href || relativeFromPage(pageRel, attachment.path);
      const viewHref = attachment.previewPath ? relativeFromPage(pageRel, attachment.previewPath) : originalHref;
      const download = isDownloadable(attachment)
        ? `<a class="file-action" href="${htmlEscape(originalHref, true)}" download>下载</a>`
        : "";
      return `<li><span class="file-label">${htmlEscape(attachment.label || attachment.path || "Attachment")}</span><span class="file-actions"><a class="file-action" href="${htmlEscape(viewHref, true)}">查看</a>${download}</span></li>`;
    })
    .join("");
  return rows ? `<section class="attachments"><h2>Files</h2><ul>${rows}</ul></section>` : "";
}

function pageHtml(title, body, attachmentsHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    h2 { font-size: 20px; margin-top: 24px; }
    img, video, iframe { max-width: 100%; height: auto; }
    a { color: #00396f; font-weight: 700; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .file-label { overflow-wrap: anywhere; }
    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }
    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }
    .file-action:hover { background: #eef6ff; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${body}
      ${attachmentsHtml}
    </article>
  </main>
</body>
</html>
`;
}

function collectItems(manifest) {
  const items = [];
  const seen = new Set();
  function add(item) {
    if (!item || typeof item !== "object") return;
    const rel = normalizeRelPath(item.path || "");
    if (
      rel &&
      !seen.has(rel) &&
      /^localized-moodle-activities\/(?:assign|quiz|page|folder|forum|h5pactivity|hvp)\//i.test(rel) &&
      rel.endsWith("/index.html") &&
      Array.isArray(item.attachments) &&
      item.attachments.length
    ) {
      seen.add(rel);
      items.push(item);
    }
  }
  function walk(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== "object") return;
    add(value);
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") walk(nested);
    }
  }
  walk(manifest.courseDownloads);
  walk(manifest.courseSections);
  walk(manifest.evaluations);
  walk(manifest.teacherResources);
  walk(manifest.units);
  return items;
}

function syncFile(rel) {
  const src = join(courseRoot, rel);
  const dst = join(stagingRoot, rel);
  if (!existsSync(src)) return;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

const manifest = readJson(manifestPath);
const items = collectItems(manifest);
const changed = [];
const skipped = [];

for (const item of items) {
  const rel = normalizeRelPath(item.path);
  const abs = join(courseRoot, rel);
  if (!existsSync(abs)) {
    skipped.push({ path: rel, reason: "missing-html" });
    continue;
  }
  const html = readFileSync(abs, "utf8");
  const title = extractTitle(html, item.label || rel);
  const rawBody = extractIntro(html) || extractExistingArticleBody(html) || extractRoleMain(html);
  const body = cleanBody(rawBody, title);
  const attachmentsHtml = renderAttachments(rel, item);
  const nextHtml = pageHtml(title, body, attachmentsHtml);
  if (nextHtml !== html) {
    writeFileSync(abs, nextHtml, "utf8");
    item.bytes = statSync(abs).size;
    item.textPreview = stripTags(nextHtml).slice(0, 800);
    changed.push(rel);
    syncFile(rel);
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.eng2dMdm4uFileDisplay = {
  fixedAt: new Date().toISOString(),
  pagesChanged: changed.length,
  pagesChecked: items.length,
  skipped,
  standard: "MDM4U localized Moodle activity attachment display",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);
syncFile("course-manifest.json");

console.log(JSON.stringify({ course, pagesChecked: items.length, pagesChanged: changed.length, skipped }, null, 2));
