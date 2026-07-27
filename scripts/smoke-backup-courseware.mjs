import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const smokeRoot = resolve(projectRoot, "inbox", "backup-smoke");
const sourceRoot = resolve(smokeRoot, "courseware", "ZZZSMOKE");
const outDir = resolve(smokeRoot, "backups");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
  return result.stdout;
}

try {
  rmSync(smokeRoot, { recursive: true, force: true });
  await mkdir(resolve(sourceRoot, "plans", "course"), { recursive: true });
  await mkdir(resolve(sourceRoot, "lessons", "U01L01"), { recursive: true });
  await writeFile(resolve(sourceRoot, "course-manifest.json"), '{"schemaVersion":1}\n', "utf8");
  await writeFile(resolve(sourceRoot, "plans", "course", "Course_Outline.md"), "# Smoke outline\n", "utf8");
  await writeFile(resolve(sourceRoot, "lessons", "U01L01", "presentation.html"), "<!doctype html>", "utf8");

  const output = run("node", [
    "scripts/backup-courseware.mjs",
    "--source",
    sourceRoot,
    "--out",
    outDir,
    "--label",
    "smoke",
    "--retention",
    "1",
  ]);
  const payload = JSON.parse(output);
  if (!payload.archivePath || !payload.manifestPath || payload.totals?.files !== 3) {
    console.error(`Unexpected backup payload: ${output}`);
    process.exitCode = 1;
  }
  if (!existsSync(payload.archivePath) || !existsSync(payload.manifestPath)) {
    console.error(`Backup archive or manifest was not created: ${output}`);
    process.exitCode = 1;
  }
  const manifest = JSON.parse(readFileSync(payload.manifestPath, "utf8"));
  if (manifest.archiveBytes <= 0 || manifest.sources?.[0]?.relativePath.includes("..")) {
    console.error(`Unexpected backup manifest: ${JSON.stringify(manifest, null, 2)}`);
    process.exitCode = 1;
  }
  const verifyOutput = run("node", ["scripts/verify-courseware-backup.mjs", "--archive", payload.archivePath]);
  const verifyPayload = JSON.parse(verifyOutput);
  if (!verifyPayload.ok || verifyPayload.entryCount < 3) {
    console.error(`Unexpected backup verification payload: ${verifyOutput}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
console.log("Courseware backup smoke passed.");
