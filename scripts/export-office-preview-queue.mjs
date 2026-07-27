import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const inboxRoot = join(projectRoot, "inbox");
const onlinePath = join(deploymentRoot, "online-resource-readiness.json");
const workbenchPath = join(deploymentRoot, "course-content-workbench.json");
const jsonPath = join(deploymentRoot, "office-preview-queue.json");
const mdPath = join(deploymentRoot, "office-preview-queue.md");
const csvPath = join(inboxRoot, "office-preview-queue.csv");

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

function courseCommand(course) {
  return `npm run generate:previews -- --course ${course}`;
}

function renderMarkdown(report) {
  const courseRows = report.courses.map((course) => [
    course.course,
    course.priorityScore,
    course.status,
    course.previewFiles,
    course.command,
  ]);
  const queueRows = report.queue
    .slice(0, 180)
    .map((row) => [row.course, row.priorityScore, row.sourcePath, row.expectedPreviewPath, row.issueCount]);

  return `# Office Preview Queue

Generated: ${report.generatedAt}

This queue is for server-side LibreOffice PDF preview generation. Original Office files remain the download source; generated PDFs are used by the portal's online-view action.

## Summary

| Item | Count |
| --- | ---: |
| Courses with preview work | ${report.totals.coursesWithPreviewWork} |
| Unique Office previews needed | ${report.totals.previewFiles} |
| File issue entries represented | ${report.totals.issueEntries} |

## Course Commands

Run these after LibreOffice is installed on the cloud server. Start from the top of the table.

${renderTable(["Course", "Priority", "Status", "Preview Files", "Command"], courseRows)}

## File Queue

${renderTable(["Course", "Priority", "Source", "Expected Preview", "Issue Entries"], queueRows)}
`;
}

if (!existsSync(onlinePath)) {
  console.error(`Missing online resource report: ${onlinePath}`);
  console.error("Run: npm.cmd run audit:online-resources");
  process.exit(1);
}

if (!existsSync(workbenchPath)) {
  console.error(`Missing content workbench: ${workbenchPath}`);
  console.error("Run: npm.cmd run audit:content-workbench");
  process.exit(1);
}

const online = readJson(onlinePath);
const workbench = readJson(workbenchPath);
const workbenchByCourse = new Map((workbench.rows || []).map((row) => [row.course, row]));

const queue = (online.previewQueue || [])
  .map((item) => {
    const course = workbenchByCourse.get(item.course) || {};
    return {
      course: item.course,
      priorityScore: course.priorityScore ?? 0,
      status: course.status || "",
      sourcePath: item.sourcePath,
      expectedPreviewPath: item.expectedPreviewPath,
      issueCount: item.issueCount || 1,
    };
  })
  .sort(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      a.course.localeCompare(b.course) ||
      a.sourcePath.localeCompare(b.sourcePath),
  );

const courseMap = new Map();
for (const row of queue) {
  const current =
    courseMap.get(row.course) ||
    {
      course: row.course,
      priorityScore: row.priorityScore,
      status: row.status,
      previewFiles: 0,
      issueEntries: 0,
      command: courseCommand(row.course),
    };
  current.previewFiles += 1;
  current.issueEntries += row.issueCount;
  courseMap.set(row.course, current);
}

const courses = [...courseMap.values()].sort((a, b) => b.priorityScore - a.priorityScore || a.course.localeCompare(b.course));

const report = {
  generatedAt: new Date().toISOString(),
  sources: {
    onlineResources: "deployment/online-resource-readiness.json",
    workbench: "deployment/course-content-workbench.json",
  },
  totals: {
    coursesWithPreviewWork: courses.length,
    previewFiles: queue.length,
    issueEntries: queue.reduce((sum, row) => sum + row.issueCount, 0),
  },
  courses,
  queue,
};

mkdirSync(deploymentRoot, { recursive: true });
mkdirSync(dirname(csvPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(mdPath, renderMarkdown(report), "utf8");
writeFileSync(
  csvPath,
  [
    "course,priorityScore,workbenchStatus,sourcePath,expectedPreviewPath,issueCount,courseCommand",
    ...queue.map((row) =>
      [
        row.course,
        row.priorityScore,
        row.status,
        row.sourcePath,
        row.expectedPreviewPath,
        row.issueCount,
        courseCommand(row.course),
      ]
        .map(csvEscape)
        .join(","),
    ),
  ].join("\n") + "\n",
  "utf8",
);

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
console.log(`Wrote ${csvPath}`);
console.log(`Office preview courses ${report.totals.coursesWithPreviewWork}; files ${report.totals.previewFiles}`);
