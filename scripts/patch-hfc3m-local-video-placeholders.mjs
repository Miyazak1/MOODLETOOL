import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "HFC3M");
const manifestPath = join(courseRoot, "course-manifest.json");
const activityHtmlPath = join(
  courseRoot,
  "localized-moodle-activities",
  "assign",
  "U01L01-5650-03941de0bd",
  "index.html",
);

const videos = [
  {
    label: "Safety Tips for Handling and Preparing Common Food.mp4",
    title: "Safety Tips for Handling and Preparing Common Food",
    file: "Safety Tips for Handling and Preparing Common Food.mp4",
    originalSource:
      "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/5.%20%28Ali%29%20Safety%20Tips%20for%20Handling%20and%20Preparing%20Common%20Food.mp4",
  },
  {
    label: "Basic Food Safety Chapter 2 Health and Hygiene.mp4",
    title: "Basic Food Safety Chapter 2 Health and Hygiene",
    file: "Basic Food Safety Chapter 2 Health and Hygiene .mp4",
    originalSource:
      "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/6.%20%28Ali%29%20Basic%20Food%20Safety%20Chapter%202%20Health%20and%20Hygiene%20%28English%29.mp4",
  },
  {
    label: "Basic Food Safety Chapter 5 Cleaning and Sanitizing.mp4",
    title: "Basic Food Safety Chapter 5 Cleaning and Sanitizing",
    file: "Basic Food Safety Chapter 5 Cleaning and Sanitizing.mp4",
    originalSource:
      "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/7.%20%28Ali%29%20Basic%20Food%20Safety%20Chapter%205%20Cleaning%20and%20Sanitizing%20%28English%29.mp4",
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function videoRelPath(video) {
  return `localized-moodle-activities/video-placeholder/${video.file}`;
}

function videoAbsPath(video) {
  return join(courseRoot, "localized-moodle-activities", "video-placeholder", video.file);
}

function pageVideoSrc(video) {
  return `../../video-placeholder/${video.file.replaceAll("#", "%23")}`;
}

function renderVideoFigure(video) {
  return `<figure class="local-video" data-hfc3m-local-video="${htmlEscape(video.file, true)}">
          <video controls preload="metadata" src="${htmlEscape(pageVideoSrc(video), true)}"></video>
          <figcaption>${htmlEscape(video.title)}</figcaption>
        </figure>`;
}

function ensureVideoStyles(html) {
  if (/\.local-video\b/.test(html)) return html;
  const css = `    .local-video { width: min(100%, 820px); margin: 18px 0 24px; }
    .local-video video { display: block; width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: 6px; background: #111827; }
    .local-video figcaption { color: var(--muted); font-size: 13px; margin-top: 8px; }
`;
  return html.replace(/(\s*\.video-placeholder p \{[^\n]*\}\r?\n)/, `$1${css}`);
}

function patchActivityHtml() {
  let html = readFileSync(activityHtmlPath, "utf8");
  html = ensureVideoStyles(html);
  const content = `      <div class="moodle-content">
        <p>Ali link</p>
        <section class="local-video-list" aria-label="Food safety videos">
          ${videos.map(renderVideoFigure).join("\n          ")}
        </section>
      </div>`;
  const next = html.replace(/      <div class="moodle-content">[\s\S]*?\n      <section class="attachments"/, `${content}\n      <section class="attachments"`);
  if (next !== html) {
    writeFileSync(activityHtmlPath, next, "utf8");
    return true;
  }
  return false;
}

function isU01L01Placeholder(item) {
  return item.role === "video_placeholder" && videos.some((video) => item.source === video.originalSource);
}

function makeManifestResource(video) {
  const abs = videoAbsPath(video);
  return {
    label: video.label,
    type: "mp4",
    category: "local_video",
    role: "video",
    path: videoRelPath(video),
    bytes: statSync(abs).size,
    source: video.originalSource,
    sourceStatus: "localized_from_teacher_upload",
    notes: "Local MP4 supplied for the original Moodle video position.",
  };
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
const unit = (manifest.units || []).find((item) => item.unit === 1);
const activity = unit?.lessons?.find((item) => item.id === "U01L01");
if (!activity) throw new Error("Unable to find HFC3M U01L01 in course manifest.");

const replacements = videos.map(makeManifestResource);
const keptDownloads = (activity.downloads || []).filter((item) => !isU01L01Placeholder(item));
const byPath = new Map(keptDownloads.map((item) => [item.path, item]));
for (const resource of replacements) byPath.set(resource.path, resource);
activity.downloads = [...byPath.values()];

const htmlPatched = patchActivityHtml();
const mainHtml = activity.downloads.find((item) => item.path?.endsWith("/index.html"));
if (mainHtml) mainHtml.bytes = statSync(activityHtmlPath).size;

manifest.generatedAt = new Date().toISOString();
updateSummaries(manifest);
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ htmlPatched, videos: replacements.length }, null, 2));
