import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const inboxRoot = join(projectRoot, "inbox");
const deploymentRoot = join(projectRoot, "deployment");
const jsonPath = join(deploymentRoot, "moodle-ispring-embed-queue.json");
const mdPath = join(deploymentRoot, "moodle-ispring-embed-queue.md");
const csvPath = join(inboxRoot, "moodle-ispring-embed-queue.csv");

const courseArg = process.argv.includes("--course")
  ? process.argv[process.argv.indexOf("--course") + 1]?.toUpperCase()
  : "";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function normalizeUrl(raw) {
  const value = String(raw || "").replaceAll("&amp;", "&").trim();
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

function isIspringUrl(url) {
  return /hexstruct\.ispring\.com\/s\/embed_player\//i.test(url) || /ispring/i.test(url);
}

function collectRows() {
  if (!existsSync(inboxRoot)) return [];
  const rows = [];
  for (const entry of readdirSync(inboxRoot)) {
    const match = /^moodle-book-raw-(?<course>[A-Z0-9]+)-U(?<unit>\d+)\.json$/i.exec(entry);
    if (!match) continue;
    const course = match.groups.course.toUpperCase();
    if (courseArg && course !== courseArg) continue;
    const raw = readJson(join(inboxRoot, entry));
    for (const lesson of raw.lessons || []) {
      const lessonId = `U${String(Number(raw.unit)).padStart(2, "0")}L${String(Number(lesson.lesson)).padStart(2, "0")}`;
      for (const section of lesson.sections || []) {
        const sectionLabel = section.normalizedLabel || section.label || "";
        for (const ref of section.page?.refs || []) {
          const url = normalizeUrl(ref.url || "");
          if (!isIspringUrl(url)) continue;
          rows.push({
            course,
            unit: Number(raw.unit),
            lesson: Number(lesson.lesson),
            lessonId,
            lessonTitle: lesson.title || "",
            section: sectionLabel,
            url,
            expectedFilename: `${course}_U${String(Number(raw.unit)).padStart(2, "0")}_L${String(Number(lesson.lesson)).padStart(2, "0")}.zip`,
          });
        }
      }
    }
  }
  const byKey = new Map();
  for (const row of rows) byKey.set(`${row.course}|${row.lessonId}|${row.url}`, row);
  return [...byKey.values()].sort((a, b) => `${a.course}|${a.unit}|${a.lesson}`.localeCompare(`${b.course}|${b.unit}|${b.lesson}`));
}

function renderMarkdown(report) {
  const rows = report.rows
    .slice(0, 180)
    .map((row) => `| ${row.course} | ${row.lessonId} | ${row.section} | ${row.lessonTitle.replaceAll("|", "\\|")} | ${row.expectedFilename} | ${row.url.replaceAll("|", "\\|")} |`);
  return `# Moodle iSpring Embed Queue

Generated: ${report.generatedAt}

Rows: ${report.rows.length}

These are external iSpring embeds found in authenticated Moodle book pages. They are not localized courseware yet. Use them to locate/export complete iSpring ZIP packages, then import those ZIPs into the portal.

| Course | Lesson | Section | Title | Expected ZIP | Source Embed URL |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n") || "| - | - | - | - | - | - |"}
`;
}

const rows = collectRows();
const report = {
  generatedAt: new Date().toISOString(),
  course: courseArg || null,
  rows,
  totals: {
    rows: rows.length,
    courses: new Set(rows.map((row) => row.course)).size,
    lessons: new Set(rows.map((row) => `${row.course}|${row.lessonId}`)).size,
  },
};

mkdirSync(deploymentRoot, { recursive: true });
mkdirSync(dirname(csvPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(mdPath, renderMarkdown(report), "utf8");
writeFileSync(
  csvPath,
  [
    "course,unit,lesson,lessonId,lessonTitle,section,expectedFilename,url",
    ...rows.map((row) =>
      [row.course, row.unit, row.lesson, row.lessonId, row.lessonTitle, row.section, row.expectedFilename, row.url]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n") + "\n",
  "utf8",
);

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
console.log(`Wrote ${csvPath}`);
console.log(`iSpring embed rows ${report.totals.rows}; lessons ${report.totals.lessons}; courses ${report.totals.courses}`);
