import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLDO";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const outlinePath = join(courseRoot, "localized-moodle-activities", "assign", "course-7752-esldo-course-outline", "files", "ESLDO-Course-Outline-v2.docx");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function rel(path) {
  return toPosix(relative(courseRoot, path));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function uniqueByPath(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items || []) {
    const key = toPosix(item.path || item.previewPath || item.url || item.source || item.label).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

if (!existsSync(outlinePath)) {
  console.error(`Missing downloaded ESLDO course outline: ${outlinePath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
const outlineRelPath = rel(outlinePath);
const outlinePreviewPath = `previews-html/${outlineRelPath}.html`;
const outlineRecord = {
  label: "ESLDO Course Outline",
  type: extname(outlinePath).slice(1).toLowerCase(),
  category: "course_document",
  role: "course_outline",
  path: outlineRelPath,
  bytes: statSync(outlinePath).size,
  source: "https://www.esunnybrook.com/pluginfile.php/7957/mod_assign/introattachment/0/ESLDO-Course-Outline-v2.docx?forcedownload=1",
  moodleActivityId: "7752",
};
if (existsSync(join(courseRoot, outlinePreviewPath))) {
  outlineRecord.previewPath = outlinePreviewPath;
}

manifest.courseDownloads = uniqueByPath([
  outlineRecord,
  ...(manifest.courseDownloads || []).filter((item) => item.role !== "course_outline"),
]);

manifest.teacherResources = [];

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  courseResourcesFinalizedAt: new Date().toISOString(),
  courseOutlineActivityId: "7752",
  courseOutlineUrl: outlineRecord.source,
  teacherPacketVerified: {
    present: false,
    courseId: 74,
    note: "Moodle course id 74 did not expose a separate Teacher Packet section/activity. Answer and solution files stay inside the corresponding Unit resource indexes only.",
  },
};

manifest.generatedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course,
  courseDownloads: manifest.courseDownloads.length,
  courseOutline: outlineRecord,
  teacherResources: manifest.teacherResources.length,
}, null, 2));
