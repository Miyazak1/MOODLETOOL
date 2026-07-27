import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const defaultSource = resolve(workspaceRoot, "courseware");
const defaultOutDir = resolve(workspaceRoot, "backups", "ossd-course-portal");
const sources = readArgs("--source").map((source) => resolve(source));
const backupSources = sources.length ? sources : [defaultSource];
const outDir = resolve(readArg("--out") || defaultOutDir);
const label = safeLabel(readArg("--label") || "courseware");
const dryRun = process.argv.includes("--dry-run");
const retention = Number(readArg("--retention") || 0);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const extension = process.platform === "win32" ? ".zip" : ".tar.gz";
const archiveName = `ossd-${label}-backup-${timestamp}${extension}`;
const archivePath = join(outDir, archiveName);
const manifestPath = join(outDir, `${archiveName}.json`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readArgs(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function safeLabel(value) {
  return String(value || "backup").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "backup";
}

function directoryStats(root) {
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let stats;
    try {
      stats = statSync(current);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else {
      files += 1;
      bytes += stats.size;
    }
  }
  return { files, bytes };
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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
}

function backupWithPowershell() {
  const pathLiteralList = backupSources.map((source) => `'${source.replaceAll("'", "''")}'`).join(",");
  const destination = archivePath.replaceAll("'", "''");
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Compress-Archive -LiteralPath ${pathLiteralList} -DestinationPath '${destination}' -Force`,
  ]);
}

function backupWithTar() {
  const args = ["-czf", archivePath];
  for (const source of backupSources) {
    args.push("-C", dirname(source), basename(source));
  }
  run("tar", args);
}

function pruneOldBackups() {
  if (!retention || retention < 1) return [];
  const resolvedOut = resolve(outDir);
  const entries = readdirSync(resolvedOut)
    .filter((name) => name.startsWith(`ossd-${label}-backup-`) && (name.endsWith(".zip") || name.endsWith(".tar.gz")))
    .map((name) => {
      const path = resolve(resolvedOut, name);
      return { name, path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const removed = [];
  for (const entry of entries.slice(retention)) {
    if (!entry.path.startsWith(`${resolvedOut}\\`) && !entry.path.startsWith(`${resolvedOut}/`)) {
      throw new Error(`Refusing to prune outside backup directory: ${entry.path}`);
    }
    const sidecar = `${entry.path}.json`;
    rmSync(entry.path, { force: true });
    rmSync(sidecar, { force: true });
    removed.push(entry.path);
  }
  return removed;
}

for (const source of backupSources) {
  if (!existsSync(source)) {
    console.error(`Backup source is missing: ${source}`);
    process.exit(1);
  }
}

const sourceSummaries = backupSources.map((source) => {
  const stats = directoryStats(source);
  return {
    path: source,
    relativePath: relative(workspaceRoot, source).replaceAll("\\", "/"),
    files: stats.files,
    bytes: stats.bytes,
    size: formatBytes(stats.bytes),
  };
});

const manifest = {
  generatedAt: new Date().toISOString(),
  dryRun,
  label,
  platform: process.platform,
  archivePath,
  manifestPath,
  outDir,
  sources: sourceSummaries,
  totals: {
    files: sourceSummaries.reduce((sum, source) => sum + source.files, 0),
    bytes: sourceSummaries.reduce((sum, source) => sum + source.bytes, 0),
  },
  retention: retention || null,
  pruned: [],
};

if (!dryRun) {
  mkdirSync(outDir, { recursive: true });
  if (existsSync(archivePath)) rmSync(archivePath, { force: true });
  if (process.platform === "win32") backupWithPowershell();
  else backupWithTar();
  manifest.archiveBytes = statSync(archivePath).size;
  manifest.archiveSize = formatBytes(manifest.archiveBytes);
  manifest.pruned = pruneOldBackups();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(manifest, null, 2));
