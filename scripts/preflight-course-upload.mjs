import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const packagesRoot = resolve(projectRoot, "deployment", "course-packages");

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

function parseJsonFromStdout(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function runStep(name, script, args) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [script, ...args, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024 * 100,
  });
  const report = parseJsonFromStdout(result.stdout);
  const status = report?.summary?.status || (result.status === 0 ? "pass" : "fail");
  return {
    name,
    command: ["node", script, ...args, "--json"].join(" "),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: result.status ?? 1,
    status,
    report,
    stdout: report ? "" : result.stdout,
    stderr: result.stderr,
  };
}

function stepCounts(step) {
  return {
    status: step.status,
    exitCode: step.exitCode,
    errors: step.report?.summary?.errors ?? (step.exitCode ? 1 : 0),
    warnings: step.report?.summary?.warnings ?? 0,
  };
}

function issueRows(step) {
  return (step.report?.issues || []).map((issue) => ({
    step: step.name,
    severity: issue.severity || "error",
    rule: issue.rule || "unknown",
    message: issue.message || "",
    context: issue.context || {},
  }));
}

function issueCategory(rule) {
  if (/legacy|eng3u|shell|wrapper/i.test(rule)) return "ENG3U page shell";
  if (/standalone|playable|h5p|video|ispring|iframe/i.test(rule)) return "Playable resources";
  if (/document|docx|pdf|ppt|attachment/i.test(rule)) return "Document attachment policy";
  if (/missing-local-path|missing-path|zip|package/i.test(rule)) return "Local/package files";
  if (/homework/i.test(rule)) return "Homework pairing";
  if (/thin|placeholder|flow-section|navigation/i.test(rule)) return "Course structure review";
  return "Other";
}

function groupIssues(issues) {
  const grouped = new Map();
  for (const issue of issues) {
    const key = `${issue.severity}:${issueCategory(issue.rule)}:${issue.rule}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(issue);
  }
  return [...grouped.entries()].map(([key, items]) => {
    const [severity, category, rule] = key.split(":");
    return {
      severity,
      category,
      rule,
      count: items.length,
      samples: items.slice(0, 8),
    };
  });
}

function listOldPackages(course) {
  if (!course || !existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.toUpperCase().startsWith(`${course}-COURSE-PACKAGE`) && /\.zip$/i.test(entry.name))
    .map((entry) => {
      const path = join(packagesRoot, entry.name);
      const stats = statSync(path);
      return {
        name: entry.name,
        path,
        bytes: stats.size,
        mtime: stats.mtime.toISOString(),
      };
    })
    .sort((left, right) => right.mtime.localeCompare(left.mtime));
}

function statusFromSteps(steps, allIssues) {
  if (steps.some((step) => step.exitCode === 2 || step.status === "fail") || allIssues.some((issue) => issue.severity === "error")) return "blocked";
  if (steps.some((step) => step.status === "review") || allIssues.some((issue) => issue.severity === "warn")) return "review";
  return "ready";
}

function nextAction(status) {
  if (status === "ready") return "READY_TO_PACKAGE";
  if (status === "review") return "MANUAL_REVIEW_BEFORE_PACKAGE";
  return "FIX_REQUIRED_BEFORE_PACKAGE";
}

function contextLabel(context = {}) {
  return [
    context.unit ? `U${context.unit}` : "",
    context.lesson ? `L${context.lesson}` : "",
    context.section || context.sectionLabel || "",
    context.path || "",
  ]
    .filter(Boolean)
    .join(" ");
}

function markdownReport(report) {
  const lines = [];
  lines.push(`# ${report.course} Upload Preflight`);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Decision: **${report.summary.nextAction}**`);
  lines.push(`Status: **${report.summary.status.toUpperCase()}**`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("| Check | Status | Errors | Warnings | Exit |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const step of report.steps) {
    const counts = stepCounts(step);
    lines.push(`| ${step.name} | ${counts.status.toUpperCase()} | ${counts.errors} | ${counts.warnings} | ${counts.exitCode} |`);
  }
  lines.push("");
  lines.push("## Upload Decision");
  lines.push("");
  if (report.summary.status === "ready") {
    lines.push("- Ready to package/upload. No blocking errors or review warnings were found.");
  } else if (report.summary.status === "review") {
    lines.push("- No blocking errors, but manual review is required before packaging/upload.");
  } else {
    lines.push("- Do not package/upload until blocking errors are fixed.");
  }
  if (report.oldPackages.length) {
    lines.push(`- Existing old packages found: ${report.oldPackages.length}. Delete old course packages before creating a fresh package.`);
  }
  lines.push("");
  lines.push("## Issue Groups");
  lines.push("");
  if (!report.issueGroups.length) {
    lines.push("- None.");
  } else {
    for (const group of report.issueGroups) {
      lines.push(`- [${group.severity.toUpperCase()}] ${group.category} / ${group.rule}: ${group.count}`);
      for (const issue of group.samples.slice(0, 4)) {
        const where = contextLabel(issue.context);
        lines.push(`  - ${where ? `${where}: ` : ""}${issue.message}`);
      }
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printHuman(report) {
  console.log(`${report.course} upload preflight: ${report.summary.status.toUpperCase()}`);
  console.log(`Decision: ${report.summary.nextAction}`);
  for (const step of report.steps) {
    const counts = stepCounts(step);
    console.log(`${step.name}: ${counts.status.toUpperCase()} (errors ${counts.errors}; warnings ${counts.warnings}; exit ${counts.exitCode})`);
  }
  if (report.oldPackages.length) console.log(`Old packages: ${report.oldPackages.length} existing package(s) should be removed before creating a fresh package.`);
  for (const group of report.issueGroups) {
    console.log(`\n[${group.severity.toUpperCase()}] ${group.category} / ${group.rule} (${group.count})`);
    for (const issue of group.samples.slice(0, 6)) {
      const where = contextLabel(issue.context);
      console.log(`- ${where ? `${where}: ` : ""}${issue.message}`);
    }
    if (group.count > 6) console.log(`- ... ${group.count - 6} more`);
  }
  if (report.outputPath) console.log(`\nJSON ${report.outputPath}`);
  if (report.markdownPath) console.log(`Markdown ${report.markdownPath}`);
}

const course = safeCourse(readArg("--course") || process.argv.find((arg) => /^[A-Za-z]{3,4}\d[A-Za-z]?$/.test(arg)));
const courseRoot = readArg("--course-root");
const zipPath = readArg("--zip");
const jsonMode = hasFlag("--json");
const skipDisplayQa = hasFlag("--skip-display-qa");
const outPath = readArg("--out") || (course ? resolve(projectRoot, "deployment", `preflight-${course}.json`) : "");
const mdOutPath = readArg("--md-out") || (course ? resolve(projectRoot, "deployment", `preflight-${course}.md`) : "");

if (!course && !courseRoot) {
  console.error("Usage: npm run preflight:course -- --course ICS3U [--zip deployment/course-packages/ICS3U-course-package.zip] [--skip-display-qa]");
  process.exit(2);
}

const commonArgs = [];
if (course) commonArgs.push("--course", course);
if (courseRoot) commonArgs.push("--course-root", courseRoot);

const steps = [
  runStep("structure", "scripts/review-course-structure.mjs", commonArgs),
  runStep("course", "scripts/qa-course.mjs", commonArgs),
];

if (course && !skipDisplayQa) steps.push(runStep("display", "scripts/review-page-display-regression.mjs", ["--courses", course]));
if (zipPath) steps.push(runStep("package", "scripts/qa-package.mjs", [...commonArgs, "--zip", zipPath]));

const issues = steps.flatMap(issueRows);
const summaryStatus = statusFromSteps(steps, issues);
const report = {
  generatedAt: new Date().toISOString(),
  course: course || steps[0]?.report?.course || "",
  outputPath: outPath,
  markdownPath: mdOutPath,
  summary: {
    status: summaryStatus,
    nextAction: nextAction(summaryStatus),
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warn").length,
    checks: steps.length,
  },
  oldPackages: listOldPackages(course),
  steps: steps.map((step) => ({
    name: step.name,
    command: step.command,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    exitCode: step.exitCode,
    status: step.status,
    summary: stepCounts(step),
    reportPath: step.report?.outputPath || "",
    stdout: step.stdout,
    stderr: step.stderr,
  })),
  issueGroups: groupIssues(issues),
  issues,
};

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
if (mdOutPath) {
  mkdirSync(dirname(mdOutPath), { recursive: true });
  writeFileSync(mdOutPath, markdownReport(report), "utf8");
}

if (jsonMode) console.log(JSON.stringify(report, null, 2));
else printHuman(report);

process.exit(report.summary.status === "blocked" ? 1 : 0);
