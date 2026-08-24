import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = resolve(workspaceRoot, "courseware", "MHF4U", "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isHandsOnQuizLike(item) {
  return (
    item &&
    item.role === "hands_on" &&
    item.category === "localized_external_h5p" &&
    /Hands On Activity/i.test(item.label || "")
  );
}

function keyFor(item) {
  return item.source || item.originalSource || item.path || item.label;
}

function addUnique(items, item) {
  const key = keyFor(item);
  const index = items.findIndex((existing) => keyFor(existing) === key);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

function toHandsOnAuditRecord(item, unitNo, lessonNo, lessonTitle) {
  const source = item.source || item.originalSource || "";
  return {
    label: "Hands On - H5P Activity",
    type: "external",
    category: "external_interactive",
    role: "external_interactive",
    mode: "local_embed",
    source: "external_interactive",
    url: source,
    previewUrl: source,
    originalSource: item.originalSource || source,
    parentSection: "Hands On",
    sourceGroup: "book_section_embed",
    unit: unitNo,
    lesson: lessonNo,
    textPreview: `Hands On - ${lessonTitle || `Unit ${unitNo} Lesson ${lessonNo}`}`,
    localizedPackagePath: item.path,
    localizedPreviewPath: item.previewPath,
  };
}

const manifest = readJson(manifestPath);
const moved = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const downloads = lesson.downloads || [];
    const existingHandsOnPackages = (lesson.handsOn || []).filter(isHandsOnQuizLike);
    const handsOnDownloads = downloads.filter(isHandsOnQuizLike);
    const handsOnPackages = [...existingHandsOnPackages, ...handsOnDownloads];
    if (!handsOnPackages.length) continue;

    lesson.handsOn ||= [];
    lesson.handsOn = lesson.handsOn.filter((item) => !isHandsOnQuizLike(item));
    for (const item of handsOnPackages) {
      addUnique(lesson.handsOn, toHandsOnAuditRecord(item, unit.unit, lesson.lesson, lesson.title));
      moved.push({
        unit: unit.unit,
        lesson: lesson.lesson,
        label: item.label,
        path: item.path,
      });
    }
    lesson.downloads = downloads.filter((item) => !isHandsOnQuizLike(item));
    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = lesson.downloads.length;
    lesson.resourceCounts.handsOn = lesson.handsOn.length;
    lesson.resourceCounts.h5p = [
      ...(lesson.downloads || []),
      ...(lesson.handsOn || []),
    ].filter((item) => item.type === "h5p" || item.localizedPackagePath).length;
  }
}

for (const unit of manifest.units || []) {
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  unit.summary.h5p = (unit.lessons || []).reduce(
    (sum, lesson) => sum + [...(lesson.downloads || []), ...(lesson.handsOn || [])].filter((item) => item.type === "h5p" || item.localizedPackagePath).length,
    0,
  );
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.mhf4uHandsOnQuizShape = {
  patchedAt: new Date().toISOString(),
  reference: "MDM4U stores quiz-like Hands On interactives in lesson.handsOn and keeps the Hands On book section as the visible teaching page.",
  moved,
  note: "MHF4U Hexstruct H5P Hands On activities remain embedded in their Hands On book-section HTML and are registered in lesson.handsOn instead of being extra peer download cards. Consolidation H5P/Exit Slip resources are unchanged.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course: "MHF4U", moved: moved.length, moved }, null, 2));
