import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SBI4U";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");
const sectionPath = join(projectRoot, "inbox", "sbi4u-stmary-sections", "section-08.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const section = JSON.parse(readFileSync(sectionPath, "utf8"));

let added = 0;
for (const link of section.modLinks || []) {
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
    label: text,
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

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = lesson.downloads?.length || 0;
    lesson.resourceCounts.h5p = (lesson.downloads || []).filter((item) => item.category === "moodle_h5pactivity").length;
  }
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  unit.summary.h5p = (unit.lessons || []).reduce((sum, lesson) => sum + ((lesson.downloads || []).filter((item) => item.category === "moodle_h5pactivity").length), 0);
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.h5pActivityExpected = (manifest.units || []).reduce(
  (sum, unit) => sum + (unit.lessons || []).reduce((lessonSum, lesson) => lessonSum + ((lesson.downloads || []).filter((item) => item.category === "moodle_h5pactivity").length), 0),
  0,
);
manifest.sourceAudit.exitCardsPatchedFromSection8 = true;

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ course, added, h5pActivityExpected: manifest.sourceAudit.h5pActivityExpected }, null, 2));
