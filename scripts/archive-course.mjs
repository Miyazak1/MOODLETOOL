import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = safeCourse(readArg("--course"));
const sourceRoot = resolve(readArg("--source-root") || join(workspaceRoot, "courseware"));
const archiveRoot = resolve(readArg("--archive-root") || join(workspaceRoot, "courseware-archive"));
const deleteActive = process.argv.includes("--delete-active");
const dryRun = process.argv.includes("--dry-run");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const extension = readArg("--extension") || (process.platform === "win32" ? "zip" : "tar.gz");

if (!course) {
  console.error("Missing --course COURSE.");
  process.exit(1);
}

const courseRoot = resolve(sourceRoot, course);
const archiveName = `${course}-${timestamp}.${extension.replace(/^\./, "")}`;
const archivePath = resolve(archiveRoot, archiveName);
const manifestPath = `${archivePath}.json`;

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

function directoryStats(root) {
  let files = 0;
  let bytes = 0;
  const keyFiles = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else {
      files += 1;
      bytes += stats.size;
      const rel = relative(root, current).replaceAll("\\", "/");
      if (rel === "course-manifest.json" || rel.endsWith("/presentation.html") || rel.match(/\.(mp4|pdf|docx|h5p)$/i)) {
        keyFiles.push(rel);
      }
    }
  }
  return { files, bytes, keyFiles: keyFiles.slice(0, 200) };
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

function createArchive() {
  mkdirSync(archiveRoot, { recursive: true });
  if (existsSync(archivePath)) rmSync(archivePath, { force: true });
  run("tar", ["-acf", archivePath, "-C", sourceRoot, basename(courseRoot)], workspaceRoot);
}

function listArchive() {
  return run("tar", ["-tf", archivePath], workspaceRoot)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

ensureInside(sourceRoot, courseRoot);
ensureInside(archiveRoot, archivePath);

if (!existsSync(courseRoot)) {
  console.error(`Course directory does not exist: ${courseRoot}`);
  process.exit(1);
}
if (!existsSync(join(courseRoot, "course-manifest.json"))) {
  console.error(`Refusing to archive without course-manifest.json: ${courseRoot}`);
  process.exit(1);
}

const sourceStats = directoryStats(courseRoot);
const payload = {
  ok: true,
  dryRun,
  course,
  sourceRoot,
  courseRoot,
  archiveRoot,
  archivePath,
  manifestPath,
  deleteActive,
  source: sourceStats,
  archive: null,
  deletedActive: false,
};

try {
  if (!dryRun) {
    createArchive();
    const archiveEntries = listArchive();
    const hasManifest = archiveEntries.some((entry) => entry.replaceAll("\\", "/") === `${course}/course-manifest.json`);
    if (!hasManifest) throw new Error("Archive verification failed: missing course-manifest.json.");
    if (archiveEntries.length < sourceStats.files) {
      throw new Error(`Archive verification failed: expected at least ${sourceStats.files} entries, got ${archiveEntries.length}.`);
    }
    payload.archive = {
      bytes: statSync(archivePath).size,
      entries: archiveEntries.length,
      hasManifest,
    };
    writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    if (deleteActive) {
      rmSync(courseRoot, { recursive: true, force: true });
      payload.deletedActive = true;
      writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }
  }
  console.log(JSON.stringify(payload, null, 2));
} catch (error) {
  payload.ok = false;
  payload.error = error instanceof Error ? error.message : String(error);
  if (existsSync(archivePath)) rmSync(archivePath, { force: true });
  if (!dryRun) writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
