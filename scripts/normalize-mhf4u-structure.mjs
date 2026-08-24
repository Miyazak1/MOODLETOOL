import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = resolve(workspaceRoot, "courseware", "MHF4U", "course-manifest.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const before = {
  courseDownloads: (manifest.courseDownloads || []).length,
  teacherResources: (manifest.teacherResources || []).length,
  evaluations: (manifest.evaluations || []).length,
};

const courseSectionPaths = new Set((manifest.courseSections || []).map((item) => item.path).filter(Boolean));
const removedCourseSectionDownloads = [];

manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => {
  if (item?.path && courseSectionPaths.has(item.path)) {
    removedCourseSectionDownloads.push(item.label || item.title || item.path);
    return false;
  }
  return true;
});

function normalizeEvaluation(item, unitNumber) {
  if (!item || typeof item !== "object") return item;
  const label = item.label || item.title || "";
  const evaluationType =
    item.evaluationType ||
    (/quiz/i.test(label) ? "quiz" : /test/i.test(label) ? "test" : /assignment/i.test(label) ? "assignment" : "evaluation");
  return {
    ...item,
    role: "evaluation",
    evaluationType,
    parentSection: item.parentSection || "Evaluation",
    sourceGroup: item.sourceGroup || "evaluation",
    teacherUse: item.teacherUse || "student_evaluation",
    unit: item.unit || unitNumber,
  };
}

function normalizeCourseSection(item) {
  if (!item || typeof item !== "object") return item;
  const role = item.role || "";
  if (role === "course_overview" || /course-overview/i.test(item.path || "")) {
    return {
      ...item,
      role: "course_overview",
      parentSection: item.parentSection || "Course Overview",
      sourceGroup: item.sourceGroup || "course_overview",
    };
  }
  if (role === "final_examination" || role === "final_examination_culminating" || /final-examination/i.test(item.path || "")) {
    return {
      ...item,
      parentSection: item.parentSection || "Final Examination & Culminating",
      sourceGroup: item.sourceGroup || "final_examination_culminating",
    };
  }
  if (role === "introduction") {
    return {
      ...item,
      parentSection: item.parentSection || "Course Introduction",
      sourceGroup: item.sourceGroup || "course_introduction",
    };
  }
  return item;
}

function normalizeCourseDownload(item) {
  if (!item || typeof item !== "object") return item;
  const role = item.role || "";
  if (role === "course_outline") {
    return {
      ...item,
      parentSection: item.parentSection || "Course Resources",
      sourceGroup: item.sourceGroup || "course_resources",
    };
  }
  if (role === "learning_log") {
    return {
      ...item,
      parentSection: item.parentSection || "Course Resources",
      sourceGroup: item.sourceGroup || "course_resources",
    };
  }
  if (role === "final_exam_submission" || role === "culminating_assignment" || role === "exam_review") {
    return {
      ...item,
      parentSection: item.parentSection || "Final Examination & Culminating",
      sourceGroup: item.sourceGroup || "final_examination_culminating",
    };
  }
  if (role === "core_text" || role === "curriculum_reference" || role === "textbook_reference" || role === "source_audit") {
    return {
      ...item,
      parentSection: item.parentSection || "Course Resources",
      sourceGroup: item.sourceGroup || "course_resources",
    };
  }
  return item;
}

function normalizeReflectionOrLog(item, unitNumber) {
  if (!item || typeof item !== "object") return item;
  const haystack = `${item.category || ""} ${item.role || ""} ${item.label || item.title || ""}`;
  const isReflectionOrLog = /kwl|reflection|log|moodle_assign|dropbox/i.test(haystack);
  return {
    ...item,
    parentSection: item.parentSection || (isReflectionOrLog ? "Reflection and Logs" : item.parentSection),
    sourceGroup: item.sourceGroup || (isReflectionOrLog ? "reflection_and_logs" : item.sourceGroup),
    unit: item.unit || unitNumber,
  };
}

manifest.courseSections = (manifest.courseSections || []).map(normalizeCourseSection);
manifest.courseDownloads = (manifest.courseDownloads || []).map(normalizeCourseDownload);

for (const unit of manifest.units || []) {
  const unitNumber = Number(unit.unit);
  if (unit.unitResources?.evaluations) {
    unit.unitResources.evaluations = unit.unitResources.evaluations.map((item) =>
      normalizeEvaluation(item, unitNumber),
    );
  }
  if (unit.unitResources?.reflectionAndLogs) {
    unit.unitResources.reflectionAndLogs = unit.unitResources.reflectionAndLogs.map((item) =>
      normalizeReflectionOrLog(item, unitNumber),
    );
  }
}

const evaluations = [];
const seenEvaluations = new Set();
for (const unit of manifest.units || []) {
  for (const item of unit.unitResources?.evaluations || []) {
    const key = item.path || item.moodleActivityId || item.source || item.label;
    if (!key || seenEvaluations.has(key)) continue;
    seenEvaluations.add(key);
    evaluations.push({ ...item });
  }
}
manifest.evaluations = evaluations;

const removedTeacherResourceLabels = [];
manifest.teacherResources = (manifest.teacherResources || []).filter((item) => {
  const haystack = `${item.role || ""} ${item.category || ""} ${item.parentSection || ""} ${
    item.sourceGroup || ""
  } ${item.label || item.title || ""}`;
  const isTeacherPacket = /teacher_packet|answer key|teacher-only|lesson plan/i.test(haystack);
  const isStudentOrEvaluation =
    /aol|evaluation|quiz|test|assignment|final_exam_submission|final exam|moodle_quiz/i.test(haystack);
  const keep = isTeacherPacket && !isStudentOrEvaluation;
  if (!keep) removedTeacherResourceLabels.push(item.label || item.title || item.path || "unnamed");
  return keep;
});

manifest.courseSections = (manifest.courseSections || []).map(normalizeCourseSection);
manifest.courseDownloads = (manifest.courseDownloads || []).map(normalizeCourseDownload);

manifest.navigation = {
  ...(manifest.navigation || {}),
  primary: "unit",
  secondary: "lesson",
  structureLabel: "Moodle Course Resources",
};

manifest.sourceAudit ||= {};
manifest.sourceAudit.mhf4uStructureNormalization = {
  patchedAt: new Date().toISOString(),
  reference: "MDM4U manifest field ownership in docs/MOODLE_COURSE_IMPORT_DISPLAY_RULES.md",
  changed: {
    courseDownloadsBefore: before.courseDownloads,
    courseDownloadsAfter: manifest.courseDownloads.length,
    teacherResourcesBefore: before.teacherResources,
    teacherResourcesAfter: manifest.teacherResources.length,
    evaluationsBefore: before.evaluations,
    evaluationsAfter: manifest.evaluations.length,
    removedCourseSectionDownloads,
    removedTeacherResourceLabels,
    courseLevelMetadataNormalized: true,
    reflectionMetadataNormalized: true,
  },
  notes:
    "Normalized structure only: course-level HTML remains in courseSections; Course Overview is not counted as Course Introduction without St.Mary section 0 evidence; Unit AOL resources remain under unitResources.evaluations and the top-level evaluations index; teacherResources is reserved for source-proven Teacher Packet materials.",
};
manifest.generatedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest.sourceAudit.mhf4uStructureNormalization, null, 2));
