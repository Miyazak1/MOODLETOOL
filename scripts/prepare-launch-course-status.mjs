import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const catalogPath = resolve(projectRoot, readArg("--catalog", "public/course-catalog.json"));
const outPath = resolve(projectRoot, readArg("--out", "deployment/launch-course-status.json"));
const launchCourses = parseCourses(readArg("--courses", ""));
const actor = readArg("--actor", "prepare-launch-course-status");
const force = process.argv.includes("--force");

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function parseCourses(value) {
  return String(value || "")
    .split(",")
    .map(safeCourse)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function readCatalog() {
  if (!existsSync(catalogPath)) throw new Error(`Catalog not found: ${catalogPath}`);
  const parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (!Array.isArray(parsed.courses)) throw new Error("Course catalog must contain a courses array.");
  return parsed;
}

if (!launchCourses.length) {
  console.error("Missing --courses COURSE1,COURSE2. Example: --courses ENG3U,ESLEO");
  process.exit(1);
}
if (existsSync(outPath) && !force) {
  console.error(`Refusing to overwrite existing launch status file: ${outPath}`);
  console.error("Pass --force only after confirming the old file is no longer needed.");
  process.exit(1);
}

try {
  const catalog = readCatalog();
  const catalogCourses = unique((catalog.courses || []).map((course) => safeCourse(course.code)).filter(Boolean));
  const catalogSet = new Set(catalogCourses);
  const unknown = unique(launchCourses).filter((course) => !catalogSet.has(course));
  if (unknown.length) {
    console.error(`Launch course(s) are not in the catalog: ${unknown.join(", ")}`);
    process.exit(2);
  }

  const now = new Date().toISOString();
  const launchSet = new Set(unique(launchCourses));
  const courses = {};
  for (const course of catalogCourses) {
    const active = launchSet.has(course);
    courses[course] = {
      status: active ? "active" : "archived",
      updatedAt: now,
      updatedBy: actor,
      note: active
        ? "Initial launch course; visible to assigned teachers."
        : "Hidden from the first deployment until this course is completed and activated.",
    };
  }

  const statusFile = {
    schemaVersion: 1,
    updatedAt: now,
    generatedAt: now,
    mode: "launch-course-allowlist",
    launchCourses: unique(launchCourses),
    catalogCourseCount: catalogCourses.length,
    activeCourseCount: launchSet.size,
    archivedCourseCount: catalogCourses.length - launchSet.size,
    courses,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(statusFile, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        catalogPath,
        launchCourses: statusFile.launchCourses,
        catalogCourseCount: statusFile.catalogCourseCount,
        activeCourseCount: statusFile.activeCourseCount,
        archivedCourseCount: statusFile.archivedCourseCount,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
