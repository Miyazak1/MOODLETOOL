import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "OLC4O", "course-manifest.json");
const rescanJsonPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const rescanCsvPath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.csv");
const nextCandidatesPath = join(projectRoot, "deployment", "moodle-next-course-candidates.md");

const textLink = (id, label) => ({
  label,
  type: "html",
  category: "moodle_resource",
  role: "source_text",
  url: `https://www.esunnybrook.com/mod/resource/view.php?id=${id}`,
  source: "authenticated Moodle crawl",
});

const texts = [
  {
    id: "lather-and-nothing-else",
    title: "Lather and Nothing Else",
    author: "Hernando Tellez",
    type: "short_story",
    units: [1],
    lessons: ["U01L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 1 Lesson 3 resource title.",
    materials: [],
    externalLinks: [textLink(511, 'Lesson 3 - "Lather and Nothing Else" by Hernando Tellez')],
  },
  {
    id: "all-i-really-need-kindergarten",
    title: "All I Really Need To Know I Learned in Kindergarten",
    author: "Robert Fulghum",
    type: "essay",
    units: [1],
    lessons: ["U01L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 1 Lesson 8 resource title.",
    materials: [],
    externalLinks: [textLink(520, 'Lesson 8 - "All I Really Need To Know I Learned in Kindergarten" by Robert Fulghum')],
  },
  {
    id: "night-of-the-mustang",
    title: "Night of the Mustang",
    author: "Unknown",
    type: "nonfiction",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 2 Lesson 4 resource title.",
    materials: [],
    externalLinks: [textLink(534, 'Lesson 4 - Analyzing Non-Fiction: "Night of the Mustang"')],
  },
  {
    id: "barney",
    title: "Barney",
    author: "Will Stanton",
    type: "short_story",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 2 Lesson 5 resource title.",
    materials: [],
    externalLinks: [textLink(536, 'Lesson 5 - Short Story: "Barney" by Will Stanton')],
  },
  {
    id: "urban-legends-how-they-start",
    title: "Urban Legends - How They Start and Why They Persist",
    author: "Heather Whipps",
    type: "article",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 2 Lesson 6 resource title.",
    materials: [],
    externalLinks: [textLink(538, 'Lesson 6 - "Urban Legends -How They Start and Why They Persist" by Heather Whipps')],
  },
  {
    id: "do-we-really-see-4000-ads",
    title: "Do we really see 4000 ads a day?",
    author: "Bryce Sanders",
    type: "article",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 2 Lesson 7 resource title.",
    materials: [],
    externalLinks: [textLink(540, 'Lesson 7 - "Do we really see 4000 ads a day?" by Bryce Sanders')],
  },
  {
    id: "buddy-can-you-spare-a-home",
    title: "Buddy can you spare a home?",
    author: "Unknown",
    type: "article",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 2 Lesson 9 resource title.",
    materials: [],
    externalLinks: [textLink(547, 'Lesson 9 - Article: "Buddy can you spare a home?"')],
  },
  {
    id: "i-have-a-dream",
    title: "I Have a Dream",
    author: "Martin Luther King Jr.",
    type: "speech",
    units: [3],
    lessons: ["U03L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 3 Lesson 1 resource title.",
    materials: [],
    externalLinks: [textLink(554, 'Speech: "I Have a Dream" - by Martin Luther King Jr.')],
  },
  {
    id: "the-road-not-taken",
    title: "The Road Not Taken",
    author: "Robert Frost",
    type: "poem",
    units: [3],
    lessons: ["U03L01"],
    copyrightStatus: "Public domain",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 3 Lesson 6 resource title.",
    materials: [],
    externalLinks: [textLink(567, 'Lesson 6 - Poem: "The Road Not Taken" by Robert Frost')],
  },
  {
    id: "global-warming-charles-f-keller",
    title: "Global Warming",
    author: "Charles F. Keller",
    type: "article",
    units: [3],
    lessons: ["U03L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from OLC4O Unit 3 Lesson 9 resource title.",
    materials: [],
    externalLinks: [textLink(576, 'Lesson 9 - Article: "Global Warming" by Charles F. Keller')],
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
const byId = new Map((manifest.texts || []).map((item) => [item.id, item]));
for (const text of texts) byId.set(text.id, text);
manifest.texts = Array.from(byId.values());
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  authenticatedMoodleRescanAt: new Date().toISOString(),
  moodleTextResourceCount: texts.length,
  moodleActivityResourceCount: 96,
};
writeJson(manifestPath, manifest);

const rescan = readJson(rescanJsonPath);
const removed = (rescan.courses || []).filter((course) => course.course === "OLC4O");
rescan.courses = (rescan.courses || []).filter((course) => course.course !== "OLC4O");
rescan.generatedAt = new Date().toISOString();
rescan.notes = "ENG2D and OLC4O were removed after authenticated browser access confirmed their course outlines and Moodle resources.";
writeJson(rescanJsonPath, rescan);
writeRescanCsv(rescan.courses || []);

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates
  .replace(
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D has been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D and OLC4O have been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
  )
  .replace(
    "| 95 | OLC4O | 9 | Literacy course; login-required during deep scan. | Course Outline, Moodle Books, assignment attachments. |\n",
    "",
  )
  .replace(
    "1. After Moodle login in the Codex in-app browser, re-scan `OLC4O`, `ICS4U`, `ICS2O`, `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
    "1. After Moodle login in the Codex in-app browser, re-scan `ICS4U`, `ICS2O`, `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
  );
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`OLC4O: added/updated ${texts.length} text records`);
console.log(`Authenticated rescan queue: removed ${removed.length} OLC4O row; ${rescan.courses.length} row(s) remain`);
