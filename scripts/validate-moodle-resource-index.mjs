import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const publicRoot = join(projectRoot, "public");
const courseIndexPath = join(deploymentRoot, "moodle-course-resource-index.csv");
const lessonSummaryPath = join(deploymentRoot, "moodle-lesson-title-summary.csv");
const publicIndexPath = join(publicRoot, "moodle-course-resource-index.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path) {
  if (!existsSync(path)) fail(`Missing JSON: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

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
  if (!existsSync(path)) fail(`Missing CSV: ${path}`);
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function splitSemicolonNumbers(value) {
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(Number);
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

const csvRows = readCsv(courseIndexPath);
const lessonRows = readCsv(lessonSummaryPath);
const publicIndex = readJson(publicIndexPath);
const lessonByCourse = new Map(lessonRows.map((row) => [row.course, row]));
const publicByCourse = new Map((publicIndex.courses || []).map((row) => [row.course, row]));
const errors = [];

function allowsZeroNumberedLessons(row, lessonRow) {
  if (Number(row.bookCount || 0) === 0) return true;
  const notes = `${row.notes || ""} ${lessonRow?.notes || ""}`;
  return /no standard numbered lesson titles detected|not standard numbered lesson labels/i.test(notes);
}

if (publicIndex.schemaVersion !== 1) errors.push(`Unexpected schemaVersion: ${publicIndex.schemaVersion}`);
if (!Array.isArray(publicIndex.courses)) errors.push("Public Moodle index courses must be an array.");
if (publicIndex.courses?.length !== csvRows.length) {
  errors.push(`Public Moodle index course count ${publicIndex.courses?.length || 0} does not match CSV ${csvRows.length}.`);
}

for (const row of csvRows) {
  const item = publicByCourse.get(row.course);
  const lessonRow = lessonByCourse.get(row.course);
  if (!item) {
    errors.push(`Missing public Moodle index row for ${row.course}.`);
    continue;
  }
  if (!lessonRow && row.bookCount !== "0") errors.push(`Missing lesson summary row for ${row.course}.`);
  if (item.coursePage !== row.coursePage) errors.push(`${row.course} coursePage mismatch.`);
  if (item.outlineStatus !== row.outlineStatus) errors.push(`${row.course} outlineStatus mismatch.`);
  if (row.outlineStatus === "ready" && !item.outlineUrl) errors.push(`${row.course} ready outline is missing outlineUrl.`);
  if (row.outlineStatus === "needs-url" && item.outlineUrl) errors.push(`${row.course} needs-url row should not expose outlineUrl.`);
  if (Number(item.bookCount) !== Number(row.bookCount || 0)) errors.push(`${row.course} bookCount mismatch.`);

  const bookIds = splitSemicolonNumbers(row.bookIds);
  if ((item.bookIds || []).length !== bookIds.length) errors.push(`${row.course} bookIds count mismatch.`);
  for (const bookId of item.bookIds || []) {
    if (!bookIds.includes(Number(bookId))) errors.push(`${row.course} unknown public bookId ${bookId}.`);
  }
  if (!Array.isArray(item.books)) errors.push(`${row.course} books must be an array.`);
  if ((item.books || []).length !== bookIds.length) errors.push(`${row.course} books count mismatch.`);

  const chapterCounts = colonNumberMap(row.bookChapterLinkCounts);
  const lessonCounts = colonNumberMap(lessonRow?.bookLessonCounts);
  for (const book of item.books || []) {
    if (!bookIds.includes(Number(book.id))) errors.push(`${row.course} unknown public book entry ${book.id}.`);
    if (book.url !== `https://www.esunnybrook.com/mod/book/view.php?id=${book.id}`) errors.push(`${row.course} book ${book.id} URL mismatch.`);
    if (Number(book.chapterLinkCount || 0) !== Number(chapterCounts.get(Number(book.id)) || 0)) errors.push(`${row.course} book ${book.id} chapter count mismatch.`);
    if (Number(book.numberedLessonCount || 0) !== Number(lessonCounts.get(Number(book.id)) || 0)) errors.push(`${row.course} book ${book.id} numbered lesson count mismatch.`);
  }

  const expectedLessons = Number(lessonRow?.numberedLessonCount || 0);
  if (Number(item.numberedLessonCount || 0) !== expectedLessons) errors.push(`${row.course} numberedLessonCount mismatch.`);
  if (expectedLessons <= 0 && !allowsZeroNumberedLessons(row, lessonRow)) {
    errors.push(`${row.course} should have numbered lesson titles.`);
  }
}

const totals = publicIndex.totals || {};
const readyOutlines = publicIndex.courses.filter((course) => course.outlineStatus === "ready").length;
const needsUrl = publicIndex.courses.filter((course) => course.outlineStatus === "needs-url").length;
const lessonBooks = publicIndex.courses.reduce((sum, course) => sum + Number(course.bookCount || 0), 0);
const numberedLessons = publicIndex.courses.reduce((sum, course) => sum + Number(course.numberedLessonCount || 0), 0);

if (totals.courses !== publicIndex.courses.length) errors.push("totals.courses mismatch.");
if (totals.readyOutlines !== readyOutlines) errors.push("totals.readyOutlines mismatch.");
if (totals.needsUrl !== needsUrl) errors.push("totals.needsUrl mismatch.");
if (totals.lessonBooks !== lessonBooks) errors.push("totals.lessonBooks mismatch.");
if (totals.numberedLessons !== numberedLessons) errors.push("totals.numberedLessons mismatch.");

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Moodle resource index OK: ${publicIndex.courses.length} courses; ${readyOutlines} ready; ${needsUrl} needs-url; ${lessonBooks} books; ${numberedLessons} lessons.`,
);
