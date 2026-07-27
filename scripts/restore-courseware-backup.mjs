import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const archiveArg = readArg("--archive");
const targetArg = readArg("--target");
const manifestArg = readArg("--manifest");
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result.stdout;
}

function listArchive(archivePath) {
  const output = run("tar", ["-tf", archivePath], dirname(archivePath));
  return output.split(/\r?\n/).filter(Boolean);
}

function isDirectoryEmpty(path) {
  if (!existsSync(path)) return true;
  return readdirSync(path).length === 0;
}

function safeRemoveTarget(path) {
  const resolved = resolve(path);
  const root = resolve(resolved, "..");
  if (!resolved.startsWith(`${root}\\`) && !resolved.startsWith(`${root}/`)) {
    throw new Error(`Refusing to remove unsafe restore target: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}

function extractArchive(archivePath, targetPath) {
  mkdirSync(targetPath, { recursive: true });
  if (archivePath.toLowerCase().endsWith(".zip") && process.platform === "win32") {
    const safeArchive = archivePath.replaceAll("'", "''");
    const safeTarget = targetPath.replaceAll("'", "''");
    run("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath '${safeArchive}' -DestinationPath '${safeTarget}' -Force`,
    ]);
    return;
  }
  run("tar", ["-xf", archivePath, "-C", targetPath], dirname(archivePath));
}

if (!archiveArg) {
  console.error("Missing --archive <backup.zip|backup.tar.gz>.");
  process.exit(1);
}
if (!targetArg) {
  console.error("Missing --target <restore-directory>. Restore never writes into courseware unless you explicitly choose that target.");
  process.exit(1);
}

const archivePath = resolve(archiveArg);
const targetPath = resolve(targetArg);
const manifestPath = manifestArg ? resolve(manifestArg) : `${archivePath}.json`;

if (!existsSync(archivePath)) {
  console.error(`Backup archive does not exist: ${archivePath}`);
  process.exit(1);
}

const entries = listArchive(archivePath);
if (!entries.length) {
  console.error(`Backup archive has no readable entries: ${archivePath}`);
  process.exit(1);
}

const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const targetExists = existsSync(targetPath);
const targetEmpty = isDirectoryEmpty(targetPath);
if (!dryRun && targetExists && !targetEmpty && !force) {
  console.error(`Restore target is not empty: ${targetPath}. Use --force only after checking the target.`);
  process.exit(1);
}

const report = {
  ok: true,
  dryRun,
  force,
  archivePath,
  manifestPath: existsSync(manifestPath) ? manifestPath : null,
  targetPath,
  archiveBytes: statSync(archivePath).size,
  entryCount: entries.length,
  sampleEntries: entries.slice(0, 20),
  manifestGeneratedAt: manifest?.generatedAt || null,
  sources: manifest?.sources || [],
};

if (!dryRun) {
  if (targetExists && !targetEmpty && force) safeRemoveTarget(targetPath);
  extractArchive(archivePath, targetPath);
  report.restoredAt = new Date().toISOString();
  report.reportPath = join(targetPath, "restore-report.json");
  writeFileSync(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));
