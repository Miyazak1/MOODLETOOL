import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = (process.argv.find((arg) => arg.startsWith("--course="))?.split("=")[1] || process.argv[2] || "").toUpperCase();

if (!course) {
  console.error("Usage: node scripts/normalize-course-file-actions.mjs --course=BAT4M");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const playableOnlyTypes = new Set(["ispring", "video", "mp4", "mov", "m4v", "webm"]);
const htmlTypes = new Set(["html", "htm"]);

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function isFileResource(item) {
  if (!item || typeof item !== "object") return false;
  const type = String(item.type || "").toLowerCase();
  if (!type || htmlTypes.has(type) || playableOnlyTypes.has(type)) return false;
  return Boolean(item.path || item.downloadPath);
}

function fallbackPreviewPath(path) {
  if (!path) return undefined;
  const type = String(path).split(".").pop()?.toLowerCase() || "";
  if (["pdf", "txt", "csv", "png", "jpg", "jpeg", "gif", "webp", "tif", "tiff"].includes(type)) return path;
  const preview = `previews-html/${toPosix(path).replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._/\- ]+/g, "_")}.html`;
  return existsSync(join(courseRoot, preview)) ? preview : undefined;
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") walk(child, visit);
  }
}

const byPath = new Map();
walk(manifest, (item) => {
  if (!isFileResource(item)) return;
  const path = item.path || item.downloadPath;
  const key = toPosix(path).toLowerCase();
  const current = byPath.get(key) || {};
  byPath.set(key, {
    downloadPath: current.downloadPath || item.downloadPath || item.path,
    previewPath: current.previewPath || item.previewPath || fallbackPreviewPath(path),
  });
});

let updated = 0;
walk(manifest, (item) => {
  if (!isFileResource(item)) return;
  const path = item.path || item.downloadPath;
  const key = toPosix(path).toLowerCase();
  const canonical = byPath.get(key) || {};
  const nextDownloadPath = item.downloadPath || canonical.downloadPath || item.path;
  const nextPreviewPath = item.previewPath || canonical.previewPath || fallbackPreviewPath(path);
  if (nextDownloadPath && item.downloadPath !== nextDownloadPath) {
    item.downloadPath = nextDownloadPath;
    updated++;
  }
  if (nextPreviewPath && item.previewPath !== nextPreviewPath) {
    item.previewPath = nextPreviewPath;
    updated++;
  }
});

manifest.sourceAudit ||= {};
manifest.sourceAudit.fileActionNormalization = {
  normalizedAt: new Date().toISOString(),
  rule: "All concrete non-playable files keep downloadPath and, when previewable, previewPath across duplicate manifest references.",
  updatedFields: updated,
};
manifest.generatedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ course, updatedFields: updated }, null, 2));
