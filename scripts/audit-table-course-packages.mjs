import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { selectedTableCourses, skippedTableCourseRows } from "./lib/table-course-scope.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");
const packagesRoot = resolve(projectRoot, "deployment", "course-packages");

const ignoredDirs = new Set([
  "_backups",
  "_backup",
  ".git",
  "node_modules",
]);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function listPackages(course) {
  if (!existsSync(packagesRoot)) return [];
  const prefix = `${course}-`;
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.toUpperCase().startsWith(prefix))
    .filter((entry) => /\.zip$/i.test(entry.name))
    .map((entry) => {
      const path = join(packagesRoot, entry.name);
      const stats = statSync(path);
      return {
        name: entry.name,
        path,
        bytes: stats.size,
        mtimeMs: stats.mtimeMs,
        mtime: stats.mtime.toISOString(),
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function latestSourceMtime(root) {
  let latest = 0;
  let latestPath = "";
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
      const path = join(current, entry.name);
      let stats;
      try {
        stats = statSync(path);
      } catch {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (stats.mtimeMs > latest) {
        latest = stats.mtimeMs;
        latestPath = path;
      }
    }
  }
  return latest ? { mtimeMs: latest, mtime: new Date(latest).toISOString(), path: latestPath } : null;
}

function auditCourse(row) {
  const courseRoot = join(coursewareRoot, row.course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  const packages = listPackages(row.course);
  const latestPackage = packages[0] || null;
  const hasManifest = existsSync(manifestPath);
  const latestSource = hasManifest && !hasFlag("--skip-source-scan") ? latestSourceMtime(courseRoot) : null;
  const stale = Boolean(latestPackage && latestSource && latestSource.mtimeMs > latestPackage.mtimeMs);
  const status = !hasManifest
    ? "missing-course"
    : !latestPackage
      ? "missing-package"
      : stale
        ? "stale-package"
        : "current";
  return {
    course: row.course,
    checked: row.checked,
    status,
    hasManifest,
    courseRoot,
    manifestPath,
    packageCount: packages.length,
    latestPackage,
    latestSource,
  };
}

function markdown(report) {
  const lines = [];
  lines.push("# Table Course Package Audit");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Packages root: ${report.packagesRoot}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Courses: ${report.summary.courses}`);
  lines.push(`- Current: ${report.summary.current}`);
  lines.push(`- Stale package: ${report.summary.stalePackage}`);
  lines.push(`- Missing package: ${report.summary.missingPackage}`);
  lines.push(`- Missing local course: ${report.summary.missingCourse}`);
  lines.push(`- Skipped: ${report.skipped.map((row) => row.course).join(", ") || "none"}`);
  lines.push("");
  lines.push("| Course | Status | Package | Package Time | Latest Course File | Latest Course Time |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of report.courses) {
    const relSource = row.latestSource?.path ? row.latestSource.path.replace(`${coursewareRoot}\\`, "").replaceAll("\\", "/") : "";
    lines.push(`| ${row.course} | ${row.status} | ${row.latestPackage?.name || "-"} | ${row.latestPackage?.mtime || "-"} | ${relSource || "-"} | ${row.latestSource?.mtime || "-"} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const rows = selectedTableCourses().map(auditCourse);
const report = {
  generatedAt: new Date().toISOString(),
  source: "C:/Users/Administrator/Desktop/洛阳一中教材列表.xlsx",
  coursewareRoot,
  packagesRoot,
  skipped: skippedTableCourseRows(),
  summary: {
    courses: rows.length,
    current: rows.filter((row) => row.status === "current").length,
    stalePackage: rows.filter((row) => row.status === "stale-package").length,
    missingPackage: rows.filter((row) => row.status === "missing-package").length,
    missingCourse: rows.filter((row) => row.status === "missing-course").length,
  },
  courses: rows,
};

const jsonMode = hasFlag("--json");
const outPath = readArg("--out");
const mdOutPath = readArg("--md-out");

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
  for (const row of rows) {
    const sourceNote = row.latestSource && row.latestPackage
      ? `; latest source ${row.latestSource.mtime}`
      : "";
    console.log(`${row.status.toUpperCase()} ${row.course}: ${row.latestPackage?.name || "no zip"}${sourceNote}`);
  }
  console.log(`\nTABLE_PACKAGE_NEEDS_REBUILD=${report.summary.stalePackage + report.summary.missingPackage + report.summary.missingCourse}`);
  if (report.skipped.length) console.log(`Skipped by default: ${report.skipped.map((row) => row.course).join(", ")}`);
}

process.exit(report.summary.stalePackage || report.summary.missingPackage || report.summary.missingCourse ? 1 : 0);
