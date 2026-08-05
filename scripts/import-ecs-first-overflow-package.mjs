#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const deploymentRoot = join(projectRoot, "deployment");
const args = parseArgs(process.argv.slice(2));
const course = safeCourse(args.course);
if (!course) throw new Error("--course is required.");

const sourceOssUri = args.sourceOssUri || "";
const sourceZip = args.sourceZip ? resolve(args.sourceZip) : "";
const mockOssRoot = args.mockOssRoot ? resolve(args.mockOssRoot) : "";
const mockFailOnce = Boolean(args.mockFailOnce);
const sourceObjectKey = args.sourceObjectKey || objectKeyFromOssUri(sourceOssUri);
const sourceBucket = args.sourceBucket || bucketFromOssUri(sourceOssUri) || process.env.OSS_DIRECT_UPLOAD_BUCKET || "";
const importId = safeSegment(args.importId || `overflow-${Date.now()}`);
const actor = args.actor || "ecs-overflow-worker";
const coursewareRoot = resolve(args.coursewareRoot || process.env.COURSE_ACTIVE_ROOT || join(workspaceRoot, "courseware"));
const courseRoot = resolve(coursewareRoot, course);
const stagingRoot = resolve(args.stagingRoot || join(courseRoot, "_admin_uploads", "overflow-staging", importId));
const localStagingRoot = join(stagingRoot, "local");
const previousActiveRoot = join(stagingRoot, "previous-active");
const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const targetBucketUri = normalizeBucket(args.bucket || process.env.OSS_BUCKET_URI || (sourceBucket ? `oss://${sourceBucket}` : ""));
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "");
const objectPrefix = stripSlash(args.prefix || process.env.COURSEWARE_ASSET_PREFIX || "courseware-active");
const largeFileThresholdBytes = Math.max(1, Number(args.largeFileMb || process.env.COURSE_LARGE_FILE_THRESHOLD_MB || 100)) * 1024 * 1024;
const largeImageThresholdBytes = Math.max(1, Number(args.largeImageMb || process.env.COURSE_LARGE_IMAGE_THRESHOLD_MB || 25)) * 1024 * 1024;
const maxRetries = Math.max(1, Number(args.retries || process.env.COURSE_IMPORT_OSS_UPLOAD_RETRIES || 3));
const keepStaging = Boolean(args.keepStaging);

if (!sourceZip && (!sourceBucket || !sourceObjectKey)) throw new Error("--source-oss-uri or --source-bucket/--source-object-key is required.");
if (!targetBucketUri) throw new Error("OSS_BUCKET_URI or --bucket is required for overflow media publishing.");
if (!cdnBaseUrl) throw new Error("COURSEWARE_ASSET_BASE_URL or --cdn-base-url is required for overflow media publishing.");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--keep-staging") out.keepStaging = true;
    else if (arg.startsWith("--")) out[toCamel(arg.slice(2))] = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/import-ecs-first-overflow-package.mjs --course BOH4M --source-oss-uri oss://moodletool/inbox/uploads/BOH4M/upl.../BOH4M-course-package.zip

Streams an overflow raw course ZIP from OSS. Local documents are staged on ECS; video/audio/H5P/iSpring/large files are streamed to OSS/CDN.`);
}

function toCamel(value) {
  return String(value || "").replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function safeCourse(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").trim().toUpperCase();
}

function safeSegment(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\\/]+/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+$/, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function stripSlash(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function normalizeBucket(value) {
  const trimmed = stripSlash(value);
  return trimmed ? trimmed.replace(/^oss:\/(?!\/)/, "oss://") : "";
}

function bucketFromOssUri(value) {
  const match = String(value || "").match(/^oss:\/\/([^/]+)\//i);
  return match ? match[1] : "";
}

function objectKeyFromOssUri(value) {
  const match = String(value || "").match(/^oss:\/\/[^/]+\/(.+)$/i);
  return match ? match[1] : "";
}

function encodeKey(key) {
  return toPosix(key).split("/").map(encodeURIComponent).join("/");
}

function targetBucketName() {
  return String(targetBucketUri).replace(/^oss:\/\//i, "").split("/")[0];
}

function assertInside(root, candidate) {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  if (candidateResolved !== rootResolved && !candidateResolved.startsWith(`${rootResolved}\\`) && !candidateResolved.startsWith(`${rootResolved}/`)) {
    throw new Error(`Unsafe path outside ${rootResolved}: ${candidateResolved}`);
  }
  return candidateResolved;
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

function zipRelativePath(entryPath) {
  const raw = toPosix(entryPath).replace(/^\/+/, "");
  if (!raw || raw.includes("\0")) return "";
  const parts = raw.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) return "";
  if (parts[0]?.toUpperCase() === course) parts.shift();
  return parts.join("/");
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
  const normalizedPrefix = stripSlash(objectPrefix);
  const relativeKey = normalizedPrefix && objectKey.startsWith(`${normalizedPrefix}/`)
    ? objectKey.slice(normalizedPrefix.length + 1)
    : objectKey;
  return `${cdnBaseUrl}/${encodeKey(relativeKey)}`;
}

function publishRecordFor(relPath, size, kind) {
  const objectKey = `${objectPrefix}/${course}/${relPath}`;
  return {
    course,
    kind,
    source: "cdn",
    objectKey,
    relativePath: relPath,
    ossUri: `${targetBucketUri}/${objectKey}`,
    url: cdnUrlForObjectKey(objectKey),
    cdnUrl: cdnUrlForObjectKey(objectKey),
    bytes: size,
    sha256: "",
    contentType: contentTypeFor(relPath),
    cacheControl: cacheControlFor(kind, relPath),
  };
}

async function publishEntryStream(record, entry) {
  const hash = createHash("sha256");
  entry.on("data", (chunk) => hash.update(chunk));
  await publishClient.putStream(record.objectKey, entry, {
    contentLength: record.bytes || undefined,
    mime: record.contentType,
    headers: {
      "Cache-Control": record.cacheControl,
    },
  });
  return { ...record, sha256: hash.digest("hex") };
}

async function retryPublishEntryFromZip(record, attempt) {
  const stream = await zipStreamFromOss(sourceClient);
  const retryParser = stream.pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of retryParser) {
    const relPath = zipRelativePath(entry.path);
    if (entry.type !== "File" || relPath !== record.relativePath) {
      entry.autodrain();
      continue;
    }
    return { ...(await publishEntryStream(record, entry)), attempts: attempt };
  }
  throw new Error(`ZIP entry not found during retry: ${record.relativePath}`);
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
  if (container.packagePath && published.kind === "ispring") {
    container.packageUrl = container[urlKey].replace(/\/[^/]*$/, "/");
    delete container.packagePath;
  }
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

function courseObjectPrefix() {
  return `${stripSlash(objectPrefix)}/${course}/`;
}

function isCourseAssetRecord(record) {
  const objectKey = String(record?.objectKey || "");
  return String(record?.course || "").toUpperCase() === course || objectKey.startsWith(courseObjectPrefix());
}

function mergeRegistry(records) {
  const existing = readJson(registryPath, { assets: [], assetRecords: [] }) || {};
  const byKey = new Map();
  for (const record of Array.isArray(existing.assetRecords) ? existing.assetRecords : []) {
    if (isCourseAssetRecord(record)) continue;
    if (record?.objectKey) byKey.set(record.objectKey, record);
  }
  for (const record of records) byKey.set(record.objectKey, record);
  const currentKeys = new Set(records.map((record) => record.objectKey).filter(Boolean));
  const staleRecords = (Array.isArray(existing.assetRecords) ? existing.assetRecords : []).filter((record) =>
    isCourseAssetRecord(record)
    && record?.objectKey
    && !currentKeys.has(record.objectKey)
  );
  const assetRecords = [...byKey.values()].sort((a, b) => String(a.objectKey).localeCompare(String(b.objectKey)));
  return {
    registry: {
      ...existing,
      generatedAt: new Date().toISOString(),
      bucket: targetBucketUri,
      cdnBaseUrl,
      objectPrefix,
      assetCount: assetRecords.length,
      assets: assetRecords.map((item) => item.objectKey),
      assetRecords,
    },
    staleRecords,
  };
}

async function createOssClient(bucket) {
  if (mockOssRoot) {
    const failedOnce = new Set();
    return {
      async getStream() {
        if (!sourceZip) throw new Error("--source-zip is required for mock OSS getStream.");
        return { stream: createReadStream(sourceZip) };
      },
      async putStream(name, stream) {
        const target = assertInside(mockOssRoot, join(mockOssRoot, bucket, name));
        mkdirSync(dirname(target), { recursive: true });
        if (mockFailOnce && /lesson-video\.mp4$/i.test(name) && !failedOnce.has(name)) {
          failedOnce.add(name);
          await pipeline(stream, createWriteStream(`${target}.failed-once`));
          rmSync(`${target}.failed-once`, { force: true });
          throw new Error("mock stream upload failure");
        }
        await pipeline(stream, createWriteStream(target));
        return { name, url: target, res: { statusCode: 200 } };
      },
      async delete(name) {
        const target = assertInside(mockOssRoot, join(mockOssRoot, bucket, name));
        rmSync(target, { force: true });
        return { res: { statusCode: 204 } };
      },
    };
  }
  const module = await import("ali-oss");
  const OSS = module.default || module;
  const options = {
    bucket,
    secure: true,
    accessKeyId: process.env.OSS_DIRECT_UPLOAD_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET || "",
  };
  const endpoint = process.env.OSS_DIRECT_UPLOAD_ENDPOINT || process.env.OSS_EXTRACT_ENDPOINT || "";
  if (endpoint) options.endpoint = endpoint;
  const token = process.env.OSS_DIRECT_UPLOAD_SECURITY_TOKEN || process.env.ALIBABA_CLOUD_SECURITY_TOKEN || "";
  if (token) options.stsToken = token;
  if (!options.accessKeyId || !options.accessKeySecret) throw new Error("OSS credentials are not configured.");
  return new OSS(options);
}

async function streamToBuffer(stream, maxBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Manifest entry is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function zipStreamFromOss(client) {
  if (sourceZip) return createReadStream(sourceZip);
  const result = await client.getStream(sourceObjectKey);
  return result.stream || result.res || result;
}

async function clearCourseRootPreservingAdmin() {
  await mkdir(courseRoot, { recursive: true });
  for (const entry of await readdir(courseRoot, { withFileTypes: true })) {
    if (entry.name === "_admin_uploads") continue;
    await rm(join(courseRoot, entry.name), { recursive: true, force: true });
  }
}

async function copyLocalStagingToCourseRoot() {
  if (!existsSync(localStagingRoot)) return;
  await mkdir(courseRoot, { recursive: true });
  for (const entry of await readdir(localStagingRoot, { withFileTypes: true })) {
    await cp(join(localStagingRoot, entry.name), join(courseRoot, entry.name), { recursive: true, force: true });
  }
}

async function moveCurrentActiveToPrevious() {
  await mkdir(courseRoot, { recursive: true });
  await rm(previousActiveRoot, { recursive: true, force: true });
  await mkdir(previousActiveRoot, { recursive: true });
  let moved = 0;
  for (const entry of await readdir(courseRoot, { withFileTypes: true })) {
    if (entry.name === "_admin_uploads") continue;
    await rename(
      assertInside(courseRoot, join(courseRoot, entry.name)),
      assertInside(previousActiveRoot, join(previousActiveRoot, entry.name)),
    );
    moved += 1;
  }
  return moved;
}

async function restorePreviousActive() {
  await clearCourseRootPreservingAdmin();
  if (!existsSync(previousActiveRoot)) return;
  for (const entry of await readdir(previousActiveRoot, { withFileTypes: true })) {
    await cp(join(previousActiveRoot, entry.name), join(courseRoot, entry.name), { recursive: true, force: true });
  }
}

async function switchLocalStagingToCourseRoot() {
  const previousEntries = await moveCurrentActiveToPrevious();
  try {
    await copyLocalStagingToCourseRoot();
  } catch (error) {
    await restorePreviousActive();
    throw error;
  }
  await rm(previousActiveRoot, { recursive: true, force: true });
  return { previousEntries, rollback: "restored-on-switch-failure" };
}

const sourceClient = await createOssClient(sourceBucket || "mock-source");
const publishClient = sourceBucket === targetBucketName() ? sourceClient : await createOssClient(targetBucketName());

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(localStagingRoot, { recursive: true });

let manifest = null;
let entries = 0;
let localFiles = 0;
let localBytes = 0;
const uploaded = [];
let failed = [];
const staleCleanup = {
  planned: [],
  deleted: [],
  failed: [],
};

const zipStream = await zipStreamFromOss(sourceClient);
const parser = zipStream.pipe(unzipper.Parse({ forceStream: true }));

for await (const entry of parser) {
  const relPath = zipRelativePath(entry.path);
  if (entry.type !== "File" || !relPath) {
    entry.autodrain();
    continue;
  }
  entries += 1;
  const size = Number(entry.vars?.uncompressedSize || 0);
  const kind = publishKind(relPath, size);
  if (relPath === "course-manifest.json") {
    const buffer = await streamToBuffer(entry);
    manifest = JSON.parse(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    writeFileSync(assertInside(localStagingRoot, join(localStagingRoot, relPath)), buffer);
    localFiles += 1;
    localBytes += buffer.length;
    continue;
  }
  if (kind) {
    const record = publishRecordFor(relPath, size, kind);
    try {
      uploaded.push({ ...(await publishEntryStream(record, entry)), attempts: 1 });
    } catch (error) {
      failed.push({ ...record, error: error instanceof Error ? error.message : String(error) });
      try {
        entry.autodrain();
      } catch {
        // The entry may already be closed after a stream upload failure.
      }
    }
    continue;
  }
  const target = assertInside(localStagingRoot, join(localStagingRoot, relPath));
  mkdirSync(dirname(target), { recursive: true });
  await pipeline(entry, createWriteStream(target));
  localFiles += 1;
  try {
    localBytes += statSync(target).size;
  } catch {
    localBytes += size;
  }
}

if (failed.length && maxRetries > 1) {
  const remaining = [];
  for (const item of failed) {
    let retried = null;
    let lastError = item.error || "";
    for (let attempt = 2; attempt <= maxRetries; attempt += 1) {
      try {
        retried = await retryPublishEntryFromZip(item, attempt);
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (retried) uploaded.push(retried);
    else remaining.push({ ...item, error: lastError });
  }
  failed = remaining;
}

if (failed.length) {
  throw new Error(`Overflow import stopped: ${failed.length} OSS publish item(s) failed. First error: ${failed[0].error}`);
}
if (!manifest) throw new Error("Overflow package must contain course-manifest.json.");

const publishedByRelPath = new Map(uploaded.map((item) => [item.relativePath, item]));
const rewrittenResources = rewriteManifestNode(manifest, publishedByRelPath);
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  importStatus: "imported",
  storageMode: uploaded.length ? "hybrid" : "local-only",
  mediaStatus: uploaded.length ? "ready" : "not-required",
  hasPlayableMedia: uploaded.some((item) => ["video", "audio", "ispring", "h5p"].includes(item.kind)),
  ecsFirstOverflowImportedAt: new Date().toISOString(),
  importMode: "ecs-first-overflow",
  sourceOssUri: sourceOssUri || `oss://${sourceBucket}/${sourceObjectKey}`,
  latestUploadId: importId,
  publishedAssetCount: uploaded.length,
  rewrittenResources,
  localCleanup: "streamed-no-media-local-copy",
  activeSwitch: "staging-copy-with-rollback",
};
writeJson(join(localStagingRoot, "course-manifest.json"), manifest);

const activeSwitch = await switchLocalStagingToCourseRoot();
const { registry, staleRecords } = mergeRegistry(uploaded);
staleCleanup.planned = staleRecords;
writeJson(registryPath, registry);
for (const staleRecord of staleRecords) {
  try {
    await publishClient.delete(staleRecord.objectKey);
    staleCleanup.deleted.push({ ...staleRecord, action: "deleted" });
  } catch (error) {
    staleCleanup.failed.push({
      ...staleRecord,
      action: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  course,
  importId,
  actor,
  mode: "ecs-first-overflow",
  sourceOssUri: sourceOssUri || `oss://${sourceBucket}/${sourceObjectKey}`,
  courseRoot,
  registryPath,
  summary: {
    entries,
    localFiles,
    localBytes,
    uploaded: uploaded.length,
    uploadedBytes: uploaded.reduce((sum, item) => sum + Number(item.bytes || 0), 0),
    rewrittenResources,
    activeSwitch,
    staleOssObjects: staleCleanup.planned.length,
    deletedStaleOssObjects: staleCleanup.deleted.length,
    failedStaleOssDeletes: staleCleanup.failed.length,
  },
  uploaded,
  failed,
  staleCleanup,
};

mkdirSync(deploymentRoot, { recursive: true });
const reportPath = join(deploymentRoot, `${course}-ecs-first-overflow-import-report.json`);
writeJson(reportPath, report);
if (!keepStaging) rmSync(stagingRoot, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  course,
  importId,
  mode: "ecs-first-overflow",
  entries,
  localFiles,
  uploaded: uploaded.length,
  rewrittenResources,
  staleOssObjects: staleCleanup.planned.length,
  deletedStaleOssObjects: staleCleanup.deleted.length,
  report: reportPath,
}, null, 2));
