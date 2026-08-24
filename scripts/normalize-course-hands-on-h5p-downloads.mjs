import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const course = String(arg("--course") || "").trim().toUpperCase();
if (!course) {
  console.error("Usage: node scripts/normalize-course-hands-on-h5p-downloads.mjs --course COURSE");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function handsOnLabel(unitNumber, lessonNumber) {
  return `Hands On - ${course} Unit ${unitNumber} Lesson ${lessonNumber} Hands On Activity`;
}

function keyFor(item) {
  return toPosix(item.path || item.localizedPackagePath || item.originalSource || item.source || item.label).toLowerCase();
}

function upsert(items, item) {
  const key = keyFor(item);
  const index = items.findIndex((existing) => keyFor(existing) === key);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

function isLocalizedHandsOnAudit(item) {
  return (
    item &&
    item.parentSection === "Hands On" &&
    item.localizedPackagePath &&
    item.localizedPreviewPath
  );
}

const manifest = readJson(manifestPath);
const moved = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const handsOnAudit = (lesson.handsOn || []).filter(isLocalizedHandsOnAudit);
    if (!handsOnAudit.length) continue;

    lesson.downloads ||= [];
    for (const item of handsOnAudit) {
      const path = toPosix(item.localizedPackagePath);
      const previewPath = toPosix(item.localizedPreviewPath);
      const abs = join(courseRoot, path);
      const record = {
        label: handsOnLabel(unit.unit, lesson.lesson),
        type: "h5p",
        category: "localized_external_h5p",
        role: "handsOn",
        parentSection: "Hands On",
        sourceGroup: "book_section_embed",
        path,
        previewPath,
        source: item.originalSource || item.source || "",
        originalSource: item.originalSource || "",
        unit: unit.unit,
        lesson: lesson.lesson,
      };
      if (existsSync(abs)) record.bytes = statSync(abs).size;
      upsert(lesson.downloads, record);
      moved.push({ unit: unit.unit, lesson: lesson.lesson, label: record.label, path });
    }

    lesson.handsOn = (lesson.handsOn || []).filter((item) => !isLocalizedHandsOnAudit(item));
    if (!lesson.handsOn.length) delete lesson.handsOn;

    for (const item of lesson.downloads) {
      if (item.category === "localized_external_h5p" && (item.role === "handsOn" || item.role === "hands_on")) {
        item.label = handsOnLabel(unit.unit, lesson.lesson);
        item.parentSection = "Hands On";
        item.sourceGroup = "book_section_embed";
        item.unit = unit.unit;
        item.lesson = lesson.lesson;
        const abs = join(courseRoot, toPosix(item.path));
        if (existsSync(abs)) item.bytes = statSync(abs).size;
      }
    }

    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = lesson.downloads.length;
    lesson.resourceCounts.h5p = lesson.downloads.filter((item) => item.type === "h5p").length;
  }
}

for (const unit of manifest.units || []) {
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  unit.summary.h5p = (unit.lessons || []).reduce(
    (sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length,
    0,
  );
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.handsOnH5pManifestNormalization = {
  normalizedAt: new Date().toISOString(),
  moved: moved.length,
  rule: "WordPress H5P embeds owned by Hands On book sections are local H5P packages in lesson.downloads with role=handsOn, so the lesson flow shows a standalone playable card while the book-section HTML keeps the embedded player.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify({ course, moved: moved.length, moved }, null, 2));
