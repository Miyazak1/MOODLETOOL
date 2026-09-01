#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const args = parseArgs(process.argv.slice(2));
const uploadsRoot = resolve(args.uploadsRoot || process.env.OSS_UPLOADS_DATA_ROOT || join(projectRoot, "data", "oss-uploads"));
const bucket = normalizeBucket(args.bucket || process.env.OSS_BUCKET_URI || "");
const ossutilPath = args.ossutil || process.env.OSSUTIL_PATH || "ossutil";
const successRetentionDays = Math.max(1, Number(args.successDays || process.env.OSS_RAW_ZIP_RETENTION_DAYS || 7));
const failedRetentionDays = Math.max(1, Number(args.failedDays || process.env.OSS_FAILED_ZIP_RETENTION_DAYS || 30));
const dryRun = !args.apply;

function parseArgs(argv) {
  const out = {
    apply: false,
    bucket: "",
    failedDays: "",
    ossutil: "",
    successDays: "",
    uploadsRoot: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--apply") out.apply = true;
    else if (arg === "--dry-run") out.apply = false;
    else if (arg === "--bucket") out.bucket = argv[++i] || "";
    else if (arg === "--failed-days") out.failedDays = argv[++i] || "";
    else if (arg === "--ossutil") out.ossutil = argv[++i] || "";
    else if (arg === "--success-days") out.successDays = argv[++i] || "";
    else if (arg === "--uploads-root") out.uploadsRoot = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/cleanup-hybrid-course-storage.mjs --dry-run
  node scripts/cleanup-hybrid-course-storage.mjs --apply --bucket oss://moodletool

Plans cleanup for course package OSS inbox ZIPs, import manifests, and lightweight staging objects from local upload records.`);
}

function normalizeBucket(value) {
  const trimmed = String(value || "").replace(/\/+$/, "");
  return trimmed ? trimmed.replace(/^oss:\/(?!\/)/, "oss://") : "";
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function cutoffDate(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function recordTime(record) {
  const value = record.importedAt || record.extractedAt || record.completedAt || record.requestedAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function isSuccessRecord(record) {
  return record.status === "imported" || ["indexed", "indexed-with-warnings", "no-media"].includes(record.importStatus);
}

function isFailedRecord(record) {
  return record.status === "failed" || record.importStatus === "failed" || String(record.importStatus || "").startsWith("oss-index-failed");
}

function objectUri(objectKey) {
  return bucket && objectKey ? `${bucket}/${objectKey}` : "";
}

function addObject(plan, record, objectKey, reason) {
  const uri = objectUri(objectKey);
  if (!uri) return;
  plan.objects.push({
    course: record.course || "",
    uploadId: record.id,
    objectKey,
    reason,
    uri,
  });
}

function planRecordCleanup(record) {
  if (record.kind !== "course-package") return null;
  const time = recordTime(record);
  if (!time) return null;
  const success = isSuccessRecord(record);
  const failed = isFailedRecord(record);
  if (!success && !failed) return null;
  const retentionDays = success ? successRetentionDays : failedRetentionDays;
  if (time > cutoffDate(retentionDays)) return null;
  const plan = {
    course: record.course || "",
    uploadId: record.id,
    retentionDays,
    status: record.importStatus || record.status,
    objects: [],
  };
  addObject(plan, record, record.objectKey, success ? "successful-upload-retention-expired" : "failed-upload-retention-expired");
  const summary = record.latestImportSummary || {};
  addObject(plan, record, summary.manifestObjectKey || "", "import-manifest-retention-expired");
  if (record.course && record.id) {
    addObject(plan, record, `inbox/lightweight/${record.course}/${record.id}/`, "lightweight-staging-retention-expired");
  }
  return plan.objects.length ? plan : null;
}

function readUploadRecords() {
  if (!existsSync(uploadsRoot)) return [];
  const records = [];
  for (const entry of readdirSync(uploadsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(uploadsRoot, entry.name, "upload.json");
    const record = readJson(path);
    if (record?.id) records.push(record);
  }
  return records;
}

function removeObject(uri) {
  const result = spawnSync(ossutilPath, ["rm", uri, "-r", "-f"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `ossutil exited ${result.status}`).trim());
  return (result.stdout || result.stderr || "").trim();
}

const records = readUploadRecords();
const plans = records.map(planRecordCleanup).filter(Boolean);
const report = {
  status: dryRun ? "planned" : "applied",
  dryRun,
  generatedAt: new Date().toISOString(),
  uploadsRoot,
  bucket,
  successRetentionDays,
  failedRetentionDays,
  recordsScanned: records.length,
  recordsMatched: plans.length,
  objects: plans.flatMap((plan) => plan.objects),
  applied: [],
  failures: [],
};

if (!dryRun && !bucket) throw new Error("--bucket or OSS_BUCKET_URI is required with --apply.");
if (!dryRun) {
  for (const item of report.objects) {
    try {
      report.applied.push({ ...item, output: removeObject(item.uri) });
    } catch (error) {
      report.failures.push({ ...item, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (report.failures.length) report.status = "partial";
}

await mkdir(deploymentRoot, { recursive: true });
const reportPath = join(deploymentRoot, `hybrid-storage-cleanup-${dryRun ? "plan" : "report"}.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: report.status, dryRun, recordsMatched: report.recordsMatched, objects: report.objects.length, failures: report.failures.length, report: reportPath }, null, 2));
