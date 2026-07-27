import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const workspaceRoot = resolve(projectRoot, "..");
const smokeCourse = "ZZZSMOKE";
const smokeCourseRoot = resolve(workspaceRoot, "courseware", smokeCourse);
const inboxRoot = resolve(projectRoot, "inbox", smokeCourse);

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
  await rm(inboxRoot, { recursive: true, force: true });
  await mkdir(inboxRoot, { recursive: true });
  await writeFile(resolve(inboxRoot, "ZZZSMOKE Course Outline.md"), "# Smoke Course Outline\n", "utf8");
  await writeFile(resolve(inboxRoot, "Unit 1 Plan.md"), "# Smoke Unit Plan\n", "utf8");
  await writeFile(resolve(inboxRoot, "Unit 1 Lesson 1 Plan.md"), "# Smoke Lesson Plan\n", "utf8");

  run("python", ["tools/import_teacher_documents.py", "--course", smokeCourse, "--rebuild-manifest"]);
  run("node", ["scripts/validate-manifest.mjs", "--course", smokeCourse]);
} finally {
  await rm(smokeCourseRoot, { recursive: true, force: true });
  await rm(inboxRoot, { recursive: true, force: true });
}

console.log("Teacher document import smoke passed.");
