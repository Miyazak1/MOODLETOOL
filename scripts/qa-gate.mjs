import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");

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

function runQaStep(name, script, args) {
  const result = spawnSync(process.execPath, [script, ...args, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024 * 80,
  });
  const report = parseJsonFromStdout(result.stdout);
  const status = report?.summary?.status || (result.status === 0 ? "pass" : "fail");
  return {
    name,
    command: ["node", script, ...args, "--json"].join(" "),
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

function gateStatus(steps) {
  if (steps.some((step) => step.status === "fail" || step.exitCode === 2)) return "fail";
  if (steps.some((step) => step.status === "review")) return "review";
  return "pass";
}

function printHuman(report) {
  console.log(`${report.course} QA Gate: ${report.summary.status.toUpperCase()}`);
  for (const step of report.steps) {
    const counts = stepCounts(step);
    console.log(`${step.name}: ${counts.status.toUpperCase()} (errors ${counts.errors}; warnings ${counts.warnings})`);
  }
  if (report.outputPath) console.log(`Report ${report.outputPath}`);
  const failed = report.steps.filter((step) => step.exitCode !== 0 || step.status === "fail");
  for (const step of failed) {
    const issues = step.report?.issues || [];
    if (!issues.length && step.stderr) {
      console.log(`\n${step.name} stderr:\n${step.stderr.trim()}`);
      continue;
    }
    console.log(`\n${step.name} issues:`);
    for (const issue of issues.slice(0, 12)) {
      console.log(`- [${issue.severity}] ${issue.rule}: ${issue.message}`);
    }
    if (issues.length > 12) console.log(`- ... ${issues.length - 12} more`);
  }
}

const course = safeCourse(readArg("--course") || process.argv.find((arg) => /^[A-Za-z]{3,4}\d[A-Za-z]?$/.test(arg)));
const courseRoot = readArg("--course-root");
const zipPath = readArg("--zip");
const useLatestZip = hasFlag("--use-latest-zip");
const url = readArg("--url") || readArg("--base-url");
const username = readArg("--username");
const password = readArg("--password");
const limit = readArg("--limit");
const outPath = readArg("--out") || (course ? resolve(projectRoot, "deployment", `qa-gate-${course}.json`) : "");
const jsonMode = hasFlag("--json");

if (!course && !courseRoot) {
  console.error("Usage: npm run qa:gate -- --course ICS3U [--zip path.zip] [--url https://www.moodletool.work --username USER --password PASS]");
  process.exit(2);
}

const commonArgs = [];
if (course) commonArgs.push("--course", course);
if (courseRoot) commonArgs.push("--course-root", courseRoot);

const steps = [];
steps.push(runQaStep("course", "scripts/qa-course.mjs", [...commonArgs]));

const packageArgs = [...commonArgs];
if (zipPath) packageArgs.push("--zip", zipPath);
else if (!useLatestZip) packageArgs.push("--no-auto-zip");
steps.push(runQaStep("package", "scripts/qa-package.mjs", packageArgs));

if (url) {
  const onlineArgs = [...commonArgs, "--url", url];
  if (username) onlineArgs.push("--username", username);
  if (password) onlineArgs.push("--password", password);
  if (limit) onlineArgs.push("--limit", limit);
  steps.push(runQaStep("online", "scripts/qa-online.mjs", onlineArgs));
} else {
  steps.push({
    name: "online",
    command: "",
    exitCode: 0,
    status: "skipped",
    report: {
      summary: {
        status: "skipped",
        errors: 0,
        warnings: 0,
      },
      issues: [],
    },
    stdout: "",
    stderr: "",
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  course: course || steps[0]?.report?.course || "",
  outputPath: outPath || "",
  summary: {
    status: gateStatus(steps),
    errors: steps.reduce((sum, step) => sum + stepCounts(step).errors, 0),
    warnings: steps.reduce((sum, step) => sum + stepCounts(step).warnings, 0),
  },
  steps: steps.map((step) => ({
    name: step.name,
    command: step.command,
    exitCode: step.exitCode,
    status: step.status,
    summary: stepCounts(step),
    report: step.report,
    stdout: step.stdout,
    stderr: step.stderr,
  })),
};

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (jsonMode) console.log(JSON.stringify(report, null, 2));
else printHuman(report);

process.exit(report.summary.status === "fail" ? 1 : 0);
