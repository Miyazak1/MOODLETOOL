import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SPH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const inboxRoot = join(projectRoot, "inbox");

const bookIdsByUnit = {
  1: 8931,
  2: 8951,
  3: 8971,
  4: 8992,
  5: 9013,
};

const unitTitles = {
  1: "Kinematics",
  2: "Forces",
  3: "Energy and Society",
  4: "Waves and Sound",
  5: "Electricity and Magnetism",
};

const unitPlanPaths = {
  1: "plans/source/UNIT PLANS/UNIT 1 KINEMATICS.docx",
  2: "plans/source/UNIT PLANS/UNIT 2 FORCES.docx",
  3: "plans/source/UNIT PLANS/UNIT 3 ENERGY SOCIETY.docx",
  4: "plans/source/UNIT PLANS/UNIT 4 WAVES & SOUND.docx",
  5: "plans/source/UNIT PLANS/UNIT 5 ELECTRICITY & MAGNETISM.docx",
};

const lessonPlanDirs = {
  1: "Unit 1 Kinematics",
  2: "Unit 2 Forces",
  3: "Unit 3 Energy & Society",
  4: "Unit 4 Waves & Sound",
  5: "Unit 5 Electricity & Magnetism",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function sanitizeSegment(value) {
  return (
    String(value || "Lesson")
      .replace(/^Lesson\s*\d+\s*:?\s*/i, "")
      .replace(/&/g, "and")
      .replace(/[^A-Za-z0-9._ -]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "Lesson"
  );
}

function lessonPath(unit, lesson, title) {
  return `Unit ${unit}/Lesson ${lesson} - ${sanitizeSegment(title)}`;
}

function kindFromLabel(label) {
  const lower = String(label || "").toLowerCase();
  if (lower.includes("expectation") || lower === "overview" || lower === "introduction") return "overview";
  if (lower.includes("hands")) return "handsOn";
  if (lower.includes("consolidation") || lower.includes("consoldation")) return "consolidation";
  if (lower.includes("homework") || lower.includes("home work")) return "homework";
  return "lesson";
}

function typeFromPath(path) {
  const ext = String(path || "").split(".").pop()?.toLowerCase();
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  return "file";
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

function lessonPlanFor(unit, lesson) {
  const dir = lessonPlanDirs[unit];
  if (!dir) return null;
  const path = `plans/source/LESSON PLANS/${dir}/Unit ${unit} Lesson ${lesson}.docx`;
  if (!existsSync(join(courseRoot, path))) return null;
  return fileRecord(`Lesson Plan - Unit ${unit} Lesson ${lesson}`, path, "lesson_plan", "lesson_plan");
}

function unitPlanFor(unit) {
  const path = unitPlanPaths[unit];
  if (!path || !existsSync(join(courseRoot, path))) return null;
  return fileRecord(`Unit Plan - ${unitTitles[unit] || `Unit ${unit}`}`, path, "unit_plan", "unit_plan");
}

function withIspringDownload(item) {
  if (!item?.packagePath) return item;
  const zipPath = `${item.packagePath}.zip`;
  const abs = join(courseRoot, zipPath);
  if (!existsSync(abs)) return item;
  return {
    ...item,
    downloadPath: zipPath,
    downloadBytes: statSync(abs).size,
  };
}

function normalizedId(unit, lesson) {
  return `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`;
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
const rawByUnit = Object.entries(bookIdsByUnit).map(([unitText, bookId]) => {
  const unit = Number(unitText);
  return {
    unit,
    bookId,
    raw: readJson(join(inboxRoot, `moodle-book-raw-${course}-U${String(unit).padStart(2, "0")}.json`)),
  };
});

manifest.units = rawByUnit.map(({ unit, raw }) => {
  const previous = (manifest.units || []).find((entry) => Number(entry.unit) === unit) || {};
  const lessons = raw.lessons.map((rawLesson, index) => {
    const lesson = index + 1;
    const id = normalizedId(unit, lesson);
    const title = String(rawLesson.title || `Lesson ${lesson}`).replace(/\s+/g, " ").trim();
    const path = lessonPath(unit, lesson, title);
    const rawPages = (rawLesson.sections || []).map((section) => ({
      ...(section.page || {}),
      kind: kindFromLabel(section.normalizedLabel || section.label),
      sourceLabel: section.label,
      normalizedLabel: section.normalizedLabel || section.label,
    }));
    mkdirSync(join(courseRoot, path), { recursive: true });
    writeJson(join(courseRoot, path, "book_pages_raw.json"), rawPages);
    const previousLesson = (previous.lessons || []).find((entry) => entry.id === id || Number(entry.lesson) === lesson) || {};
    const lessonPlan = lessonPlanFor(unit, lesson);
    return {
      id,
      unit,
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

  return {
    unit,
    title: unitTitles[unit] || previous.title || `Unit ${unit}`,
    coreTexts: previous.coreTexts || [],
    unitPlan: unitPlanFor(unit),
    unitResources: previous.unitResources || {},
    summary: unitSummary(lessons),
    lessons,
  };
});

manifest.course = {
  ...(manifest.course || {}),
  code: course,
  title: "SPH3U · Physics",
  audience: "Teachers preparing OSSD lessons",
  source: "SunnyBrook Moodle offline courseware",
};
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  moodleCourseId: 83,
  coursePage: "https://www.esunnybrook.com/course/view.php?id=83",
  moodleBookCount: rawByUnit.length,
  moodleBookIds: rawByUnit.map(({ bookId }) => bookId),
  lessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  moodleBookLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  moodleBookSectionsRaw: rawByUnit.reduce(
    (sum, { raw }) => sum + raw.lessons.reduce((lessonSum, lesson) => lessonSum + (lesson.sections?.length || 0), 0),
    0,
  ),
  lessonPlansMatchedByUnitLesson: manifest.units.reduce((sum, unit) => sum + unit.lessons.filter((lesson) => lesson.lessonPlan).length, 0),
  unitPlansMatched: manifest.units.filter((unit) => unit.unitPlan).length,
  authenticatedMoodleBookCrawlAt: new Date().toISOString(),
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(`${course}: wrote ${manifest.sourceAudit.moodleBookLessonCount} lessons and ${manifest.sourceAudit.moodleBookSectionsRaw} raw book sections`);
