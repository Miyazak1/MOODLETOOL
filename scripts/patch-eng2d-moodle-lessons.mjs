import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG2D";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");

const moodle = (mod, id, label, role = null) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role: role || (mod === "resource" ? "lesson_resource" : mod),
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle course page",
});

const resource = (id, label, role = "lesson_resource") => moodle("resource", id, label, role);
const assignment = (id, label) => moodle("assign", id, label, "assignment");
const forum = (id, label) => moodle("forum", id, label, "discussion");
const folder = (id, label) => moodle("folder", id, label, "folder");

const courseDownloads = [
  forum(374, "Announcements"),
  forum(375, "VIP: Please Read and Respond BEFORE beginning the course!"),
  resource(376, "ENG2D Course Outline", "course_outline"),
  resource(377, "ENG2D Online Course Planning", "course_resource"),
  resource(378, "ENG2D- Learning Goals and Success Criteria", "course_resource"),
  resource(379, "English 9 and 10, Ontario Curriculum", "course_resource"),
  folder(380, "ENG2D Lesson Plans"),
  folder(381, "Essay Writing Resources"),
  resource(382, "Distinguishing Between Assessments As, For, and Of", "course_resource"),
  resource(383, "Triangulation Diagram", "course_resource"),
  resource(384, "Rubric: Unit Discussions", "course_resource"),
];

const units = [
  {
    title: "Unit 1: Short Stories & Poetry",
    lessonTitle: "Short Stories & Poetry Resource Sequence",
    coreTexts: ["lady-or-the-tiger", "the-interlopers", "the-rocking-horse-winner", "myth-of-prometheus", "daedalus-and-icarus", "landscape-with-the-fall-of-icarus"],
    items: [
      resource(385, "Glossary of Literary Terms"),
      resource(386, "What is a Short Story?"),
      resource(387, 'Short Story: "The Lady or the Tiger?" by Frank R. Stockton', "source_text"),
      assignment(388, 'Activity: Reviewing Conflict with "The Lady or the Tiger?" (A for L)'),
      forum(389, "Discussion: Making Difficult Choices (A as/of L)"),
      resource(390, 'Short Story + Activity: "The Interlopers" by Saki', "source_text"),
      assignment(391, 'Activity: Active Reading and Interpreting in "The Interlopers" by Saki (A for L)'),
      resource(392, 'Short Story + Activity: "The Rocking Horse Winner" by D.H. Lawrence', "source_text"),
      assignment(393, 'Activity: Analyzing and Interpreting "The Rocking Horse Winner" (A for/as L)'),
      resource(394, "A Lesson on Greek Mythology"),
      resource(395, 'Myth: "The Myth of Prometheus"', "source_text"),
      assignment(396, 'Activity: Reflecting on "The Myth of Prometheus" (A for L)'),
      assignment(397, "Assignment: Perspective Letter Writing (A as/of L)"),
      resource(398, 'Myth: "The Story of Daedalus and Icarus"', "source_text"),
      assignment(399, 'Activity: Reviewing the Plot Graph with "The Story of Daedalus and Icarus" (A for L)'),
      forum(400, "Discussion: My father was right....ambition and ego (A as/of L)"),
      resource(401, "Elements of Poetry"),
      resource(402, 'Poem: "Landscape With The Fall of Icarus" by William Carlos Williams', "source_text"),
      resource(403, "Landscape with the Fall of Icarus - Painting by Bruegel"),
      resource(404, "Background, Analysis and Themes in Bruegel's Painting"),
      assignment(405, "Activity: Analyzing Art, Poetry and Short Stories (A for L)"),
      assignment(406, "Assignment: Journal Response (A of L)"),
      assignment(407, "Metacognitive Activity: Role Play Assessment (A as L)"),
    ],
  },
  {
    title: "Unit 2: Persuasive Texts & Media",
    lessonTitle: "Persuasive Texts & Media Resource Sequence",
    coreTexts: ["queen-elizabeth-address-to-the-troops", "i-have-a-dream", "jfk-inaugural-address", "pearl-harbor-address"],
    items: [
      resource(408, "The Basic Elements of Public Speaking"),
      resource(409, "Elements of Speech Writing: Argument, Evidence and Significance"),
      resource(410, "Speech: Queen Elizabeth I Address to the Troops", "source_text"),
      assignment(411, "Activity: Assessing our Understanding of Queen Elizabeth's Speech (A for L)"),
      forum(412, "Discussion: Assessing Famous Speakers (A as/of L)"),
      resource(413, 'Speech: "I Have a Dream" by Martin Luther King Jr.', "source_text"),
      resource(414, "Speech: Inaugural Address by President John F. Kennedy", "source_text"),
      resource(415, "Speech: Pearl Harbor Address to the Nation by Franklin D. Roosevelt", "source_text"),
      assignment(416, "Activity: Analyzing Speeches Through Substance, Style, Impact (A for L)"),
      resource(417, "Case Study - Emotions, Attitude, Communication, and Style in Song Lyrics"),
      assignment(418, "Activity: Finding Meaning Through Music (A for L)"),
      resource(419, "Elements of a Movie Review"),
      resource(420, "Writing a Film Review"),
      resource(421, "Sample Movie Reviews"),
      assignment(422, "Activity: Writing A Movie Review (A for L)"),
      forum(423, "Discussion: Sharing Your Movie Review (A as/of L)"),
      assignment(424, "Activity: Analyzing the Effectiveness of Print Ads (A for L)"),
      resource(425, "Analyzing Political Cartoons Lesson + Worksheet"),
      assignment(426, "Activity: Assessing and Creating Political Cartoons (A for L)"),
      assignment(427, "Assignment: Political Cartoon (A of L)"),
      resource(428, "Writing the Persuasive Essay"),
      assignment(429, "Assignment: Persuasive Essay (A as/of L)"),
      assignment(430, "Self-Assessment: Learning Skills and Work Habits (A as L)"),
    ],
  },
  {
    title: 'Unit 3: Novel Study - "Lord of the Flies"',
    lessonTitle: "Lord of the Flies Resource Sequence",
    coreTexts: ["lord-of-the-flies"],
    items: [
      assignment(431, 'Activity: Anticipation Guide - "The Lord of the Flies" (A for/as L)'),
      resource(432, 'Novel: "Lord of the Flies" by William Golding', "source_text"),
      resource(433, 'Introduction to "Lord of the Flies"'),
      resource(434, "Chapter 1 - The Sound of the Shell"),
      forum(435, "Discussion: A New Government (A as/of L)"),
      resource(436, "Chapter 2 - Fire on the Mountain"),
      assignment(437, "Activity: Monitoring Comprehension in Chapter 2 (A for L)"),
      resource(438, "Chapter 3 - Huts on the Beach"),
      assignment(439, "Activity: Assessing Key Quotes in Chapter 3 (A for L)"),
      resource(440, "Chapter 4 - Painted Faces and Long Hair"),
      assignment(441, "Activity: Making Historical Connections in Chapter 4 (A for L)"),
      resource(442, "Chapter 5 - Beast From Water"),
      forum(443, "Discussion: Debating Who is the Better Chief (A as/of L)"),
      resource(444, "Chapter 6 - Beast From Air"),
      assignment(445, "Activity: Ralph's First Hunt (A for L)"),
      resource(446, "Chapter 7 - Shadows and Tall Trees"),
      assignment(447, "Activity: Beast or No Beast? (A for L)"),
      resource(448, "Chapter 8 - Gift For The Darkness"),
      assignment(449, "Activity: The Gift in Chapter 8 (A for L)"),
      resource(450, "Chapter 9 - A View To Death"),
      assignment(451, "Activity: Death and Darkness in Chapter 9 (A for L)"),
      resource(452, "Chapter 10 - The Shell and The Glasses"),
      assignment(453, "Activity: The Symbolism of the Shell and the Glasses in Chapter 10 (A for L)"),
      assignment(454, "Activity: Symbolic Associations in the Novel (A for L)"),
      resource(455, "Chapter 11 - Castle Rock"),
      forum(456, "Discussion: Fighting for Democracy in Chapter 11 (A as/of L)"),
      resource(457, "Chapter 12 - Cry of the Hunters"),
      assignment(458, "Activity: A Final Reflection - Rousseau's Noble Savage Theory (A for L)"),
      assignment(459, "Activity: Analysis of Themes in the Novel (A for L)"),
      assignment(460, "Activity: Irony at its Finest in Chapter 12 (A for L)"),
      assignment(461, "Assignment: Mind Map (A of L)"),
      assignment(462, "Assignment: Unit #3 Test (A of L)"),
      folder(463, "ENG2D Unit #3 Test (FOR TEACHER USE ONLY)"),
    ],
  },
  {
    title: 'Unit 4: Drama - "Othello"',
    lessonTitle: "Othello Resource Sequence",
    coreTexts: ["othello"],
    items: [
      assignment(464, 'Activity: Anticipation Guide for "Othello" (A as L)'),
      resource(465, "A Glossary: Shakespeare's Common Tongue"),
      resource(466, 'The Play: "Othello" by William Shakespeare', "source_text"),
      resource(467, 'An Overview: Shakespeare\'s "Othello"'),
      resource(468, 'An Introduction to the Characters in Shakespeare\'s "Othello"'),
      resource(469, "Act I - Active Reading and Reflecting"),
      assignment(470, "Activity: Act I - Study Guide Questions (A for L)"),
      resource(471, "Act II - Active Reading and Reflecting"),
      assignment(472, "Activity: Act II - Study Guide Questions (A for L)"),
      resource(473, "Act III - Active Reading and Reflecting"),
      forum(474, "Discussion: Observations and Notes in Acts I and II (A as/of L)"),
      assignment(475, "Activity: Act III - Study Guide Questions (A for L)"),
      resource(476, "Act IV - Active Reading and Reflecting"),
      assignment(477, "Activity: Act IV - Study Guide Questions (A for L)"),
      forum(478, 'Discussion: Symbolism in "Othello" (A as/of L)'),
      assignment(479, "Activity: Act V - Study Guide Questions (A for L)"),
      forum(480, 'Discussion: Betrayal in "Othello" (A as/of L)'),
      assignment(481, "Activity: Discussing the Big Ideas in the Play (A for L)"),
      assignment(482, "Activity: Testing Your Quote Knowledge (A for/as L)"),
      assignment(483, 'Activity: Analyzing Key Quotes in "Othello" (A for L)'),
      assignment(484, "Assignment: Literary Essay (A as/of L)"),
      assignment(485, "Assignment: Movie Trailer (A of L)"),
      assignment(486, "Self-Assessment: Learning Skills and Work Habits (A as L)"),
    ],
  },
  {
    title: "Unit 5: Culminating Evaluation - ISP",
    lessonTitle: "ISP Culminating Evaluation",
    coreTexts: [],
    items: [
      assignment(487, "Culminating Assignment: ISP - Steps 1-5 (A of L)"),
      assignment(488, "Culminating Assignment: ISP Oral/Visual Presentation (A of L)"),
      assignment(489, "Metacognitive Activity: Reflection (A as L)"),
    ],
  },
  {
    title: "Unit 6: Culminating Evaluation - Final Exam",
    lessonTitle: "Final Exam",
    coreTexts: [],
    items: [
      assignment(490, "Culminating Assignment: Final Exam (A of L)"),
      folder(491, "ENG2D Final Exam (FOR TEACHER USE ONLY)"),
    ],
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function unitSummary(lessons) {
  const downloads = lessons.reduce((sum, lesson) => sum + lesson.downloads.length, 0);
  return { downloads, ispring: 0, docx: 0, pdf: 0, video: 0, h5p: 0 };
}

const manifest = readJson(manifestPath);
manifest.courseDownloads = courseDownloads;
manifest.units = units.map((unitSpec, index) => {
  const unit = index + 1;
  const lesson = {
    id: `U${String(unit).padStart(2, "0")}L01`,
    unit,
    lesson: 1,
    title: unitSpec.lessonTitle,
    path: `lessons/U${String(unit).padStart(2, "0")}L01`,
    bookPageCount: 0,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads: unitSpec.items,
    resourceCounts: {
      downloads: unitSpec.items.length,
      moodleActivities: unitSpec.items.length,
    },
  };
  return {
    unit,
    title: unitSpec.title,
    coreTexts: unitSpec.coreTexts,
    unitPlan: null,
    unitResources: {},
    summary: unitSummary([lesson]),
    lessons: [lesson],
  };
});
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  lessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  authenticatedMoodleRescanAt: new Date().toISOString(),
  moodleActivityResourceCount: manifest.courseDownloads.length + manifest.units.reduce((sum, unit) => sum + unit.summary.downloads, 0),
  moodleCoursePageStructureImported: true,
};

writeJson(manifestPath, manifest);

console.log(`${course}: wrote ${manifest.units.length} units, ${manifest.sourceAudit.lessonCount} lesson containers, and ${manifest.sourceAudit.moodleActivityResourceCount} Moodle activities/resources.`);
