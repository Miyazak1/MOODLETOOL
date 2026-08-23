#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const roots = [
  resolve(workspaceRoot, "courseware", "BBI2O"),
  resolve(projectRoot, "deployment", "course-package-staging", "BBI2O"),
];
const publishListPath = resolve(projectRoot, "deployment", "bbi2o-video-publish-list.json");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function sha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function boxFound(path, marker) {
  return readFileSync(path).indexOf(marker) >= 0;
}

function collectResources(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectResources(item, result);
    return result;
  }
  if (!value || typeof value !== "object") return result;
  const path = typeof value.path === "string" ? toPosix(value.path) : "";
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  if (path && /\.(mp4|webm|mov|m4v)$/i.test(path)) result.push({ path, type, bytes: Number(value.bytes || 0) });
  for (const child of Object.values(value)) collectResources(child, result);
  return result;
}

function verifyRoot(root) {
  const manifestPath = join(root, "course-manifest.json");
  const manifest = readJson(manifestPath);
  const resources = collectResources(manifest);
  const failures = [];
  for (const item of resources) {
    const file = join(root, item.path);
    if (!existsSync(file)) {
      failures.push(`${item.path}: missing`);
      continue;
    }
    const stat = statSync(file);
    const ext = extname(file).toLowerCase();
    if (ext !== ".mp4") failures.push(`${item.path}: expected .mp4, got ${ext}`);
    if (item.type !== "mp4") failures.push(`${item.path}: manifest type is ${item.type}`);
    if (item.bytes && stat.size !== item.bytes) failures.push(`${item.path}: bytes ${stat.size} != manifest ${item.bytes}`);
    if (boxFound(file, "moof") || boxFound(file, "mfra")) failures.push(`${item.path}: fragmented MP4 markers remain`);
  }
  return {
    root,
    manifestPath,
    referencedVideos: resources.length,
    mp4: resources.filter((item) => extname(item.path).toLowerCase() === ".mp4").length,
    webm: resources.filter((item) => extname(item.path).toLowerCase() === ".webm").length,
    totalBytes: resources.reduce((sum, item) => sum + item.bytes, 0),
    failures,
  };
}

const publishList = readJson(publishListPath);
const rootResults = roots.map(verifyRoot);
const publishFailures = [];
const deltaRoot = resolve(projectRoot, "deployment", "bbi2o-video-remux-delta-20260822", "BBI2O");
for (const item of publishList.videos || []) {
  const file = join(deltaRoot, item.relativePath);
  if (!existsSync(file)) {
    publishFailures.push(`${item.relativePath}: missing from delta`);
    continue;
  }
  const stat = statSync(file);
  const hash = sha256(file);
  if (stat.size !== item.bytes) publishFailures.push(`${item.relativePath}: delta bytes ${stat.size} != list ${item.bytes}`);
  if (hash !== item.sha256) publishFailures.push(`${item.relativePath}: delta sha256 mismatch`);
}
for (const item of publishList.ecsFiles || []) {
  const file = join(deltaRoot, item.relativePath);
  if (!existsSync(file)) publishFailures.push(`${item.relativePath}: ECS delta file missing`);
}

const sourcePaths = new Set(collectResources(readJson(join(roots[0], "course-manifest.json"))).map((item) => item.path));
const listPaths = new Set((publishList.videos || []).map((item) => toPosix(item.relativePath)));
for (const path of sourcePaths) {
  if (!listPaths.has(path)) publishFailures.push(`${path}: referenced video missing from publish list`);
}
for (const path of listPaths) {
  if (!sourcePaths.has(path)) publishFailures.push(`${path}: publish list video not referenced by manifest`);
}

const report = {
  status: rootResults.every((item) => item.failures.length === 0) && publishFailures.length === 0 ? "ok" : "failed",
  rootResults,
  publishList: {
    path: publishListPath,
    videos: (publishList.videos || []).length,
    ecsFiles: (publishList.ecsFiles || []).length,
    failures: publishFailures,
  },
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== "ok") process.exit(1);
