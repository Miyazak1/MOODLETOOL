import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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

function runNodeStep(name, script, args, { allowReview = false } = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024 * 100,
  });
  const report = parseJsonFromStdout(result.stdout);
  const status = report?.summary?.status || (result.status === 0 ? "pass" : "fail");
  const ok = result.status === 0 && (allowReview || status !== "review");
  return {
    name,
    startedAt,
    finishedAt: new Date().toISOString(),
    command: ["node", script, ...args].join(" "),
    exitCode: result.status ?? 1,
    ok,
    status,
    report,
    stdout: report ? "" : result.stdout,
    stderr: result.stderr,
  };
}

function listOldPackages(course) {
  if (!existsSync(packagesRoot)) return [];
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
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

function deleteOldPackages(packages) {
  const deleted = [];
  for (const item of packages) {
    rmSync(item.path, { force: true });
    deleted.push(item);
  }
  return deleted;
}

function printHuman(report) {
  console.log(`${report.course} package pipeline: ${report.summary.status.toUpperCase()}`);
  console.log(`Mode ${report.dryRun ? "dry-run" : "apply"}`);
  console.log(`Old packages ${report.oldPackages.length}; ${report.keepOldPackages ? "kept" : report.dryRun ? "would delete" : "deleted"} ${report.summary.plannedDeletePackages}`);
  if (report.package?.zipPath) console.log(`Zip ${report.package.zipPath}`);
  for (const step of report.steps) {
    console.log(`${step.name}: ${step.status.toUpperCase()} (exit ${step.exitCode})`);
  }
  if (report.outputPath) console.log(`Report ${report.outputPath}`);
  for (const step of report.steps.filter((item) => !item.ok && item.status !== "review")) {
    console.log(`\n${step.name} failed:`);
    if (step.stderr) console.log(step.stderr.trim());
    const issues = step.report?.issues || [];
    for (const issue of issues.slice(0, 12)) console.log(`- [${issue.severity}] ${issue.rule}: ${issue.message}`);
    if (issues.length > 12) console.log(`- ... ${issues.length - 12} more`);
  }
}

const course = safeCourse(readArg("--course") || process.argv.find((arg) => /^[A-Za-z]{3,4}\d[A-Za-z]?$/.test(arg)));
const dryRun = hasFlag("--dry-run");
const keepOldPackages = hasFlag("--keep-old-packages");
const jsonMode = hasFlag("--json");
const onlineUrl = readArg("--online-url") || readArg("--url") || readArg("--base-url");
const username = readArg("--username");
const password = readArg("--password");
const limit = readArg("--limit");
const skipDisplayQa = hasFlag("--skip-display-qa");
const outPath = readArg("--out") || (course ? resolve(projectRoot, "deployment", `package-course-${course}.json`) : "");

if (!course) {
  console.error("Usage: npm run package:course -- --course ICS3U [--dry-run] [--skip-display-qa] [--online-url https://www.moodletool.work --username USER --password PASS]");
  process.exit(2);
}

const steps = [];
const startedAt = new Date().toISOString();
const oldPackages = listOldPackages(course);
let plannedDeletePackages = [];
let deletedPackages = [];
let packageResult = null;

try {
  const preCourse = runNodeStep("pre-qa-course", "scripts/qa-course.mjs", ["--course", course, "--json"]);
  steps.push(preCourse);
  if (preCourse.exitCode !== 0 || preCourse.status === "fail") {
    throw new Error("Pre-package course QA failed. Fix course issues before packaging.");
  }

  if (!skipDisplayQa) {
    const preDisplay = runNodeStep("pre-display-qa", "scripts/review-page-display-regression.mjs", ["--courses", course, "--json"]);
    steps.push(preDisplay);
    if (preDisplay.exitCode !== 0 || preDisplay.status === "fail") {
      throw new Error("Pre-package display QA failed. Fix ENG3U shell, playable resource placement, and attachment display issues before packaging.");
    }
  }

  if (!keepOldPackages) {
    plannedDeletePackages = oldPackages;
    deletedPackages = dryRun ? [] : deleteOldPackages(oldPackages);
  }

  if (!dryRun) {
    const packageStep = runNodeStep("package-clean-course", "scripts/package-clean-course.mjs", ["--course", course]);
    steps.push(packageStep);
    if (packageStep.exitCode !== 0) throw new Error("Course packaging failed.");
    packageResult = packageStep.report;
    if (!packageResult?.zipPath) throw new Error("Package script did not return zipPath.");

    const postGateArgs = ["--course", course, "--zip", packageResult.zipPath, "--json"];
    if (onlineUrl) postGateArgs.push("--url", onlineUrl);
    if (username) postGateArgs.push("--username", username);
    if (password) postGateArgs.push("--password", password);
    if (limit) postGateArgs.push("--limit", limit);
    const postGate = runNodeStep("post-qa-gate", "scripts/qa-gate.mjs", postGateArgs);
    steps.push(postGate);
    if (postGate.exitCode !== 0 || postGate.status === "fail") {
      throw new Error("Post-package QA gate failed. Do not upload this package.");
    }
  }

  const failed = steps.some((step) => step.exitCode !== 0 || step.status === "fail");
  const review = steps.some((step) => step.status === "review");
  const report = {
    generatedAt: new Date().toISOString(),
    startedAt,
    course,
    dryRun,
    keepOldPackages,
    outputPath: outPath,
    oldPackages,
    plannedDeletePackages,
    deletedPackages,
    package: packageResult,
    steps,
    summary: {
      status: failed ? "fail" : review ? "review" : "pass",
      oldPackages: oldPackages.length,
      plannedDeletePackages: plannedDeletePackages.length,
      deletedPackages: deletedPackages.length,
      zipPath: packageResult?.zipPath || "",
    },
  };

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (jsonMode) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  process.exit(report.summary.status === "fail" ? 1 : 0);
} catch (error) {
  const report = {
    generatedAt: new Date().toISOString(),
    startedAt,
    course,
    dryRun,
    keepOldPackages,
    outputPath: outPath,
    oldPackages,
    plannedDeletePackages,
    deletedPackages,
    package: packageResult,
    steps,
    summary: {
      status: "fail",
      oldPackages: oldPackages.length,
      plannedDeletePackages: plannedDeletePackages.length,
      deletedPackages: deletedPackages.length,
      zipPath: packageResult?.zipPath || "",
    },
    error: error instanceof Error ? error.message : String(error),
  };
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (jsonMode) console.log(JSON.stringify(report, null, 2));
  else {
    printHuman(report);
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
