import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = resolve(process.env.COURSE_ROOT || join(workspaceRoot, "courseware", "ENG3U"));
const manifestPath = join(courseRoot, "course-manifest.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const removed = [];
const removedLegacyUrlShortcuts = {};
const legacyUnitResourceKeys = [
  "assignmentAOL",
  "peerReviewForum",
  "assignment2AOL",
  "quizAOL",
  "kwlDropbox",
  "reflectionSummaryDropbox",
];

function isMoodleUrl(value) {
  return /^https?:\/\/(?:www\.)?esunnybrook\.com\//i.test(String(value || ""));
}

for (const unit of manifest.units || []) {
  if (Number(unit.unit) === 1 && unit.unitResources) {
    for (const key of legacyUnitResourceKeys) {
      if (isMoodleUrl(unit.unitResources[key])) {
        removedLegacyUrlShortcuts[key] = unit.unitResources[key];
        delete unit.unitResources[key];
      }
    }
  }

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
  eng3uRemovedUnit1LegacyUrlShortcuts: {
    patchedAt: new Date().toISOString(),
    removed: removedLegacyUrlShortcuts,
    note: "Removed legacy Unit 1 unitResources URL shortcut fields. Equivalent localized resource objects already exist under evaluations/reflectionAndLogs; Moodle URLs remain only in source fields.",
  },
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  textExports: manifest.sourceAudit.eng3uRemovedLegacyTextExports,
  legacyUrlShortcuts: manifest.sourceAudit.eng3uRemovedUnit1LegacyUrlShortcuts,
}, null, 2));
