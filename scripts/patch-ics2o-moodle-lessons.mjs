import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "ICS2O", "course-manifest.json");
const rescanJsonPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const rescanCsvPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.csv");
const nextCandidatesPath = join(projectRoot, "deployment", "moodle-next-course-candidates.md");

const unitTitles = {
  1: "Unit 1: Understanding Computers",
  2: "Unit 2: Introduction to Programming",
  3: "Unit 3: Computers and Societies",
};

const activity = (mod, id, label, role = null) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role: role || (mod === "resource" ? "lesson_resource" : mod),
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle crawl",
});

const lessonResource = (id, label) => activity("resource", id, label, "lesson_resource");
const assignment = (id, label) => activity("assign", id, label, "assignment");
const external = (id, label) => activity("url", id, label, "external_resource");

const lessonsByUnit = {
  1: [
    ["Lesson 1", [lessonResource(3756, "Lesson-1"), lessonResource(3766, "Lesson slide"), external(3770, "What Is a Computer?")]],
    ["Lesson 2", [lessonResource(3757, "Lesson-2"), lessonResource(3767, "Lesson slide"), external(3771, "Binary")]],
    ["Lesson 3", [lessonResource(3758, "Lesson-3"), lessonResource(3768, "Lesson slide"), external(3772, "Inside a Computer")]],
    ["Lesson 4", [lessonResource(3759, "Lesson-4"), lessonResource(3769, "Whiteboard Note 1"), external(3773, "Basic Parts of a Computer")]],
    ["Lesson 5", [lessonResource(3760, "Lesson-5"), external(3774, "Buttons and Ports on a Computer")]],
    ["Lesson 6", [lessonResource(3761, "Lesson-6")]],
    ["Lesson 7", [lessonResource(3762, "Lesson-7")]],
    ["Lesson 8", [lessonResource(3763, "Lesson-8")]],
    ["Lesson 9", [lessonResource(3764, "Lesson-9")]],
    [
      "Lesson 10",
      [
        lessonResource(3765, "Lesson-10"),
        assignment(3775, "Unit 1 - Learning Log - AAL"),
        assignment(3776, "Unit 1 - Teacher's Observation / Conversation Checklists - AFL"),
        assignment(3777, "Unit 1 - AAL"),
        assignment(3778, "Unit 1 - AFL #1"),
        assignment(3779, "Unit 1 - AFL #2"),
        assignment(3780, "Unit 1 - Assignment 1 - AOL"),
        assignment(3781, "Unit 1 - Assignment 2 - AOL"),
        assignment(3782, "Unit 1 Test - AOL"),
      ],
    ],
  ],
  2: [
    ["Lesson 1", [lessonResource(3788, "Lesson-1"), lessonResource(3783, "Unit 2 Lesson Plan 1")]],
    ["Lesson 2", [lessonResource(3789, "Lesson-2"), lessonResource(3784, "Unit 2 Lesson Plan 2")]],
    ["Lesson 3", [lessonResource(3790, "Lesson-3"), lessonResource(3785, "Unit 2 Lesson Plan 3")]],
    ["Lesson 4", [lessonResource(3791, "Lesson-4"), lessonResource(3786, "Unit 2 Lesson Plan 4")]],
    ["Lesson 5", [lessonResource(3792, "Lesson-5"), lessonResource(3787, "Unit 2 Lesson Plan 5")]],
    ["Lesson 6", [lessonResource(3793, "Lesson-6")]],
    ["Lesson 7", [lessonResource(3794, "Lesson-7")]],
    ["Lesson 8", [lessonResource(3795, "Lesson-8")]],
    ["Lesson 9", [lessonResource(3796, "Lesson-9")]],
    ["Lesson 10", [lessonResource(3797, "Lesson-10")]],
    ["Lesson 11", [lessonResource(3798, "Lesson-11")]],
    ["Lesson 12", [lessonResource(3799, "Lesson-12")]],
    ["Lesson 13", [lessonResource(3800, "Lesson-13")]],
    ["Lesson 14", [lessonResource(3801, "Lesson-14")]],
    ["Lesson 15", [lessonResource(3802, "Lesson-15")]],
    [
      "Lesson 16",
      [
        lessonResource(3803, "Lesson-16"),
        assignment(3804, "Unit 2 - Learning Log - AAL"),
        assignment(3805, "Unit 2 - Teacher's Observation / Conversation Checklists - AFL"),
        assignment(3806, "AAL Unit 2"),
        assignment(3807, "AFL 1 Unit 2"),
        assignment(3808, "AFL 2 Unit 2"),
        assignment(3809, "Assignment 1 Unit 2 - AOL"),
        assignment(3810, "Assignment 2 Unit 2 - AOL"),
        assignment(3811, "Test 1 Unit 2 - AOL"),
        assignment(3812, "Unit Test Unit 2 - AOL"),
      ],
    ],
  ],
  3: [
    ["Lesson 1", [lessonResource(3813, "Lesson-1")]],
    ["Lesson 2", [lessonResource(3814, "Lesson-2")]],
    ["Lesson 3", [lessonResource(3815, "Lesson-3")]],
    ["Computer Society 1", [lessonResource(3816, "Computer Society 1")]],
    [
      "Computer and Society",
      [
        lessonResource(3817, "Computer and Society (updated)"),
        assignment(3818, "Unit 3 - Learning Log - AAL"),
        assignment(3819, "AFL Unit 3"),
        assignment(3820, "Assignment 1 Unit 3 - AOL"),
        assignment(3821, "Assignment 2 Unit 3 - AOL"),
        assignment(3822, "Unit 3 - Teacher's Observation / Conversation Checklists - AFL"),
        assignment(3823, "Unit Test Unit 3 - AOL"),
        assignment(3824, "Final Project"),
        assignment(3825, "Final Exam"),
        assignment(3826, "Learning Skills and Work Habits Evaluation (Teacher only)"),
        assignment(3827, "Teacher's Comments for Midterm and Final"),
      ],
    ],
  ],
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function unitSummary(lessons) {
  return {
    downloads: lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0),
    ispring: lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0),
    docx: lessons.reduce((sum, lesson) => sum + (lesson.lessonPlan ? 1 : 0), 0),
    pdf: 0,
    video: 0,
    h5p: 0,
  };
}

function writeRescanCsv(courses) {
  const header = "priority,course,moodleCourseId,coursePage,category,reason,expectedEvidence,status,notes";
  const rows = courses.map((course) =>
    [
      course.priority,
      course.course,
      course.moodleCourseId,
      course.coursePage,
      course.category,
      course.reason,
      (course.expectedEvidence || []).join("; "),
      course.status,
      course.notes,
    ]
      .map((value) => String(value ?? "").replaceAll('"', '""'))
      .map((value) => (/[",\n]/.test(value) ? `"${value}"` : value))
      .join(","),
  );
  writeFileSync(rescanCsvPath, `${header}\n${rows.join("\n")}\n`, "utf8");
}

const manifest = readJson(manifestPath);
const courseDownloads = manifest.courseDownloads || [];
const existingCourseResourceLabels = new Set(courseDownloads.map((item) => item.label));
for (const item of [
  activity("resource", 3754, "Achievement chart", "course_resource"),
  activity("resource", 3755, "Learning Log", "course_resource"),
]) {
  if (!existingCourseResourceLabels.has(item.label)) courseDownloads.push(item);
}
manifest.courseDownloads = courseDownloads;
manifest.units = Object.entries(lessonsByUnit).map(([unitNumber, specs]) => {
  const unit = Number(unitNumber);
  const lessons = specs.map(([title, items], index) => {
    const lesson = index + 1;
    const id = `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`;
    return {
      id,
      unit,
      lesson,
      title,
      path: `lessons/U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
      bookPageCount: 0,
      lessonText: [],
      textExports: [],
      lessonPlan: null,
      ispring: [],
      downloads: items,
      resourceCounts: {
        downloads: items.length,
        moodleActivities: items.length,
      },
    };
  });
  return {
    unit,
    title: unitTitles[unit],
    coreTexts: [],
    unitPlan: null,
    unitResources: {},
    summary: unitSummary(lessons),
    lessons,
  };
});
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  lessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  authenticatedMoodleRescanAt: new Date().toISOString(),
  moodleActivityResourceCount: 74,
  moodleNumberedLessonCount: 31,
};
writeJson(manifestPath, manifest);

const rescan = readJson(rescanJsonPath);
const removed = (rescan.courses || []).filter((course) => course.course === "ICS2O");
rescan.courses = (rescan.courses || []).filter((course) => course.course !== "ICS2O");
rescan.generatedAt = new Date().toISOString();
rescan.notes = "ENG2D, OLC4O, ICS4U, and ICS2O were removed after authenticated browser access confirmed their course outlines and Moodle resources.";
writeJson(rescanJsonPath, rescan);
writeRescanCsv(rescan.courses || []);

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates
  .replace(
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, and ICS4U have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, and ICS2O have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
  )
  .replace(
    "| 85 | ICS2O | 36 | Grade 10 computer studies; login-required during deep scan. | Course Outline, Moodle Books, assignment attachments. |\n",
    "",
  )
  .replace(
    "1. After Moodle login in the Codex in-app browser, re-scan `ICS2O`, `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
    "1. After Moodle login in the Codex in-app browser, re-scan `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
  );
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`ICS2O: wrote ${manifest.sourceAudit.lessonCount} lesson records with ${manifest.sourceAudit.moodleActivityResourceCount} Moodle activities`);
console.log(`Authenticated rescan queue: removed ${removed.length} ICS2O row; ${rescan.courses.length} row(s) remain`);
