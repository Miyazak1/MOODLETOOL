#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import OSS from "ali-oss";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const deploymentRoot = join(projectRoot, "deployment");
const args = parseArgs(process.argv.slice(2));
const apply = args.apply;
const listPath = resolve(args.list || join(deploymentRoot, "bbi2o-video-publish-list.json"));
const deltaRoot = resolve(args.deltaRoot || join(deploymentRoot, "bbi2o-video-remux-delta-20260822"));
const courseActiveRoot = resolve(args.courseActiveRoot || process.env.COURSE_ACTIVE_ROOT || join(workspaceRoot, "courseware"));
const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const bucket = stripSlash(args.bucket || process.env.OSS_BUCKET_URI || "");
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "https://cdn.moodletool.work/courseware-active");
const ossutilPath = args.ossutil || process.env.OSSUTIL_PATH || "ossutil";
const skipOss = args.skipOss;
const skipEcs = args.skipEcs;
const skipRegistry = args.skipRegistry;
const verifyCdn = args.verifyCdn;
const timeoutMs = Number(args.timeoutMs || 15000);
const reportPath = resolve(args.report || join(deploymentRoot, "bbi2o-video-delta-publish-report.json"));
const markdownPath = reportPath.replace(/\.json$/i, ".md");
const uploadClient = normalizeUploadClient(args.uploadClient || process.env.BBI2O_VIDEO_DELTA_UPLOAD_CLIENT || "auto");
const ossAccessKeyId = args.ossAccessKeyId || process.env.OSS_ACCESS_KEY_ID || process.env.OSS_DIRECT_UPLOAD_ACCESS_KEY_ID || "";
const ossAccessKeySecret = args.ossAccessKeySecret || process.env.OSS_ACCESS_KEY_SECRET || process.env.OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET || "";
const ossEndpoint = args.ossEndpoint || process.env.OSS_SERVER_ENDPOINT || process.env.OSS_INTERNAL_ENDPOINT || process.env.OSS_DIRECT_UPLOAD_ENDPOINT || "";
const ossRegion = args.ossRegion || process.env.OSS_REGION || process.env.OSS_EXTRACT_REGION || regionFromEndpoint(ossEndpoint);
const ossBucketName = args.ossBucketName || process.env.OSS_DIRECT_UPLOAD_BUCKET || bucket.replace(/^oss:\/\//i, "").split("/")[0] || "";

function parseArgs(argv) {
  const out = {
    apply: false,
    list: "",
    deltaRoot: "",
    courseActiveRoot: "",
    registry: "",
    bucket: "",
    cdnBaseUrl: "",
    ossutil: "",
    uploadClient: "",
    ossAccessKeyId: "",
    ossAccessKeySecret: "",
    ossEndpoint: "",
    ossRegion: "",
    ossBucketName: "",
    skipOss: false,
    skipEcs: false,
    skipRegistry: false,
    verifyCdn: false,
    timeoutMs: "",
    report: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--apply") out.apply = true;
    else if (arg === "--dry-run") out.apply = false;
    else if (arg === "--list") out.list = argv[++i] || "";
    else if (arg === "--delta-root") out.deltaRoot = argv[++i] || "";
    else if (arg === "--course-active-root") out.courseActiveRoot = argv[++i] || "";
    else if (arg === "--registry") out.registry = argv[++i] || "";
    else if (arg === "--bucket") out.bucket = argv[++i] || "";
    else if (arg === "--cdn-base-url") out.cdnBaseUrl = argv[++i] || "";
    else if (arg === "--ossutil") out.ossutil = argv[++i] || "";
    else if (arg === "--upload-client") out.uploadClient = argv[++i] || "";
    else if (arg === "--oss-access-key-id") out.ossAccessKeyId = argv[++i] || "";
    else if (arg === "--oss-access-key-secret") out.ossAccessKeySecret = argv[++i] || "";
    else if (arg === "--oss-endpoint") out.ossEndpoint = argv[++i] || "";
    else if (arg === "--oss-region") out.ossRegion = argv[++i] || "";
    else if (arg === "--oss-bucket-name") out.ossBucketName = argv[++i] || "";
    else if (arg === "--skip-oss") out.skipOss = true;
    else if (arg === "--skip-ecs") out.skipEcs = true;
    else if (arg === "--skip-registry") out.skipRegistry = true;
    else if (arg === "--verify-cdn") out.verifyCdn = true;
    else if (arg === "--timeout-ms") out.timeoutMs = argv[++i] || "";
    else if (arg === "--report") out.report = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/publish-bbi2o-video-delta.mjs --dry-run
  node scripts/publish-bbi2o-video-delta.mjs --apply --bucket oss://moodletool --course-active-root /www/wwwroot/ossd-portal/courseware-active

This publishes only the BBI2O video-loading fix delta:
- validates files from deployment/bbi2o-video-remux-delta-20260822/BBI2O
- uploads the 24 referenced MP4 files to OSS with video/mp4 metadata
- copies course-manifest.json and the corrected U2L4 index.html to COURSE_ACTIVE_ROOT/BBI2O
- merges the 24 MP4 records into asset-registry.json with sha256 cache-busting versions

Upload clients:
- auto: use ossutil when available, otherwise use ali-oss when AccessKey env is configured
- ossutil: require the ossutil executable
- ali-oss: require OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET or OSS_DIRECT_UPLOAD_ACCESS_KEY_ID/OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET
`);
}

function normalizeUploadClient(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  if (!["auto", "ossutil", "ali-oss"].includes(normalized)) throw new Error(`Unsupported --upload-client: ${value}`);
  return normalized;
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
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

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  return !result.error && result.status === 0;
}

function regionFromEndpoint(endpoint) {
  const match = String(endpoint || "").match(/oss-([a-z0-9-]+?)(?:-internal)?\.aliyuncs\.com/i);
  return match ? `oss-${match[1]}` : "";
}

function aliOssAvailable() {
  return Boolean(ossAccessKeyId && ossAccessKeySecret && ossEndpoint && ossBucketName);
}

function selectedUploadClient() {
  if (uploadClient === "ossutil") return "ossutil";
  if (uploadClient === "ali-oss") return "ali-oss";
  if (commandAvailable(ossutilPath)) return "ossutil";
  if (aliOssAvailable()) return "ali-oss";
  return "none";
}

function ossUriForObjectKey(objectKey) {
  if (!bucket) return "";
  return `${bucket}/${toPosix(objectKey).replace(/^\/+/, "")}`;
}

function cdnUrlFor(relativePath, fallback = "") {
  if (fallback) return fallback.replace(/\?.*$/, "");
  return `${cdnBaseUrl}/BBI2O/${toPosix(relativePath).split("/").map(encodeURIComponent).join("/")}`;
}

function validateFile(sourcePath, expected) {
  if (!existsSync(sourcePath)) return { ok: false, error: "missing" };
  const stat = statSync(sourcePath);
  const actualSha = sha256(sourcePath);
  const errors = [];
  if (expected.bytes && stat.size !== expected.bytes) errors.push(`size ${stat.size} != ${expected.bytes}`);
  if (expected.sha256 && actualSha !== expected.sha256) errors.push(`sha256 ${actualSha} != ${expected.sha256}`);
  return { ok: !errors.length, bytes: stat.size, sha256: actualSha, error: errors.join("; ") };
}

async function uploadWithAliOss(item, sourcePath, meta) {
  if (!aliOssAvailable()) {
    return { action: "blocked", error: "Ali OSS credentials are incomplete. Set OSS_DIRECT_UPLOAD_BUCKET, OSS_DIRECT_UPLOAD_ENDPOINT, OSS_DIRECT_UPLOAD_ACCESS_KEY_ID, and OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET." };
  }
  const client = new OSS({
    region: ossRegion || undefined,
    endpoint: ossEndpoint,
    accessKeyId: ossAccessKeyId,
    accessKeySecret: ossAccessKeySecret,
    bucket: ossBucketName,
    secure: true,
  });
  await client.put(toPosix(item.objectKey).replace(/^courseware-active\//, "courseware-active/"), sourcePath, {
    headers: {
      "Cache-Control": "public, max-age=2592000",
      "Content-Type": item.contentType || "video/mp4",
    },
  });
  return { action: "uploaded", client: "ali-oss", meta };
}

async function uploadVideo(item, sourcePath) {
  if (skipOss) return { action: "skipped" };
  if (!apply) return { action: "would-upload", ossUri: ossUriForObjectKey(item.objectKey) };
  const meta = `Cache-Control:public, max-age=2592000#Content-Type:${item.contentType || "video/mp4"}`;
  const client = selectedUploadClient();
  if (client === "ali-oss") return uploadWithAliOss(item, sourcePath, meta);
  if (!bucket) return { action: "blocked", error: "Missing OSS bucket. Pass --bucket or set OSS_BUCKET_URI." };
  if (client !== "ossutil") return { action: "blocked", error: `No OSS upload client is available. Install ossutil or configure Ali OSS AccessKey env.` };
  if (!commandAvailable(ossutilPath)) return { action: "blocked", error: `ossutil is unavailable: ${ossutilPath}` };
  const result = spawnSync(ossutilPath, ["cp", sourcePath, ossUriForObjectKey(item.objectKey), `--meta=${meta}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error) return { action: "failed", error: result.error.message };
  if (result.status !== 0) return { action: "failed", error: (result.stderr || result.stdout || `ossutil exited ${result.status}`).trim() };
  return { action: "uploaded", client: "ossutil" };
}

function copyEcsFile(item, sourcePath) {
  if (skipEcs) return { action: "skipped" };
  const targetPath = resolve(courseActiveRoot, "BBI2O", item.relativePath);
  if (!targetPath.startsWith(resolve(courseActiveRoot, "BBI2O"))) {
    return { action: "blocked", error: `Refusing to copy outside BBI2O active root: ${targetPath}` };
  }
  if (!apply) return { action: "would-copy", targetPath };
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return { action: "copied", targetPath };
}

function mergeRegistry(videos) {
  if (skipRegistry) return { action: "skipped" };
  if (!apply) return { action: "would-update", registryPath };
  const existing = readJson(registryPath, {
    generatedAt: "",
    bucket,
    cdnBaseUrl,
    objectPrefix: "courseware-active",
    assetCount: 0,
    assets: [],
    assetRecords: [],
  }) || {};
  const staleWebm = /^courseware-active\/BBI2O\/.*\.webm$/i;
  const recordMap = new Map();
  const assetMap = new Map();
  for (const record of Array.isArray(existing.assetRecords) ? existing.assetRecords : []) {
    if (record?.objectKey && !staleWebm.test(toPosix(record.objectKey))) recordMap.set(toPosix(record.objectKey), record);
  }
  for (const asset of Array.isArray(existing.assets) ? existing.assets : []) {
    const objectKey = toPosix(typeof asset === "string" ? asset : asset?.objectKey || "");
    if (objectKey && !staleWebm.test(objectKey)) assetMap.set(objectKey, asset);
  }
  for (const item of videos) {
    const record = {
      course: "BBI2O",
      kind: "video",
      source: "cdn",
      objectKey: toPosix(item.objectKey),
      relativePath: toPosix(item.relativePath),
      ossUri: ossUriForObjectKey(item.objectKey),
      url: cdnUrlFor(item.relativePath, item.cdnUrl),
      cdnUrl: cdnUrlFor(item.relativePath, item.cdnUrl),
      bytes: item.bytes,
      sha256: item.sha256,
    };
    recordMap.set(toPosix(item.objectKey), record);
    assetMap.set(toPosix(item.objectKey), record);
  }
  const assetRecords = [...recordMap.values()].sort((a, b) => String(a.objectKey).localeCompare(String(b.objectKey)));
  const assets = [...assetMap.values()].sort((a, b) => {
    const left = typeof a === "string" ? a : a?.objectKey || "";
    const right = typeof b === "string" ? b : b?.objectKey || "";
    return String(left).localeCompare(String(right));
  });
  const next = {
    ...existing,
    generatedAt: new Date().toISOString(),
    bucket: existing.bucket || bucket,
    cdnBaseUrl: existing.cdnBaseUrl || cdnBaseUrl,
    objectPrefix: existing.objectPrefix || "courseware-active",
    assetCount: assets.length,
    assets,
    assetRecords,
  };
  writeJson(registryPath, next);
  return { action: "updated", registryPath, assetCount: next.assetCount, bbi2oVideos: videos.length };
}

async function verifyCdnRange(item) {
  const versionedUrl = `${cdnUrlFor(item.relativePath, item.cdnUrl)}?v=${String(item.sha256 || "").slice(0, 12)}`;
  const response = await fetch(versionedUrl, {
    method: "GET",
    headers: { Range: "bytes=0-1023" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.body) await response.arrayBuffer();
  return {
    url: versionedUrl,
    status: response.status,
    ok: response.status === 206,
    contentType: response.headers.get("content-type") || "",
    contentRange: response.headers.get("content-range") || "",
    acceptRanges: response.headers.get("accept-ranges") || "",
  };
}

const publishList = readJson(listPath);
if (!publishList) throw new Error(`Missing publish list: ${listPath}`);
if (publishList.course !== "BBI2O") throw new Error(`Unexpected course in publish list: ${publishList.course}`);

const deltaCourseRoot = resolve(deltaRoot, "BBI2O");
const videos = Array.isArray(publishList.videos) ? publishList.videos : [];
const ecsFiles = Array.isArray(publishList.ecsFiles) ? publishList.ecsFiles : [];
const videoResults = [];
const ecsResults = [];
const blockers = [];

for (const item of videos) {
  const sourcePath = resolve(deltaCourseRoot, item.relativePath);
  const validation = validateFile(sourcePath, item);
  const upload = validation.ok ? await uploadVideo(item, sourcePath) : { action: "blocked", error: validation.error };
  if (["blocked", "failed"].includes(upload.action)) blockers.push(`${item.relativePath}: ${upload.error}`);
  videoResults.push({ ...item, sourcePath, validation, upload });
}

for (const item of ecsFiles) {
  const sourcePath = resolve(deltaCourseRoot, item.relativePath);
  const validation = validateFile(sourcePath, {});
  const copy = validation.ok ? copyEcsFile(item, sourcePath) : { action: "blocked", error: validation.error };
  if (["blocked", "failed"].includes(copy.action)) blockers.push(`${item.relativePath}: ${copy.error}`);
  ecsResults.push({ ...item, sourcePath, validation, copy });
}

const registry = blockers.length ? { action: "skipped", reason: "blocked" } : mergeRegistry(videos);
if (["blocked", "failed"].includes(registry.action)) blockers.push(`registry: ${registry.error}`);

const cdnChecks = [];
if (verifyCdn && apply && !blockers.length) {
  for (const item of videos) {
    try {
      cdnChecks.push(await verifyCdnRange(item));
    } catch (error) {
      cdnChecks.push({ relativePath: item.relativePath, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  status: blockers.length ? "blocked" : apply ? "published" : "ready",
  apply,
  listPath,
  deltaRoot,
  courseActiveRoot,
  registryPath,
  bucket,
  cdnBaseUrl,
  ossutilPath,
  summary: {
    videos: videoResults.length,
    ecsFiles: ecsResults.length,
    uploaded: videoResults.filter((item) => item.upload.action === "uploaded").length,
    copied: ecsResults.filter((item) => item.copy.action === "copied").length,
    blockers: blockers.length,
    cdnChecked: cdnChecks.length,
    cdnOk: cdnChecks.filter((item) => item.ok).length,
  },
  blockers,
  videoResults,
  ecsResults,
  registry,
  cdnChecks,
};

writeJson(reportPath, report);
writeFileSync(
  markdownPath,
  `# BBI2O Video Delta Publish Report

- Status: ${report.status}
- Mode: ${apply ? "apply" : "dry-run"}
- Videos: ${report.summary.videos}
- ECS files: ${report.summary.ecsFiles}
- Uploaded: ${report.summary.uploaded}
- Copied: ${report.summary.copied}
- Blockers: ${report.summary.blockers}
- Registry: ${registry.action}

## Blockers

${blockers.map((item) => `- ${item}`).join("\n") || "- None"}
`,
  "utf8",
);

console.log(JSON.stringify({
  status: report.status,
  apply,
  videos: report.summary.videos,
  ecsFiles: report.summary.ecsFiles,
  uploaded: report.summary.uploaded,
  copied: report.summary.copied,
  registry: registry.action,
  blockers: blockers.length,
  report: reportPath,
  markdown: markdownPath,
}, null, 2));

if (blockers.length) process.exit(1);
