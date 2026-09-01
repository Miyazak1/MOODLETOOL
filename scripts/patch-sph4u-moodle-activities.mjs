import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const courseRoot = join(workspaceRoot, "courseware", "SPH4U");
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function activity(mod, id, label, role, category = "moodle_activity") {
  return {
    label,
    type: "html",
    category,
    role,
    source: "Moodle course activity",
    url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    moodleActivityId: String(id),
    mod,
  };
}

function assignment(id, label, role = "assignment") {
  return activity("assign", id, label, role, "moodle_assign");
}

function page(id, label, role = "answer_key") {
  return activity("page", id, label, role, "moodle_page");
}

function quiz(id, label) {
  return activity("quiz", id, label, "quiz", "moodle_quiz");
}

function resource(id, label, role) {
  return activity("resource", id, label, role, "moodle_resource");
}

function keyOf(item) {
  if (item?.mod && item?.moodleActivityId) return `${item.mod}:${item.moodleActivityId}`;
  return item.url || item.path || item.source || `${item.role}:${item.label}`;
}

function mergeItems(existing, additions) {
  const byKey = new Map((existing || []).map((item) => [keyOf(item), item]));
  for (const item of additions) {
    const previous = byKey.get(keyOf(item));
    byKey.set(keyOf(item), previous ? { ...item, ...previous } : item);
  }
  return [...byKey.values()];
}

function findUnit(manifest, unitNumber) {
  const unit = (manifest.units || []).find((entry) => Number(entry.unit) === unitNumber);
  if (!unit) throw new Error(`Missing unit ${unitNumber}`);
  return unit;
}

function findLesson(manifest, unitNumber, lessonNumber) {
  const unit = findUnit(manifest, unitNumber);
  const lesson = (unit.lessons || []).find((entry) => Number(entry.lesson) === lessonNumber);
  if (!lesson) throw new Error(`Missing U${unitNumber}L${lessonNumber}`);
  return { unit, lesson };
}

const manifest = readJson(manifestPath);

const courseDownloads = [
  resource(9037, "Lab Report Template", "lab_template"),
  assignment(9038, "SPH4U Course Outline", "course_outline"),
  assignment(9039, "Learning Log", "learning_log"),
  assignment(9043, "Unit 1 - Lab", "unit_lab"),
  quiz(9044, "Unit 1 - Test 1"),
  quiz(9045, "Unit 1 - Test 2"),
  assignment(9060, "Unit 1 - KWL Dropbox", "kwl_dropbox"),
  assignment(9061, "Unit 1 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(9072, "Unit 2 - Lab", "unit_lab"),
  quiz(9073, "Unit 2 - Test 1"),
  quiz(9074, "Unit 2 - Test 2"),
  assignment(9088, "Unit 2 - KWL Dropbox", "kwl_dropbox"),
  assignment(9089, "Unit 2 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(9098, "Unit 3 - Lab", "unit_lab"),
  quiz(9099, "Unit 3 - Test 1"),
  quiz(9100, "Unit 3 - Test 2"),
  assignment(9116, "Unit 3 - KWL Dropbox", "kwl_dropbox"),
  assignment(9117, "Unit 3 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(9128, "Unit 4 - Lab", "unit_lab"),
  quiz(9129, "Unit 4 - Test 1"),
  quiz(9130, "Unit 4 - Test 2"),
  assignment(9142, "Unit 4 - KWL Dropbox", "kwl_dropbox"),
  assignment(9143, "Unit 4 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(9152, "Unit 5 - Lab", "unit_lab"),
  quiz(9153, "Unit 5 - Test 1"),
  quiz(9154, "Unit 5 - Test 2"),
  page(9486, "Unit 5 - KWL Dropbox", "kwl_dropbox"),
  page(9487, "Unit 5 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(9497, "Culminating", "culminating_submission"),
  assignment(9498, "Final Exam Submission Dropbox", "final_exam_submission"),
  assignment(9178, "Answer Keys", "answer_keys"),
];

const lessonActivities = {
  1: [
    [1, 9047, 9048],
    [2, 9049, 9050],
    [3, 9051, 9052],
    [4, 9053, 9054],
    [5, 9055, null],
    [6, 9056, 9057],
    [7, 9058, 9059],
  ],
  2: [
    [1, 9076, 9077],
    [2, 9078, 9079],
    [3, 9080, 9081],
    [4, 9082, 9083],
    [5, 9084, 9085],
    [6, 9086, 9087],
  ],
  3: [
    [1, 9102, 9103],
    [2, 9104, 9105],
    [3, 9106, 9107],
    [4, 9108, 9109],
    [5, 9110, 9111],
    [6, 9112, 9113],
    [7, 9114, 9115],
  ],
  4: [
    [1, 9132, 9133],
    [2, 9134, 9135],
    [3, 9136, 9137],
    [4, 9138, 9139],
    [5, 9140, 9141],
  ],
  5: [
    [1, 9156, 9157],
    [2, 9158, 9159],
    [3, 9160, null],
    [4, 9161, null],
    [5, 9162, 9163],
    [6, 9164, 9165],
    [7, 9166, 9167],
    [8, 9168, 9169],
  ],
};

manifest.courseDownloads = mergeItems(manifest.courseDownloads || [], courseDownloads);

let lessonActivityCount = 0;
for (const [unitText, rows] of Object.entries(lessonActivities)) {
  const unitNumber = Number(unitText);
  for (const [lessonNumber, assignId, answerId] of rows) {
    const { lesson } = findLesson(manifest, unitNumber, lessonNumber);
    const labelPrefix = `Unit ${unitNumber} - Lesson ${lessonNumber}`;
    const additions = [
      assignment(assignId, labelPrefix, "submission_activity"),
      answerId ? page(answerId, `${labelPrefix} (Answer)`, "answer_key") : null,
    ].filter(Boolean);
    lesson.downloads = mergeItems(lesson.downloads || [], additions);
    lessonActivityCount += additions.length;
  }
}

for (const unit of manifest.units || []) {
  let downloads = 0;
  for (const lesson of unit.lessons || []) {
    downloads += (lesson.downloads || []).length;
    lesson.resourceCounts = {
      ...(lesson.resourceCounts || {}),
      downloads: (lesson.downloads || []).length,
      bookSections: lesson.bookPageCount || lesson.bookSections?.length || 0,
      ispring: lesson.ispring?.length || 0,
    };
  }
  unit.summary = {
    ...(unit.summary || {}),
    downloads,
    ispring: unit.lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0),
  };
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  moodleCoursePageActivities: {
    courseDownloads: courseDownloads.length,
    lessonActivities: lessonActivityCount,
    note: "Authenticated Moodle course page activity links patched from course/view.php?id=84.",
  },
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course: "SPH4U",
  courseDownloads: manifest.courseDownloads.length,
  lessonActivityCount,
}, null, 2));
