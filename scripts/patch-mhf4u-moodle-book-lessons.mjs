import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MHF4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const inboxRoot = join(projectRoot, "inbox");

const bookIdsByUnit = {
  1: 8336,
  2: 8362,
  3: 8393,
  4: 8415,
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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

function planningRecord(label, path, category, role) {
  const abs = join(courseRoot, path);
  return {
    label,
    type: typeFromPath(path),
    category,
    role,
    path,
    bytes: existsSync(abs) ? statSync(abs).size : 0,
    source: "local OSSD planning file",
  };
}

function findPlanPath(pattern) {
  const stack = [join(courseRoot, "plans", "source")];
  while (stack.length) {
    const current = stack.pop();
    if (!existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (pattern.test(relative(courseRoot, absolute).replaceAll("\\", "/"))) {
        return relative(courseRoot, absolute).replaceAll("\\", "/");
      }
    }
  }
  return null;
}

function lessonPlanFor(unit, lesson) {
  const path = findPlanPath(new RegExp(`^plans/source/LESSON PLANS/Unit ${unit} [^/]+/Lesson ${lesson}\\.docx$`, "i"));
  if (!path) return null;
  return planningRecord(`Lesson Plan - Unit ${unit} Lesson ${lesson}`, path, "lesson_plan", "lesson_plan");
}

function unitPlanFor(unit) {
  const path = `plans/source/UNIT PLANS/Unit ${unit}.docx`;
  if (!existsSync(join(courseRoot, path))) return null;
  return planningRecord(`Unit Plan - Unit ${unit}`, path, "unit_plan", "unit_plan");
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

function normalizedId(unit, lesson) {
  return `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`;
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
    const lessonPlan = lessonPlanFor(unit, lesson);
    const previousLesson = (previous.lessons || []).find((entry) => entry.id === id || Number(entry.lesson) === lesson) || {};
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
      ispring: previousLesson.ispring || [],
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
    title: previous.title || `Unit ${unit}`,
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
  title: "MHF4U · Advanced Functions",
  audience: "Teachers preparing OSSD lessons",
  source: "SunnyBrook Moodle offline courseware",
};
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  moodleCourseId: 79,
  coursePage: "https://www.esunnybrook.com/course/view.php?id=79",
  moodleBookCount: rawByUnit.length,
  moodleBookIds: rawByUnit.map(({ bookId }) => bookId),
  lessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  moodleBookLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  moodleBookSectionsRaw: rawByUnit.reduce(
    (sum, { raw }) => sum + raw.lessons.reduce((lessonSum, lesson) => lessonSum + (lesson.sections?.length || 0), 0),
    0,
  ),
  authenticatedMoodleBookCrawlAt: new Date().toISOString(),
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(
  `${course}: wrote ${manifest.sourceAudit.moodleBookLessonCount} lessons and ${manifest.sourceAudit.moodleBookSectionsRaw} raw book sections`,
);
