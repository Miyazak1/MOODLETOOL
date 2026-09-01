import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const requestedCourse = readArg("--course");
const jsonMode = hasFlag("--json");
const strictMode = hasFlag("--strict");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function text(value) {
  return String(value ?? "");
}

function toPosix(value) {
  return text(value).replace(/\\/g, "/");
}

function normalizeRole(value) {
  return text(value)
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.manifestUrl.slice(1)));
}

function localCourseRoot(course) {
  if (!course.baseUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.baseUrl.slice(1)));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(text(value));
}

function isLocalReference(value) {
  const valueText = text(value);
  return Boolean(valueText) && !isHttpUrl(valueText) && !valueText.startsWith("data:");
}

function localPath(courseRoot, relativePath) {
  return normalize(join(courseRoot, relativePath));
}

function hasExistingLocalField(courseRoot, item, fields = ["path", "previewPath", "downloadPath", "packagePath"]) {
  return fields.some((field) => {
    const value = item?.[field];
    return isLocalReference(value) && existsSync(localPath(courseRoot, value));
  });
}

function lowerScope(item) {
  return [
    item?.id,
    item?.label,
    item?.title,
    item?.type,
    item?.role,
    item?.category,
    item?.sourceGroup,
    item?.parentSection,
    item?.path,
    item?.previewPath,
    item?.downloadPath,
    item?.notes,
    item?.description,
    item?.status,
    item?.copyrightStatus,
    item?.sourceStatus,
  ]
    .map((value) => text(value).toLowerCase())
    .join(" ");
}

function addResource(rows, item, context) {
  if (!item || typeof item !== "object") return;
  rows.push({ item, context });
  for (const [index, attachment] of (item.attachments || []).entries()) {
    rows.push({
      item: attachment,
      context: { ...context, scope: `${context.scope}.attachments`, attachmentOf: item.label || item.title || item.path, index },
    });
  }
}

function isResourceLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value.path || value.previewPath || value.downloadPath || value.url || value.label || value.title) &&
      (value.type || value.category || value.role || value.path || value.previewPath || value.downloadPath),
  );
}

function collectTeacherPrepResources(rows, value, context = { scope: "teacherPrep" }, depth = 0) {
  if (!value || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTeacherPrepResources(rows, item, { ...context, index }, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  if (isResourceLike(value)) addResource(rows, value, context);
  for (const [key, child] of Object.entries(value)) {
    if (["textPreview", "html", "content", "body"].includes(key)) continue;
    collectTeacherPrepResources(rows, child, { ...context, scope: `${context.scope}.${key}` }, depth + 1);
  }
}

function collectResources(manifest) {
  const rows = [];
  const add = (item, context) => addResource(rows, item, context);

  for (const [index, item] of (manifest.courseSections || []).entries()) add(item, { scope: "courseSections", index });
  for (const [index, item] of (manifest.courseDownloads || []).entries()) add(item, { scope: "courseDownloads", index });
  for (const [index, item] of (manifest.teacherResources || []).entries()) add(item, { scope: "teacherResources", index });
  for (const [index, item] of (manifest.evaluations || []).entries()) add(item, { scope: "evaluations", index });
  collectTeacherPrepResources(rows, manifest.teacherPrep, { scope: "teacherPrep" });
  for (const [textIndex, textItem] of (manifest.texts || []).entries()) {
    add(textItem, { scope: "texts", textIndex });
    for (const [index, material] of (textItem.materials || []).entries()) add(material, { scope: "texts.materials", textIndex, index });
  }

  for (const unit of manifest.units || []) {
    if (unit.unitPlan) add(unit.unitPlan, { scope: "unit.unitPlan", unit: unit.unit });
    const unitResources = unit.unitResources || {};
    for (const [group, items] of Object.entries(unitResources)) {
      for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
        add(item, { scope: `unit.unitResources.${group}`, unit: unit.unit, index });
      }
    }
    for (const lesson of unit.lessons || []) {
      const base = { unit: unit.unit, lesson: lesson.lesson, lessonId: lesson.id, lessonTitle: lesson.title };
      if (lesson.lessonPlan) add(lesson.lessonPlan, { ...base, scope: "lesson.lessonPlan" });
      for (const [index, item] of (lesson.bookSections || []).entries()) add(item, { ...base, scope: "lesson.bookSections", index });
      for (const [index, item] of (lesson.ispring || []).entries()) add(item, { ...base, scope: "lesson.ispring", index });
      for (const [index, item] of (lesson.downloads || []).entries()) add(item, { ...base, scope: "lesson.downloads", index });
      for (const [index, item] of (lesson.handsOn || []).entries()) add(item, { ...base, scope: "lesson.handsOn", index });
      for (const [index, item] of (lesson.textExports || []).entries()) add(item, { ...base, scope: "lesson.textExports", index });
    }
  }

  return rows;
}

function findLocalCourseOutlineFiles(courseRoot) {
  const plansRoot = join(courseRoot, "plans");
  if (!existsSync(plansRoot)) return [];
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.(docx?|pdf|html?|md)$/i.test(entry.name)) continue;
      const rel = toPosix(relative(courseRoot, fullPath));
      if (/course[_\s-]*(outline|plan)|syllabus/i.test(rel)) {
        found.push({ path: rel, bytes: statSync(fullPath).size });
      }
    }
  };
  walk(plansRoot);
  return found;
}

function compact(item) {
  return {
    label: item?.label || item?.title || item?.path || item?.previewPath || "Resource",
    type: item?.type || "",
    role: item?.role || "",
    category: item?.category || "",
    path: item?.path || "",
    previewPath: item?.previewPath || "",
    downloadPath: item?.downloadPath || "",
  };
}

function rowIdentity(row) {
  const item = row.item;
  return item?.path || item?.previewPath || item?.downloadPath || item?.url || item?.label || item?.title || JSON.stringify(row.context);
}

function uniqueRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = rowIdentity(row).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function isOfficialCurriculum(row) {
  const scope = lowerScope(row.item);
  return /official[_\s-]*curriculum|ontario[_\s-]*curriculum|curriculum/.test(scope) && /\.(pdf|docx?|html?|md)(?:$|[?#]|\s)/i.test(scope);
}

function isCourseOutline(row) {
  const scope = lowerScope(row.item);
  return /course[_\s-]*(outline|plan)|syllabus/.test(scope);
}

function isSourceAudit(row) {
  const scope = lowerScope(row.item);
  return /source[_\s-]*audit|sources\.md|text[_\s-]*and[_\s-]*source/.test(scope);
}

function isTextReference(row) {
  const scope = lowerScope(row.item);
  return /textbook|text[_\s-]*material|public[_\s-]*domain|literary[_\s-]*works|curriculum|source[_\s-]*audit/.test(scope);
}

function isTeacherFacing(row) {
  const scope = lowerScope(row.item);
  return /teacher|answer|solution|rubric|marking|test|quiz|exam|aol|evaluation|lesson[_\s-]*plan|unit[_\s-]*plan/.test(scope);
}

function invalidTextRegistryItems(manifest) {
  return (manifest.texts || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return true;
      if (!text(item.id)) return true;
      if (!text(item.title)) return true;
      if (!Array.isArray(item.units)) return true;
      if (!Array.isArray(item.materials)) return true;
      return false;
    })
    .map(({ item, index }) => ({
      index,
      label: item?.label || item?.title || item?.path || `texts[${index}]`,
      hasId: Boolean(item?.id),
      hasTitle: Boolean(item?.title),
      unitsIsArray: Array.isArray(item?.units),
      materialsIsArray: Array.isArray(item?.materials),
    }));
}

function isPathBearing(row) {
  return ["path", "previewPath", "downloadPath", "packagePath"].some((field) => isLocalReference(row.item?.[field]));
}

function isBadTeacherLabel(row) {
  const scope = lowerScope(row.item);
  return /pdfcoffee|libgen|z-?library|free\.pdf|pirate|torrent/.test(scope);
}

function expectedLessons(manifest) {
  return (manifest.units || []).flatMap((unit) =>
    (unit.lessons || [])
      .filter((lesson) => lesson.planningStatus !== "unit_overview")
      .map((lesson) => ({ unit: unit.unit, lesson: lesson.lesson, id: lesson.id, title: lesson.title, lessonPlan: lesson.lessonPlan })),
  );
}

function sharedLessonPlanPaths(lessons) {
  const counts = new Map();
  for (const lesson of lessons) {
    const path = lesson.lessonPlan?.path || lesson.lessonPlan?.downloadPath || "";
    if (!path) continue;
    counts.set(path, (counts.get(path) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count);
}

function buildAudit(course, manifest, courseRoot) {
  const rows = collectResources(manifest);
  const unique = uniqueRows(rows);
  const localMissing = unique
    .filter(isPathBearing)
    .flatMap((row) =>
      ["path", "previewPath", "downloadPath", "packagePath"]
        .filter((field) => isLocalReference(row.item?.[field]) && !existsSync(localPath(courseRoot, row.item[field])))
        .map((field) => ({ ...compact(row.item), field, value: row.item[field], context: row.context })),
    );

  const units = manifest.units || [];
  const lessons = expectedLessons(manifest);
  const missingUnitPlans = units
    .filter((unit) => !unit.unitPlan || !hasExistingLocalField(courseRoot, unit.unitPlan))
    .map((unit) => ({ unit: unit.unit, title: unit.title || "" }));
  const missingLessonPlans = lessons
    .filter((lesson) => !lesson.lessonPlan || !hasExistingLocalField(courseRoot, lesson.lessonPlan))
    .map((lesson) => ({ unit: lesson.unit, lesson: lesson.lesson, id: lesson.id || "", title: lesson.title || "" }));
  const duplicateLessonPlans = sharedLessonPlanPaths(lessons);

  const curriculum = unique.filter(isOfficialCurriculum);
  const outlines = unique.filter(isCourseOutline);
  const localOutlineFiles = findLocalCourseOutlineFiles(courseRoot);
  const sourceAudits = unique.filter(isSourceAudit);
  const textReferences = unique.filter(isTextReference);
  const teacherResources = unique.filter(isTeacherFacing);
  const badLabels = unique.filter((row) => isTeacherFacing(row) && isBadTeacherLabel(row));
  const invalidTexts = invalidTextRegistryItems(manifest);

  const issues = [];
  const gapSeverity = strictMode ? "error" : "warn";
  if (invalidTexts.length) {
    issues.push(
      issue("error", "teacher-prep-text-registry-shape-invalid", `${invalidTexts.length} texts[] item(s) do not match the front-end TextRegistryEntry shape.`, {
        invalidTexts: invalidTexts.slice(0, 20),
      }),
    );
  }
  if (!curriculum.length) issues.push(issue(gapSeverity, "teacher-prep-official-curriculum-missing", "No official curriculum guidance file is indexed for teacher prep."));
  if (!outlines.length) issues.push(issue(gapSeverity, "teacher-prep-course-outline-missing", "No course outline or course plan is indexed for teacher prep."));
  if (!outlines.length && localOutlineFiles.length) {
    issues.push(
      issue("warn", "teacher-prep-course-outline-file-unindexed", `Found ${localOutlineFiles.length} local course outline/plan file(s) under plans/, but they are not indexed in the manifest.`, {
        localOutlineFiles,
      }),
    );
  }
  if (!sourceAudits.length) issues.push(issue(gapSeverity, "teacher-prep-source-audit-missing", "No source audit or source note file is indexed."));
  if (!textReferences.length) issues.push(issue(gapSeverity, "teacher-prep-text-reference-missing", "No textbook, curriculum, text index, or supplemental text reference is indexed."));
  if (!teacherResources.length) issues.push(issue(gapSeverity, "teacher-prep-teacher-resources-missing", "No teacher-facing answer, rubric, evaluation, test, quiz, lesson plan, or unit plan resource is indexed."));
  if (missingUnitPlans.length) issues.push(issue(gapSeverity, "teacher-prep-unit-plan-gap", `${missingUnitPlans.length} unit plan(s) are missing or point to missing files.`, { missingUnitPlans }));
  if (missingLessonPlans.length) issues.push(issue(gapSeverity, "teacher-prep-lesson-plan-gap", `${missingLessonPlans.length} lesson plan(s) are missing or point to missing files.`, { missingLessonPlans: missingLessonPlans.slice(0, 40) }));
  if (duplicateLessonPlans.length) {
    issues.push(
      issue("warn", "teacher-prep-shared-lesson-plan-path", `${duplicateLessonPlans.length} lesson plan file path(s) are reused by multiple lessons; this often means a unit-level/source plan is being used as a per-lesson plan.`, {
        duplicateLessonPlans: duplicateLessonPlans.slice(0, 20),
      }),
    );
  }
  for (const missing of localMissing.slice(0, 120)) {
    issues.push(issue("error", "teacher-prep-local-path-missing", `${missing.label} references a missing local ${missing.field}: ${missing.value}`, { resource: missing }));
  }
  for (const row of badLabels.slice(0, 40)) {
    issues.push(issue("warn", "teacher-prep-source-label-needs-cleanup", `${compact(row.item).label} contains a source/vendor label that should not be teacher-facing.`, { resource: compact(row.item), context: row.context }));
  }

  const errors = issues.filter((item) => item.severity === "error").length;
  const warnings = issues.filter((item) => item.severity === "warn").length;

  return {
    generatedAt: new Date().toISOString(),
    course: course.code,
    title: manifest.course?.title || manifest.title || course.title || "",
    summary: {
      status: errors ? "fail" : warnings ? "review" : "pass",
      errors,
      warnings,
    },
    counts: {
      units: units.length,
      lessons: lessons.length,
      unitPlans: units.length - missingUnitPlans.length,
      lessonPlans: lessons.length - missingLessonPlans.length,
      officialCurriculum: curriculum.length,
      courseOutlines: outlines.length,
      localCourseOutlineFiles: localOutlineFiles.length,
      sourceAudits: sourceAudits.length,
      textReferences: textReferences.length,
      teacherResources: teacherResources.length,
      localPathMissing: localMissing.length,
      teacherLabelCleanup: badLabels.length,
      invalidTextRegistryItems: invalidTexts.length,
      sharedLessonPlanPaths: duplicateLessonPlans.length,
    },
    samples: {
      officialCurriculum: curriculum.slice(0, 6).map((row) => compact(row.item)),
      courseOutlines: outlines.slice(0, 6).map((row) => compact(row.item)),
      sourceAudits: sourceAudits.slice(0, 6).map((row) => compact(row.item)),
      textReferences: textReferences.slice(0, 10).map((row) => compact(row.item)),
      teacherResources: teacherResources.slice(0, 12).map((row) => compact(row.item)),
    },
    gaps: {
      missingUnitPlans,
      missingLessonPlans,
      missingLocalPaths: localMissing,
      localOutlineFiles,
      teacherLabelCleanup: badLabels.map((row) => ({ resource: compact(row.item), context: row.context })),
      duplicateLessonPlans,
    },
    issues,
  };
}

function issue(severity, rule, message, context = {}) {
  return { severity, rule, message, context };
}

function renderCourseMarkdown(report) {
  return `# ${report.course} Teacher Prep Audit

Generated: ${report.generatedAt}

Status: **${report.summary.status.toUpperCase()}** (${report.summary.errors} errors; ${report.summary.warnings} warnings)

| Item | Count |
| --- | ---: |
| Units | ${report.counts.units} |
| Lessons needing lesson plans | ${report.counts.lessons} |
| Unit plans | ${report.counts.unitPlans}/${report.counts.units} |
| Lesson plans | ${report.counts.lessonPlans}/${report.counts.lessons} |
| Official curriculum files | ${report.counts.officialCurriculum} |
| Course outlines/plans | ${report.counts.courseOutlines} |
| Source audits/notes | ${report.counts.sourceAudits} |
| Text/curriculum references | ${report.counts.textReferences} |
| Teacher-facing resources | ${report.counts.teacherResources} |
| Missing local paths | ${report.counts.localPathMissing} |

## Issues

${report.issues.length ? report.issues.map((item) => `- [${item.severity}] ${item.rule}: ${item.message}`).join("\n") : "- None"}
`;
}

function renderSummaryMarkdown(reports) {
  const rows = reports
    .map(
      (report) =>
        `| ${report.course} | ${report.summary.status} | ${report.summary.errors} | ${report.summary.warnings} | ${report.counts.officialCurriculum} | ${report.counts.courseOutlines} | ${report.counts.unitPlans}/${report.counts.units} | ${report.counts.lessonPlans}/${report.counts.lessons} | ${report.counts.textReferences} | ${report.counts.teacherResources} |`,
    )
    .join("\n");
  const attention = reports
    .filter((report) => report.summary.status !== "pass")
    .map((report) => `- ${report.course}: ${report.issues.slice(0, 3).map((item) => item.rule).join(", ")}`)
    .join("\n");
  return `# Teacher Prep Audit Summary

Generated: ${new Date().toISOString()}

| Course | Status | Errors | Warnings | Curriculum | Course Plan | Unit Plans | Lesson Plans | Texts | Teacher Resources |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## Needs Attention

${attention || "- None"}
`;
}

if (!existsSync(catalogPath)) {
  console.error(`Missing course catalog: ${catalogPath}`);
  process.exit(1);
}

const catalog = readJson(catalogPath);
const requestedSafe = requestedCourse ? safeCourse(requestedCourse) : "";
const courses = requestedSafe ? catalog.courses.filter((course) => safeCourse(course.code) === requestedSafe) : catalog.courses;

if (!courses.length) {
  console.error(`No course found for --course ${requestedCourse}`);
  process.exit(2);
}

const reports = [];
for (const course of courses) {
  const manifestPath = localManifestPath(course);
  const courseRoot = localCourseRoot(course);
  if (!manifestPath || !courseRoot || !existsSync(manifestPath)) {
    reports.push({
      generatedAt: new Date().toISOString(),
      course: course.code,
      title: course.title || "",
      summary: { status: "fail", errors: 1, warnings: 0 },
      counts: {},
      issues: [issue("error", "teacher-prep-manifest-missing", `Missing local manifest for ${course.code}.`)],
    });
    continue;
  }
  reports.push(buildAudit(course, readJson(manifestPath), courseRoot));
}

mkdirSync(join(projectRoot, "deployment"), { recursive: true });
for (const report of reports) {
  const jsonPath = join(projectRoot, "deployment", `${report.course}-teacher-prep-audit.json`);
  const mdPath = join(projectRoot, "deployment", `${report.course}-teacher-prep-audit.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, renderCourseMarkdown(report), "utf8");
  if (!jsonMode) {
    console.log(
      `${report.course}: ${report.summary.status.toUpperCase()} (${report.summary.errors} errors; ${report.summary.warnings} warnings) plans ${report.counts?.lessonPlans ?? 0}/${report.counts?.lessons ?? 0}; texts ${report.counts?.textReferences ?? 0}; teacher resources ${report.counts?.teacherResources ?? 0}`,
    );
  }
}

if (!requestedSafe) {
  const summary = { generatedAt: new Date().toISOString(), reports };
  writeFileSync(join(projectRoot, "deployment", "teacher-prep-audit-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(join(projectRoot, "deployment", "teacher-prep-audit-summary.md"), renderSummaryMarkdown(reports), "utf8");
}

if (jsonMode) {
  console.log(JSON.stringify(requestedSafe ? reports[0] : { generatedAt: new Date().toISOString(), reports }, null, 2));
}

process.exit(reports.some((report) => report.summary.status === "fail") ? 1 : 0);
