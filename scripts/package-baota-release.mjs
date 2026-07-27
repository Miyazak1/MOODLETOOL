import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultReleaseRoot = join(projectRoot, "deployment", "releases");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toPosix(path) {
  return path.replace(/\\/g, "/");
}

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function isSkippableDir(name) {
  return name === "node_modules"
    || name === "courseware"
    || name === "courseware-active"
    || name === "courseware-archive"
    || name === "data"
    || name === "inbox"
    || name === "releases"
    || name === "__pycache__";
}

function copyFiltered(source, target, copiedFiles) {
  if (!existsSync(source)) return false;
  const stats = statSync(source);
  if (stats.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.isDirectory() && isSkippableDir(entry.name)) continue;
      if (entry.name.endsWith(".pyc")) continue;
      copyFiltered(join(source, entry.name), join(target, entry.name), copiedFiles);
    }
    return true;
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  copiedFiles.push({
    path: toPosix(relative(projectRoot, source)),
    bytes: stats.size,
  });
  return true;
}

function collectBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
    } else {
      total += stats.size;
    }
  }
  return total;
}

const releaseRoot = resolve(argValue("--out", defaultReleaseRoot));
const label = (argValue("--label", "baota") || "baota").replace(/[^a-zA-Z0-9_-]/g, "-");
const dryRun = hasArg("--dry-run");
const keepStaging = hasArg("--keep-staging");
const stamp = timestamp();
const archiveExt = process.platform === "win32" ? "zip" : "tar.gz";
const archiveBase = `ossd-course-portal-${label}-${stamp}`;
const archivePath = join(releaseRoot, `${archiveBase}.${archiveExt}`);
const sidecarManifestPath = join(releaseRoot, `${archiveBase}.manifest.json`);
const stagingRoot = join(releaseRoot, `_staging-${archiveBase}`);

assertInside(projectRoot, releaseRoot, "release output directory");
assertInside(releaseRoot, stagingRoot, "release staging directory");

const includePaths = [
  "server.mjs",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "index.html",
  "README.md",
  "ADMIN.md",
  "DEPLOYMENT.md",
  ".env.example",
  ".env.production.example",
  "START_LOCAL_WEBSITE.bat",
  "src",
  "public",
  "dist",
  "scripts",
  "tools",
  "docs",
  "deployment/BAOTA_DEPLOYMENT.md",
  "deployment/UPLOAD.md",
  "deployment/nginx-ossd-course-portal.conf",
  "deployment/ossd-course-portal.service",
  "deployment/bootstrap-linux-server.sh",
  "deployment/upload-courseware-rclone.ps1",
  "deployment/START_BACKGROUND_UPLOAD_RCLONE.cmd",
  "deployment/baota-preflight-report.md",
  "deployment/baota-preflight-report.json",
  "deployment/course-readiness-summary.md",
  "deployment/course-readiness-summary.json",
  "deployment/course-content-workbench.md",
  "deployment/course-content-workbench.json",
  "deployment/online-resource-readiness.md",
  "deployment/online-resource-readiness.json",
  "deployment/upload-gap-checklist.md",
  "deployment/upload-gap-checklist.json",
  "deployment/ispring-package-queue.md",
  "deployment/ispring-package-queue.json",
  "deployment/office-preview-queue.md",
  "deployment/office-preview-queue.json",
  "deployment/launch-readiness-report.md",
  "deployment/launch-readiness-report.json",
  "deployment/launch-course-transfer-plan.md",
  "deployment/launch-course-transfer-plan.json",
  "deployment/launch-course-status.json",
];

const excludedNotes = [
  "node_modules is excluded; run npm install --omit=dev on the server.",
  "courseware/courseware-active is excluded; store course files on the server data disk.",
  "courseware-archive is excluded; upload or generate course archives separately.",
  "data and inbox are excluded to avoid leaking users, sessions, raw Moodle queues, and temporary files.",
  ".env is excluded; use .env.production.example as the server template.",
];

if (dryRun) {
  const existing = includePaths.filter((item) => existsSync(join(projectRoot, item)));
  console.log(JSON.stringify({ dryRun: true, releaseRoot, archivePath, includePaths: existing, excludedNotes }, null, 2));
  process.exit(0);
}

mkdirSync(releaseRoot, { recursive: true });
if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });

const copiedFiles = [];
const missingIncludes = [];
for (const item of includePaths) {
  const source = join(projectRoot, item);
  const target = join(stagingRoot, item);
  if (!copyFiltered(source, target, copiedFiles)) missingIncludes.push(item);
}

const inArchiveManifest = {
  generatedAt: new Date().toISOString(),
  project: "ossd-course-portal",
  label,
  archive: basename(archivePath),
  copiedFiles: copiedFiles.length,
  copiedBytes: collectBytes(stagingRoot),
  missingIncludes,
  excludedNotes,
};
writeFileSync(join(stagingRoot, "release-manifest.json"), `${JSON.stringify(inArchiveManifest, null, 2)}\n`, "utf8");

const tarResult = spawnSync("tar", ["-acf", archivePath, "-C", stagingRoot, "."], {
  cwd: projectRoot,
  stdio: "pipe",
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (tarResult.status !== 0) {
  throw new Error(`tar failed (${tarResult.status}): ${tarResult.stderr || tarResult.stdout}`);
}

const archiveBytes = statSync(archivePath).size;
const sidecarManifest = {
  ...inArchiveManifest,
  archivePath,
  sidecarManifestPath,
  archiveBytes,
  stagingRoot: keepStaging ? stagingRoot : null,
};
writeFileSync(sidecarManifestPath, `${JSON.stringify(sidecarManifest, null, 2)}\n`, "utf8");

if (!keepStaging) rmSync(stagingRoot, { recursive: true, force: true });

console.log(JSON.stringify(sidecarManifest, null, 2));
