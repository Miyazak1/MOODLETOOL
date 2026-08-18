import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultWorkspaceRoot = resolve(projectRoot, "..");

function parseArgs(argv) {
  const args = {
    workspaceRoot: defaultWorkspaceRoot,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--course") args.course = argv[++i];
    else if (arg === "--workspace-root") args.workspaceRoot = argv[++i];
    else if (arg === "--course-root") args.courseRoot = argv[++i];
  }
  if (!args.course) throw new Error("Usage: node scripts/sanitize-localized-activity-html-pages.mjs --course COURSE");
  args.courseRoot ||= join(args.workspaceRoot, "courseware", args.course);
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
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

function extractSanitizedBody(html) {
  const match = html.match(/<div\b[^>]*\bclass=["']activity-body["'][^>]*>([\s\S]*?)(?:<section\b[^>]*\bclass=["']attachments["']|<\/article>)/i);
  return match?.[1]?.replace(/<\/div>\s*<\/div>\s*$/i, "") || "";
}

function extractLocalizedArticleBody(html) {
  const match = html.match(
    /<article\b[^>]*\bclass=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)(?:<\/article>|<section\b[^>]*\bclass=["']files["'])/i,
  );
  return match?.[1] || "";
}

function removeDuplicateLeadingHeading(body, title) {
  const titleText = stripTags(title).toLowerCase();
  return String(body || "").replace(/^\s*<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>\s*/i, (full, heading) => {
    return stripTags(heading).toLowerCase() === titleText ? "" : full;
  });
}

function cleanIntro(body) {
  let cleaned = String(body || "");
  cleaned = cleaned.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bclass=["'][^"']*\bfileuploadsubmissiontime\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/<a\b([^>]*?)\sdata-localized-link=["'][^"']+["']([^>]*)>([\s\S]*?)<\/a>/gi, "$3");
  cleaned = cleaned.replace(/\sdata-localized-link=["'][^"']+["']/gi, "");
  cleaned = cleaned.replace(/\sdata-localized-src=["'][^"']+["']/gi, "");
  cleaned = cleaned.replace(/<form\b[\s\S]*?<\/form>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>\s*(?:<div>\s*<\/div>|\s|&nbsp;)*<\/div>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>[\s\S]*$/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*>\s*(?:<ul>\s*(?:<li>\s*(?:<div>\s*<\/div>\s*)?<\/li>\s*)*<\/ul>\s*)?<\/div>/gi, "");
  cleaned = cleaned.replace(/<p\b[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*<\/p>/gi, "");
  cleaned = cleaned.replace(/<div\bclass=["']box py-3 generalbox boxaligncenter["']>\s*<\/div>/gi, "");
  cleaned = cleaned.replace(/(?:<br\b[^>]*>\s*){3,}/gi, "<br><br>");
  cleaned = cleaned.replace(/\s+yuiConfig='[^']*'/gi, "");
  cleaned = cleaned.replace(/\s+id=["']yui_[^"']*["']/gi, "");
  cleaned = cleaned.replace(/\s(?:width|height|cellspacing|cellpadding|border)=["'][^"']*["']/gi, "");
  cleaned = cleaned.replace(/\s+/g, " ");
  return cleaned.trim();
}

function normalizeRelPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function relativeFromPage(pageRel, targetRel) {
  return posix.relative(posix.dirname(normalizeRelPath(pageRel)), normalizeRelPath(targetRel)) || ".";
}

function isDownloadableAttachment(attachment) {
  const type = String(attachment?.type || "").toLowerCase();
  const path = String(attachment?.path || attachment?.href || "").toLowerCase();
  return !["mp4", "webm", "mov", "m4v"].includes(type) && !/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(path);
}

function renderAttachments(pageRel, item) {
  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
  if (attachments.length === 0) return "";
  const rows = attachments
    .filter((attachment) => attachment?.path || attachment?.href)
    .map((attachment) => {
      const originalHref = attachment.href || relativeFromPage(pageRel, attachment.path);
      const viewHref = attachment.previewPath ? relativeFromPage(pageRel, attachment.previewPath) : originalHref;
      const downloadLink = isDownloadableAttachment(attachment)
        ? `\n              <a class="button" href="${htmlEscape(originalHref, true)}" download>Download</a>`
        : "";
      return `          <li>
            <span>${htmlEscape(attachment.label || attachment.path || "Attachment")}</span>
            <span class="actions">
              <a class="button" href="${htmlEscape(viewHref, true)}">View</a>${downloadLink}
            </span>
          </li>`;
    })
    .join("\n");
  if (!rows) return "";
  return `
        <section class="attachments">
          <h2>Files</h2>
          <ul>
${rows}
          </ul>
        </section>`;
}

function pageHtml(title, body, attachmentsHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f5f7fb; color: #102033; line-height: 1.6; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 20px 64px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; box-shadow: 0 14px 36px rgba(16, 32, 51, 0.06); }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; color: #002f5f; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #14395c; }
    p { margin: 0 0 14px; }
    table { border-collapse: collapse; margin: 16px 0; max-width: 100%; }
    td, th { border: 1px solid #d8e2ef; padding: 8px 10px; vertical-align: top; }
    a { color: #00396f; font-weight: 700; }
    .activity-body { overflow-wrap: anywhere; }
    .activity-body:empty { display: none; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 22px; padding-top: 14px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; justify-content: space-between; padding: 10px 12px; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { background: #f4f9ff; border: 1px solid #8db0d7; border-radius: 6px; color: #00396f; display: inline-block; font-weight: 700; padding: 5px 10px; text-decoration: none; }
    @media (max-width: 640px) {
      article { padding: 20px; }
      .attachments li { align-items: flex-start; flex-direction: column; }
      .actions { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <div class="activity-body">${body}</div>${attachmentsHtml}
    </article>
  </main>
</body>
</html>
`;
}

function collectManifestItems(manifest) {
  const items = [];
  const seen = new Set();
  const add = (item) => {
    if (!item || typeof item !== "object") return;
    if (item.path && !seen.has(item.path)) {
      seen.add(item.path);
      items.push(item);
    }
    for (const attachment of item.attachments || []) add(attachment);
  };
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    if (value.path) add(value);
    for (const nested of Object.values(value)) {
      if (Array.isArray(nested)) nested.forEach(visit);
    }
  };
  visit(manifest.courseDownloads);
  visit(manifest.courseSections);
  visit(manifest.evaluations);
  visit(manifest.teacherResources);
  visit(manifest.units);
  return items;
}

const args = parseArgs(process.argv.slice(2));
const manifestPath = join(args.courseRoot, "course-manifest.json");
const manifest = readJson(manifestPath);
const items = collectManifestItems(manifest).filter((item) =>
  /^localized-moodle-activities\/(?:assign|quiz|page|h5pactivity|hvp)\//i.test(normalizeRelPath(item.path || "")) &&
  normalizeRelPath(item.path || "").endsWith("/index.html"),
);

let sanitized = 0;
const skipped = [];
for (const item of items) {
  const rel = normalizeRelPath(item.path);
  const abs = join(args.courseRoot, rel);
  if (!existsSync(abs)) continue;
  const html = readFileSync(abs, "utf8");
  const title = extractTitle(html, item.label || rel);
  const intro = extractIntro(html) || extractSanitizedBody(html) || extractLocalizedArticleBody(html);
  const body = removeDuplicateLeadingHeading(cleanIntro(intro), title);
  const attachmentsHtml = renderAttachments(rel, item);
  const hasShell = /Completion requirements|Grading summary|Previous Activity|Next Activity|data-localized-link|fileuploadsubmissiontime|assign_files_tree|submissionlinks|Hidden from students|Participants|Submitted|Needs grading/i.test(html);
  const alreadySanitized = /<div\b[^>]*\bclass=["']activity-body["'][^>]*>/i.test(html);
  const existingPreviewHasBody = stripTags(item.textPreview || "").length > 120 && !/^Unit \d+ - .+? Files\b/i.test(stripTags(item.textPreview || ""));
  if (!body && existingPreviewHasBody) {
    skipped.push({ path: rel, reason: "empty-body-would-overwrite-existing-preview" });
    continue;
  }
  if (!hasShell && !attachmentsHtml && !alreadySanitized) {
    skipped.push({ path: rel, reason: "no-shell-markers" });
    continue;
  }
  writeFileSync(abs, pageHtml(title, body, attachmentsHtml), "utf8");
  item.bytes = statSync(abs).size;
  item.textPreview = stripTags(readFileSync(abs, "utf8")).slice(0, 800);
  sanitized += 1;
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.localizedActivityHtmlSanitizer = {
  patchedAt: new Date().toISOString(),
  sanitizedPages: sanitized,
  skipped,
  note:
    "Sanitized localized Moodle activity HTML pages from existing local files by retaining Moodle intro content and manifest attachments while removing platform completion, grading, navigation, attempt state, timestamps, and dead localized links. No teaching content was fabricated.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course: args.course, sanitizedPages: sanitized, skipped }, null, 2));
