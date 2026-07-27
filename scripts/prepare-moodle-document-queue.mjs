import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const gapChecklistPath = join(projectRoot, "deployment", "upload-gap-checklist.json");
const contentWorkbenchPath = join(projectRoot, "deployment", "course-content-workbench.json");
const moodleResourceIndexPath = join(projectRoot, "deployment", "moodle-course-resource-index.csv");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const queuePath = join(projectRoot, "inbox", "moodle-course-document-queue.csv");
const notesPath = join(projectRoot, "inbox", "moodle-course-document-queue.md");

const ROLE_BY_UPLOAD_TYPE = {
  "course-outline": "course-outline",
};

const HEADERS = [
  "priorityScore",
  "workbenchStatus",
  "course",
  "title",
  "role",
  "targetFilename",
  "url",
  "status",
  "moodleSearchHint",
  "notes",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
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

function readExistingQueue(path) {
  if (!existsSync(path)) return new Map();
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Map();
  const headers = parseCsvLine(lines[0]);
  const rows = new Map();

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    const key = `${row.course}|${row.role}`;
    rows.set(key, row);
  }
  return rows;
}

function readCsv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function renderCsv(rows) {
  return `${HEADERS.join(",")}\n${rows
    .map((row) => HEADERS.map((header) => csvEscape(row[header])).join(","))
    .join("\n")}\n`;
}

function renderNotes(rows) {
  const tableRows = rows
    .map((row) =>
      [
        row.priorityScore,
        row.course,
        row.role,
        row.targetFilename,
        row.status,
        row.moodleSearchHint,
        row.notes,
      ]
        .map((cell) => String(cell ?? "").replace(/\|/g, "\\|"))
        .join(" | "),
    )
    .map((row) => `| ${row} |`)
    .join("\n");

  return `# Moodle Course Document Queue

Generated: ${new Date().toISOString()}

Fill the \`url\` column in:

\`\`\`text
ossd-course-portal/inbox/moodle-course-document-queue.csv
\`\`\`

Then run the workspace-level batch helper:

\`\`\`text
DOWNLOAD_COURSE_DOCUMENT_QUEUE_AND_IMPORT.bat
\`\`\`

Optional precheck:

\`\`\`text
cd ossd-course-portal
npm.cmd run plan:moodle-doc-queue
\`\`\`

The precheck writes a report without fetching Moodle URLs. The batch helper downloads each filled Moodle file URL, imports it into \`courseware/<COURSE>/plans/\`, and rebuilds or patches that course manifest. Empty URL rows are skipped.

If Moodle requires authentication, set \`MOODLE_COOKIE\` in the shell/server environment before running the batch helper. The project never needs Moodle passwords in source files.

| Priority | Course | Role | Target Filename | Status | Moodle Search Hint | Notes |
| ---: | --- | --- | --- | --- | --- | --- |
${tableRows || "| - | - | - | - | - | - | No Moodle document gaps found. |"}
`;
}

if (!existsSync(gapChecklistPath)) {
  console.error(`Missing gap checklist: ${gapChecklistPath}`);
  console.error("Run: npm.cmd run export:gap-checklist");
  process.exit(1);
}

const existing = readExistingQueue(queuePath);
const gapChecklist = readJson(gapChecklistPath);
const catalog = existsSync(catalogPath) ? readJson(catalogPath) : { courses: [] };
const moodleResourceRows = readCsv(moodleResourceIndexPath);
const workbench = existsSync(contentWorkbenchPath) ? readJson(contentWorkbenchPath) : { rows: [] };
const workbenchByCourse = new Map((workbench.rows || []).map((row) => [row.course, row]));
const catalogByCourse = new Map((catalog.courses || []).map((row) => [row.code, row]));
const documentItems = (gapChecklist.uploadItems || [])
  .filter((item) => ROLE_BY_UPLOAD_TYPE[item.uploadType])
  .sort((a, b) => {
    const aWorkbench = workbenchByCourse.get(a.course) || {};
    const bWorkbench = workbenchByCourse.get(b.course) || {};
    return (bWorkbench.priorityScore || 0) - (aWorkbench.priorityScore || 0) || `${a.course}-${a.uploadType}`.localeCompare(`${b.course}-${b.uploadType}`);
  });

const rows = documentItems.map((item) => {
  const role = ROLE_BY_UPLOAD_TYPE[item.uploadType];
  const key = `${item.course}|${role}`;
  const previous = existing.get(key) || {};
  const workbenchRow = workbenchByCourse.get(item.course) || {};
  const url = previous.url || "";
  const titleText = String(item.title || "").replace(`${item.course} ·`, "").trim();
  return {
    priorityScore: workbenchRow.priorityScore ?? "",
    workbenchStatus: workbenchRow.status || "",
    course: item.course,
    title: item.title,
    role,
    targetFilename: previous.targetFilename || item.suggestedFilename || `${item.course}_Course_Document.docx`,
    url,
    status: url ? "ready" : "needs-url",
    moodleSearchHint: previous.moodleSearchHint || `${item.course} Course Outline ${titleText}`.trim(),
    notes: previous.notes || item.note || "",
  };
});

const rowsByKey = new Map(rows.map((row) => [`${row.course}|${row.role}`, row]));

for (const moodleRow of moodleResourceRows) {
  const course = moodleRow.course;
  if (!course) continue;
  const key = `${course}|course-outline`;
  if (rowsByKey.has(key)) continue;
  const previous = existing.get(key) || {};
  const catalogRow = catalogByCourse.get(course) || {};
  const workbenchRow = workbenchByCourse.get(course) || {};
  const title = catalogRow.title || `${course} · Course`;
  const outlineUrl = previous.url || moodleRow.outlineUrl || "";
  const titleText = String(title || "").replace(`${course} ·`, "").trim();
  rowsByKey.set(key, {
    priorityScore: previous.priorityScore || workbenchRow.priorityScore || "",
    workbenchStatus: previous.workbenchStatus || workbenchRow.status || catalogRow.status || "",
    course,
    title,
    role: "course-outline",
    targetFilename: previous.targetFilename || moodleRow.outlineTargetFilename || `${course}_Course_Outline.docx`,
    url: outlineUrl,
    status: outlineUrl ? "ready" : "needs-url",
    moodleSearchHint: previous.moodleSearchHint || `${course} Course Outline ${titleText}`.trim(),
    notes: previous.notes || moodleRow.notes || "",
  });
}

const finalRows = Array.from(rowsByKey.values()).sort((a, b) => {
  const priorityDiff = Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
  return priorityDiff || a.course.localeCompare(b.course);
});

mkdirSync(dirname(queuePath), { recursive: true });
writeFileSync(queuePath, renderCsv(finalRows), "utf8");
writeFileSync(notesPath, renderNotes(finalRows), "utf8");

console.log(`Wrote ${queuePath}`);
console.log(`Wrote ${notesPath}`);
console.log(`Moodle document rows: ${finalRows.length}`);
