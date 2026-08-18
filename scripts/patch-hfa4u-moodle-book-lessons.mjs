import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "HFA4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const inboxRoot = join(projectRoot, "inbox");

const bookId = 9805;
const unitTitle = "Nutrition and Health";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function typeFromPath(path) {
  const ext = String(path || "").split(".").pop()?.toLowerCase();
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  if (ext === "md") return "md";
  return "file";
}

function normalizedId(unit, lesson) {
  return `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`;
}

function legacyId(unit, lesson) {
  return `U${unit}L${lesson}`;
}

function lessonPath(unit, lesson) {
  return `lessons/U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`;
}

function cleanLessonTitle(title) {
  return String(title || "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function kindFromLabel(label, index) {
  const lower = String(label || "").toLowerCase();
  if (index === 0 || lower.includes("expectation")) return "overview";
  if (lower.includes("hands")) return "handsOn";
  if (lower.includes("consolidation") || lower.includes("consoldation")) return "consolidation";
  if (lower.includes("homework") || lower.includes("home work")) return "homework";
  return "lesson";
}

function fileRecord(label, path, category, role, source = "local OSSD planning file") {
  const abs = join(courseRoot, path);
  const previewPath = `previews-html/${path}.html`;
  const record = {
    label,
    type: typeFromPath(path),
    category,
    role,
    path: toPosix(path),
    bytes: existsSync(abs) ? statSync(abs).size : 0,
    source,
  };
  if (existsSync(join(courseRoot, previewPath))) record.previewPath = toPosix(previewPath);
  return record;
}

function lessonPlanFor(unit, lesson, previousLesson) {
  const previousPath = previousLesson?.lessonPlan?.path;
  if (previousPath && existsSync(join(courseRoot, previousPath))) {
    return fileRecord(`Lesson Plan - Unit ${unit} Lesson ${lesson}`, previousPath, "lesson_plan", "lesson_plan");
  }
  const path = `plans/source/Unit ${unit} - Lesson ${lesson} Lesson Plan.docx`;
  if (!existsSync(join(courseRoot, path))) return null;
  return fileRecord(`Lesson Plan - Unit ${unit} Lesson ${lesson}`, path, "lesson_plan", "lesson_plan");
}

function unitPlanFor(previousUnit) {
  const previousPath = previousUnit?.unitPlan?.path;
  if (previousPath && existsSync(join(courseRoot, previousPath))) {
    return fileRecord("Unit Plan - Nutrition and Health", previousPath, "unit_plan", "unit_plan");
  }
  const path = "plans/source/HFA4U - Unit 1 - Unit Plan.docx";
  if (!existsSync(join(courseRoot, path))) return null;
  return fileRecord("Unit Plan - Nutrition and Health", path, "unit_plan", "unit_plan");
}

function withIspringDownload(item) {
  if (!item?.packagePath) return item;
  const zipPath = `${item.packagePath}.zip`;
  const abs = join(courseRoot, zipPath);
  const status = item.localizationStatus || (item.path && existsSync(join(courseRoot, item.path)) ? "localized" : undefined);
  const updated = status ? { ...item, localizationStatus: status } : { ...item };
  if (!existsSync(abs)) return updated;
  return { ...updated, downloadPath: zipPath, downloadBytes: statSync(abs).size };
}

function unitSummary(lessons) {
  return {
    downloads: lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0),
    ispring: lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0),
    docx: lessons.reduce((sum, lesson) => sum + (lesson.lessonPlan ? 1 : 0), 0),
    pdf: lessons.reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "pdf").length, 0),
    video: lessons.reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "mp4").length, 0),
    h5p: lessons.reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length, 0),
  };
}

const manifest = readJson(manifestPath);
const previousUnits = manifest.units || [];
const previousUnit = previousUnits.find((entry) => Number(entry.unit) === 1) || {};
const previousLessons = previousUnit.lessons || [];
const raw = readJson(join(inboxRoot, `moodle-book-raw-${course}-U01.json`));

const lessons = (raw.lessons || []).map((rawLesson, index) => {
  const lesson = index + 1;
  const id = normalizedId(1, lesson);
  const title = cleanLessonTitle(rawLesson.title || `Lesson ${lesson}`);
  const path = lessonPath(1, lesson);
  const rawPages = (rawLesson.sections || []).map((section, sectionIndex) => ({
    ...(section.page || {}),
    kind: kindFromLabel(section.normalizedLabel || section.label, sectionIndex),
    sourceLabel: section.label,
    normalizedLabel: section.normalizedLabel || section.label,
  }));
  mkdirSync(join(courseRoot, path), { recursive: true });
  writeJson(join(courseRoot, path, "book_pages_raw.json"), rawPages);
  const previousLesson =
    previousLessons.find((entry) => entry.id === id || entry.id === legacyId(1, lesson) || Number(entry.lesson) === lesson) || {};
  const lessonPlan = lessonPlanFor(1, lesson, previousLesson);
  return {
    id,
    unit: 1,
    lesson,
    title,
    path,
    sourceDir: path,
    bookPageCount: rawPages.length,
    lessonText: previousLesson.lessonText || [],
    textExports: previousLesson.textExports || [],
    lessonPlan,
    ispring: (previousLesson.ispring || []).map(withIspringDownload),
    downloads: previousLesson.downloads || [],
    bookSections: previousLesson.bookSections || [],
    resourceCounts: {
      downloads: previousLesson.downloads?.length || 0,
      bookSections: rawPages.length,
      lessonPlan: lessonPlan ? 1 : 0,
      ispring: previousLesson.ispring?.length || 0,
      h5p: (previousLesson.downloads || []).filter((item) => item.type === "h5p").length,
      video: (previousLesson.downloads || []).filter((item) => item.type === "mp4").length,
    },
  };
});

manifest.course = {
  ...(manifest.course || {}),
  code: course,
  title: "HFA4U · Nutrition and Health",
  audience: "Teachers preparing OSSD lessons",
  source: "SunnyBrook Moodle offline courseware",
};
manifest.units = [
  {
    unit: 1,
    title: unitTitle,
    coreTexts: previousUnit.coreTexts || [],
    unitPlan: unitPlanFor(previousUnit),
    unitResources: previousUnit.unitResources || {},
    summary: unitSummary(lessons),
    lessons,
  },
];
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  moodleCourseId: 91,
  coursePage: "https://www.esunnybrook.com/course/view.php?id=91",
  moodleShellStatus: "incomplete_visible_shell",
  visibleMoodleScope: "Current Moodle course page exposes Course Overview, Unit One, one Moodle Book, three Unit 1 assignment activities, and empty Section 3/Section 4 links; no Unit 2-4 Moodle Books or Course Outline attachment are visible.",
  excludedPlanningOnlyUnits: [2, 3, 4],
  localPlanningLessonFiles: 29,
  packagedMoodleUnits: 1,
  moodleBookCount: 1,
  moodleBookIds: [bookId],
  lessonCount: lessons.length,
  moodleBookLessonCount: lessons.length,
  moodleBookSectionsRaw: lessons.reduce((sum, lesson) => sum + lesson.bookPageCount, 0),
  lessonPlansMatchedByUnitLesson: lessons.filter((lesson) => lesson.lessonPlan).length,
  unitPlansMatched: manifest.units.filter((unit) => unit.unitPlan).length,
  missingLessonPlans: lessons.filter((lesson) => !lesson.lessonPlan).map((lesson) => lesson.id),
  authenticatedMoodleBookCrawlAt: new Date().toISOString(),
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(`${course}: wrote ${lessons.length} Moodle-visible lessons and ${manifest.sourceAudit.moodleBookSectionsRaw} raw book sections`);
