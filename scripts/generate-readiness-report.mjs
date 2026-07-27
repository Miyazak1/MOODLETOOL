import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const requestedCourse = readArg("--course");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function localCourseRoot(course) {
  if (!course.baseUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.baseUrl.slice(1)));
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.manifestUrl.slice(1)));
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

function countIspring(manifest) {
  return flatLessons(manifest).reduce((sum, lesson) => sum + (lesson.ispring || []).filter((item) => item.path).length, 0);
}

function countDownloads(manifest) {
  return flatLessons(manifest).reduce((sum, lesson) => sum + (lesson.downloads || []).filter(hasLocalDownload).length, 0);
}

function countTextMaterials(manifest) {
  return (manifest.texts || []).reduce((sum, text) => sum + (text.materials || []).filter(hasLocalDownload).length, 0);
}

function hasLocalDownload(item) {
  return Boolean(item?.path);
}

function roleCount(items, role) {
  return (items || []).filter((item) => item.role === role && hasLocalDownload(item)).length;
}

function buildReadiness(course, manifest, courseRoot) {
  const lessons = flatLessons(manifest);
  const lessonsRequiringPlans = lessons.filter(needsLessonPlan);
  const missingUnitPlans = (manifest.units || [])
    .filter((unit) => !unit.unitPlan)
    .map((unit) => ({ unit: unit.unit, title: unit.title }));
  const missingLessonPlans = lessons
    .filter((lesson) => needsLessonPlan(lesson) && !lesson.lessonPlan)
    .map((lesson) => ({ id: lesson.id, unit: lesson.unit, lesson: lesson.lesson, title: lesson.title }));
  const textsNeedingReview = (manifest.texts || []).filter(
    (text) => text.copyrightStatus === "needs_review" || text.sourceStatus === "needs_review",
  );
  const textsMissingDownload = (manifest.texts || []).filter(
    (text) => text.sourceStatus !== "unavailable" && !(text.materials || []).some(hasLocalDownload),
  );
  const linkOnlyTexts = (manifest.texts || []).filter((text) => text.sourceStatus === "link_only");
  const publicDomainTextsMissingFiles = (manifest.texts || []).filter(
    (text) => text.copyrightStatus === "public_domain" && !(text.materials || []).some(hasLocalDownload),
  );
  const courseDownloads = manifest.courseDownloads || [];
  const localCourseDownloads = courseDownloads.filter(hasLocalDownload);

  return {
    generatedAt: new Date().toISOString(),
    course: {
      code: course.code,
      title: manifest.course?.title || course.title,
      localCourseRoot: courseRoot,
    },
    counts: {
      courseDocuments: localCourseDownloads.length,
      courseOutlines: roleCount(courseDownloads, "course_outline"),
      introductions: roleCount(courseDownloads, "introduction"),
      units: manifest.units?.length || 0,
      lessons: lessonCount(manifest),
      unitPlans: (manifest.units || []).filter((unit) => hasLocalDownload(unit.unitPlan)).length,
      lessonPlanExpected: lessonsRequiringPlans.length,
      lessonPlans: lessonsRequiringPlans.filter((lesson) => hasLocalDownload(lesson.lessonPlan)).length,
      ispringEntries: countIspring(manifest),
      lessonDownloads: countDownloads(manifest),
      textEntries: manifest.texts?.length || 0,
      textMaterials: countTextMaterials(manifest),
    },
    gaps: {
      missingCourseOutline: roleCount(courseDownloads, "course_outline") === 0,
      missingIntroduction: roleCount(courseDownloads, "introduction") === 0,
      missingUnitPlans: (manifest.units || [])
        .filter((unit) => !hasLocalDownload(unit.unitPlan))
        .map((unit) => ({ unit: unit.unit, title: unit.title })),
      missingLessonPlans: lessons
        .filter((lesson) => needsLessonPlan(lesson) && !hasLocalDownload(lesson.lessonPlan))
        .map((lesson) => ({ id: lesson.id, unit: lesson.unit, lesson: lesson.lesson, title: lesson.title })),
      textsNeedingReview: textsNeedingReview.map((text) => ({
        id: text.id,
        title: text.title,
        author: text.author,
        notes: text.notes,
      })),
      textsMissingDownload: textsMissingDownload.map((text) => ({
        id: text.id,
        title: text.title,
        author: text.author,
        notes: text.notes,
      })),
      linkOnlyTexts: linkOnlyTexts.map((text) => ({
        id: text.id,
        title: text.title,
        author: text.author,
        notes: text.notes,
      })),
      publicDomainTextsMissingFiles: publicDomainTextsMissingFiles.map((text) => ({
        id: text.id,
        title: text.title,
        author: text.author,
      })),
    },
    sourceAudit: {
      lessonCount: manifest.sourceAudit?.lessonCount,
      ispringExpected: manifest.sourceAudit?.ispringExpected,
      ispringComplete: manifest.sourceAudit?.ispringComplete,
      resourceUniqueCovered: manifest.sourceAudit?.resourceCoverage?.uniqueCovered,
      resourceUniqueTotal: manifest.sourceAudit?.resourceCoverage?.uniqueTotal,
      validationOk: manifest.sourceAudit?.resourceValidation?.okCount,
      validationChecked: manifest.sourceAudit?.resourceValidation?.checkedCount,
    },
  };
}

function row(label, value) {
  return `| ${label} | ${value} |`;
}

function markdownList(items, formatter) {
  if (!items.length) return "- None";
  return items.map(formatter).join("\n");
}

function renderMarkdown(report) {
  const c = report.counts;
  const g = report.gaps;
  const audit = report.sourceAudit;
  return `# ${report.course.code} Readiness Report

Generated: ${report.generatedAt}

## Summary

| Item | Count |
| --- | ---: |
${row("Course documents", c.courseDocuments)}
${row("Course outlines", c.courseOutlines)}
${row("Introductions", c.introductions)}
${row("Units", c.units)}
${row("Lessons", c.lessons)}
${row("Unit plans", `${c.unitPlans}/${c.units}`)}
${row("Lesson plans", `${c.lessonPlans}/${c.lessonPlanExpected ?? c.lessons}`)}
${row("iSpring entries", c.ispringEntries)}
${row("Lesson downloads", c.lessonDownloads)}
${row("Text entries", c.textEntries)}
${row("Text materials", c.textMaterials)}

## Source Audit

| Item | Status |
| --- | ---: |
${row("Indexed lessons", audit.lessonCount ?? "unknown")}
${row("iSpring complete", `${audit.ispringComplete ?? "unknown"}/${audit.ispringExpected ?? "unknown"}`)}
${row("Unique resources covered", `${audit.resourceUniqueCovered ?? "unknown"}/${audit.resourceUniqueTotal ?? "unknown"}`)}
${row("Validated resources", `${audit.validationOk ?? "unknown"}/${audit.validationChecked ?? "unknown"}`)}

## Course-Level Gaps

- Course outline missing: ${g.missingCourseOutline ? "yes" : "no"}
- Introduction missing: ${g.missingIntroduction ? "yes" : "no"}

## Missing Unit Plans

${markdownList(g.missingUnitPlans, (unit) => `- Unit ${unit.unit}: ${unit.title}`)}

## Missing Lesson Plans

${markdownList(g.missingLessonPlans, (lesson) => `- ${lesson.id}: ${lesson.title}`)}

## Texts Needing Review

${markdownList(g.textsNeedingReview, (text) => `- ${text.title} (${text.author}): ${text.notes}`)}

## Texts Missing Downloadable Files

${markdownList(g.textsMissingDownload, (text) => `- ${text.title} (${text.author}): ${text.notes}`)}

## Link-Only Texts

${markdownList(g.linkOnlyTexts, (text) => `- ${text.title} (${text.author}): ${text.notes}`)}

## Public-Domain Texts Missing Files

${markdownList(g.publicDomainTextsMissingFiles, (text) => `- ${text.title} (${text.author})`)}
`;
}

function renderSummaryMarkdown(reports) {
  const rows = reports
    .map((report) => {
      const c = report.counts;
      const g = report.gaps;
      return `| ${report.course.code} | ${c.units} | ${c.lessonPlans}/${c.lessonPlanExpected ?? c.lessons} | ${c.unitPlans}/${c.units} | ${c.ispringEntries} | ${g.missingCourseOutline ? "Missing" : "OK"} | ${g.missingIntroduction ? "Missing" : "OK"} |`;
    })
    .join("\n");
  const missingOutlines = reports.filter((report) => report.gaps.missingCourseOutline);
  const missingUnitPlans = reports.filter((report) => report.gaps.missingUnitPlans.length);
  const missingLessonPlans = reports.filter((report) => report.gaps.missingLessonPlans.length);
  const missingIspring = reports.filter((report) => report.counts.ispringEntries === 0);

  const courseList = (items) => (items.length ? items.map((report) => `- ${report.course.code}: ${report.course.title}`).join("\n") : "- None");
  const unitGapList = missingUnitPlans.length
    ? missingUnitPlans
        .map((report) => `- ${report.course.code}: ${report.gaps.missingUnitPlans.map((unit) => `Unit ${unit.unit}`).join(", ")}`)
        .join("\n")
    : "- None";
  const lessonGapList = missingLessonPlans.length
    ? missingLessonPlans
        .map((report) => `- ${report.course.code}: ${report.gaps.missingLessonPlans.length} missing lesson plan(s)`)
        .join("\n")
    : "- None";

  return `# Course Readiness Summary

Generated: ${new Date().toISOString()}

| Course | Units | Lesson Plans | Unit Plans | iSpring | Course Outline | Introduction |
| --- | ---: | ---: | ---: | ---: | --- | --- |
${rows}

## Remaining Action Items

### Course Outlines Needed

${courseList(missingOutlines)}

### Unit Plan Gaps

${unitGapList}

### Lesson Plan Gaps

${lessonGapList}

### iSpring Not Connected

${courseList(missingIspring)}
`;
}

if (!existsSync(catalogPath)) {
  console.error(`Missing course catalog: ${catalogPath}`);
  process.exit(1);
}

const catalog = readJson(catalogPath);
const courses = requestedCourse
  ? catalog.courses.filter((course) => course.code.toLowerCase() === requestedCourse.toLowerCase())
  : catalog.courses;

if (!courses.length) {
  console.error(`No course found for --course ${requestedCourse}`);
  process.exit(1);
}

const reports = [];

for (const course of courses) {
  const manifestPath = localManifestPath(course);
  const courseRoot = localCourseRoot(course);
  if (!manifestPath || !courseRoot) {
    console.log(`${course.code}: remote course readiness skipped`);
    continue;
  }
  if (!existsSync(manifestPath)) {
    console.error(`Missing manifest for ${course.code}: ${manifestPath}`);
    process.exit(1);
  }

  const report = buildReadiness(course, readJson(manifestPath), courseRoot);
  reports.push(report);
  const jsonPath = join(projectRoot, "deployment", `${course.code}-readiness-report.json`);
  const mdPath = join(projectRoot, "deployment", `${course.code}-readiness-report.md`);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, renderMarkdown(report), "utf8");

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(
    `${course.code}: Unit plans ${report.counts.unitPlans}/${report.counts.units}; Lesson plans ${report.counts.lessonPlans}/${report.counts.lessonPlanExpected ?? report.counts.lessons}; Text materials ${report.counts.textMaterials}`,
  );
}

if (!requestedCourse && reports.length) {
  const summaryJsonPath = join(projectRoot, "deployment", "course-readiness-summary.json");
  const summaryMdPath = join(projectRoot, "deployment", "course-readiness-summary.md");
  writeFileSync(summaryJsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`, "utf8");
  writeFileSync(summaryMdPath, renderSummaryMarkdown(reports), "utf8");
  console.log(`Wrote ${summaryJsonPath}`);
  console.log(`Wrote ${summaryMdPath}`);
}
