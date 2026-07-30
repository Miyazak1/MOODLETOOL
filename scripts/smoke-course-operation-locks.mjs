import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { acquireCourseLocks } from "./lib/course-operation-locks.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".course-lock-smoke");

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

assertInside(projectRoot, smokeRoot, "smoke root");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(smokeRoot, { recursive: true });

try {
  const release = acquireCourseLocks(["HFC3M", "ENG3U"], { operation: "smoke-a", lockRoot: smokeRoot });
  let blocked = false;
  try {
    acquireCourseLocks(["ENG3U"], { operation: "smoke-b", lockRoot: smokeRoot });
  } catch (error) {
    blocked = /locked by another operation/i.test(String(error?.message || ""));
  }
  if (!blocked) throw new Error("Expected second lock acquisition to fail.");
  release();
  const releaseAfter = acquireCourseLocks(["ENG3U"], { operation: "smoke-c", lockRoot: smokeRoot });
  releaseAfter();
  console.log("Course operation lock smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
}
