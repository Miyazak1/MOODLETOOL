import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = resolve(projectRoot, "inbox", "course-lifecycle-smoke");
const activeRoot = resolve(smokeRoot, "active");
const archiveRoot = resolve(smokeRoot, "archive");
const course = "ZZZLIFE";
const courseRoot = resolve(activeRoot, course);

function run(args) {
  const result = spawnSync("node", args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function prepareCourse() {
  rmSync(smokeRoot, { recursive: true, force: true });
  mkdirSync(join(courseRoot, "Unit 1", "Lesson 1", "html5-package", "data"), { recursive: true });
  writeFileSync(
    join(courseRoot, "course-manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, course: { code: course, title: "Lifecycle Smoke" }, units: [] }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(courseRoot, "Unit 1", "Lesson 1", "html5-package", "presentation.html"), "<!doctype html>", "utf8");
  writeFileSync(join(courseRoot, "Unit 1", "Lesson 1", "html5-package", "data", "video1.mp4"), "video", "utf8");
}

try {
  prepareCourse();
  const archived = run([
    "scripts/archive-course.mjs",
    "--course",
    course,
    "--source-root",
    activeRoot,
    "--archive-root",
    archiveRoot,
    "--delete-active",
  ]);
  if (!archived.ok || !archived.deletedActive || !archived.archive?.hasManifest || !existsSync(archived.archivePath) || existsSync(courseRoot)) {
    throw new Error(`Unexpected archive payload: ${JSON.stringify(archived, null, 2)}`);
  }

  const activated = run([
    "scripts/activate-course.mjs",
    "--course",
    course,
    "--archive",
    archived.archivePath,
    "--target-root",
    activeRoot,
  ]);
  if (!activated.ok || !activated.restored || !existsSync(join(courseRoot, "course-manifest.json"))) {
    throw new Error(`Unexpected activate payload: ${JSON.stringify(activated, null, 2)}`);
  }
  const manifest = JSON.parse(readFileSync(join(courseRoot, "course-manifest.json"), "utf8"));
  if (manifest.course?.code !== course) {
    throw new Error(`Restored manifest mismatch: ${JSON.stringify(manifest)}`);
  }
  console.log("Course lifecycle smoke passed.");
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
