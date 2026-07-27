import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = resolve(import.meta.dirname, "..");
const outPath = join(tmpdir(), `ossd-launch-course-status-${process.pid}.json`);

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, ["scripts/prepare-launch-course-status.mjs", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== expectedStatus) {
    throw new Error(
      `prepare-launch-course-status exited ${result.status}, expected ${expectedStatus}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  rmSync(outPath, { force: true });
  run(["--courses", "ENG3U,ESLEO", "--out", outPath]);
  assert(existsSync(outPath), "Launch status file was not written.");
  const data = JSON.parse(readFileSync(outPath, "utf8"));
  assert(data.schemaVersion === 1, "schemaVersion should be 1.");
  assert(data.mode === "launch-course-allowlist", "mode should describe allowlist launch status.");
  assert(data.activeCourseCount === 2, "activeCourseCount should be 2.");
  assert(data.archivedCourseCount > 0, "archivedCourseCount should be greater than 0.");
  assert(data.courses?.ENG3U?.status === "active", "ENG3U should be active.");
  assert(data.courses?.ESLEO?.status === "active", "ESLEO should be active.");
  assert(data.courses?.MTH1W?.status === "archived", "MTH1W should be archived in first launch.");
  assert(data.courses?.ENG2D?.status === "archived", "ENG2D should be archived in first launch.");

  const unknown = run(["--courses", "ENG3U,NOTACOURSE", "--out", `${outPath}.bad`], 2);
  assert(unknown.stderr.includes("NOTACOURSE"), "Unknown course failure should name the missing code.");

  console.log("Launch course status smoke passed.");
} finally {
  rmSync(outPath, { force: true });
  rmSync(`${outPath}.bad`, { force: true });
}
