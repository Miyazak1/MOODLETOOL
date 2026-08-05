import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".ecs-first-overflow-smoke");
const sourceRoot = join(smokeRoot, "source");
const coursewareRoot = join(smokeRoot, "courseware-active");
const mockOssRoot = join(smokeRoot, "mock-oss");
const registryPath = join(smokeRoot, "asset-registry.json");
const course = "ZZZOVERFLOW";
const sourceCourseRoot = join(sourceRoot, course);
const zipPath = join(smokeRoot, `${course}.zip`);
const reportPath = join(projectRoot, "deployment", `${course}-ecs-first-overflow-import-report.json`);

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
assertInside(projectRoot, reportPath, "report path");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
if (existsSync(reportPath)) rmSync(reportPath, { force: true });
mkdirSync(sourceCourseRoot, { recursive: true });

try {
  writeFileSync(join(sourceCourseRoot, "course-manifest.json"), `${JSON.stringify({
    course,
    title: "Overflow Smoke",
    units: [{
      id: "unit-1",
      lessons: [{
        id: "lesson-1",
        downloads: [
          { label: "ordinary pdf", path: "docs/ordinary.pdf" },
          { label: "video", path: "media/lesson-video.mp4" },
        ],
        ispring: [
          { label: "slides", path: "localized-moodle-activities/resource/demo/html5-package/presentation.html", packagePath: "localized-moodle-activities/resource/demo/html5-package" },
        ],
      }],
    }],
  }, null, 2)}\n`, "utf8");
  writeFixture(join(sourceCourseRoot, "docs", "ordinary.pdf"), Buffer.from("%PDF-1.7\n"));
  writeFixture(join(sourceCourseRoot, "media", "lesson-video.mp4"), Buffer.alloc(128, 1));
  writeFixture(join(sourceCourseRoot, "localized-moodle-activities", "resource", "demo", "html5-package", "presentation.html"), "<!doctype html><title>slides</title>");
  writeFixture(join(sourceCourseRoot, "localized-moodle-activities", "resource", "demo", "html5-package", "data", "slides.js"), "console.log('slides');");
  writeFixture(join(coursewareRoot, course, "old-active", "stale.txt"), "stale");
  writeFixture(join(coursewareRoot, course, "_admin_uploads", "keep.txt"), "keep");

  const tar = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
  const zipResult = spawnSync(tar, ["-acf", zipPath, "-C", sourceRoot, course], { encoding: "utf8" });
  if (zipResult.status !== 0) throw new Error(zipResult.stderr || zipResult.stdout || "zip fixture failed");

  const result = spawnSync("node", [
    "scripts/import-ecs-first-overflow-package.mjs",
    "--course", course,
    "--import-id", "upl-overflow-smoke",
    "--source-zip", zipPath,
    "--mock-oss-root", mockOssRoot,
    "--mock-fail-once", "1",
    "--courseware-root", coursewareRoot,
    "--bucket", "oss://moodletool",
    "--cdn-base-url", "https://cdn.example.com/courseware-active",
    "--registry", registryPath,
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);

  const stdout = JSON.parse(result.stdout);
  assert.equal(stdout.ok, true);
  assert.equal(stdout.mode, "ecs-first-overflow");
  assert.equal(stdout.uploaded, 3);

  const targetCourseRoot = join(coursewareRoot, course);
  assert.equal(existsSync(join(targetCourseRoot, "docs", "ordinary.pdf")), true);
  assert.equal(existsSync(join(targetCourseRoot, "media", "lesson-video.mp4")), false);
  assert.equal(existsSync(join(targetCourseRoot, "old-active", "stale.txt")), false);
  assert.equal(existsSync(join(targetCourseRoot, "_admin_uploads", "keep.txt")), true);
  assert.equal(existsSync(join(targetCourseRoot, "_admin_uploads", "overflow-staging", "upl-overflow-smoke", "previous-active")), false);
  assert.equal(existsSync(join(mockOssRoot, "moodletool", "courseware-active", course, "media", "lesson-video.mp4")), true);
  assert.equal(existsSync(join(mockOssRoot, "moodletool", "courseware-active", course, "localized-moodle-activities", "resource", "demo", "html5-package", "presentation.html")), true);

  const manifest = JSON.parse(readFileSync(join(targetCourseRoot, "course-manifest.json"), "utf8"));
  const lesson = manifest.units[0].lessons[0];
  assert.equal(lesson.downloads[0].path, "docs/ordinary.pdf");
  assert.match(lesson.downloads[1].url, /^https:\/\/cdn\.example\.com\/courseware-active\/ZZZOVERFLOW\/media\/lesson-video\.mp4$/);
  assert.equal(lesson.downloads[1].path, undefined);
  assert.match(lesson.ispring[0].url, /presentation\.html$/);
  assert.equal(lesson.ispring[0].packagePath, undefined);
  assert.equal(manifest.sourceAudit.importMode, "ecs-first-overflow");

  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  assert.equal(registry.assetRecords.length, 3);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.ok(report.uploaded.some((item) => item.relativePath === "media/lesson-video.mp4" && item.attempts === 2));
  assert.equal(report.summary.activeSwitch.rollback, "restored-on-switch-failure");

  console.log("ECS-first overflow package smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
  if (!process.argv.includes("--keep-output") && existsSync(reportPath)) {
    rmSync(reportPath, { force: true });
  }
}
