import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "MTH1W", "course-manifest.json");
const rescanJsonPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const rescanCsvPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.csv");
const nextCandidatesPath = join(projectRoot, "deployment", "moodle-next-course-candidates.md");

const unitTitles = {
  1: "Unit 1: Number",
  2: "Unit 2: Algebra",
  3: "Unit 3: Data",
  4: "Unit 4: Geometry and Measurement",
  5: "Unit 5: Coding",
  6: "Unit 6: Financial Literacy",
};

const activity = (mod, id, label, role = null) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role: role || (mod === "resource" ? "lesson_resource" : mod),
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle crawl",
});

const resource = (id, label) => activity("resource", id, label, "lesson_resource");
const url = (id, label) => activity("url", id, label, "external_resource");
const assignment = (id, label) => activity("assign", id, label, "assignment");
const folder = (id, label) => activity("folder", id, label, "folder");

const lessonsByUnit = {
  1: [
    ["Setup and Learning Logs", [assignment(5830, "MTH1W - Self Assessment Submission - AAL"), assignment(5831, "Learning Log (AAL): Number"), assignment(5832, "Exit Ticket (AAL)")]],
    ["Integers", [resource(5834, "Integers I"), resource(5835, "Integers II"), url(5836, "Adding Integers: Orbit Integers"), url(5837, "Math Lines Integers"), url(5838, "Spider Match Game"), url(5839, "Positive and Negative Integers")]],
    ["Fractions", [url(5841, "Online Pizza Shop and Fractions"), url(5843, "PHET: Build a Fraction"), url(5844, "Fraction Circle Interactives"), url(5845, "Fractions: Addition"), url(5846, "Fraction fling"), resource(5847, "BEDMAS Fractions")]],
    ["Sets and Subsets", [resource(5849, "Sets and Sub-sets")]],
    ["Exponents", [resource(5851, "Exponents")]],
    ["Rates, Unit Rate, Ratio, Proportions and Percent", [resource(5853, "Lesson: Rates, Unit Rate, Ratio, Proportions and Percent")]],
  ],
  2: [
    ["Learning Logs", [assignment(5854, "Learning Log (AAL): Algebra"), assignment(5855, "Exit Ticket (AAL)")]],
    ["Monomials", [resource(5857, "Monomials I"), url(5858, "Multiplying and Dividing Monomials")]],
    ["Polynomials", [resource(5860, "Polynomials"), url(5861, "Adding and Subtracting Polynomials"), url(5862, "Multiplying Polynomials using the Distributive Property")]],
    ["Solving and Modelling Equations", [resource(5864, "Solving Equations I"), resource(5865, "Modelling Equations"), url(5878, "How to Solve Algebra Equations Using Inverse Operations"), url(5879, "Strategies to Solve Multi Step Linear Equations with Fractions"), url(5880, "Solving for a variable | Linear equations"), url(5881, "Solving Linear Systems Algebraically"), url(5885, "Application of Equations")]],
    ["Linear Relations", [url(5868, "Slope"), url(5869, "Direct and Partial Variation"), url(5870, "Equation of lines"), url(5871, "Find an equation I"), url(5872, "Find an equation II"), url(5873, "Finding Equation From Table"), url(5874, "System of Two Lines"), url(5875, "Patterns and First Differences"), url(5877, "Analyzing Linear Patterns"), url(5882, "Parallel and Perpendicular Lines"), url(5883, "X and Y Intercepts")]],
  ],
  3: [
    ["Learning Logs", [assignment(5886, "Learning Log (AAL): Data"), assignment(5887, "Exit Ticket (AAL)")]],
    ["Basics of Graphing", [url(5891, "Basics of graphing")]],
    ["Distance Time Graphs", [url(5892, "Distance Time Graphs")]],
  ],
  4: [
    ["Learning Logs", [assignment(5893, "Learning Log (AAL): Geometry and Measurement"), assignment(5894, "Exit Ticket (AAL)")]],
    ["Geometry", [url(5896, "Geometry I"), url(5897, "Geometry II"), url(5898, "Geometry III"), url(5899, "Geometry IV"), url(5900, "Geometry V")]],
    ["2D Measurement", [url(5902, "2D measurement I"), url(5903, "2D measurement II"), url(5904, "2D measurement III"), url(5905, "2D measurement IV")]],
    ["3D Measurement", [url(5907, "3D measurement I"), url(5908, "3D measurement II"), url(5909, "3D measurement III"), url(5910, "3D measurement IV")]],
    ["Optimization", [url(5912, "Optimization I"), url(5913, "Optimization II"), url(5914, "Optimization III"), url(5915, "Optimization IV")]],
    ["PPT Lessons", [folder(5916, "PPT Lessons")]],
  ],
  5: [
    ["Python Introduction", [url(5917, "Python In 5 Problems | Introduction"), activity("page", 5918, "Python In 5 Problems | Introduction", "lesson_page")]],
    ["Python Problem 1", [url(5919, "Python In 5 Problems | Problem #1"), activity("page", 5920, "Python In 5 Problems | Problem #1", "lesson_page")]],
    ["Python Problem 2", [url(5921, "Python In 5 Problems | Problem #2"), activity("page", 5922, "Python In 5 Problems | Problem #2", "lesson_page")]],
    ["Python Problem 3", [url(5923, "Python In 5 Problems | Problem #3"), activity("page", 5924, "Python In 5 Problems | Problem #3", "lesson_page")]],
    ["Python Problem 4", [url(5925, "Python In 5 Problems | Problem #4"), activity("page", 5926, "Python In 5 Problems | Problem #4", "lesson_page")]],
    ["Python Problem 5", [url(5927, "Python In 5 Problems | Problem #5"), activity("page", 5928, "Python In 5 Problems | Problem #5", "lesson_page")]],
    ["Python Final Notes", [url(5929, "Python In 5 Problems | Final Notes"), activity("page", 5930, "Python In 5 Problems | Final Notes", "lesson_page"), url(5931, "Reference Guide")]],
  ],
  6: [
    ["Financial Literacy", [assignment(5932, "Learning Log (AAL): Financial Literacy"), assignment(5933, "Exit Ticket (AAL)"), assignment(5958, "Unit Test 5 - Financial Literacy - AOL"), assignment(5966, "Assignment 5: Financial Literacy - AOL")]],
  ],
};

const assessmentDownloads = [
  resource(5935, "Worksheets (AFL)"),
  assignment(5936, "Worksheets (AFL) submission"),
  resource(5938, "Exponents Practice (AFL)"),
  assignment(5939, "Exponents Practice (AFL) submission"),
  folder(5942, "Data Worksheets (AFL)"),
  assignment(5943, "Data Worksheets (AFL) submission"),
  folder(5944, "Solving Equations Worksheets (AFL)"),
  assignment(5945, "Solving Equations Worksheets (AFL) submission"),
  folder(5946, "Modeling with Graphs Worksheets (AFL)"),
  assignment(5947, "Modeling with Graphs Worksheets (AFL) submission"),
  assignment(5950, "Unit Test 1: Number - AOL"),
  assignment(5952, "Unit Test 2: Algebra Submissions - AOL"),
  assignment(5953, "Unit Test 3 Data and Linear Relations part - AOL"),
  assignment(5956, "Unit Test 4: Geometry and Measurements - AOL"),
  assignment(5961, "Assignment 1 - AOL"),
  assignment(5963, "Assignment 2: Cell Phone Plans - AOL"),
  assignment(5964, "Assignment 3: Linear Equation Project - AOL"),
  assignment(5965, "Assignment 4: Coding - AOL"),
  assignment(5973, "Independent Study Project"),
  assignment(5975, "Final Exam"),
  url(5976, "EQAO Recent Sample Test and Formula Sheet"),
  url(5977, "EQAO Past Papers"),
  folder(5978, "EQAO 1"),
];

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
const existingLabels = new Set(courseDownloads.map((item) => item.label));
for (const item of [
  activity("resource", 5822, "MTH1W - Course Outline (copy)", "course_outline_copy"),
  activity("resource", 5823, "Virtual Classroom Rules", "course_resource"),
  activity("resource", 5824, "Unit plan", "unit_plan_bundle"),
  activity("resource", 5825, "Learning Log", "course_resource"),
  activity("url", 5826, "MTH1W Google Calendar", "course_resource"),
  activity("resource", 5827, "Math Vocabulary", "course_resource"),
  activity("resource", 5828, "Parent Communication Form", "course_resource"),
  activity("url", 5829, "Pre course survey", "course_resource"),
  ...assessmentDownloads,
]) {
  if (!existingLabels.has(item.label)) courseDownloads.push(item);
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
  moodleActivityResourceCount: manifest.courseDownloads.length + manifest.units.reduce((sum, unit) => sum + unit.summary.downloads, 0),
  moodleTopicLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
};
writeJson(manifestPath, manifest);

const rescan = readJson(rescanJsonPath);
const removed = (rescan.courses || []).filter((course) => course.course === "MTH1W");
rescan.courses = (rescan.courses || []).filter((course) => course.course !== "MTH1W");
rescan.generatedAt = new Date().toISOString();
rescan.notes = "ENG2D, OLC4O, ICS4U, ICS2O, and MTH1W were removed after authenticated browser access confirmed their course outlines and Moodle resources.";
writeJson(rescanJsonPath, rescan);
writeRescanCsv(rescan.courses || []);

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates
  .replace(
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, and ICS2O have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, ICS2O, and MTH1W have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
  )
  .replace(
    "| 80 | MTH1W | 59 | Grade 9 de-streamed math; login-required during deep scan. | Course Outline, Moodle Books, assignment attachments. |\n",
    "",
  )
  .replace(
    "1. After Moodle login in the Codex in-app browser, re-scan `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
    "1. After Moodle login in the Codex in-app browser, re-scan `PPL3O`, `PPL1O`, and `CGC1D`.",
  );
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`MTH1W: wrote ${manifest.sourceAudit.lessonCount} topic lesson records with ${manifest.sourceAudit.moodleActivityResourceCount} Moodle resources`);
console.log(`Authenticated rescan queue: removed ${removed.length} MTH1W row; ${rescan.courses.length} row(s) remain`);
