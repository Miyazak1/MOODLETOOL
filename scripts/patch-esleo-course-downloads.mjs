import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "ESLEO", "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const moodle = (mod, id, label, role) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role,
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle course page",
});

const manifest = readJson(manifestPath);
const additions = [
  moodle("assign", 7888, "ESLEO Course Outline", "course_outline"),
  moodle("assign", 7889, "Learning Log", "course_resource"),
];

const existing = new Map((manifest.courseDownloads || []).map((item) => [item.url || item.source || item.path || item.label, item]));
for (const item of additions) existing.set(item.url, { ...(existing.get(item.url) || {}), ...item });
manifest.courseDownloads = [...existing.values()];
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  courseLevelMoodleResourcesAddedAt: new Date().toISOString(),
};

writeJson(manifestPath, manifest);
console.log(`ESLEO: courseDownloads ${manifest.courseDownloads.length}`);
