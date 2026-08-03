import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..", "..");
const defaultLockRoot = join(projectRoot, "deployment", "locks");

function toSafeLockName(value) {
  return String(value || "global")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "GLOBAL";
}

function assertInside(parent, child) {
  const root = resolve(parent);
  const target = resolve(child);
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel))) return target;
  throw new Error(`Refusing to create a lock outside ${root}: ${target}`);
}

function readJsonFileSync(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function isPidAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return null;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    if (error?.code === "ESRCH") return false;
    return null;
  }
}

function lockRecord(lockRoot, course, lockPath) {
  const ownerPath = join(lockPath, "owner.json");
  const owner = readJsonFileSync(ownerPath, {});
  const pidAlive = isPidAlive(owner?.pid);
  const startedAt = owner?.startedAt || "";
  const started = startedAt ? new Date(startedAt) : null;
  const ageSeconds = started && !Number.isNaN(started.getTime())
    ? Math.max(0, Math.round((Date.now() - started.getTime()) / 1000))
    : null;
  return {
    course,
    lockRoot,
    lockPath,
    ownerPath,
    owner,
    operation: owner?.operation || "",
    pid: Number.isInteger(Number(owner?.pid)) ? Number(owner.pid) : null,
    pidAlive,
    startedAt,
    ageSeconds,
    stale: pidAlive === false,
  };
}

export function listCourseLocks({ lockRoot = process.env.COURSE_OPERATION_LOCK_DIR || defaultLockRoot } = {}) {
  const resolvedLockRoot = resolve(lockRoot);
  if (!existsSync(resolvedLockRoot)) return [];
  return readdirSync(resolvedLockRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".lock"))
    .map((entry) => {
      const course = entry.name.replace(/\.lock$/i, "");
      const lockPath = assertInside(resolvedLockRoot, join(resolvedLockRoot, entry.name));
      return lockRecord(resolvedLockRoot, course, lockPath);
    })
    .sort((a, b) => a.course.localeCompare(b.course));
}

export function removeCourseLock(course, { lockRoot = process.env.COURSE_OPERATION_LOCK_DIR || defaultLockRoot, requireStale = true } = {}) {
  const resolvedLockRoot = resolve(lockRoot);
  const safeCourse = toSafeLockName(course);
  const lockPath = assertInside(resolvedLockRoot, join(resolvedLockRoot, `${safeCourse}.lock`));
  const record = lockRecord(resolvedLockRoot, safeCourse, lockPath);
  if (!existsSync(lockPath)) throw new Error(`Course lock does not exist: ${safeCourse}`);
  if (requireStale && !record.stale) {
    throw new Error(`Refusing to remove active or unknown course lock: ${safeCourse}`);
  }
  rmSync(lockPath, { recursive: true, force: true });
  return record;
}

export function acquireCourseLocks(courses, { operation = "course-operation", lockRoot = process.env.COURSE_OPERATION_LOCK_DIR || defaultLockRoot } = {}) {
  const uniqueCourses = [...new Set((courses || []).map(toSafeLockName).filter(Boolean))].sort();
  if (!uniqueCourses.length) return () => {};

  const resolvedLockRoot = resolve(lockRoot);
  mkdirSync(resolvedLockRoot, { recursive: true });
  const acquired = [];
  try {
    for (const course of uniqueCourses) {
      const lockPath = assertInside(resolvedLockRoot, join(resolvedLockRoot, `${course}.lock`));
      try {
        mkdirSync(lockPath);
      } catch (error) {
        if (error?.code === "EEXIST" || existsSync(lockPath)) {
          throw new Error(`Course ${course} is locked by another operation: ${lockPath}`);
        }
        throw error;
      }
      acquired.push(lockPath);
      writeFileSync(
        join(lockPath, "owner.json"),
        `${JSON.stringify(
          {
            operation,
            course,
            pid: process.pid,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  } catch (error) {
    for (const lockPath of acquired.reverse()) rmSync(lockPath, { recursive: true, force: true });
    throw error;
  }

  return () => {
    for (const lockPath of acquired.reverse()) rmSync(lockPath, { recursive: true, force: true });
  };
}
