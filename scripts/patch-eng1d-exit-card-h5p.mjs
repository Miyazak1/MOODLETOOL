import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG1D";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");
const sectionDir = join(projectRoot, "inbox", "eng1d-stmary-sections");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const manifest = readJson(manifestPath);
let added = 0;

for (const sectionNo of [2, 3, 4, 5]) {
  const sectionPath = join(sectionDir, `section-${String(sectionNo).padStart(2, "0")}.json`);
  if (!existsSync(sectionPath)) continue;
  const section = readJson(sectionPath);
  for (const link of section.modLinks || []) {
    if (!/\/mod\/h5pactivity\/view\.php/i.test(link.href || "")) continue;
    const text = String(link.text || "");
    const unitNo = Number(/Unit\s+(\d+)/i.exec(text)?.[1] || 0);
    const lessonNo = Number(/Lesson\s+(\d+)/i.exec(text)?.[1] || 0);
    const id = new URL(link.href).searchParams.get("id") || "";
    if (!unitNo || !lessonNo || !id) continue;
    const unit = (manifest.units || []).find((item) => Number(item.unit) === unitNo);
    const lesson = (unit?.lessons || []).find((item) => Number(item.lesson) === lessonNo);
    if (!lesson) continue;
    lesson.downloads ||= [];
    if (lesson.downloads.some((item) => String(item.moodleActivityId || "") === id)) continue;
    lesson.downloads.push({
      label: /Exit Card/i.test(text) ? text : `${text} Exit Card`,
      type: "h5p",
      category: "moodle_h5pactivity",
      role: "exit_card",
      source: link.href,
      moodleActivityId: id,
      mod: "h5pactivity",
      textPreview: text,
    });
    added += 1;
  }
}

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = lesson.downloads?.length || 0;
    lesson.resourceCounts.h5p = (lesson.downloads || []).filter((item) => item.category === "moodle_h5pactivity").length;
  }
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  unit.summary.h5p = (unit.lessons || []).reduce(
    (sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.category === "moodle_h5pactivity").length,
    0,
  );
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.h5pActivityExpected = (manifest.units || []).reduce(
  (sum, unit) => sum + (unit.lessons || []).reduce(
    (lessonSum, lesson) => lessonSum + (lesson.downloads || []).filter((item) => item.category === "moodle_h5pactivity").length,
    0,
  ),
  0,
);
manifest.sourceAudit.exitCardsPatchedFromStMarySections = true;
manifest.generatedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ course, added, h5pActivityExpected: manifest.sourceAudit.h5pActivityExpected }, null, 2));
