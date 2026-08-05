#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const deploymentRoot = join(projectRoot, "deployment");

const args = parseArgs(process.argv.slice(2));
const course = safeCourse(args.course);
if (!course) throw new Error("--course is required.");

const coursewareRoot = resolve(args.coursewareRoot || process.env.COURSE_ACTIVE_ROOT || join(workspaceRoot, "courseware"));
const courseRoot = resolve(coursewareRoot, course);
const manifestPath = join(courseRoot, "course-manifest.json");
const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const bucket = normalizeBucket(args.bucket || process.env.OSS_BUCKET_URI || "");
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "");
const objectPrefix = stripSlash(args.prefix || process.env.COURSEWARE_ASSET_PREFIX || "courseware-active");
const ossutilPath = args.ossutil || process.env.OSSUTIL_PATH || detectOssutil();
const apply = Boolean(args.apply);
const deleteLocal = args.deleteLocal !== false;
const largeFileThresholdBytes = Math.max(1, Number(args.largeFileMb || process.env.COURSE_LARGE_FILE_THRESHOLD_MB || 100)) * 1024 * 1024;
const largeImageThresholdBytes = Math.max(1, Number(args.largeImageMb || process.env.COURSE_LARGE_IMAGE_THRESHOLD_MB || 25)) * 1024 * 1024;
const maxRetries = Math.max(1, Number(args.retries || process.env.COURSE_IMPORT_OSS_UPLOAD_RETRIES || 3));

if (!existsSync(manifestPath)) throw new Error(`Missing course manifest: ${manifestPath}`);

function parseArgs(argv) {
  const out = {
    apply: false,
    deleteLocal: true,
    course: "",
    coursewareRoot: "",
    bucket: "",
    cdnBaseUrl: "",
    prefix: "",
    registry: "",
    ossutil: "",
    largeFileMb: "",
    largeImageMb: "",
    retries: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--apply") out.apply = true;
    else if (arg === "--dry-run") out.apply = false;
    else if (arg === "--keep-local") out.deleteLocal = false;
    else if (arg === "--course") out.course = argv[++i] || "";
    else if (arg === "--courseware-root") out.coursewareRoot = argv[++i] || "";
    else if (arg === "--bucket") out.bucket = argv[++i] || "";
    else if (arg === "--cdn-base-url") out.cdnBaseUrl = argv[++i] || "";
    else if (arg === "--prefix") out.prefix = argv[++i] || "";
    else if (arg === "--registry") out.registry = argv[++i] || "";
    else if (arg === "--ossutil") out.ossutil = argv[++i] || "";
    else if (arg === "--large-file-mb") out.largeFileMb = argv[++i] || "";
    else if (arg === "--large-image-mb") out.largeImageMb = argv[++i] || "";
    else if (arg === "--retries") out.retries = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/finalize-ecs-first-course-storage.mjs --course BOH4M --apply

Publishes playback/high-traffic course resources from ECS to OSS/CDN, rewrites the course manifest, and removes published local copies.`);
}

function safeCourse(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").trim().toUpperCase();
}

function stripSlash(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function normalizeBucket(value) {
  const trimmed = stripSlash(value);
  return trimmed ? trimmed.replace(/^oss:\/(?!\/)/, "oss://") : "";
}

function encodeKey(key) {
  return toPosix(key).split("/").map(encodeURIComponent).join("/");
}

function detectOssutil() {
  for (const candidate of ["ossutil", "ossutil64"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (!result.error) return candidate;
  }
  return "";
}

function readJson(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function walkFiles(root, result = []) {
  if (!existsSync(root)) return result;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "_admin_uploads" || entry.name.startsWith(".")) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, result);
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

const videoExts = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const audioExts = new Set([".mp3", ".m4a", ".wav"]);
const documentExts = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);

function isIspringAsset(relPath) {
  const normalized = `/${toPosix(relPath).toLowerCase()}`;
  return normalized.includes("/html5-package/") || normalized.includes("/html5-package-admin/");
}

function publishKind(relPath, size) {
  const ext = extname(relPath).toLowerCase();
  if (isIspringAsset(relPath)) return "ispring";
  if (videoExts.has(ext)) return "video";
  if (audioExts.has(ext)) return "audio";
  if (ext === ".h5p") return "h5p";
  if (documentExts.has(ext) && size > largeFileThresholdBytes) return "large-file";
  if (imageExts.has(ext) && size > largeImageThresholdBytes) return "large-file";
  return "";
}

function contentTypeFor(relPath) {
  const ext = extname(relPath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".h5p": "application/octet-stream",
  };
  return map[ext] || "application/octet-stream";
}

function cacheControlFor(kind, relPath) {
  if (["video", "audio", "ispring", "h5p"].includes(kind)) return "public, max-age=2592000";
  if (extname(relPath).toLowerCase() === ".html") return "public, max-age=300";
  return "public, max-age=604800";
}

function cdnUrlForObjectKey(objectKey) {
  if (!cdnBaseUrl) return "";
  const normalizedPrefix = stripSlash(objectPrefix);
  const relativeKey = normalizedPrefix && objectKey.startsWith(`${normalizedPrefix}/`)
    ? objectKey.slice(normalizedPrefix.length + 1)
    : objectKey;
  return `${cdnBaseUrl}/${encodeKey(relativeKey)}`;
}

function uploadWithRetry(item) {
  if (!bucket) throw new Error("Missing OSS bucket. Set OSS_BUCKET_URI or pass --bucket.");
  if (!ossutilPath) throw new Error("ossutil is not available. Set OSSUTIL_PATH or install ossutil.");
  const meta = `Cache-Control:${item.cacheControl}#Content-Type:${item.contentType}`;
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const result = spawnSync(ossutilPath, ["cp", item.localPath, item.ossUri, `--meta=${meta}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (!result.error && result.status === 0) return { ...item, action: "uploaded", attempts: attempt };
    lastError = result.error?.message || result.stderr || result.stdout || `ossutil exited ${result.status}`;
  }
  return { ...item, action: "failed", attempts: maxRetries, error: String(lastError || "upload failed").trim() };
}

function mergeRegistry(records) {
  const existing = readJson(registryPath, { assets: [], assetRecords: [] }) || {};
  const byKey = new Map();
  const existingRecords = Array.isArray(existing.assetRecords) ? existing.assetRecords : [];
  for (const record of existingRecords) {
    if (record?.objectKey) byKey.set(record.objectKey, record);
  }
  for (const record of records) byKey.set(record.objectKey, record);
  const assetRecords = [...byKey.values()].sort((a, b) => String(a.objectKey).localeCompare(String(b.objectKey)));
  return {
    ...existing,
    generatedAt: new Date().toISOString(),
    bucket: bucket || existing.bucket || "",
    cdnBaseUrl: cdnBaseUrl || existing.cdnBaseUrl || "",
    objectPrefix,
    assetCount: assetRecords.length,
    assets: assetRecords.map((item) => item.objectKey),
    assetRecords,
  };
}

function rewriteManifestValue(container, pathKey, urlKey, publishedByRelPath) {
  const value = container?.[pathKey];
  if (!value) return false;
  const normalized = toPosix(value).replace(/^\/+/, "");
  const published = publishedByRelPath.get(normalized);
  if (!published) return false;
  container[urlKey] = published.cdnUrl || published.url || "";
  container.source = "cdn";
  delete container[pathKey];
  return true;
}

function rewriteManifestNode(node, publishedByRelPath) {
  let rewritten = 0;
  if (Array.isArray(node)) {
    for (const item of node) rewritten += rewriteManifestNode(item, publishedByRelPath);
    return rewritten;
  }
  if (!node || typeof node !== "object") return 0;
  if (rewriteManifestValue(node, "path", "url", publishedByRelPath)) rewritten += 1;
  if (rewriteManifestValue(node, "previewPath", "previewUrl", publishedByRelPath)) rewritten += 1;
  if (rewriteManifestValue(node, "downloadPath", "downloadUrl", publishedByRelPath)) rewritten += 1;
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") rewritten += rewriteManifestNode(value, publishedByRelPath);
  }
  return rewritten;
}

function pruneEmptyDirs(startDir) {
  let current = startDir;
  while (current && current !== courseRoot && current.startsWith(courseRoot)) {
    try {
      const entries = readdirSync(current);
      if (entries.length) return;
      rmSync(current, { recursive: true, force: true });
    } catch {
      return;
    }
    current = dirname(current);
  }
}

const manifest = readJson(manifestPath);
const files = walkFiles(courseRoot).filter((file) => file !== manifestPath);
const planned = [];
for (const file of files) {
  const relPath = toPosix(relative(courseRoot, file));
  const size = statSync(file).size;
  const kind = publishKind(relPath, size);
  if (!kind) continue;
  const objectKey = `${objectPrefix}/${course}/${relPath}`;
  planned.push({
    course,
    kind,
    source: "cdn",
    localPath: file,
    relativePath: relPath,
    objectKey,
    ossUri: bucket ? `${bucket}/${objectKey}` : "",
    url: cdnUrlForObjectKey(objectKey),
    cdnUrl: cdnUrlForObjectKey(objectKey),
    bytes: size,
    sha256: sha256(file),
    contentType: contentTypeFor(relPath),
    cacheControl: cacheControlFor(kind, relPath),
    action: apply ? "pending" : "dry-run",
  });
}

const uploaded = [];
const failed = [];
for (let index = 0; index < planned.length; index += 1) {
  const item = planned[index];
  if (!apply) {
    uploaded.push(item);
    continue;
  }
  console.log(`ECS-first publish ${index + 1}/${planned.length}: ${item.objectKey}`);
  const result = uploadWithRetry(item);
  if (result.action === "uploaded") uploaded.push(result);
  else failed.push(result);
}

let rewrittenResources = 0;
let deletedLocalFiles = 0;
if (apply && !failed.length) {
  const registry = mergeRegistry(uploaded.map((item) => ({
    course: item.course,
    kind: item.kind,
    source: "cdn",
    objectKey: item.objectKey,
    relativePath: item.relativePath,
    ossUri: item.ossUri,
    url: item.cdnUrl,
    cdnUrl: item.cdnUrl,
    bytes: item.bytes,
    sha256: item.sha256,
  })));
  writeJson(registryPath, registry);
  const publishedByRelPath = new Map(uploaded.map((item) => [item.relativePath, item]));
  rewrittenResources = rewriteManifestNode(manifest, publishedByRelPath);
  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    importStatus: "imported",
    storageMode: uploaded.length ? "hybrid" : "local-only",
    mediaStatus: uploaded.length ? "ready" : "not-required",
    hasPlayableMedia: uploaded.some((item) => ["video", "audio", "ispring", "h5p"].includes(item.kind)),
    ecsFirstFinalizedAt: new Date().toISOString(),
    publishedAssetCount: uploaded.length,
    rewrittenResources,
    localCleanup: deleteLocal ? "complete" : "skipped",
  };
  writeJson(manifestPath, manifest);
  if (deleteLocal) {
    for (const item of uploaded) {
      if (!existsSync(item.localPath)) continue;
      rmSync(item.localPath, { force: true });
      deletedLocalFiles += 1;
      pruneEmptyDirs(dirname(item.localPath));
    }
  }
}

const report = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  course,
  apply,
  deleteLocal,
  courseRoot,
  bucket,
  cdnBaseUrl,
  objectPrefix,
  registryPath,
  summary: {
    scannedFiles: files.length,
    publishCandidates: planned.length,
    uploaded: uploaded.length,
    failed: failed.length,
    rewrittenResources,
    deletedLocalFiles,
    totalPublishedBytes: uploaded.reduce((sum, item) => sum + item.bytes, 0),
  },
  uploaded,
  failed,
};

mkdirSync(deploymentRoot, { recursive: true });
const reportPath = join(deploymentRoot, `${course}-ecs-first-storage-report.json`);
writeJson(reportPath, report);
console.log(JSON.stringify({
  ok: report.ok,
  course,
  apply,
  publishCandidates: report.summary.publishCandidates,
  uploaded: report.summary.uploaded,
  failed: report.summary.failed,
  rewrittenResources,
  deletedLocalFiles,
  report: reportPath,
}, null, 2));

if (failed.length) process.exit(1);
