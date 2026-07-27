import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const defaultOutDir = resolve(workspaceRoot, "backups", "ossd-course-portal");
const archiveArg = readArg("--archive");
const outDir = resolve(readArg("--out") || defaultOutDir);
const archivePath = archiveArg ? resolve(archiveArg) : findLatestArchive(outDir);
const manifestPath = readArg("--manifest") ? resolve(readArg("--manifest")) : `${archivePath}.json`;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function findLatestArchive(directory) {
  if (!existsSync(directory)) {
    console.error(`Backup directory does not exist: ${directory}`);
    process.exit(1);
  }
  const archives = readdirSync(directory)
    .filter((name) => name.endsWith(".zip") || name.endsWith(".tar.gz"))
    .map((name) => {
      const path = join(directory, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!archives.length) {
    console.error(`No backup archives found in: ${directory}`);
    process.exit(1);
  }
  return archives[0].path;
}

function runTarList(archive) {
  const result = spawnSync("tar", ["-tf", archive], {
    cwd: dirname(archive),
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Could not list archive: ${archive}`);
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

if (!archivePath || !existsSync(archivePath)) {
  console.error(`Backup archive does not exist: ${archivePath}`);
  process.exit(1);
}
if (!existsSync(manifestPath)) {
  console.error(`Backup manifest does not exist: ${manifestPath}`);
  process.exit(1);
}

let entries;
try {
  entries = runTarList(archivePath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const archiveStat = statSync(archivePath);
const errors = [];

if (!entries.length) errors.push("Archive has no readable entries.");
if (manifest.archiveBytes && manifest.archiveBytes !== archiveStat.size) {
  errors.push(`Archive size differs from manifest: manifest=${manifest.archiveBytes}, actual=${archiveStat.size}.`);
}
if (!Array.isArray(manifest.sources) || !manifest.sources.length) {
  errors.push("Manifest has no sources.");
}
for (const source of manifest.sources || []) {
  const sourceName = basename(source.path || source.relativePath || "");
  if (sourceName && !entries.some((entry) => entry === sourceName || entry.startsWith(`${sourceName}/`) || entry.includes(`/${sourceName}/`))) {
    errors.push(`Archive entries do not include source folder: ${sourceName}.`);
  }
  if (typeof source.files === "number" && source.files > entries.length) {
    errors.push(`Manifest source file count ${source.files} is larger than listed archive entries ${entries.length}.`);
  }
}

const result = {
  ok: errors.length === 0,
  archivePath,
  manifestPath,
  archiveBytes: archiveStat.size,
  archiveSize: formatBytes(archiveStat.size),
  entryCount: entries.length,
  manifestGeneratedAt: manifest.generatedAt,
  sources: manifest.sources || [],
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);
