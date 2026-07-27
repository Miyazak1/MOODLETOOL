import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const deploymentRoot = join(projectRoot, "deployment");
const inboxRoot = join(projectRoot, "inbox");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const workbenchPath = join(deploymentRoot, "course-content-workbench.json");
const jsonPath = join(deploymentRoot, "ispring-package-queue.json");
const mdPath = join(deploymentRoot, "ispring-package-queue.md");
const csvPath = join(inboxRoot, "ispring-package-queue.csv");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return join(workspaceRoot, course.manifestUrl.slice(1));
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

function lessonRows(courseCode, manifest) {
  return (manifest.units || []).flatMap((unit) =>
    (unit.lessons || []).map((lesson) => {
      const expectedFilename = `${courseCode}_U${String(lesson.unit).padStart(2, "0")}_L${String(lesson.lesson).padStart(2, "0")}.zip`;
      const isUnitOverview = lesson.planningStatus === "unit_overview" || (/^unit overview$/i.test(lesson.title || "") && !lesson.lessonPlan);
      return {
        course: courseCode,
        unit: lesson.unit,
        lesson: lesson.lesson,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        lessonPath: lesson.path,
        expectedFilename,
        alternateFilename: `U${String(lesson.unit).padStart(2, "0")}_L${String(lesson.lesson).padStart(2, "0")}.zip`,
        status: lesson.ispring?.length ? "connected" : "needs-zip",
        connectedCount: lesson.ispring?.length || 0,
        notes: isUnitOverview
          ? "Unit-level placeholder created from a Unit Plan; use this slot only if the iSpring package is unit-level."
          : "Lesson-level slot.",
      };
    }),
  );
}

function renderMarkdown(report) {
  const summaryRows = report.courses.map((course) => [
    course.course,
    course.title,
    course.lessons,
    course.connectedLessons,
    course.missingLessonZips,
    course.status,
    course.notes,
  ]);
  const queueRows = report.queue
    .filter((row) => row.status === "needs-zip")
    .slice(0, 160)
    .map((row) => [row.course, row.unit, row.lesson, row.lessonId, row.lessonTitle, row.expectedFilename, row.notes]);
  const unavailableRows = report.courses
    .filter((course) => course.status === "lesson-structure-needed")
    .map((course) => [course.course, course.title, course.notes]);

  return `# iSpring Package Queue

Generated: ${report.generatedAt}

## Summary

| Item | Count |
| --- | ---: |
| Courses needing iSpring decisions | ${report.totals.coursesNeedingIspring} |
| Courses with lesson-level ZIP queue | ${report.totals.coursesWithLessonQueue} |
| Courses needing lesson structure first | ${report.totals.coursesNeedingLessonStructure} |
| Missing lesson ZIPs | ${report.totals.missingLessonZips} |
| Connected iSpring lessons | ${report.totals.connectedLessons} |

## Course Summary

${renderTable(["Course", "Title", "Lessons", "Connected Lessons", "Missing ZIPs", "Status", "Notes"], summaryRows)}

## Lesson ZIP Queue

${renderTable(["Course", "Unit", "Lesson", "Lesson ID", "Title", "Expected ZIP Filename", "Notes"], queueRows)}

## Courses Needing Lesson Structure First

${renderTable(["Course", "Title", "Notes"], unavailableRows)}

## Import Paths

Put lesson ZIPs under either:

\`\`\`text
ossd-course-portal/inbox/ispring/<COURSE>/
ossd-course-portal/inbox/collection/ispring-batches/<COURSE>/
\`\`\`

Then run:

\`\`\`text
npm.cmd run import:ispring-packages -- --course <COURSE> --dry-run
npm.cmd run import:ispring-packages -- --course <COURSE> --overwrite
\`\`\`
`;
}

if (!existsSync(catalogPath)) {
  console.error(`Missing course catalog: ${catalogPath}`);
  process.exit(1);
}
if (!existsSync(workbenchPath)) {
  console.error(`Missing content workbench: ${workbenchPath}`);
  console.error("Run: npm.cmd run audit:content-workbench");
  process.exit(1);
}

const catalog = readJson(catalogPath);
const workbench = readJson(workbenchPath);
const workbenchByCourse = new Map((workbench.rows || []).map((row) => [row.course, row]));
const courses = [];
const queue = [];

for (const course of catalog.courses || []) {
  const workbenchRow = workbenchByCourse.get(course.code);
  if (!workbenchRow?.iSpringMissing) continue;
  const manifestPath = localManifestPath(course);
  const manifest = manifestPath && existsSync(manifestPath) ? readJson(manifestPath) : null;
  const lessons = manifest ? lessonRows(course.code, manifest) : [];
  queue.push(...lessons);
  const missingLessonZips = lessons.filter((lesson) => lesson.status === "needs-zip").length;
  const connectedLessons = lessons.filter((lesson) => lesson.status === "connected").length;
  const status = lessons.length ? (missingLessonZips ? "needs-lesson-zips" : "connected") : "lesson-structure-needed";
  courses.push({
    course: course.code,
    title: course.title,
    lessons: lessons.length,
    connectedLessons,
    missingLessonZips,
    status,
    notes: lessons.length
      ? `Prepare ${missingLessonZips} lesson ZIP(s) named as listed.`
      : "No lesson records are indexed yet; create lesson structure before attaching iSpring.",
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  sources: {
    catalog: "public/course-catalog.json",
    workbench: "deployment/course-content-workbench.json",
  },
  totals: {
    coursesNeedingIspring: courses.length,
    coursesWithLessonQueue: courses.filter((course) => course.lessons > 0).length,
    coursesNeedingLessonStructure: courses.filter((course) => course.lessons === 0).length,
    missingLessonZips: courses.reduce((sum, course) => sum + course.missingLessonZips, 0),
    connectedLessons: courses.reduce((sum, course) => sum + course.connectedLessons, 0),
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
    "course,unit,lesson,lessonId,lessonTitle,expectedFilename,alternateFilename,status,notes",
    ...queue.map((row) =>
      [
        row.course,
        row.unit,
        row.lesson,
        row.lessonId,
        row.lessonTitle,
        row.expectedFilename,
        row.alternateFilename,
        row.status,
        row.status === "needs-zip" ? `Place a complete iSpring ZIP using this filename. ${row.notes}` : `Already connected. ${row.notes}`,
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
console.log(
  `iSpring courses ${report.totals.coursesNeedingIspring}; lesson ZIPs ${report.totals.missingLessonZips}; lesson-structure-needed ${report.totals.coursesNeedingLessonStructure}`,
);
