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
  "U02L02-5662-7920ed5e18",
  "index.html",
);

const videos = [
  {
    label: "Food Trip Around the world.webm",
    title: "Food Trip Around the world",
    file: "Food Trip Around the world.webm",
    type: "webm",
    source: "https://www.youtube.com/watch?v=XINl8YvzxMc",
  },
  {
    label: "World food.mp4",
    title: "World food",
    file: "World food.mp4",
    type: "mp4",
    source: "https://www.youtube.com/watch?v=4uuGYHfnVRE",
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

function pageVideoSrc(video) {
  return `../../video-placeholder/${video.file}`;
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
  return html.replace(/(\s*iframe\s*\{[^\n]*\}\r?\n)/, `$1${css}`);
}

function patchHtml() {
  let html = readFileSync(activityHtmlPath, "utf8");
  html = ensureVideoStyles(html);
  const content = `      <div class="moodle-content">
        <p>Food Trip Around the world</p>
        <p>Source:</p>
        <section class="local-video-list" aria-label="Culture and food videos">
          ${videos.map(renderVideoFigure).join("\n          ")}
        </section>
      </div>`;
  const next = html.replace(/      <div class="moodle-content">[\s\S]*?\n      <div class="source"/, `${content}\n      <div class="source"`);
  if (next !== html) {
    writeFileSync(activityHtmlPath, next, "utf8");
    return true;
  }
  return false;
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
      video: downloads.filter((item) => item.role === "video" || item.role === "video_placeholder" || ["mp4", "webm", "video"].includes(item.type)).length,
      h5p: downloads.filter((item) => item.type === "h5p").length,
    };
    for (const activity of unit.lessons || []) {
      activity.resourceCounts = activity.resourceCounts || {};
      activity.resourceCounts.downloads = (activity.downloads || []).length;
      activity.resourceCounts.video = (activity.downloads || []).filter((item) => item.role === "video" || ["mp4", "webm", "video"].includes(item.type)).length;
      activity.resourceCounts.videoPlaceholders = (activity.downloads || []).filter((item) => item.role === "video_placeholder").length;
      activity.resourceCounts.moodleActivities = (activity.downloads || []).filter((item) => /^moodle_/i.test(item.category || "")).length;
    }
  }
}

const manifest = readJson(manifestPath);
const activity = manifest.units?.find((unit) => unit.unit === 2)?.lessons?.find((lesson) => lesson.id === "U02L02");
if (!activity) throw new Error("Unable to find HFC3M U02L02.");

const localResources = videos.map((video) => {
  const path = videoRelPath(video);
  return {
    label: video.label,
    type: video.type,
    category: "local_video",
    role: "video",
    path,
    bytes: statSync(join(courseRoot, path)).size,
    source: video.source,
    sourceStatus: "localized_from_teacher_upload",
    notes: "Local video supplied for the original Moodle video position.",
  };
});

activity.downloads = (activity.downloads || []).filter(
  (item) => item.category !== "external_video" && !localResources.some((video) => video.path === item.path),
);
activity.downloads.push(...localResources);

const htmlPatched = patchHtml();
const primary = activity.downloads.find((item) => item.path?.endsWith("/index.html"));
if (primary) primary.bytes = statSync(activityHtmlPath).size;

manifest.generatedAt = new Date().toISOString();
updateSummaries(manifest);
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ htmlPatched, videos: localResources.length }, null, 2));
