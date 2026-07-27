import { readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "CGC1D";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");
const rescanJsonPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const rescanCsvPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.csv");
const nextCandidatesPath = join(projectRoot, "deployment", "moodle-next-course-candidates.md");

const unitTitles = {
  1: "Unit 1: Canadian Connections and Methods of Geographical Inquiry",
  2: "Unit 2: Canada's Ecozones and Cultural Connections",
  3: "Unit 3: Canada's Economic Connections",
  4: "Unit 4: Canada's Global and Future Connections",
  5: "Final Summative Project",
};

const moodle = (mod, id, label, role = null) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role: role || mod,
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle crawl",
});
const url = (id, label) => moodle("url", id, label, "source_link");
const assignment = (id, label) => moodle("assign", id, label, "assignment");
const feedback = (id, label) => moodle("feedback", id, label, "checklist");
const folder = (id, label) => moodle("folder", id, label, "folder");
const resource = (id, label, role = "course_document") => moodle("resource", id, label, role);
const forum = (id, label) => moodle("forum", id, label, "forum");
const file = (label, fileUrl, role = "lesson_file") => ({
  label,
  type: extname(label).replace(".", "").toLowerCase() || "file",
  category: "moodle_file",
  role,
  url: fileUrl,
  source: "authenticated Moodle folder file",
});

const courseDownloads = [
  forum(4388, "Announcements"),
  url(4389, "Achievement Chart"),
  url(4390, "Learning Skills and Work Habits"),
  url(4391, "Online Attendance Policy"),
  resource(4392, "Learning Log", "learning_log"),
  resource(4393, "Course Outline", "course_outline"),
];

const lessonsByUnit = {
  1: [
    [
      "Week 1: Inquiry Methods and Mapping Foundations",
      [
        url(4396, "About Canada - Unit 1"),
        url(4397, "Ecozones and Maps - Unit 1"),
        url(4398, "GIS - Unit 1"),
        url(4399, "Latitude and Longitude - Unit 1"),
        url(4400, "Pangea"),
        url(4401, "GIS at Work"),
        url(4402, "Weathering and Erosion"),
        url(4403, "Scales"),
        assignment(4404, "Map of Canada - AFL (1 hour)"),
        assignment(4405, "Earth Development Questions - AFL (45 mins)"),
        assignment(4406, "Geography Tools Questions - AFL (30 mins)"),
        assignment(4407, "Graphing Questions - AAL"),
        assignment(4408, "Scales - AAL (30 mins)"),
        assignment(4409, "Geographical Places Culminating - AFL (1 hour)"),
        assignment(4410, "World Map Assignment - AOL (2 hrs)"),
        assignment(4411, "Canadian Heritage Assignment - AOL (1 period)"),
        assignment(4412, "Unit 1 Test - AOL"),
        assignment(4413, "Learning Log Submission - Unit 1"),
        feedback(4414, "Conversation Checklist - Unit 1"),
        feedback(4415, "Observation Checklist - Unit 1"),
        assignment(4416, "Observation and Conversation Checklists - AFL"),
        folder(4417, "Observation/Conversation Checklist Unit 1 Huiling"),
        file(
          "Conversation-Checklist-Unit-1-Huiling.docx",
          "https://www.esunnybrook.com/pluginfile.php/4486/mod_folder/content/0/Conversation-Checklist-Unit-1-Huiling.docx?forcedownload=1",
          "teacher_checklist",
        ),
        file(
          "Observation-Checklist-Unit1-Huiling.docx",
          "https://www.esunnybrook.com/pluginfile.php/4486/mod_folder/content/0/Observation-Checklist-Unit1-Huiling.docx?forcedownload=1",
          "teacher_checklist",
        ),
      ],
    ],
  ],
  2: [
    [
      "Week 2: Ecozones, Landforms, Climate, and Biosphere",
      [
        folder(4419, "Lessons"),
        file(
          "2efe45944783b347ca012f3b13c4acbf.jpg",
          "https://www.esunnybrook.com/pluginfile.php/4488/mod_folder/content/0/2efe45944783b347ca012f3b13c4acbf.jpg?forcedownload=1",
        ),
        file(
          "3-Types-of-Plate-Boundaries.pdf",
          "https://www.esunnybrook.com/pluginfile.php/4488/mod_folder/content/0/3-Types-of-Plate-Boundaries.pdf?forcedownload=1",
        ),
        file(
          "Candas-soil-and-vegetation-Unit2.pdf",
          "https://www.esunnybrook.com/pluginfile.php/4488/mod_folder/content/0/Candas-soil-and-vegetation-Unit2.pdf?forcedownload=1",
        ),
        file(
          "Creation-of-Canadia-Landform-Regions-Unit2.pdf",
          "https://www.esunnybrook.com/pluginfile.php/4488/mod_folder/content/0/Creation-of-Canadia-Landform-Regions-Unit2.pdf?forcedownload=1",
        ),
        file(
          "ecozones.pdf",
          "https://www.esunnybrook.com/pluginfile.php/4488/mod_folder/content/0/ecozones.pdf?forcedownload=1",
        ),
        url(4420, "Geological Time"),
        assignment(4421, "Climate Activity - AFL (30-45 mins)"),
        assignment(4422, "Landform Regions - AFL (1.5 hrs)"),
        assignment(4423, "Soil Regions - AAL (30 mins)"),
        assignment(4424, "Biosphere - AFL (30 mins)"),
        assignment(4425, "Climate Assessment - AAL"),
        assignment(4426, "The Great Canadian Escape Assignment - AOL (2 periods)"),
      ],
    ],
    [
      "Week 3: Cultural Connections and Population",
      [
        url(4430, "Cultural Connections"),
        url(4431, "Rural Settlements - Unit 2"),
        url(4432, "Study of Population - Unit 2"),
        assignment(4433, "Population Pyramids - AFL (30 mins)"),
        assignment(4434, "Immigration Points in Canada - AFL (45 mins)"),
        assignment(4435, "Ecozones Assignment - AOL (2 periods)"),
        assignment(4437, "Aboriginal Peoples of Canada - AFL (1 hr)"),
        assignment(4438, "Unit Assessment - AAL"),
        assignment(4439, "Unit 2 Test - AOL"),
        assignment(4440, "Learning Log - Unit 2"),
        assignment(4441, "Observation and Conversation Checklists - AFL"),
        feedback(4442, "Observation Checklist - Unit 2"),
        feedback(4443, "Conversation Checklist - Unit 2"),
        folder(4444, "Observation/Conversation Checklist Unit 2 Huiling"),
        file(
          "Conversation-Checklist-Unit-2-Huiling.docx",
          "https://www.esunnybrook.com/pluginfile.php/4513/mod_folder/content/0/Conversation-Checklist-Unit-2-Huiling.docx?forcedownload=1",
          "teacher_checklist",
        ),
        file(
          "Observation-Checklist-Unit-2-Huiling.docx",
          "https://www.esunnybrook.com/pluginfile.php/4513/mod_folder/content/0/Observation-Checklist-Unit-2-Huiling.docx?forcedownload=1",
          "teacher_checklist",
        ),
      ],
    ],
  ],
  3: [
    [
      "Week 4: Industries, Urbanization, and Location Factors",
      [
        folder(4446, "Lessons"),
        url(4447, "Location Factors"),
        url(4448, "Canadian Industries"),
        url(4449, "Urbanization"),
        url(4450, "Energy"),
        url(4451, "Types of Industries"),
        url(4452, "Urban Land Use"),
        url(4454, "Urban Issues"),
        assignment(4455, "Forestry - AFL (30-45 mins)"),
        assignment(4456, "Fishing Industry - AFL (30 mins)"),
        assignment(4457, "Cultural Diversity in Canada - AFL (20 mins)"),
        assignment(4458, "Unit 3 Summative - AOL (2 periods)"),
      ],
    ],
    [
      "Week 5: Energy, Land Use, and Business Location",
      [
        assignment(4460, "Alternative Energy - AFL (1.5 hrs)"),
        assignment(4461, "Land Use Activity (45 mins)"),
        assignment(4462, "Urban Issues Activity - AFL (30-40 mins)"),
        assignment(4463, "Locating a Business Assignment - AOL (2 periods)"),
        assignment(4464, "Locating a Business Self-Assessment - AAL"),
        assignment(4465, "Unit 3 Test - AOL"),
        assignment(4466, "Learning Log - Unit 3"),
        assignment(4467, "Observation and Conversation Checklists - AFL"),
        feedback(4468, "Observation Checklist - Unit 3"),
        feedback(4469, "Conversation Checklist - Unit 3"),
        folder(4470, "Observation/Conversation Checklist Unit 3 Huiling"),
        file(
          "Conversation-Checklist-Unit-3-Huiling.docx",
          "https://www.esunnybrook.com/pluginfile.php/4539/mod_folder/content/0/Conversation-Checklist-Unit-3-Huiling.docx?forcedownload=1",
          "teacher_checklist",
        ),
        file(
          "Observation-Checklist-Unit3-Huiling.docx",
          "https://www.esunnybrook.com/pluginfile.php/4539/mod_folder/content/0/Observation-Checklist-Unit3-Huiling.docx?forcedownload=1",
          "teacher_checklist",
        ),
      ],
    ],
  ],
  4: [
    [
      "Week 6: Canada and the World Community",
      [
        folder(4472, "Lessons"),
        url(4473, "Canada and the World Community"),
        url(4474, "Canada's International Relationships"),
        assignment(4475, "Canadian Trade - AFL (30 mins)"),
        assignment(4476, "Beyond Borders Assignment - AOL (1 period)"),
        assignment(4477, "Beyond Borders Self Assessment - AAL"),
      ],
    ],
    [
      "Week 7: Trade, Culture, and Development",
      [
        folder(4479, "Lessons"),
        url(4480, "Canadian Trade"),
        url(4481, "Canada's Cultural Connections to US"),
        assignment(4482, "Canadian Culture and Identity - AFL (40 mins)"),
        assignment(4483, "Developed Vs. Developing Countries - AOL (1.5 periods)"),
        assignment(4484, "Unit 4 Test - AOL"),
        assignment(4485, "Learning Log - Unit 4"),
        assignment(4486, "Observation and Conversation Checklists - AFL"),
        feedback(4487, "Conversation Checklist - Unit 4"),
        feedback(4488, "Observation Checklist - Unit 4"),
        folder(4489, "Observation/Conversation Checklist Unit 4 Huiling"),
        file(
          "Conversation-Checklist-Unit4-Huiling.docx",
          "https://www.esunnybrook.com/pluginfile.php/4558/mod_folder/content/0/Conversation-Checklist-Unit4-Huiling.docx?forcedownload=1",
          "teacher_checklist",
        ),
        file(
          "Observation-Checklist-Unit4-Huiling.docx",
          "https://www.esunnybrook.com/pluginfile.php/4558/mod_folder/content/0/Observation-Checklist-Unit4-Huiling.docx?forcedownload=1",
          "teacher_checklist",
        ),
      ],
    ],
  ],
  5: [
    [
      "Week 8: Final Summative and Exam",
      [
        assignment(4491, "Summative"),
        url(4492, "Infographic Template"),
        assignment(4493, "Final Exam"),
        assignment(4494, "Final Exam Submission"),
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
function unitSummary(lessons) {
  return {
    downloads: lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0),
    ispring: 0,
    docx: lessons.reduce((sum, lesson) => sum + lesson.downloads.filter((item) => item.type === "docx").length, 0),
    pdf: lessons.reduce((sum, lesson) => sum + lesson.downloads.filter((item) => item.type === "pdf").length, 0),
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
  authenticatedMoodleRescanAt: new Date().toISOString(),
  moodleActivityResourceCount: manifest.courseDownloads.length + manifest.units.reduce((sum, unit) => sum + unit.summary.downloads, 0),
  moodleTopicLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  localImportStatus: "source-links-indexed; pending local Moodle file import",
};
writeJson(manifestPath, manifest);

const rescan = readJson(rescanJsonPath);
const removed = (rescan.courses || []).filter((item) => item.course === course);
rescan.courses = (rescan.courses || []).filter((item) => item.course !== course);
rescan.generatedAt = new Date().toISOString();
rescan.notes = "CGC1D removed after authenticated browser access confirmed course outline, Unit activities, assignments, folders, and attachment links.";
writeJson(rescanJsonPath, rescan);
writeRescanCsv(rescan.courses || []);

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates
  .replace(
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, ICS2O, MTH1W, PPL3O, and PPL1O have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D, OLC4O, ICS4U, ICS2O, MTH1W, PPL3O, PPL1O, and CGC1D have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
  )
  .replace("| 65 | CGC1D | 43 | Grade 9 geography; login-required during deep scan. | Course Outline, Moodle Books, assignment attachments. |\n", "")
  .replace(
    "| CGC1D | 43 | Canadian and World Studies | Login required during 2026-07-23 deep scan. |",
    "| CGC1D | 43 | Canadian and World Studies | Authenticated scan completed; Course Outline, Unit activities, assignments, folders, and attachment links indexed. |",
  );
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`${course}: wrote ${manifest.sourceAudit.lessonCount} lesson/week records with ${manifest.sourceAudit.moodleActivityResourceCount} Moodle resources`);
console.log(`Authenticated rescan queue: removed ${removed.length} ${course} row; ${rescan.courses.length} row(s) remain`);
