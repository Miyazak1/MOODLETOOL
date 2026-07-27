import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const publicRoot = join(projectRoot, "public");
const courseIndexPath = join(deploymentRoot, "moodle-course-resource-index.csv");
const lessonSummaryPath = join(deploymentRoot, "moodle-lesson-title-summary.csv");
const publicIndexPath = join(publicRoot, "moodle-course-resource-index.json");

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function readCsv(path) {
  if (!existsSync(path)) {
    console.error(`Missing CSV: ${path}`);
    process.exit(1);
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function numberOrUndefined(value) {
  if (value === "" || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberArray(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function colonNumberMap(value) {
  const entries = String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [key, rawCount] = item.split(":");
      const id = Number(key);
      const count = Number(rawCount);
      return Number.isFinite(id) && Number.isFinite(count) ? [id, count] : null;
    })
    .filter(Boolean);
  return new Map(entries);
}

const courseRows = readCsv(courseIndexPath);
const lessonRows = readCsv(lessonSummaryPath);
const lessonByCourse = new Map(lessonRows.map((row) => [row.course, row]));

const courses = courseRows.map((row) => {
  const lessonRow = lessonByCourse.get(row.course) || {};
  const bookIds = numberArray(row.bookIds);
  const chapterCounts = colonNumberMap(row.bookChapterLinkCounts);
  const lessonCounts = colonNumberMap(lessonRow.bookLessonCounts);
  const item = {
    course: row.course,
    moodleCourseId: numberOrUndefined(row.moodleCourseId),
    coursePage: row.coursePage,
    outlineStatus: row.outlineStatus || "needs-url",
    outlineUrl: row.outlineUrl || undefined,
    bookCount: numberOrUndefined(row.bookCount) || 0,
    bookIds,
    books: bookIds.map((bookId) => ({
      id: bookId,
      url: `https://www.esunnybrook.com/mod/book/view.php?id=${bookId}`,
      chapterLinkCount: chapterCounts.get(bookId) ?? 0,
      numberedLessonCount: lessonCounts.get(bookId) ?? 0,
    })),
    numberedLessonCount: numberOrUndefined(lessonRow.numberedLessonCount) || 0,
    notes: row.notes || lessonRow.notes || "",
  };
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: "Generated from deployment/moodle-course-resource-index.csv and deployment/moodle-lesson-title-summary.csv",
  totals: {
    courses: courses.length,
    readyOutlines: courses.filter((course) => course.outlineStatus === "ready").length,
    needsUrl: courses.filter((course) => course.outlineStatus === "needs-url").length,
    lessonBooks: courses.reduce((sum, course) => sum + course.bookCount, 0),
    numberedLessons: courses.reduce((sum, course) => sum + course.numberedLessonCount, 0),
  },
  courses,
};

writeFileSync(publicIndexPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${publicIndexPath}`);
console.log(
  `Moodle courses ${report.totals.courses}; ready outlines ${report.totals.readyOutlines}; needs-url ${report.totals.needsUrl}; books ${report.totals.lessonBooks}; lessons ${report.totals.numberedLessons}`,
);
