import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course")?.toUpperCase();
const dryRun = process.argv.includes("--dry-run");
const coursewareRoot = resolve(readArg("--courseware-root") || join(workspaceRoot, "courseware"));

if (!course) {
  console.error("Usage: node scripts/repair-course-display-shape.mjs --course COURSE [--dry-run]");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

function isContentHtml(absPath) {
  const rel = toPosix(relative(courseRoot, absPath));
  if (!/\.html?$/i.test(rel)) return false;
  if (rel.startsWith("ispring-localized/")) return false;
  if (rel.startsWith("previews-html/")) return false;
  if (rel.startsWith("localized-moodle/h5p") || rel.startsWith("localized-moodle/h5p-external")) return false;
  return true;
}

function isOfficePath(value) {
  return /\.(docx?|pptx?|xlsx?)$/i.test(String(value || ""));
}

function isVideoResource(item) {
  const text = `${item?.type || ""} ${item?.category || ""} ${item?.role || ""} ${item?.path || ""} ${item?.downloadPath || ""}`.toLowerCase();
  return /\b(mp4|webm|mov|m4v|video)\b/.test(text) || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(text);
}

function roleFromPath(item) {
  const text = `${item?.role || ""} ${item?.path || ""} ${item?.downloadPath || ""} ${item?.previewPath || ""}`.toLowerCase();
  if (/hands[\s_-]*on|03-hands-on/.test(text)) return "hands_on";
  if (/consolidation|04-consolidation/.test(text)) return "consolidation";
  if (/homework|05-homework/.test(text)) return "homework";
  if (/lesson-expectations|01-lesson-expectations/.test(text)) return "lesson_expectations";
  if (/02-lesson|\/lesson\//.test(text)) return "lesson";
  return item?.role || "download";
}

function resourceFilePath(item) {
  return toPosix(item?.path || item?.downloadPath || "");
}

function collectPreviewPaths(value, out = new Map()) {
  if (Array.isArray(value)) {
    for (const item of value) collectPreviewPaths(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const rel = resourceFilePath(value);
  if (rel && value.previewPath) out.set(rel, value.previewPath);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collectPreviewPaths(child, out);
  }
  return out;
}

function ensurePreviewPath(item, stats, previewPathByFile) {
  const rel = toPosix(item?.path || item?.downloadPath || "");
  if (!rel || !isOfficePath(rel) || item.previewPath) return;
  const knownPreviewPath = previewPathByFile.get(rel);
  if (knownPreviewPath && existsSync(join(courseRoot, knownPreviewPath))) {
    item.previewPath = knownPreviewPath;
    stats.previewBackfilled += 1;
    return;
  }
  const previewPath = toPosix(join("previews-html", rel)) + ".html";
  if (!existsSync(join(courseRoot, previewPath))) return;
  item.previewPath = previewPath;
  stats.previewBackfilled += 1;
}

function visitManifest(value, stats, previewPathByFile) {
  if (Array.isArray(value)) {
    for (const item of value) visitManifest(item, stats, previewPathByFile);
    return;
  }
  if (!value || typeof value !== "object") return;

  ensurePreviewPath(value, stats, previewPathByFile);
  if (isVideoResource(value)) {
    const nextRole = roleFromPath(value);
    if (value.role !== nextRole) {
      value.role = nextRole;
      stats.videoRoleFixed += 1;
    }
    if (value.downloadPath || value.downloadUrl) {
      delete value.downloadPath;
      delete value.downloadUrl;
      stats.videoDownloadFieldsRemoved += 1;
    }
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") visitManifest(child, stats, previewPathByFile);
  }
}

function refreshCounts(manifest) {
  for (const unit of manifest.units || []) {
    let unitDownloads = 0;
    let unitH5p = 0;
    let unitVideo = 0;
    let unitIspring = 0;
    for (const lesson of unit.lessons || []) {
      const downloads = lesson.downloads || [];
      const h5p = downloads.filter((item) => item.type === "h5p" || /\.h5p$/i.test(item.path || "")).length;
      const video = downloads.filter(isVideoResource).length;
      lesson.resourceCounts = {
        ...(lesson.resourceCounts || {}),
        downloads: downloads.length,
        h5p,
        video,
        ispring: (lesson.ispring || []).length,
      };
      unitDownloads += downloads.length;
      unitH5p += h5p;
      unitVideo += video;
      unitIspring += (lesson.ispring || []).length;
    }
    unit.summary = {
      ...(unit.summary || {}),
      lessons: (unit.lessons || []).length,
      downloads: unitDownloads,
      h5p: unitH5p,
      video: unitVideo,
      ispring: unitIspring,
    };
  }
}

function injectSharedMediaCss(html) {
  if (/embedded-h5p-frame|embedded-video/.test(html)) return html;
  const css = `
    .localized-ispring,
    .embedded-h5p-frame,
    .embedded-video { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
    .localized-ispring iframe,
    .embedded-h5p-frame iframe { border: 0; display: block; min-height: 640px; width: 100%; }
    .localized-ispring iframe { height: min(72vh, 760px); }
    .embedded-video video { background: #000; display: block; margin: 0 auto; max-height: min(72vh, 760px); max-width: 100%; width: min(100%, 960px); }
`;
  return html.replace(/<\/style>/i, `${css}  </style>`);
}

function normalizeH5p(html, stats) {
  let changed = 0;
  let out = html.replace(/<div\b([^>]*)>/gi, (match, attrs) => {
    const classMatch = attrs.match(/\bclass=(["'])([^"']*)\1/i);
    if (!classMatch) return match;
    const classes = classMatch[2].split(/\s+/).filter(Boolean);
    if (!classes.includes("embedded-h5p") && !classes.includes("embedded-h5p-frame")) return match;
    const rest = classes.filter((name) => name !== "embedded-h5p" && name !== "embedded-h5p-frame");
    const nextClass = ["embedded-h5p", "embedded-h5p-frame", ...rest].join(" ");
    if (nextClass === classMatch[2]) return match;
    changed += 1;
    return match.replace(classMatch[0], `class=${classMatch[1]}${nextClass}${classMatch[1]}`);
  });
  out = out.replace(/document\.querySelectorAll\(["']\.embedded-h5p iframe["']\)/g, 'document.querySelectorAll(".embedded-h5p-frame iframe")');
  if (changed) stats.h5pFramesNormalized += changed;
  return out;
}

function normalizeVideos(html, stats) {
  let changed = 0;
  let out = html.replace(/<div\b[^>]*class=["'][^"']*\bmediaplugin_videojs\b[^"']*["'][^>]*>\s*<div\b[^>]*>\s*(<video\b[\s\S]*?<\/video>)\s*<\/div>\s*<\/div>/gi, (_match, video) => {
    changed += 1;
    const cleanedVideo = video
      .replace(/<a\b[^>]*class=["'][^"']*\b_blanktarget\b[^"']*["'][^>]*>\s*<\/a>/gi, "")
      .replace(/\sdata-setup-lazy=(["'])[\s\S]*?\1/gi, "")
      .replace(/\sclass=(["'])[^"']*\bvideo-js\b[^"']*\1/gi, "")
      .replace(/\s{2,}/g, " ");
    return `<div class="embedded-video">${cleanedVideo}</div>`;
  });

  out = out.replace(/\s*<section class="files"><h2>Files<\/h2>([\s\S]*?)<\/section>/gi, (match, body) => {
    if (!/\.mp4|\.webm|\.mov|\.m4v/i.test(body)) return match;
    const remaining = body.replace(/<div class="file-row">[\s\S]*?\.(?:mp4|webm|mov|m4v)[\s\S]*?<\/div>/gi, "");
    if (!/<div class="file-row">/i.test(remaining)) return "";
    return `<section class="files"><h2>Files</h2>${remaining}</section>`;
  });

  if (changed) stats.videosNormalized += changed;
  return out;
}

function repairHtmlPage(absPath, stats) {
  const before = readFileSync(absPath, "utf8");
  let after = injectSharedMediaCss(before);
  after = normalizeH5p(after, stats);
  after = normalizeVideos(after, stats);
  if (after === before) return;
  stats.htmlRewritten += 1;
  if (!dryRun) writeFileSync(absPath, after, "utf8");
}

const courseRoot = join(coursewareRoot, course);
const manifestPath = join(courseRoot, "course-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const stats = {
  course,
  dryRun,
  previewBackfilled: 0,
  videoRoleFixed: 0,
  videoDownloadFieldsRemoved: 0,
  h5pFramesNormalized: 0,
  videosNormalized: 0,
  htmlRewritten: 0,
};

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const previewPathByFile = collectPreviewPaths(manifest);
visitManifest(manifest, stats, previewPathByFile);
refreshCounts(manifest);

for (const file of walkFiles(courseRoot).filter(isContentHtml)) {
  repairHtmlPage(file, stats);
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  displayShapeRepair: {
    repairedAt: new Date().toISOString(),
    previewBackfilled: stats.previewBackfilled,
    videoRoleFixed: stats.videoRoleFixed,
    videoDownloadFieldsRemoved: stats.videoDownloadFieldsRemoved,
    h5pFramesNormalized: stats.h5pFramesNormalized,
    videosNormalized: stats.videosNormalized,
    note: "Standardized existing localized H5P/video HTML embeds and backfilled available Office preview paths without flattening Moodle text pages.",
  },
};
manifest.generatedAt = new Date().toISOString();

if (!dryRun) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(stats, null, 2));
