import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".oss-stale-cleanup-smoke");
const mockOssRoot = join(smokeRoot, "mock-oss");
const registryPath = join(smokeRoot, "asset-registry.json");
const course = "ZZZCLEAN";
const bucketRoot = join(mockOssRoot, "moodletool");

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function writeFixture(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function runCleanup(apply = false) {
  return spawnSync("node", [
    "scripts/cleanup-course-oss-stale-assets.mjs",
    "--course", course,
    "--bucket", "oss://moodletool",
    "--prefix", "courseware-active",
    "--registry", registryPath,
    "--mock-oss-root", mockOssRoot,
    apply ? "--apply" : "--dry-run",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

assertInside(projectRoot, smokeRoot, "smoke root");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });

try {
  writeFixture(join(bucketRoot, "courseware-active", course, "media", "current.mp4"), "current");
  writeFixture(join(bucketRoot, "courseware-active", course, "media", "old.mp4"), "old");
  writeFixture(join(bucketRoot, "courseware-active", course, "ispring", "old", "presentation.html"), "old slides");
  writeFixture(join(bucketRoot, "courseware-active", "OTHER", "media", "old.mp4"), "other");
  writeFixture(registryPath, `${JSON.stringify({
    assetRecords: [
      {
        course,
        objectKey: `courseware-active/${course}/media/current.mp4`,
      },
      {
        course: "OTHER",
        objectKey: "courseware-active/OTHER/media/old.mp4",
      },
    ],
  }, null, 2)}\n`);

  const dryRun = runCleanup(false);
  if (dryRun.status !== 0) throw new Error(dryRun.stderr || dryRun.stdout);
  const dryRunOut = JSON.parse(dryRun.stdout);
  assert.equal(dryRunOut.staleObjects, 2);
  assert.equal(dryRunOut.deleted, 0);
  assert.equal(existsSync(join(bucketRoot, "courseware-active", course, "media", "old.mp4")), true);

  const apply = runCleanup(true);
  if (apply.status !== 0) throw new Error(apply.stderr || apply.stdout);
  const applyOut = JSON.parse(apply.stdout);
  assert.equal(applyOut.staleObjects, 2);
  assert.equal(applyOut.deleted, 2);
  assert.equal(existsSync(join(bucketRoot, "courseware-active", course, "media", "current.mp4")), true);
  assert.equal(existsSync(join(bucketRoot, "courseware-active", course, "media", "old.mp4")), false);
  assert.equal(existsSync(join(bucketRoot, "courseware-active", course, "ispring", "old", "presentation.html")), false);
  assert.equal(existsSync(join(bucketRoot, "courseware-active", "OTHER", "media", "old.mp4")), true);

  const report = JSON.parse(readFileSync(join(projectRoot, "deployment", `${course}-oss-stale-cleanup-report.json`), "utf8"));
  assert.equal(report.summary.deleted, 2);

  console.log("OSS stale cleanup smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
  for (const suffix of ["plan", "report"]) {
    const report = join(projectRoot, "deployment", `${course}-oss-stale-cleanup-${suffix}.json`);
    if (!process.argv.includes("--keep-output") && existsSync(report)) rmSync(report, { force: true });
  }
}
