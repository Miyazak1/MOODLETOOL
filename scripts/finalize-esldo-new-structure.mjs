import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLDO";
const courseRoot = resolve(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function rel(path) {
  return toPosix(relative(courseRoot, path));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileRecord(label, absolutePath, role, category) {
  const path = rel(absolutePath);
  const previewPath = `previews-html/${path}.html`;
  const record = {
    label,
    type: extname(absolutePath).slice(1).toLowerCase(),
    category,
    role,
    path,
    bytes: statSync(absolutePath).size,
    source: "local OSSD planning file",
  };
  if (existsSync(join(courseRoot, previewPath))) record.previewPath = previewPath;
  return record;
}

function cloneResource(item, overrides = {}) {
  return JSON.parse(JSON.stringify({ ...item, ...overrides }));
}

function hasPath(item) {
  return Boolean(item?.path || item?.previewPath || item?.downloadPath);
}

function uniqueByPath(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items.filter(hasPath)) {
    const key = toPosix(item.path || item.previewPath || item.downloadPath).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function planPath(unitNumber, name) {
  return join(courseRoot, "plans", "source", `UNIT ${unitNumber}`, name);
}

function collectDownloads(unit, predicate) {
  const items = [];
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.downloads || []) {
      if (predicate(item, lesson)) items.push(item);
    }
  }
  return uniqueByPath(items);
}

if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
const missingPlans = [];
const unitPlans = [];
const lessonPlans = [];
const reflectionResources = [];
const answerKeyResources = [];

for (const unit of manifest.units || []) {
  const unitPlanPath = planPath(unit.unit, `Unit ${unit.unit} Plan UPDATED.docx`);
  if (existsSync(unitPlanPath)) {
    unit.unitPlan = fileRecord(`Unit Plan - Unit ${unit.unit}`, unitPlanPath, "unit_plan", "unit_plan");
    unitPlans.push(unit.unitPlan);
  } else {
    unit.unitPlan = null;
    missingPlans.push(`Unit ${unit.unit} Plan UPDATED.docx`);
  }

  for (const lesson of unit.lessons || []) {
    const lessonPlanPath = planPath(unit.unit, `Unit ${unit.unit} Lesson ${lesson.lesson}.docx`);
    if (existsSync(lessonPlanPath)) {
      lesson.lessonPlan = fileRecord(
        `Lesson Plan - Unit ${unit.unit} Lesson ${lesson.lesson}`,
        lessonPlanPath,
        "lesson_plan",
        "lesson_plan",
      );
      lessonPlans.push(lesson.lessonPlan);
      lesson.resourceCounts = {
        ...(lesson.resourceCounts || {}),
        lessonPlan: 1,
      };
    } else {
      lesson.lessonPlan = null;
      missingPlans.push(`Unit ${unit.unit} Lesson ${lesson.lesson}.docx`);
    }
  }

  const reflections = collectDownloads(unit, (item) => /(?:\bKWL\b|End[- ]of[- ]Unit[- ]Reflection)/i.test(`${item.label || ""} ${item.path || ""}`))
    .map((item) => cloneResource(item, { category: item.category || "moodle_book_attachment", role: "reflection_log", unit: unit.unit }));
  if (reflections.length) {
    unit.unitResources = {
      ...(unit.unitResources || {}),
      reflectionAndLogs: reflections,
    };
    reflectionResources.push(...reflections);
  } else {
    unit.unitResources = { ...(unit.unitResources || {}) };
    delete unit.unitResources.reflectionAndLogs;
  }

  const answers = collectDownloads(unit, (item) => /(?:Answer[- ]?key|Answers?|Solutions?)/i.test(`${item.label || ""} ${item.path || ""}`))
    .map((item) => cloneResource(item, { category: "answer_key", role: "answer_keys", teacherUse: "answer_key_reference", unit: unit.unit }));
  if (answers.length) {
    unit.unitResources = {
      ...(unit.unitResources || {}),
      evaluations: answers,
    };
    answerKeyResources.push(...answers);
  } else if (unit.unitResources) {
    delete unit.unitResources.evaluations;
  }
}

manifest.teacherResources = [];

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  newStructureFinalizedAt: new Date().toISOString(),
  planningFilesAttached: {
    unitPlans: unitPlans.length,
    lessonPlans: lessonPlans.length,
    missing: missingPlans,
  },
  localizedUnitResourceIndex: {
    reflectionAndLogs: reflectionResources.length,
    answerKeys: answerKeyResources.length,
    note: "Unit resource indexes are generated only from existing Moodle/localized files whose labels identify KWL, end-of-unit reflection, answer key, answers, or solutions.",
  },
  teacherPacketVerified: {
    present: false,
    courseId: 74,
    note: "Moodle course id 74 did not expose a separate Teacher Packet section/activity. Answer and solution files stay inside the corresponding Unit resource indexes only.",
  },
};

manifest.generatedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course,
  unitPlans: unitPlans.length,
  lessonPlans: lessonPlans.length,
  missingPlans,
  reflectionAndLogs: reflectionResources.length,
  answerKeys: answerKeyResources.length,
  teacherResources: manifest.teacherResources.length,
}, null, 2));
