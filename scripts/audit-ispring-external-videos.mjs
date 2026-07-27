import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const deploymentRoot = join(projectRoot, "deployment");
const courseArg = readArg("--course")?.toUpperCase() || "";
const patchManifest = process.argv.includes("--patch-manifest");

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

function walkFiles(root, matcher, result = []) {
  if (!existsSync(root)) return result;
  for (const entry of fsReaddir(root)) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, matcher, result);
    else if (matcher(full)) result.push(full);
  }
  return result;
}

function fsReaddir(path) {
  const { readdirSync } = globalThis.__fsModule || {};
  return readdirSync(path, { withFileTypes: true });
}

function collectLocalMediaFiles(packageRoot) {
  const mediaExt = /\.(mp4|webm|m4v|mov|mp3|wav|ogg|m4a)$/i;
  return walkFiles(packageRoot, (path) => mediaExt.test(path)).map((path) => toPosix(relative(packageRoot, path)));
}

function encodedKeys() {
  return {
    youtubeList: "yk",
    youkuList: "y",
    containerId: "c",
    videoId: "v",
    width: "w",
    height: "h",
    timeout: "to",
    clientId: "cl",
  };
}

function collectFromValue(value, hits) {
  const keys = encodedKeys();
  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, hits);
    return;
  }
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value[keys.youtubeList])) {
    for (const entry of value[keys.youtubeList]) {
      if (entry && typeof entry === "object" && entry[keys.videoId]) {
        hits.push({
          provider: "youtube",
          videoId: String(entry[keys.videoId]),
          containerId: String(entry[keys.containerId] || ""),
          width: entry[keys.width] || null,
          height: entry[keys.height] || null,
          timeout: entry[keys.timeout] || null,
          clientId: "",
        });
      }
    }
  }
  if (Array.isArray(value[keys.youkuList])) {
    for (const entry of value[keys.youkuList]) {
      if (entry && typeof entry === "object" && entry[keys.videoId]) {
        hits.push({
          provider: "youku",
          videoId: String(entry[keys.videoId]),
          containerId: String(entry[keys.containerId] || ""),
          width: entry[keys.width] || null,
          height: entry[keys.height] || null,
          timeout: entry[keys.timeout] || null,
          clientId: String(entry[keys.clientId] || ""),
        });
      }
    }
  }

  for (const item of Object.values(value)) collectFromValue(item, hits);
}

function collectFromSlideJs(path) {
  const text = readFileSync(path, "utf8");
  const hits = [];
  for (const match of text.matchAll(/data\s*=\s*(\{[\s\S]*?\});?\s*var\s+events\s*=/g)) {
    try {
      collectFromValue(JSON.parse(match[1]), hits);
    } catch {
      // Ignore minified chunks that are not JSON data blocks.
    }
  }
  return hits;
}

function providerRuntimeFlags(packageRoot) {
  const playerPath = join(packageRoot, "data", "player.js");
  if (!existsSync(playerPath)) return {};
  const player = readFileSync(playerPath, "utf8");
  return {
    hasYoutubeRuntime: player.includes("www.youtube.com/player_api") || player.includes("new YT.Player"),
    hasYoukuRuntime: player.includes("players.youku.com/jsapi") || player.includes("new YKU.Player"),
  };
}

function uniqueHits(hits) {
  const seen = new Set();
  const out = [];
  for (const hit of hits) {
    const key = `${hit.provider}|${hit.videoId}|${hit.containerId}|${hit.timeout}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function auditPackage(courseRoot, ispringItem) {
  const packageRoot = join(courseRoot, ispringItem.packagePath || dirname(ispringItem.path || ""));
  const slideFiles = walkFiles(join(packageRoot, "data"), (path) => /slide\d+\.js$/i.test(basename(path)));
  const hits = [];
  for (const slidePath of slideFiles) {
    for (const hit of collectFromSlideJs(slidePath)) {
      hits.push({ ...hit, slideFile: toPosix(relative(packageRoot, slidePath)) });
    }
  }
  const mediaFiles = collectLocalMediaFiles(packageRoot);
  return {
    packagePath: toPosix(relative(courseRoot, packageRoot)),
    entryPath: ispringItem.path || "",
    label: ispringItem.label || "",
    localMediaFiles: mediaFiles,
    externalVideos: uniqueHits(hits),
    ...providerRuntimeFlags(packageRoot),
  };
}

function collectIspring(manifest) {
  const items = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.ispring || []) {
        items.push({ unit, lesson, item });
      }
    }
  }
  return items;
}

function renderMarkdown(report) {
  const rows = report.packages
    .filter((item) => item.externalVideos.length || item.hasYoutubeRuntime || item.hasYoukuRuntime)
    .map((item) => {
      const videos = item.externalVideos.map((video) => `${video.provider}:${video.videoId}`).join("<br>") || "runtime only";
      const local = item.localMediaFiles.length ? item.localMediaFiles.length : "0";
      return `| ${item.lessonId} | ${item.label.replaceAll("|", "\\|")} | ${local} | ${videos.replaceAll("|", "\\|")} |`;
    })
    .join("\n");
  return `# iSpring External Video Audit

Generated: ${report.generatedAt}

Course: ${report.course}

- iSpring packages: ${report.summary.packages}
- Packages with local media files: ${report.summary.packagesWithLocalMedia}
- Packages with external video IDs: ${report.summary.packagesWithExternalVideos}
- Packages with YouTube/Youku runtime code: ${report.summary.packagesWithExternalRuntime}

| Lesson | iSpring | Local media files | External video references |
| --- | --- | ---: | --- |
${rows || "| - | - | - | - |"}
`;
}

if (!courseArg) {
  console.error("Usage: node scripts/audit-ispring-external-videos.mjs --course COURSE [--patch-manifest]");
  process.exit(1);
}

const fsModule = await import("node:fs");
globalThis.__fsModule = fsModule;

const courseRoot = join(coursewareRoot, courseArg);
const manifestPath = join(courseRoot, "course-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
const packages = [];
for (const { unit, lesson, item } of collectIspring(manifest)) {
  const audit = auditPackage(courseRoot, item);
  audit.unit = unit.unit;
  audit.lesson = lesson.lesson;
  audit.lessonId = lesson.id;
  packages.push(audit);
  if (patchManifest) {
    item.localMediaFiles = audit.localMediaFiles;
    item.externalVideos = audit.externalVideos;
    item.externalVideoRuntime = {
      youtube: Boolean(audit.hasYoutubeRuntime),
      youku: Boolean(audit.hasYoukuRuntime),
    };
    item.videoLocalizationStatus = audit.externalVideos.length && !audit.localMediaFiles.length
      ? "external-video-not-localized"
      : audit.localMediaFiles.length
        ? "local-media-present"
        : "no-local-media-detected";
  }
}

if (patchManifest) {
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

const summary = {
  packages: packages.length,
  packagesWithLocalMedia: packages.filter((item) => item.localMediaFiles.length).length,
  packagesWithExternalVideos: packages.filter((item) => item.externalVideos.length).length,
  packagesWithExternalRuntime: packages.filter((item) => item.hasYoutubeRuntime || item.hasYoukuRuntime).length,
  localMediaFiles: packages.reduce((sum, item) => sum + item.localMediaFiles.length, 0),
  externalVideos: packages.reduce((sum, item) => sum + item.externalVideos.length, 0),
};

const report = {
  generatedAt: new Date().toISOString(),
  course: courseArg,
  patchManifest,
  summary,
  packages,
};

mkdirSync(deploymentRoot, { recursive: true });
writeJson(join(deploymentRoot, `ispring-external-video-audit-${courseArg}.json`), report);
writeFileSync(join(deploymentRoot, `ispring-external-video-audit-${courseArg}.md`), renderMarkdown(report), "utf8");
console.log(JSON.stringify({ course: courseArg, summary, patchManifest }, null, 2));
