import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "HFC3M");
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function isThemeAttachment(item) {
  const source = String(item?.source || "");
  const label = String(item?.label || "");
  return /\/pluginfile\.php\/\d+\/theme_[^/]+\//i.test(source) || /20260514205240_755_110\.png/i.test(label);
}

function safeDelete(relativePath) {
  if (!relativePath) return false;
  const absolute = resolve(courseRoot, relativePath);
  const allowedRoot = resolve(courseRoot, "localized-moodle-activities");
  if (!absolute.startsWith(allowedRoot)) {
    throw new Error(`Refusing to delete outside localized Moodle activities: ${absolute}`);
  }
  if (!existsSync(absolute)) return false;
  rmSync(absolute);
  return true;
}

const manifest = readJson(manifestPath);
let removedRecords = 0;
let removedFiles = 0;
let restoredSources = 0;

function cleanResource(item) {
  restoreMoodleSource(item);
  if (!Array.isArray(item?.attachments)) return;
  const keep = [];
  for (const attachment of item.attachments) {
    if (isThemeAttachment(attachment)) {
      removedRecords += 1;
      if (safeDelete(attachment.path)) removedFiles += 1;
    } else {
      keep.push(attachment);
    }
  }
  if (keep.length) item.attachments = keep;
  else delete item.attachments;
}

function restoreMoodleSource(item) {
  const match = String(item?.path || "").match(/localized-moodle-activities\/([^/]+)\/[^/]*-(\d+)-/i);
  if (!match) return;
  const [, mod, id] = match;
  if (!/^moodle_/i.test(String(item?.category || ""))) return;
  const sourceUrl = `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`;
  if (item.source === sourceUrl) return;
  item.source = sourceUrl;
  restoredSources += 1;
}

for (const item of manifest.courseDownloads || []) cleanResource(item);
for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.downloads || []) cleanResource(item);
  }
}

manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ removedRecords, removedFiles, restoredSources, lastRemovedBasename: removedFiles ? basename("20260514205240_755_110.png") : "" }, null, 2));
