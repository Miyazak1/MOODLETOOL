import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const moodleIndexPath = join(projectRoot, "public", "moodle-course-resource-index.json");
const deploymentRoadmapPath = join(projectRoot, "deployment", "course-roadmap.json");
const publicRoadmapPath = join(projectRoot, "public", "course-roadmap.json");
const rescanQueuePath = join(projectRoot, "deployment", "moodle-authenticated-rescan-queue.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path) {
  if (!existsSync(path)) fail(`Missing JSON: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function stripGeneratedAt(value) {
  return JSON.stringify({ ...value, generatedAt: "<ignored>" });
}

const catalog = readJson(catalogPath);
const moodleIndex = readJson(moodleIndexPath);
const deploymentRoadmap = readJson(deploymentRoadmapPath);
const publicRoadmap = readJson(publicRoadmapPath);
const rescanQueue = readJson(rescanQueuePath);
const errors = [];

if (deploymentRoadmap.schemaVersion !== 1) errors.push(`Unexpected deployment roadmap schemaVersion: ${deploymentRoadmap.schemaVersion}`);
if (publicRoadmap.schemaVersion !== 1) errors.push(`Unexpected public roadmap schemaVersion: ${publicRoadmap.schemaVersion}`);
if (stripGeneratedAt(deploymentRoadmap) !== stripGeneratedAt(publicRoadmap)) {
  errors.push("Public and deployment course roadmaps differ.");
}

const catalogCourses = catalog.courses || [];
const roadmapCourses = deploymentRoadmap.courses || [];
const roadmapByCourse = new Map(roadmapCourses.map((course) => [course.course, course]));
const catalogCodes = new Set(catalogCourses.map((course) => course.code));
const moodleCodes = new Set((moodleIndex.courses || []).map((course) => course.course));

if (deploymentRoadmap.totals?.portalCourses !== catalogCourses.length) errors.push("Roadmap portalCourses total does not match catalog.");
if (deploymentRoadmap.totals?.moodleIndexedCourses !== (moodleIndex.courses || []).length) errors.push("Roadmap moodleIndexedCourses total does not match Moodle index.");
if (roadmapCourses.length !== catalogCourses.length) errors.push("Roadmap course count does not match catalog.");
if (deploymentRoadmap.totals?.readyOutlines !== moodleIndex.totals?.readyOutlines) errors.push("Roadmap readyOutlines total does not match Moodle index.");
if (deploymentRoadmap.totals?.needsUrlOutlines !== moodleIndex.totals?.needsUrl) errors.push("Roadmap needsUrlOutlines total does not match Moodle index.");
if (deploymentRoadmap.totals?.moodleBooks !== moodleIndex.totals?.lessonBooks) errors.push("Roadmap moodleBooks total does not match Moodle index.");

for (const course of catalogCourses) {
  const roadmap = roadmapByCourse.get(course.code);
  if (!roadmap) {
    errors.push(`Missing roadmap course row: ${course.code}`);
    continue;
  }
  if (!moodleCodes.has(course.code)) errors.push(`${course.code} is missing from Moodle index.`);
  if (roadmap.status !== (course.status || "draft")) errors.push(`${course.code} roadmap status does not match catalog.`);
  if (!roadmap.phase) errors.push(`${course.code} roadmap phase is missing.`);
  if (!Number.isFinite(Number(roadmap.priority))) errors.push(`${course.code} roadmap priority is invalid.`);
  if (!Array.isArray(roadmap.nextActions) || roadmap.nextActions.length === 0) errors.push(`${course.code} roadmap nextActions are missing.`);
  if (!roadmap.moodle || typeof roadmap.moodle !== "object") errors.push(`${course.code} roadmap moodle block is missing.`);
  if (!roadmap.readiness || typeof roadmap.readiness !== "object") errors.push(`${course.code} roadmap readiness block is missing.`);
  if (!roadmap.queue || typeof roadmap.queue !== "object") errors.push(`${course.code} roadmap queue block is missing.`);
  if (!roadmap.localEvidence || typeof roadmap.localEvidence !== "object") errors.push(`${course.code} roadmap localEvidence block is missing.`);
  if (!Number.isFinite(Number(roadmap.localEvidence?.courseOutlines))) errors.push(`${course.code} roadmap localEvidence.courseOutlines is invalid.`);
  if (Number(roadmap.localEvidence?.courseOutlines || 0) > 0 && roadmap.readiness?.missingCourseOutline) {
    errors.push(`${course.code} has local outline files but readiness still reports missingCourseOutline.`);
  }
}

for (const course of roadmapCourses) {
  if (!catalogCodes.has(course.course)) errors.push(`Roadmap has course not in catalog: ${course.course}`);
}

const statusCounts = {};
const phaseCounts = {};
for (const course of roadmapCourses) {
  statusCounts[course.status] = (statusCounts[course.status] || 0) + 1;
  phaseCounts[course.phase] = (phaseCounts[course.phase] || 0) + 1;
}
for (const [status, count] of Object.entries(statusCounts)) {
  if (deploymentRoadmap.totals?.byStatus?.[status] !== count) errors.push(`byStatus.${status} total mismatch.`);
}
for (const [phase, count] of Object.entries(phaseCounts)) {
  if (deploymentRoadmap.totals?.byPhase?.[phase] !== count) errors.push(`byPhase.${phase} total mismatch.`);
}
const localCourseOutlines = roadmapCourses.reduce((sum, course) => sum + Number(course.localEvidence?.courseOutlines || 0), 0);
if (deploymentRoadmap.totals?.localCourseOutlines !== localCourseOutlines) errors.push("Roadmap localCourseOutlines total mismatch.");

const rescanCourses = rescanQueue.courses || [];
if ((deploymentRoadmap.authenticatedRescanQueue || []).length !== rescanCourses.length) {
  errors.push("Authenticated rescan queue count mismatch.");
}
for (const item of deploymentRoadmap.authenticatedRescanQueue || []) {
  if (!item.course || !item.coursePage || item.status !== "login-required") errors.push(`Invalid authenticated rescan queue item: ${JSON.stringify(item)}`);
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Course roadmap OK: ${roadmapCourses.length} courses; ${deploymentRoadmap.totals.readyOutlines} ready outlines; ${(deploymentRoadmap.authenticatedRescanQueue || []).length} authenticated rescan candidates.`,
);
