import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SNC1D";
const courseRoot = join(workspaceRoot, "courseware", course);
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
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeText(value) {
  return stripTags(value)
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
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
  headers.set("user-agent", "ossd-course-portal-snc1d-manifest-builder/1.0");
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
    const text = decodeText(match[2]);
    const key = `${text}|${href}`;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    links.push({ text, href });
  }
  return links;
}

function activity(text, href, role = "activity") {
  const mod = /\/mod\/([^/]+)\//i.exec(href)?.[1]?.toLowerCase() || "resource";
  const id = /[?&]id=(\d+)/i.exec(href)?.[1] || "";
  return {
    label: text,
    type: mod === "h5pactivity" ? "h5p" : "html",
    category: `moodle_${mod}`,
    role,
    url: href,
    source: "authenticated SunnyBrook Moodle course page",
    moodleActivityId: id,
  };
}

function isMoodleActivity(href) {
  return /https:\/\/www\.esunnybrook\.com\/mod\/(?:assign|book|folder|h5pactivity|page|quiz|resource|url)\/view\.php\?id=\d+/i.test(href);
}

function sectionId(href) {
  return /#collapseSection-(\d+)/i.exec(href)?.[1] || "";
}

function lessonKey(label) {
  const match = /^Lesson\s+(\d+[A-Z]?)(?:\s*[:_-]\s*)?(.*)$/i.exec(label.trim());
  if (!match) return null;
  return {
    key: match[1].toUpperCase(),
    title: match[2]?.trim() || `Lesson ${match[1].toUpperCase()}`,
  };
}

function lessonSortKey(key) {
  const match = /^(\d+)([A-Z]?)$/i.exec(key);
  if (!match) return 9999;
  return Number(match[1]) * 10 + (match[2] ? match[2].toUpperCase().charCodeAt(0) - 64 : 0);
}

function roleForLabel(label) {
  if (/outline/i.test(label)) return "course_outline";
  if (/unit plan/i.test(label)) return "unit_plan_reference";
  if (/teacher.*observation|conversation/i.test(label)) return "observation_checklist";
  if (/learning log/i.test(label)) return "learning_log";
  if (/goals?\s*check\s*list|goals?\s*checklist/i.test(label)) return "goals_checklist";
  if (/answer|key|solution/i.test(label)) return "answer_key";
  if (/test|quiz|exam/i.test(label)) return "assessment";
  if (/assignment|dropbox|submission/i.test(label)) return "assignment";
  if (/lab/i.test(label)) return "lab";
  if (/survey/i.test(label)) return "survey";
  if (/video|song/i.test(label)) return "video_reference";
  if (/interactive|simulation|game|phet/i.test(label)) return "interactive";
  if (/handout|worksheet|package/i.test(label)) return "handout";
  return "resource";
}

function isUnitResource(label) {
  return /teacher.*observation|conversation|learning log|goals?\s*check\s*list|goals?\s*checklist|course updates|unit plan/i.test(label);
}

function emptyLesson(unitNumber, lessonIndex, title, sourceKey = "") {
  const paddedUnit = String(unitNumber).padStart(2, "0");
  const paddedLesson = String(lessonIndex).padStart(2, "0");
  const suffix = sourceKey ? `-${sourceKey.replace(/[^A-Z0-9]+/gi, "").toUpperCase()}` : "";
  return {
    id: `U${paddedUnit}L${paddedLesson}${suffix}`,
    unit: unitNumber,
    lesson: lessonIndex,
    title,
    path: `lessons/U${paddedUnit}L${paddedLesson}${suffix}`,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads: [],
    resourceCounts: {},
  };
}

function addResource(unit, item, bucket = "moodleResources") {
  if (!unit.unitResources[bucket]) unit.unitResources[bucket] = [];
  unit.unitResources[bucket].push(item);
}

function summarizeUnit(unit) {
  const resources = [
    ...(Object.values(unit.unitResources || {}).flat()),
    ...unit.lessons.flatMap((lesson) => [
      ...(lesson.lessonText || []),
      ...(lesson.textExports || []),
      ...(lesson.downloads || []),
      ...(lesson.ispring || []),
    ]),
  ];
  const count = (predicate) => resources.filter(predicate).length;
  unit.summary = {
    downloads: resources.length,
    ispring: count((item) => item.category === "ispring" || item.type === "ispring"),
    docx: count((item) => /docx?/i.test(item.type || item.label || "")),
    pdf: count((item) => /pdf/i.test(item.type || item.label || "")),
    video: count((item) => /video|mp4/i.test(item.type || item.role || item.label || "")),
    h5p: count((item) => item.type === "h5p" || /h5p/i.test(item.category || "")),
  };
  for (const lesson of unit.lessons) {
    lesson.resourceCounts = {
      downloads: lesson.downloads.length,
      lessonPlan: lesson.lessonPlan ? 1 : 0,
      ispring: lesson.ispring.length,
    };
  }
  return unit;
}

const sectionSpecs = new Map([
  ["672", { unit: 1, title: "Introduction to SNC1D", mode: "instructional" }],
  ["673", { unit: 2, title: "Unit 1: Scientific Investigation Skills & Career Exploration", mode: "instructional" }],
  ["674", { unit: 3, title: "Unit 2: Sustainable Ecosystems (Biology)", mode: "instructional" }],
  ["675", { unit: 4, title: "Unit 3: Atoms, Elements & Compounds (Chemistry)", mode: "instructional" }],
  ["676", { unit: 5, title: "Unit 4: The Characteristics of Electricity (Physics)", mode: "instructional" }],
  ["677", { unit: 6, title: "Unit 5: Study of Universe (Earth and Space Science)", mode: "instructional" }],
  ["678", { unit: 7, title: "Assessments of Learning (Graded)", mode: "activity_list" }],
  ["679", { unit: 8, title: "Handout Submissions", mode: "activity_list" }],
  ["680", { unit: 9, title: "Online Resources", mode: "activity_list" }],
  ["681", { unit: 10, title: "Fun Stuff", mode: "activity_list" }],
  ["682", { unit: 11, title: "Final Evaluation 30% (ISP & Final Exam)", mode: "activity_list" }],
]);

await loginIfNeeded();
const index = readJson(resourceIndexPath);
const courseIndex = index.courses.find((row) => row.course === course);
const coursePage = courseIndex?.coursePage || "https://www.esunnybrook.com/course/view.php?id=62";
const response = await request(coursePage);
const html = await response.text();
if (!response.ok) throw new Error(`HTTP ${response.status}`);
if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login page returned.");

const links = extractLinks(html, coursePage);
const generalActivities = [];
const sectionActivities = new Map([...sectionSpecs.values()].map((spec) => [spec.unit, []]));
let currentSpec = null;
const seenActivities = new Set();

for (const link of links) {
  const id = sectionId(link.href);
  if (id === "670") {
    currentSpec = { unit: 0, title: "General" };
    continue;
  }
  if (sectionSpecs.has(id)) {
    currentSpec = sectionSpecs.get(id);
    continue;
  }
  if (!isMoodleActivity(link.href)) continue;
  const activityId = /[?&]id=(\d+)/i.exec(link.href)?.[1] || link.href;
  if (seenActivities.has(activityId)) continue;
  seenActivities.add(activityId);
  if (currentSpec?.unit === 0) {
    generalActivities.push(link);
  } else if (currentSpec?.unit && sectionActivities.has(currentSpec.unit)) {
    sectionActivities.get(currentSpec.unit).push(link);
  }
}

const courseDownloads = [];
for (const link of generalActivities) {
  if (/textbook/i.test(link.text)) continue;
  courseDownloads.push(activity(link.text, link.href, roleForLabel(link.text)));
}

const textBookLink = generalActivities.find((link) => /Grade 9 ON Science Textbook/i.test(link.text))
  || { text: "Grade 9 ON Science Textbook (McGraw-Hill Ryerson)", href: "https://www.esunnybrook.com/mod/book/view.php?id=6351" };

const units = [];
for (const spec of sectionSpecs.values()) {
  const unit = {
    unit: spec.unit,
    title: spec.title,
    coreTexts: spec.unit <= 6 ? ["grade-9-on-science-textbook"] : [],
    unitPlan: null,
    unitResources: {},
    summary: {},
    lessons: [],
  };
  const activities = sectionActivities.get(spec.unit) || [];
  if (spec.mode === "activity_list") {
    activities.forEach((link, index) => {
      const lesson = emptyLesson(spec.unit, index + 1, link.text);
      lesson.downloads.push(activity(link.text, link.href, roleForLabel(link.text)));
      unit.lessons.push(lesson);
    });
  } else {
    let currentLesson = null;
    const lessonByKey = new Map();
    for (const link of activities) {
      const record = activity(link.text, link.href, roleForLabel(link.text));
      const parsedLesson = lessonKey(link.text);
      if (parsedLesson) {
        if (!lessonByKey.has(parsedLesson.key)) {
          const lessonIndex = lessonByKey.size + 1;
          const lesson = emptyLesson(spec.unit, lessonIndex, `Lesson ${parsedLesson.key}: ${parsedLesson.title}`, parsedLesson.key);
          lesson.sourceLesson = parsedLesson.key;
          unit.lessons.push(lesson);
          lessonByKey.set(parsedLesson.key, lesson);
        }
        currentLesson = lessonByKey.get(parsedLesson.key);
        currentLesson.downloads.push(record);
      } else if (isUnitResource(link.text) || !currentLesson) {
        addResource(unit, record, "moodleResources");
      } else {
        currentLesson.downloads.push(record);
      }
    }
    unit.lessons.sort((a, b) => lessonSortKey(a.sourceLesson || "") - lessonSortKey(b.sourceLesson || ""));
    unit.lessons.forEach((lesson, index) => {
      lesson.lesson = index + 1;
      delete lesson.sourceLesson;
    });
    if (!unit.lessons.length && Object.values(unit.unitResources).flat().length) {
      const lesson = emptyLesson(spec.unit, 1, `${spec.title} Resources`);
      lesson.downloads = Object.values(unit.unitResources).flat();
      unit.unitResources = {};
      unit.lessons.push(lesson);
    }
  }
  units.push(summarizeUnit(unit));
}

const totalActivities = courseDownloads.length
  + units.reduce((sum, unit) => sum + Object.values(unit.unitResources).flat().length + unit.lessons.reduce((lessonSum, lesson) => lessonSum + lesson.downloads.length, 0), 0);

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  course: {
    code: course,
    title: "Science, Grade 9, Academic",
    audience: "Teachers preparing OSSD lessons",
    source: "Authenticated SunnyBrook Moodle course shell",
  },
  sourceAudit: {
    coursePage,
    moodleCourseId: 62,
    lessonCount: units.reduce((sum, unit) => sum + unit.lessons.length, 0),
    ispringExpected: 0,
    ispringComplete: 0,
    planningFileCount: courseDownloads.filter((item) => /plan|outline/i.test(item.label)).length,
    moodleBookCount: 1,
    activityItemCount: totalActivities,
    notes: "Legacy Moodle activity course. No Moodle iSpring packages were visible on the current course shell.",
  },
  navigation: {
    primary: "unit",
    secondary: "lesson",
  },
  courseDownloads,
  texts: [
    {
      id: "grade-9-on-science-textbook",
      title: "Grade 9 ON Science Textbook (McGraw-Hill Ryerson)",
      author: "McGraw-Hill Ryerson",
      type: "textbook",
      units: [1, 2, 3, 4, 5, 6],
      copyrightStatus: "localized_from_authenticated_moodle_source",
      sourceStatus: "pending_localization",
      notes: "Detected in the current SNC1D Moodle shell as a Moodle Book. Chapter PDFs should be localized from the book pages.",
      materials: [],
      externalLinks: [
        {
          label: textBookLink.text,
          type: "html",
          category: "textbook",
          role: "reference",
          url: textBookLink.href,
          source: "Moodle Book 6351",
        },
      ],
    },
  ],
  units,
};

mkdirSync(courseRoot, { recursive: true });
writeJson(manifestPath, manifest);
console.log(`SNC1D manifest rebuilt: units ${units.length}; lessons ${manifest.sourceAudit.lessonCount}; activities ${totalActivities}.`);
