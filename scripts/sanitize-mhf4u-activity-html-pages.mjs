import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MHF4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

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
  return /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || fallback;
}

function extractIntro(html) {
  const match = html.match(
    /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<div\b[^>]*\brole=["']main["']/i,
  );
  return match?.[1] || "";
}

function cleanIntro(body) {
  let cleaned = body;
  cleaned = cleaned.replace(/<div\b[^>]*\bclass=["'][^"']*\bfileuploadsubmissiontime\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/<a\b([^>]*?)\sdata-localized-link=["'][^"']+["']([^>]*)>([\s\S]*?)<\/a>/gi, "$3");
  cleaned = cleaned.replace(/\sdata-localized-link=["'][^"']+["']/gi, "");
  cleaned = cleaned.replace(/\sdata-localized-src=["'][^"']+["']/gi, "");
  cleaned = cleaned.replace(/<form\b[\s\S]*?<\/form>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>\s*<div\b[^>]*><\/div>\s*<\/div>/gi, "");
  cleaned = cleaned.replace(/<p\b[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*<\/p>/gi, "");
  cleaned = cleaned.replace(/(?:<br\b[^>]*>\s*){3,}/gi, "<br><br>");
  cleaned = cleaned.replace(/\s+yuiConfig='[^']*'/gi, "");
  cleaned = cleaned.replace(/\s+id=["'][^"']*["']/gi, "");
  cleaned = cleaned.replace(/\s(?:width|height|cellspacing|cellpadding|border)=["'][^"']*["']/gi, "");
  cleaned = cleaned.replace(/\s+/g, " ");
  return cleaned.trim();
}

function pageHtml(title, body) {
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
    h2 { font-size: 20px; margin-top: 24px; color: #14395c; }
    p { margin: 0 0 14px; }
    table { border-collapse: collapse; margin: 16px 0; max-width: 100%; }
    td, th { border: 1px solid #d8e2ef; padding: 8px 10px; vertical-align: top; }
    a { color: #00396f; font-weight: 700; }
    .no-overflow, .activity-body { overflow-wrap: anywhere; }
    .fileuploadsubmission { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; margin: 10px 0; padding: 12px 14px; }
    .fileuploadsubmission::before { content: "FILE"; background: #e8f1fb; border-radius: 6px; color: #16416c; flex: 0 0 auto; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; padding: 5px 8px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <div class="activity-body">
        ${body}
      </div>
    </article>
  </main>
</body>
</html>
`;
}

function collectManifestItems(manifest) {
  const items = [];
  const add = (item) => {
    if (item && typeof item === "object" && item.path) items.push(item);
  };
  for (const item of manifest.courseDownloads || []) add(item);
  for (const item of manifest.courseSections || []) add(item);
  for (const item of manifest.evaluations || []) add(item);
  for (const item of manifest.teacherResources || []) add(item);
  for (const unit of manifest.units || []) {
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(add);
      else add(value);
    }
  }
  return items;
}

const manifest = readJson(manifestPath);
const uniquePaths = new Set(
  collectManifestItems(manifest)
    .filter((item) => /^localized-moodle-activities\/(?:assign|quiz)-/i.test(item.path || "") && item.path.endsWith("/index.html"))
    .map((item) => item.path),
);

let sanitized = 0;
const skipped = [];
for (const rel of uniquePaths) {
  const abs = join(courseRoot, rel);
  if (!existsSync(abs)) continue;
  const html = readFileSync(abs, "utf8");
  if (!/Completion requirements|Grading summary|Previous Activity|Next Activity|data-localized-link|fileuploadsubmissiontime/i.test(html)) continue;
  const title = extractTitle(html, rel);
  const intro = extractIntro(html);
  if (!intro) {
    skipped.push(rel);
    continue;
  }
  let body = cleanIntro(intro);
  body = body.replace(/Download the rubric by clicking\s*HERE\s*to review the achievement of chart\.?/gi, "");
  body = body.replace(/Download the rubric by clicking\s*HERE\s*to review the achievement chart\.?/gi, "");
  writeFileSync(abs, pageHtml(title, body), "utf8");
  sanitized += 1;
}

const textPreviewByPath = new Map();
for (const rel of uniquePaths) {
  const abs = join(courseRoot, rel);
  if (existsSync(abs)) textPreviewByPath.set(rel, stripTags(readFileSync(abs, "utf8")).slice(0, 800));
}

let manifestUpdates = 0;
for (const item of collectManifestItems(manifest)) {
  if (!textPreviewByPath.has(item.path)) continue;
  const abs = join(courseRoot, item.path);
  const textPreview = textPreviewByPath.get(item.path);
  const bytes = statSync(abs).size;
  if (item.textPreview !== textPreview) {
    item.textPreview = textPreview;
    manifestUpdates += 1;
  }
  if (item.bytes !== bytes) {
    item.bytes = bytes;
    manifestUpdates += 1;
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.mhf4uActivityHtmlSanitizer = {
  patchedAt: new Date().toISOString(),
  sanitizedPages: sanitized,
  skipped,
  note:
    "Sanitized MHF4U localized Moodle assignment/quiz HTML pages from existing local files by retaining activity-description content and removing Moodle completion, grading, navigation, attempt state, timestamps, dead localized links, and duplicate generated attachment blocks. Missing Unit 4 quiz rubric source was not fabricated.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course, sanitizedPages: sanitized, manifestUpdates, skipped }, null, 2));
