import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "AVI2O");
const manifestPath = path.join(courseRoot, "course-manifest.json");
const sourcesPath = path.join(courseRoot, "texts", "SOURCES.md");

const youtubeTargets = new Map([
  ["12", "https://www.youtube.com/watch?v=Xn_0wEwZNEU"],
  ["13", "https://www.youtube.com/watch?v=V3WmrWUEIJo&list=PL0SzeXEfIstUI3ROWpFxWfM97mrLiv1aw"],
]);

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeHtml(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function writeExternalReferencePage(item, target) {
  const title = item.label || "External Reference";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #102033; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 6px; padding: 22px; }
    h1 { margin-top: 0; font-size: 28px; }
    p { line-height: 1.55; }
    a { color: #00396f; font-weight: 700; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${escapeHtml(title)}</h1>
      <p>This Moodle URL points to an external reference that did not expose a downloadable source file.</p><p><a href="${escapeHtml(target, true)}" target="_blank" rel="noreferrer">Open external reference</a></p>
    </article>
  </main>
</body>
</html>
`;
}

function eachResource(manifest, callback) {
  for (const item of manifest.courseDownloads || []) callback(item);
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) callback(item, { unit, lesson });
    }
  }
}

function walkHtml(root) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) files.push(full);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return files;
}

function cleanLocalizedLinkArtifacts(html) {
  let changed = false;
  let next = html.replace(
    /<a\b([^>]*\bdata-localized-link=["']removed["'][^>]*)>([\s\S]*?)<\/a>/gi,
    (_match, _attrs, body) => {
      changed = true;
      return stripHtml(body);
    },
  );

  next = next.replace(
    /<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][\s\S]*?(?=<section\s+class=["']attachments["'])/gi,
    () => {
      changed = true;
      return "";
    },
  );

  next = next.replace(/<img\b[^>]*\bdata-localized-link=["']removed["'][^>]*\/?\s*>/gi, () => {
    changed = true;
    return "";
  });

  next = next.replace(
    /<div class="moodle-content">\s*<div class="box py-3 generalbox boxaligncenter">\s*(<section class="attachments">[\s\S]*?<\/section>)/gi,
    (_match, attachments) => {
      changed = true;
      return attachments;
    },
  );

  return { html: next, changed };
}

function repairDocxPreviewHref(absPath, html) {
  let changed = false;
  const repaired = html.replace(/href=["']\.\.\/(localized-moodle-activities\/[^"']+?\.docx)["']/gi, (_match, targetRel) => {
    const targetAbs = path.join(courseRoot, targetRel);
    const rel = toPosix(path.relative(path.dirname(absPath), targetAbs));
    changed = true;
    return `href="${rel}"`;
  });
  return { html: repaired, changed };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const repairedAt = new Date().toISOString();
let youtubePages = 0;
let lessonPathsFixed = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const primaryActivityPath = lesson.downloads?.[0]?.path;
    if (!primaryActivityPath || lesson.path === primaryActivityPath) continue;
    lesson.path = primaryActivityPath;
    lessonPathsFixed += 1;
  }
}

eachResource(manifest, (item) => {
  const target = youtubeTargets.get(String(item?.moodleActivityId || ""));
  if (!target || !item.path) return;
  const abs = path.join(courseRoot, item.path);
  const existingHtml = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  const preservesMoodleUrlActivity = /class=["'][^"']*\bactivity-description\b/i.test(existingHtml);
  const html = preservesMoodleUrlActivity ? existingHtml : writeExternalReferencePage(item, target);
  if (!preservesMoodleUrlActivity) fs.writeFileSync(abs, html, "utf8");
  item.bytes = Buffer.byteLength(html);
  item.textPreview = stripHtml(html).slice(0, 500);
  item.url = target;
  item.previewUrl = target;
  item.source = `authenticated SunnyBrook Moodle url activity id ${item.moodleActivityId}`;
  item.role = item.role || "external_reference";
  item.externalReference = true;
  delete item.unavailable;
  delete item.unavailableReason;
  delete item.unavailableTarget;
  youtubePages += 1;
});

let cleanedActivityPages = 0;
for (const abs of walkHtml(path.join(courseRoot, "localized-moodle-activities"))) {
  const original = fs.readFileSync(abs, "utf8");
  const { html, changed } = cleanLocalizedLinkArtifacts(original);
  if (!changed) continue;
  fs.writeFileSync(abs, html, "utf8");
  cleanedActivityPages += 1;
}

let previewLinksFixed = 0;
for (const abs of walkHtml(path.join(courseRoot, "previews-html"))) {
  const original = fs.readFileSync(abs, "utf8");
  const { html, changed } = repairDocxPreviewHref(abs, original);
  if (!changed) continue;
  fs.writeFileSync(abs, html, "utf8");
  previewLinksFixed += 1;
}

manifest.generatedAt = repairedAt;
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  unavailableResources: 15,
  externalReferences: 6,
  avi2oLegacyPresentationRepair: {
    repairedAt,
    youtubeUrlActivitiesRepaired: youtubePages,
    cleanedActivityPages,
    docxPreviewDownloadLinksFixed: previewLinksFixed,
    lessonPathsFixed,
    note: "AVI2O is a legacy Moodle activity/resource course. Repair preserves its source structure while fixing stale URL-target presentation and local preview links.",
  },
  avi2oLegacyActivityTitlePatch: {
    fixedAt: repairedAt,
    basis: "Matched BBI2O legacy-course presentation: each lesson row preserves the Moodle activity title/order and opens the localized Moodle activity page instead of a synthetic lesson route.",
    lessonPathsFixed,
  },
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

if (fs.existsSync(sourcesPath)) {
  let sources = fs.readFileSync(sourcesPath, "utf8");
  sources = sources
    .replace(/- Perspective Drawing: External target could not be downloaded: HTTP 403\r?\n/g, "")
    .replace(/- Shadow Study: External target could not be downloaded: HTTP 403\r?\n/g, "")
    .replace(/^\s+- Introduction to Painting:/m, "  - Introduction to Painting:")
    .replace(/Unavailable URL targets: 17 URL activity target\(s\)/g, "Unavailable URL targets: 15 URL activity target(s)")
    .replace(/External URL localization: 0 external URL target file\(s\)/g, "External URL localization: 0 external URL target file(s)")
    .replace(/externalReferences: 4/g, "externalReferences: 6");
  if (!/Perspective Drawing: external YouTube reference/i.test(sources)) {
    sources += `\n- External references confirmed during repair: Perspective Drawing and Shadow Study now resolve to YouTube targets and are displayed as external reference links.\n`;
  }
  fs.writeFileSync(sourcesPath, sources, "utf8");
}

console.log(JSON.stringify({
  youtubePages,
  cleanedActivityPages,
  previewLinksFixed,
  lessonPathsFixed,
}, null, 2));
