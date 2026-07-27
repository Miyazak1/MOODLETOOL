import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = join(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const course = readArg("--course")?.toUpperCase();

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function parseActivity(url) {
  const match = String(url || "").match(/\/mod\/([^/]+)\/view\.php\?id=(\d+)/i);
  return match ? { mod: match[1].toLowerCase(), id: match[2] } : null;
}

function parseDirectMoodleFile(url) {
  return /\/pluginfile\.php\//i.test(String(url || "")) ? { mod: "file", id: hashText(url) } : null;
}

function parseMoodleSource(url) {
  return parseActivity(url) || parseDirectMoodleFile(url);
}

function localBaseRel(activity, owner) {
  const lessonPart = owner.lesson?.id ? `${owner.lesson.id}-` : "course-";
  return `localized-moodle-activities/${activity.mod}/${lessonPart}${activity.id}-${hashText(owner.item.url)}`;
}

function collectManifestItems(manifest) {
  const items = [];
  for (const item of manifest.courseDownloads || []) items.push({ scope: "courseDownloads", item });
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) items.push({ scope: "lesson", unit, lesson, item });
    }
  }
  return items.filter(({ item }) => item?.url && !item.path && parseMoodleSource(item.url));
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function fileType(path) {
  return extname(path).replace(".", "").toLowerCase() || "file";
}

if (!course) {
  console.error("Usage: node scripts/patch-moodle-activity-localization-from-disk.mjs --course COURSE");
  process.exit(1);
}

const courseRoot = join(coursewareRoot, course);
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = readJson(manifestPath);
const patched = [];

for (const owner of collectManifestItems(manifest)) {
  const activity = parseMoodleSource(owner.item.url);
  const baseRel = localBaseRel(activity, owner);
  const baseAbs = join(courseRoot, baseRel);
  if (!existsSync(baseAbs)) continue;

  const indexAbs = join(baseAbs, "index.html");
  let targetAbs = "";
  if (existsSync(indexAbs)) {
    targetAbs = indexAbs;
  } else {
    targetAbs = listFiles(baseAbs).find((path) => !path.includes("\\files\\")) || "";
  }
  if (!targetAbs || !existsSync(targetAbs)) continue;

  const rel = toPosix(relative(courseRoot, targetAbs));
  owner.item.path = rel;
  owner.item.type = fileType(targetAbs);
  owner.item.bytes = statSync(targetAbs).size;
  owner.item.source = owner.item.source || owner.item.url;
  delete owner.item.url;

  const filesDir = join(baseAbs, "files");
  const attachments = listFiles(filesDir).map((file) => ({
    label: file.split(/[\\/]/).pop(),
    type: fileType(file),
    path: toPosix(relative(courseRoot, file)),
    bytes: statSync(file).size,
  }));
  if (attachments.length) owner.item.attachments = attachments;
  patched.push({ label: owner.item.label, path: rel, attachments: attachments.length });
}

manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);
console.log(JSON.stringify({ course, patched: patched.length, samples: patched.slice(0, 12) }, null, 2));
