import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SNC2D");
const manifestPath = join(courseRoot, "course-manifest.json");
const resourceIndexPath = join(projectRoot, "public", "moodle-course-resource-index.json");

loadEnvFile(join(projectRoot, ".env"));

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

class CookieJar {
  constructor(initialCookie) {
    this.cookies = new Map();
    for (const part of String(initialCookie || "").split(";")) {
      const index = part.indexOf("=");
      if (index > 0) this.cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
  }

  store(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      for (const cookieText of String(value).split(/,(?=\s*[^;,]+=)/g)) {
        const [pair] = cookieText.split(";");
        const index = pair.indexOf("=");
        if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar(process.env.MOODLE_COOKIE || "");

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-snc2d-manifest-builder/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login failed.");
}

function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString();
    const text = stripTags(match[2]);
    const key = `${text}|${href}`;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    links.push({ text, href });
  }
  return links;
}

function activity(text, href, role = "activity") {
  const mod = /\/mod\/([^/]+)\//i.exec(href)?.[1] || "resource";
  const id = /[?&]id=(\d+)/i.exec(href)?.[1] || "";
  return {
    label: text,
    type: mod === "h5pactivity" ? "h5p" : "html",
    category: `moodle_${mod}`,
    role,
    url: href,
    source: "authenticated Moodle course page",
    moodleActivityId: id,
  };
}

function findOne(links, label) {
  return links.find((link) => link.text === label);
}

function findLesson(links, unit, lesson, answer = false) {
  const label = `Unit ${unit} - Lesson ${lesson}${answer ? " (Answer)" : ""}`;
  return findOne(links, label);
}

function findExitCard(links, unit, lesson) {
  return findOne(links, `Unit ${unit} - Lesson ${lesson} Exit Card`);
}

function findUnitDropbox(links, unit, kind) {
  const pattern = kind === "kwl"
    ? new RegExp(`^Unit ${unit} - KWL Dropbox$`, "i")
    : new RegExp(`^Unit ${unit} - Reflection Summary Dropbox$`, "i");
  return links.find((link) => pattern.test(link.text));
}

function unitAssessmentLinks(links, unit, title) {
  const out = [];
  const lab = links.find((link) => new RegExp(`^Unit ${unit}\\s*-?\\s*Lab$`, "i").test(link.text));
  if (lab) out.push(activity(lab.text, lab.href, "lab"));
  for (const link of links) {
    if (new RegExp(`^${title} - (Quiz 1|Unit - Test)$`, "i").test(link.text)) {
      out.push(activity(link.text, link.href, /quiz/i.test(link.text) ? "quiz" : "unit_test"));
    }
  }
  return out;
}

function lessonRecord(links, unit, lesson, title) {
  const downloads = [];
  const assignment = findLesson(links, unit, lesson, false);
  const answer = findLesson(links, unit, lesson, true);
  const exitCard = findExitCard(links, unit, lesson);
  if (assignment) downloads.push(activity(assignment.text, assignment.href, "homework"));
  if (answer) downloads.push(activity(answer.text, answer.href, "answer_key"));
  if (exitCard) downloads.push(activity(exitCard.text, exitCard.href, "exit_card"));
  return {
    id: `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
    unit,
    lesson,
    title,
    path: `lessons/U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads,
    resourceCounts: {},
  };
}

function finalLessonRecord(links, lesson) {
  const labels = {
    1: ["Final Exam Dropbox", "Final Exam", "Unit 5 - Lesson 1 Exit Card"],
    2: ["Culminating Dropbox", "Unit 5 - Lesson 2 Exit Card"],
    3: ["Unit 5 - Lesson 3 Exit Card"],
    4: ["Unit 5 - Lesson 4 Exit Card"],
  }[lesson];
  const downloads = [];
  for (const label of labels) {
    const link = findOne(links, label);
    if (link) downloads.push(activity(link.text, link.href, /Exit Card/i.test(link.text) ? "exit_card" : "culminating"));
  }
  return {
    id: `U05L${String(lesson).padStart(2, "0")}`,
    unit: 5,
    lesson,
    title: lesson === 1 ? "Final Exam" : lesson === 2 ? "Culminating Evaluation" : `Unit 5 Exit Card ${lesson}`,
    path: `lessons/U05L${String(lesson).padStart(2, "0")}`,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads,
    resourceCounts: {},
  };
}

function countType(unit, predicate) {
  return unit.lessons.reduce((sum, lesson) => sum + lesson.downloads.filter(predicate).length, 0)
    + Object.values(unit.unitResources || {}).flat().filter(predicate).length;
}

await loginIfNeeded();
const index = readJson(resourceIndexPath);
const courseIndex = index.courses.find((course) => course.course === "SNC2D");
const coursePage = courseIndex.coursePage || "https://www.esunnybrook.com/course/view.php?id=67";
const response = await request(coursePage);
const html = await response.text();
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const links = extractLinks(html, coursePage);

const bookByUnit = new Map((courseIndex.books || []).map((book, index) => [index + 1, book.url]));
const units = [
  { unit: 1, title: "Unit 1: Biology", topic: "Biology", lessons: 8 },
  { unit: 2, title: "Unit 2: Chemistry", topic: "Chemistry", lessons: 8 },
  { unit: 3, title: "Unit 3: Earth & Space Science", topic: "Earth & Space Science", lessons: 7 },
  { unit: 4, title: "Unit 4: Physics", topic: "Physics", lessons: 8 },
].map((unit) => {
  const lessons = Array.from({ length: unit.lessons }, (_, index) => lessonRecord(links, unit.unit, index + 1, `${unit.topic} Lesson ${index + 1}`));
  const kwl = findUnitDropbox(links, unit.unit, "kwl");
  const reflection = findUnitDropbox(links, unit.unit, "reflection");
  if (kwl) lessons[lessons.length - 1].downloads.push(activity(kwl.text, kwl.href, "kwl_dropbox"));
  if (reflection) lessons[lessons.length - 1].downloads.push(activity(reflection.text, reflection.href, "reflection"));
  const unitResources = {
    lessonBook: [
      activity(`SNC2D Unit ${unit.unit} Lessons Book`, bookByUnit.get(unit.unit), "lesson_book"),
      ...unitAssessmentLinks(links, unit.unit, unit.topic),
    ].filter((item) => item.url),
  };
  return {
    unit: unit.unit,
    title: unit.title,
    coreTexts: [],
    unitPlan: null,
    unitResources,
    summary: {},
    lessons,
  };
});

units.push({
  unit: 5,
  title: "Unit 5: Final Exam & Culminating",
  coreTexts: [],
  unitPlan: null,
  unitResources: {},
  summary: {},
  lessons: [1, 2, 3, 4].map((lesson) => finalLessonRecord(links, lesson)),
});

for (const unit of units) {
  for (const lesson of unit.lessons) {
    lesson.resourceCounts = {
      downloads: lesson.downloads.length,
      h5p: lesson.downloads.filter((item) => item.category === "moodle_h5pactivity").length,
      docx: 0,
      pdf: 0,
      video: 0,
    };
  }
  unit.summary = {
    downloads: countType(unit, () => true),
    ispring: 0,
    docx: 0,
    pdf: 0,
    video: 0,
    h5p: countType(unit, (item) => item.category === "moodle_h5pactivity"),
  };
}

const courseDownloads = [
  {
    label: "SNC2D Course Outline",
    type: "docx",
    category: "course_document",
    role: "course_outline",
    url: courseIndex.outlineUrl,
    source: "Moodle course resource index",
  },
  findOne(links, "Lab report template") && activity("Lab report template", findOne(links, "Lab report template").href, "course_template"),
  findOne(links, "Learning Log") && activity("Learning Log", findOne(links, "Learning Log").href, "learning_log"),
].filter(Boolean);

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  course: {
    code: "SNC2D",
    title: "Science, Grade 10, Academic",
    audience: "Teachers preparing OSSD lessons",
    source: "Authenticated SunnyBrook Moodle course shell",
  },
  sourceAudit: {
    moodleCourseId: 67,
    moodleCoursePage: coursePage,
    outlineUrl: courseIndex.outlineUrl,
    lessonCount: units.reduce((sum, unit) => sum + unit.lessons.length, 0),
    unitCount: units.length,
    moodleBookCount: courseIndex.bookCount || 0,
    moodleActivityCount: units.reduce((sum, unit) => sum + countType(unit, () => true), 0) + courseDownloads.length,
    ispringExpected: 0,
    ispringComplete: 0,
    currentMoodleShellImportedAt: new Date().toISOString(),
    notes: [
      "Legacy Moodle activity structure, not ENG3U-style Moodle Book chapter structure.",
      "No iSpring entries are exposed in the current SNC2D Moodle shell.",
    ],
  },
  navigation: {
    primary: "unit",
    secondary: "lesson",
  },
  courseDownloads,
  texts: [],
  units,
};

mkdirSync(courseRoot, { recursive: true });
writeJson(manifestPath, manifest);
console.log(JSON.stringify({
  course: "SNC2D",
  units: units.length,
  lessons: manifest.sourceAudit.lessonCount,
  courseDownloads: courseDownloads.length,
  activityItems: manifest.sourceAudit.moodleActivityCount,
  h5p: units.reduce((sum, unit) => sum + unit.summary.h5p, 0),
}, null, 2));
