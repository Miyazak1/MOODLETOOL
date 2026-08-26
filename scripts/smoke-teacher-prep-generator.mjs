import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const generatorPath = join(projectRoot, "scripts", "generate-teacher-prep-from-manifest.mjs");
const workspaceRoot = resolve(projectRoot, "..");

function runDry(course) {
  const output = execFileSync(process.execPath, [generatorPath, "--course", course, "--dry-run"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}

const ics3u = runDry("ICS3U");
assert.equal(ics3u.course, "ICS3U");
assert.equal(ics3u.dryRun, true);
assert.equal(ics3u.profile, "ICS3U", "ICS3U must keep its course-specific teacher prep profile.");
assert.equal(ics3u.units, 4);
assert.equal(ics3u.lessons, 27);

if (existsSync(join(workspaceRoot, "courseware", "ENG3U", "course-manifest.json"))) {
  const eng3u = runDry("ENG3U");
  assert.equal(eng3u.course, "ENG3U");
  assert.equal(eng3u.dryRun, true);
  assert.equal(eng3u.profile, "generic", "Unprofiled courses must not inherit ICS3U-specific teacher prep language.");
  assert.ok(eng3u.units > 0, "ENG3U dry-run should read real units.");
  assert.ok(eng3u.lessons > 0, "ENG3U dry-run should read real lessons.");
}

console.log("teacher prep generator smoke passed.");
