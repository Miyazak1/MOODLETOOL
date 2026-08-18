import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MCR3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function walkFiles(dir, matcher, output = []) {
  if (!existsSync(dir)) return output;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, matcher, output);
    else if (matcher(abs)) output.push(abs);
  }
  return output;
}

function stripDownloadFields(item) {
  if (!item || typeof item !== "object") return false;
  let changed = false;
  for (const key of ["downloadPath", "downloadUrl", "downloadBytes"]) {
    if (key in item) {
      delete item[key];
      changed = true;
    }
  }
  return changed;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let stripped = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.ispring || []) {
      if (stripDownloadFields(item)) stripped += 1;
    }
    for (const item of lesson.downloads || []) {
      const type = String(item.type || "").toLowerCase();
      const path = String(item.path || "").toLowerCase();
      if (type === "mp4" || type === "webm" || type === "mov" || type === "m4v" || /\.(mp4|webm|mov|m4v)$/i.test(path)) {
        if (stripDownloadFields(item)) stripped += 1;
      }
    }
  }
}

const zipFiles = walkFiles(join(courseRoot, "ispring-localized"), (abs) => /\.zip$/i.test(abs));
const zipBytes = zipFiles.reduce((sum, abs) => sum + statSync(abs).size, 0);
for (const abs of zipFiles) {
  const rel = toPosix(abs.slice(courseRoot.length + 1));
  if (!rel.startsWith("ispring-localized/")) throw new Error(`Refusing to delete unexpected zip path: ${rel}`);
  rmSync(abs);
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  ispringDownloadPackages: 0,
  ispringPlayable: (manifest.units || []).reduce(
    (sum, unit) => sum + (unit.lessons || []).reduce((lessonSum, lesson) => lessonSum + (lesson.ispring?.length || 0), 0),
    0,
  ),
  playableMediaRuleUpdatedAt: new Date().toISOString(),
  playableMediaRule: "iSpring and video resources are playable/shareable only; no downloadPath/downloadUrl is exposed. iSpring source zip files were removed to avoid duplicate package weight.",
  removedISpringZipCount: zipFiles.length,
  removedISpringZipBytes: zipBytes,
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course,
  strippedDownloadFields: stripped,
  removedISpringZipCount: zipFiles.length,
  removedISpringZipBytes: zipBytes,
}, null, 2));
