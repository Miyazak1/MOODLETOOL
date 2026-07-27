import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const workspaceRoot = resolve(projectRoot, "..");
const smokeCourse = "ZZZSMOKE";
const smokeCourseRoot = resolve(workspaceRoot, "courseware", smokeCourse);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

try {
  await rm(smokeCourseRoot, { recursive: true, force: true });
  await mkdir(resolve(smokeCourseRoot, "plans", "lesson-plans"), { recursive: true });
  await mkdir(resolve(smokeCourseRoot, "plans", "unit-plans"), { recursive: true });
  await mkdir(resolve(smokeCourseRoot, "lessons", "U01L01", "html5-package-admin", "data"), { recursive: true });
  await writeFile(resolve(smokeCourseRoot, "plans", "unit-plans", "U01_Unit_Plan.md"), "# Smoke Unit Plan\n", "utf8");
  await writeFile(resolve(smokeCourseRoot, "plans", "lesson-plans", "U01_L01_Lesson_Plan.md"), "# Smoke Lesson Plan\n", "utf8");
  await writeFile(
    resolve(smokeCourseRoot, "lessons", "U01L01", "html5-package-admin", "presentation.html"),
    "<!doctype html><title>Smoke iSpring</title>",
    "utf8",
  );
  await writeFile(resolve(smokeCourseRoot, "lessons", "U01L01", "html5-package-admin", "data", "slide1.js"), "", "utf8");
  await writeFile(resolve(smokeCourseRoot, "lessons", "U01L01", "html5-package-admin", "data", "video1.mp4"), "video", "utf8");

  run("python", ["tools/build_plan_course_manifest.py", "--course", smokeCourse]);
  run("node", ["scripts/validate-manifest.mjs", "--course", smokeCourse]);

  const manifest = JSON.parse(await readFile(resolve(smokeCourseRoot, "course-manifest.json"), "utf8"));
  const lesson = manifest.units?.[0]?.lessons?.[0];
  if (lesson?.path !== "lessons/U01L01" || lesson?.ispring?.length !== 1) {
    console.error(`Unexpected plan iSpring manifest: ${JSON.stringify(lesson)}`);
    process.exitCode = 1;
  }
  if (lesson?.ispring?.[0]?.path !== "lessons/U01L01/html5-package-admin/presentation.html") {
    console.error(`Unexpected iSpring path: ${JSON.stringify(lesson?.ispring?.[0])}`);
    process.exitCode = 1;
  }
} finally {
  await rm(smokeCourseRoot, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
console.log("Plan-only iSpring smoke passed.");
