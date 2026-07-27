import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "ENG2D", "course-manifest.json");
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
    id: "lady-or-the-tiger",
    title: "The Lady or the Tiger?",
    author: "Frank R. Stockton",
    type: "short_story",
    units: [1],
    lessons: ["U01L01"],
    copyrightStatus: "Public domain",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D Unit 1 resource title.",
    materials: [],
    externalLinks: [textLink(387, 'Short Story: "The Lady or the Tiger?" by Frank R. Stockton')],
  },
  {
    id: "the-interlopers",
    title: "The Interlopers",
    author: "Saki",
    type: "short_story",
    units: [1],
    lessons: ["U01L01"],
    copyrightStatus: "Public domain",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D Unit 1 resource title.",
    materials: [],
    externalLinks: [textLink(390, 'Short Story + Activity: "The Interlopers" by Saki')],
  },
  {
    id: "the-rocking-horse-winner",
    title: "The Rocking Horse Winner",
    author: "D.H. Lawrence",
    type: "short_story",
    units: [1],
    lessons: ["U01L01"],
    copyrightStatus: "Public domain",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D Unit 1 resource title.",
    materials: [],
    externalLinks: [textLink(392, 'Short Story + Activity: "The Rocking Horse Winner" by D.H. Lawrence')],
  },
  {
    id: "myth-of-prometheus",
    title: "The Myth of Prometheus",
    author: "Classical myth",
    type: "myth",
    units: [1],
    lessons: ["U01L01"],
    copyrightStatus: "Public domain source tradition",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D Unit 1 mythology resources.",
    materials: [],
    externalLinks: [textLink(395, 'Myth: "The Myth of Prometheus"')],
  },
  {
    id: "daedalus-and-icarus",
    title: "The Story of Daedalus and Icarus",
    author: "Classical myth",
    type: "myth",
    units: [1],
    lessons: ["U01L01"],
    copyrightStatus: "Public domain source tradition",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D Unit 1 mythology resources.",
    materials: [],
    externalLinks: [textLink(398, 'Myth: "The Story of Daedalus and Icarus"')],
  },
  {
    id: "landscape-with-the-fall-of-icarus",
    title: "Landscape With The Fall of Icarus",
    author: "William Carlos Williams",
    type: "poem",
    units: [1],
    lessons: ["U01L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D Unit 1 poetry resources.",
    materials: [],
    externalLinks: [textLink(402, 'Poem: "Landscape With The Fall of Icarus" by William Carlos Williams')],
  },
  {
    id: "queen-elizabeth-address-to-the-troops",
    title: "Address to the Troops at Tilbury",
    author: "Queen Elizabeth I",
    type: "speech",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Public domain",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D persuasive/speech resource sequence.",
    materials: [],
    externalLinks: [textLink(410, "Speech: Queen Elizabeth I Address to the Troops")],
  },
  {
    id: "i-have-a-dream",
    title: "I Have a Dream",
    author: "Martin Luther King Jr.",
    type: "speech",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D persuasive/speech resource sequence.",
    materials: [],
    externalLinks: [textLink(413, 'Speech: "I Have a Dream" by Martin Luther King Jr.')],
  },
  {
    id: "jfk-inaugural-address",
    title: "Inaugural Address",
    author: "John F. Kennedy",
    type: "speech",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Public domain",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D persuasive/speech resource sequence.",
    materials: [],
    externalLinks: [textLink(414, "Speech: Inaugural Address by President John F. Kennedy")],
  },
  {
    id: "pearl-harbor-address",
    title: "Pearl Harbor Address to the Nation",
    author: "Franklin D. Roosevelt",
    type: "speech",
    units: [2],
    lessons: ["U02L01"],
    copyrightStatus: "Public domain",
    sourceStatus: "Moodle resource link",
    notes: "Detected from ENG2D persuasive/speech resource sequence.",
    materials: [],
    externalLinks: [textLink(415, "Speech: Pearl Harbor Address to the Nation by Franklin D. Roosevelt")],
  },
  {
    id: "lord-of-the-flies",
    title: "Lord of the Flies",
    author: "William Golding",
    type: "novel",
    units: [3],
    lessons: ["U03L01"],
    copyrightStatus: "Needs review",
    sourceStatus: "Moodle resource link",
    notes: "Core novel for ENG2D Unit 3.",
    materials: [],
    externalLinks: [textLink(432, 'Novel: "Lord of the Flies" by William Golding')],
  },
  {
    id: "othello",
    title: "Othello",
    author: "William Shakespeare",
    type: "play",
    units: [4],
    lessons: ["U04L01"],
    copyrightStatus: "Public domain",
    sourceStatus: "Moodle resource link",
    notes: "Core drama text for ENG2D Unit 4.",
    materials: [],
    externalLinks: [textLink(466, 'The Play: "Othello" by William Shakespeare')],
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const manifest = readJson(manifestPath);
const byId = new Map((manifest.texts || []).map((item) => [item.id, item]));
byId.delete("lord_of_the_flies");
for (const text of texts) {
  byId.set(text.id, text);
}
manifest.texts = Array.from(byId.values());
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  authenticatedMoodleRescanAt: new Date().toISOString(),
  moodleTextResourceCount: texts.length,
  moodleActivityResourceCount: 118,
};
writeJson(manifestPath, manifest);

const rescan = readJson(rescanJsonPath);
const removed = (rescan.courses || []).filter((course) => course.course === "ENG2D");
rescan.courses = (rescan.courses || []).filter((course) => course.course !== "ENG2D");
rescan.generatedAt = new Date().toISOString();
rescan.notes = "ENG2D was removed after authenticated browser access confirmed the course outline and Moodle resources.";
writeJson(rescanJsonPath, rescan);

const header = "priority,course,moodleCourseId,coursePage,category,reason,expectedEvidence,status,notes";
const rows = (rescan.courses || []).map((course) =>
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

let nextCandidates = readFileSync(nextCandidatesPath, "utf8");
nextCandidates = nextCandidates
  .replace(
    "| 100 | ENG2D | 8 | High-value English course; login-required during deep scan. | Course Outline, Moodle Books, assignment attachments. |\n",
    "",
  )
  .replace(
    "These are the next courses worth opening in the authenticated Moodle browser. They already exist in the portal shell, but need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
    "These are the next courses worth opening in the authenticated Moodle browser. ENG2D has been scanned and removed from this active queue; the remaining courses need richer Moodle evidence, local outline downloads, or lesson-level Book confirmation.",
  )
  .replace(
    "1. After Moodle login in the Codex in-app browser, re-scan `ENG2D`, `OLC4O`, `ICS4U`, `ICS2O`, `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
    "1. After Moodle login in the Codex in-app browser, re-scan `OLC4O`, `ICS4U`, `ICS2O`, `MTH1W`, `PPL3O`, `PPL1O`, and `CGC1D`.",
  );
writeFileSync(nextCandidatesPath, nextCandidates, "utf8");

console.log(`ENG2D: added/updated ${texts.length} text records`);
console.log(`Authenticated rescan queue: removed ${removed.length} ENG2D row; ${rescan.courses.length} row(s) remain`);
