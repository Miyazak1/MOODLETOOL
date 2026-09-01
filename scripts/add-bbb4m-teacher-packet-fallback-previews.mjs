import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(projectRoot);
const courseRoot = join(workspaceRoot, "courseware", "BBB4M");
const manifestPath = join(courseRoot, "course-manifest.json");
const teacherPageRel = "localized-moodle-activities/assign/assign-8012-answer-keys/index.html";
const teacherPagePath = join(courseRoot, teacherPageRel);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function htmlEscape(value, attr = false) {
  const escaped = String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return attr ? escaped.replace(/"/g, "&quot;") : escaped;
}

function sanitizeSegment(value) {
  return toPosix(value).replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._/\- ]+/g, "_");
}

function relativeHref(fromRel, toRel) {
  return toPosix(relative(dirname(toPosix(fromRel)), toPosix(toRel))) || ".";
}

function fallbackPreviewHtml(item, previewRel) {
  const label = item.label || item.title || item.name || item.path;
  const downloadHref = relativeHref(previewRel, item.path);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(label)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 960px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 34px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 18px; }
    .notice { border-top: 1px solid #e0e8f2; margin-top: 18px; padding-top: 18px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin-top: 18px; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(label)}</h1>
    <section class="notice">
      <p>This protected or unsupported Word document is stored locally. Use the download button to open it in Microsoft Word.</p>
      <div class="file-row">
        <div class="file-label">${htmlEscape(label)}</div>
        <div class="actions">
          <a class="button" href="${htmlEscape(downloadHref, true)}">View</a>
          <a class="button" href="${htmlEscape(downloadHref, true)}" download>Download</a>
        </div>
      </div>
    </section>
  </main>
</body>
</html>
`;
}

function walk(value, callback) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, callback);
    return;
  }
  if (!value || typeof value !== "object") return;
  callback(value);
  for (const child of Object.values(value)) walk(child, callback);
}

const teacherPrefix = "localized-moodle-activities/assign/assign-8012-answer-keys/files/";
const targets = [];
walk(manifest.teacherResources || [], (item) => {
  if (!item.path || !toPosix(item.path).startsWith(teacherPrefix) || !/\.docx?$/i.test(item.path)) return;
  const previewRel = `previews-html/${sanitizeSegment(item.path)}.html`;
  item.previewPath = previewRel;
  targets.push({ item, previewRel });
});

for (const { item, previewRel } of targets) {
  const previewPath = join(courseRoot, previewRel);
  mkdirSync(dirname(previewPath), { recursive: true });
  writeFileSync(previewPath, fallbackPreviewHtml(item, previewRel), "utf8");
}

if (existsSync(teacherPagePath) && targets.length) {
  let html = readFileSync(teacherPagePath, "utf8");
  for (const { item } of targets) {
    const fileHref = relativeHref(teacherPageRel, item.path);
    const previewHref = relativeHref(teacherPageRel, item.previewPath);
    html = html.replaceAll(`href="${htmlEscape(fileHref, true)}">View</a>`, `href="${htmlEscape(previewHref, true)}">View</a>`);
  }
  writeFileSync(teacherPagePath, html, "utf8");
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.teacherPacketFallbackPreviews = {
  status: targets.length ? "added" : "not_needed",
  count: targets.length,
  note: "Added local fallback preview pages for St.Mary Teacher Packet DOCX files that the lightweight Word preview generator could not extract.",
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course: "BBB4M",
  fallbackPreviews: targets.length,
  teacherPage: teacherPageRel,
  previewPaths: targets.map(({ item }) => item.previewPath),
}, null, 2));
