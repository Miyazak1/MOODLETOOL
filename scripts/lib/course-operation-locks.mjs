import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
