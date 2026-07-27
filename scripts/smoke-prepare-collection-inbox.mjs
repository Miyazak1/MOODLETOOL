import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outbox = join(projectRoot, "inbox", "collection-smoke");

rmSync(outbox, { recursive: true, force: true });
mkdirSync(join(outbox, "direct-uploads", "STALE101"), { recursive: true });
writeFileSync(join(outbox, "direct-uploads", "STALE101", "README.md"), "old stale task\n", "utf8");

const result = spawnSync(
  "node",
  ["scripts/prepare-collection-inbox.mjs", "--outbox", outbox],
  {
    cwd: projectRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  },
);

if (result.status !== 0) {
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  process.exit(result.status || 1);
}

const required = [
  join(outbox, "README.md"),
  join(outbox, "STALE_DIRECTORIES.md"),
  join(outbox, "collection-inbox-summary.json"),
  join(outbox, "text-review", "ENG3U", "README.md"),
  join(outbox, "ispring-batches", "ESLDO", "README.md"),
  join(outbox, "ispring-batches", "ESLDO", "lesson-zip-filenames.txt"),
];

for (const path of required) {
  if (!existsSync(path)) {
    console.error(`Missing generated collection inbox file: ${path}`);
    process.exitCode = 1;
  }
}

const summary = JSON.parse(readFileSync(join(outbox, "collection-inbox-summary.json"), "utf8"));
const directUploadCourse = summary.courses?.find((course) => course.directUploads > 0);
if (!directUploadCourse) {
  console.error(`No direct upload course found in collection summary: ${JSON.stringify(summary, null, 2)}`);
  process.exitCode = 1;
} else if (!existsSync(join(outbox, "direct-uploads", directUploadCourse.course, "README.md"))) {
  console.error(`Missing generated direct upload README for ${directUploadCourse.course}`);
  process.exitCode = 1;
}
if (!summary.courses?.some((course) => course.course === "ENG3U" && course.directUploads === 0 && course.textReviews === 4)) {
  console.error(`Unexpected ENG3U collection summary: ${JSON.stringify(summary, null, 2)}`);
  process.exitCode = 1;
}
if (!summary.courses?.some((course) => course.course === "ESLDO" && course.lessonZipNames?.includes("ESLDO_U01_L01.zip"))) {
  console.error(`Unexpected ESLDO iSpring collection summary: ${JSON.stringify(summary, null, 2)}`);
  process.exitCode = 1;
}
if (!summary.staleFolders?.some((item) => item.category === "direct-uploads" && item.course === "STALE101")) {
  console.error(`Unexpected stale folder summary: ${JSON.stringify(summary, null, 2)}`);
  process.exitCode = 1;
}
const staleReadme = readFileSync(join(outbox, "direct-uploads", "STALE101", "README.md"), "utf8");
if (!staleReadme.includes("Stale Collection Folder")) {
  console.error(`Stale README was not updated: ${staleReadme}`);
  process.exitCode = 1;
}

rmSync(outbox, { recursive: true, force: true });

if (process.exitCode) process.exit(process.exitCode);
console.log("Prepare collection inbox smoke passed.");
