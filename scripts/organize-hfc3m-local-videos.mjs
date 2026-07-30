import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "HFC3M");
const manifestPath = join(courseRoot, "course-manifest.json");

const videos = [
  {
    activityId: "U01L01",
    file: "Safety Tips for Handling and Preparing Common Food.mp4",
    from: "localized-moodle-activities/video-placeholder/Safety Tips for Handling and Preparing Common Food.mp4",
    to: "localized-moodle/video/U01L01/Safety Tips for Handling and Preparing Common Food.mp4",
    oldSrc: "../../video-placeholder/Safety Tips for Handling and Preparing Common Food.mp4",
    newSrc: "../../../localized-moodle/video/U01L01/Safety Tips for Handling and Preparing Common Food.mp4",
  },
  {
    activityId: "U01L01",
    file: "Basic Food Safety Chapter 2 Health and Hygiene .mp4",
    from: "localized-moodle-activities/video-placeholder/Basic Food Safety Chapter 2 Health and Hygiene .mp4",
    to: "localized-moodle/video/U01L01/Basic Food Safety Chapter 2 Health and Hygiene .mp4",
    oldSrc: "../../video-placeholder/Basic Food Safety Chapter 2 Health and Hygiene .mp4",
    newSrc: "../../../localized-moodle/video/U01L01/Basic Food Safety Chapter 2 Health and Hygiene .mp4",
  },
  {
    activityId: "U01L01",
    file: "Basic Food Safety Chapter 5 Cleaning and Sanitizing.mp4",
    from: "localized-moodle-activities/video-placeholder/Basic Food Safety Chapter 5 Cleaning and Sanitizing.mp4",
    to: "localized-moodle/video/U01L01/Basic Food Safety Chapter 5 Cleaning and Sanitizing.mp4",
    oldSrc: "../../video-placeholder/Basic Food Safety Chapter 5 Cleaning and Sanitizing.mp4",
    newSrc: "../../../localized-moodle/video/U01L01/Basic Food Safety Chapter 5 Cleaning and Sanitizing.mp4",
  },
  {
    activityId: "U02L02",
    file: "Food Trip Around the world.webm",
    from: "localized-moodle-activities/video-placeholder/Food Trip Around the world.webm",
    to: "localized-moodle/video/U02L02/Food Trip Around the world.webm",
    oldSrc: "../../video-placeholder/Food Trip Around the world.webm",
    newSrc: "../../../localized-moodle/video/U02L02/Food Trip Around the world.webm",
  },
  {
    activityId: "U02L02",
    file: "World food.mp4",
    from: "localized-moodle-activities/video-placeholder/World food.mp4",
    to: "localized-moodle/video/U02L02/World food.mp4",
    oldSrc: "../../video-placeholder/World food.mp4",
    newSrc: "../../../localized-moodle/video/U02L02/World food.mp4",
  },
];

const activityHtmlPaths = [
  join(courseRoot, "localized-moodle-activities", "assign", "U01L01-5650-03941de0bd", "index.html"),
  join(courseRoot, "localized-moodle-activities", "assign", "U02L02-5662-7920ed5e18", "index.html"),
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}\\`) &&
    !resolvedCandidate.startsWith(`${resolvedRoot}/`)
  ) {
    throw new Error(`Path escaped course root: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function moveVideo(video) {
  const from = ensureInside(courseRoot, join(courseRoot, video.from));
  const to = ensureInside(courseRoot, join(courseRoot, video.to));
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) return { file: video.file, status: "already-organized", path: video.to };
  if (!existsSync(from)) throw new Error(`Missing local video: ${video.from}`);
  renameSync(from, to);
  return { file: video.file, status: "moved", path: video.to };
}

function updateActivityCounts(activity) {
  activity.resourceCounts = activity.resourceCounts || {};
  activity.resourceCounts.downloads = (activity.downloads || []).length;
  activity.resourceCounts.video = (activity.downloads || []).filter((item) => item.role === "video" || ["mp4", "webm", "video"].includes(item.type)).length;
  activity.resourceCounts.videoPlaceholders = (activity.downloads || []).filter((item) => item.role === "video_placeholder").length;
  activity.resourceCounts.moodleActivities = (activity.downloads || []).filter((item) => /^moodle_/i.test(item.category || "")).length;
}

function updateSummaries(manifest) {
  for (const unit of manifest.units || []) {
    for (const activity of unit.lessons || []) updateActivityCounts(activity);
    const downloads = (unit.lessons || []).flatMap((activity) => activity.downloads || []);
    unit.summary = {
      downloads: downloads.length,
      ispring: 0,
      docx: downloads.filter((item) => ["docx", "doc"].includes(item.type) || /\.(docx|doc)$/i.test(item.path || "")).length,
      pdf: downloads.filter((item) => item.type === "pdf" || /\.pdf$/i.test(item.path || "")).length,
      video: downloads.filter((item) => item.role === "video" || item.role === "video_placeholder" || ["mp4", "webm", "video"].includes(item.type)).length,
      h5p: downloads.filter((item) => item.type === "h5p").length,
    };
  }
}

function patchManifest() {
  const manifest = readJson(manifestPath);
  const byOldPath = new Map(videos.map((video) => [video.from, video]));
  let updated = 0;
  for (const unit of manifest.units || []) {
    for (const activity of unit.lessons || []) {
      for (const item of activity.downloads || []) {
        const video = byOldPath.get(item.path);
        if (!video) continue;
        item.path = video.to;
        item.bytes = statSync(join(courseRoot, video.to)).size;
        updated += 1;
      }
    }
  }
  manifest.generatedAt = new Date().toISOString();
  updateSummaries(manifest);
  writeJson(manifestPath, manifest);
  return updated;
}

function patchHtmlFiles() {
  let patched = 0;
  for (const htmlPath of activityHtmlPaths) {
    let html = readFileSync(htmlPath, "utf8");
    let next = html;
    for (const video of videos) {
      next = next.replaceAll(video.oldSrc, video.newSrc);
    }
    if (next !== html) {
      writeFileSync(htmlPath, next, "utf8");
      patched += 1;
    }
  }
  return patched;
}

const moves = videos.map(moveVideo);
const manifestUpdated = patchManifest();
const htmlFilesPatched = patchHtmlFiles();

console.log(JSON.stringify({ moves, manifestUpdated, htmlFilesPatched }, null, 2));
