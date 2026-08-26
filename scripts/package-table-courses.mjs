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

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function runAudit() {
  const args = ["scripts/audit-table-course-packages.mjs", "--json"];
  for (const flag of ["--checked-only", "--include-bbi2o", "--include-skipped", "--skip-source-scan"]) {
    if (hasFlag(flag)) args.push(flag);
  }
  for (const option of ["--courses", "--course", "--exclude", "--exclude-courses"]) {
    const value = readArg(option);
    if (value) args.push(option, value);
  }
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = parseJsonFromStdout(result.stdout);
  if (!report) {
    throw new Error(`Could not parse table package audit JSON.\n${result.stderr || result.stdout}`);
  }
  return { result, report };
}

function shouldPackage(row) {
  if (hasFlag("--all")) return row.hasManifest;
  return row.status === "missing-package" || row.status === "stale-package";
}

function commandFor(course, options = {}) {
  const args = ["npm", "run", "package:course", "--", "--course", course];
  if (options.keepOldPackages) args.push("--keep-old-packages");
  if (options.skipDisplayQa) args.push("--skip-display-qa");
  if (options.onlineUrl) args.push("--online-url", options.onlineUrl);
  if (options.username) args.push("--username", options.username);
  if (options.password) args.push("--password", options.password);
  return args;
}

function runPackage(course, options) {
  const args = ["scripts/package-course-with-qa.mjs", "--course", course];
  if (options.keepOldPackages) args.push("--keep-old-packages");
  if (options.skipDisplayQa) args.push("--skip-display-qa");
  if (options.onlineUrl) args.push("--online-url", options.onlineUrl);
  if (options.username) args.push("--username", options.username);
  if (options.password) args.push("--password", options.password);
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    course,
    command: ["node", ...args].join(" "),
    exitCode: result.status ?? 1,
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    report: parseJsonFromStdout(result.stdout),
  };
}

function markdown(report) {
  const lines = [];
  lines.push("# Table Course Packaging Plan");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Mode: ${report.apply ? "apply" : "plan-only"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Planned courses: ${report.summary.planned}`);
  lines.push(`- Packaged: ${report.summary.packaged}`);
  lines.push(`- Failed: ${report.summary.failed}`);
  lines.push(`- Limit: ${report.limit || "none"}`);
  lines.push("");
  lines.push("| Course | Reason | Command |");
  lines.push("| --- | --- | --- |");
  for (const row of report.plan) {
    lines.push(`| ${row.course} | ${row.reason} | \`${row.command.join(" ")}\` |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const apply = hasFlag("--apply");
const forceAll = hasFlag("--force-all");
const keepOldPackages = hasFlag("--keep-old-packages");
const skipDisplayQa = hasFlag("--skip-display-qa");
const keepGoing = hasFlag("--keep-going");
const limit = parseInteger(readArg("--limit") || readArg("--max-courses"), 0);
const onlineUrl = readArg("--online-url") || readArg("--url") || "";
const username = readArg("--username") || "";
const password = readArg("--password") || "";
const outPath = readArg("--out");
const mdOutPath = readArg("--md-out");
const jsonMode = hasFlag("--json");

if (apply && !limit && !forceAll) {
  console.error("Refusing to package every stale/missing table course without --limit. Use --limit N, or pass --force-all if you intentionally want to package all candidates.");
  process.exit(2);
}

const { report: auditReport } = runAudit();
const candidates = auditReport.courses.filter(shouldPackage);
const limitedCandidates = limit ? candidates.slice(0, limit) : candidates;
const options = { keepOldPackages, skipDisplayQa, onlineUrl, username, password };
const plan = limitedCandidates.map((row) => ({
  course: row.course,
  reason: row.status,
  command: commandFor(row.course, options),
}));

const results = [];
if (apply) {
  for (const row of plan) {
    if (!jsonMode) console.log(`Packaging ${row.course} (${row.reason})`);
    const result = runPackage(row.course, options);
    results.push(result);
    if (!result.ok && !keepGoing) break;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  apply,
  limit,
  auditSummary: auditReport.summary,
  skipped: auditReport.skipped,
  plan,
  results,
  summary: {
    planned: plan.length,
    packaged: results.filter((row) => row.ok).length,
    failed: results.filter((row) => !row.ok).length,
    remainingAfterLimit: Math.max(0, candidates.length - plan.length),
  },
};

if (outPath) {
  const resolved = resolve(projectRoot, outPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!jsonMode) console.log(`Wrote ${resolved}`);
}
if (mdOutPath) {
  const resolved = resolve(projectRoot, mdOutPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, markdown(report), "utf8");
  if (!jsonMode) console.log(`Wrote ${resolved}`);
}

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nTABLE_PACKAGE_PLAN=${report.summary.planned}`);
  if (!apply) {
    console.log("Plan only. Add --apply to package these courses.");
    for (const row of plan) console.log(`${row.course}: ${row.reason} -> ${row.command.join(" ")}`);
  } else {
    console.log(`Packaged ${report.summary.packaged}; failed ${report.summary.failed}`);
  }
  if (report.summary.remainingAfterLimit) console.log(`Remaining after limit: ${report.summary.remainingAfterLimit}`);
}

process.exit(report.summary.failed ? 1 : 0);
