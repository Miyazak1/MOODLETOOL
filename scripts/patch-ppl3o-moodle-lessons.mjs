import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "PPL3O";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");
const rescanJsonPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const rescanCsvPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.csv");
const nextCandidatesPath = join(projectRoot, "deployment", "moodle-next-course-candidates.md");

const unitTitles = {
  1: "Unit 1: Introduction to Health and Healthy Active Living",
  2: "Unit 2: Introduction to Health Growth and Sexuality",
  3: "Unit 3: Mental Health and Stress Management",
  4: "Unit 4: Safety and Decision Making",
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
const assignment = (id, label) => activity("assign", id, label, "assignment");
const url = (id, label) => activity("url", id, label, "recording");

const lessonsByUnit = {
  1: [
    ["Introduction to Health", [resource(5753, "Unit 1 Lesson 1 Introduction to Health"), assignment(5754, "KWL (AAL)"), assignment(5755, "Question and Answers (AFL)"), assignment(5756, "Health Brochure (AOL)")]],
    ["Why Exercise?", [resource(5757, "Unit 1 Lesson 2 Why Exercise?"), assignment(5758, "KWL (AAL)"), assignment(5759, "Questions and answers (AFL)"), assignment(5760, "VLog (AOL)")]],
    ["Injury Prevention", [resource(5761, "Unit 1 Lesson 3 Injury Prevention"), assignment(5762, "KWL (AAL)"), assignment(5763, "Questions and answers (AFL)"), assignment(5764, "Gym Poster (AOL)")]],
    ["Types of Exercise", [resource(5765, "Unit 1 Lesson 4 Types of Exercise"), assignment(5766, "KWL (AAL)"), assignment(5767, "Question and Answers (AFL)"), assignment(5768, "Discussion (AOL)")]],
    ["Transferable Movement", [resource(5769, "Unit 1 Lesson 5 Transferable Movement"), assignment(5770, "KWL (AAL)"), assignment(5771, "Question and Answers (AFL)"), assignment(5772, "Unit 1 Summative Assignment: Career (AOL)")]],
  ],
  2: [
    ["Infertility in Men", [resource(5773, "Unit 2 Lesson 1 Infertility in Men"), assignment(5774, "Student Self-Assessment Reflection (AAL)"), assignment(5775, "Question and Answers (AFL)"), assignment(5776, "Awareness Brochure (AOL)")]],
    ["Infertility in Women", [resource(5777, "Unit 2 Lesson 2 Infertility in Women"), assignment(5778, "Student Self-Assessment Reflection (AAL)"), assignment(5779, "Question and Answers (AFL)"), assignment(5780, "Information Poster (AOL)")]],
    ["The Female Athlete", [resource(5781, "Unit 2 Lesson 3 The Female Athlete"), assignment(5782, "Student Self-Assessment Reflection (AAL)"), assignment(5783, "Question and Answers (AFL)"), assignment(5784, "Discussion Female Athletes (AOL)")]],
    ["Healthy Relationships", [resource(5785, "Unit 2 Lesson 4 Healthy Relationships"), assignment(5786, "Student Self-Assessment Reflection (AAL)"), assignment(5787, "Scenario Question and Answer (AFL)"), assignment(5788, "Scenario Question and Answer (AOL)"), assignment(5789, "Unit 2 Summative Assignment: Famous Canadian Athlete Biography (AOL)")]],
  ],
  3: [
    ["Mental Health and Stress", [resource(5790, "Unit 3 Lesson 1 Mental Health and Stress"), assignment(5791, "Exit Ticket (AAL)"), assignment(5792, "Question and Answers (AFL)"), assignment(5793, "Mental Health and Emotions Brochure (AOL)")]],
    ["Defence Mechanisms and Positive Strategies", [resource(5794, "Unit 3 Lesson 2 Defence Mechanisms and Positive Strategies"), assignment(5795, "Exit Ticket (AAL)"), assignment(5796, "Question and Answers (AFL)"), assignment(5797, "VLog (AOL)")]],
    ["Types of Mental Illnesses", [resource(5798, "Unit 3 Lesson 3 Types of Mental Illnesses"), assignment(5799, "Exit Ticket (AAL)"), assignment(5800, "Question and Answers (AFL)"), assignment(5801, "Mental Illness Poster (AOL)")]],
    ["Seeking Help", [resource(5802, "Unit 3 Lesson 4 Seeking Help"), assignment(5803, "Exit Ticket (AAL)"), assignment(5804, "Question and Answers (AFL)"), assignment(5805, "Seeking Help Discussion Questions and Brochure (AOL)")]],
    ["Managing Stress for Life", [resource(5806, "Unit 3 Lesson 5 What is Stress? Managing Stress for life"), assignment(5807, "Exit Ticket (AAL)"), assignment(5808, "Question and Answers (AFL)"), assignment(5809, "Spa Brochure (AOL)")]],
  ],
  4: [
    ["Accidents and Risks", [resource(5810, "Unit 4 Lesson 1 Accidents and Risks"), assignment(5811, "Exit Ticket (AAL)"), assignment(5812, "Question and Answers (AFL)"), assignment(5813, "Accidents and Risk Game (AOL)")]],
    ["Drug Use and Risks", [resource(5814, "Unit 4 Lesson 2 Drug use and Risks Part 1 and 2"), assignment(5815, "KWL (AAL)"), assignment(5816, "Question and Answers (AFL)"), assignment(5817, "Famous Person Investigation Biography (AOL)"), assignment(5818, "ISP - Summative Assignment: Original Team Sport (AOL)"), assignment(5819, "Final Exam")]],
  ],
};

const courseExtras = [
  url(5748, "Recorded Class: Unit 1 & 2"),
  url(5749, "Recorded Class: Unit 1 & 2 Intro to Health and Health Growth"),
  url(5750, "Recorded Class: Unit 3"),
  url(5751, "Recorded Class: Unit 3 Mental Health"),
  url(5752, "Recorded Class: Unit 4"),
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
    ispring: 0,
    docx: 0,
    pdf: 0,
    video: 0,
    h5p: 0,
  };
}

function writeRescanCsv(courses) {
  const header = "priority,course,moodleCourseId,coursePage,category,reason,expectedEvidence,status,notes";
  const rows = courses.map((item) =>
    [
      item.priority,
      item.course,
      item.moodleCourseId,
      item.coursePage,
      item.category,
      item.reason,
      (item.expectedEvidence || []).join("; "),
      item.status,
      item.notes,
    ]
      .map((value) => String(value ?? "").replaceAll('"', '""'))
      .map((value) => (/[",\n]/.test(value) ? `"${value}"` : value))
      .join(","),
  );
  writeFileSync(rescanCsvPath, `${header}\n${rows.join("\n")}\n`, "utf8");
}

const manifest = readJson(manifestPath);
const courseDownloads = manifest.courseDownloads || [];
const labels = new Set(courseDownloads.map((item) => item.label));
for (const item of courseExtras) if (!labels.has(item.label)) courseDownloads.push(item);
manifest.courseDownloads = courseDownloads;
manifest.units = Object.entries(lessonsByUnit).map(([unitNumber, specs]) => {
  const unit = Number(unitNumber);
  const lessons = specs.map(([title, items], index) => {
    const lesson = index + 1;
    return {
      id: `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
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
      resourceCounts: { downloads: items.length, moodleActivities: items.length },
    };
  });
  return { unit, title: unitTitles[unit], coreTexts: [], unitPlan: null, unitResources: {}, summary: unitSummary(lessons), lessons };
});
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  lessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  authenticatedMoodleRescanAt: new Date().toISOString(),
  moodleActivityResourceCount: manifest.courseDownloads.length + manifest.units.reduce((sum, unit) => sum + unit.summary.downloads, 0),
  moodleNumberedLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
};
writeJson(manifestPath, manifest);

const rescan = readJson(rescanJsonPath);
const removed = (rescan.courses || []).filter((item) => item.course === course);
rescan.courses = (rescan.courses || []).filter((item) => item.course !== course);
rescan.generatedAt = new Date().toISOString();
rescan.notes = "PPL3O removed after authenticated browser access confirmed course outline and lesson resources.";
writeJson(rescanJsonPath, rescan);
writeRescanCsv(rescan.courses || []);

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates
  .replace(
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, ICS2O, and MTH1W have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, ICS2O, MTH1W, and PPL3O have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
  )
  .replace(
    "| 75 | PPL3O | 58 | Grade 11 health/PE; login-required during deep scan. | Course Outline, Moodle Books, assignment attachments. |\n",
    "",
  )
  .replace(
    "1. After Moodle login in the Codex in-app browser, re-scan `PPL3O`, `PPL1O`, and `CGC1D`.",
    "1. After Moodle login in the Codex in-app browser, re-scan `PPL1O` and `CGC1D`.",
  );
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`${course}: wrote ${manifest.sourceAudit.lessonCount} lesson records with ${manifest.sourceAudit.moodleActivityResourceCount} Moodle resources`);
console.log(`Authenticated rescan queue: removed ${removed.length} ${course} row; ${rescan.courses.length} row(s) remain`);
