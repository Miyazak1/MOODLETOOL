import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const moodleIndexPath = join(projectRoot, "deployment", "moodle-course-resource-index.csv");

const FOUND_OUTLINES = [
  {
    course: "CHC2D",
    moodleCourseId: "42",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=4257",
    label: "CHC2D Course Outline",
  },
  {
    course: "HFC3M",
    moodleCourseId: "56",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=5646",
    label: "HFC3M Course Outline",
  },
  {
    course: "HHS4U",
    moodleCourseId: "54",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=5415",
    label: "HHS4U Course Outline",
  },
  {
    course: "LKBDU",
    moodleCourseId: "45",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=4578",
    label: "LKBDU Course Outline",
  },
  {
    course: "BBI1O",
    moodleCourseId: "30",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=3284",
    label: "BBI1O/BBI2O Course Outline",
  },
  {
    course: "MAP4C",
    moodleCourseId: "17",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=1450",
    label: "MAP4C Course Outline",
  },
  {
    course: "SNC1D",
    moodleCourseId: "62",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=6350",
    label: "SNC1D Course Outline",
  },
];

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
  return {
    headers,
    rows: lines.slice(1).map((line) => {
      const cells = parseCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    }),
  };
}

function writeCsv(path, headers, rows) {
  const body = rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n");
  writeFileSync(path, `${headers.join(",")}\n${body}\n`, "utf8");
}

function patchManifest(item) {
  const manifestPath = join(coursewareRoot, item.course, "course-manifest.json");
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.courseDownloads ||= [];
  const hasCourseOutline = manifest.courseDownloads.some((download) => download.role === "course_outline");
  if (hasCourseOutline) return false;

  manifest.courseDownloads.unshift({
    label: item.label,
    type: "docx",
    category: "course_document",
    role: "course_outline",
    url: item.outlineUrl,
  });
  manifest.sourceAudit ||= {};
  manifest.sourceAudit.outlineUrl = item.outlineUrl;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return true;
}

const { headers, rows } = readCsv(moodleIndexPath);
const byCourse = new Map(rows.map((row, index) => [row.course, index]));
let patchedRows = 0;
let patchedManifests = 0;

for (const item of FOUND_OUTLINES) {
  const index = byCourse.get(item.course);
  if (index == null) continue;
  const row = rows[index];
  row.moodleCourseId ||= item.moodleCourseId;
  row.coursePage = `https://www.esunnybrook.com/course/view.php?id=${row.moodleCourseId || item.moodleCourseId}`;
  row.outlineStatus = "ready";
  row.outlineTargetFilename = row.outlineTargetFilename || `${item.course}_Course_Outline.docx`;
  row.outlineUrl = item.outlineUrl;
  row.notes = `${row.notes || "Visible Moodle shell found."} Found Course Outline link during authenticated rescan.`;
  patchedRows += 1;
  if (patchManifest(item)) patchedManifests += 1;
}

writeCsv(moodleIndexPath, headers, rows);
console.log(`Patched Moodle outline rows: ${patchedRows}; manifests appended: ${patchedManifests}.`);
