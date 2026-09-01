import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");
const outPath = resolve(projectRoot, "deployment", "qa-all-courses.json");
const mdOutPath = resolve(projectRoot, "deployment", "qa-all-courses.md");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function listCourses() {
  const requested = (readArg("--courses") || "")
    .split(",")
    .map(safeCourse)
    .filter(Boolean);
  const excluded = new Set(
    (readArg("--exclude-courses") || readArg("--exclude") || "")
      .split(",")
      .map(safeCourse)
      .filter(Boolean),
  );
  if (requested.length) return requested.filter((course) => !excluded.has(course));

  return readdirSync(coursewareRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^[A-Z]{3,4}\d[A-Z]?$/.test(name))
    .filter((name) => !excluded.has(name))
    .filter((name) => existsSync(join(coursewareRoot, name, "course-manifest.json")))
    .sort();
}

function runJsonScript(script, course, courseArg = "--course") {
  const result = spawnSync(process.execPath, [join(projectRoot, "scripts", script), courseArg, course, "--json"], {
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

function summarizeCourse(course, courseQa, structureQa, displayQa) {
  const courseSummary = courseQa.report?.summary || {};
  const structureSummary = structureQa.report?.summary || {};
  const displaySummary = displayQa.report?.summary || {};
  const displayStatus = displaySummary.status
    || (displaySummary.errors ? "fail" : displaySummary.warnings ? "review" : displayQa.ok ? "pass" : "error");
  return {
    course,
    status: courseSummary.errors || structureSummary.errors || displaySummary.errors || !courseQa.ok || !structureQa.ok || !displayQa.ok
      ? "fail"
      : courseSummary.warnings || structureSummary.warnings || displaySummary.warnings
        ? "review"
        : "pass",
    courseQa: {
      ok: courseQa.ok,
      exitCode: courseQa.exitCode,
      status: courseSummary.status || "error",
      errors: courseSummary.errors ?? null,
      warnings: courseSummary.warnings ?? null,
      issues: courseQa.report?.issues || [],
      stderr: courseQa.stderr,
      stdout: courseQa.stdout,
    },
    structureQa: {
      ok: structureQa.ok,
      exitCode: structureQa.exitCode,
      status: structureSummary.status || "error",
      errors: structureSummary.errors ?? null,
      warnings: structureSummary.warnings ?? null,
      issues: structureQa.report?.issues || [],
      stderr: structureQa.stderr,
      stdout: structureQa.stdout,
    },
    displayQa: {
      ok: displayQa.ok,
      exitCode: displayQa.exitCode,
      status: displayStatus,
      errors: displaySummary.errors ?? null,
      warnings: displaySummary.warnings ?? null,
      issues: displayQa.report?.courses?.[0]?.issues || displayQa.report?.issues || [],
      stderr: displayQa.stderr,
      stdout: displayQa.stdout,
    },
  };
}

function issuePreview(row, limit = 6) {
  return [...(row.courseQa.issues || []), ...(row.structureQa.issues || []), ...(row.displayQa.issues || [])]
    .slice(0, limit)
    .map((issue) => {
      const context = issue.context || {};
      const where = [context.unit ? `U${context.unit}` : "", context.lesson ? `L${context.lesson}` : "", context.sectionLabel || context.section || ""]
        .filter(Boolean)
        .join(" ");
      return `${issue.rule}${where ? ` ${where}` : ""}`;
    });
}

function markdown(report) {
  const lines = [];
  lines.push("# All Course QA");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Courses: ${report.summary.courses}`);
  lines.push(`- Pass: ${report.summary.pass}`);
  lines.push(`- Review: ${report.summary.review}`);
  lines.push(`- Fail: ${report.summary.fail}`);
  lines.push("");
  lines.push("| Course | Status | Course QA | Structure QA | Display QA | Notes |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of report.courses) {
    const notes = issuePreview(row).join("; ").replaceAll("|", "\\|");
    lines.push(`| ${row.course} | ${row.status.toUpperCase()} | ${row.courseQa.status} (${row.courseQa.errors ?? "?"}E/${row.courseQa.warnings ?? "?"}W) | ${row.structureQa.status} (${row.structureQa.errors ?? "?"}E/${row.structureQa.warnings ?? "?"}W) | ${row.displayQa.status} (${row.displayQa.errors ?? "?"}E/${row.displayQa.warnings ?? "?"}W) | ${notes} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const courses = listCourses();
const rows = [];
for (const course of courses) {
  const courseQa = runJsonScript("qa-course.mjs", course);
  const structureQa = runJsonScript("review-course-structure.mjs", course);
  const displayQa = runJsonScript("review-page-display-regression.mjs", course, "--courses");
  rows.push(summarizeCourse(course, courseQa, structureQa, displayQa));
  if (!hasFlag("--quiet")) {
    const row = rows.at(-1);
    console.log(`${row.status.toUpperCase()} ${course}: course ${row.courseQa.errors ?? "?"}E/${row.courseQa.warnings ?? "?"}W; structure ${row.structureQa.errors ?? "?"}E/${row.structureQa.warnings ?? "?"}W; display ${row.displayQa.errors ?? "?"}E/${row.displayQa.warnings ?? "?"}W`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  coursewareRoot,
  summary: {
    courses: rows.length,
    pass: rows.filter((row) => row.status === "pass").length,
    review: rows.filter((row) => row.status === "review").length,
    fail: rows.filter((row) => row.status === "fail").length,
  },
  courses: rows,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(mdOutPath, markdown(report), "utf8");

console.log(`\nWrote ${outPath}`);
console.log(`Wrote ${mdOutPath}`);
process.exit(report.summary.fail ? 1 : 0);
