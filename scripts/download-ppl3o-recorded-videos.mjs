import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "PPL3O";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const videoRoot = join(courseRoot, "videos", "recorded-classes");

function slugify(value) {
  return String(value || "video").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function download(url, path) {
  const response = await fetch(url, { headers: { "user-agent": "ossd-course-portal-video-localizer/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/video|octet-stream/i.test(contentType)) throw new Error(`unexpected content-type ${contentType}`);
  mkdirSync(dirname(path), { recursive: true });
  await pipeline(response.body, createWriteStream(path));
}

const manifest = readJson(manifestPath);
mkdirSync(videoRoot, { recursive: true });
const added = [];
const failed = [];

for (const item of manifest.courseDownloads || []) {
  if (!item.externalUrl || !/\.mp4(?:$|[?#])/i.test(item.externalUrl)) continue;
  const filename = `${slugify(item.label)}.mp4`;
  const abs = join(videoRoot, filename);
  const rel = `videos/recorded-classes/${filename}`;
  try {
    if (!existsSync(abs)) await download(item.externalUrl, abs);
    const videoItem = {
      label: `${item.label} - Local MP4`,
      type: "mp4",
      category: "recorded_class_video",
      role: "video",
      path: rel,
      bytes: statSync(abs).size,
      source: item.externalUrl,
    };
    manifest.courseDownloads = (manifest.courseDownloads || []).filter((entry) => entry.path !== rel);
    manifest.courseDownloads.push(videoItem);
    item.localizedVideoPath = rel;
    item.localizedVideoBytes = videoItem.bytes;
    added.push(videoItem);
  } catch (error) {
    failed.push({ label: item.label, url: item.externalUrl, error: error.message });
  }
}

manifest.sourceAudit = {
  ...manifest.sourceAudit,
  localizedRecordedVideos: added.length,
  recordedVideoLocalizationFailures: failed,
};
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course, added, failed }, null, 2));
