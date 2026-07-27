import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");
const deploymentRoot = resolve(projectRoot, "deployment");
const reportJsonPath = join(deploymentRoot, "document-preview-generation-report.json");
const reportMdPath = join(deploymentRoot, "document-preview-generation-report.md");
const requestedCourse = readArg("--course")?.toUpperCase();
const dryRun = process.argv.includes("--dry-run");
const failFast = process.argv.includes("--fail-fast");
const limit = Number(readArg("--limit") || 0);
const officeExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function relPath(root, path) {
  return toPosix(relative(root, path));
}

function relProject(path) {
  const rel = relative(projectRoot, path);
  return rel.startsWith("..") ? toPosix(path) : toPosix(rel);
}

function isOfficeResource(item) {
  if (!item?.path) return false;
  return officeExtensions.has(extname(item.path).toLowerCase());
}

function collectResources(manifest) {
  const records = [];
  for (const item of manifest.courseDownloads || []) records.push(item);
  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) records.push(item);
  }
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) records.push(unit.unitPlan);
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) records.push(lesson.lessonPlan);
      for (const item of lesson.downloads || []) records.push(item);
      for (const item of lesson.textExports || []) records.push(item);
    }
  }
  return records;
}

function commandWorks(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: "pipe", windowsHide: true });
  return result.status === 0 ? command : null;
}

function findOfficeBinary() {
  const supplied = readArg("--soffice") || process.env.LIBREOFFICE_BIN;
  if (supplied) return supplied;
  return commandWorks("soffice") || commandWorks("libreoffice");
}

async function listCourses() {
  if (requestedCourse) return [requestedCourse];
  const entries = await readdir(coursewareRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.toUpperCase())
    .sort();
}

async function needsRefresh(source, target) {
  if (!existsSync(target)) return true;
  const [sourceStat, targetStat] = await Promise.all([stat(source), stat(target)]);
  return sourceStat.mtimeMs > targetStat.mtimeMs;
}

async function convertToPdf(officeBin, source, target) {
  await mkdir(dirname(target), { recursive: true });
  const outDir = dirname(target);
  const generated = join(outDir, `${basename(source, extname(source))}.pdf`);
  const result = spawnSync(
    officeBin,
    ["--headless", "--convert-to", "pdf", "--outdir", outDir, source],
    { encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 120000 },
  );
  if (result.status !== 0) {
    throw new Error(`LibreOffice failed for ${source}\n${result.stderr || result.stdout}`);
  }
  if (normalize(generated) !== normalize(target) && existsSync(generated)) {
    await rename(generated, target);
  }
  if (!existsSync(target)) {
    throw new Error(`LibreOffice did not create expected PDF: ${target}`);
  }
}

async function processCourse(course, officeBin) {
  const courseRoot = resolve(coursewareRoot, course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  if (!existsSync(manifestPath)) return { course, skipped: true, scanned: 0, converted: 0, unchanged: 0, updated: 0, failed: 0, failures: [] };

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const conversionResults = new Map();
  let converted = 0;
  let unchanged = 0;
  let updated = 0;
  let scanned = 0;
  let failed = 0;
  const failures = [];

  function recordFailure(item, source, target, error) {
    failed += 1;
    const failure = {
      label: item.label || "",
      source: relPath(courseRoot, source),
      target: relPath(courseRoot, target),
      error: error instanceof Error ? error.message : String(error),
    };
    failures.push(failure);
    if (failFast) throw new Error(`${course}: ${failure.source}\n${failure.error}`);
    return failure;
  }

  for (const item of collectResources(manifest)) {
    if (!isOfficeResource(item)) continue;
    scanned += 1;
    if (limit && converted >= limit) break;
    const source = resolve(courseRoot, item.path);
    const target = resolve(courseRoot, "previews", `${item.path.replace(/[\\/]/g, "/")}.pdf`);
    const previewPath = relPath(courseRoot, target);

    if (!existsSync(source)) {
      recordFailure(item, source, target, new Error("Source file is missing."));
      continue;
    }

    let targetReady = false;
    if (await needsRefresh(source, target)) {
      const key = normalize(target);
      if (conversionResults.has(key)) {
        const previous = conversionResults.get(key);
        targetReady = previous.ok;
        if (!previous.ok) recordFailure(item, source, target, new Error(previous.error));
      } else if (dryRun) {
        targetReady = true;
        conversionResults.set(key, { ok: true, dryRun: true });
        converted += 1;
      } else {
        try {
          await convertToPdf(officeBin, source, target);
          targetReady = true;
          conversionResults.set(key, { ok: true });
          converted += 1;
        } catch (error) {
          const failure = recordFailure(item, source, target, error);
          conversionResults.set(key, { ok: false, error: failure.error });
        }
      }
    } else {
      targetReady = true;
      unchanged += 1;
    }

    if (targetReady) {
      if (item.previewPath !== previewPath) {
        if (!dryRun) item.previewPath = previewPath;
        updated += 1;
      }
    } else if (item.previewPath === previewPath) {
      if (!dryRun) delete item.previewPath;
      updated += 1;
    }
  }

  if (updated && !dryRun) {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  return { course, skipped: false, scanned, converted, unchanged, updated, failed, failures };
}

const officeBin = findOfficeBinary() || (dryRun ? "dry-run-no-libreoffice" : null);
if (!officeBin) {
  console.error("LibreOffice/soffice was not found. Install LibreOffice headless or set LIBREOFFICE_BIN.");
  process.exit(1);
}

const courses = await listCourses();
const results = [];
for (const course of courses) {
  results.push(await processCourse(course, officeBin));
}

function renderMarkdown(report) {
  const lines = [
    "# Document Preview Generation Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Dry run: ${report.dryRun ? "yes" : "no"}`,
    `Status: ${report.status}`,
    "",
    "## Summary",
    "",
    "| Item | Count |",
    "| --- | ---: |",
    `| Courses | ${report.results.length} |`,
    `| Office resource entries scanned | ${report.totals.scanned} |`,
    `| PDFs converted | ${report.totals.converted} |`,
    `| Existing previews reused | ${report.totals.unchanged} |`,
    `| Manifest preview refs updated | ${report.totals.updated} |`,
    `| Failed entries | ${report.totals.failed} |`,
    "",
    "## Courses",
    "",
    "| Course | Scanned | Converted | Reused | Manifest Updates | Failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const result of report.results) {
    lines.push(`| ${result.course} | ${result.scanned} | ${result.converted} | ${result.unchanged} | ${result.updated} | ${result.failed} |`);
  }
  const failures = report.results.flatMap((result) => result.failures.map((failure) => ({ course: result.course, ...failure })));
  lines.push("", "## Failures", "");
  if (!failures.length) {
    lines.push("- None");
  } else {
    lines.push("| Course | Source | Target | Error |");
    lines.push("| --- | --- | --- | --- |");
    for (const failure of failures.slice(0, 120)) {
      lines.push(`| ${failure.course} | ${failure.source} | ${failure.target} | ${failure.error.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const totals = results.reduce(
  (sum, result) => ({
    scanned: sum.scanned + (result.scanned || 0),
    converted: sum.converted + (result.converted || 0),
    unchanged: sum.unchanged + (result.unchanged || 0),
    updated: sum.updated + (result.updated || 0),
    failed: sum.failed + (result.failed || 0),
  }),
  { scanned: 0, converted: 0, unchanged: 0, updated: 0, failed: 0 },
);

const report = {
  generatedAt: new Date().toISOString(),
  dryRun,
  requestedCourse,
  officeBin,
  status: totals.failed ? "completed-with-failures" : "ok",
  totals,
  results,
};

await mkdir(deploymentRoot, { recursive: true });
await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(reportMdPath, renderMarkdown(report), "utf8");

for (const result of results) {
  if (result.skipped) {
    console.log(`${result.course}: skipped, no manifest`);
  } else {
    console.log(
      `${result.course}: scanned ${result.scanned}, converted ${result.converted}, reused ${result.unchanged}, manifest preview refs ${result.updated}, failed ${result.failed}`,
    );
  }
}
console.log(`Preview report: ${relProject(reportMdPath)}`);
if (totals.failed && failFast) process.exit(1);
