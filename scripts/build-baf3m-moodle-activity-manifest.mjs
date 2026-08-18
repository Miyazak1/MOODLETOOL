import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BAF3M";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const coursePage = "https://www.esunnybrook.com/course/view.php?id=32";

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
  headers.set("user-agent", "ossd-course-portal-baf3m-manifest-builder/1.0");
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
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString();
    const text = decodeText(match[2]);
    if (text) links.push({ text, href });
  }
  return links;
}

function isMoodleActivity(href) {
  return /https:\/\/www\.esunnybrook\.com\/mod\/(?:assign|book|feedback|folder|forum|h5pactivity|lesson|page|quiz|resource|url)\/view\.php\?id=\d+/i.test(href);
}

function sectionId(href) {
  return /#collapseSection-(\d+)/i.exec(href)?.[1] || "";
}

function roleForLabel(label, mod = "") {
  if (/course outline/i.test(label)) return "course_outline";
  if (/board notes|class notes|introductory lesson|chapter|ch#|ethics|business entities|internal control|technology|careers|depreciation/i.test(label)) return "lesson_material";
  if (/recorded videos?/i.test(label) || mod === "lesson") return "recorded_video_lesson";
  if (/learning log/i.test(label)) return "learning_log";
  if (/observation|conversation|checklists/i.test(label)) return "observation_checklist";
  if (/worksheet|assignment|activity|dropbox|submission|cp|project/i.test(label)) return "assignment";
  if (/test|exam/i.test(label)) return "assessment";
  if (/discussion|forum/i.test(label) || mod === "forum") return "discussion";
  if (mod === "url") return "external_reference";
  return "resource";
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

function lessonRecord(unitNumber, lessonIndex, title, item) {
  const paddedUnit = String(unitNumber).padStart(2, "0");
  const paddedLesson = String(lessonIndex).padStart(2, "0");
  const idSuffix = item?.moodleActivityId ? `-${item.moodleActivityId}` : "";
  return {
    id: `U${paddedUnit}L${paddedLesson}${idSuffix}`,
    unit: unitNumber,
    lesson: lessonIndex,
    title,
    path: `lessons/U${paddedUnit}L${paddedLesson}${idSuffix}`,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads: item ? [item] : [],
    resourceCounts: {
      downloads: item ? 1 : 0,
      lessonPlan: 0,
      ispring: 0,
    },
  };
}

function summarizeUnit(unit) {
  const resources = unit.lessons.flatMap((lesson) => [...(lesson.downloads || []), ...(lesson.ispring || [])]);
  const count = (predicate) => resources.filter(predicate).length;
  unit.summary = {
    downloads: resources.length,
    ispring: count((item) => item.category === "ispring" || item.type === "ispring"),
    docx: count((item) => /docx?/i.test(item.type || item.label || "")),
    pdf: count((item) => /pdf/i.test(item.type || item.label || "")),
    video: count((item) => /video|mp4/i.test(item.type || item.role || item.label || "")),
    h5p: count((item) => item.type === "h5p" || /h5p/i.test(item.category || "")),
  };
  return unit;
}

const sectionSpecs = new Map([
  ["376", { unit: 0, title: "Introduction" }],
  ["377", { unit: 1, title: "Unit 1: Week 1 and 2 - Accounting Basics and Double Entries" }],
  ["378", { unit: 2, title: "Unit 2: Week 3 - Accounting Ethics and T Accounts" }],
  ["379", { unit: 3, title: "Unit 3: Week 4 - Types of Business Entities and Trial Balance" }],
  ["380", { unit: 4, title: "Unit 4: Week 5 - Internal Control Procedures and Profit/Loss Account" }],
  ["381", { unit: 5, title: "Unit 5: Week 6 - Advanced PL and BS, Depreciation, Careers in A/C" }],
  ["383", { unit: 6, title: "Unit 6: Culminating Project" }],
  ["384", { unit: 7, title: "Unit 7: Final Exam" }],
]);

await loginIfNeeded();
const response = await request(coursePage);
const html = await response.text();
if (!response.ok) throw new Error(`HTTP ${response.status}`);
if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login page returned.");

const links = extractLinks(html, coursePage);
const courseDownloads = [];
const sectionActivities = new Map([...sectionSpecs.values()].filter((spec) => spec.unit > 0).map((spec) => [spec.unit, []]));
let currentSpec = null;
const seenActivityIds = new Set();

for (const link of links) {
  const id = sectionId(link.href);
  if (sectionSpecs.has(id)) {
    currentSpec = sectionSpecs.get(id);
    continue;
  }
  if (!isMoodleActivity(link.href)) continue;
  const mod = /\/mod\/([^/]+)\//i.exec(link.href)?.[1]?.toLowerCase() || "";
  const moodleId = /[?&]id=(\d+)/i.exec(link.href)?.[1] || "";
  if (!moodleId || seenActivityIds.has(moodleId)) continue;
  seenActivityIds.add(moodleId);
  const item = activity(link.text, link.href, roleForLabel(link.text, mod));
  if (currentSpec?.unit === 0) {
    courseDownloads.push(item);
  } else if (currentSpec?.unit && sectionActivities.has(currentSpec.unit)) {
    sectionActivities.get(currentSpec.unit).push(item);
  }
}

const units = [...sectionSpecs.values()].filter((spec) => spec.unit > 0).map((spec) => {
  const activities = sectionActivities.get(spec.unit) || [];
  const lessons = activities.map((item, index) => lessonRecord(spec.unit, index + 1, item.label, item));
  return summarizeUnit({
    unit: spec.unit,
    title: spec.title,
    coreTexts: [],
    unitPlan: null,
    unitResources: {},
    summary: {},
    lessons,
  });
});

const totalActivities = courseDownloads.length + units.reduce((sum, unit) => sum + unit.lessons.reduce((lessonSum, lesson) => lessonSum + (lesson.downloads?.length || 0), 0), 0);

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  course: {
    code: course,
    title: "Financial Accounting Fundamentals, Grade 11, University/College",
    audience: "Teachers preparing OSSD lessons",
    source: "Authenticated SunnyBrook Moodle course shell",
  },
  sourceAudit: {
    coursePage,
    moodleCourseId: 32,
    lessonCount: units.reduce((sum, unit) => sum + unit.lessons.length, 0),
    ispringExpected: 0,
    ispringComplete: 0,
    planningFileCount: courseDownloads.filter((item) => /plan|outline/i.test(item.label)).length,
    moodleBookCount: 0,
    activityItemCount: totalActivities,
    notes: "Legacy Moodle activity course. No Moodle Book, iSpring, or H5P packages were visible on the current course shell.",
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
console.log(`BAF3M manifest rebuilt: units ${units.length}; lessons ${manifest.sourceAudit.lessonCount}; activities ${totalActivities}.`);
