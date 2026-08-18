import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLBO";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");

const unitTitles = {
  1: "Unit 1: Roots and Routes",
  2: "Unit 2: Fables",
  3: "Unit 3: How Canada Works",
  4: "Unit 4: Teen Culture",
  5: "Culminating and Final Assessment",
};

const moodle = (mod, id, label, role = null) => ({
  label,
  type: "html",
  category: `moodle_${mod}`,
  role: role || (mod === "resource" ? "lesson_resource" : mod),
  url: `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`,
  source: "authenticated Moodle course page",
});

const assignment = (id, label) => moodle("assign", id, label, "assignment");
const resource = (id, label, role = "lesson_resource") => moodle("resource", id, label, role);
const url = (id, label, role = "external_resource") => moodle("url", id, label, role);
const folder = (id, label, role = "folder") => moodle("folder", id, label, role);

const courseDownloads = [
  resource(4942, "Exit Card", "course_resource"),
  url(4943, "Online Attendance Policy", "course_policy"),
  resource(4944, "Learning Skills & Work Habits", "course_resource"),
  url(4945, "Learning Log", "course_resource"),
  url(4946, "COURSE OUTLINE", "course_outline"),
  resource(4947, "SUCCESS CRITERIA", "course_resource"),
  url(4948, "STUDENTS SYLLABUS", "course_syllabus"),
  resource(4949, "Unit Plan ESLBO", "unit_plan"),
  resource(4950, "Unit 1 Lesson Plan", "lesson_plan"),
  resource(4951, "UNIT 2 Lesson Plan", "lesson_plan"),
  resource(4952, "UNIT 3 Lesson Plan", "lesson_plan"),
  resource(4953, "UNIT 4 Lesson Plan", "lesson_plan"),
];

const lessonsByUnit = {
  1: [
    [
      "Grammar Foundations",
      [
        assignment(4955, "GRAMMAR - Articles (AFL)"),
        assignment(4956, "GRAMMAR- PLURAL NOUNS (AAL)"),
        assignment(4957, "GRAMMAR - Possessive case, Pronouns, Compound Nouns (AFL)"),
      ],
    ],
    [
      "Conversation and Everyday Communication",
      [
        assignment(4958, "Recipe Making Worksheet CONVERSATION (AOL)"),
        assignment(4959, "Accepting rejecting Invitations Worksheet(AAL)"),
        assignment(4960, "Conversational Expressions Worksheet (AAL)"),
      ],
    ],
    [
      "Reading, Vocabulary, and Personal Writing",
      [
        assignment(4962, "Grammar: Gerund and Count/Non-count Nouns (AFL)"),
        assignment(4963, "Understanding the Graph Worksheet (AFL)"),
        assignment(4964, 'Compose a poem "I am" OBSERVATION (AOL)'),
        assignment(4965, "Prefix Suffix_Worksheet (AAL)"),
      ],
    ],
    [
      "Unit 1 Assessment and Reflection",
      [
        assignment(4966, "Unit 1 End Test (AOL)"),
        resource(4967, "Observation and Conversation Unit 1"),
        assignment(4968, "Learning Log Submission Unit 1"),
      ],
    ],
  ],
  2: [
    [
      "Fable Reading and Response",
      [
        assignment(4970, "The Hare and the Tortoise Story + Worksheet (AFL)"),
        assignment(4971, "Journal Writing OBSERVATION (AOL)"),
        assignment(4972, "Grammar: Transitions and Synonyms (AAL)"),
      ],
    ],
    [
      "News and Past Forms",
      [
        assignment(4973, "Newspaper Article Analysis Worksheet (AOL)"),
        assignment(4974, "Grammar - Past Forms (AFL)"),
        resource(4975, "My Vocabulary journal"),
        resource(4976, "Table of Irregular verbs"),
      ],
    ],
    [
      "Story Elements and Informal Writing",
      [
        assignment(4978, "Grammar: Noun,Adjectives and Future forms (AFL)"),
        assignment(4979, "Story Elements Worksheet (AAL)"),
        assignment(4980, "Grammar: Infinitive and Modal verbs (AFL)"),
        assignment(4981, "Informal Letter CONVERSATION (AOL)"),
      ],
    ],
    [
      "Unit 2 Assessment and Reflection",
      [
        assignment(4982, "Unit 2 End Test (AOL)"),
        resource(4983, "Conversation and Observation unit 2"),
        assignment(4984, "Learning Skills Checklist Self-Assessment"),
        assignment(4985, "Learning Log Submission Unit 2"),
      ],
    ],
  ],
  3: [
    [
      "Paragraphs, Adverbs, and Quantifiers",
      [
        assignment(4989, "Grammar: Paragraph Correction 2 Worksheet (AAL)"),
        assignment(4990, "Grammar: Adverbs of manner and Quantifiers (AFL)"),
      ],
    ],
    [
      "Canadian Government and Resources",
      [
        assignment(4991, "Levels of government Worksheet (AOL/OBSERVATION)"),
        assignment(4992, "Resources of Canada Assignment (AOL/CONVERSATION)"),
        assignment(4993, "Parliamentary quiz who am I? (AFL)"),
        resource(4994, "Online resources"),
        folder(4995, "Conversation and Observation unit 3"),
      ],
    ],
    [
      "Canadian Resources Research and Listening",
      [
        assignment(4997, "Grammar: Conjunctions (AAL)"),
        assignment(4998, "Grammar: Adjectives - Comparative and Superlative degrees (AAL)"),
        assignment(4999, "Exploring resources in Canada Assignment (AFL)"),
        assignment(5000, "Listening Podcast: Canadian government (AFL)"),
        assignment(5001, "Exploring resources in Canada Handout"),
      ],
    ],
    [
      "Unit 3 Assessment and Reflection",
      [
        assignment(5002, "UNIT 3 END TEST (AOL)"),
        resource(5003, "Observation and Conversation Checklist"),
        assignment(5004, "Learning Log Submission Unit 3"),
      ],
    ],
  ],
  4: [
    [
      "News Articles and Editing",
      [
        assignment(5006, "News article 5w's (AOL/CONVERSATION)"),
        assignment(5007, "Peer editing worksheet (AAL)"),
        resource(5008, "Grammar: Comma Handout"),
        resource(5009, "Quotation Marks Handouts"),
      ],
    ],
    [
      "Punctuation and Study Skills",
      [
        assignment(5010, "Grammar : Punctuation (AFL)"),
        assignment(5011, "Homework and study skills Note taking (AAL)"),
        resource(5012, "Grammar: Negative imperative Handout"),
        assignment(5013, "Grammar: Negative Imperatives and Reported speech (AFL)"),
      ],
    ],
    [
      "Paragraphs, Questions, and Citizenship",
      [
        assignment(5014, "Who am I Worksheet (AFL)"),
        assignment(5016, "The paragraph worksheet (AAL)"),
        assignment(5017, "Paragraph Writing on cellphones Assignment (AOL/OBSERVATION)"),
        resource(5018, "Paragraph Writing Handout"),
        assignment(5019, "Book jacket (AFL)"),
        assignment(5020, "Wh Question (AFL)"),
        assignment(5021, "Democracy and citizenship Assignment (AOL)"),
      ],
    ],
    [
      "Unit 4 Assessment and Reflection",
      [
        assignment(5022, "Unit 4 End Test (AOL)"),
        folder(5023, "Observation and Conversation Unit 4"),
        assignment(5024, "Learning Log Submission Unit 4"),
        assignment(5026, "Exit Card"),
      ],
    ],
  ],
  5: [["ISP and Final Exam", [assignment(5027, "ISP - Heroes Summative presentation- AOL"), assignment(5028, "Final Exam (20%)")]]],
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
manifest.course = {
  ...(manifest.course || {}),
  code: course,
  title: "English as a Second Language, ESL Level 2, Open",
  source: "Authenticated SunnyBrook Moodle course page",
};
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
  ispringExpected: 0,
  ispringComplete: 0,
  moodleCourseId: 49,
  outlineUrl: "https://www.esunnybrook.com/mod/url/view.php?id=4946",
  authenticatedMoodleRescanAt: new Date().toISOString(),
  moodleActivityResourceCount: manifest.courseDownloads.length + manifest.units.reduce((sum, unit) => sum + unit.summary.downloads, 0),
  moodleTopicLessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  localImportStatus: "authenticated Moodle course activities indexed; no Moodle Book or iSpring activities found on course page",
};

writeJson(manifestPath, manifest);
console.log(`${course}: wrote ${manifest.sourceAudit.lessonCount} lesson records with ${manifest.sourceAudit.moodleActivityResourceCount} Moodle resources`);
