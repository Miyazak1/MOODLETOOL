import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ENG3U");
const manifestPath = join(courseRoot, "course-manifest.json");

const dryRun = process.argv.includes("--dry-run");
const deleteIspringZips = process.argv.includes("--delete-ispring-zips");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  if (!dryRun) writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function isVideoResource(item) {
  const text = `${item?.type || ""} ${item?.category || ""} ${item?.role || ""} ${item?.path || ""} ${item?.url || ""} ${item?.downloadPath || ""} ${item?.downloadUrl || ""}`.toLowerCase();
  return /\b(video|mp4|webm|mov|m4v)\b/.test(text) || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(text);
}

function isIspringResource(item, path = []) {
  const text = `${item?.type || ""} ${item?.category || ""} ${item?.path || ""} ${item?.packagePath || ""} ${item?.downloadPath || ""}`.toLowerCase();
  return path.includes("ispring") || text.includes("ispring") || text.includes("html5-package");
}

function stripMediaDownloads(value, path = [], removals = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => stripMediaDownloads(item, [...path, index], removals));
    return removals;
  }
  if (!value || typeof value !== "object") return removals;

  if (isIspringResource(value, path) || isVideoResource(value)) {
    for (const key of ["downloadPath", "downloadUrl"]) {
      if (!value[key]) continue;
      removals.push({
        jsonPath: path.join("."),
        key,
        label: value.label || value.title || "",
        value: value[key],
      });
      if (!dryRun) delete value[key];
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") stripMediaDownloads(child, [...path, key], removals);
  }
  return removals;
}

function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function existingMoodleIds(manifest) {
  const ids = new Set();
  const add = (value) => {
    const match = String(value || "").match(/\/mod\/[^/]+\/view\.php\?id=(\d+)/i);
    if (match) ids.add(match[1]);
  };
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    add(value.source);
    add(value.url);
    add(value.previewUrl);
    add(value.downloadUrl);
    if (value.moodleActivityId) ids.add(String(value.moodleActivityId));
    for (const child of Object.values(value)) walk(child);
  };
  walk(manifest);
  return ids;
}

function makeActivity(label, mod, id, role) {
  return {
    label,
    type: mod === "h5pactivity" ? "h5p" : "html",
    category: `moodle_${mod}`,
    role,
    url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    source: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    moodleActivityId: id,
  };
}

function findUnit(manifest, unitNumber) {
  return (manifest.units || []).find((unit) => Number(unit.unit) === Number(unitNumber));
}

function findLesson(unit, lessonNumber) {
  return (unit.lessons || [])[Number(lessonNumber) - 1];
}

function pushUnique(array, item, idSet) {
  if (idSet.has(String(item.moodleActivityId))) return false;
  array.push(item);
  idSet.add(String(item.moodleActivityId));
  return true;
}

function addMissingActivityEntries(manifest) {
  const idSet = existingMoodleIds(manifest);
  const additions = [];

  const lessonAssignIds = [
    [1, 1, "9251"], [1, 2, "9252"], [1, 3, "9254"], [1, 4, "9256"], [1, 5, "9258"], [1, 6, "9260"], [1, 7, "9262"],
    [2, 1, "9273"], [2, 2, "9275"], [2, 3, "9277"], [2, 4, "9279"], [2, 5, "9281"], [2, 6, "9283"], [2, 7, "9285"], [2, 8, "9287"],
    [3, 1, "9298"], [3, 2, "9300"], [3, 3, "9302"], [3, 4, "9304"], [3, 5, "9306"], [3, 6, "9308"], [3, 7, "9309"], [3, 8, "9312"],
    [4, 1, "9323"], [4, 2, "9325"], [4, 3, "9327"], [4, 4, "9329"], [4, 5, "9331"], [4, 6, "9333"], [4, 7, "9335"],
    [5, 1, "9346"], [5, 2, "9347"], [5, 3, "9348"], [5, 4, "9349"], [5, 5, "9350"], [5, 6, "9351"],
  ];

  for (const [unitNumber, lessonNumber, id] of lessonAssignIds) {
    const unit = findUnit(manifest, unitNumber);
    const lesson = unit && findLesson(unit, lessonNumber);
    if (!lesson) continue;
    const item = makeActivity(`Unit ${unitNumber} - Lesson ${lessonNumber}`, "assign", id, "lesson_submission_activity");
    if (pushUnique(lesson.downloads || (lesson.downloads = []), item, idSet)) additions.push({ scope: "lesson.downloads", label: item.label, id });
  }

  const answerPageIds = [
    [1, 2, "9253", "Unit 1 - Lesson 2 (Answer)"], [1, 3, "9255", "Unit 1 - Lesson 3 (Answer)"], [1, 4, "9257", "Unit 1 - Lesson 4 (Answer)"], [1, 5, "9259", "Unit 1 - Lesson 5 (Answer)"], [1, 6, "9261", "Unit 1 - Lesson 6 (Answer)"], [1, 7, "9263", "Unit 1 - Lesson 7 (Answer)"],
    [2, 1, "9274", "Unit 2 - Lesson 1 (Answer)"], [2, 2, "9276", "Unit 2 - Lesson 2 (Answer)"], [2, 3, "9278", "Unit 2 - Lesson 3 (Answer)"], [2, 4, "9280", "Unit 2 - Lesson 4 (Answer)"], [2, 5, "9282", "Unit 2 - Lesson 5 (Answer)"], [2, 6, "9284", "Unit 2 - Lesson 6 (Answer)"], [2, 7, "9286", "Unit 2 - Lesson 7 (Answer)"], [2, 8, "9288", "Unit 2 - Lesson 8 (Answer)"],
    [3, 1, "9299", "Unit 3 - Lesson 1 (Answer)"], [3, 2, "9301", "Unit 3 - Lesson 2 (Answer)"], [3, 3, "9303", "Unit 3 - Lesson 3 (Answer)"], [3, 4, "9305", "Unit 3 - Lesson 4 (Answer)"], [3, 5, "9307", "Unit 3 - Lesson 5 (Answers)"], [3, 7, "9310", "Unit 3 - Lesson 7 (Answers)"], [3, 8, "9313", "Unit 3 - Lesson 8 (Answers)"],
    [4, 1, "9324", "Unit 4 - Lesson 1 (Answer)"], [4, 2, "9326", "Unit 4 - Lesson 2 (Answer)"], [4, 3, "9328", "Unit 4 - Lesson 3 (Answer)"], [4, 4, "9330", "Unit 4 - Lesson 4 (Answer)"], [4, 5, "9332", "Unit 4 - Lesson 5 (Answer)"], [4, 6, "9334", "Unit 4 - Lesson 6 (Answer)"], [4, 7, "9336", "Unit 4 - Lesson 7 (Answer)"],
  ];

  for (const [unitNumber, lessonNumber, id, label] of answerPageIds) {
    const item = makeActivity(label, "page", id, "lesson_answer_key");
    item.unit = unitNumber;
    item.lesson = lessonNumber;
    if (pushUnique(manifest.teacherResources || (manifest.teacherResources = []), item, idSet)) additions.push({ scope: "teacherResources", label, id });
  }

  const unit3 = findUnit(manifest, 3);
  if (unit3) {
    const discussions = unit3.unitResources.discussions || (unit3.unitResources.discussions = []);
    const item = makeActivity("Can you trust social media?", "forum", "9311", "discussion_forum");
    if (pushUnique(discussions, item, idSet)) additions.push({ scope: "unitResources.discussions", label: item.label, id: "9311" });
  }

  return additions;
}

const manifest = readJson(manifestPath);
const removals = stripMediaDownloads(manifest);
const additions = addMissingActivityEntries(manifest);

const zipFiles = listFiles(courseRoot).filter((file) => /html5-package(?:-\d{2}-[a-z-]+)?\.zip$/i.test(file));
const deletedZipFiles = [];
if (deleteIspringZips && !dryRun) {
  for (const file of zipFiles) {
    unlinkSync(file);
    deletedZipFiles.push(toPosix(file).replace(toPosix(courseRoot) + "/", ""));
  }
}

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  mediaDownloadPolicy: {
    patchedAt: new Date().toISOString(),
    policy: "ispring-and-video-stream-and-share-only",
    removedDownloadFields: removals.length,
    ispringZipFilesFound: zipFiles.length,
    ispringZipFilesDeleted: deletedZipFiles.length,
  },
  moodleActivityGapRepair: {
    patchedAt: new Date().toISOString(),
    addedActivityItems: additions.length,
    note: "Added Moodle lesson submission, answer page, and Unit 3 discussion activity entries that were visible in ENG3U course id 86 but missing from the displayed manifest. Exit Card H5P activities remain excluded by courseware policy.",
  },
};

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course: "ENG3U",
  dryRun,
  removedDownloadFields: removals.length,
  additions: additions.length,
  ispringZipFilesFound: zipFiles.length,
  ispringZipFilesDeleted: deletedZipFiles.length,
  sampleRemovals: removals.slice(0, 8),
  sampleAdditions: additions.slice(0, 12),
}, null, 2));
