import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BOH4M";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function bytes(relativePath) {
  const abs = join(courseRoot, relativePath);
  return existsSync(abs) ? statSync(abs).size : undefined;
}

function moodleUrl(mod, id) {
  return `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`;
}

function activity(label, mod, id, role, category = `moodle_${mod}`, extra = {}) {
  return {
    label,
    type: "html",
    category,
    role,
    url: moodleUrl(mod, id),
    source: moodleUrl(mod, id),
    ...extra,
  };
}

function h5p(label, id, unit, lesson) {
  return activity(label, "h5pactivity", id, "lesson_h5p", "moodle_h5pactivity", {
    unit,
    lesson,
  });
}

function resourceKey(item) {
  const source = item?.source || item?.url || "";
  if (source) {
    try {
      const parsed = new URL(source);
      return parsed.toString();
    } catch {
      return source;
    }
  }
  return `${item?.role || ""}|${item?.label || ""}|${item?.path || ""}`;
}

function mergeBySource(existing, incoming) {
  const byKey = new Map();
  for (const item of existing || []) byKey.set(resourceKey(item), item);
  for (const item of incoming) {
    const key = resourceKey(item);
    byKey.set(key, { ...(byKey.get(key) || {}), ...item });
  }
  return [...byKey.values()];
}

function unitByNumber(manifest, unitNumber) {
  const unit = (manifest.units || []).find((entry) => Number(entry.unit) === unitNumber);
  if (!unit) throw new Error(`Missing Unit ${unitNumber}`);
  unit.unitResources ||= {};
  for (const key of ["evaluations", "reflectionAndLogs", "lessonDropboxes", "answerPages", "additional"]) {
    unit.unitResources[key] ||= [];
  }
  return unit;
}

function assignList(unitNumber, ids, role, labelFactory, category = "moodle_assign") {
  return ids.map((id, index) => activity(labelFactory(index + 1), "assign", id, role, category, { unit: unitNumber }));
}

function pageList(unitNumber, ids, role, labelFactory) {
  return ids.map((id, index) => activity(labelFactory(index + 1), "page", id, role, "moodle_page", { unit: unitNumber }));
}

const unitActivities = {
  1: {
    evaluations: [
      activity("Unit 1 - Assignment 1 (AOL)", "assign", 7382, "aol_assessment", "moodle_assign", { unit: 1 }),
      activity("Unit 1 - Assignment 2 (AOL)", "assign", 7383, "aol_assessment", "moodle_assign", { unit: 1 }),
      activity("Unit 1 - Test (AOL)", "quiz", 7384, "aol_assessment", "moodle_quiz", { unit: 1 }),
    ],
    lessonDropboxes: assignList(1, [7386, 7388, 7390, 7392, 7394, 7396, 7398], "lesson_dropbox", (lesson) => `Unit 1 - Lesson ${lesson}`),
    answerPages: pageList(1, [7387, 7389, 7391, 7393, 7395, 7397], "lesson_answer_page", (lesson) => `Unit 1 - Lesson ${lesson} Answer`),
    reflectionAndLogs: [
      activity("Unit 1 - KWL Dropbox", "assign", 7399, "kwl_dropbox", "moodle_assign", { unit: 1 }),
      activity("Unit 1 - Reflection Summary Dropbox", "assign", 7400, "reflection_summary", "moodle_assign", { unit: 1 }),
    ],
  },
  2: {
    evaluations: [
      activity("Unit 2 - Assignment 1 (AOL)", "assign", 7405, "aol_assessment", "moodle_assign", { unit: 2 }),
      activity("Unit 2 - Assignment 2 (AOL)", "assign", 7406, "aol_assessment", "moodle_assign", { unit: 2 }),
      activity("Unit 2 - Test (AOL)", "quiz", 7408, "aol_assessment", "moodle_quiz", { unit: 2 }),
    ],
    lessonDropboxes: assignList(2, [7410, 7412, 7414, 7416, 7418, 7420, 7422], "lesson_dropbox", (lesson) => `Unit 2 - Lesson ${lesson}`),
    answerPages: pageList(2, [7411, 7413, 7415, 7417, 7419, 7421, 7423], "lesson_answer_page", (lesson) => `Unit 2 - Lesson ${lesson} Answer`),
    reflectionAndLogs: [
      activity("Unit 2 - KWL Dropbox", "assign", 7424, "kwl_dropbox", "moodle_assign", { unit: 2 }),
      activity("Unit 2 - Reflection Summary Dropbox", "assign", 7425, "reflection_summary", "moodle_assign", { unit: 2 }),
    ],
  },
  3: {
    evaluations: [
      activity("Unit 3 - Assignment 1 (AOL)", "assign", 7429, "aol_assessment", "moodle_assign", { unit: 3 }),
      activity("Unit 3 - Assignment 2 (AOL)", "assign", 7430, "aol_assessment", "moodle_assign", { unit: 3 }),
      activity("Unit 3 - Test (AOL)", "quiz", 7431, "aol_assessment", "moodle_quiz", { unit: 3 }),
    ],
    lessonDropboxes: assignList(3, [7433, 7435, 7437, 7439, 7441], "lesson_dropbox", (lesson) => `Unit 3 - Lesson ${lesson}`),
    answerPages: pageList(3, [7434, 7436, 7438, 7440, 7442], "lesson_answer_page", (lesson) => `Unit 3 - Lesson ${lesson} Answer`),
    reflectionAndLogs: [
      activity("Unit 3 - KWL Dropbox", "assign", 7443, "kwl_dropbox", "moodle_assign", { unit: 3 }),
      activity("Unit 3 - Reflection Summary Dropbox", "assign", 7444, "reflection_summary", "moodle_assign", { unit: 3 }),
    ],
  },
  4: {
    evaluations: [
      activity("Unit 4 - Assignment 1 (AOL)", "assign", 7449, "aol_assessment", "moodle_assign", { unit: 4 }),
      activity("Unit 4 - Assignment 2 (AOL)", "assign", 7450, "aol_assessment", "moodle_assign", { unit: 4 }),
      activity("Unit 4 - Test (AOL)", "quiz", 7451, "aol_assessment", "moodle_quiz", { unit: 4 }),
    ],
    lessonDropboxes: assignList(4, [7453, 7455, 7457, 7459, 7461, 7463, 7465, 7467, 7469], "lesson_dropbox", (lesson) => `Unit 4 - Lesson ${lesson}`),
    answerPages: pageList(4, [7454, 7456, 7458, 7460, 7462, 7464, 7466, 7468, 7470], "lesson_answer_page", (lesson) => `Unit 4 - Lesson ${lesson} Answer`),
    reflectionAndLogs: [
      activity("Unit 4 - KWL Dropbox", "assign", 7471, "kwl_dropbox", "moodle_assign", { unit: 4 }),
      activity("Unit 4 - Reflection Summary Dropbox", "assign", 7472, "reflection_summary", "moodle_assign", { unit: 4 }),
    ],
    additional: [
      h5p("Unit 4 - Lesson 1 H5P", 7473, 4, 1),
      h5p("Unit 4 - Lesson 2 H5P", 7474, 4, 2),
      h5p("Unit 4 - Lesson 3 H5P", 7475, 4, 3),
      h5p("Unit 4 - Lesson 4 H5P", 7476, 4, 4),
      h5p("Unit 4 - Lesson 5 H5P", 7477, 4, 5),
      h5p("Unit 4 - Lesson 6 H5P", 7478, 4, 6),
      h5p("Unit 4 - Lesson 7 H5P", 7479, 4, 7),
    ],
  },
  5: {
    evaluations: [
      activity("Unit 5 - Assignment 1 (AOL)", "assign", 7483, "aol_assessment", "moodle_assign", { unit: 5 }),
      activity("Unit 5 - Assignment 2 (AOL)", "assign", 7484, "aol_assessment", "moodle_assign", { unit: 5 }),
      activity("Unit 5 - Test (AOL)", "quiz", 7485, "aol_assessment", "moodle_quiz", { unit: 5 }),
    ],
    lessonDropboxes: assignList(5, [7487, 7489, 7491, 7493], "lesson_dropbox", (lesson) => `Unit 5 - Lesson ${lesson}`),
    answerPages: pageList(5, [7488, 7490, 7492, 7494], "lesson_answer_page", (lesson) => `Unit 5 - Lesson ${lesson} Answer`),
    reflectionAndLogs: [
      activity("Unit 5 - KWL Dropbox", "assign", 7495, "kwl_dropbox", "moodle_assign", { unit: 5 }),
      activity("Unit 5 - Reflection Summary Dropbox", "assign", 7496, "reflection_summary", "moodle_assign", { unit: 5 }),
    ],
  },
};

const manifest = readJson(manifestPath);
manifest.course ||= {};
manifest.course.code = course;
manifest.course.title = "BOH4M · Business Leadership: Management Fundamentals";
manifest.course.audience ||= "Teachers preparing OSSD lessons";
manifest.course.source ||= "SunnyBrook Moodle offline courseware";
manifest.navigation ||= { primary: "unit", secondary: "lesson" };

const originalCourseDownloads = (manifest.courseDownloads || []).filter(
  (item) => item.role !== "course_outline" && item.category !== "source_audit",
);

const courseDownloads = [
  activity("BOH4M Course Outline", "assign", 7377, "course_outline", "moodle_assign"),
  activity("Learning Log", "assign", 7378, "learning_log", "moodle_assign"),
  activity("Exam Submission Dropbox", "assign", 7497, "final_exam_submission", "moodle_assign"),
  activity("Culminating Submission Dropbox", "assign", 7498, "culminating_submission", "moodle_assign"),
];

const curriculumPath = "texts/ontario-curriculum/business1112currb.pdf";
if (existsSync(join(courseRoot, curriculumPath))) {
  courseDownloads.push({
    label: "The Ontario Curriculum, Grades 11 and 12: Business Studies, 2006 (Revised)",
    type: "pdf",
    category: "official_curriculum",
    role: "curriculum_reference",
    path: curriculumPath,
    bytes: bytes(curriculumPath),
    source: "https://www.edu.gov.on.ca/eng/curriculum/secondary/business1112currb.pdf",
  });
}

manifest.courseDownloads = mergeBySource(originalCourseDownloads, courseDownloads);

const teacherResources = [
  activity("Answer Keys", "assign", 7531, "answer_keys", "moodle_assign"),
];

for (const [unitText, groups] of Object.entries(unitActivities)) {
  const unitNumber = Number(unitText);
  const unit = unitByNumber(manifest, unitNumber);
  for (const [key, items] of Object.entries(groups)) {
    unit.unitResources[key] = mergeBySource(unit.unitResources[key] || [], items);
  }
  teacherResources.push(...unit.unitResources.evaluations, ...unit.unitResources.answerPages);
  unit.summary ||= {};
  unit.summary.unitResources = Object.values(unit.unitResources).flat().length;
}

manifest.teacherResources = mergeBySource(manifest.teacherResources || [], teacherResources);

let removedIspringDownloadFields = 0;
let ispringPlayable = 0;
for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.ispring || []) {
      if (item.path) ispringPlayable += 1;
      if ("downloadPath" in item) {
        delete item.downloadPath;
        removedIspringDownloadFields += 1;
      }
      if ("downloadUrl" in item) {
        delete item.downloadUrl;
        removedIspringDownloadFields += 1;
      }
      delete item.downloadBytes;
    }
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.moodleCourseId = 71;
manifest.sourceAudit.coursePage = "https://www.esunnybrook.com/course/view.php?id=71";
manifest.sourceAudit.courseActivitiesPatchedAt = new Date().toISOString();
manifest.sourceAudit.courseActivitiesPatched = {
  courseDownloads: courseDownloads.length,
  unitResources: Object.values(unitActivities).reduce((sum, groups) => sum + Object.values(groups).flat().length, 0),
  teacherResources: teacherResources.length,
  exitCardsExcluded: 32,
  note: "Course, final, teacher packet, unit AOL/test, KWL/reflection, lesson dropbox, lesson answer, and Unit 4 H5P activity records were created from the Moodle course shell. Exit Cards remain excluded from teacher core structure.",
};
manifest.sourceAudit.ispringDownloadPackages = 0;
manifest.sourceAudit.ispringPlayable = ispringPlayable;
manifest.sourceAudit.removedIspringDownloadFields = removedIspringDownloadFields;
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

if (existsSync(catalogPath)) {
  const catalog = readJson(catalogPath);
  const row = (catalog.courses || catalog).find((entry) => entry.code === course);
  if (row) {
    row.status = "ready";
    row.notes = "Moodle book lessons, localized iSpring, Moodle course/final/teacher/unit activities, documents/PDFs, official curriculum, and source audit are prepared; iSpring/video playback resources are non-downloadable.";
    writeJson(catalogPath, catalog);
  }
}

console.log(JSON.stringify({
  course,
  courseDownloads: manifest.courseDownloads.length,
  teacherResources: manifest.teacherResources.length,
  unitResources: manifest.units.reduce((sum, unit) => sum + Object.values(unit.unitResources || {}).flat().length, 0),
  removedIspringDownloadFields,
}, null, 2));
