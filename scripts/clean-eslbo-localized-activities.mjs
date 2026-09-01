import { existsSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ESLBO");
const manifestPath = join(courseRoot, "course-manifest.json");

const excludedCourseLabels = new Set(["Online Attendance Policy", "COURSE OUTLINE", "STUDENTS SYLLABUS"]);

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

function assertInsideCourse(relPath) {
  const target = resolve(courseRoot, relPath);
  const root = resolve(courseRoot);
  if (!target.startsWith(root)) throw new Error(`Unsafe ESLBO path: ${relPath}`);
  return target;
}

function removeGeneratedItem(item) {
  if (!item.path) return;
  const abs = assertInsideCourse(item.path);
  const top = resolve(courseRoot, item.path.split("/").slice(0, -1).join("/"));
  if (existsSync(top) && top.startsWith(resolve(courseRoot, "localized-moodle-activities", "url"))) {
    rmSync(top, { recursive: true, force: true });
  } else if (existsSync(abs)) {
    rmSync(abs, { force: true });
  }
}

function folderHtml(item) {
  const files = (item.attachments || [])
    .filter((file) => file.path)
    .map((file) => {
      const href = file.href || `files/${file.path.split("/").pop()}`;
      return `<li><a href="${htmlEscape(href, true)}" download>${htmlEscape(file.label || file.path)}</a></li>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(item.label)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 860px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    a { color: #00396f; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(item.label)}</h1>
      <section class="attachments">
        <h2>Files</h2>
        <ul>
${files || "<li>No local files were downloaded for this folder.</li>"}
        </ul>
      </section>
    </article>
  </main>
</body>
</html>
`;
}

const manifest = readJson(manifestPath);
const removed = [];
manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => {
  if (!excludedCourseLabels.has(item.label)) return true;
  removeGeneratedItem(item);
  removed.push(item.label);
  return false;
});

let rewrittenFolders = 0;
for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.downloads || []) {
      if (item.category !== "moodle_folder" || !item.path) continue;
      const abs = assertInsideCourse(item.path);
      writeFileSync(abs, folderHtml(item), "utf8");
      item.bytes = statSync(abs).size;
      rewrittenFolders += 1;
    }
  }
}

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  courseLevelMoodleUrlExclusions: [...new Set([...(manifest.sourceAudit?.courseLevelMoodleUrlExclusions || []), ...removed])],
  cleanupAt: new Date().toISOString(),
  localImportStatus: "authenticated Moodle course activities indexed and localized; broken Moodle URL resources excluded; no Moodle Book or iSpring activities found on course page",
};

writeJson(manifestPath, manifest);
console.log(JSON.stringify({ removed, rewrittenFolders }, null, 2));
