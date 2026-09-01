import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const readinessPath = join(deploymentRoot, "course-readiness-summary.json");
const uploadGapPath = join(deploymentRoot, "upload-gap-checklist.json");
const onlinePath = join(deploymentRoot, "online-resource-readiness.json");
const outputJsonPath = join(deploymentRoot, "course-content-workbench.json");
const outputMdPath = join(deploymentRoot, "course-content-workbench.md");

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`Missing required report: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function byKey(items, keyName) {
  const map = new Map();
  for (const item of items || []) map.set(item[keyName], item);
  return map;
}

function groupedByCourse(items) {
  const map = new Map();
  for (const item of items || []) {
    const course = item.course || item.code;
    if (!course) continue;
    if (!map.has(course)) map.set(course, []);
    map.get(course).push(item);
  }
  return map;
}

function isExcludedCourseCode(course) {
  return /C$/i.test(String(course || "").trim());
}

function completionStatus(row) {
  if (row.blockers.length) return "blocked-by-content";
  if (row.important.length) return "needs-course-content";
  if (row.previewQueue || row.textReviewItems) return "needs-polish";
  return "ready";
}

function priorityScore(row) {
  let score = 0;
  if (row.missingCourseOutline) score += 100;
  if (row.missingUnitPlans) score += 70;
  if (row.missingLessonPlans) score += 70;
  if (row.iSpringMissing) score += 45;
  if (row.textReviewItems) score += 25;
  score += Math.min(row.previewQueue, 60) * 0.5;
  return Math.round(score * 10) / 10;
}

function nextActions(row) {
  const actions = [];
  if (row.missingCourseOutline) actions.push("补 Course Outline：优先从 Moodle 文件 URL 批量导入，或后台上传。");
  if (row.missingUnitPlans) actions.push(`补 Unit Plan：${row.missingUnitPlans} 个。`);
  if (row.missingLessonPlans) actions.push(`补 Lesson Plan：${row.missingLessonPlans} 个。`);
  if (row.iSpringMissing) actions.push("补 iSpring：收集/上传本课程 iSpring ZIP，按 Unit/Lesson 绑定。");
  if (row.previewQueue) actions.push(`生成 Office PDF 预览：${row.previewQueue} 个。`);
  if (row.textReviewItems) actions.push(`补可下载文学文本：${row.textReviewItems} 项。`);
  if (!actions.length) actions.push("当前没有内容动作。");
  return actions;
}

function renderTable(headers, rows) {
  if (!rows.length) return "- None";
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function renderMarkdown(report) {
  const dashboardRows = report.rows.map((row) => [
    row.course,
    row.status,
    row.priorityScore,
    row.units,
    row.lessons,
    row.missingCourseOutline ? "Missing" : "OK",
    row.iSpringConnected,
    row.previewQueue,
    row.textReviewItems,
    row.nextActions[0],
  ]);
  const topRows = report.rows
    .filter((row) => row.status !== "ready")
    .slice(0, 15)
    .map((row) => [row.course, row.status, row.priorityScore, row.nextActions.join("<br>")]);
  const outlineRows = report.rows
    .filter((row) => row.missingCourseOutline)
    .map((row) => [row.course, row.title, row.suggestedOutlineFilename || `${row.course}_Course_Outline.docx`]);
  const previewRows = report.rows
    .filter((row) => row.previewQueue)
    .sort((a, b) => b.previewQueue - a.previewQueue)
    .map((row) => [row.course, row.previewQueue, row.fileResources, row.fileIssueEntries]);

  return `# Course Content Workbench

Generated: ${report.generatedAt}

## Summary

| Item | Count |
| --- | ---: |
| Courses | ${report.totals.courses} |
| Ready | ${report.totals.ready} |
| Need course content | ${report.totals.needCourseContent} |
| Need polish only | ${report.totals.needPolish} |
| Missing Course Outlines | ${report.totals.missingCourseOutlines} |
| iSpring missing courses | ${report.totals.iSpringMissingCourses} |
| Office preview queue | ${report.totals.previewQueue} |
| Missing text downloads | ${report.totals.textReviewItems} |

## Priority Work

${renderTable(["Course", "Status", "Priority", "Next Actions"], topRows)}

## Course Dashboard

${renderTable(["Course", "Status", "Priority", "Units", "Lessons", "Outline", "iSpring", "Preview Queue", "Missing Text Downloads", "First Next Action"], dashboardRows)}

## Missing Course Outlines

${renderTable(["Course", "Title", "Suggested File"], outlineRows)}

## Office Preview Queue By Course

${renderTable(["Course", "Preview Queue", "File Resources", "Issue Entries"], previewRows)}
`;
}

const readiness = readJson(readinessPath);
const uploadGap = readJson(uploadGapPath);
const online = readJson(onlinePath);

const readinessReports = readiness.reports || [];
const uploadCourses = byKey(uploadGap.courses || [], "course");
const directUploads = groupedByCourse(uploadGap.uploadItems || []);
const reviews = groupedByCourse(uploadGap.reviewItems || []);
const externals = groupedByCourse(uploadGap.externalItems || []);
const onlineSummaries = byKey(online.courseSummaries || [], "course");

const rows = readinessReports.filter((report) => !isExcludedCourseCode(report.course?.code)).map((report) => {
  const course = report.course?.code || "";
  const uploadCourse = uploadCourses.get(course) || {};
  const onlineCourse = onlineSummaries.get(course) || {};
  const direct = directUploads.get(course) || [];
  const external = externals.get(course) || [];
  const review = reviews.get(course) || [];
  const outlineTask = direct.find((item) => item.uploadType === "course-outline");
  const iSpringTask = external.find((item) => item.uploadType === "ispring-zip");
  const missingUnitPlans = report.gaps?.missingUnitPlans?.length || 0;
  const missingLessonPlans = report.gaps?.missingLessonPlans?.length || 0;
  const row = {
    course,
    title: report.course?.title || uploadCourse.title || course,
    units: report.counts?.units || uploadCourse.units || 0,
    lessons: report.counts?.lessons || uploadCourse.lessons || 0,
    courseDocuments: report.counts?.courseDocuments || 0,
    missingCourseOutline: Boolean(report.gaps?.missingCourseOutline),
    missingIntroduction: Boolean(report.gaps?.missingIntroduction),
    missingUnitPlans,
    missingLessonPlans,
    iSpringEntries: report.counts?.ispringEntries || 0,
    iSpringExpected: report.sourceAudit?.ispringExpected || 0,
    iSpringConnected: report.counts?.ispringEntries ? `${report.counts.ispringEntries}` : "0",
    iSpringMissing: Boolean(iSpringTask) || (report.counts?.ispringEntries || 0) === 0,
    previewQueue: onlineCourse.previewQueue || 0,
    fileResources: onlineCourse.fileResources || 0,
    fileIssueEntries: onlineCourse.fileIssues || 0,
    textReviewItems: review.length || report.gaps?.textsMissingDownload?.length || report.gaps?.textsNeedingReview?.length || 0,
    directUploadItems: direct.length,
    reviewItems: review.length,
    externalItems: external.length,
    suggestedOutlineFilename: outlineTask?.suggestedFilename || "",
    blockers: [],
    important: [],
  };

  if (row.missingCourseOutline) row.blockers.push("course-outline");
  if (row.missingUnitPlans) row.blockers.push("unit-plans");
  if (row.missingLessonPlans) row.blockers.push("lesson-plans");
  if (row.iSpringMissing) row.important.push("ispring");
  if (row.missingIntroduction) row.important.push("introduction");
  row.status = completionStatus(row);
  row.priorityScore = priorityScore(row);
  row.nextActions = nextActions(row);
  return row;
});

rows.sort((a, b) => b.priorityScore - a.priorityScore || a.course.localeCompare(b.course));

const report = {
  generatedAt: new Date().toISOString(),
  sources: {
    readiness: "deployment/course-readiness-summary.json",
    uploadGap: "deployment/upload-gap-checklist.json",
    onlineResources: "deployment/online-resource-readiness.json",
  },
  totals: {
    courses: rows.length,
    ready: rows.filter((row) => row.status === "ready").length,
    needCourseContent: rows.filter((row) => row.status === "needs-course-content" || row.status === "blocked-by-content").length,
    needPolish: rows.filter((row) => row.status === "needs-polish").length,
    missingCourseOutlines: rows.filter((row) => row.missingCourseOutline).length,
    iSpringMissingCourses: rows.filter((row) => row.iSpringMissing).length,
    previewQueue: rows.reduce((sum, row) => sum + row.previewQueue, 0),
    textReviewItems: rows.reduce((sum, row) => sum + row.textReviewItems, 0),
  },
  rows,
};

mkdirSync(deploymentRoot, { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(outputMdPath, renderMarkdown(report), "utf8");

console.log(`Wrote ${outputJsonPath}`);
console.log(`Wrote ${outputMdPath}`);
console.log(
  `Courses ${report.totals.courses}; ready ${report.totals.ready}; missing outlines ${report.totals.missingCourseOutlines}; iSpring missing ${report.totals.iSpringMissingCourses}; previews ${report.totals.previewQueue}`,
);
