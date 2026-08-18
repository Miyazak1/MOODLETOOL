import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "CHC2D", "course-manifest.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const footerDuplicateIds = new Set(["4256", "4257", "4258", "4259", "4260", "4261", "4262"]);
let removed = 0;
for (const unit of manifest.units || []) {
  const before = unit.lessons?.length || 0;
  unit.lessons = (unit.lessons || []).filter((lesson) => {
    const ids = (lesson.downloads || []).map((item) => item.moodleActivityId).filter(Boolean);
    return !ids.some((id) => footerDuplicateIds.has(id));
  });
  removed += before - unit.lessons.length;
}
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  lessonCount: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
  footerDuplicateActivitiesRemoved: removed,
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ removed, lessonCount: manifest.sourceAudit.lessonCount }, null, 2));
