import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = resolve(process.env.COURSE_ROOT || join(workspaceRoot, "courseware", "ENG3U"));
const manifestPath = join(courseRoot, "course-manifest.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const removed = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const textExports = Array.isArray(lesson.textExports) ? lesson.textExports : [];
    if (!textExports.length) continue;
    removed.push({
      unit: unit.unit,
      lesson: lesson.id || lesson.title || "",
      count: textExports.length,
      paths: textExports.map((item) => item.path).filter(Boolean),
    });
    lesson.textExports = [];
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  eng3uRemovedLegacyTextExports: {
    patchedAt: new Date().toISOString(),
    removedCount: removed.reduce((sum, item) => sum + item.count, 0),
    lessons: removed.length,
    note: "Removed legacy complete_lesson textExports from the displayed manifest. The new course structure uses localized book section pages and local resource cards; old text exports exposed Moodle/pluginfile/iSpring source URLs as visible teacher notes.",
    sample: removed.slice(0, 5),
  },
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest.sourceAudit.eng3uRemovedLegacyTextExports, null, 2));
