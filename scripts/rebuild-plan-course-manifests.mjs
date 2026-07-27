import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const requestedCourse = readArg("--course")?.toUpperCase();

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const courses = catalog.courses
  .filter((course) => course.code !== "ENG3U")
  .filter((course) => !requestedCourse || course.code === requestedCourse);

if (!courses.length) {
  console.error(requestedCourse ? `No plan-only course found for ${requestedCourse}` : "No plan-only courses found.");
  process.exit(1);
}

for (const course of courses) {
  const result = spawnSync("python", ["tools/build_plan_course_manifest.py", "--course", course.code], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`Failed to rebuild ${course.code}`);
    process.exit(result.status || 1);
  }
}

console.log(`Rebuilt plan-only manifests: ${courses.length}`);
