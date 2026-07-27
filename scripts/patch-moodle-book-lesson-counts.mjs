import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const courseIndexPath = join(projectRoot, "deployment", "moodle-course-resource-index.csv");
const lessonSummaryPath = join(projectRoot, "deployment", "moodle-lesson-title-summary.csv");

const COURSE_INDEX_PATCHES = {
  ESLCO: {
    bookChapterLinkCounts: "7653:26;7671:31;7688:26;7702:26",
    notes:
      "Authenticated Moodle shell visible; 4 Moodle Book container(s) found; section structure imported; chapter counts refreshed from authenticated Book TOCs.",
  },
};

const LESSON_SUMMARY_PATCHES = {
  HFA4U: {
    books: "1",
    numberedLessonCount: "10",
    bookLessonCounts: "9805:10",
    notes: "Standard numbered lesson titles detected in Moodle Book 9805 during authenticated chapter crawl.",
  },
  ESLCO: {
    books: "4",
    numberedLessonCount: "21",
    bookLessonCounts: "7653:5;7671:6;7688:5;7702:5",
    notes: "Standard lesson titles detected across four authenticated Moodle Book containers.",
  },
};

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
  return { headers, rows };
}

function writeCsv(path, headers, rows) {
  const body = rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n");
  writeFileSync(path, `${headers.join(",")}\n${body}\n`, "utf8");
}

function patchRows(path, patches) {
  const { headers, rows } = readCsv(path);
  let count = 0;
  for (const row of rows) {
    const patch = patches[row.course];
    if (!patch) continue;
    Object.assign(row, patch);
    count += 1;
  }
  writeCsv(path, headers, rows);
  return count;
}

const courseRows = patchRows(courseIndexPath, COURSE_INDEX_PATCHES);
const summaryRows = patchRows(lessonSummaryPath, LESSON_SUMMARY_PATCHES);
console.log(`Patched course index rows: ${courseRows}; lesson summary rows: ${summaryRows}.`);
