import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "ICS4U", "course-manifest.json");
const rescanJsonPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const rescanCsvPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.csv");
const nextCandidatesPath = join(projectRoot, "deployment", "moodle-next-course-candidates.md");

const unitTitles = {
  1: "Unit 1: Programming Concepts and Skills Review",
  2: "Unit 2: Object-Oriented Programming",
  3: "Unit 3: Design and Analysis of Algorithms",
  4: "Unit 4: Software Development Life Cycle",
};

const activity = (mod, id, label, role = null) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role: role || (mod === "resource" ? "lesson_resource" : mod),
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle crawl",
});

const lessonsByUnit = {
  1: [
    {
      title: "Lesson 1.1",
      items: [
        activity("resource", 3830, "Lesson 1.1"),
        activity("assign", 3831, "AFL Scopes of variables in Java worksheet", "assignment"),
      ],
    },
    {
      title: "Lesson 1.2",
      items: [
        activity("resource", 3832, "Lesson 1.2"),
        activity("assign", 3833, "AAL Scopes of variables in Java discussion", "assignment"),
      ],
    },
    {
      title: "Lesson 1.3",
      items: [
        activity("resource", 3834, "Lesson 1.3"),
        activity("assign", 3835, "AFL Types casting in Java", "assignment"),
      ],
    },
    {
      title: "Lesson 1.4",
      items: [
        activity("resource", 3836, "Lesson 1.4"),
        activity("assign", 3837, "AFL Data structures in Java", "assignment"),
      ],
    },
    {
      title: "Lesson 1.5",
      items: [
        activity("resource", 3838, "Lesson 1.5"),
        activity("assign", 3839, "AFL Reusability code in Java worksheet", "assignment"),
      ],
    },
    {
      title: "Lesson 1.6",
      items: [
        activity("resource", 3840, "Lesson 1.6"),
        activity("assign", 3841, "AOL Java Basic Programming - Assignment", "assignment"),
      ],
    },
    {
      title: "Lesson 1.7",
      items: [
        activity("resource", 3842, "Lesson 1.7"),
        activity("assign", 3843, "AOL Java Basic Syntax - Test A", "assignment"),
        activity("assign", 3844, "AOL Calculator in Java - Assignment", "assignment"),
      ],
    },
  ],
  2: [
    {
      title: "Lesson 2.1",
      items: [
        activity("resource", 3845, "Lesson 2.1"),
        activity("forum", 3846, "AAL Use multiple classes in Java", "discussion"),
      ],
    },
    {
      title: "Lesson 2.2",
      items: [
        activity("resource", 3847, "Lesson 2.2"),
        activity("quiz", 3848, "AFL UML", "quiz"),
      ],
    },
    {
      title: "Lesson 2.3",
      items: [
        activity("resource", 3849, "Lesson 2.3"),
        activity("assign", 3850, "AOL UML Diagram", "assignment"),
      ],
    },
    {
      title: "Lesson 2.4",
      items: [
        activity("resource", 3851, "Lesson 2.4"),
        activity("assign", 3852, "AFL UML class, object and component diagram worksheet", "assignment"),
      ],
    },
    {
      title: "Lesson 2.5",
      items: [
        activity("resource", 3853, "Lesson 2.5"),
        activity("forum", 3854, "AAL Inheritance in Java discussion forum post", "discussion"),
      ],
    },
    {
      title: "Lesson 2.6",
      items: [
        activity("resource", 3855, "Lesson 2.6"),
        activity("assign", 3856, "AFL - How Encapsulation Works?", "assignment"),
      ],
    },
    {
      title: "Lesson 2.7",
      items: [
        activity("resource", 3857, "Lesson 2.7"),
        activity("assign", 3858, "AFL Java Runtime Polymorphism Example: Bank Worksheet", "assignment"),
        activity("assign", 3859, "AOL Unit 2 - Test B", "assignment"),
        activity("assign", 3860, "AOL Student Teacher's conference Evaluation: Observation, Conversation", "assignment"),
      ],
    },
  ],
  3: [
    {
      title: "Lesson 3.1",
      items: [
        activity("resource", 3861, "Lesson 3.1"),
        activity("quiz", 3862, "AAL Search Algorithm in Java self-assessment", "quiz"),
      ],
    },
    {
      title: "Lesson 3.2",
      items: [
        activity("resource", 3863, "Lesson 3.2"),
        activity("assign", 3864, "AOL Two-Dimensional Arrays in Java", "assignment"),
      ],
    },
    {
      title: "Lesson 3.3",
      items: [
        activity("resource", 3865, "Lesson 3.3"),
        activity("forum", 3866, "AFL Binary search Algorithm in Java understanding checkpoint", "discussion"),
      ],
    },
    {
      title: "Lesson 3.4",
      items: [
        activity("resource", 3867, "Lesson 3.4"),
        activity("quiz", 3868, "AFL Sorting algorithm in Java self-assessment skill check", "quiz"),
      ],
    },
    {
      title: "Lesson 3.5",
      items: [
        activity("resource", 3869, "Lesson 3.5"),
        activity("assign", 3870, "AFL Sorting Algorithm In Java", "assignment"),
      ],
    },
    {
      title: "Lesson 3.6",
      items: [
        activity("resource", 3871, "Lesson 3.6"),
        activity("assign", 3872, "AOL Unit 3 Test", "assignment"),
      ],
    },
  ],
  4: [
    {
      title: "Lesson 4.1",
      items: [activity("resource", 3873, "Lesson 4.1")],
    },
    {
      title: "Lesson 4.2",
      items: [
        activity("resource", 3874, "Lesson 4.2"),
        activity("forum", 3875, "AFL Gantt chart vs. PERT chart", "discussion"),
      ],
    },
    {
      title: "Lesson 4.3",
      items: [
        activity("resource", 3876, "Lesson 4.3"),
        activity("assign", 3877, "AOL Set Value Debugging in Java", "assignment"),
      ],
    },
    {
      title: "Lesson 4.4",
      items: [activity("resource", 3878, "Lesson 4.4")],
    },
    {
      title: "Lesson 4.5",
      items: [
        activity("resource", 3879, "Lesson 4.5"),
        activity("forum", 3880, "AAL Forum: Local or Governmental Movements", "discussion"),
      ],
    },
    {
      title: "Lesson 4.6",
      items: [
        activity("resource", 3881, "Lesson 4.6"),
        activity("assign", 3882, "AOL Software Project Plan", "assignment"),
        activity("assign", 3883, "AOL Unit 4 Test", "assignment"),
        activity("assign", 3884, "Final Culminating Activity", "assignment"),
        activity("assign", 3885, "Final Exam", "assignment"),
      ],
    },
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
manifest.units = Object.entries(lessonsByUnit).map(([unitNumber, specs]) => {
  const unit = Number(unitNumber);
  const lessons = specs.map((spec, index) => {
    const lesson = index + 1;
    const id = `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`;
    return {
      id,
      unit,
      lesson,
      title: spec.title,
      path: `lessons/U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
      bookPageCount: 0,
      lessonText: [],
      textExports: [],
      lessonPlan: null,
      ispring: [],
      downloads: spec.items,
      resourceCounts: {
        downloads: spec.items.length,
        moodleActivities: spec.items.length,
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
  moodleActivityResourceCount: 57,
  moodleNumberedLessonCount: 26,
};
writeJson(manifestPath, manifest);

const rescan = readJson(rescanJsonPath);
const removed = (rescan.courses || []).filter((course) => course.course === "ICS4U");
rescan.courses = (rescan.courses || []).filter((course) => course.course !== "ICS4U");
rescan.generatedAt = new Date().toISOString();
rescan.notes = "ENG2D, OLC4O, and ICS4U were removed after authenticated browser access confirmed their course outlines and Moodle resources.";
writeJson(rescanJsonPath, rescan);
writeRescanCsv(rescan.courses || []);

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates
  .replace(
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D and OLC4O have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, and ICS4U have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
  )
  .replace(
    "| 90 | ICS4U | 37 | Grade 12 computer science; login-required during deep scan. | Course Outline, Moodle Books, assignment attachments. |\n",
    "",
  )
  .replace(
    "1. After Moodle login in the Codex in-app browser, re-scan `ICS4U`, `ICS2O`, `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
    "1. After Moodle login in the Codex in-app browser, re-scan `ICS2O`, `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
  );
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`ICS4U: wrote ${manifest.sourceAudit.lessonCount} lesson records with ${manifest.sourceAudit.moodleActivityResourceCount} Moodle activities`);
console.log(`Authenticated rescan queue: removed ${removed.length} ICS4U row; ${rescan.courses.length} row(s) remain`);
