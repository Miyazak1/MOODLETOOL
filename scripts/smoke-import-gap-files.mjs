import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const workspaceRoot = resolve(projectRoot, "..");
const smokeCourse = "ZZZSMOKE";
const smokeCourseRoot = resolve(workspaceRoot, "courseware", smokeCourse);
const smokeRoot = resolve(projectRoot, "inbox", "upload-gaps-smoke");
const collectionBase = resolve(projectRoot, "inbox", "collection-gap-smoke");
const collectionRoot = resolve(collectionBase, "direct-uploads");
const checklistPath = resolve(smokeRoot, "upload-gap-checklist.json");

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
  await rm(smokeRoot, { recursive: true, force: true });
  await rm(collectionBase, { recursive: true, force: true });
  await mkdir(smokeRoot, { recursive: true });
  await mkdir(resolve(collectionRoot, smokeCourse), { recursive: true });
  await writeFile(resolve(collectionRoot, smokeCourse, "ZZZSMOKE_Course_Outline.md"), "# Smoke Course Outline\n", "utf8");
  await writeFile(resolve(collectionRoot, smokeCourse, "ZZZSMOKE_U01_Unit_Plan.md"), "# Smoke Unit Plan\n", "utf8");
  await writeFile(resolve(collectionRoot, smokeCourse, "ZZZSMOKE_U01_L01_Lesson_Plan.md"), "# Smoke Lesson Plan\n", "utf8");
  await writeFile(
    checklistPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        uploadItems: [
          {
            course: smokeCourse,
            title: "Smoke Course",
            uploadType: "course-outline",
            unit: null,
            lesson: null,
            suggestedFilename: "ZZZSMOKE_Course_Outline.docx",
          },
          {
            course: smokeCourse,
            title: "Smoke Course",
            uploadType: "unit-plan",
            unit: 1,
            lesson: null,
            suggestedFilename: "ZZZSMOKE_U01_Unit_Plan.docx",
          },
          {
            course: smokeCourse,
            title: "Smoke Course",
            uploadType: "lesson-plan",
            unit: 1,
            lesson: 1,
            suggestedFilename: "ZZZSMOKE_U01_L01_Lesson_Plan.docx",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  run("python", [
    "tools/import_upload_gap_files.py",
    "--checklist",
    checklistPath,
    "--inbox",
    smokeRoot,
    "--collection-inbox",
    collectionRoot,
    "--rebuild-manifest",
  ]);
  run("node", ["scripts/validate-manifest.mjs", "--course", smokeCourse]);
} finally {
  await rm(smokeCourseRoot, { recursive: true, force: true });
  await rm(smokeRoot, { recursive: true, force: true });
  await rm(collectionBase, { recursive: true, force: true });
}

console.log("Upload gap file import smoke passed.");
