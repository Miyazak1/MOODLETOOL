import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ENG3U");
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function collectFileResources(manifest) {
  const items = [];
  for (const item of manifest.courseDownloads || []) items.push(item);
  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) items.push(item);
  }
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) items.push(unit.unitPlan);
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) items.push(lesson.lessonPlan);
      for (const item of lesson.downloads || []) items.push(item);
      for (const item of lesson.textExports || []) items.push(item);
    }
  }
  return items;
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

const manifest = readJson(manifestPath);
const failures = [];
const units = manifest.units || [];
const lessons = units.flatMap((unit) => unit.lessons || []);
const resources = collectFileResources(manifest);
const previewRequired = resources.filter((item) => /\.(docx|h5p)$/i.test(item.path || ""));
const missingTextDownloads = (manifest.texts || []).filter(
  (text) => text.sourceStatus !== "unavailable" && !(text.materials || []).length,
);

assert(units.length === 5, `Expected 5 units, found ${units.length}.`, failures);
assert(lessons.length === 36, `Expected 36 lessons, found ${lessons.length}.`, failures);
assert(units.every((unit) => unit.unitPlan), "One or more unit plans are missing.", failures);
assert(lessons.filter((lesson) => lesson.planningStatus !== "unit_overview").every((lesson) => lesson.lessonPlan), "One or more lesson plans are missing.", failures);
assert((manifest.sourceAudit?.ispringComplete || 0) === (manifest.sourceAudit?.ispringExpected || 0), "iSpring count does not match expected source audit.", failures);

for (const item of resources) {
  if (item.path) {
    assert(existsSync(join(courseRoot, item.path)), `Missing resource file: ${item.path}`, failures);
  }
}

for (const item of previewRequired) {
  assert(item.previewPath, `Missing previewPath for ${item.path}`, failures);
  if (item.previewPath) {
    assert(existsSync(join(courseRoot, item.previewPath)), `Missing preview file: ${item.previewPath}`, failures);
  }
}

for (const text of missingTextDownloads) {
  failures.push(`Missing downloadable text: ${text.id} (${text.title})`);
}

const summary = {
  course: "ENG3U",
  units: units.length,
  lessons: lessons.length,
  fileResources: resources.length,
  previewRequired: previewRequired.length,
  previewsReady: previewRequired.filter((item) => item.previewPath && existsSync(join(courseRoot, item.previewPath))).length,
  textEntries: manifest.texts?.length || 0,
  missingTextDownloads: missingTextDownloads.map((text) => ({
    id: text.id,
    title: text.title,
    author: text.author,
    suggestedFilename: `${text.id}.pdf`,
  })),
  unavailableTexts: (manifest.texts || [])
    .filter((text) => text.sourceStatus === "unavailable")
    .map((text) => ({
      id: text.id,
      title: text.title,
      author: text.author,
      notes: text.notes,
    })),
  failures,
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exit(1);
