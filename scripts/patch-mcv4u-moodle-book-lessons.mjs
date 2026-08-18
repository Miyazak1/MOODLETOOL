import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MCV4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const inboxRoot = join(projectRoot, "inbox");

const bookIdsByUnit = {
  1: 8111,
  2: 8141,
  3: 8165,
};

const unitTitles = {
  1: "Rates of Change and Derivatives",
  2: "Applications of Derivatives",
  3: "Geometry and Algebra of Vectors",
};

const unitPlanNotes = {
  1: [
    "plans/source/Unit 1 Rates of Change/Unit 1 Plan.docx",
    "plans/source/Unit 2 Derivatives _ Their Applications/Unit 2 Plan.docx",
  ],
  2: [
    "plans/source/Unit 2 Derivatives _ Their Applications/Unit 2 Plan.docx",
    "plans/source/Unit 3 Curve Sketching and Optimization/Unit 3 Plan.docx",
  ],
  3: ["plans/source/Unit 4 Geometry _ Algebra of Vectors/Unit 4 Plan.docx"],
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

function planningRecord(label, path, category, role) {
  const abs = join(courseRoot, path);
  const previewPath = `previews-html/${path}.html`;
  const record = {
    label,
    type: typeFromPath(path),
    category,
    role,
    path,
    bytes: existsSync(abs) ? statSync(abs).size : 0,
    source: "local OSSD planning file, title matched to Moodle lesson",
  };
  if (existsSync(join(courseRoot, previewPath))) record.previewPath = previewPath;
  return record;
}

function allPlanFiles() {
  const root = join(courseRoot, "plans", "source");
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (/\.docx$/i.test(entry.name)) {
        files.push(toPosix(relative(courseRoot, absolute)));
      }
    }
  }
  return files;
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/^Lesson\s*\d+\s*:?\s*/i, "")
    .replace(/&/g, "and")
    .replace(/\brates of changes\b/gi, "rates of change")
    .replace(/\bcross products\b/gi, "cross product")
    .replace(/\bpoints lines and planes\b/gi, "points lines planes")
    .replace(/\bpoints lines planes\b/gi, "points lines planes")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const planFiles = allPlanFiles();

function lessonPlanTitle(path) {
  const preview = join(courseRoot, `previews-html/${path}.html`);
  if (!existsSync(preview)) return "";
  const html = readFileSync(preview, "utf8");
  const fieldMatch = /<h3>\s*Lesson Name\s*<\/h3>\s*<p[^>]*>\s*([\s\S]*?)(?:\s*\(Lesson\s*\d+\))?\s*<\/p>/i.exec(html);
  const titleMatch = /<title>\s*Lesson Plan\s*-\s*([\s\S]*?)\s*<\/title>/i.exec(html);
  return stripTags(fieldMatch?.[1] || titleMatch?.[1] || "");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const lessonPlansByTitle = new Map();
for (const path of planFiles.filter((file) => /\/Lesson\s+\d+\.docx$/i.test(file))) {
  const title = lessonPlanTitle(path);
  const normalized = normalizeTitle(title);
  if (normalized) lessonPlansByTitle.set(normalized, { path, title });
}

function lessonPlanFor(rawTitle, unit, lesson) {
  const normalized = normalizeTitle(rawTitle);
  const match = lessonPlansByTitle.get(normalized);
  if (!match) return null;
  return planningRecord(`Lesson Plan - ${match.title}`, match.path, "lesson_plan", "lesson_plan");
}

function relatedUnitPlans(unit) {
  return (unitPlanNotes[unit] || [])
    .filter((path) => existsSync(join(courseRoot, path)))
    .map((path) => planningRecord(`Related Unit Plan - ${path.split("/").at(-2)}`, path, "unit_plan", "related_unit_plan"));
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

function courseOutlineRecord() {
  const path = "plans/course/MCV4U_Course_Outline.docx";
  const abs = join(courseRoot, path);
  if (!existsSync(abs)) return null;
  const previewPath = `previews-html/${path}.html`;
  const record = {
    label: "MCV4U Course Outline.docx",
    type: "docx",
    category: "course_document",
    role: "course_outline",
    path,
    bytes: statSync(abs).size,
    source: "https://www.esunnybrook.com/pluginfile.php/8319/mod_assign/introattachment/0/MCV4U-Course-Outline.docx?forcedownload=1",
  };
  if (existsSync(join(courseRoot, previewPath))) record.previewPath = previewPath;
  return record;
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
    const lessonPlan = lessonPlanFor(title, unit, lesson);
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

  const relatedPlans = relatedUnitPlans(unit);
  return {
    unit,
    title: previous.title && previous.title !== `Unit ${unit}` ? previous.title : unitTitles[unit],
    coreTexts: previous.coreTexts || [],
    unitPlan: null,
    unitResources: {
      ...(previous.unitResources || {}),
      relatedPlanningFiles: relatedPlans,
      planningNote:
        "Local unit plans use an older four-unit organization; they are kept as related planning files only, while Moodle Book sections define the live student-facing unit structure.",
    },
    summary: unitSummary(lessons),
    lessons,
  };
});

const outline = courseOutlineRecord();
manifest.courseDownloads = [
  ...((manifest.courseDownloads || []).filter((item) => item.role !== "course_outline")),
  ...(outline ? [outline] : []),
];
manifest.course = {
  ...(manifest.course || {}),
  code: course,
  title: "MCV4U · Calculus and Vectors",
  audience: "Teachers preparing OSSD lessons",
  source: "SunnyBrook Moodle offline courseware",
};
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  moodleCourseId: 77,
  coursePage: "https://www.esunnybrook.com/course/view.php?id=77",
  moodleBookCount: rawByUnit.length,
  moodleBookIds: rawByUnit.map(({ bookId }) => bookId),
  lessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  moodleBookLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  moodleBookSectionsRaw: rawByUnit.reduce(
    (sum, { raw }) => sum + raw.lessons.reduce((lessonSum, lesson) => lessonSum + (lesson.sections?.length || 0), 0),
    0,
  ),
  lessonPlansMatchedByTitle: manifest.units.reduce((sum, unit) => sum + unit.lessons.filter((lesson) => lesson.lessonPlan).length, 0),
  unitPlansLinkedAsRelatedOnly: Object.values(unitPlanNotes).flat().length,
  authenticatedMoodleBookCrawlAt: new Date().toISOString(),
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(
  `${course}: wrote ${manifest.sourceAudit.moodleBookLessonCount} lessons, ${manifest.sourceAudit.moodleBookSectionsRaw} raw book sections, ${manifest.sourceAudit.lessonPlansMatchedByTitle} title-matched lesson plans`,
);
