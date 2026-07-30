import { basename } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "HFC3M", "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function stripHashPrefix(filename) {
  return filename.replace(/^[a-f0-9]{10}-/i, "");
}

const manifest = readJson(manifestPath);
let updated = 0;

for (const unit of manifest.units || []) {
  for (const activity of unit.lessons || []) {
    for (const resource of activity.downloads || []) {
      const source = String(resource.source || "");
      if (resource.category !== "moodle_resource" || !source.includes("/mod/resource/view.php") || !resource.path) continue;
      const filename = stripHashPrefix(basename(resource.path));
      if (filename && resource.label !== filename) {
        resource.activityLabel = resource.activityLabel || resource.label;
        resource.label = filename;
        updated += 1;
      }
    }
  }
}

if (updated) {
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

console.log(JSON.stringify({ updated }, null, 2));
