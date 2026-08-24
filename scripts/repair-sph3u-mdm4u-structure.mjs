import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SPH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function displayLabel(item) {
  return String(item?.label || item?.title || item?.name || "").trim();
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function localPath(path) {
  return path ? join(courseRoot, path) : "";
}

function refreshFileMetadata(item) {
  if (!item || typeof item !== "object") return item;
  if (item.path && existsSync(localPath(item.path))) {
    item.bytes = statSync(localPath(item.path)).size;
    if (String(item.path).endsWith(".html")) {
      item.textPreview = stripTags(readFileSync(localPath(item.path), "utf8")).slice(0, 800);
    }
  }
  if (Array.isArray(item.attachments)) {
    item.attachments = item.attachments.map((attachment) => refreshFileMetadata({ ...attachment }));
  }
  return item;
}

function isEmptySubmissionShell(item) {
  const role = item?.role || "";
  if (!["culminating_submission", "final_exam_submission"].includes(role)) return false;
  if ((item.attachments || []).length > 0) return false;
  const text = stripTags(existsSync(localPath(item.path)) ? readFileSync(localPath(item.path), "utf8") : item.textPreview || "");
  const label = displayLabel(item);
  return !text || text === label || text === `${label} ${label}`;
}

function parseUnitLesson(label) {
  const match = /Unit\s*(\d+)\s*-\s*Lesson\s*(\d+)/i.exec(label || "");
  return match ? { unit: Number(match[1]), lesson: Number(match[2]) } : null;
}

function homeworkItem(item, role) {
  const parsed = parseUnitLesson(displayLabel(item));
  const copy = refreshFileMetadata({
    ...item,
    role,
    parentSection: "Homework Submission Folder",
    sourceGroup: "homework_submission_folder",
    unit: item.unit || parsed?.unit,
    teacherOnly: role === "homework_answer_page" ? true : item.teacherOnly,
  });
  delete copy.teacherUse;
  return copy;
}

function sortHomework(items) {
  return [...items].sort((a, b) => {
    const pa = parseUnitLesson(displayLabel(a)) || {};
    const pb = parseUnitLesson(displayLabel(b)) || {};
    const unitDelta = (pa.unit || 99) - (pb.unit || 99);
    if (unitDelta) return unitDelta;
    const lessonDelta = (pa.lesson || 99) - (pb.lesson || 99);
    if (lessonDelta) return lessonDelta;
    const answerDelta = (a.role === "homework_answer_page" ? 1 : 0) - (b.role === "homework_answer_page" ? 1 : 0);
    if (answerDelta) return answerDelta;
    return displayLabel(a).localeCompare(displayLabel(b), undefined, { numeric: true });
  });
}

function normalizeTextbook(manifest) {
  const textbookTitle = "SPH3U · Physics · Nelson Physics 11 Textbook";
  for (const text of manifest.texts || []) {
    if (text.id !== "nelson-physics-11") continue;
    text.title = textbookTitle;
    text.label = textbookTitle;
    text.category = "textbook";
    text.role = "core_textbook";
    text.type = "textbook";
    text.notes =
      "Core SPH3U Physics textbook. User confirmed the PDF was legally obtained and it matches SPH3U Nelson Physics 11 planning references.";
    text.materials = (text.materials || []).map((material) => {
      const normalized = {
        ...material,
        label: textbookTitle,
        title: textbookTitle,
        category: "textbook",
        role: "core_textbook",
        path: toPosix(material.path || text.path),
        downloadPath: toPosix(material.downloadPath || material.path || text.path),
      };
      if (!normalized.previewPath) delete normalized.previewPath;
      return refreshFileMetadata(normalized);
    });
    refreshFileMetadata(text);
  }
}

const manifest = readJson(manifestPath);
const teacherResourcesBefore = manifest.teacherResources?.length || 0;
const courseDownloadsBefore = manifest.courseDownloads?.length || 0;

normalizeTextbook(manifest);

manifest.courseSections = (manifest.courseSections || [])
  .map((item) => refreshFileMetadata({ ...item }))
  .filter((item) => !(item.role === "teacher_packet" && (item.attachments || []).length === 0));

manifest.courseDownloads = (manifest.courseDownloads || [])
  .map((item) => refreshFileMetadata({ ...item }))
  .filter((item) => !isEmptySubmissionShell(item))
  .filter((item) => !["lesson_dropbox", "lesson_answer_page", "homework_submission_page", "homework_answer_page"].includes(item.role));

const homeworkItems = [];
const missingPartners = [];
for (const unit of manifest.units || []) {
  const resources = unit.unitResources || {};
  const lessons = resources.lessonDropboxes || [];
  const answers = resources.answerPages || [];
  const answersByLesson = new Map();
  for (const answer of answers) {
    const parsed = parseUnitLesson(displayLabel(answer));
    if (parsed?.lesson) answersByLesson.set(parsed.lesson, answer);
  }
  for (const lesson of lessons) {
    const parsed = parseUnitLesson(displayLabel(lesson));
    homeworkItems.push(homeworkItem(lesson, "homework_submission_page"));
    const answer = parsed?.lesson ? answersByLesson.get(parsed.lesson) : null;
    if (answer) homeworkItems.push(homeworkItem(answer, "homework_answer_page"));
    else missingPartners.push({ unit: unit.unit, lesson: parsed?.lesson, label: displayLabel(lesson) });
  }
  delete resources.lessonDropboxes;
  delete resources.answerPages;
}
manifest.courseDownloads.push(...sortHomework(homeworkItems));

manifest.teacherResources = (manifest.teacherResources || [])
  .filter((item) => !["aol_assessment", "lesson_answer_page", "lesson_dropbox", "homework_submission_page", "homework_answer_page"].includes(item.role))
  .map((item) => {
    const next = refreshFileMetadata({ ...item });
    if (/^Answer Keys$/i.test(displayLabel(next))) {
      next.role = "teacher_packet";
      next.parentSection = "Teacher Packet";
      next.sourceGroup = "teacher_packet";
      next.teacherOnly = true;
    }
    return next;
  });

for (const unit of manifest.units || []) {
  for (const collection of Object.values(unit.unitResources || {})) {
    if (Array.isArray(collection)) collection.forEach(refreshFileMetadata);
  }
}
for (const item of manifest.evaluations || []) refreshFileMetadata(item);

manifest.sourceAudit ||= {};
manifest.sourceAudit.mdm4uStructureRepair = {
  ...(manifest.sourceAudit.mdm4uStructureRepair || {}),
  patchedAt: new Date().toISOString(),
  standard: "docs/MOODLE_COURSE_IMPORT_DISPLAY_RULES.md; MDM4U course-manifest baseline",
  teacherResourcesBefore,
  teacherResourcesAfter: manifest.teacherResources.length,
  courseDownloadsBefore,
  courseDownloadsAfter: manifest.courseDownloads.length,
  homeworkSubmissionItemsAddedToCourseDownloads: homeworkItems.length,
  missingHomeworkAnswerPartners: missingPartners,
  removedEmptySubmissionShells: ["Culminating Dropbox", "Final Exam Dropbox"],
  note:
    "Normalized SPH3U ownership: Unit AOL remains in unit Evaluation, homework lesson/answer pages are interleaved in Homework Submission Folder, and Teacher Packet is limited to real answer-key material.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseDownloadsBefore,
  courseDownloadsAfter: manifest.courseDownloads.length,
  homeworkSubmissionItemsAddedToCourseDownloads: homeworkItems.length,
  teacherResourcesBefore,
  teacherResourcesAfter: manifest.teacherResources.length,
  missingHomeworkAnswerPartners: missingPartners.length,
  texts: (manifest.texts || []).map((item) => item.title),
}, null, 2));
