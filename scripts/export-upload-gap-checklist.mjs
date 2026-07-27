import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const deploymentRoot = join(projectRoot, "deployment");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return resolve(projectRoot, "..", course.manifestUrl.slice(1));
}

function lessonCount(manifest) {
  return (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0);
}

function flatLessons(manifest) {
  return (manifest.units || []).flatMap((unit) =>
    (unit.lessons || []).map((lesson) => ({
      unit: unit.unit,
      unitTitle: unit.title,
      ...lesson,
    })),
  );
}

function needsLessonPlan(lesson) {
  return lesson.planningStatus !== "unit_overview";
}

function hasRole(manifest, role) {
  return (manifest.courseDownloads || []).some((item) => item.role === role && hasLocalDownload(item));
}

function hasLocalDownload(item) {
  return Boolean(item?.path);
}

function safeName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function outlineItem(course) {
  return {
    priority: "high",
    course: course.code,
    title: course.title,
    uploadType: "course-outline",
    unit: null,
    lesson: null,
    suggestedFilename: `${course.code}_Course_Outline.docx`,
    adminTarget: "Course Outline / Syllabus",
    note: "Upload through teacher admin as Course Outline / Syllabus.",
  };
}

function introductionItem(course) {
  return {
    priority: "medium",
    course: course.code,
    title: course.title,
    uploadType: "course-introduction",
    unit: null,
    lesson: null,
    suggestedFilename: `${course.code}_Introduction.md`,
    adminTarget: "Course Introduction",
    note: "Upload through teacher admin as Course Introduction.",
  };
}

function unitPlanItem(course, unit) {
  return {
    priority: "high",
    course: course.code,
    title: course.title,
    uploadType: "unit-plan",
    unit: unit.unit,
    lesson: null,
    suggestedFilename: `${course.code}_U${String(unit.unit).padStart(2, "0")}_Unit_Plan.docx`,
    adminTarget: `Unit ${unit.unit}`,
    note: `Missing Unit Plan for ${unit.title || `Unit ${unit.unit}`}.`,
  };
}

function lessonPlanItem(course, lesson) {
  return {
    priority: "high",
    course: course.code,
    title: course.title,
    uploadType: "lesson-plan",
    unit: lesson.unit,
    lesson: lesson.lesson,
    suggestedFilename: `${course.code}_U${String(lesson.unit).padStart(2, "0")}_L${String(lesson.lesson).padStart(2, "0")}_Lesson_Plan.docx`,
    adminTarget: `Unit ${lesson.unit} / Lesson ${lesson.lesson}`,
    note: `Missing Lesson Plan for ${lesson.id}: ${lesson.title}.`,
  };
}

function textReviewItem(course, text) {
  return {
    priority: "text-download",
    course: course.code,
    title: course.title,
    uploadType: "text-material",
    textId: text.id,
    textTitle: text.title,
    author: text.author,
    suggestedFilename: `${safeName(text.id || text.title)}.pdf`,
    suggestedFolder: `courseware/${course.code}/texts/${safeName(text.id || text.title).toLowerCase()}/`,
    copyrightStatus: text.copyrightStatus,
    sourceStatus: text.sourceStatus,
    note: text.notes || "Add a downloadable text file for this literary work.",
  };
}

function ispringCourseItem(course, manifest, ispringCount) {
  const lessons = lessonCount(manifest);
  return {
    priority: "external",
    course: course.code,
    title: course.title,
    uploadType: "ispring-zip",
    lessonCount: lessons,
    connectedCount: ispringCount,
    note:
      lessons > 0
        ? `No iSpring packages connected. If packages exist, upload ZIPs lesson by lesson after selecting the matching Unit/Lesson.`
        : "No lessons are indexed yet, so iSpring cannot be attached until lesson structure exists.",
  };
}

function courseChecklist(course, manifest) {
  const lessons = flatLessons(manifest);
  const items = [];
  const reviewItems = [];
  const externalItems = [];

  if (!hasRole(manifest, "course_outline")) items.push(outlineItem(course));
  if (!hasRole(manifest, "introduction")) items.push(introductionItem(course));

  for (const unit of manifest.units || []) {
    if (!hasLocalDownload(unit.unitPlan)) items.push(unitPlanItem(course, unit));
  }
  for (const lesson of lessons) {
    if (needsLessonPlan(lesson) && !hasLocalDownload(lesson.lessonPlan)) items.push(lessonPlanItem(course, lesson));
  }

  for (const text of manifest.texts || []) {
    if (
      text.copyrightStatus === "needs_review" ||
      text.sourceStatus === "needs_review" ||
      text.sourceStatus === "link_only" ||
      text.sourceStatus === "pending_download" ||
      !(text.materials || []).some(hasLocalDownload)
    ) {
      reviewItems.push(textReviewItem(course, text));
    }
  }

  const ispringCount = lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0);
  if (ispringCount === 0 && course.code !== "ENG3U") {
    externalItems.push(ispringCourseItem(course, manifest, ispringCount));
  }

  return {
    course: course.code,
    title: course.title,
    units: manifest.units?.length || 0,
    lessons: lessons.length,
    uploadItems: items,
    reviewItems,
    externalItems,
  };
}

function renderTable(headers, rows) {
  if (!rows.length) return "- None";
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function renderMarkdown(report) {
  const uploadRows = report.uploadItems.map((item) => [
    item.course,
    item.uploadType,
    item.unit ?? "",
    item.lesson ?? "",
    item.suggestedFilename,
    item.note,
  ]);
  const reviewRows = report.reviewItems.map((item) => [
    item.course,
    item.textId,
    item.textTitle,
    item.author,
    item.suggestedFilename,
    item.suggestedFolder,
    item.note,
  ]);
  const externalRows = report.externalItems.map((item) => [
    item.course,
    item.uploadType,
    item.lessonCount,
    item.connectedCount,
    item.note,
  ]);

  return `# Upload Gap Checklist

Generated: ${report.generatedAt}

## Summary

| Item | Count |
| --- | ---: |
| Courses | ${report.courseCount} |
| Direct admin upload items | ${report.uploadItems.length} |
| Missing downloadable text items | ${report.reviewItems.length} |
| External iSpring decisions | ${report.externalItems.length} |

## Direct Admin Uploads

${renderTable(["Course", "Upload Type", "Unit", "Lesson", "Suggested Filename", "Note"], uploadRows)}

## Missing Downloadable Text Files

${renderTable(["Course", "Text ID", "Text", "Author", "Suggested Filename", "Suggested Folder", "Note"], reviewRows)}

## iSpring Packages Not Connected

${renderTable(["Course", "Upload Type", "Lessons", "Connected", "Note"], externalRows)}
`;
}

if (!existsSync(catalogPath)) {
  console.error(`Missing course catalog: ${catalogPath}`);
  process.exit(1);
}

const catalog = readJson(catalogPath);
const courseReports = [];

for (const course of catalog.courses || []) {
  const manifestPath = localManifestPath(course);
  if (!manifestPath || !existsSync(manifestPath)) continue;
  courseReports.push(courseChecklist(course, readJson(manifestPath)));
}

const report = {
  generatedAt: new Date().toISOString(),
  courseCount: courseReports.length,
  courses: courseReports,
  uploadItems: courseReports.flatMap((course) => course.uploadItems),
  reviewItems: courseReports.flatMap((course) => course.reviewItems),
  externalItems: courseReports.flatMap((course) => course.externalItems),
};

const jsonPath = join(deploymentRoot, "upload-gap-checklist.json");
const mdPath = join(deploymentRoot, "upload-gap-checklist.md");
mkdirSync(dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(mdPath, renderMarkdown(report), "utf8");

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
console.log(`Direct uploads ${report.uploadItems.length}; missing downloadable texts ${report.reviewItems.length}; iSpring decisions ${report.externalItems.length}`);
