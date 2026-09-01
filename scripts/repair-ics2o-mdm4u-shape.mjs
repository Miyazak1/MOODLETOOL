import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ICS2O";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const roadmapPath = join(projectRoot, "public", "course-roadmap.json");

const now = new Date().toISOString();

const SOURCE_SECTIONS = [
  { section: 0, title: "Introduction", role: "course_introduction" },
  { section: 1, title: "Course info", role: "course_info" },
  { section: 2, title: "Unit 1: Understanding Computers", role: "unit_overview", unit: 1 },
  { section: 3, title: "Unit 1: Lesson Plans", role: "unit_lesson_plans", unit: 1 },
  { section: 4, title: "Unit 1: Slides/Notes", role: "unit_slides_notes", unit: 1 },
  { section: 5, title: "Unit 1: Assessments", role: "unit_assessments", unit: 1 },
  { section: 6, title: "Unit 2: Introduction to programming", role: "unit_overview", unit: 2 },
  { section: 7, title: "Unit 2: Lesson Plans", role: "unit_lesson_plans", unit: 2 },
  { section: 8, title: "Unit 2: Slides/Notes", role: "unit_slides_notes", unit: 2 },
  { section: 9, title: "Unit 2: Assessments", role: "unit_assessments", unit: 2 },
  { section: 10, title: "Unit 3: Computers and Societies", role: "unit_overview", unit: 3 },
  { section: 11, title: "Unit 3: Lesson Plans", role: "unit_lesson_plans", unit: 3 },
  { section: 12, title: "Unit 3: Slides/Notes", role: "unit_slides_notes", unit: 3 },
  { section: 13, title: "Unit 3: Assessments", role: "unit_assessments", unit: 3 },
  { section: 14, title: "Final Evaluation 30% (ISP & Final Exam)", role: "final_evaluation" },
  { section: 15, title: "Teacher's Evaluation - Learning Skills & Work Habits", role: "teacher_evaluation" },
];

const ID_SECTION = new Map([
  [3752, SOURCE_SECTIONS[0]],
  [3753, SOURCE_SECTIONS[1]],
  [3754, SOURCE_SECTIONS[1]],
  [3755, SOURCE_SECTIONS[1]],
  ...range(3756, 3765).map((id) => [id, SOURCE_SECTIONS[3]]),
  ...range(3766, 3774).map((id) => [id, SOURCE_SECTIONS[4]]),
  ...range(3775, 3782).map((id) => [id, SOURCE_SECTIONS[5]]),
  ...range(3783, 3787).map((id) => [id, SOURCE_SECTIONS[7]]),
  ...range(3788, 3803).map((id) => [id, SOURCE_SECTIONS[8]]),
  ...range(3804, 3812).map((id) => [id, SOURCE_SECTIONS[9]]),
  ...range(3813, 3815).map((id) => [id, SOURCE_SECTIONS[11]]),
  ...range(3816, 3817).map((id) => [id, SOURCE_SECTIONS[12]]),
  ...range(3818, 3823).map((id) => [id, SOURCE_SECTIONS[13]]),
  [3824, SOURCE_SECTIONS[14]],
  [3825, SOURCE_SECTIONS[14]],
  [3826, SOURCE_SECTIONS[15]],
  [3827, SOURCE_SECTIONS[15]],
]);

function range(start, end) {
  const values = [];
  for (let value = start; value <= end; value++) values.push(value);
  return values;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value, quote = false) {
  const escaped = String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return quote ? escaped.replace(/"/g, "&quot;") : escaped;
}

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content p { margin: 0 0 14px; }
    .muted { color: #4b6380; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(title)}</h1>
    <article class="content">
${body}
    </article>
  </main>
</body>
</html>
`;
}

function clone(item) {
  return item ? JSON.parse(JSON.stringify(item)) : item;
}

function moodleId(item) {
  const text = `${item?.source || ""} ${item?.url || ""}`;
  const match = /[?&]id=(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

function stamp(item, section, extra = {}) {
  const next = clone(item);
  next.parentSection = section.title;
  next.sourceSection = section.section;
  next.sourceGroup = section.role;
  if (section.unit && !next.unit) next.unit = section.unit;
  Object.assign(next, extra);
  return next;
}

function originalSectionFields(section, sortOrder) {
  return {
    sourceGroup: "original_moodle_section",
    sectionTitle: section.title,
    sectionKey: courseMoodleSectionKey(section.title),
    sectionOrder: section.section,
    sortOrder,
  };
}

function isLearningLog(item) {
  return /learning\s*log/i.test(item?.label || "");
}

function lessonPlanLabel(unit, lesson) {
  return `Lesson Plan - Unit ${unit.unit} Lesson ${lesson.lesson}`;
}

function isSourceNotes(item) {
  return item?.role === "source_notes" || item?.path === "texts/SOURCES.md";
}

function collectStats(manifest) {
  const resources = [];
  const push = (item) => {
    if (!item) return;
    resources.push(item);
    for (const attachment of item.attachments || []) resources.push(attachment);
  };
  for (const item of manifest.courseDownloads || []) push(item);
  for (const item of manifest.courseSections || []) push(item);
  for (const item of manifest.teacherResources || []) push(item);
  for (const item of manifest.evaluations || []) push(item);
  for (const text of manifest.texts || []) {
    push(text);
    for (const material of text.materials || []) push(material);
  }
  for (const unit of manifest.units || []) {
    push(unit.unitPlan);
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) value.forEach(push);
      else push(value);
    }
    for (const lesson of unit.lessons || []) {
      push(lesson.lessonPlan);
      for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) {
        for (const item of lesson[key] || []) push(item);
      }
    }
  }
  const uniquePathCount = new Set(resources.map((item) => item.path).filter(Boolean)).size;
  return {
    units: manifest.units?.length || 0,
    lessons: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
    localResources: uniquePathCount,
    courseDownloads: manifest.courseDownloads?.length || 0,
    courseSections: manifest.courseSections?.length || 0,
    teacherResources: manifest.teacherResources?.length || 0,
    evaluations: manifest.evaluations?.length || 0,
    lessonPlans: (manifest.units || []).reduce(
      (sum, unit) => sum + (unit.lessons || []).filter((lesson) => lesson.lessonPlan).length,
      0,
    ),
    unitEvaluations: (manifest.units || []).reduce(
      (sum, unit) => sum + (unit.unitResources?.evaluations?.length || 0),
      0,
    ),
    reflectionAndLogs: (manifest.units || []).reduce(
      (sum, unit) => sum + (unit.unitResources?.reflectionAndLogs?.length || 0),
      0,
    ),
  };
}

function dedupeBySource(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = `${moodleId(item) || ""}|${item.source || ""}|${item.path || ""}|${item.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function writeCourseSection(relPath, title, body) {
  const fullPath = join(courseRoot, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, htmlPage(title, body), "utf8");
  return statSync(fullPath).size;
}

function cleanFileLabel(name) {
  return basename(name).replace(/^[0-9a-f]{10}-/i, "");
}

function fileType(name) {
  return extname(name).replace(/^\./, "").toLowerCase() || "file";
}

function attachmentsForPage(relPath) {
  const dir = join(courseRoot, dirname(relPath), "files");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = `${dirname(relPath).replaceAll("\\", "/")}/files/${entry.name}`;
      return {
        label: cleanFileLabel(entry.name),
        type: fileType(entry.name),
        path,
        downloadPath: path,
        bytes: statSync(join(dir, entry.name)).size,
      };
    });
}

function sourceItem(id, label, path, extra = {}) {
  const { mod = "page", ...rest } = extra;
  const attachments = attachmentsForPage(path);
  return {
    label,
    title: label,
    path,
    type: "html",
    category: "course_section",
    role: "course_resource",
    source: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    sourceUrl: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
    sourceId: id,
    bytes: statSync(join(courseRoot, path)).size,
    ...(attachments.length ? { attachments } : {}),
    ...rest,
  };
}

function courseMoodleSectionKey(title) {
  return String(title || "section")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

function updateCatalog(stats) {
  const catalog = readJson(catalogPath);
  const entry = catalog.courses?.find((item) => item.code === course);
  if (entry) {
    entry.title = "Introduction to Computer Studies, Grade 10, Open";
    entry.level = "Grade 10";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/ICS2O/course-manifest.json";
    entry.baseUrl = "/courseware/ICS2O/";
    entry.notes = `Legacy esunnybrook activity course normalized from Moodle sections: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.unitEvaluations} unit assessment item(s).`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Introduction to Computer Studies, Grade 10, Open";
    entry.level = "Grade 10";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "https://www.esunnybrook.com/course/view.php?id=36",
      outlineStatus: "ready",
      outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=3753",
      bookCount: 0,
      numberedLessonCount: stats.lessons,
      courseStructure: "legacy-esunnybrook-section-activity",
    };
    entry.readiness = {
      units: stats.units,
      lessons: stats.lessons,
      unitPlans: 0,
      lessonPlans: (readJson(manifestPath).units || []).reduce(
        (sum, unit) => sum + (unit.lessons || []).filter((lesson) => lesson.lessonPlan).length,
        0,
      ),
      lessonPlanExpected: 18,
      missingCourseOutline: false,
      missingIntroduction: false,
      missingUnitPlans: 0,
      missingLessonPlans: 0,
      textsNeedingReview: 0,
      linkOnlyTexts: 0,
      localizedResources: stats.localResources,
      unavailableResources: 0,
      externalReferences: 5,
    };
    entry.nextActions = [
      "Use Moodle section ownership for QA: Unit assessments, final evaluation, and teacher evaluation must remain separate.",
      "Add a textbook only if a confirmed legal ICS2O source file is provided.",
    ];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);

const introductionPath = "course-sections/course-starter-resources/index.html";
writeCourseSection(
  introductionPath,
  "Course Introduction",
  `      <p><strong>ICS2O</strong>, Introduction to Computer Studies, Grade 10, Open</p>
      <p>This course introduces students to computer programming. Students will plan and write simple computer programs by applying fundamental programming concepts, and learn to create clear and maintainable internal documentation. They will also learn to manage a computer by studying hardware configurations, software selection, operating system functions, networking, and safe computing practices. The course includes a practical introduction to database concepts and their development.</p>
      <p><strong>Prerequisite:</strong> None</p>`,
);

const announcementsPath = "localized-moodle-activities/forum/course-3752-announcements/index.html";
writeCourseSection(
  announcementsPath,
  "Announcements",
  `      <p>General news and announcements</p>`,
);

const introSectionItem = {
  label: "Course Introduction",
  title: "Course Introduction",
  path: introductionPath,
  type: "html",
  category: "course_section",
  role: "introduction",
  parentSection: "Introduction",
  sourceSection: 0,
  sourceGroup: "original_moodle_section",
  sectionTitle: "Introduction",
  sectionKey: "introduction",
  sectionOrder: 0,
  sortOrder: 0,
  source: "https://www.esunnybrook.com/course/view.php?id=36&section=0",
  sourceUrl: "https://www.esunnybrook.com/course/view.php?id=36&section=0",
  sourceId: "section-0",
  bytes: statSync(join(courseRoot, introductionPath)).size,
};

const announcementsItem = stamp(
  sourceItem(3752, "Announcements", announcementsPath, {
    mod: "forum",
    category: "course_forum",
    role: "announcements",
  }),
  SOURCE_SECTIONS[0],
  originalSectionFields(SOURCE_SECTIONS[0], 1),
);

manifest.courseSections = dedupeBySource([
  introSectionItem,
  ...(manifest.courseSections || []).filter((item) => item.role !== "introduction" && item.sourceId !== "section-0"),
]);

manifest.courseDownloads = dedupeBySource([
  announcementsItem,
  ...(manifest.courseDownloads || []).filter((item) => moodleId(item) !== 3752 && item.role !== "announcements"),
]);

const unitMoved = new Map([
  [1, { evaluations: [], reflectionAndLogs: [] }],
  [2, { evaluations: [], reflectionAndLogs: [] }],
  [3, { evaluations: [], reflectionAndLogs: [] }],
]);
const finalEvaluation = [];
const teacherResources = [];

const knownFinalEvaluation = [
  stamp(
    sourceItem(3824, "Final Project", "localized-moodle-activities/assign/U03L05-3824-53b7779413/index.html", {
      mod: "assign",
      category: "final_evaluation",
      role: "culminating_project",
    }),
    SOURCE_SECTIONS[14],
  ),
  stamp(
    sourceItem(3825, "Final Exam", "localized-moodle-activities/assign/U03L05-3825-f90b2ae230/index.html", {
      mod: "assign",
      category: "final_evaluation",
      role: "final_exam",
    }),
    SOURCE_SECTIONS[14],
  ),
];

const knownTeacherResources = [
  stamp(
    sourceItem(
      3826,
      "Learning Skills and Work Habits Evaluation (Teacher only)",
      "localized-moodle-activities/assign/U03L05-3826-8ffd1a4ed0/index.html",
      {
        mod: "assign",
        category: "teacher_packet",
        role: "teacher_packet",
        teacherOnly: true,
      },
    ),
    SOURCE_SECTIONS[15],
  ),
  stamp(
    sourceItem(
      3827,
      "Teacher's Comments for Midterm and Final",
      "localized-moodle-activities/assign/U03L05-3827-254d67c0ee/index.html",
      {
        mod: "assign",
        category: "teacher_packet",
        role: "teacher_packet",
        teacherOnly: true,
      },
    ),
    SOURCE_SECTIONS[15],
  ),
];

for (const item of manifest.courseDownloads || []) {
  const id = moodleId(item);
  const section = id ? ID_SECTION.get(id) : null;
  if (section) Object.assign(item, stamp(item, section));
}
manifest.courseDownloads = (manifest.courseDownloads || []).map((item) => {
  if (isSourceNotes(item)) return item;
  const id = moodleId(item);
  const section = id ? ID_SECTION.get(id) : SOURCE_SECTIONS[0];
  const originalOpeningSection =
    section?.role === "course_info" || section?.role === "course_introduction"
      ? originalSectionFields(section, id || item.sortOrder || 0)
      : {};
  return stamp(item, section, {
    category: item.category || "course_document",
    role: item.role || "course_resource",
    ...originalOpeningSection,
  });
});

for (const unit of manifest.units || []) {
  unit.unitResources = unit.unitResources || {};
  const normalizedLessons = [];
  for (const lesson of unit.lessons || []) {
    const keptDownloads = [];
    for (const item of lesson.downloads || []) {
      const id = moodleId(item);
      const section = id ? ID_SECTION.get(id) : null;
      if (section?.role === "unit_lesson_plans") {
        const label = lessonPlanLabel(unit, lesson);
        lesson.lessonPlan = stamp(item, section, {
          label,
          title: label,
          category: "lesson_plan",
          role: "lesson_plan",
        });
        continue;
      }
      if (section?.role === "unit_assessments") {
        const moved = stamp(item, section, {
          category: isLearningLog(item) ? "reflection_log" : "unit_evaluation",
          role: isLearningLog(item) ? "reflection_log" : "unit_assessment",
          assessmentType: isLearningLog(item)
            ? "AAL"
            : (/AOL|test|assignment/i.test(item.label || "") ? "AOL" : "AFL"),
        });
        const bucket = isLearningLog(item) ? "reflectionAndLogs" : "evaluations";
        unitMoved.get(section.unit)[bucket].push(moved);
        continue;
      }
      if (section?.role === "final_evaluation") {
        finalEvaluation.push(stamp(item, section, {
          category: "final_evaluation",
          role: /exam/i.test(item.label || "") ? "final_exam" : "culminating_project",
        }));
        continue;
      }
      if (section?.role === "teacher_evaluation") {
        teacherResources.push(stamp(item, section, {
          category: "teacher_packet",
          role: "teacher_packet",
          teacherOnly: true,
        }));
        continue;
      }
      keptDownloads.push(section ? stamp(item, section) : item);
    }
    if (lesson.lessonPlan) {
      const id = moodleId(lesson.lessonPlan);
      const section = id ? ID_SECTION.get(id) : null;
      const fallbackSection = {
        section: unit.unit === 1 ? 3 : unit.unit === 2 ? 7 : 11,
        title: `Unit ${unit.unit}: Lesson Plans`,
        role: "unit_lesson_plans",
        unit: unit.unit,
      };
      const label = lessonPlanLabel(unit, lesson);
      lesson.lessonPlan = stamp(lesson.lessonPlan, section?.role === "unit_lesson_plans" ? section : fallbackSection, {
        label,
        title: label,
        category: "lesson_plan",
        role: "lesson_plan",
      });
    }
    lesson.downloads = keptDownloads;
    lesson.resourceCounts = {
      downloads: lesson.downloads.length,
      lessonPlan: lesson.lessonPlan ? 1 : 0,
      ispring: lesson.ispring?.length || 0,
    };
    normalizedLessons.push(lesson);
  }
  unit.lessons = normalizedLessons;
}

for (const unit of manifest.units || []) {
  const moved = unitMoved.get(unit.unit) || { evaluations: [], reflectionAndLogs: [] };
  const existingEvaluations = (unit.unitResources.evaluations || []).filter(Boolean);
  const existingReflection = (unit.unitResources.reflectionAndLogs || []).filter(Boolean);
  unit.unitResources.evaluations = dedupeBySource([...existingEvaluations, ...moved.evaluations]);
  unit.unitResources.reflectionAndLogs = dedupeBySource([...existingReflection, ...moved.reflectionAndLogs]);
  if (!unit.unitResources.evaluations.length) delete unit.unitResources.evaluations;
  if (!unit.unitResources.reflectionAndLogs.length) delete unit.unitResources.reflectionAndLogs;
}

manifest.courseSections = dedupeBySource([
  ...(manifest.courseSections || []).filter((item) => item.sourceGroup !== "final_evaluation"),
  ...knownFinalEvaluation,
  ...finalEvaluation,
]);
manifest.teacherResources = dedupeBySource([
  ...(manifest.teacherResources || []).filter((item) => item.sourceGroup !== "teacher_evaluation"),
  ...knownTeacherResources,
  ...teacherResources,
]);
manifest.evaluations = dedupeBySource(
  (manifest.units || []).flatMap((unit) => unit.unitResources?.evaluations || []),
);

for (const unit of manifest.units || []) {
  const resources = [];
  const add = (item) => {
    if (!item) return;
    resources.push(item);
    for (const attachment of item.attachments || []) resources.push(attachment);
  };
  add(unit.unitPlan);
  for (const value of Object.values(unit.unitResources || {})) {
    if (Array.isArray(value)) value.forEach(add);
    else add(value);
  }
  for (const lesson of unit.lessons || []) {
    add(lesson.lessonPlan);
    for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) {
      for (const item of lesson[key] || []) add(item);
    }
  }
  const typeCount = (pattern) =>
    resources.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
  unit.summary = {
    downloads: resources.filter((item) => item.path || item.externalUrl).length,
    ispring: typeCount(/ispring/i),
    docx: typeCount(/docx?/i),
    pdf: typeCount(/pdf/i),
    video: typeCount(/video|mp4/i),
    h5p: typeCount(/h5p/i),
    evaluations: unit.unitResources?.evaluations?.length || 0,
    reflectionAndLogs: unit.unitResources?.reflectionAndLogs?.length || 0,
  };
}

const stats = collectStats(manifest);
manifest.generatedAt = now;
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  sourceFamily: "legacy-esunnybrook",
  courseStructure: "legacy-esunnybrook-section-activity",
  moodleCourseId: 36,
  coursePage: "https://www.esunnybrook.com/course/view.php?id=36",
  authenticatedMoodleRescanAt: now,
  moodleSourceSections: SOURCE_SECTIONS,
  lessonCount: stats.lessons,
  moodleActivityResourceCount: 74,
  moodleNumberedLessonCount: 31,
  courseDownloads: stats.courseDownloads,
  courseSections: stats.courseSections,
  teacherResources: stats.teacherResources,
  unitEvaluations: stats.unitEvaluations,
  reflectionAndLogs: stats.reflectionAndLogs,
  localResourceCount: stats.localResources,
  displayShapeRepair: {
    repairedAt: now,
    ruleBasis: "MOODLE_COURSE_IMPORT_DISPLAY_RULES.md MDM4U field ownership, adapted for legacy esunnybrook section/activity course without Moodle books.",
    changes: [
      "Moodle section 0 Introduction restored as a courseSections Course Introduction page.",
      "Moodle section 0 Announcements forum restored as a course-level resource.",
      "Moodle Unit Lesson Plans sections normalized into lesson.lessonPlan fields, matching the MDM4U lesson-plan contract.",
      "Unit assessment-section Moodle assignment pages moved out of lesson downloads into unitResources.evaluations or unitResources.reflectionAndLogs.",
      "Final Project and Final Exam moved out of Unit 3 lesson downloads into courseSections under Final Evaluation.",
      "Teacher evaluation pages moved into teacherResources and marked teacherOnly.",
      "Course info resources keep their Course info parent section.",
    ],
  },
};

writeJson(manifestPath, manifest);

const sourceNotesPath = join(courseRoot, "texts", "SOURCES.md");
const sources = `# ICS2O Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, https://www.esunnybrook.com/course/view.php?id=36
- Source family: legacy esunnybrook section/activity course. This course does not expose Moodle books, so the MDM4U field ownership rules are applied to activity sections rather than to book sections.
- Source sections checked: Introduction; Course info; Unit 1/2/3 lesson plans; Unit 1/2/3 slides/notes; Unit 1/2/3 assessments; Final Evaluation 30% (ISP & Final Exam); Teacher's Evaluation - Learning Skills & Work Habits.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.lessonPlans} lesson plan files, ${stats.unitEvaluations} unit assessment items, ${stats.reflectionAndLogs} reflection/learning-log items, ${stats.courseSections} course-level section item(s), ${stats.teacherResources} teacher-facing items.
- Textbook: no textbook was exposed in the authenticated Moodle shell; none was added.
- iSpring/H5P/video: no localizable iSpring, H5P, or video packages were exposed in the authenticated Moodle shell.
- External URL activities: valid public computer-studies links are retained as local wrapper pages with external references.
- Display ownership: Unit Assessments are unit resources, Final Evaluation is course-level, and Teacher Evaluation is teacher-facing. They are not lesson-flow downloads.
`;
writeFileSync(sourceNotesPath, sources, "utf8");
const notes = manifest.courseDownloads.find((item) => isSourceNotes(item));
if (notes) notes.bytes = statSync(sourceNotesPath).size;
writeJson(manifestPath, manifest);

updateCatalog(stats);
updateRoadmap(stats);

console.log(JSON.stringify({ course, ...stats, generatedAt: now }, null, 2));
