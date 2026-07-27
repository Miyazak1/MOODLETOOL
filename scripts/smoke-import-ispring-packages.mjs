import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const workspaceRoot = resolve(projectRoot, "..");
const smokeCourse = "ZZZSMOKE";
const smokeCourseRoot = resolve(workspaceRoot, "courseware", smokeCourse);
const inboxRoot = resolve(projectRoot, "inbox", "ispring-smoke");
const collectionBase = resolve(projectRoot, "inbox", "collection-ispring-smoke");
const collectionRoot = resolve(collectionBase, "ispring-batches");
const packageRoot = resolve(inboxRoot, "_package");
const zipPath = resolve(collectionRoot, smokeCourse, "ZZZSMOKE_U01_L01.zip");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function zipPackage() {
  if (process.platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -Path '${packageRoot.replaceAll("'", "''")}\\*' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`,
    ]);
  } else {
    run("zip", ["-qr", zipPath, "."], { cwd: packageRoot });
  }
}

try {
  await rm(smokeCourseRoot, { recursive: true, force: true });
  await rm(inboxRoot, { recursive: true, force: true });
  await rm(collectionBase, { recursive: true, force: true });
  await mkdir(resolve(smokeCourseRoot, "plans", "unit-plans"), { recursive: true });
  await mkdir(resolve(smokeCourseRoot, "plans", "lesson-plans"), { recursive: true });
  await mkdir(resolve(collectionRoot, smokeCourse), { recursive: true });
  await mkdir(resolve(packageRoot, "data"), { recursive: true });
  await writeFile(resolve(smokeCourseRoot, "plans", "unit-plans", "U01_Unit_Plan.md"), "# Smoke Unit Plan\n", "utf8");
  await writeFile(resolve(smokeCourseRoot, "plans", "lesson-plans", "U01_L01_Lesson_Plan.md"), "# Smoke Lesson Plan\n", "utf8");
  await writeFile(resolve(packageRoot, "presentation.html"), "<!doctype html><title>Smoke iSpring</title>", "utf8");
  await writeFile(resolve(packageRoot, "lms.js"), "", "utf8");
  await writeFile(resolve(packageRoot, "data", "slide1.js"), "", "utf8");
  await writeFile(resolve(packageRoot, "data", "video1.mp4"), "video", "utf8");
  zipPackage();

  run("python", ["tools/build_plan_course_manifest.py", "--course", smokeCourse]);
  run("python", ["tools/import_ispring_packages.py", "--course", smokeCourse, "--inbox", inboxRoot, "--collection-inbox", collectionRoot]);
  run("node", ["scripts/validate-manifest.mjs", "--course", smokeCourse]);

  const manifest = JSON.parse(await readFile(resolve(smokeCourseRoot, "course-manifest.json"), "utf8"));
  const lesson = manifest.units?.[0]?.lessons?.[0];
  if (lesson?.ispring?.length !== 1 || lesson.ispring[0].slideCount !== 1 || lesson.ispring[0].videoSegmentCount !== 1) {
    console.error(`Unexpected imported iSpring manifest: ${JSON.stringify(lesson)}`);
    process.exitCode = 1;
  }
} finally {
  await rm(smokeCourseRoot, { recursive: true, force: true });
  await rm(inboxRoot, { recursive: true, force: true });
  await rm(collectionBase, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
console.log("iSpring package batch import smoke passed.");
