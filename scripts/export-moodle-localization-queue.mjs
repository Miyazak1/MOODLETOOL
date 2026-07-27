import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const jsonPath = join(projectRoot, "deployment", "moodle-localization-queue.json");
const mdPath = join(projectRoot, "deployment", "moodle-localization-queue.md");
const csvPath = join(projectRoot, "inbox", "moodle-localization-queue.csv");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function renderTable(headers, rows) {
  if (!rows.length) return "- None";
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function manifestPathFromUrl(manifestUrl) {
  const cleanUrl = manifestUrl.split("?")[0].replace(/^\/+/, "");
  const publicPath = join(projectRoot, "public", cleanUrl);
  if (existsSync(publicPath)) return publicPath;
  if (cleanUrl.startsWith("courseware/")) return join(projectRoot, "..", cleanUrl);
  return join(projectRoot, cleanUrl);
}

function hasLocalResource(item) {
  return Boolean(item?.path || item?.previewPath || item?.downloadPath);
}

function externalUrl(item) {
  return item?.url || item?.previewUrl || item?.downloadUrl || "";
}

function isMoodleExternal(item) {
  if (!item || hasLocalResource(item)) return false;
  const sourceText = `${externalUrl(item)} ${item.source || ""} ${item.category || ""}`.toLowerCase();
  return sourceText.includes("esunnybrook.com") || sourceText.includes("moodle");
}

function safeSegment(value) {
  return String(value || "resource")
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase() || "resource";
}

function targetHint(row) {
  if (row.scope.startsWith("text") && row.textId) {
    const extension = row.type === "url" || row.type === "html" ? "html" : row.type || "bin";
    return ["texts", safeSegment(row.textId), `${safeSegment(row.label)}.${extension}`].join("/");
  }
  const parts = ["moodle-mirror"];
  if (row.unit) parts.push(`unit-${row.unit}`);
  if (row.lessonId) parts.push(safeSegment(row.lessonId));
  parts.push(`${safeSegment(row.label)}.${row.type === "url" || row.type === "html" ? "html" : row.type || "bin"}`);
  return parts.join("/");
}

function addRow(rows, course, scope, item, extras = {}) {
  if (!isMoodleExternal(item)) return;
  const row = {
    course,
    scope,
    unit: extras.unit || "",
    lessonId: extras.lessonId || "",
    lessonTitle: extras.lessonTitle || "",
    label: item.label || extras.label || "Moodle resource",
    role: item.role || extras.role || "",
    category: item.category || extras.category || "",
    type: item.type || extras.type || "url",
    source: item.source || "",
    sourceUrl: externalUrl(item),
    textId: extras.textId || "",
  };
  row.targetHint = targetHint(row);
  rows.push(row);
}

function collectCourse(courseEntry) {
  const manifest = readJson(manifestPathFromUrl(courseEntry.manifestUrl));
  const rows = [];

  for (const item of manifest.courseDownloads || []) {
    addRow(rows, courseEntry.code, "course", item);
  }

  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) {
      addRow(rows, courseEntry.code, "text-material", item, {
        unit: (text.units || []).join("|"),
        label: text.title,
        textId: text.id,
      });
    }
    for (const item of text.externalLinks || []) {
      addRow(rows, courseEntry.code, "text-source", item, {
        unit: (text.units || []).join("|"),
        label: text.title,
        role: "text-source",
        category: "moodle_text_source",
        textId: text.id,
      });
    }
  }

  for (const unit of manifest.units || []) {
    addRow(rows, courseEntry.code, "unit-plan", unit.unitPlan, { unit: unit.unit, role: "unit-plan" });

    for (const lesson of unit.lessons || []) {
      const lessonExtras = { unit: unit.unit, lessonId: lesson.id, lessonTitle: lesson.title };
      addRow(rows, courseEntry.code, "lesson-plan", lesson.lessonPlan, lessonExtras);
      for (const item of lesson.textExports || []) addRow(rows, courseEntry.code, "lesson-text-export", item, lessonExtras);
      for (const item of lesson.downloads || []) addRow(rows, courseEntry.code, "lesson-resource", item, lessonExtras);
      for (const item of lesson.ispring || []) {
        addRow(rows, courseEntry.code, "ispring-play", item, { ...lessonExtras, role: "ispring-play", category: "moodle_ispring" });
        if (item.downloadUrl && !item.downloadPath) {
          addRow(rows, courseEntry.code, "ispring-download", { ...item, url: item.downloadUrl, type: "zip" }, {
            ...lessonExtras,
            role: "ispring-download",
            category: "moodle_ispring_download",
          });
        }
      }
    }
  }

  return rows;
}

function renderMarkdown(report) {
  const courseRows = report.courses.map((course) => [
    course.course,
    course.items,
    course.courseItems,
    course.lessonItems,
    course.textItems,
    course.ispringItems,
  ]);
  const sampleRows = report.rows.slice(0, 220).map((row) => [
    row.course,
    row.scope,
    row.textId,
    row.lessonId || `Unit ${row.unit || "-"}`,
    row.label,
    row.targetHint,
  ]);

  return `# Moodle Localization Queue

Generated: ${report.generatedAt}

These are Moodle source links that are not yet hosted inside this portal. They should not be treated as final online-view/download resources until the source content is imported into \`courseware/<COURSE>/\` and the manifest is patched to use local paths.

## Summary

| Item | Count |
| --- | ---: |
| Courses with source links | ${report.totals.courses} |
| Moodle source items | ${report.totals.items} |
| Lesson-level items | ${report.totals.lessonItems} |
| Text-source items | ${report.totals.textItems} |
| iSpring source items | ${report.totals.ispringItems} |

## By Course

${renderTable(["Course", "Items", "Course", "Lesson", "Text", "iSpring"], courseRows)}

## Queue Sample

${renderTable(["Course", "Scope", "Text ID", "Place", "Label", "Target Hint"], sampleRows)}
`;
}

const catalog = readJson(catalogPath);
const rows = catalog.courses.flatMap(collectCourse).sort(
  (a, b) =>
    a.course.localeCompare(b.course) ||
    String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true }) ||
    String(a.lessonId).localeCompare(String(b.lessonId), undefined, { numeric: true }) ||
    a.label.localeCompare(b.label),
);

const courseMap = new Map();
for (const row of rows) {
  const current = courseMap.get(row.course) || {
    course: row.course,
    items: 0,
    courseItems: 0,
    lessonItems: 0,
    textItems: 0,
    ispringItems: 0,
  };
  current.items += 1;
  if (row.scope === "course") current.courseItems += 1;
  if (row.scope.startsWith("lesson") || row.scope === "unit-plan") current.lessonItems += 1;
  if (row.scope.startsWith("text")) current.textItems += 1;
  if (row.scope.startsWith("ispring")) current.ispringItems += 1;
  courseMap.set(row.course, current);
}

const courses = [...courseMap.values()].sort((a, b) => b.items - a.items || a.course.localeCompare(b.course));
const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    courses: courses.length,
    items: rows.length,
    lessonItems: rows.filter((row) => row.scope.startsWith("lesson") || row.scope === "unit-plan").length,
    textItems: rows.filter((row) => row.scope.startsWith("text")).length,
    ispringItems: rows.filter((row) => row.scope.startsWith("ispring")).length,
  },
  courses,
  rows,
};

mkdirSync(dirname(jsonPath), { recursive: true });
mkdirSync(dirname(csvPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(mdPath, renderMarkdown(report), "utf8");
writeFileSync(
  csvPath,
  [
    "course,scope,textId,unit,lessonId,lessonTitle,label,role,category,type,sourceUrl,targetHint,source",
    ...rows.map((row) =>
      [
        row.course,
        row.scope,
        row.textId,
        row.unit,
        row.lessonId,
        row.lessonTitle,
        row.label,
        row.role,
        row.category,
        row.type,
        row.sourceUrl,
        row.targetHint,
        row.source,
      ].map(csvEscape).join(","),
    ),
  ].join("\n") + "\n",
  "utf8",
);

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
console.log(`Wrote ${csvPath}`);
console.log(`Moodle localization queue: ${report.totals.items} item(s) across ${report.totals.courses} course(s).`);
