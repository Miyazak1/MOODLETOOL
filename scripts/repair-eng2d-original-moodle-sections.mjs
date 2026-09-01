import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG2D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const stagingRoot = join(projectRoot, "downloads", "course-packages", course);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const normalize = (value) => String(value || "").replaceAll("\\", "/");
const clone = (value) => JSON.parse(JSON.stringify(value));

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pathInsideCourse(relPath) {
  return resolve(courseRoot, relPath || "").startsWith(resolve(courseRoot));
}

function syncToStaging(relPath) {
  if (!relPath || !existsSync(stagingRoot)) return false;
  const sourcePath = join(courseRoot, relPath);
  if (!existsSync(sourcePath)) return false;
  const targetPath = join(stagingRoot, relPath);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return true;
}

function findByPath(items, pathNeedle) {
  const normalizedNeedle = normalize(pathNeedle);
  return (items || []).find((item) => normalize(item?.path) === normalizedNeedle);
}

function findByActivityPath(pathNeedle) {
  const all = [];
  for (const item of manifest.courseDownloads || []) all.push(item);
  for (const item of manifest.courseSections || []) all.push(item);
  for (const item of manifest.teacherResources || []) all.push(item);
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const download of lesson.downloads || []) all.push(download);
    }
  }
  return findByPath(all, pathNeedle);
}

function withBytes(item) {
  if (item?.path && pathInsideCourse(item.path) && existsSync(join(courseRoot, item.path))) {
    item.bytes = statSync(join(courseRoot, item.path)).size;
  }
  if (Array.isArray(item?.attachments)) {
    for (const attachment of item.attachments) withBytes(attachment);
  }
  return item;
}

function typeFromPath(path) {
  const normalized = normalize(path).toLowerCase();
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "html";
  if (normalized.endsWith(".pdf")) return "pdf";
  if (normalized.endsWith(".docx")) return "docx";
  if (normalized.endsWith(".doc")) return "doc";
  return "file";
}

function localResource(label, resourcePath, overrides = {}) {
  return withBytes({
    label,
    type: typeFromPath(resourcePath),
    category: overrides.category || "course_resource",
    role: overrides.role || "course_resource",
    path: resourcePath,
    source: "authenticated Moodle course page",
    ...overrides,
  });
}

function resourceToLesson(resource, unitNumber, lessonNumber, idSuffix, role = "lesson") {
  const item = withBytes(clone(resource));
  item.unit = unitNumber;
  item.lesson = lessonNumber;
  item.role = role;
  item.sourceGroup = `unit_${unitNumber}_moodle_section`;
  item.parentSection = `Unit ${unitNumber}`;
  const title = item.label || item.title || `Moodle activity ${idSuffix}`;
  item.label = title;
  item.type ||= typeFromPath(item.path || "");
  delete item.id;
  delete item.title;
  delete item.lessonText;
  delete item.textExports;
  delete item.lessonPlan;
  delete item.ispring;
  delete item.downloads;
  delete item.resourceCounts;
  return {
    id: `U${String(unitNumber).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}-${idSuffix}`,
    unit: unitNumber,
    lesson: lessonNumber,
    title,
    path: item.path,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads: [item],
    resourceCounts: {
      downloads: 1,
      lessonPlan: 0,
      ispring: 0,
    },
    teacherOnly: Boolean(item.teacherOnly),
  };
}

function removeByPath(items, relPath) {
  const normalizedPath = normalize(relPath);
  return (items || []).filter((item) => normalize(item?.path) !== normalizedPath);
}

function upsertLesson(unitNumber, lesson) {
  const unit = (manifest.units || []).find((candidate) => Number(candidate.unit) === unitNumber);
  if (!unit) throw new Error(`Missing Unit ${unitNumber}`);
  unit.lessons = removeByPath(unit.lessons || [], lesson.path);
  unit.lessons.push(lesson);
  unit.lessons.sort((left, right) => Number(left.lesson || 0) - Number(right.lesson || 0));
  unit.summary = {
    ...(unit.summary || {}),
    downloads: unit.lessons.length,
    activityCount: unit.lessons.length,
  };
  return unit;
}

function uniqueResources(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    const key = normalize(item.path || item.source || item.label || item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const unit3TeacherTestPath = "localized-moodle-activities/folder/U03L01-463-afcc0fbee9/index.html";
const unit6TeacherExamPath = "localized-moodle-activities/folder/U06L01-491-adf3de6912/index.html";

const unit3TeacherTest =
  findByActivityPath(unit3TeacherTestPath) ||
  {
    label: "ENG2D Unit #3 Test (FOR TEACHER USE ONLY)",
    type: "html",
    category: "moodle_folder",
    role: "answer_key",
    path: unit3TeacherTestPath,
    source: "authenticated Moodle course page",
    teacherOnly: true,
  };
const unit6TeacherExam =
  findByActivityPath(unit6TeacherExamPath) ||
  {
    label: "ENG2D Final Exam (FOR TEACHER USE ONLY)",
    type: "html",
    category: "moodle_folder",
    role: "answer_key",
    path: unit6TeacherExamPath,
    source: "authenticated Moodle course page",
    teacherOnly: true,
  };

unit3TeacherTest.teacherOnly = true;
unit3TeacherTest.role = "answer_key";
unit3TeacherTest.category ||= "moodle_folder";
unit3TeacherTest.sourceGroup = "unit_3_moodle_section";
unit3TeacherTest.parentSection = 'Unit 3: Novel Study - "Lord of the Flies"';
unit3TeacherTest.unit = 3;
unit3TeacherTest.lesson = 33;

unit6TeacherExam.teacherOnly = true;
unit6TeacherExam.role = "answer_key";
unit6TeacherExam.category ||= "moodle_folder";
unit6TeacherExam.sourceGroup = "unit_6_moodle_section";
unit6TeacherExam.parentSection = "Unit 6: Culminating Evaluation - Final Exam";
unit6TeacherExam.unit = 6;
unit6TeacherExam.lesson = 2;

upsertLesson(3, resourceToLesson(unit3TeacherTest, 3, 33, "463", "answer_key"));
upsertLesson(6, resourceToLesson(unit6TeacherExam, 6, 2, "491", "answer_key"));

manifest.teacherResources = removeByPath(manifest.teacherResources || [], unit3TeacherTestPath);
manifest.teacherResources = removeByPath(manifest.teacherResources || [], unit6TeacherExamPath);

const originalMoodleSections = [
  {
    sectionKey: "introduction",
    sectionTitle: "Introduction",
    sectionOrder: 1,
    items: [
      {
        label: "Announcements",
        path: "localized-moodle-activities/forum/course-374-e606815f46/index.html",
        role: "introduction",
        category: "moodle_forum",
      },
      {
        label: "VIP: Please Read and Respond BEFORE beginning the course!",
        path: "localized-moodle-activities/forum/course-375-3b73df3e9d/index.html",
        role: "introduction",
        category: "moodle_forum",
      },
    ],
  },
  {
    sectionKey: "eng2d-course-documents",
    sectionTitle: "ENG2D Course Documents",
    sectionOrder: 2,
    items: [
      {
        label: "ENG2D Course Outline",
        path: "localized-moodle-activities/resource/course-376-9978758c6a/9978758c6a-ENG2D-Course-Outline.docx",
        role: "course_outline",
      },
      {
        label: "ENG2D Online Course Planning",
        path: "localized-moodle-activities/resource/course-377-df59a960d3/df59a960d3-ENG2D-Online-Course-Planning.doc",
        role: "course_planning",
      },
      {
        label: "ENG2D- Learning Goals and Success Criteria",
        path: "localized-moodle-activities/resource/course-378-1e935a6c68/1e935a6c68-ENG2D-Learning-Goals-and-Success-Criteria.docx",
        role: "learning_goals_success_criteria",
      },
      {
        label: "English 9 and 10, Ontario Curriculum",
        path: "localized-moodle-activities/resource/course-379-4cdcceef6c/4cdcceef6c-English-9-and-10-Ontario-Curriculum.pdf",
        role: "curriculum",
      },
      {
        label: "ENG2D Lesson Plans",
        path: "localized-moodle-activities/folder/course-380-5c6c166a4b/index.html",
        role: "lesson_plan",
        category: "moodle_folder",
      },
    ],
  },
  {
    sectionKey: "resources",
    sectionTitle: "Resources",
    sectionOrder: 3,
    items: [
      {
        label: "Essay Writing Resources",
        path: "localized-moodle-activities/folder/course-381-852361d50b/index.html",
        role: "course_resource",
        category: "moodle_folder",
      },
      {
        label: "Distinguishing Between Assessments As, For, and Of",
        path: "localized-moodle-activities/resource/course-382-abc1abdc9c/abc1abdc9c-Distinguishing-Between-Assessments-As-For-and-Of.docx",
        role: "course_resource",
      },
      {
        label: "Triangulation Diagram",
        path: "localized-moodle-activities/resource/course-383-79d718582e/79d718582e-Triangulation-Diagram.pdf",
        role: "course_resource",
      },
      {
        label: "Rubric: Unit Discussions",
        path: "localized-moodle-activities/resource/course-384-0331272e5f/0331272e5f-Group-Discussion-Assessment-Rubric.pdf",
        role: "course_resource",
      },
    ],
  },
];

const originalSectionPaths = new Set(originalMoodleSections.flatMap((section) => section.items.map((item) => normalize(item.path))));
const originalSectionItems = originalMoodleSections.flatMap((section) =>
  section.items.map((definition, itemIndex) => {
    const existing = findByActivityPath(definition.path);
    return withBytes({
      ...localResource(definition.label, definition.path, {
        role: definition.role,
        category: definition.category,
      }),
      ...(existing ? clone(existing) : {}),
      label: definition.label,
      role: definition.role,
      category: definition.category || (definition.role === "course_outline" ? "course_document" : "course_resource"),
      parentSection: section.sectionTitle,
      sectionKey: section.sectionKey,
      sectionTitle: section.sectionTitle,
      sectionOrder: section.sectionOrder,
      sourceGroup: "original_moodle_section",
      sortOrder: section.sectionOrder * 100 + itemIndex + 1,
      teacherOnly: false,
    });
  }),
);

manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => !originalSectionPaths.has(normalize(item.path)));
manifest.teacherResources = (manifest.teacherResources || []).filter((item) => !originalSectionPaths.has(normalize(item.path)));
manifest.courseSections = uniqueResources([
  ...(manifest.courseSections || []).filter((item) => !originalSectionPaths.has(normalize(item.path))),
  ...originalSectionItems,
]);
manifest.courseSections.sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0));

const totalActivityLessons = (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons || []).length, 0);
const unitEvaluationCount = (manifest.evaluations || []).length;
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  lessonCount: totalActivityLessons,
  activityItemCount: totalActivityLessons,
  courseSections: manifest.courseSections.length,
  courseDownloads: manifest.courseDownloads.length,
  teacherResources: manifest.teacherResources.length,
  unitEvaluations: unitEvaluationCount,
  eng2dOriginalMoodleSections20260821: {
    fixedAt: new Date().toISOString(),
    basis:
      "Restored ENG2D legacy Moodle section ownership: Moodle activity 463 is a Unit 3 teacher-only activity, 487-489 remain Unit 5 ISP, 490-491 are Unit 6 Final Exam, and section 0 course resources are shown through courseSections instead of fallback other course files.",
    movedFromTeacherPacketToUnits: [
      "ENG2D Unit #3 Test (FOR TEACHER USE ONLY)",
      "ENG2D Final Exam (FOR TEACHER USE ONLY)",
    ],
    restoredOriginalCourseSections: originalMoodleSections.map((section) => ({
      section: section.sectionTitle,
      items: section.items.map((item) => item.label),
    })),
  },
};

if (manifest.sourceAudit.eng2dBbi2oLegacyStructure20260821) {
  manifest.sourceAudit.eng2dBbi2oLegacyStructure20260821.mapping = (manifest.sourceAudit.eng2dBbi2oLegacyStructure20260821.mapping || []).map((entry) => {
    if (entry.unit === 3) return { ...entry, newActivityCount: 33 };
    if (entry.unit === 6) return { ...entry, newActivityCount: 2 };
    return entry;
  });
  manifest.sourceAudit.eng2dBbi2oLegacyStructure20260821.newActivityLessonCount = totalActivityLessons;
}

writeJson(manifestPath, manifest);

const synced = [manifestPath]
  .concat(manifest.courseSections.map((item) => item.path).filter(Boolean))
  .concat([unit3TeacherTestPath, unit6TeacherExamPath])
  .filter((path) => (path === manifestPath ? false : syncToStaging(path)));
if (existsSync(stagingRoot)) copyFileSync(manifestPath, join(stagingRoot, "course-manifest.json"));

console.log(
  JSON.stringify(
    {
      course,
      units: manifest.units.map((unit) => ({ unit: unit.unit, title: unit.title, lessons: unit.lessons.length })),
      courseSections: manifest.courseSections.map((item) => item.label),
      courseDownloads: manifest.courseDownloads.map((item) => item.label),
      teacherResources: manifest.teacherResources.map((item) => item.label),
      totalActivityLessons,
      syncedFiles: synced.length + (existsSync(stagingRoot) ? 1 : 0),
    },
    null,
    2,
  ),
);
