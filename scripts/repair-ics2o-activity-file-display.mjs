import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ICS2O";
const courseRoot = join(workspaceRoot, "courseware", course);
const activitiesRoot = join(courseRoot, "localized-moodle-activities");
const manifestPath = join(courseRoot, "course-manifest.json");

function htmlEscape(value, quote = false) {
  const escaped = String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return quote ? escaped.replace(/"/g, "&quot;") : escaped;
}

function toRel(path) {
  return relative(courseRoot, path).split(sep).join("/");
}

function cleanLabel(name) {
  return basename(name).replace(/^[0-9a-f]{10}-/i, "");
}

function fileType(name) {
  return extname(name).replace(/^\./, "").toLowerCase() || "file";
}

function walk(dir, output = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, output);
    else if (entry.name === "index.html") output.push(fullPath);
  }
  return output;
}

function filesForPage(pagePath) {
  const filesDir = join(dirname(pagePath), "files");
  try {
    return readdirSync(filesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const fullPath = join(filesDir, entry.name);
        return {
          label: cleanLabel(entry.name),
          type: fileType(entry.name),
          path: toRel(fullPath),
          bytes: statSync(fullPath).size,
        };
      });
  } catch {
    return [];
  }
}

function contentFromExisting(html) {
  const match = /<div class="moodle-content">\s*([\s\S]*?)(?:<section class="(?:attachments|files)"|<\/article>)/i.exec(html);
  let content = match?.[1] || "";
  content = content
    .replace(/<div class="box py-3 generalbox boxaligncenter"><div id="assign_files_tree[\s\S]*$/i, "")
    .replace(/<div[^>]*class=["'][^"']*\bfileuploadsubmission\b[^"']*["'][\s\S]*?<\/div>/gi, "")
    .replace(/<img\b[^>]*data-localized-link=["']removed["'][^>]*\/?>/gi, "")
    .replace(/<a\b[^>]*data-localized-link=["']removed["'][^>]*>[\s\S]*?<\/a>/gi, "")
    .trim();
  return content;
}

function renderFiles(files) {
  if (!files.length) return "";
  const rows = files
    .map((file) => {
      const href = `files/${htmlEscape(basename(file.path), true)}`;
      return `      <div class="file-row"><div class="file-label">${htmlEscape(file.label)}</div><div class="actions"><a class="button" href="${href}">View</a><a class="button" href="${href}" download>Download</a></div></div>`;
    })
    .join("\n");
  return `    <section class="files">
      <h2>Files</h2>
${rows}
    </section>`;
}

function pageHtml(title, content, files) {
  const body = content ? `    <article class="content">\n${content}\n    </article>\n` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; margin-left: auto; margin-right: auto; max-width: 100%; }
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
    <h1>${htmlEscape(title)}</h1>
${body}${renderFiles(files)}
  </main>
</body>
</html>
`;
}

function titleFromHtml(html) {
  return /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim()
    || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim()
    || "Moodle Activity";
}

function attachFiles(manifest, byPagePath) {
  const visit = (item) => {
    if (!item || !item.path) return;
    const files = byPagePath.get(item.path);
    if (!files?.length) return;
    item.attachments = files.map((file) => ({ ...file, downloadPath: file.path }));
    item.bytes = statSync(join(courseRoot, item.path)).size;
  };
  for (const item of manifest.courseDownloads || []) visit(item);
  for (const item of manifest.courseSections || []) visit(item);
  for (const item of manifest.teacherResources || []) visit(item);
  for (const item of manifest.evaluations || []) visit(item);
  for (const unit of manifest.units || []) {
    visit(unit.unitPlan);
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
    for (const lesson of unit.lessons || []) {
      visit(lesson.lessonPlan);
      for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) {
        for (const item of lesson[key] || []) visit(item);
      }
    }
  }
}

const byPagePath = new Map();
let repaired = 0;

for (const pagePath of walk(activitiesRoot)) {
  const files = filesForPage(pagePath);
  if (!files.length) continue;
  const html = readFileSync(pagePath, "utf8");
  const title = titleFromHtml(html);
  const content = contentFromExisting(html);
  writeFileSync(pagePath, pageHtml(title, content, files), "utf8");
  byPagePath.set(toRel(pagePath), files);
  repaired += 1;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
attachFiles(manifest, byPagePath);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  activityFileDisplayRepair: {
    repairedAt: manifest.generatedAt,
    course,
    repairedPages: repaired,
    ruleBasis: "MDM4U-style page-internal file display: remove Moodle file tree remnants and render local files as View/Download rows.",
  },
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ course, repairedPages: repaired, manifest: manifestPath }, null, 2));
