import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BTT1O";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");
const nextCandidatesPath = join(projectRoot, "deployment", "moodle-next-course-candidates.md");

const unitTitles = {
  1: "Unit 1: Building a Webpage",
  2: "Unit 2: Using Microsoft Word in Communication",
  3: "Unit 3: Using Microsoft Excel in Business",
  4: "Unit 4: Making Creative Presentations Using Microsoft PowerPoint",
  5: "Culminating Final Assessment",
};

const moodle = (mod, id, label, role = null) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role: role || mod,
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle crawl",
});
const forum = (id, label) => moodle("forum", id, label, "forum");
const assignment = (id, label) => moodle("assign", id, label, "assignment");
const resource = (id, label) => moodle("resource", id, label, "lesson_resource");

const courseDownloads = [forum(3336, "Announcements")];

const lessonsByUnit = {
  1: [
    [
      "Building Webpages with HTML/CSS",
      [
        assignment(3337, "Introduction to HTML/CSS Making Webpages (AAL)"),
        assignment(3338, "Using HTML and CSS with Notepad (AAL)"),
        assignment(3339, "Create a Short Webpage using Notepad (AOL)"),
        assignment(3340, "Creating a Website (AAL)"),
        assignment(3341, "11 Steps to Create a Successful Website (AFL)"),
        assignment(3342, "Webpage Assignment (AOL)"),
        assignment(3343, "Godaddy.com Website Assignment (AOL)"),
      ],
    ],
  ],
  2: [
    [
      "Microsoft Word Communication Projects",
      [
        assignment(3344, "Creating a Timeline in Microsoft Word (AAL)"),
        assignment(3345, "Historical Timeline (AFL)"),
        assignment(3346, "Timeline Assessment (AOL)"),
        assignment(3347, "Drawing a Comic Strip using Microsoft Word (AAL)"),
        assignment(3348, "Fairytale Comic Strip (AFL)"),
        assignment(3349, "All About Me Comic Strip (AOL)"),
        assignment(3350, "Create a Flyer using Microsoft Word (AAL)"),
        assignment(3351, "Digital Citizenship Flyer (AFL)"),
        assignment(3352, "Business Flyer (AOL)"),
      ],
    ],
  ],
  3: [
    [
      "Microsoft Excel in Business",
      [
        resource(3353, "Introduction to Excel"),
        assignment(3354, "Excel Functions"),
        assignment(3355, "Excel Logical Functions"),
        assignment(3356, "Practice Worksheets in Excel (AAL)"),
        assignment(3357, "Excel Assignment (AFL)"),
        assignment(3358, "Excel Quiz (AFL)"),
        assignment(3359, "Employee Discount Assignment (AFL)"),
        assignment(3360, "Personal Budget (AOL)"),
        assignment(3361, "Student Average (AOL)"),
        assignment(3362, "Blue Jay Souvenir Shop Assignment (AOL)"),
        assignment(3363, "Answer Keys"),
      ],
    ],
  ],
  4: [
    [
      "Creative PowerPoint Presentations",
      [
        assignment(3364, "Creating a PowerPoint Presentation (AAL)"),
        assignment(3365, "PowerPoint Biography (AFL)"),
        assignment(3366, "Canadian Elections (AFL)"),
        assignment(3367, "Discussion (AOL)"),
        assignment(3368, "Canada's Role in the United Nations (AOL)"),
        assignment(3369, "Aboriginal People of Canada (AOL)"),
      ],
    ],
  ],
  5: [["Culminating Final", [assignment(3370, "Culminating Final (30%)")]]],
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
    ispring: 0,
    docx: 0,
    pdf: 0,
    video: 0,
    h5p: 0,
  };
}

const manifest = readJson(manifestPath);
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
      path: `lessons/${id}`,
      bookPageCount: 0,
      lessonText: [],
      textExports: [],
      lessonPlan: null,
      ispring: [],
      downloads: items,
      resourceCounts: { downloads: items.length, moodleActivities: items.length },
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
  outlineUrl: "",
  outlineStatus: "needs-url",
  authenticatedMoodleRescanAt: new Date().toISOString(),
  moodleActivityResourceCount: manifest.courseDownloads.length + manifest.units.reduce((sum, unit) => sum + unit.summary.downloads, 0),
  moodleTopicLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  localImportStatus: "source-links-indexed; course outline still missing; pending local Moodle file import",
};
writeJson(manifestPath, manifest);

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates.replace(
  "| BTT1O | Moodle page 31 visible, but no standard Course Outline; only unit assignment links were found. | Re-scan after login and rely on local planning files if no outline exists. |",
  "| BTT1O | Authenticated scan completed; no Course Outline found; Unit activities and assignments indexed. | Keep outline pending unless a separate file/source is provided. |",
);
nextCandidates = nextCandidates.replace(
  "| BTT1O | 31 | Business Studies | Visible shell, no standard outline/book found. |",
  "| BTT1O | 31 | Business Studies | Authenticated scan completed; no standard outline found, but Unit activities and assignments are indexed. |",
);
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`${course}: wrote ${manifest.sourceAudit.lessonCount} lesson records with ${manifest.sourceAudit.moodleActivityResourceCount} Moodle resources`);
