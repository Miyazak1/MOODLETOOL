import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "PPL1O";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");
const rescanJsonPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const rescanCsvPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.csv");
const nextCandidatesPath = join(projectRoot, "deployment", "moodle-next-course-candidates.md");

const unitTitles = {
  1: "Unit 1: Active Living",
  2: "Unit 2: Safety, Substance Abuse and Bullying",
  3: "Unit 3: Healthy Living and Sexual Health",
  4: "Unit 4: Movement Competence",
};

const activity = (mod, id, label, role = null) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role: role || (mod === "resource" ? "lesson_resource" : mod),
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle crawl",
});
const assignment = (id, label) => activity("assign", id, label, "assignment");
const folder = (id, label) => activity("folder", id, label, "folder");

const lessonsByUnit = {
  1: [
    ["Health and Nutrition", [assignment(5706, "Unit 1 - Learning Log - AAL"), assignment(5707, "My Health Is My Wealth (AAL)"), assignment(5708, "Canada Food Guide (AAL)"), assignment(5709, "What is on my plate? (AFL)")]],
    ["Physical Activity", [assignment(5710, "Physical Activities (AFL)"), assignment(5711, "Healthy Eating Journal (AOL)"), assignment(5712, "My Daily Activity Journal (AOL)")]],
    ["Unit 1 Culminating", [assignment(5713, "Culminating Assignment (AOL)"), folder(5714, "Unit 1 Teacher Resources Answer Keys"), assignment(5715, "Unit 1 Teacher Observation/Conversation (Teacher Only)")]],
  ],
  2: [
    ["Abuse and Trauma", [assignment(5716, "Unit 2 - Learning Log - AAL"), assignment(5717, "What is Abuse? (AAL)"), assignment(5718, "What is Trauma? (AAL)")]],
    ["Bullying and Cyberbullying", [assignment(5719, "Types of Bullying (AAL)"), assignment(5720, "Cyberbullying (AFL)"), assignment(5721, "Laws against Cyber Bullying (AFL)")]],
    ["Cyberbullying Culminating", [assignment(5722, "Controlling Cyber bullying (AOL)"), assignment(5723, "Cyber Bullying Discussion (AOL)"), assignment(5724, "Culminating Storyboard Assignment (AOL)"), assignment(5725, "Unit 2 Teacher Observation/Conversation (Teacher Only)")]],
  ],
  3: [
    ["Sexual Health", [assignment(5726, "Unit 3 - Learning Log - AAL"), assignment(5727, "The Reproductive System and STDs and STI's (AAL)"), assignment(5728, "Sexuality Types (AFL)")]],
    ["Mental Health", [assignment(5729, "What is mental health? (AAL)"), assignment(5730, "Cause and effects and coping skills for people with Mental Health (AFL)")]],
    ["Unit 3 Culminating", [assignment(5731, "Assignment 1: Board game (AOL)"), assignment(5732, "Assignment 2: Children Story Book (AOL)"), assignment(5733, "Culminating Assignment (AOL)"), assignment(5734, "Unit 3 Teacher Observation/Conversation (Teacher Only)")]],
  ],
  4: [
    ["Fundamental Movement", [assignment(5735, "Unit 4 - Learning Log - AAL"), assignment(5736, "Fundamental Movement Pattern (AAL)"), assignment(5737, "Movement Observations (AAL)")]],
    ["Movement Development and Safety", [assignment(5738, "Physical Development/Milestones Checklist (AFL)"), assignment(5739, "Warm-up and Cool-down before and after Movement (AFL)")]],
    ["Movement Culminating", [assignment(5740, "Movement Journal (AOL)"), assignment(5741, "Diseases or Illnesses which restrict movement (AOL)"), assignment(5742, "Unit 4 Teacher Observation/Conversation (Teacher Only)"), assignment(5743, "ISP - My Personal Health and Wellness Plan"), assignment(5744, "Final Exam"), assignment(5745, "Final Exam Submission")]],
  ],
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
function unitSummary(lessons) {
  return { downloads: lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0), ispring: 0, docx: 0, pdf: 0, video: 0, h5p: 0 };
}
function writeRescanCsv(courses) {
  const header = "priority,course,moodleCourseId,coursePage,category,reason,expectedEvidence,status,notes";
  const rows = courses.map((item) =>
    [item.priority, item.course, item.moodleCourseId, item.coursePage, item.category, item.reason, (item.expectedEvidence || []).join("; "), item.status, item.notes]
      .map((value) => String(value ?? "").replaceAll('"', '""'))
      .map((value) => (/[",\n]/.test(value) ? `"${value}"` : value))
      .join(","),
  );
  writeFileSync(rescanCsvPath, `${header}\n${rows.join("\n")}\n`, "utf8");
}

const manifest = readJson(manifestPath);
const courseDownloads = manifest.courseDownloads || [];
if (!courseDownloads.some((item) => item.label === "PPL10 Unit Plans")) {
  courseDownloads.push(folder(5705, "PPL10 Unit Plans"));
}
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
  moodleTopicLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
};
writeJson(manifestPath, manifest);

const rescan = readJson(rescanJsonPath);
const removed = (rescan.courses || []).filter((item) => item.course === course);
rescan.courses = (rescan.courses || []).filter((item) => item.course !== course);
rescan.generatedAt = new Date().toISOString();
rescan.notes = "PPL1O removed after authenticated browser access confirmed course outline and Moodle assignment resources.";
writeJson(rescanJsonPath, rescan);
writeRescanCsv(rescan.courses || []);

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates
  .replace(
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, ICS2O, MTH1W, and PPL3O have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, ICS2O, MTH1W, PPL3O, and PPL1O have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
  )
  .replace("| 70 | PPL1O | 57 | Grade 9 health/PE; login-required during deep scan. | Course Outline, Moodle Books, assignment attachments. |\n", "")
  .replace("1. After Moodle login in the Codex in-app browser, re-scan `PPL1O` and `CGC1D`.", "1. After Moodle login in the Codex in-app browser, re-scan `CGC1D`.");
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`${course}: wrote ${manifest.sourceAudit.lessonCount} topic lesson records with ${manifest.sourceAudit.moodleActivityResourceCount} Moodle resources`);
console.log(`Authenticated rescan queue: removed ${removed.length} ${course} row; ${rescan.courses.length} row(s) remain`);
