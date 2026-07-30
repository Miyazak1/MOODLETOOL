import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "HFC3M";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

const moodleBase = "https://www.esunnybrook.com";
const scannedAt = new Date().toISOString();

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slug(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "resource";
}

function moodle(mod, id, label, role = null) {
  return {
    label,
    type: "html",
    category: `moodle_${mod}`,
    role: role || (mod === "assign" ? "assignment" : mod),
    url: `${moodleBase}/mod/${mod}/view.php?id=${id}`,
    source: "authenticated Moodle crawl",
  };
}

function forum(id, label) {
  return moodle("forum", id, label, "forum");
}

function resource(id, label, role = "lesson_resource") {
  return moodle("resource", id, label, role);
}

function assignment(id, label, extras = []) {
  return [moodle("assign", id, label, "assignment"), ...extras];
}

function folder(id, label, role = "folder") {
  return moodle("folder", id, label, role);
}

function lessonActivity(id, label, extras = []) {
  return [moodle("lesson", id, label, "lesson_activity"), ...extras];
}

function videoPlaceholder(label, url, notes = "") {
  const rel = `localized-moodle-activities/video-placeholder/${hashText(url)}-${slug(label)}.html`;
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(label)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 900px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 26px; margin: 0 0 16px; border-bottom: 1px solid #edf1f6; padding-bottom: 12px; }
    .notice { border: 1px solid #e0b45c; border-radius: 6px; background: #fff8e8; color: #674000; padding: 10px 12px; }
    code { overflow-wrap: anywhere; }
    a { color: #00396f; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(label)}</h1>
      <p class="notice">This Moodle video position is preserved, but the original external MP4 was unavailable during localization. Replace this placeholder with a YouTube link or embed when a working source is selected.</p>
      ${notes ? `<p>${htmlEscape(notes)}</p>` : ""}
      <p>Original URL: <a href="${htmlEscape(url)}" target="_blank" rel="noopener"><code>${htmlEscape(url)}</code></a></p>
    </article>
  </main>
</body>
</html>
`,
    "utf8",
  );
  return {
    label,
    type: "html",
    category: "external_video_placeholder",
    role: "video_placeholder",
    path: rel,
    bytes: statSync(abs).size,
    source: url,
    sourceStatus: "unavailable_pending_youtube",
    notes: notes || "Original HFC3M Moodle page referenced an external MP4 that may no longer play.",
  };
}

const oldVideos = {
  u1SafetyTips: videoPlaceholder(
    "Video placeholder - Safety Tips for Handling and Preparing Common Food",
    "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/5.%20%28Ali%29%20Safety%20Tips%20for%20Handling%20and%20Preparing%20Common%20Food.mp4",
  ),
  u1HealthHygiene: videoPlaceholder(
    "Video placeholder - Basic Food Safety Chapter 2 Health and Hygiene",
    "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/6.%20%28Ali%29%20Basic%20Food%20Safety%20Chapter%202%20Health%20and%20Hygiene%20%28English%29.mp4",
  ),
  u1Cleaning: videoPlaceholder(
    "Video placeholder - Basic Food Safety Chapter 5 Cleaning and Sanitizing",
    "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/7.%20%28Ali%29%20Basic%20Food%20Safety%20Chapter%205%20Cleaning%20and%20Sanitizing%20%28English%29.mp4",
  ),
  spicesA: videoPlaceholder(
    "Video placeholder - The Geography of Spices and Herbs",
    "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/10.%20The%20Geography%20of%20Spices%20and%20Herbs.mp4",
  ),
  spicesB: videoPlaceholder(
    "Video placeholder - The Geography of Spices and Herbs (Ali copy)",
    "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/10%20.%20%28Ali%29%20The%20Geography%20of%20Spices%20and%20Herbs.mp4",
  ),
  originsA: videoPlaceholder(
    "Video placeholder - Origins of Fruits and Vegetables",
    "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/11.%20Origins%20of%20Fruits%20and%20Vegetables.mp4",
  ),
  originsB: videoPlaceholder(
    "Video placeholder - Origins of Fruits and Vegetables (Ali copy)",
    "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/HFC3M/11.%20%28Ali%29%20Origins%20of%20Fruits%20and%20Vegetables.mp4",
  ),
};

const unitTitles = {
  1: "Unit 1: Safety and Food Preparation",
  2: "Unit 2: Culture and Food",
  3: "Unit 3: The Global Kitchen",
  4: "Unit 4: Food in Canada",
  5: "CPT",
  6: "Final Exam",
  7: "Teacher's Comments - Learning Skills and Work Habits",
};

const activitiesByUnit = {
  1: [
    ["Unit 1-Learning Log - AAL", assignment(5650, "Unit 1-Learning Log - AAL", [oldVideos.u1SafetyTips, oldVideos.u1HealthHygiene, oldVideos.u1Cleaning])],
    ["Food and Safety Learning Videos and Materials", [resource(5651, "Food and Safety Learning Videos and Materials")]],
    ["Food and Safety Poster (AAL)", assignment(5652, "Food and Safety Poster (AAL)")],
    ["Safety in the Kitchen Reflection (AAL)", assignment(5654, "Safety in the Kitchen Reflection (AAL)")],
    ["Food Safety Practices (AFL)", assignment(5656, "Food Safety Practices (AFL)")],
    ["Food Safety Research (AOL)", assignment(5657, "Food Safety Research (AOL)")],
    ["Food and Safety Discussion (AOL)", assignment(5658, "Food and Safety Discussion (AOL)")],
    ["Food and Safety Test (AOL)", assignment(5659, "Food and Safety Test (AOL)")],
    ["Unit 1 Observation/Conversation of Student Performance Feedback (Teacher Only)", assignment(5660, "Unit 1 Observation/Conversation of Student Performance Feedback (Teacher Only)")],
  ],
  2: [
    ["Unit 2-Learning Log - AAL", assignment(5661, "Unit 2-Learning Log - AAL")],
    ["Culture and Foods Learning Materials", assignment(5662, "Culture and Foods Learning Materials")],
    ["International Cuisines", lessonActivity(5663, "International Cuisines")],
    ["Introduction to International Foods (AAL)", assignment(5664, "Introduction to International Foods (AAL)")],
    ["Herb and Spice History (AAL)", assignment(5666, "Herb and Spice History (AAL)", [oldVideos.spicesA, oldVideos.spicesB])],
    ["Origins of Food (AFL)", assignment(5668, "Origins of Food (AFL)", [oldVideos.originsA, oldVideos.originsB])],
    ["Food Origin Investigation (AFL)", assignment(5669, "Food Origin Investigation (AFL)")],
    ["Cooking Lesson: Flavour, Herbs and Spices (AOL)", assignment(5670, "Cooking Lesson: Flavour, Herbs and Spices (AOL)")],
    ["Celebration of Taste Brochure (AOL)", assignment(5671, "Celebration of Taste Brochure (AOL)")],
    ["Culture and Food Cumulative Assignment (AOL)", assignment(5672, "Culture and Food Cumulative Assignment (AOL)")],
    ["Unit 2 Observation/Conversation of Student Performance Feedback (Teacher Only)", assignment(5673, "Unit 2 Observation/Conversation of Student Performance Feedback (Teacher Only)")],
  ],
  3: [
    ["Unit 3-Learning Log - AAL", assignment(5675, "Unit 3-Learning Log - AAL")],
    ["The Global Kitchen Learning Materials", assignment(5676, "The Global Kitchen Learning Materials")],
    ["International Cuisine (AAL)", assignment(5677, "International Cuisine (AAL)")],
    ["International Cooking Tools and Equipment (AAL)", assignment(5678, "International Cooking Tools and Equipment (AAL)")],
    ["Cultural Menu using Cultural Tools and Equipment (AFL)", assignment(5679, "Cultural Menu using Cultural Tools and Equipment (AFL)")],
    ["Recipe Research (AFL)", assignment(5680, "Recipe Research (AFL)")],
    ["Discussion on Cuisine (AOL)", assignment(5681, "Discussion on Cuisine (AOL)")],
    ["Food Culture Poster (AOL)", assignment(5682, "Food Culture Poster (AOL)")],
    ["Fusion Food, Food Truck (AOL)", assignment(5683, "Fusion Food, Food Truck (AOL)")],
    ["Unit 3 Observation/Conversation of Student Performance Feedback (Teacher Only)", assignment(5685, "Unit 3 Observation/Conversation of Student Performance Feedback (Teacher Only)")],
  ],
  4: [
    ["Unit 4-Learning Log - AAL", assignment(5686, "Unit 4-Learning Log - AAL")],
    ["What is on the Canadian Table (AAL)", assignment(5687, "What is on the Canadian Table (AAL)")],
    ["Canadian Nutrition Worksheet (AAL)", assignment(5689, "Canadian Nutrition Worksheet (AAL)")],
    ["Micronutrients (AAL)", assignment(5690, "Micronutrients (AAL)")],
    ["A Rose By No Other Name (AFL)", assignment(5691, "A Rose By No Other Name (AFL)")],
    ["Uniquely Canadian (AFL)", assignment(5692, "Uniquely Canadian (AFL)")],
    ["What Influences your Food Choices? (AFL)", assignment(5693, "What Influences your Food Choices? (AFL)")],
    ["Kitchen Mathematics (AOL)", assignment(5694, "Kitchen Mathematics (AOL)")],
    ["Canadian Food Project (AOL)", assignment(5695, "Canadian Food Project (AOL)")],
    ["Discussion Canadian Romantic Foods (AOL)", assignment(5696, "Discussion Canadian Romantic Foods (AOL)")],
    ["Unit 4 Observation/Conversation of Student Performance Feedback (Teacher Only)", assignment(5697, "Unit 4 Observation/Conversation of Student Performance Feedback (Teacher Only)")],
  ],
  5: [["CPT- The Great Canadian Cooking Show", assignment(5699, "CPT- The Great Canadian Cooking Show")]],
  6: [
    ["Final Exam", assignment(5700, "Final Exam")],
    ["Final Exam Submission", assignment(5701, "Final Exam Submission")],
  ],
  7: [["Comments - Learning skills Evaluation", assignment(5702, "Comments - Learning skills Evaluation")]],
};

function fileCount(items, extension) {
  return items.filter((item) => item.type === extension || item.path?.toLowerCase().endsWith(`.${extension}`)).length;
}

function unitSummary(lessons) {
  const downloads = lessons.flatMap((lesson) => lesson.downloads || []);
  return {
    downloads: downloads.length,
    ispring: 0,
    docx: fileCount(downloads, "docx") + fileCount(downloads, "doc"),
    pdf: fileCount(downloads, "pdf"),
    video: downloads.filter((item) => item.role === "video_placeholder" || item.type === "mp4").length,
    h5p: 0,
  };
}

function existingLocalCourseDownloads(manifest) {
  return (manifest.courseDownloads || []).filter((item) => item.path || item.previewPath);
}

function lessonRecord(unit, lessonNumber, title, downloads) {
  const id = `U${String(unit).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}`;
  return {
    id,
    unit,
    lesson: lessonNumber,
    title,
    path: `lessons/U${String(unit).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}`,
    bookPageCount: 0,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads,
    resourceCounts: {
      downloads: downloads.length,
      moodleActivities: downloads.filter((item) => item.url?.includes("/mod/")).length,
      videoPlaceholders: downloads.filter((item) => item.role === "video_placeholder").length,
    },
  };
}

const manifest = readJson(manifestPath);
const existingUnitPlans = new Map((manifest.units || []).map((unit) => [unit.unit, unit.unitPlan || null]));
const courseDownloads = [
  ...existingLocalCourseDownloads(manifest),
  forum(5645, "Announcements"),
  moodle("assign", 5647, "Course Materials", "course_resource"),
  folder(5648, "HFC3M Unit Plans", "unit_plan_folder"),
  folder(5649, "HFC3M Unit 1 Class Lesson Plans", "lesson_plan_folder"),
];

manifest.generatedAt = scannedAt;
manifest.course = {
  ...(manifest.course || {}),
  code: course,
  title: "HFC3M · Food and Culture",
  audience: "Teachers preparing OSSD lessons",
  source: "Authenticated Moodle course crawl and local OSSD planning files",
};
manifest.navigation = { primary: "unit", secondary: "activity" };
manifest.courseDownloads = courseDownloads;
manifest.texts = manifest.texts || [];
manifest.units = Object.entries(activitiesByUnit).map(([unitKey, specs]) => {
  const unit = Number(unitKey);
  const lessons = specs.map(([title, downloads], index) => lessonRecord(unit, index + 1, title, downloads));
  return {
    unit,
    title: unitTitles[unit],
    coreTexts: [],
    unitPlan: existingUnitPlans.get(unit) || null,
    unitResources: {},
    summary: unitSummary(lessons),
    lessons,
  };
});
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  lessonCount: manifest.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  ispringExpected: 0,
  ispringComplete: 0,
  moodleCourseId: 56,
  moodleCoursePage: "https://www.esunnybrook.com/course/view.php?id=56",
  authenticatedMoodleRescanAt: scannedAt,
  moodleActivityResourceCount: courseDownloads.length + manifest.units.reduce((sum, unit) => sum + unit.summary.downloads, 0),
  externalVideoPlaceholders: Object.keys(oldVideos).length,
  structureNote: "HFC3M is organized as Moodle course sections with assignments, folders, resources, and one Moodle lesson rather than Book-based lesson chapters.",
};

writeJson(manifestPath, manifest);
console.log(JSON.stringify({
  course,
  units: manifest.units.length,
  activityLessons: manifest.sourceAudit.lessonCount,
  courseDownloads: manifest.courseDownloads.length,
  moodleActivityResources: manifest.sourceAudit.moodleActivityResourceCount,
  externalVideoPlaceholders: manifest.sourceAudit.externalVideoPlaceholders,
}, null, 2));
