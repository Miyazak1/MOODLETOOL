#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const args = parseArgs(process.argv.slice(2));
const bucket = normalizeBucket(args.bucket || process.env.OSS_BUCKET_URI || "");
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "");
const objectPrefix = stripSlash(args.prefix || process.env.OSS_COURSEWARE_PREFIX || "courseware-active");
const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const ossutilPath = args.ossutil || process.env.OSSUTIL_PATH || "ossutil";
const assetScope = normalizeAssetScope(args.assetScope || process.env.COURSEWARE_OSS_ASSET_SCOPE || "playable");
const dryRun = !args.apply;
const courses = args.courses.map((course) => safeCourse(course));

const playableVideoExts = new Set([".mp4", ".webm", ".mov", ".m4v"]);

function parseArgs(argv) {
  const out = {
    apply: false,
    all: false,
    bucket: "",
    cdnBaseUrl: "",
    prefix: "",
    registry: "",
    ossutil: "",
    assetScope: "",
    courses: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--apply") out.apply = true;
    else if (arg === "--dry-run") out.apply = false;
    else if (arg === "--all") out.all = true;
    else if (arg === "--course") out.courses.push(...String(argv[++i] || "").split(",").map((item) => item.trim()).filter(Boolean));
    else if (arg === "--bucket") out.bucket = argv[++i] || "";
    else if (arg === "--cdn-base-url") out.cdnBaseUrl = argv[++i] || "";
    else if (arg === "--prefix") out.prefix = argv[++i] || "";
    else if (arg === "--registry") out.registry = argv[++i] || "";
    else if (arg === "--ossutil") out.ossutil = argv[++i] || "";
    else if (arg === "--asset-scope") out.assetScope = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/index-oss-courseware-assets.mjs --course MHF4U --bucket oss://moodletool --cdn-base-url https://cdn.moodletool.work/courseware-active --apply
  node scripts/index-oss-courseware-assets.mjs --all --bucket oss://moodletool --cdn-base-url https://cdn.moodletool.work/courseware-active --dry-run

This indexes existing OSS objects into asset-registry.json. It does not download or copy course files to ECS.`);
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeBucket(value) {
  const trimmed = stripSlash(value);
  return trimmed ? trimmed.replace(/^oss:\/(?!\/)/, "oss://") : "";
}

function normalizeAssetScope(value) {
  const scope = String(value || "playable").trim().toLowerCase();
  if (!["playable", "all"].includes(scope)) throw new Error(`Unsupported --asset-scope: ${value}`);
  return scope;
}

function safeCourse(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .trim()
    .toUpperCase();
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function readJson(path, fallback) {
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

function isIspringPackageAsset(relPath) {
  const normalized = `/${toPosix(relPath).toLowerCase()}`;
  return normalized.includes("/html5-package/") || normalized.includes("/html5-package-admin/");
}

function isPlayableAsset(relPath) {
  const normalized = toPosix(relPath);
  const ext = extname(normalized).toLowerCase();
  return playableVideoExts.has(ext) || ext === ".h5p" || isIspringPackageAsset(normalized);
}

function assetKind(relPath) {
  const normalized = toPosix(relPath);
  const ext = extname(normalized).toLowerCase();
  if (isIspringPackageAsset(normalized)) return "ispring";
  if (playableVideoExts.has(ext)) return "video";
  if (ext === ".h5p") return "h5p";
  return ext ? ext.slice(1) : "other";
}

function ossListPrefix(course = "") {
  return `${bucket}/${objectPrefix}${course ? `/${course}` : ""}/`;
}

function listOss(prefixUri) {
  const result = spawnSync(ossutilPath, ["ls", prefixUri], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `ossutil exited ${result.status}`).trim());
  return result.stdout || "";
}

function objectFromLine(line) {
  const idx = line.indexOf("oss://");
  if (idx < 0) return null;
  const ossUri = line.slice(idx).trim();
  if (!ossUri.startsWith(`${bucket}/`)) return null;
  const objectKey = ossUri.slice(`${bucket}/`.length);
  if (!objectKey || objectKey.endsWith("/")) return null;

  const columns = line.slice(0, idx).trim().split(/\s+/);
  const standardIndex = columns.findIndex((item) => item === "Standard" || item === "IA" || item === "Archive");
  const sizeBytes = standardIndex > 0 ? Number(columns[standardIndex - 1]) : 0;
  const afterPrefix = objectKey.startsWith(`${objectPrefix}/`) ? objectKey.slice(objectPrefix.length + 1) : "";
  const [course, ...rest] = afterPrefix.split("/");
  const relativePath = rest.join("/");
  if (!course || !relativePath) return null;
  return {
    course: safeCourse(course),
    objectKey,
    relativePath,
    ossUri,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
  };
}

function collectObjects() {
  const prefixes = args.all || !courses.length ? [ossListPrefix("")] : courses.map((course) => ossListPrefix(course));
  const objects = [];
  for (const prefix of prefixes) {
    const stdout = listOss(prefix);
    for (const line of stdout.split(/\r?\n/)) {
      const item = objectFromLine(line);
      if (!item) continue;
      if (courses.length && !courses.includes(item.course)) continue;
      if (assetScope === "playable" && !isPlayableAsset(item.relativePath)) continue;
      objects.push(item);
    }
  }
  const unique = new Map();
  for (const item of objects) unique.set(item.objectKey, item);
  return [...unique.values()].sort((a, b) => a.objectKey.localeCompare(b.objectKey));
}

function mergeRegistry(indexedObjects) {
  const existing = readJson(registryPath, {
    generatedAt: "",
    coursewareRoot: "oss-only",
    bucket,
    cdnBaseUrl,
    objectPrefix,
    assetCount: 0,
    assets: [],
  });
  const indexedAssets = indexedObjects.map((item) => item.objectKey);
  const indexedRecords = indexedObjects.map((item) => ({
    course: item.course,
    kind: assetKind(item.relativePath),
    source: "cdn",
    objectKey: item.objectKey,
    relativePath: item.relativePath,
    ossUri: item.ossUri,
    url: cdnBaseUrl ? `${cdnBaseUrl}/${item.course}/${item.relativePath.split("/").map(encodeURIComponent).join("/")}` : "",
    cdnUrl: cdnBaseUrl ? `${cdnBaseUrl}/${item.course}/${item.relativePath.split("/").map(encodeURIComponent).join("/")}` : "",
    bytes: item.sizeBytes || 0,
  }));
  const oldAssets = Array.isArray(existing.assets) ? existing.assets : [];
  const oldRecords = Array.isArray(existing.assetRecords) ? existing.assetRecords : [];
  const courseSet = new Set(indexedObjects.map((item) => item.course));
  const replaceAll = args.all || !courses.length;
  const retained = replaceAll
    ? []
    : oldAssets.filter((key) => {
        const afterPrefix = String(key).startsWith(`${objectPrefix}/`) ? String(key).slice(objectPrefix.length + 1) : "";
        const course = safeCourse(afterPrefix.split("/")[0] || "");
        return !courseSet.has(course);
      });
  const retainedRecords = replaceAll
    ? []
    : oldRecords.filter((record) => {
        const afterPrefix = String(record?.objectKey || "").startsWith(`${objectPrefix}/`) ? String(record.objectKey).slice(objectPrefix.length + 1) : "";
        const course = safeCourse(afterPrefix.split("/")[0] || record?.course || "");
        return !courseSet.has(course);
      });
  const assets = [...new Set([...retained, ...indexedAssets])].sort();
  const recordMap = new Map();
  for (const record of [...retainedRecords, ...indexedRecords]) {
    if (record?.objectKey) recordMap.set(record.objectKey, record);
  }
  const assetRecords = [...recordMap.values()].sort((a, b) => String(a.objectKey).localeCompare(String(b.objectKey)));
  return {
    ...existing,
    generatedAt: new Date().toISOString(),
    coursewareRoot: "oss-only",
    bucket: existing.bucket || bucket,
    cdnBaseUrl: existing.cdnBaseUrl || cdnBaseUrl,
    objectPrefix,
    assetCount: assets.length,
    assets,
    assetRecords,
  };
}

if (!bucket) throw new Error("Missing --bucket or OSS_BUCKET_URI.");
if (!cdnBaseUrl) throw new Error("Missing --cdn-base-url or COURSEWARE_ASSET_BASE_URL.");
if (!args.all && !courses.length) throw new Error("--course or --all is required.");

const indexed = collectObjects();
const registry = mergeRegistry(indexed);
const courseSummary = new Map();
for (const item of indexed) {
  const current = courseSummary.get(item.course) || { course: item.course, files: 0, totalBytes: 0 };
  current.files += 1;
  current.totalBytes += item.sizeBytes || 0;
  courseSummary.set(item.course, current);
}

if (!dryRun) writeJson(registryPath, registry);
mkdirSync(deploymentRoot, { recursive: true });
const suffix = args.all || !courses.length ? "all" : courses.join("-");
const reportPath = join(deploymentRoot, `oss-index-${suffix}.json`);
const report = {
  status: "ready",
  dryRun,
  generatedAt: registry.generatedAt,
  bucket,
  cdnBaseUrl,
  objectPrefix,
  assetScope,
  registry: registryPath,
  indexed: indexed.length,
  courses: [...courseSummary.values()],
};
writeJson(reportPath, report);

console.log(JSON.stringify(report, null, 2));
