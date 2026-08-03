import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { acquireCourseLocks, listCourseLocks, removeCourseLock } from "./lib/course-operation-locks.mjs";

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
  const activeLocks = listCourseLocks({ lockRoot: smokeRoot });
  if (activeLocks.length !== 2) throw new Error(`Expected two active locks, got ${activeLocks.length}.`);
  if (activeLocks.some((lock) => lock.stale)) throw new Error("Freshly acquired locks should not be stale.");
  let refusedActiveRemoval = false;
  try {
    removeCourseLock("ENG3U", { lockRoot: smokeRoot });
  } catch (error) {
    refusedActiveRemoval = /Refusing to remove active/i.test(String(error?.message || ""));
  }
  if (!refusedActiveRemoval) throw new Error("Expected active lock removal to be refused.");
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
  const staleLock = join(smokeRoot, "MHF4U.lock");
  mkdirSync(staleLock, { recursive: true });
  writeFileSync(
    join(staleLock, "owner.json"),
    `${JSON.stringify({ operation: "smoke-stale", course: "MHF4U", pid: 999999999, startedAt: "2026-01-01T00:00:00.000Z" }, null, 2)}\n`,
    "utf8",
  );
  const stale = listCourseLocks({ lockRoot: smokeRoot }).find((lock) => lock.course === "MHF4U");
  if (!stale?.stale) throw new Error("Expected dead-pid lock to be marked stale.");
  removeCourseLock("MHF4U", { lockRoot: smokeRoot });
  if (existsSync(staleLock)) throw new Error("Expected stale lock to be removed.");
  console.log("Course operation lock smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
}
