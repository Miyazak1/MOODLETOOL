import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

const courseRoot = "D:/工作文件/SUNNYBROOK/courseware/MPM2D";
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeRel(value) {
  return String(value || "").replaceAll("\\", "/");
}

function parseUnitLesson(value) {
  const text = String(value || "");
  const match = /Unit\s*-?\s*(\d+)\s*-+\s*Lesson\s*-?\s*(\d+)/i.exec(text);
  if (!match) return null;
  return { unit: Number(match[1]), lesson: Number(match[2]), answer: /\bAnswer\b/i.test(text) };
}

function displayTitle(parts) {
  return `Unit ${parts.unit} - Lesson ${parts.lesson}${parts.answer ? " (Answer)" : ""}`;
}

function keyFor(item) {
  return item?.moodleActivityId ? `activity:${item.moodleActivityId}` : normalizeRel(item?.path) || item?.source || item?.title || item?.label || "";
}

function dedupe(list) {
  const seen = new Map();
  for (const item of list || []) {
    if (!item || typeof item !== "object") continue;
    const key = keyFor(item);
    if (!key) continue;
    seen.set(key, item);
  }
  return [...seen.values()];
}

function collectByPath(manifest) {
  const byPath = new Map();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.path) {
      const rel = normalizeRel(value.path);
      if (!byPath.has(rel)) byPath.set(rel, value);
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(manifest);
  return byPath;
}

function hasMeaningfulAttachment(item) {
  return (item.attachments || []).some((attachment) => {
    const label = String(attachment.label || attachment.title || attachment.path || "");
    if (isDecorativeSunnybrookLogo(attachment)) return false;
    return true;
  });
}

function isDecorativeSunnybrookLogo(attachment) {
  const label = String(attachment?.label || attachment?.title || attachment?.path || "");
  return /20260514205240_755_110\.png$/i.test(label);
}

function normalizeHomeworkRecord(item, parts, { answer = false } = {}) {
  const record = {
    ...item,
    title: displayTitle({ ...parts, answer }),
    label: displayTitle({ ...parts, answer }),
    role: answer ? "homework_answer_page" : "homework_submission_page",
    category: answer ? "moodle_page" : "moodle_assign",
    parentSection: "Homework Submission Folder",
    sourceGroup: "homework_submission_folder",
    teacherUse: answer ? "homework_answer_reference" : "student_submission",
    unit: parts.unit,
    lesson: parts.lesson,
  };
  if (answer) record.attachments = (record.attachments || []).filter((attachment) => !isDecorativeSunnybrookLogo(attachment));
  delete record.teacherOnly;
  delete record.unitTitle;
  return record;
}

function sortHomework(a, b) {
  return (
    Number(a.unit || 999) - Number(b.unit || 999) ||
    Number(a.lesson || 999) - Number(b.lesson || 999) ||
    (a.role === "homework_answer_page" ? 1 : 0) - (b.role === "homework_answer_page" ? 1 : 0) ||
    String(a.title || a.label || "").localeCompare(String(b.title || b.label || ""))
  );
}

function isHomeworkLike(item) {
  const role = String(item?.role || "").toLowerCase();
  const scope = `${item?.parentSection || ""} ${item?.sourceGroup || ""}`.toLowerCase();
  return (
    /homework_submission_folder/.test(scope) ||
    ["homework_submission_page", "homework_answer_page", "lesson_dropbox", "lesson_answer_page"].includes(role) ||
    Boolean(parseUnitLesson(item?.title || item?.label || item?.path))
  );
}

function isTeacherPacketShell(item) {
  return String(item?.role || "").toLowerCase() === "teacher_packet" && !(item.attachments || []).length;
}

const manifest = readJson(manifestPath);
const byPath = collectByPath(manifest);
const homeworkItems = [];
const missingPartners = [];
const weakAnswerAttachments = [];
const existingHomeworkDownloads = (manifest.courseDownloads || []).filter(isHomeworkLike);

for (const unit of manifest.units || []) {
  const resources = unit.unitResources || {};
  const dropboxes = resources.lessonDropboxes || [];
  const answers = resources.answerPages || [];
  const answersByPair = new Map();

  for (const answer of answers) {
    const parts = parseUnitLesson(answer.title || answer.label || answer.path);
    if (!parts) continue;
    answersByPair.set(`${parts.unit}:${parts.lesson}`, answer);
  }

  for (const dropbox of dropboxes) {
    const parts = parseUnitLesson(dropbox.title || dropbox.label || dropbox.path);
    if (!parts) continue;
    const source = byPath.get(normalizeRel(dropbox.path)) || dropbox;
    homeworkItems.push(normalizeHomeworkRecord(source, parts, { answer: false }));

    const answer = answersByPair.get(`${parts.unit}:${parts.lesson}`);
    if (!answer) {
      missingPartners.push(displayTitle({ ...parts, answer: true }));
      continue;
    }
    const answerSource = byPath.get(normalizeRel(answer.path)) || answer;
    const normalizedAnswer = normalizeHomeworkRecord(answerSource, parts, { answer: true });
    homeworkItems.push(normalizedAnswer);
    if (!hasMeaningfulAttachment(normalizedAnswer)) weakAnswerAttachments.push(normalizedAnswer.title);
  }

  delete resources.lessonDropboxes;
  delete resources.answerPages;
}

if (homeworkItems.length === 0 && existingHomeworkDownloads.length > 0) {
  for (const item of existingHomeworkDownloads) {
    const parts = parseUnitLesson(item.title || item.label || item.path);
    if (!parts) continue;
    const answer = String(item.role || "").toLowerCase() === "homework_answer_page" || parts.answer;
    homeworkItems.push(normalizeHomeworkRecord(item, parts, { answer }));
  }
}

const existingNonHomeworkDownloads = (manifest.courseDownloads || []).filter((item) => !isHomeworkLike(item));
manifest.courseDownloads = dedupe([...existingNonHomeworkDownloads, ...homeworkItems.sort(sortHomework)]);

missingPartners.length = 0;
weakAnswerAttachments.length = 0;
const answerPairs = new Set(
  homeworkItems
    .filter((item) => item.role === "homework_answer_page")
    .map((item) => `${item.unit}:${item.lesson}`),
);
for (const item of homeworkItems) {
  if (item.role === "homework_submission_page" && !answerPairs.has(`${item.unit}:${item.lesson}`)) {
    missingPartners.push(displayTitle({ unit: item.unit, lesson: item.lesson, answer: true }));
  }
  if (item.role === "homework_answer_page" && !hasMeaningfulAttachment(item)) {
    weakAnswerAttachments.push(item.title || item.label || `${item.unit}:${item.lesson}`);
  }
}

manifest.teacherResources = (manifest.teacherResources || [])
  .filter((item) => {
    const role = String(item.role || "").toLowerCase();
    if (["aol_assessment", "lesson_answer_page", "homework_submission_page", "homework_answer_page", "lesson_dropbox"].includes(role)) return false;
    if (isHomeworkLike(item)) return false;
    return true;
  })
  .map((item) =>
    /^Answer Keys$/i.test(String(item.title || item.label || ""))
      ? {
          ...item,
          role: "teacher_packet",
          sourceGroup: "teacher_packet",
          parentSection: "Teacher Packet",
          teacherUse: "answer_key_reference",
          teacherOnly: true,
        }
      : item,
  );

manifest.courseSections = (manifest.courseSections || []).filter((item) => !isTeacherPacketShell(item));

manifest.courseSections = dedupe(manifest.courseSections);
manifest.teacherResources = dedupe(manifest.teacherResources);
manifest.evaluations = dedupe(manifest.evaluations || []);
for (const unit of manifest.units || []) {
  if (unit.unitResources?.evaluations) unit.unitResources.evaluations = dedupe(unit.unitResources.evaluations);
  if (unit.unitResources?.reflectionAndLogs) unit.unitResources.reflectionAndLogs = dedupe(unit.unitResources.reflectionAndLogs);
}

for (const item of manifest.courseDownloads || []) {
  if (!item.path) continue;
  const abs = join(courseRoot, normalizeRel(item.path));
  if (existsSync(abs)) item.bytes = statSync(abs).size;
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.mpm2dHomeworkSubmissionFolderNormalization = {
  patchedAt: new Date().toISOString(),
  homeworkSubmissionItems: homeworkItems.length,
  regularLessonPages: homeworkItems.filter((item) => item.role === "homework_submission_page").length,
  answerPages: homeworkItems.filter((item) => item.role === "homework_answer_page").length,
  missingPartners,
  weakAnswerAttachments,
  note:
    "Normalized MPM2D to the MDM4U-compatible legacy esunnybrook shape: Homework Submission Folder lesson and answer pages live in courseDownloads and are paired immediately; Unit AOL remains in unitResources.evaluations; Teacher Packet only contains true teacher packet material.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify(manifest.sourceAudit.mpm2dHomeworkSubmissionFolderNormalization, null, 2));
