import { existsSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "HFC3M");
const manifestPath = join(courseRoot, "course-manifest.json");

const obsoletePlaceholderFiles = [
  "aaea0ad083-Video-placeholder---Safety-Tips-for-Handling-and-Preparing-Common-Food.html",
  "c44e34a1ad-Video-placeholder---Basic-Food-Safety-Chapter-2-Health-and-Hygiene.html",
  "960fec340c-Video-placeholder---Basic-Food-Safety-Chapter-5-Cleaning-and-Sanitizing.html",
  "3032a0db1f-Video-placeholder---The-Geography-of-Spices-and-Herbs.html",
  "c70b2d4d5b-Video-placeholder---The-Geography-of-Spices-and-Herbs-Ali-copy.html",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function fileCount(items, extension) {
  return items.filter((item) => item.type === extension || item.path?.toLowerCase().endsWith(`.${extension}`)).length;
}

function updateSummaries(manifest) {
  for (const unit of manifest.units || []) {
    const downloads = (unit.lessons || []).flatMap((activity) => activity.downloads || []);
    unit.summary = {
      downloads: downloads.length,
      ispring: 0,
      docx: fileCount(downloads, "docx") + fileCount(downloads, "doc"),
      pdf: fileCount(downloads, "pdf"),
      video: downloads.filter((item) => item.role === "video" || item.role === "video_placeholder" || item.type === "mp4").length,
      h5p: downloads.filter((item) => item.type === "h5p").length,
    };
    for (const activity of unit.lessons || []) {
      activity.resourceCounts = activity.resourceCounts || {};
      activity.resourceCounts.downloads = (activity.downloads || []).length;
      activity.resourceCounts.video = (activity.downloads || []).filter((item) => item.role === "video" || item.type === "mp4").length;
      activity.resourceCounts.videoPlaceholders = (activity.downloads || []).filter((item) => item.role === "video_placeholder").length;
      activity.resourceCounts.moodleActivities = (activity.downloads || []).filter((item) => /^moodle_/i.test(item.category || "")).length;
    }
  }
}

const manifest = readJson(manifestPath);
let manifestRemoved = 0;

for (const unit of manifest.units || []) {
  for (const activity of unit.lessons || []) {
    if (activity.id !== "U02L05") continue;
    const before = activity.downloads?.length || 0;
    activity.downloads = (activity.downloads || []).filter((item) => item.role !== "video_placeholder");
    manifestRemoved += before - activity.downloads.length;
  }
}

let filesRemoved = 0;
for (const filename of obsoletePlaceholderFiles) {
  const path = join(courseRoot, "localized-moodle-activities", "video-placeholder", filename);
  if (existsSync(path)) {
    unlinkSync(path);
    filesRemoved += 1;
  }
}

if (manifestRemoved) {
  manifest.generatedAt = new Date().toISOString();
  updateSummaries(manifest);
  writeJson(manifestPath, manifest);
}

console.log(JSON.stringify({ manifestRemoved, filesRemoved }, null, 2));
