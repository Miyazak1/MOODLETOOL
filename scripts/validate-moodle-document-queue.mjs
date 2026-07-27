import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const moodleIndexPath = join(projectRoot, "public", "moodle-course-resource-index.json");
const queuePath = join(projectRoot, "inbox", "moodle-course-document-queue.csv");

function fail(message) {
  console.error(message);
  process.exit(1);
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

function readJson(path) {
  if (!existsSync(path)) fail(`Missing JSON: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

const moodleIndex = readJson(moodleIndexPath);
const queueRows = readCsv(queuePath);
const queueByCourse = new Map(queueRows.map((row) => [row.course, row]));
const errors = [];

for (const course of moodleIndex.courses || []) {
  const row = queueByCourse.get(course.course);
  if (!row) {
    errors.push(`${course.course} is present in Moodle index but missing from the document queue.`);
    continue;
  }
  if (course.outlineStatus === "ready") {
    if (!course.outlineUrl) errors.push(`${course.course} is ready in Moodle index but has no outlineUrl.`);
    if (!row.url) errors.push(`${course.course} has a ready Moodle outline but queue url is empty.`);
    if (row.url && course.outlineUrl && row.url !== course.outlineUrl) errors.push(`${course.course} queue url does not match Moodle index outlineUrl.`);
    if (row.status !== "ready") errors.push(`${course.course} queue status should be ready.`);
  }
  if (course.outlineStatus === "needs-url" && row?.url) {
    errors.push(`${course.course} is needs-url in Moodle index but queue has a URL.`);
  }
}

for (const row of queueRows) {
  if (row.role !== "course-outline") errors.push(`${row.course} queue role should be course-outline.`);
  if (row.url && !/^https:\/\/www\.esunnybrook\.com\//i.test(row.url)) errors.push(`${row.course} queue URL should point to esunnybrook Moodle.`);
  if (row.status === "ready" && !row.url) errors.push(`${row.course} queue status is ready but URL is empty.`);
  if (row.status === "needs-url" && row.url) errors.push(`${row.course} queue status is needs-url but URL is filled.`);
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const readyRows = queueRows.filter((row) => row.status === "ready").length;
const needsUrlRows = queueRows.filter((row) => row.status === "needs-url").length;
console.log(`Moodle document queue OK: ${queueRows.length} rows; ${readyRows} ready; ${needsUrlRows} needs-url.`);
