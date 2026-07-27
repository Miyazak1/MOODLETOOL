import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".package-smoke");

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function normalizeEntry(entry) {
  return entry.replace(/\\/g, "/").replace(/^\.\//, "");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

assertInside(projectRoot, smokeRoot, "smoke output");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(smokeRoot, { recursive: true });

try {
  const output = run("node", ["scripts/package-baota-release.mjs", "--out", smokeRoot, "--label", "smoke"]);
  const manifest = JSON.parse(output);
  if (!existsSync(manifest.archivePath)) throw new Error(`Archive was not created: ${manifest.archivePath}`);
  if (!existsSync(manifest.sidecarManifestPath)) throw new Error(`Manifest was not created: ${manifest.sidecarManifestPath}`);

  const sidecar = JSON.parse(readFileSync(manifest.sidecarManifestPath, "utf8"));
  if (!sidecar.archiveBytes || sidecar.archiveBytes < 1024) throw new Error("Archive is unexpectedly small.");
  if (sidecar.missingIncludes.length) throw new Error(`Unexpected missing release includes: ${sidecar.missingIncludes.join(", ")}`);

  const listOutput = run("tar", ["-tf", manifest.archivePath]);
  const entries = listOutput.split(/\r?\n/).filter(Boolean).map(normalizeEntry);
  const entrySet = new Set(entries);
  for (const required of [
    "server.mjs",
    "dist/index.html",
    "public/login.html",
    "public/teacher-admin.html",
    "deployment/nginx-ossd-course-portal.conf",
    "deployment/BAOTA_DEPLOYMENT.md",
    "deployment/launch-course-transfer-plan.md",
    "deployment/launch-course-status.json",
    ".env.production.example",
    "release-manifest.json",
  ]) {
    if (!entrySet.has(required)) throw new Error(`Release archive is missing ${required}`);
  }

  for (const forbiddenPrefix of ["node_modules/", "courseware/", "courseware-active/", "courseware-archive/", "data/", "inbox/", "deployment/releases/"]) {
    const match = entries.find((entry) => entry === forbiddenPrefix.slice(0, -1) || entry.startsWith(forbiddenPrefix));
    if (match) throw new Error(`Release archive should not include ${forbiddenPrefix}, found ${match}`);
  }
  for (const forbiddenExact of [".env.production", ".env.production.generated", ".env.production.credentials.txt"]) {
    if (entrySet.has(forbiddenExact)) throw new Error(`Release archive should not include generated secret file ${forbiddenExact}`);
  }

  console.log(`Baota release package smoke passed: ${manifest.archivePath}`);
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}
