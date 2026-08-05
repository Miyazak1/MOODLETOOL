#!/usr/bin/env node
import { readdirSync, readFileSync, rmSync, mkdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const args = parseArgs(process.argv.slice(2));
const course = safeCourse(args.course);
if (!course) throw new Error("--course is required.");

const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const bucketUri = normalizeBucket(args.bucket || process.env.OSS_BUCKET_URI || "");
const bucketName = bucketUri.replace(/^oss:\/\//i, "").split("/")[0];
const objectPrefix = stripSlash(args.prefix || process.env.COURSEWARE_ASSET_PREFIX || "courseware-active");
const mockOssRoot = args.mockOssRoot ? resolve(args.mockOssRoot) : "";
const apply = Boolean(args.apply);

if (!bucketName) throw new Error("OSS_BUCKET_URI or --bucket is required.");

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--apply") out.apply = true;
    else if (arg === "--dry-run") out.apply = false;
    else if (arg.startsWith("--")) out[toCamel(arg.slice(2))] = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/cleanup-course-oss-stale-assets.mjs --course BOH4M --apply

Deletes OSS objects under COURSEWARE_ASSET_PREFIX/<COURSE>/ that are not referenced by the current asset registry.`);
}

function toCamel(value) {
  return String(value || "").replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function safeCourse(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").trim().toUpperCase();
}

function stripSlash(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function normalizeBucket(value) {
  const trimmed = stripSlash(value);
  return trimmed ? trimmed.replace(/^oss:\/(?!\/)/, "oss://") : "";
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
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

function courseObjectPrefix() {
  return `${objectPrefix}/${course}/`;
}

function isCourseObjectKey(key) {
  return String(key || "").startsWith(courseObjectPrefix());
}

function currentRegistryKeys() {
  const registry = readJson(registryPath, { assets: [], assetRecords: [] }) || {};
  const keys = new Set();
  for (const record of Array.isArray(registry.assetRecords) ? registry.assetRecords : []) {
    const key = String(record?.objectKey || "");
    if (!key) continue;
    if (String(record?.course || "").toUpperCase() === course || isCourseObjectKey(key)) keys.add(key);
  }
  for (const key of Array.isArray(registry.assets) ? registry.assets : []) {
    if (isCourseObjectKey(key)) keys.add(String(key));
  }
  return keys;
}

function walkMockObjects(root, base = root, out = []) {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkMockObjects(full, base, out);
    else if (entry.isFile()) out.push(toPosix(relative(base, full)));
  }
  return out;
}

async function createOssClient() {
  if (mockOssRoot) {
    const base = resolve(mockOssRoot, bucketName);
    return {
      async listPrefix(prefix) {
        return walkMockObjects(resolve(base, prefix), base).filter((key) => key.startsWith(prefix));
      },
      async delete(key) {
        rmSync(resolve(base, key), { force: true });
        return { res: { statusCode: 204 } };
      },
    };
  }
  const module = await import("ali-oss");
  const OSS = module.default || module;
  const client = new OSS({
    bucket: bucketName,
    secure: true,
    endpoint: process.env.OSS_DIRECT_UPLOAD_ENDPOINT || process.env.OSS_EXTRACT_ENDPOINT || "",
    accessKeyId: process.env.OSS_DIRECT_UPLOAD_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET || "",
    stsToken: process.env.OSS_DIRECT_UPLOAD_SECURITY_TOKEN || process.env.ALIBABA_CLOUD_SECURITY_TOKEN || undefined,
  });
  return {
    async listPrefix(prefix) {
      const keys = [];
      let marker = "";
      do {
        const result = await client.list({ prefix, marker, "max-keys": 1000 });
        for (const object of result.objects || []) {
          const key = object.name || object.key || "";
          if (key) keys.push(key);
        }
        marker = result.nextMarker || result.nextContinuationToken || "";
        if (!result.isTruncated && !marker) break;
      } while (marker);
      return keys;
    },
    async delete(key) {
      return client.delete(key);
    },
  };
}

const registryKeys = currentRegistryKeys();
const client = await createOssClient();
const listedObjects = await client.listPrefix(courseObjectPrefix());
const staleObjects = listedObjects.filter((key) => !registryKeys.has(key)).sort((a, b) => a.localeCompare(b));
const deleted = [];
const failed = [];

if (apply) {
  for (const objectKey of staleObjects) {
    try {
      await client.delete(objectKey);
      deleted.push({ objectKey, action: "deleted" });
    } catch (error) {
      failed.push({ objectKey, action: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const report = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  course,
  apply,
  bucket: bucketUri,
  objectPrefix,
  registryPath,
  summary: {
    registryObjects: registryKeys.size,
    listedObjects: listedObjects.length,
    staleObjects: staleObjects.length,
    deleted: deleted.length,
    failed: failed.length,
    staleBytes: mockOssRoot
      ? staleObjects.reduce((sum, key) => {
        try {
          return sum + statSync(resolve(mockOssRoot, bucketName, key)).size;
        } catch {
          return sum;
        }
      }, 0)
      : null,
  },
  staleObjects,
  deleted,
  failed,
};

mkdirSync(deploymentRoot, { recursive: true });
const reportPath = join(deploymentRoot, `${course}-oss-stale-cleanup-${apply ? "report" : "plan"}.json`);
writeJson(reportPath, report);
console.log(JSON.stringify({
  ok: report.ok,
  course,
  apply,
  registryObjects: report.summary.registryObjects,
  listedObjects: report.summary.listedObjects,
  staleObjects: report.summary.staleObjects,
  deleted: report.summary.deleted,
  failed: report.summary.failed,
  report: reportPath,
}, null, 2));

if (failed.length) process.exit(1);
