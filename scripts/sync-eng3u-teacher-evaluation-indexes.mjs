import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function clone(item) {
  return JSON.parse(JSON.stringify(item));
}

function statRecord(item) {
  if (item?.path) {
    try {
      item.bytes = statSync(join(courseRoot, item.path)).size;
    } catch {
      item.bytes = item.bytes || 0;
    }
  }
  for (const attachment of item?.attachments || []) statRecord(attachment);
  return item;
}

function courseItemByRole(manifest, role) {
  return (manifest.courseDownloads || []).find((item) => item.role === role);
}

const manifest = readJson(manifestPath);
const evaluations = [];
const teacherResources = [];
let reflectionAndLogActivities = 0;

for (const unit of manifest.units || []) {
  const unitEvaluations = (unit.unitResources?.evaluations || []).map((item) => ({ ...clone(item), unit: unit.unit }));
  const unitReflection = (unit.unitResources?.reflectionAndLogs || []).map((item) => ({ ...clone(item), unit: unit.unit }));
  evaluations.push(...unitEvaluations.map(statRecord));
  reflectionAndLogActivities += unitReflection.length;
  teacherResources.push(
    ...unitEvaluations.map((item) =>
      statRecord({
        ...clone(item),
        teacherUse: item.role === "aol_quiz" ? "rubric_and_quiz_review" : "assessment_preparation",
      }),
    ),
  );
  teacherResources.push(
    ...unitReflection.map((item) =>
      statRecord({
        ...clone(item),
        teacherUse: item.role === "reflection_dropbox" ? "reflection_review" : "learning_progress_review",
      }),
    ),
  );
}

for (const role of ["teacher_packet", "answer_keys", "final_examination_culminating", "culminating_assignment", "final_exam_submission", "culminating_submission", "learning_log", "course_overview"]) {
  const item = courseItemByRole(manifest, role) || (manifest.courseSections || []).find((section) => section.role === role);
  if (item) teacherResources.unshift(statRecord(clone(item)));
}

manifest.evaluations = evaluations;
manifest.teacherResources = teacherResources;
manifest.sourceAudit ||= {};
manifest.sourceAudit.eng3uTeacherEvaluationPatch = {
  ...(manifest.sourceAudit.eng3uTeacherEvaluationPatch || {}),
  syncedAt: new Date().toISOString(),
  courseSections: (manifest.courseSections || []).length,
  evaluations: evaluations.length,
  reflectionAndLogActivities,
  teacherResources: teacherResources.length,
  exitCardsExcluded: true,
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(
  JSON.stringify(
    {
      course,
      evaluations: evaluations.length,
      reflectionAndLogActivities,
      teacherResources: teacherResources.length,
      teacherResourcesWithPath: teacherResources.filter((item) => item.path).length,
      evaluationAttachments: evaluations.reduce((sum, item) => sum + (item.attachments || []).length, 0),
    },
    null,
    2,
  ),
);
