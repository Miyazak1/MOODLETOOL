import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const moodleIndexPath = join(projectRoot, "public", "moodle-course-resource-index.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const outputJsonPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const outputCsvPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.csv");

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`Missing JSON: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function manifestForCourse(course) {
  const path = join(workspaceRoot, "courseware", course, "course-manifest.json");
  if (!existsSync(path)) return null;
  return readJson(path);
}

function lessonStats(manifest) {
  const lessons = (manifest?.units || []).flatMap((unit) => unit.lessons || []);
  const bookSectionLessons = lessons.filter((lesson) => (lesson.bookSections || []).length > 0).length;
  const bookSections = lessons.reduce((sum, lesson) => sum + (lesson.bookSections || []).length, 0);
  return {
    manifestLessons: lessons.length,
    bookSectionLessons,
    bookSections,
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

const moodleIndex = readJson(moodleIndexPath);
const catalog = readJson(catalogPath);
const catalogByCourse = new Map((catalog.courses || []).map((course) => [course.code, course]));
const courses = [];

for (const moodle of moodleIndex.courses || []) {
  const numberedLessonCount = Number(moodle.numberedLessonCount || 0);
  if (!numberedLessonCount) continue;

  const manifest = manifestForCourse(moodle.course);
  const stats = lessonStats(manifest);
  const expectedLessons = Math.max(numberedLessonCount, stats.manifestLessons || 0);
  const missingLessonSections = Math.max(0, expectedLessons - stats.bookSectionLessons);
  if (!missingLessonSections) continue;

  const catalogRow = catalogByCourse.get(moodle.course) || {};
  const partiallyLocalized = stats.bookSectionLessons > 0;
  const priority = (partiallyLocalized ? 300 : 200) + missingLessonSections;
  const bookIds = (moodle.books || []).map((book) => book.id).filter(Boolean);

  courses.push({
    priority,
    course: moodle.course,
    title: catalogRow.title || moodle.course,
    status: "login-required",
    category: "moodle-book",
    moodleCourseId: moodle.moodleCourseId || null,
    coursePage: moodle.coursePage || "",
    bookCount: Number(moodle.bookCount || 0),
    bookIds,
    numberedLessonCount,
    manifestLessons: stats.manifestLessons,
    localBookSectionLessons: stats.bookSectionLessons,
    localBookSections: stats.bookSections,
    missingLessonSections,
    reason: partiallyLocalized
      ? `Partial local Moodle Book import: ${stats.bookSectionLessons}/${expectedLessons} lessons have book sections. Continue this course before starting a new one.`
      : `Moodle Book lessons detected (${numberedLessonCount}), but no local book-section import is present yet.`,
  });
}

courses.sort((a, b) => b.priority - a.priority || a.course.localeCompare(b.course));

const report = {
  generatedAt: new Date().toISOString(),
  status: "login-required",
  purpose:
    "Authenticated Moodle re-scan queue for courses with real Moodle Book lesson structures that are not fully localized into courseware yet.",
  totals: {
    courses: courses.length,
    partialCourses: courses.filter((course) => course.localBookSectionLessons > 0).length,
    missingLessonSections: courses.reduce((sum, course) => sum + course.missingLessonSections, 0),
  },
  courses,
  notes:
    "Generated from public/moodle-course-resource-index.json plus local course manifests. Run after Moodle index/readiness changes.",
};

const headers = [
  "priority",
  "course",
  "status",
  "category",
  "moodleCourseId",
  "coursePage",
  "bookCount",
  "bookIds",
  "numberedLessonCount",
  "manifestLessons",
  "localBookSectionLessons",
  "missingLessonSections",
  "reason",
];
const csvRows = [
  headers.join(","),
  ...courses.map((course) =>
    headers
      .map((header) => {
        const value = header === "bookIds" ? course.bookIds.join(";") : course[header];
        return csvEscape(value);
      })
      .join(","),
  ),
];

writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(outputCsvPath, `${csvRows.join("\n")}\n`, "utf8");
console.log(`Wrote ${outputJsonPath}`);
console.log(`Wrote ${outputCsvPath}`);
console.log(
  `Authenticated rescan queue: ${report.totals.courses} courses; ${report.totals.partialCourses} partial; ${report.totals.missingLessonSections} missing lesson-section sets.`,
);
