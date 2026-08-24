import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(process.env.COURSE_ACTIVE_ROOT || join(workspaceRoot, "courseware"));
const statusPath = resolve(process.env.COURSE_STATUS_FILE || join(projectRoot, "data", "course-status.json"));
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const reportJsonPath = join(projectRoot, "deployment", "launch-readiness-report.json");
const reportMdPath = join(projectRoot, "deployment", "launch-readiness-report.md");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function courseList() {
  const explicit = readArg("--courses") || process.env.LAUNCH_COURSES || "";
  return explicit
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function localManifestPath(courseEntry) {
  if (!courseEntry.manifestUrl?.startsWith("/courseware/")) return null;
  return resolve(coursewareRoot, courseEntry.manifestUrl.replace(/^\/courseware\/?/i, ""));
}

function localCourseRoot(courseEntry) {
  if (!courseEntry.baseUrl?.startsWith("/courseware/")) return null;
  return resolve(coursewareRoot, courseEntry.baseUrl.replace(/^\/courseware\/?/i, ""));
}

function pathLabel(root, path) {
  const rel = relative(root, path);
  return rel.startsWith("..") ? path : rel.replaceAll("\\", "/");
}

function addResourcePaths(courseRoot, item, label, records) {
  if (!item) return;
  for (const key of ["path", "previewPath", "downloadPath", "packagePath"]) {
    if (item[key]) records.push({ label, path: resolve(courseRoot, item[key]), key });
  }
  for (const attachment of item.attachments || []) {
    addResourcePaths(courseRoot, attachment, `${label} attachment: ${attachment.label || attachment.type || "file"}`, records);
  }
  if (!item.path && !item.previewPath && !item.downloadPath && !item.packagePath) {
    records.push({ label, path: null, key: "missing-local-path" });
  }
}

function collectResourcePaths(manifest, courseRoot) {
  const records = [];
  for (const item of manifest.courseDownloads || []) addResourcePaths(courseRoot, item, `course download: ${item.label || item.role || "unknown"}`, records);
  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) addResourcePaths(courseRoot, item, `text: ${text.title || text.id || "unknown"}`, records);
  }
  for (const unit of manifest.units || []) {
    addResourcePaths(courseRoot, unit.unitPlan, `U${unit.unit} unit plan`, records);
    for (const list of Object.values(unit.unitResources || {})) {
      for (const item of Array.isArray(list) ? list : [list]) addResourcePaths(courseRoot, item, `U${unit.unit} unit resource`, records);
    }
    for (const lesson of unit.lessons || []) {
      const lessonLabel = lesson.id || `U${unit.unit}L${lesson.lesson || "?"}`;
      addResourcePaths(courseRoot, lesson.lessonPlan, `${lessonLabel} lesson plan`, records);
      for (const item of lesson.downloads || []) addResourcePaths(courseRoot, item, `${lessonLabel} download: ${item.label || item.role || "unknown"}`, records);
      for (const item of lesson.textExports || []) addResourcePaths(courseRoot, item, `${lessonLabel} text export: ${item.label || item.role || "unknown"}`, records);
      for (const item of lesson.ispring || []) addResourcePaths(courseRoot, item, `${lessonLabel} iSpring: ${item.label || "package"}`, records);
    }
  }
  return records;
}

function countIspringEntries(manifest) {
  const paths = new Set();
  let count = 0;
  function walk(value) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.type === "ispring" || value.category === "ispring" || value.path?.endsWith("/presentation.html")) {
      const key = value.path || value.source || JSON.stringify(value);
      if (!paths.has(key)) {
        paths.add(key);
        count += 1;
      }
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(manifest);
  return count;
}

function bytesForCourse(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else {
      total += stats.size;
    }
  }
  return total;
}

function courseStatus(code) {
  if (!existsSync(statusPath)) return "active";
  const status = readJson(statusPath);
  return status.courses?.[code]?.status || "active";
}

function checkCourse(code, catalog) {
  const blockers = [];
  const warnings = [];
  const entry = (catalog.courses || []).find((item) => String(item.code || "").toUpperCase() === code);
  if (!entry) {
    return { code, status: "blocked", blockers: [`${code} is missing from public/course-catalog.json.`], warnings, metrics: {} };
  }

  const lifecycleStatus = courseStatus(code);
  if (lifecycleStatus !== "active") blockers.push(`${code} lifecycle status is ${lifecycleStatus}; launch courses must be active.`);
  if (entry.status !== "ready") warnings.push(`${code} catalog status is ${entry.status}; expected ready for launch.`);

  const manifestPath = localManifestPath(entry);
  const courseRoot = localCourseRoot(entry);
  if (!manifestPath || !courseRoot) blockers.push(`${code} catalog paths must be local /courseware/ URLs.`);
  if (manifestPath && !existsSync(manifestPath)) blockers.push(`${code} manifest is missing: ${manifestPath}`);
  if (courseRoot && !existsSync(courseRoot)) blockers.push(`${code} course root is missing: ${courseRoot}`);
  if (blockers.length) return { code, status: "blocked", catalogStatus: entry.status, lifecycleStatus, blockers, warnings, metrics: {} };

  const manifest = readJson(manifestPath);
  const units = Array.isArray(manifest.units) ? manifest.units : [];
  const lessons = units.flatMap((unit) => unit.lessons || []);
  const sourceAudit = manifest.sourceAudit || {};
  if (manifest.navigation?.primary !== "unit" || manifest.navigation?.secondary !== "lesson") blockers.push(`${code} navigation must be unit/lesson.`);
  if (!units.length) blockers.push(`${code} has no units.`);
  if (!lessons.length) blockers.push(`${code} has no lessons.`);
  if (sourceAudit.lessonCount && lessons.length < sourceAudit.lessonCount) warnings.push(`${code} has ${lessons.length}/${sourceAudit.lessonCount} lessons in manifest.`);
  if (sourceAudit.ispringExpected && sourceAudit.ispringComplete < sourceAudit.ispringExpected) {
    blockers.push(`${code} iSpring incomplete: ${sourceAudit.ispringComplete}/${sourceAudit.ispringExpected}.`);
  }
  const resourceCoverageClean = sourceAudit.resourceCoverage?.exists
    && sourceAudit.resourceCoverage.missing === 0
    && (sourceAudit.resourceCoverage.uniqueMissing ?? 0) === 0;
  const resourceValidationClean = sourceAudit.resourceValidation?.exists
    && sourceAudit.resourceValidation.failedCount === 0;
  if (sourceAudit.authenticatedResourceFailedFiles && !(resourceCoverageClean && resourceValidationClean)) {
    warnings.push(`${code} source audit records ${sourceAudit.authenticatedResourceFailedFiles} failed authenticated resource file(s).`);
  }

  const pathRecords = collectResourcePaths(manifest, courseRoot);
  const missingPathRecords = pathRecords.filter((record) => !record.path);
  const missingFiles = pathRecords.filter((record) => record.path && !existsSync(record.path));
  if (missingPathRecords.length) warnings.push(`${code} has ${missingPathRecords.length} resource record(s) without a local path.`);
  if (missingFiles.length) blockers.push(`${code} has ${missingFiles.length} referenced local file(s) missing; first: ${pathLabel(courseRoot, missingFiles[0].path)}.`);

  const ispringEntries = countIspringEntries(manifest);
  const localResources = pathRecords.filter((record) => record.path).length;
  const metrics = {
    units: units.length,
    lessons: lessons.length,
    courseDownloads: manifest.courseDownloads?.length || 0,
    texts: manifest.texts?.length || 0,
    ispringEntries,
    localResourcePaths: localResources,
    coursewareBytes: bytesForCourse(courseRoot),
  };
  if (!localResources) blockers.push(`${code} has no local resource paths.`);

  return {
    code,
    title: manifest.course?.title || entry.title,
    status: blockers.length ? "blocked" : warnings.length ? "ready-with-warnings" : "ready",
    catalogStatus: entry.status,
    lifecycleStatus,
    blockers,
    warnings,
    metrics,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Launch Readiness Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Courses: ${report.courses.join(", ")}`,
    `Status: ${report.status}`,
    "",
    "| Course | Status | Units | Lessons | iSpring | Local Paths | Size MB |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of report.results) {
    const sizeMb = item.metrics?.coursewareBytes ? Math.round((item.metrics.coursewareBytes / 1024 / 1024) * 10) / 10 : 0;
    lines.push(`| ${item.code} | ${item.status} | ${item.metrics?.units || 0} | ${item.metrics?.lessons || 0} | ${item.metrics?.ispringEntries || 0} | ${item.metrics?.localResourcePaths || 0} | ${sizeMb} |`);
  }
  lines.push("");
  if (report.blockers.length) {
    lines.push("## Blockers", "");
    for (const item of report.blockers) lines.push(`- ${item.course}: ${item.message}`);
    lines.push("");
  }
  if (report.warnings.length) {
    lines.push("## Warnings", "");
    for (const item of report.warnings) lines.push(`- ${item.course}: ${item.message}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const courses = courseList();
if (!courses.length) {
  console.error("Usage: node scripts/check-launch-courses.mjs --courses ENG3U,ESLEO");
  process.exit(2);
}

const catalog = readJson(catalogPath);
const results = courses.map((code) => checkCourse(code, catalog));
const blockers = results.flatMap((item) => item.blockers.map((message) => ({ course: item.code, message })));
const warnings = results.flatMap((item) => item.warnings.map((message) => ({ course: item.code, message })));
const report = {
  generatedAt: new Date().toISOString(),
  status: blockers.length ? "blocked" : warnings.length ? "ready-with-warnings" : "ready",
  courses,
  coursewareRoot,
  statusPath,
  totals: {
    courses: courses.length,
    ready: results.filter((item) => item.status === "ready").length,
    warnings: warnings.length,
    blockers: blockers.length,
  },
  blockers,
  warnings,
  results,
};

mkdirSync(dirname(reportJsonPath), { recursive: true });
writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(reportMdPath, renderMarkdown(report), "utf8");

if (hasArg("--json")) console.log(JSON.stringify(report, null, 2));
else {
  for (const item of results) {
    console.log(`${item.status.toUpperCase()}: ${item.code} - ${item.metrics?.units || 0} unit(s), ${item.metrics?.lessons || 0} lesson(s), ${item.metrics?.ispringEntries || 0} iSpring.`);
  }
  for (const item of blockers) console.log(`BLOCK: ${item.course} - ${item.message}`);
  for (const item of warnings) console.log(`WARN: ${item.course} - ${item.message}`);
  console.log(`Launch readiness report: deployment/launch-readiness-report.md`);
  console.log(`Status: ${report.status}; blockers: ${blockers.length}; warnings: ${warnings.length}`);
}

if (blockers.length) process.exit(1);
