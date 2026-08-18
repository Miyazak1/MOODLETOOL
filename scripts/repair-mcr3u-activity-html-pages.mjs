import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "MCR3U");
const pageRoot = join(courseRoot, "localized-moodle-activities", "page");

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function standaloneHtml(title, body) {
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
    .modified { color: #637083; font-size: 13px; margin-top: 18px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <div class="moodle-content">${body}</div>
    </article>
  </main>
</body>
</html>
`;
}

function extractTitle(html, fallback) {
  return /<h1>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    || /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim()
    || fallback;
}

function cleanBody(html) {
  const region = /<div\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<div\b[^>]*\bclass=["'][^"']*\bactivity-navigation\b/i.exec(html)?.[1]
    || /<section\b[^>]*\bid=["']region-main["'][^>]*>([\s\S]*?)<\/section>/i.exec(html)?.[1];
  if (!region) return "";
  return region
    .replace(/<div\b[^>]*\bclass=["'][^"']*\bactivity-header\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, "")
    .replace(/<span\b[^>]*\bid=["']maincontent["'][^>]*><\/span>/gi, "")
    .replace(/<span\b[^>]*\bclass=["'][^"']*\bnotifications\b[^"']*["'][^>]*><\/span>/gi, "")
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/[^"']*["']/gi, ' data-localized-link="removed"')
    .trim();
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile() && entry.name.toLowerCase() === "index.html") out.push(path);
  }
  return out;
}

if (!existsSync(pageRoot)) {
  console.error(`Missing page root: ${pageRoot}`);
  process.exit(1);
}

let scanned = 0;
let repaired = 0;
let skipped = 0;
const failures = [];

for (const path of walk(pageRoot)) {
  scanned++;
  const html = readFileSync(path, "utf8");
  if (!/Skip to main content|Site administration|Log out|Dashboard/i.test(html)) {
    skipped++;
    continue;
  }
  const body = cleanBody(html);
  if (!body) {
    failures.push({ path, reason: "no-main-region" });
    continue;
  }
  const title = extractTitle(html, basename(path));
  writeFileSync(path, standaloneHtml(title, body), "utf8");
  repaired++;
}

console.log(JSON.stringify({
  course: "MCR3U",
  scanned,
  repaired,
  skipped,
  failures,
  largestPageBytes: walk(pageRoot).reduce((max, path) => Math.max(max, statSync(path).size), 0),
}, null, 2));

if (failures.length) process.exitCode = 1;
