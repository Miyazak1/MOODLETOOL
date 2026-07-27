import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = safeCourse(readArg("--course"));
const targetRoot = resolve(readArg("--target-root") || join(workspaceRoot, "courseware"));
const archiveRoot = resolve(readArg("--archive-root") || join(workspaceRoot, "courseware-archive"));
const archiveArg = readArg("--archive");
const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

if (!course) {
  console.error("Missing --course COURSE.");
  process.exit(1);
}

const archivePath = archiveArg ? resolve(archiveArg) : findLatestArchive(archiveRoot, course);
const targetCourseRoot = resolve(targetRoot, course);
const tempRoot = resolve(targetRoot, `_activate-${course}-${timestamp}`);
const manifestPath = resolve(targetRoot, `_activate-${course}-${timestamp}.json`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function ensureInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}\\`) &&
    !resolvedCandidate.startsWith(`${resolvedRoot}/`)
  ) {
    throw new Error(`Path escaped allowed root: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function findLatestArchive(root, courseCode) {
  if (!existsSync(root)) return null;
  const candidates = readdirSync(root)
    .filter((name) => name.startsWith(`${courseCode}-`) && (name.endsWith(".zip") || name.endsWith(".tar.gz") || name.endsWith(".tgz")))
    .map((name) => {
      const path = resolve(root, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path || null;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function extractArchive() {
  mkdirSync(tempRoot, { recursive: true });
  run("tar", ["-xf", archivePath, "-C", tempRoot], workspaceRoot);
}

function directoryStats(root) {
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else {
      files += 1;
      bytes += stats.size;
    }
  }
  return { files, bytes };
}

ensureInside(targetRoot, targetCourseRoot);
ensureInside(targetRoot, tempRoot);

if (!archivePath || !existsSync(archivePath)) {
  console.error(`Archive does not exist for ${course}: ${archivePath || "(none found)"}`);
  process.exit(1);
}
if (existsSync(targetCourseRoot) && !force) {
  console.error(`Target course already exists. Use --force only in a controlled restore: ${targetCourseRoot}`);
  process.exit(1);
}

const payload = {
  ok: true,
  dryRun,
  course,
  archivePath,
  archiveBytes: statSync(archivePath).size,
  targetRoot,
  targetCourseRoot,
  force,
  restored: false,
};

try {
  if (!dryRun) {
    rmSync(tempRoot, { recursive: true, force: true });
    extractArchive();
    const extractedCourseRoot = resolve(tempRoot, course);
    if (!existsSync(join(extractedCourseRoot, "course-manifest.json"))) {
      throw new Error(`Extracted archive does not contain ${course}/course-manifest.json.`);
    }
    if (existsSync(targetCourseRoot)) rmSync(targetCourseRoot, { recursive: true, force: true });
    renameSync(extractedCourseRoot, targetCourseRoot);
    rmSync(tempRoot, { recursive: true, force: true });
    payload.restored = true;
    payload.target = directoryStats(targetCourseRoot);
    writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(payload, null, 2));
} catch (error) {
  payload.ok = false;
  payload.error = error instanceof Error ? error.message : String(error);
  rmSync(tempRoot, { recursive: true, force: true });
  if (!dryRun) writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
