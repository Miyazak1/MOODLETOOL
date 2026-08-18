import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const courseRoot = join(workspaceRoot, "courseware", "SCH4U");
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

function h5p(id, label) {
  return activity("h5pactivity", id, label, "h5p_activity", "moodle_h5pactivity");
}

function resource(id, label, role) {
  return activity("resource", id, label, role, "moodle_resource");
}

function keyOf(item) {
  return item.url || `${item.role}:${item.label}`;
}

function mergeItems(existing, additions) {
  const byKey = new Map((existing || []).map((item) => [keyOf(item), item]));
  for (const item of additions) {
    const previous = byKey.get(keyOf(item));
    byKey.set(keyOf(item), previous ? { ...item, ...previous } : item);
  }
  return [...byKey.values()];
}

function findLesson(manifest, unitNumber, lessonNumber) {
  const unit = (manifest.units || []).find((entry) => Number(entry.unit) === unitNumber);
  if (!unit) throw new Error(`Missing unit ${unitNumber}`);
  const lesson = (unit.lessons || []).find((entry) => Number(entry.lesson) === lessonNumber);
  if (!lesson) throw new Error(`Missing U${unitNumber}L${lessonNumber}`);
  return { unit, lesson };
}

const manifest = readJson(manifestPath);

const courseDownloads = [
  resource(8734, "Lab report template", "lab_template"),
  assignment(8735, "SCH4U Course Outline", "course_outline"),
  assignment(8736, "Learning Log", "learning_log"),
  assignment(8740, "Unit 1 - Lab (AOL)", "unit_lab"),
  quiz(8741, "Unit 1 - Quiz (AOL)"),
  quiz(8742, "Unit 1 - Test (AOL)"),
  assignment(8765, "Unit 1 - KWL Dropbox", "kwl_dropbox"),
  assignment(8766, "Unit 1 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(8767, "Unit 1 - Exit Card Dropbox", "exit_card_dropbox"),
  assignment(8782, "Unit 2 - Lab (AOL)", "unit_lab"),
  quiz(8783, "Unit 2 - Quiz (AOL)"),
  quiz(8784, "Unit 2 - Test (AOL)"),
  assignment(8806, "Unit 2 - KWL Dropbox", "kwl_dropbox"),
  assignment(8807, "Unit 2 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(8808, "Unit 2 - Exit Card Dropbox", "exit_card_dropbox"),
  assignment(8822, "Unit 3 - Lab (AOL)", "unit_lab"),
  quiz(8823, "Unit 3 - Quiz (AOL)"),
  quiz(8824, "Unit 3 - Test (AOL)"),
  assignment(8846, "Unit 3 - KWL Dropbox", "kwl_dropbox"),
  assignment(8847, "Unit 3 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(8848, "Unit 3 - Exit Card Dropbox", "exit_card_dropbox"),
  assignment(8862, "Unit 4 - Lab (AOL)", "unit_lab"),
  quiz(8863, "Unit 4 - Quiz (AOL)"),
  quiz(8864, "Unit 4 - Test (AOL)"),
  assignment(8880, "Unit 4 - KWL Dropbox", "kwl_dropbox"),
  assignment(8881, "Unit 4 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(8882, "Unit 4 - Exit Card Dropbox", "exit_card_dropbox"),
  assignment(8893, "Unit 5 - Lab (AOL)", "unit_lab"),
  quiz(8894, "Unit 5 - Quiz (AOL)"),
  assignment(8895, "Unit 5 - Assignment", "unit_assignment"),
  quiz(8896, "Unit 5 - Test (AOL)"),
  assignment(8913, "Unit 5 - KWL Dropbox", "kwl_dropbox"),
  assignment(8914, "Unit 5 - Reflection Summary Dropbox", "reflection_dropbox"),
  assignment(8915, "Unit 5 - Exit Card Dropbox", "exit_card_dropbox"),
  assignment(8924, "Exam Submission Dropbox", "exam_submission"),
  assignment(8925, "Culminating Submission Dropbox", "culminating_submission"),
  assignment(8926, "Answer Keys", "answer_keys"),
];

const lessonActivities = {
  1: [
    [1, 8744, 8745, 8768],
    [2, 8746, null, 8769],
    [3, 8747, 8748, 8770],
    [4, 8749, 8750, 8771],
    [5, 8751, 8752, 8772],
    [6, 8753, 8754, 8773],
    [7, 8755, 8756, 8774],
    [8, 8757, 8758, 8775],
    [9, 8759, 8760, 8776],
    [10, 8761, 8762, 8777],
    [11, 8763, 8764, 8778],
  ],
  2: [
    [1, 8786, 8787, 8809],
    [2, 8788, 8789, 8810],
    [3, 8790, 8791, 8811],
    [4, 8792, 8793, 8812],
    [5, 8794, 8795, 8813],
    [6, 8796, 8797, 8814],
    [7, 8798, 8799, 8815],
    [8, 8800, 8801, 8816],
    [9, 8802, 8803, 8817],
    [10, 8804, 8805, 8818],
  ],
  3: [
    [1, 8826, 8827, 8849],
    [2, 8828, 8829, 8850],
    [3, 8830, 8831, 8851],
    [4, 8832, 8833, 8852],
    [5, 8834, 8835, 8853],
    [6, 8836, 8837, 8854],
    [7, 8838, 8839, 8855],
    [8, 8840, 8841, 8856],
    [9, 8842, 8843, 8857],
    [10, 8844, 8845, 8858],
  ],
  4: [
    [1, 8866, 8867, 8883],
    [2, 8868, 8869, 8884],
    [3, 8870, 8871, 8885],
    [4, 8872, 8873, 8886],
    [5, 8874, 8875, 8887],
    [6, 8876, 8877, 8888],
    [7, 8878, 8879, 8889],
  ],
  5: [
    [1, 8898, 8899, 8916],
    [2, 8900, 8901, 8917],
    [3, 8902, 8903, 8918],
    [4, 8904, 8905, 8919],
    [5, 8906, null, 8920],
    [6, 8907, 8908, 8921],
    [7, 8909, 8910, 8922],
    [8, 8911, 8912, 8923],
  ],
};

manifest.courseDownloads = mergeItems(manifest.courseDownloads || [], courseDownloads);

let lessonActivityCount = 0;
for (const [unitText, rows] of Object.entries(lessonActivities)) {
  const unitNumber = Number(unitText);
  for (const [lessonNumber, assignId, answerId, h5pId] of rows) {
    const { lesson } = findLesson(manifest, unitNumber, lessonNumber);
    const labelPrefix = `Unit ${unitNumber} - Lesson ${lessonNumber}`;
    const additions = [
      assignment(assignId, labelPrefix, "submission_activity"),
      answerId ? page(answerId, `${labelPrefix} (Answer)`) : null,
      h5p(h5pId, `${labelPrefix} Exit Card`),
    ].filter(Boolean);
    lesson.downloads = mergeItems(lesson.downloads || [], additions);
    lessonActivityCount += additions.length;
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  moodleCoursePageActivities: {
    courseDownloads: courseDownloads.length,
    lessonActivities: lessonActivityCount,
    note: "Authenticated Moodle course page activity links patched from course/view.php?id=82.",
  },
};

for (const unit of manifest.units || []) {
  let downloads = 0;
  let h5pCount = 0;
  for (const lesson of unit.lessons || []) {
    downloads += (lesson.downloads || []).length;
    h5pCount += (lesson.downloads || []).filter((item) => item.type === "h5p" || item.category === "moodle_h5pactivity").length;
    lesson.resourceCounts = {
      ...(lesson.resourceCounts || {}),
      downloads: (lesson.downloads || []).length,
      bookSections: (lesson.bookSections || []).length,
      ispring: (lesson.ispring || []).length,
    };
  }
  unit.summary = {
    ...(unit.summary || {}),
    downloads,
    ispring: unit.lessons.reduce((sum, lesson) => sum + (lesson.ispring || []).length, 0),
    h5p: h5pCount,
  };
}

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course: "SCH4U",
  courseDownloads: manifest.courseDownloads.length,
  lessonActivityCount,
}, null, 2));
