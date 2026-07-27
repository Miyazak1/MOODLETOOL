import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const projectRoot = process.cwd();
const smokeRoot = resolve(projectRoot, "inbox", "restore-backup-smoke");
const sourceRoot = resolve(smokeRoot, "source-courseware", "ZZZSMOKE");
const outDir = resolve(smokeRoot, "backups");
const restoreTarget = resolve(smokeRoot, "restored");
const blockedTarget = resolve(smokeRoot, "blocked-target");

function run(command, args, { expectFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (expectFailure) {
    if (result.status === 0) {
      throw new Error(`Expected command to fail but it passed: ${command} ${args.join(" ")}`);
    }
    return result;
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result;
}

function findRestoredFile(root, filename) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name === filename) return path;
    }
  }
  return null;
}

try {
  rmSync(smokeRoot, { recursive: true, force: true });
  mkdirSync(join(sourceRoot, "plans", "course"), { recursive: true });
  mkdirSync(join(sourceRoot, "lessons", "U01L01"), { recursive: true });
  writeFileSync(join(sourceRoot, "course-manifest.json"), '{"schemaVersion":1,"course":"ZZZSMOKE"}\n', "utf8");
  writeFileSync(join(sourceRoot, "plans", "course", "Course_Outline.md"), "# Smoke outline\n", "utf8");
  writeFileSync(join(sourceRoot, "lessons", "U01L01", "presentation.html"), "<!doctype html>\n", "utf8");

  const backupResult = run("node", [
    "scripts/backup-courseware.mjs",
    "--source",
    sourceRoot,
    "--out",
    outDir,
    "--label",
    "restore-smoke",
    "--retention",
    "1",
  ]);
  const backupPayload = JSON.parse(backupResult.stdout);
  if (!backupPayload.archivePath || !backupPayload.manifestPath || backupPayload.totals?.files !== 3) {
    throw new Error(`Unexpected backup payload: ${backupResult.stdout}`);
  }

  const dryRunResult = run("node", [
    "scripts/restore-courseware-backup.mjs",
    "--archive",
    backupPayload.archivePath,
    "--target",
    restoreTarget,
    "--dry-run",
  ]);
  const dryRunPayload = JSON.parse(dryRunResult.stdout);
  if (!dryRunPayload.ok || !dryRunPayload.dryRun || dryRunPayload.entryCount < 3) {
    throw new Error(`Unexpected restore dry-run payload: ${dryRunResult.stdout}`);
  }
  if (existsSync(restoreTarget) && readdirSync(restoreTarget).length) {
    throw new Error("Restore dry-run wrote files into the target.");
  }

  const restoreResult = run("node", [
    "scripts/restore-courseware-backup.mjs",
    "--archive",
    backupPayload.archivePath,
    "--target",
    restoreTarget,
  ]);
  const restorePayload = JSON.parse(restoreResult.stdout);
  if (!restorePayload.ok || restorePayload.dryRun || !restorePayload.reportPath || !existsSync(restorePayload.reportPath)) {
    throw new Error(`Unexpected restore payload: ${restoreResult.stdout}`);
  }
  const restoredManifest = findRestoredFile(restoreTarget, "course-manifest.json");
  const restoredLesson = findRestoredFile(restoreTarget, "presentation.html");
  if (!restoredManifest || !restoredLesson) {
    throw new Error(`Restored files are missing under ${restoreTarget}`);
  }
  const report = JSON.parse(readFileSync(restorePayload.reportPath, "utf8"));
  if (!report.ok || report.targetPath !== restoreTarget) {
    throw new Error(`Unexpected restore report: ${JSON.stringify(report, null, 2)}`);
  }

  mkdirSync(blockedTarget, { recursive: true });
  writeFileSync(join(blockedTarget, "keep.txt"), "do not overwrite\n", "utf8");
  const blockedResult = run(
    "node",
    ["scripts/restore-courseware-backup.mjs", "--archive", backupPayload.archivePath, "--target", blockedTarget],
    { expectFailure: true },
  );
  if (!`${blockedResult.stderr}${blockedResult.stdout}`.includes("not empty")) {
    throw new Error(`Restore did not explain non-empty target refusal: ${blockedResult.stderr}${blockedResult.stdout}`);
  }
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}

console.log("Courseware restore smoke passed.");
