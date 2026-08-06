import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".ecs-first-storage-smoke");
const course = "ZZZECSFIRST";
const coursewareRoot = join(smokeRoot, "courseware-active");
const courseRoot = join(coursewareRoot, course);
const reportPath = join(projectRoot, "deployment", `${course}-ecs-first-storage-report.json`);

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function writeFixture(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

assertInside(projectRoot, smokeRoot, "smoke root");
assertInside(projectRoot, reportPath, "smoke report");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
if (existsSync(reportPath)) rmSync(reportPath, { force: true });

try {
  mkdirSync(courseRoot, { recursive: true });
  writeFileSync(join(courseRoot, "course-manifest.json"), `${JSON.stringify({
    course,
    title: "ECS First Smoke",
    units: [{
      id: "unit-1",
      lessons: [{
        id: "lesson-1",
        downloads: [
          { label: "ordinary pdf", path: "docs/ordinary.pdf" },
          { label: "video", path: "media/lesson-video.mp4" },
          { label: "h5p", path: "activities/check.h5p" },
        ],
        ispring: [
          { label: "slides", path: "ispring-localized/unit-01/U01L01/presentation.html" },
        ],
      }],
    }],
  }, null, 2)}\n`, "utf8");
  writeFixture(join(courseRoot, "docs", "ordinary.pdf"), Buffer.from("%PDF-1.7\n"));
  writeFixture(join(courseRoot, "media", "lesson-video.mp4"), Buffer.alloc(128, 1));
  writeFixture(join(courseRoot, "activities", "check.h5p"), Buffer.alloc(64, 2));
  writeFixture(join(courseRoot, "ispring-localized", "unit-01", "U01L01", "presentation.html"), "<!doctype html><title>slides</title>");
  writeFixture(join(courseRoot, "ispring-localized", "unit-01", "U01L01", "data", "slides.js"), "console.log('slides');");

  const result = spawnSync("node", [
    "scripts/finalize-ecs-first-course-storage.mjs",
    "--course", course,
    "--courseware-root", coursewareRoot,
    "--bucket", "oss://moodletool",
    "--cdn-base-url", "https://cdn.example.com/courseware-active",
    "--ossutil", "fake-ossutil-for-dry-run",
    "--dry-run",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);

  const stdout = JSON.parse(result.stdout);
  assert.equal(stdout.ok, true);
  assert.equal(stdout.apply, false);
  assert.equal(stdout.publishCandidates, 4);
  assert.equal(stdout.failed, 0);
  assert.equal(stdout.rewrittenResources, 0);
  assert.equal(stdout.deletedLocalFiles, 0);

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const published = new Set(report.uploaded.map((item) => item.relativePath));
  assert.ok(published.has("media/lesson-video.mp4"));
  assert.ok(published.has("activities/check.h5p"));
  assert.ok(published.has("ispring-localized/unit-01/U01L01/presentation.html"));
  assert.ok(published.has("ispring-localized/unit-01/U01L01/data/slides.js"));
  assert.ok(!published.has("docs/ordinary.pdf"));
  assert.equal(existsSync(join(courseRoot, "media", "lesson-video.mp4")), true);

  console.log("ECS-first course storage smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output")) {
    if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
    if (existsSync(reportPath)) rmSync(reportPath, { force: true });
  }
}
