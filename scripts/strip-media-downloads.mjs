import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course")?.toUpperCase();
const dryRun = process.argv.includes("--dry-run");
const deleteIspringZips = process.argv.includes("--delete-ispring-zips");

if (!course) {
  console.error("Usage: node scripts/strip-media-downloads.mjs --course COURSE [--delete-ispring-zips] [--dry-run]");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function assertInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}\\`) && !resolvedCandidate.startsWith(`${resolvedRoot}/`)) {
    throw new Error(`Unsafe path outside course root: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function isVideoResource(item) {
  const type = String(item?.type || "").toLowerCase();
  const category = String(item?.category || "").toLowerCase();
  const path = `${item?.path || ""} ${item?.url || ""} ${item?.downloadPath || ""} ${item?.downloadUrl || ""}`.toLowerCase();
  return type === "video" || type === "mp4" || type === "webm" || type === "mov" || type === "m4v" || category.includes("video") || /\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(path);
}

function isIspringResource(item) {
  const type = String(item?.type || "").toLowerCase();
  const category = String(item?.category || "").toLowerCase();
  const path = `${item?.path || ""} ${item?.packagePath || ""} ${item?.downloadPath || ""}`.toLowerCase();
  return type === "ispring" || category.includes("ispring") || path.includes("ispring-localized/") || path.includes("html5-package");
}

function stripDownloadFields(item, reason, removals) {
  for (const key of ["downloadPath", "downloadUrl"]) {
    if (!item?.[key]) continue;
    removals.push({ reason, key, label: item.label || item.title || "", value: item[key] });
    delete item[key];
  }
}

function visit(value, removals) {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, removals);
    return;
  }
  if (!value || typeof value !== "object") return;

  if (isIspringResource(value)) stripDownloadFields(value, "ispring-stream-only", removals);
  if (isVideoResource(value)) stripDownloadFields(value, "video-stream-only", removals);

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") visit(child, removals);
  }
}

function collectIspringZipPaths(manifest) {
  const paths = new Set();
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.ispring || []) {
        const downloadPath = toPosix(item.downloadPath || "");
        if (downloadPath.toLowerCase().startsWith("ispring-localized/") && downloadPath.toLowerCase().endsWith(".zip")) {
          paths.add(downloadPath);
        }
      }
    }
  }
  return [...paths];
}

const courseRoot = resolve(
  process.env.COURSE_ROOT ||
    (process.env.COURSEWARE_ROOT ? join(resolve(process.env.COURSEWARE_ROOT), course) : join(workspaceRoot, "courseware", course)),
);
const manifestPath = join(courseRoot, "course-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const zipPaths = collectIspringZipPaths(manifest);
const removals = [];
visit(manifest, removals);

const deletedZipPaths = [];
if (!dryRun && deleteIspringZips) {
  for (const relativePath of zipPaths) {
    const absolutePath = assertInside(courseRoot, join(courseRoot, relativePath));
    if (!existsSync(absolutePath)) continue;
    unlinkSync(absolutePath);
    deletedZipPaths.push(relativePath);
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  mediaDownloadPolicy: {
    patchedAt: new Date().toISOString(),
    policy: "stream-and-share-only",
    removedDownloadFields: removals.length,
    ispringZipPaths: zipPaths.length,
    deletedIspringZipPaths: deletedZipPaths.length,
    note: "iSpring and video resources are intended for online playback and public short-code sharing only. Original iSpring ZIP downloads are not included in the displayed courseware package.",
  },
};

if (!dryRun) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course,
  dryRun,
  deleteIspringZips,
  removedDownloadFields: removals.length,
  ispringZipPaths: zipPaths.length,
  deletedIspringZipPaths: deletedZipPaths.length,
  sampleRemovals: removals.slice(0, 20),
  sampleZipPaths: zipPaths.slice(0, 20),
}, null, 2));
