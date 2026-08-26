import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { devNull } from "node:os";
import { selectedTableCourses, skippedTableCourseRows } from "./lib/table-course-scope.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function runJsonScript(script, course, courseArg = "--course", extraArgs = []) {
  const result = spawnSync(process.execPath, [join(projectRoot, "scripts", script), courseArg, course, "--json", ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout || "";
  let report = null;
  try {
    report = JSON.parse(stdout);
  } catch {
    report = null;
  }
  return {
    exitCode: result.status ?? 1,
    ok: Boolean(report) && result.status !== 2,
    report,
    stderr: (result.stderr || "").trim(),
    stdout: report ? "" : stdout.trim(),
  };
}

function missingCourse(course) {
  return !existsSync(join(coursewareRoot, course, "course-manifest.json"));
}

function qaStatus(step) {
  const summary = step.report?.summary || {};
  return {
    ok: step.ok,
    exitCode: step.exitCode,
    status: summary.status || (step.ok ? "pass" : "error"),
    errors: summary.errors ?? null,
    warnings: summary.warnings ?? null,
    issues: step.report?.issues || step.report?.courses?.[0]?.issues || [],
    stderr: step.stderr,
    stdout: step.stdout,
  };
}

function summarizeCourse(row) {
  const course = row.course;
  if (missingCourse(course)) {
    return {
      course,
      checked: row.checked,
      status: "fail",
      missing: true,
      courseQa: { status: "missing", errors: 1, warnings: 0, issues: [{ rule: "missing-local-course-manifest" }] },
      structureQa: null,
      displayQa: null,
    };
  }

  const courseQa = qaStatus(runJsonScript("qa-course.mjs", course));
  const structureQa = hasFlag("--skip-structure")
    ? null
    : qaStatus(runJsonScript("review-course-structure.mjs", course, "--course", ["--out", devNull, "--md-out", devNull]));
  const displayQa = hasFlag("--skip-display")
    ? null
    : qaStatus(runJsonScript("review-page-display-regression.mjs", course, "--courses", ["--out", devNull, "--md-out", devNull]));

  const steps = [courseQa, structureQa, displayQa].filter(Boolean);
  const hasErrors = steps.some((step) => (step.errors || 0) > 0 || !step.ok);
  const hasWarnings = steps.some((step) => (step.warnings || 0) > 0 || step.status === "review");
  return {
    course,
    checked: row.checked,
    status: hasErrors ? "fail" : hasWarnings ? "review" : "pass",
    courseQa,
    structureQa,
    displayQa,
  };
}

function issuePreview(row, limit = 6) {
  return [row.courseQa, row.structureQa, row.displayQa]
    .filter(Boolean)
    .flatMap((step) => step.issues || [])
    .slice(0, limit)
    .map((issue) => {
      const context = issue.context || {};
      const where = [context.unit ? `U${context.unit}` : "", context.lesson ? `L${context.lesson}` : "", context.sectionLabel || context.section || ""]
        .filter(Boolean)
        .join(" ");
      return `${issue.rule || "issue"}${where ? ` ${where}` : ""}`;
    });
}

function markdown(report) {
  const lines = [];
  lines.push("# Table Course QA");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Courseware root: ${report.coursewareRoot}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Courses checked: ${report.summary.courses}`);
  lines.push(`- Pass: ${report.summary.pass}`);
  lines.push(`- Review: ${report.summary.review}`);
  lines.push(`- Fail: ${report.summary.fail}`);
  lines.push(`- Skipped: ${report.skipped.map((row) => row.course).join(", ") || "none"}`);
  lines.push("");
  lines.push("| Course | Checked In Sheet | Status | Course QA | Structure QA | Display QA | Notes |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.courses) {
    const notes = issuePreview(row).join("; ").replaceAll("|", "\\|");
    const step = (qa) => qa ? `${qa.status} (${qa.errors ?? "?"}E/${qa.warnings ?? "?"}W)` : "skipped";
    lines.push(`| ${row.course} | ${row.checked ? "yes" : "no"} | ${row.status.toUpperCase()} | ${step(row.courseQa)} | ${step(row.structureQa)} | ${step(row.displayQa)} | ${notes} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const rows = [];
for (const row of selectedTableCourses()) {
  const summary = summarizeCourse(row);
  rows.push(summary);
  if (!hasFlag("--quiet") && !hasFlag("--json")) {
    const step = (qa) => qa ? `${qa.errors ?? "?"}E/${qa.warnings ?? "?"}W` : "skipped";
    console.log(`${summary.status.toUpperCase()} ${summary.course}: course ${step(summary.courseQa)}; structure ${step(summary.structureQa)}; display ${step(summary.displayQa)}`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  source: "C:/Users/Administrator/Desktop/洛阳一中教材列表.xlsx",
  coursewareRoot,
  skipped: skippedTableCourseRows(),
  summary: {
    courses: rows.length,
    pass: rows.filter((row) => row.status === "pass").length,
    review: rows.filter((row) => row.status === "review").length,
    fail: rows.filter((row) => row.status === "fail").length,
  },
  courses: rows,
};

const outPath = readArg("--out");
const mdOutPath = readArg("--md-out");
if (outPath) {
  const resolved = resolve(projectRoot, outPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!hasFlag("--json")) console.log(`Wrote ${resolved}`);
}
if (mdOutPath) {
  const resolved = resolve(projectRoot, mdOutPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, markdown(report), "utf8");
  if (!hasFlag("--json")) console.log(`Wrote ${resolved}`);
}

if (hasFlag("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nTABLE_QA_NON_PASS=${report.summary.review + report.summary.fail}`);
  if (report.skipped.length) {
    console.log(`Skipped by default: ${report.skipped.map((row) => row.course).join(", ")}`);
  }
}

const shouldFailForReview = report.summary.review > 0 && !hasFlag("--allow-review");
process.exit(report.summary.fail || shouldFailForReview ? 1 : 0);
