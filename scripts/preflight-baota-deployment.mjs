import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(process.env.COURSE_ACTIVE_ROOT || join(workspaceRoot, "courseware"));
const courseArchiveRoot = resolve(process.env.COURSE_ARCHIVE_ROOT || join(workspaceRoot, "courseware-archive"));
const deploymentRoot = join(projectRoot, "deployment");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const reportJsonPath = join(deploymentRoot, "baota-preflight-report.json");
const reportMdPath = join(deploymentRoot, "baota-preflight-report.md");

const checks = [];
const warnings = [];
const blockers = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toProjectPath(path) {
  const rel = relative(projectRoot, path);
  return rel.startsWith("..") ? path : rel.replaceAll("\\", "/");
}

function record(status, label, detail = "") {
  checks.push({ status, label, detail });
  if (status === "warning") warnings.push({ label, detail });
  if (status === "blocker") blockers.push({ label, detail });
}

function ok(label, detail = "") {
  record("ok", label, detail);
}

function warn(label, detail = "") {
  record("warning", label, detail);
}

function block(label, detail = "") {
  record("blocker", label, detail);
}

function requireFile(path, label) {
  if (existsSync(path)) {
    ok(label, toProjectPath(path));
    return true;
  }
  block(label, `Missing: ${toProjectPath(path)}`);
  return false;
}

function checkDistAssets() {
  const indexPath = join(projectRoot, "dist", "index.html");
  if (!requireFile(indexPath, "production build output")) return;

  const html = readFileSync(indexPath, "utf8");
  const assetRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => url.startsWith("/assets/"));

  if (!assetRefs.length) {
    block("production asset references", "dist/index.html has no /assets/ references.");
    return;
  }

  const missingAssets = assetRefs
    .map((url) => join(projectRoot, "dist", url.slice(1)))
    .filter((path) => !existsSync(path));

  if (missingAssets.length) {
    block("production asset files", `${missingAssets.length} missing, first: ${toProjectPath(missingAssets[0])}`);
  } else {
    ok("production asset files", `${assetRefs.length} referenced asset(s) exist.`);
  }
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return normalize(join(coursewareRoot, course.manifestUrl.replace(/^\/courseware\/?/i, "")));
}

function localCourseRoot(course) {
  if (!course.baseUrl?.startsWith("/courseware/")) return null;
  return normalize(join(coursewareRoot, course.baseUrl.replace(/^\/courseware\/?/i, "")));
}

function checkRecordPath(courseRoot, item, label, missingPaths, structureErrors, localPathWarnings) {
  if (!item?.path) {
    localPathWarnings.push(`${label} has no local path yet.`);
    return;
  }
  const path = join(courseRoot, item.path);
  if (!existsSync(path)) missingPaths.push(path);
}

function summarizeManifest(course, manifest, courseRoot) {
  const missingPaths = [];
  const structureErrors = [];
  const localPathWarnings = [];
  const units = Array.isArray(manifest.units) ? manifest.units : [];
  const lessons = units.flatMap((unit) => (Array.isArray(unit.lessons) ? unit.lessons : []));
  const courseDownloads = Array.isArray(manifest.courseDownloads) ? manifest.courseDownloads : [];
  const texts = Array.isArray(manifest.texts) ? manifest.texts : [];

  if (manifest.navigation?.primary !== "unit" || manifest.navigation?.secondary !== "lesson") {
    structureErrors.push("navigation must be unit-first with lesson secondary.");
  }
  if (!units.length) structureErrors.push("manifest has no units.");

  for (const item of courseDownloads) checkRecordPath(courseRoot, item, "course download", missingPaths, structureErrors, localPathWarnings);
  for (const text of texts) {
    for (const item of text.materials || []) {
      checkRecordPath(courseRoot, item, `text material ${text.id || text.title || "unknown"}`, missingPaths, structureErrors, localPathWarnings);
    }
  }
  for (const unit of units) {
    if (unit.unitPlan) checkRecordPath(courseRoot, unit.unitPlan, `unit ${unit.unit} plan`, missingPaths, structureErrors, localPathWarnings);
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) checkRecordPath(courseRoot, lesson.lessonPlan, `${lesson.id} lesson plan`, missingPaths, structureErrors, localPathWarnings);
      for (const item of lesson.downloads || []) checkRecordPath(courseRoot, item, `${lesson.id} download`, missingPaths, structureErrors, localPathWarnings);
      for (const item of lesson.textExports || []) checkRecordPath(courseRoot, item, `${lesson.id} text export`, missingPaths, structureErrors, localPathWarnings);
      for (const item of lesson.ispring || []) {
        if (item.mode !== "page") structureErrors.push(`${lesson.id} iSpring entry must use page mode.`);
        if (!item.path || !item.packagePath) {
          structureErrors.push(`${lesson.id} iSpring entry is missing path or packagePath.`);
          continue;
        }
        const pagePath = join(courseRoot, item.path);
        if (!existsSync(pagePath)) missingPaths.push(pagePath);
      }
    }
  }

  return {
    course: course.code,
    units: units.length,
    lessons: lessons.length,
    courseDownloads: courseDownloads.length,
    unitPlans: units.filter((unit) => unit.unitPlan).length,
    lessonPlans: lessons.filter((lesson) => lesson.lessonPlan).length,
    ispringEntries: lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0),
    texts: texts.length,
    missingPaths,
    structureErrors,
    localPathWarnings,
  };
}

function checkCatalogAndCourseware() {
  if (!requireFile(catalogPath, "course catalog")) return [];
  if (!existsSync(coursewareRoot)) {
    block("courseware root", `Missing: ${coursewareRoot}`);
    return [];
  }
  ok("courseware root", coursewareRoot);

  const catalog = readJson(catalogPath);
  if (!Array.isArray(catalog.courses) || !catalog.courses.length) {
    block("catalog courses", "public/course-catalog.json has no courses.");
    return [];
  }
  if (catalog.courses.length < 27) {
    warn("catalog course count", `${catalog.courses.length} course(s) listed; expected current catalog is 27.`);
  } else {
    ok("catalog course count", `${catalog.courses.length} course(s) listed.`);
  }
  if (!catalog.courses.some((course) => course.code === catalog.defaultCourse)) {
    block("default course", `Default course is not in the catalog: ${catalog.defaultCourse}`);
  } else {
    ok("default course", catalog.defaultCourse);
  }

  const summaries = [];
  for (const course of catalog.courses) {
    const manifestPath = localManifestPath(course);
    const courseRoot = localCourseRoot(course);
    if (!manifestPath || !courseRoot) {
      warn(`${course.code} local path`, "Manifest/base URL is not a local /courseware/ path; local validation skipped.");
      continue;
    }
    if (!existsSync(manifestPath)) {
      block(`${course.code} manifest`, `Missing: ${manifestPath}`);
      continue;
    }
    const manifest = readJson(manifestPath);
    const summary = summarizeManifest(course, manifest, courseRoot);
    summaries.push(summary);
    if (summary.structureErrors.length) {
      block(`${course.code} manifest structure`, `${summary.structureErrors.length} issue(s), first: ${summary.structureErrors[0]}`);
    }
    if (summary.missingPaths.length) {
      block(`${course.code} referenced files`, `${summary.missingPaths.length} missing, first: ${summary.missingPaths[0]}`);
    }
    if (summary.localPathWarnings.length) {
      warn(`${course.code} resources pending local files`, `${summary.localPathWarnings.length} item(s), first: ${summary.localPathWarnings[0]}`);
    }
  }

  const invalid = summaries.filter((summary) => summary.structureErrors.length || summary.missingPaths.length);
  if (!invalid.length) ok("course manifests", `${summaries.length} local manifest(s) are valid and all referenced files exist.`);
  return summaries;
}

function checkReadinessReports() {
  const readinessPath = join(deploymentRoot, "course-readiness-summary.json");
  const gapPath = join(deploymentRoot, "upload-gap-checklist.json");
  requireFile(readinessPath, "readiness summary");
  requireFile(gapPath, "upload gap checklist");

  if (!existsSync(readinessPath)) return;
  const readiness = readJson(readinessPath);
  const reports = Array.isArray(readiness.reports) ? readiness.reports : [];
  const courseOutlineGaps = reports.filter((report) => report.gaps?.missingCourseOutline).map((report) => report.course?.code);
  const unitPlanGaps = reports.flatMap((report) => (report.gaps?.missingUnitPlans || []).map((unit) => formatMissingUnit(report, unit)));
  const lessonPlanGaps = reports.flatMap((report) => (report.gaps?.missingLessonPlans || []).map((lesson) => formatMissingLesson(report, lesson)));
  const reviewTextGaps = reports.flatMap((report) => (report.gaps?.textsNeedingReview || []).map((text) => `${report.course?.code} ${text.title}`));
  const ispringNotConnected = reports.filter((report) => report.counts?.ispringEntries === 0).map((report) => report.course?.code);

  if (courseOutlineGaps.length) warn("course outlines still missing", `${courseOutlineGaps.length}: ${courseOutlineGaps.join(", ")}`);
  if (unitPlanGaps.length) warn("unit plans still missing", `${unitPlanGaps.length}: ${unitPlanGaps.join(", ")}`);
  if (lessonPlanGaps.length) warn("lesson plans still missing", `${lessonPlanGaps.length}: ${lessonPlanGaps.slice(0, 12).join(", ")}`);
  if (reviewTextGaps.length) warn("text copyright/title review", `${reviewTextGaps.length}: ${reviewTextGaps.join("; ")}`);
  if (ispringNotConnected.length) warn("iSpring not connected", `${ispringNotConnected.length}: ${ispringNotConnected.join(", ")}`);
  if (!courseOutlineGaps.length && !unitPlanGaps.length && !lessonPlanGaps.length && !reviewTextGaps.length) {
    ok("content readiness gaps", "No outline/plan/text-review gaps listed in readiness summary.");
  }
}

function checkOnlineResourceReport() {
  const onlineReportPath = join(deploymentRoot, "online-resource-readiness.json");
  requireFile(onlineReportPath, "online resource readiness");
  if (!existsSync(onlineReportPath)) return;

  const report = readJson(onlineReportPath);
  const fileIssues = report.totals?.fileIssues || 0;
  const uniqueFileIssues = report.totals?.uniqueFileIssues || fileIssues;
  const previewQueue = report.totals?.previewQueue || 0;
  const ispringIssues = report.totals?.ispringIssues || 0;
  const notes = report.totals?.notes || 0;

  if (fileIssues) {
    warn(
      "online file preview/download gaps",
      `${fileIssues} resource entry issue(s), ${uniqueFileIssues} unique file target(s), ${previewQueue} Office preview(s). See deployment/online-resource-readiness.md.`,
    );
  } else {
    ok("online file preview/download readiness", `${report.totals?.fileResources || 0} file resource(s) checked.`);
  }

  if (ispringIssues) {
    warn("iSpring play/download gaps", `${ispringIssues} iSpring resource(s) need play/download attention. See deployment/online-resource-readiness.md.`);
  } else {
    ok("iSpring play/download readiness", `${report.totals?.ispringResources || 0} iSpring resource(s) checked.`);
  }

  if (notes) {
    warn("online resource review notes", `${notes} resource(s) have informational notes. See deployment/online-resource-readiness.md.`);
  }
}

function checkContentWorkbench() {
  const workbenchPath = join(deploymentRoot, "course-content-workbench.json");
  requireFile(workbenchPath, "course content workbench");
  if (!existsSync(workbenchPath)) return;

  const report = readJson(workbenchPath);
  if (report.totals?.missingCourseOutlines) {
    warn("content workbench course outlines", `${report.totals.missingCourseOutlines} course outline task(s) remain. See deployment/course-content-workbench.md.`);
  }
  if (report.totals?.iSpringMissingCourses) {
    warn("content workbench iSpring", `${report.totals.iSpringMissingCourses} course(s) still need iSpring decisions. See deployment/course-content-workbench.md.`);
  }
  if (!report.totals?.missingCourseOutlines && !report.totals?.iSpringMissingCourses) {
    ok("content workbench", `${report.totals?.ready || 0}/${report.totals?.courses || 0} course(s) ready.`);
  }
}

function checkOfficePreviewQueue() {
  const queuePath = join(deploymentRoot, "office-preview-queue.json");
  requireFile(queuePath, "Office preview queue");
  if (!existsSync(queuePath)) return;
  const report = readJson(queuePath);
  if (report.totals?.previewFiles) {
    warn("Office preview queue", `${report.totals.previewFiles} preview PDF task(s) across ${report.totals.coursesWithPreviewWork || 0} course(s). See deployment/office-preview-queue.md.`);
  } else {
    ok("Office preview queue", "No Office preview tasks.");
  }
}

function checkIspringQueue() {
  const queuePath = join(deploymentRoot, "ispring-package-queue.json");
  requireFile(queuePath, "iSpring package queue");
  if (!existsSync(queuePath)) return;
  const report = readJson(queuePath);
  if (report.totals?.missingLessonZips) {
    warn("iSpring package queue", `${report.totals.missingLessonZips} lesson ZIP task(s), ${report.totals.coursesNeedingLessonStructure || 0} course(s) need lesson structure first. See deployment/ispring-package-queue.md.`);
  } else {
    ok("iSpring package queue", "No missing lesson ZIP tasks.");
  }
}

function formatMissingUnit(report, unit) {
  const code = report.course?.code || "UNKNOWN";
  if (typeof unit === "number" || typeof unit === "string") return `${code} U${unit}`;
  return `${code} U${unit?.unit ?? "?"}${unit?.title ? ` (${unit.title})` : ""}`;
}

function formatMissingLesson(report, lesson) {
  const code = report.course?.code || "UNKNOWN";
  if (typeof lesson === "number" || typeof lesson === "string") return `${code} ${lesson}`;
  const unit = lesson?.unit != null ? `U${lesson.unit}` : "U?";
  const lessonNumber = lesson?.lesson != null ? `L${lesson.lesson}` : "L?";
  return `${code} ${unit}${lessonNumber}${lesson?.title ? ` (${lesson.title})` : ""}`;
}

function checkDeploymentTemplates() {
  const nginxPath = join(deploymentRoot, "nginx-ossd-course-portal.conf");
  const servicePath = join(deploymentRoot, "ossd-course-portal.service");
  const baotaGuidePath = join(deploymentRoot, "BAOTA_DEPLOYMENT.md");
  const adminGuidePath = join(projectRoot, "ADMIN.md");
  const readmePath = join(projectRoot, "README.md");
  const envProdPath = join(projectRoot, ".env.production.example");

  requireFile(nginxPath, "nginx template");
  requireFile(servicePath, "systemd service template");
  requireFile(baotaGuidePath, "Baota deployment guide");
  requireFile(adminGuidePath, "admin guide");
  requireFile(readmePath, "README");
  requireFile(envProdPath, "production env example");

  if (existsSync(envProdPath)) {
    const envProd = readFileSync(envProdPath, "utf8");
    for (const [label, pattern] of [
      ["env portal data root", /PORTAL_DATA_DIR=/],
      ["env course status file", /COURSE_STATUS_FILE=/],
      ["env active course root", /COURSE_ACTIVE_ROOT=/],
      ["env archive course root", /COURSE_ARCHIVE_ROOT=/],
      ["env x-accel courseware prefix", /X_ACCEL_COURSEWARE_PREFIX=\/_protected_courseware\//],
    ]) {
      if (pattern.test(envProd)) ok(label);
      else warn(label, `${label} is not shown in ${toProjectPath(envProdPath)}.`);
    }
  }

  if (existsSync(nginxPath)) {
    const nginx = readFileSync(nginxPath, "utf8");
    if (!/client_max_body_size\s+(?:[2-9]\d{3,}|[4-9]\d{2,})m/i.test(nginx)) {
      warn("nginx upload size", "client_max_body_size should allow large iSpring ZIP uploads, recommended 4096m.");
    } else {
      ok("nginx upload size", "client_max_body_size is configured for large uploads.");
    }
    for (const [label, pattern] of [
      ["nginx internal courseware location", /location\s+\/_protected_courseware\/[\s\S]+internal\s*;/i],
      ["nginx internal courseware alias", /location\s+\/_protected_courseware\/[\s\S]+alias\s+\/www\/wwwroot\/ossd-portal\/courseware-active\//i],
      ["nginx proxies public courseware URLs", /location\s+\/courseware\/[\s\S]+proxy_pass\s+http:\/\/127\.0\.0\.1:8891/i],
      ["nginx proxies Node app", /proxy_pass\s+http:\/\/127\.0\.0\.1:8891/i],
      ["nginx disables autoindex", /autoindex\s+off/i],
    ]) {
      if (pattern.test(nginx)) ok(label);
      else block(label, `${label} is missing from ${toProjectPath(nginxPath)}.`);
    }
  }

  if (existsSync(servicePath)) {
    const service = readFileSync(servicePath, "utf8");
    for (const [label, pattern] of [
      ["service working directory", /WorkingDirectory=/],
      ["service start command", /ExecStart=.*scripts\/start-production\.mjs.*--env\s+\.env\.production.*--root\s+dist.*--port\s+8891/],
      ["service production env check note", /check:production-env/],
      ["service production mode", /NODE_ENV=production/],
    ]) {
      if (pattern.test(service)) ok(label);
      else warn(label, `${label} is not shown in ${toProjectPath(servicePath)}.`);
    }
  }
}

function checkPackageScripts() {
  const packagePath = join(projectRoot, "package.json");
  if (!requireFile(packagePath, "package.json")) return;
  const pkg = readJson(packagePath);
  for (const script of [
    "build",
    "start",
    "start:production",
    "verify:release",
    "validate:manifest",
    "audit:readiness",
    "audit:online-resources",
    "audit:content-workbench",
    "export:preview-queue",
    "export:ispring-queue",
    "export:gap-checklist",
    "prepare:launch-transfer",
    "prepare:launch-status",
    "preflight:baota",
    "archive:course",
    "activate:course",
    "smoke:course-lifecycle",
    "backup:courseware",
    "verify:backup",
    "restore:backup",
    "smoke:restore-backup",
    "package:baota",
    "check:production-env",
    "generate:production-env",
    "check:launch-courses",
    "smoke:package-baota",
    "smoke:production-env",
    "smoke:generate-production-env",
    "smoke:start-production",
    "smoke:deployed-site",
    "smoke:login-rate-limit",
    "smoke:prepare-launch-status",
  ]) {
    if (pkg.scripts?.[script]) ok(`npm script ${script}`);
    else block(`npm script ${script}`, `Missing package.json script: ${script}`);
  }
}

function checkCoursewareSize() {
  if (!existsSync(coursewareRoot)) return;
  let total = 0;
  const stack = [coursewareRoot];
  while (stack.length) {
    const current = stack.pop();
    let stats;
    try {
      stats = statSync(current);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else {
      total += stats.size;
    }
  }
  const sizeMb = Math.round((total / 1024 / 1024) * 10) / 10;
  ok("local courseware size", `${sizeMb} MB currently in ${coursewareRoot}.`);
  if (total > 55 * 1024 * 1024 * 1024) {
    warn("data disk headroom", "Local courseware is already over 55 GB; use a data disk larger than 60 GB.");
  }
  if (existsSync(courseArchiveRoot)) {
    ok("course archive root", courseArchiveRoot);
  } else {
    warn("course archive root", `Archive root does not exist yet: ${courseArchiveRoot}`);
  }
}

function renderMarkdown(report) {
  const lines = [
    "# Baota Preflight Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    "",
    "## Summary",
    "",
    `- Checks: ${report.totals.checks}`,
    `- OK: ${report.totals.ok}`,
    `- Warnings: ${report.totals.warnings}`,
    `- Blockers: ${report.totals.blockers}`,
    "",
  ];

  if (report.blockers.length) {
    lines.push("## Blockers", "");
    for (const item of report.blockers) lines.push(`- ${item.label}: ${item.detail}`);
    lines.push("");
  }
  if (report.warnings.length) {
    lines.push("## Warnings", "");
    for (const item of report.warnings) lines.push(`- ${item.label}: ${item.detail}`);
    lines.push("");
  }

  lines.push("## Course Manifest Snapshot", "");
  lines.push("| Course | Units | Lessons | Unit Plans | Lesson Plans | iSpring | Texts |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const summary of report.manifestSummaries) {
    lines.push(`| ${summary.course} | ${summary.units} | ${summary.lessons} | ${summary.unitPlans} | ${summary.lessonPlans} | ${summary.ispringEntries} | ${summary.texts} |`);
  }
  lines.push("");
  lines.push("## Checks", "");
  for (const check of report.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.label}${check.detail ? `: ${check.detail}` : ""}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

mkdirSync(deploymentRoot, { recursive: true });
checkPackageScripts();
checkDistAssets();
const manifestSummaries = checkCatalogAndCourseware();
checkReadinessReports();
checkOnlineResourceReport();
checkContentWorkbench();
checkOfficePreviewQueue();
checkIspringQueue();
checkDeploymentTemplates();
checkCoursewareSize();

const report = {
  generatedAt: new Date().toISOString(),
  status: blockers.length ? "blocked" : warnings.length ? "ready-with-warnings" : "ready",
  projectRoot,
  coursewareRoot,
  courseArchiveRoot,
  totals: {
    checks: checks.length,
    ok: checks.filter((check) => check.status === "ok").length,
    warnings: warnings.length,
    blockers: blockers.length,
  },
  blockers,
  warnings,
  manifestSummaries: manifestSummaries.map((summary) => ({
    ...summary,
    missingPaths: summary.missingPaths.slice(0, 20),
    structureErrors: summary.structureErrors.slice(0, 20),
    localPathWarnings: summary.localPathWarnings.slice(0, 20),
  })),
  checks,
};

writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(reportMdPath, renderMarkdown(report), "utf8");

for (const check of checks) {
  const prefix = check.status === "ok" ? "OK" : check.status === "warning" ? "WARN" : "BLOCK";
  console.log(`${prefix}: ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
}
console.log(`\nBaota preflight report: ${toProjectPath(reportMdPath)}`);
console.log(`Status: ${report.status}; blockers: ${blockers.length}; warnings: ${warnings.length}`);

if (blockers.length) process.exit(1);
