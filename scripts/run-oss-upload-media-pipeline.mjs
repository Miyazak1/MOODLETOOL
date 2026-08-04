#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const args = parseArgs(process.argv.slice(2));
const uploadId = args.upload;
const uploadsRoot = resolve(args.uploadsRoot || process.env.OSS_UPLOADS_DATA_ROOT || join(projectRoot, "data", "oss-uploads"));
const bucket = stripSlash(args.bucket || process.env.OSS_BUCKET_URI || "");
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "");
const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const assetScope = String(args.assetScope || process.env.COURSEWARE_OSS_ASSET_SCOPE || "playable").toLowerCase();
const ossutilPath = args.ossutil || process.env.OSSUTIL_PATH || "ossutil";

function parseArgs(argv) {
  const out = {
    upload: "",
    uploadsRoot: "",
    coursewareRoot: "",
    bucket: "",
    cdnBaseUrl: "",
    registry: "",
    assetScope: "",
    ossutil: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--upload") out.upload = argv[++i] || "";
    else if (arg === "--uploads-root") out.uploadsRoot = argv[++i] || "";
    else if (arg === "--courseware-root") out.coursewareRoot = argv[++i] || "";
    else if (arg === "--bucket") out.bucket = argv[++i] || "";
    else if (arg === "--cdn-base-url") out.cdnBaseUrl = argv[++i] || "";
    else if (arg === "--registry") out.registry = argv[++i] || "";
    else if (arg === "--asset-scope") out.assetScope = argv[++i] || "";
    else if (arg === "--ossutil") out.ossutil = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/run-oss-upload-media-pipeline.mjs --upload upl-... --uploads-root data/oss-uploads --bucket oss://moodletool --cdn-base-url https://cdn.example.com/courseware-active
`);
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function safeSegment(value) {
  return String(value || "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return !result.error && result.status === 0;
}

function isPlayableDirectKind(kind) {
  return ["video", "h5p"].includes(String(kind || "").toLowerCase());
}

function assetKindForUpload(upload) {
  const kind = String(upload?.kind || "").toLowerCase();
  if (kind === "video" || kind === "h5p") return kind;
  return "other";
}

function updateRegistryAsset(objectKey, record = null) {
  const existing = existsSync(registryPath)
    ? readJson(registryPath)
    : {
        generatedAt: "",
        bucket,
        cdnBaseUrl,
        objectPrefix: "courseware-active",
        assetCount: 0,
        assets: [],
        assetRecords: [],
      };
  const assets = new Set(Array.isArray(existing.assets) ? existing.assets : []);
  assets.add(objectKey);
  const assetRecords = new Map((Array.isArray(existing.assetRecords) ? existing.assetRecords : [])
    .filter((item) => item?.objectKey)
    .map((item) => [item.objectKey, item]));
  if (record?.objectKey) assetRecords.set(record.objectKey, record);
  const next = {
    ...existing,
    generatedAt: new Date().toISOString(),
    bucket: existing.bucket || bucket,
    cdnBaseUrl: existing.cdnBaseUrl || cdnBaseUrl,
    assetCount: assets.size,
    assets: [...assets].sort(),
    assetRecords: [...assetRecords.values()].sort((a, b) => String(a.objectKey).localeCompare(String(b.objectKey))),
  };
  writeFileSync(registryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

if (!uploadId) throw new Error("--upload is required.");
const uploadPath = join(uploadsRoot, safeSegment(uploadId), "upload.json");
if (!existsSync(uploadPath)) throw new Error(`Upload record not found: ${uploadPath}`);
const upload = readJson(uploadPath);
const uploadKind = String(upload.kind || "").toLowerCase();
const isOssOnlyCoursePackage = uploadKind === "course-package"
  && (upload.importMode === "oss-only" || upload.ossOnly === true || String(upload.importStatus || "").startsWith("oss-"));
const needsLocalPublish = isPlayableDirectKind(uploadKind);
const reportPath = join(deploymentRoot, `oss-upload-pipeline-${safeSegment(upload.id)}.json`);
const markdownPath = join(deploymentRoot, `oss-upload-pipeline-${safeSegment(upload.id)}.md`);

const blockers = [];
const warnings = [];
const ok = [];

if (needsLocalPublish && !bucket) blockers.push("OSS bucket is not configured.");
if (needsLocalPublish && !cdnBaseUrl) blockers.push("CDN base URL is not configured.");
if (needsLocalPublish) {
  if (!commandAvailable(ossutilPath)) blockers.push(`ossutil is unavailable: ${ossutilPath}`);
  else ok.push("ossutil is available.");
}
if (!upload.ossUri || !upload.objectKey) blockers.push("Upload record is missing OSS object information.");
if (upload.status !== "uploaded" && upload.status !== "queued") warnings.push(`Upload status is ${upload.status}; expected uploaded/queued.`);
if (uploadKind === "course-package") {
  if (isOssOnlyCoursePackage) {
    ok.push("Course package is handled by the OSS-side extractor/indexer; ECS does not download or store the ZIP.");
    if (!["oss-extract-required", "oss-index-queued", "oss-extracted", "committed"].includes(String(upload.importStatus || ""))) {
      warnings.push(`Course package import status is ${upload.importStatus || "not set"}; expected OSS extractor/indexer handoff state.`);
    }
  } else {
    blockers.push("course-package publish-upload requires OSS-only handoff. Set COURSE_PACKAGE_IMPORT_MODE=oss-only or use the legacy-local import path explicitly.");
  }
}
if (uploadKind === "ispring-package") {
  blockers.push("ispring-package direct upload is stored in OSS inbox, but iSpring package extraction/import from OSS inbox is not implemented yet.");
}
if (!needsLocalPublish && !["course-package", "ispring-package"].includes(uploadKind)) {
  blockers.push(`Unsupported upload kind for publish-upload: ${upload.kind}`);
}

let published = null;
if (!blockers.length && needsLocalPublish) {
  const course = safeSegment(upload.course).toUpperCase();
  const filename = safeSegment(upload.fileName || "upload.bin");
  const activeObjectKey = `courseware-active/${course}/direct-uploads/${safeSegment(upload.id)}/${filename}`;
  const targetUri = `${bucket}/${activeObjectKey}`;
  console.log(`OSS upload publish: ${upload.ossUri} -> ${targetUri}`);
  const result = spawnSync(ossutilPath, ["cp", upload.ossUri, targetUri, "--meta=Cache-Control:public, max-age=2592000"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `ossutil exited ${result.status}`).trim());
  }
  const cdnUrl = `${cdnBaseUrl}/${course}/direct-uploads/${safeSegment(upload.id)}/${encodeURIComponent(filename)}`;
  const registry = updateRegistryAsset(activeObjectKey, {
    course,
    kind: assetKindForUpload(upload),
    source: "cdn",
    objectKey: activeObjectKey,
    relativePath: `direct-uploads/${safeSegment(upload.id)}/${filename}`,
    ossUri: targetUri,
    url: cdnUrl,
    cdnUrl,
    bytes: upload.fileSize || 0,
  });
  published = {
    objectKey: activeObjectKey,
    ossUri: targetUri,
    cdnUrl,
    registryAssetCount: registry.assetCount,
  };
  ok.push("Uploaded playable asset was copied to courseware-active and registry was updated.");
}

const status = blockers.length ? "blocked" : warnings.length ? "ready-with-warnings" : "ready";
const report = {
  status,
  generatedAt: new Date().toISOString(),
  upload: {
    id: upload.id,
    course: upload.course,
    kind: upload.kind,
    fileName: upload.fileName,
    fileSize: upload.fileSize,
    ossUri: upload.ossUri,
  },
  assetScope,
  ok,
  warnings,
  blockers,
  published,
  report: reportPath,
  markdown: markdownPath,
};

await writeJson(reportPath, report);
writeFileSync(
  markdownPath,
  `# OSS Upload Pipeline Report

- Status: ${status}
- Upload: ${upload.id}
- Course: ${upload.course}
- Kind: ${upload.kind}

## OK

${ok.map((item) => `- ${item}`).join("\n") || "- None"}

## Warnings

${warnings.map((item) => `- ${item}`).join("\n") || "- None"}

## Blockers

${blockers.map((item) => `- ${item}`).join("\n") || "- None"}
`,
  "utf8",
);

console.log(JSON.stringify(report, null, 2));
if (blockers.length) process.exit(1);
