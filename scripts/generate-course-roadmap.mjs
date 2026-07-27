import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const moodleIndexPath = join(projectRoot, "public", "moodle-course-resource-index.json");
const readinessPath = join(projectRoot, "deployment", "course-readiness-summary.json");
const documentQueuePath = join(projectRoot, "inbox", "moodle-course-document-queue.csv");
const rescanQueuePath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");
const localCoursewareRoot = resolve(projectRoot, "..", "courseware");
const outputJsonPath = join(projectRoot, "deployment", "course-roadmap.json");
const outputMarkdownPath = join(projectRoot, "deployment", "course-roadmap.md");
const publicOutputJsonPath = join(projectRoot, "public", "course-roadmap.json");

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`Missing JSON: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function readCsv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile()) {
        files.push({ name: entry.name, path });
      }
    }
  }
  return files;
}

function localEvidenceForCourse(courseCode) {
  const files = listFiles(join(localCoursewareRoot, courseCode));
  const courseOutlineFiles = files.filter((file) => /(course.*outline|curriculum.*outline|outline)/i.test(file.name));
  const unitPlanFiles = files.filter((file) => /(unit.*plan|unit plan)/i.test(file.name));
  const lessonPlanFiles = files.filter((file) => /(lesson.*plan|lesson plan)/i.test(file.name));
  const ispringFiles = files.filter((file) => /(html5-package|presentation\.html|ispring)/i.test(file.path));
  return {
    courseOutlines: courseOutlineFiles.length,
    unitPlans: unitPlanFiles.length,
    lessonPlans: lessonPlanFiles.length,
    ispringFiles: ispringFiles.length,
    outlineExamples: courseOutlineFiles.slice(0, 3).map((file) => file.name),
  };
}

function hasLocalOutline(localEvidence) {
  return Boolean(localEvidence.courseOutlines);
}

function hasOutlineEvidence(readiness, localEvidence) {
  return Boolean(
    hasLocalOutline(localEvidence) ||
      Number(readiness?.counts?.courseOutlines || 0) > 0 ||
      readiness?.gaps?.missingCourseOutline === false,
  );
}

function actionForCourse(course, moodle, readiness, queueRow, localEvidence) {
  const actions = [];
  const counts = readiness?.counts || {};
  const gaps = readiness?.gaps || {};
  const localOutlineReady = hasLocalOutline(localEvidence);
  const outlineEvidenceReady = hasOutlineEvidence(readiness, localEvidence);

  if (queueRow?.status === "ready" && queueRow.url && !localOutlineReady) {
    actions.push("Download Course Outline into local courseware and rebuild manifest.");
  }
  if (localOutlineReady && moodle?.outlineStatus === "needs-url") {
    actions.push("Reconcile local Course Outline with the Moodle/source index; no new outline download is needed.");
  } else if (localOutlineReady && queueRow?.status === "ready" && queueRow.url) {
    actions.push("Confirm the local Course Outline is linked in the manifest and preview queue.");
  } else if (outlineEvidenceReady && moodle?.outlineStatus === "needs-url") {
    actions.push("Confirm the existing Course Outline evidence in the manifest and source queue.");
  } else if (moodle?.outlineStatus === "needs-url") {
    actions.push("Find or confirm Course Outline source.");
  }
  if (gaps.missingIntroduction) {
    actions.push("Add or generate course introduction.");
  }
  if ((gaps.missingUnitPlans || []).length) {
    actions.push(`Fill ${gaps.missingUnitPlans.length} missing unit plan gap(s).`);
  }
  if ((gaps.missingLessonPlans || []).length) {
    actions.push(`Fill ${gaps.missingLessonPlans.length} missing lesson plan gap(s).`);
  }
  if ((gaps.textsNeedingReview || []).length) {
    actions.push(`Review ${gaps.textsNeedingReview.length} text/material source item(s).`);
  }
  if ((gaps.linkOnlyTexts || []).length) {
    actions.push(`Replace ${gaps.linkOnlyTexts.length} link-only text item(s) with local/approved files when available.`);
  }
  if (course.status === "planning-only" && Number(counts.ispringEntries || 0) === 0) {
    actions.push("Connect iSpring package if the course has one in Moodle/source files.");
  }
  if (course.status === "moodle-shell") {
    actions.push("Convert Moodle shell into a full unit/lesson plan course when planning files are found.");
  }
  if (course.status === "textbook-shell") {
    actions.push("Find Course Outline plus unit/lesson planning files; current portal content is textbook-only.");
  }

  if (!actions.length) actions.push("Maintain current course; no immediate content gap detected.");
  return actions;
}

function phaseForCourse(course, moodle, readiness, localEvidence) {
  if (course.status === "ready") return "ready-maintenance";
  if (course.status === "moodle-shell") return "moodle-shell-fill";
  if (course.status === "textbook-shell") return "textbook-shell-fill";
  if (moodle?.outlineStatus === "needs-url" && !hasOutlineEvidence(readiness, localEvidence)) return "source-discovery";
  if (readiness?.gaps?.missingLessonPlans?.length || readiness?.gaps?.missingUnitPlans?.length) return "planning-gap-fill";
  return "planning-course-enrichment";
}

function priorityForCourse(course, moodle, readiness, queueRow, localEvidence) {
  if (course.status === "ready") return 30;
  if (course.status === "moodle-shell") return 90;
  if (course.status === "textbook-shell") return 82;
  if (queueRow?.status === "ready" && !hasLocalOutline(localEvidence)) return 78;
  if (moodle?.outlineStatus === "needs-url" && !hasOutlineEvidence(readiness, localEvidence)) return 70;
  if (readiness?.gaps?.missingLessonPlans?.length || readiness?.gaps?.missingUnitPlans?.length) return 65;
  return 55;
}

function renderMarkdown(roadmap) {
  const statusRows = Object.entries(roadmap.totals.byStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join("\n");
  const phaseRows = Object.entries(roadmap.totals.byPhase)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([phase, count]) => `| ${phase} | ${count} |`)
    .join("\n");
  const courseRows = roadmap.courses
    .map((item) => `| ${item.priority} | ${item.course} | ${item.status} | ${item.phase} | ${item.moodle.outlineStatus || "none"} | ${item.localEvidence.courseOutlines} | ${item.moodle.bookCount} | ${item.nextActions[0].replace(/\|/g, "\\|")} |`)
    .join("\n");
  const rescanRows = roadmap.authenticatedRescanQueue.length
    ? roadmap.authenticatedRescanQueue
        .map((item) => `| ${item.priority} | ${item.course} | ${item.moodleCourseId} | ${item.category} | ${item.reason.replace(/\|/g, "\\|")} |`)
        .join("\n")
    : "| - | - | - | - | - |";

  return `# Course Roadmap

Generated: ${roadmap.generatedAt}

## Totals

| Item | Count |
| --- | ---: |
| Portal courses | ${roadmap.totals.portalCourses} |
| Moodle-indexed courses | ${roadmap.totals.moodleIndexedCourses} |
| Ready outlines | ${roadmap.totals.readyOutlines} |
| Needs-url outlines | ${roadmap.totals.needsUrlOutlines} |
| Local outline files | ${roadmap.totals.localCourseOutlines} |
| Moodle Books | ${roadmap.totals.moodleBooks} |
| Authenticated rescan candidates | ${roadmap.authenticatedRescanQueue.length} |

## By Status

| Status | Courses |
| --- | ---: |
${statusRows}

## By Phase

| Phase | Courses |
| --- | ---: |
${phaseRows}

## Portal Course Roadmap

| Priority | Course | Status | Phase | Moodle outline | Local outlines | Books | First next action |
| ---: | --- | --- | --- | --- | ---: | ---: | --- |
${courseRows}

## Authenticated Moodle Rescan Queue

These courses should be scanned only after Moodle is logged in inside the Codex in-app browser.

| Priority | Course | Moodle ID | Category | Reason |
| ---: | --- | ---: | --- | --- |
${rescanRows}
`;
}

const catalog = readJson(catalogPath);
const moodleIndex = readJson(moodleIndexPath);
const readinessSummary = readJson(readinessPath);
const documentQueue = readCsv(documentQueuePath);
const rescanQueue = readJson(rescanQueuePath);

const moodleByCourse = new Map((moodleIndex.courses || []).map((item) => [item.course, item]));
const readinessByCourse = new Map((readinessSummary.reports || []).map((item) => [item.course.code, item]));
const queueByCourse = new Map(documentQueue.map((item) => [item.course, item]));
const courses = (catalog.courses || []).map((course) => {
  const moodle = moodleByCourse.get(course.code) || {};
  const readiness = readinessByCourse.get(course.code) || {};
  const queueRow = queueByCourse.get(course.code);
  const localEvidence = localEvidenceForCourse(course.code);
  const phase = phaseForCourse(course, moodle, readiness, localEvidence);
  return {
    course: course.code,
    title: course.title,
    level: course.level || "",
    status: course.status || "draft",
    phase,
    priority: priorityForCourse(course, moodle, readiness, queueRow, localEvidence),
    moodle: {
      coursePage: moodle.coursePage || "",
      outlineStatus: moodle.outlineStatus || "",
      outlineUrl: moodle.outlineUrl || "",
      bookCount: Number(moodle.bookCount || 0),
      numberedLessonCount: Number(moodle.numberedLessonCount || 0),
    },
    readiness: {
      units: Number(readiness.counts?.units || 0),
      lessons: Number(readiness.counts?.lessons || 0),
      unitPlans: Number(readiness.counts?.unitPlans || 0),
      lessonPlans: Number(readiness.counts?.lessonPlans || 0),
      lessonPlanExpected: Number(readiness.counts?.lessonPlanExpected || 0),
      missingCourseOutline: Boolean(readiness.gaps?.missingCourseOutline),
      missingIntroduction: Boolean(readiness.gaps?.missingIntroduction),
      missingUnitPlans: readiness.gaps?.missingUnitPlans?.length || 0,
      missingLessonPlans: readiness.gaps?.missingLessonPlans?.length || 0,
      textsNeedingReview: readiness.gaps?.textsNeedingReview?.length || 0,
      linkOnlyTexts: readiness.gaps?.linkOnlyTexts?.length || 0,
    },
    queue: {
      status: queueRow?.status || "",
      targetFilename: queueRow?.targetFilename || "",
      hasUrl: Boolean(queueRow?.url),
    },
    localEvidence,
    nextActions: actionForCourse(course, moodle, readiness, queueRow, localEvidence),
  };
});

const byStatus = {};
const byPhase = {};
for (const course of courses) {
  byStatus[course.status] = (byStatus[course.status] || 0) + 1;
  byPhase[course.phase] = (byPhase[course.phase] || 0) + 1;
}

const roadmap = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    catalog: "public/course-catalog.json",
    moodleIndex: "public/moodle-course-resource-index.json",
    readinessSummary: "deployment/course-readiness-summary.json",
    documentQueue: "inbox/moodle-course-document-queue.csv",
    authenticatedRescanQueue: "deployment/moodle-authenticated-rescan-queue.json",
  },
  totals: {
    portalCourses: courses.length,
    moodleIndexedCourses: moodleIndex.courses?.length || 0,
    readyOutlines: moodleIndex.totals?.readyOutlines || 0,
    needsUrlOutlines: moodleIndex.totals?.needsUrl || 0,
    localCourseOutlines: courses.reduce((sum, course) => sum + Number(course.localEvidence?.courseOutlines || 0), 0),
    moodleBooks: moodleIndex.totals?.lessonBooks || 0,
    byStatus,
    byPhase,
  },
  courses: courses.sort((a, b) => b.priority - a.priority || a.course.localeCompare(b.course)),
  authenticatedRescanQueue: rescanQueue.courses || [],
};

const missingMoodle = courses.filter((course) => !moodleByCourse.has(course.course)).map((course) => course.course);
const missingReadiness = courses.filter((course) => !readinessByCourse.has(course.course)).map((course) => course.course);
const missingQueue = courses.filter((course) => !queueByCourse.has(course.course)).map((course) => course.course);

if (missingMoodle.length || missingReadiness.length || missingQueue.length) {
  if (missingMoodle.length) console.error(`Missing Moodle index rows: ${missingMoodle.join(", ")}`);
  if (missingReadiness.length) console.error(`Missing readiness rows: ${missingReadiness.join(", ")}`);
  if (missingQueue.length) console.error(`Missing document queue rows: ${missingQueue.join(", ")}`);
  process.exit(1);
}

mkdirSync(dirname(outputJsonPath), { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(roadmap, null, 2)}\n`, "utf8");
writeFileSync(outputMarkdownPath, renderMarkdown(roadmap), "utf8");
writeFileSync(publicOutputJsonPath, `${JSON.stringify(roadmap, null, 2)}\n`, "utf8");

console.log(`Wrote ${outputJsonPath}`);
console.log(`Wrote ${outputMarkdownPath}`);
console.log(`Wrote ${publicOutputJsonPath}`);
console.log(`Course roadmap: ${roadmap.totals.portalCourses} portal courses; ${roadmap.authenticatedRescanQueue.length} authenticated rescan candidates.`);
