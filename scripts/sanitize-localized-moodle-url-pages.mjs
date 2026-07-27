import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const courseArg = readArg("--course")?.toUpperCase();

if (!courseArg) {
  console.error("Usage: node scripts/sanitize-localized-moodle-url-pages.mjs --course COURSE");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

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

function isMoodleActivityUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.esunnybrook.com" && /^\/mod\/[^/]+\/view\.php$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function collectItems(manifest) {
  const items = [];
  for (const item of manifest.courseDownloads || []) items.push({ item });
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) items.push({ item });
    }
  }
  return items.map(({ item }) => item).filter(Boolean);
}

function standaloneHtml(title, externalUrl = "") {
  const externalHtml = externalUrl
    ? `<p><a class="button" href="${htmlEscape(externalUrl, true)}" target="_blank" rel="noopener">Open external resource</a></p>`
    : `<p class="notice">Original Moodle URL activity was localized, but its final external target still needs manual confirmation.</p>`;
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
    a { color: #00396f; font-weight: 700; }
    .button { display: inline-block; border: 1px solid #8db0d7; border-radius: 6px; padding: 8px 12px; background: #f4f9ff; text-decoration: none; }
    .notice { border: 1px solid #e0b45c; border-radius: 6px; background: #fff8e8; color: #674000; padding: 10px 12px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${externalHtml}
    </article>
  </main>
</body>
</html>
`;
}

const courseRoot = join(coursewareRoot, courseArg);
const manifestPath = join(courseRoot, "course-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
let sanitizedPages = 0;
let manifestUpdates = 0;
let unresolved = 0;

for (const item of collectItems(manifest)) {
  if (item.category !== "moodle_url" && !/localized-moodle-activities\/url\//i.test(item.path || "")) continue;
  if (item.externalUrl && isMoodleActivityUrl(item.externalUrl)) {
    delete item.externalUrl;
    manifestUpdates += 1;
  }
  if (!item.path || item.type !== "html") continue;
  const abs = join(courseRoot, item.path);
  if (!existsSync(abs)) continue;
  const html = readFileSync(abs, "utf8");
  if (!/www\.esunnybrook\.com\/mod\/url\/view\.php/i.test(html)) continue;
  const externalUrl = item.externalUrl && !isMoodleActivityUrl(item.externalUrl) ? item.externalUrl : "";
  writeFileSync(abs, standaloneHtml(item.label || "External Resource", externalUrl), "utf8");
  item.bytes = statSync(abs).size;
  sanitizedPages += 1;
  if (!externalUrl) unresolved += 1;
}

manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);
console.log(JSON.stringify({ course: courseArg, sanitizedPages, manifestUpdates, unresolvedExternalTargets: unresolved }, null, 2));
