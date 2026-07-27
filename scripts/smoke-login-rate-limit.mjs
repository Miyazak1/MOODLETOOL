import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const port = Number(readArg("--port") || 8906);
const baseUrl = `http://127.0.0.1:${port}`;
const usersFile = join(tmpdir(), `ossd-login-rate-users-${process.pid}.json`);
const courseStatusFile = join(tmpdir(), `ossd-login-rate-course-status-${process.pid}.json`);
const adminUsername = "admin-rate";
const adminPassword = "admin-rate-password";
const teacherUsername = "teacher-rate";
const teacherPassword = "teacher-rate-password";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonRequest(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function expect(condition, label, detail = null) {
  console.log(`${condition ? "OK" : "FAIL"} ${label}`);
  if (!condition) {
    if (detail) console.error(JSON.stringify(detail, null, 2));
    process.exitCode = 1;
  }
}

async function expectLogin(path, body, status, label) {
  const result = await jsonRequest(path, body);
  expect(result.response.status === status, `${label} (${result.response.status})`, result.data);
  return result;
}

const child = spawn("node", ["server.mjs", "--root", "dist", "--port", String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ADMIN_UPLOADS_ENABLED: "1",
    ADMIN_USERNAME: adminUsername,
    ADMIN_PASSWORD: adminPassword,
    ADMIN_SESSION_SECRET: "admin-rate-limit-session-secret",
    PORTAL_AUTH_ENABLED: "1",
    PORTAL_SESSION_SECRET: "portal-rate-limit-session-secret",
    PORTAL_USERS_FILE: usersFile,
    COURSE_STATUS_FILE: courseStatusFile,
    LOGIN_RATE_LIMIT_MAX_FAILURES: "2",
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: "60",
    LOGIN_RATE_LIMIT_LOCK_SECONDS: "60",
    PORTAL_USERS_JSON: JSON.stringify([
      { username: "admin-portal", password: "portal-admin-rate-password", role: "admin", courses: ["*"] },
      { username: teacherUsername, password: teacherPassword, role: "teacher", courses: ["ENG3U"] },
      { username: "teacher-clear", password: "teacher-clear-password", role: "teacher", courses: ["ENG3U"] },
    ]),
  },
  stdio: "ignore",
  windowsHide: true,
});

try {
  await sleep(1500);

  await expectLogin(
    "/api/portal/login",
    { username: "teacher-clear", password: "wrong-password" },
    401,
    "portal records one bad password without locking",
  );
  const portalClear = await expectLogin(
    "/api/portal/login",
    { username: "teacher-clear", password: "teacher-clear-password" },
    200,
    "portal successful login clears the failure bucket",
  );
  expect(portalClear.data.authenticated === true, "portal success returns authenticated session", portalClear.data);

  await expectLogin("/api/portal/login", { username: teacherUsername, password: "wrong-1" }, 401, "portal first bad password");
  await expectLogin("/api/portal/login", { username: teacherUsername, password: "wrong-2" }, 401, "portal second bad password");
  const portalLocked = await expectLogin(
    "/api/portal/login",
    { username: teacherUsername, password: teacherPassword },
    429,
    "portal locks further login attempts after threshold",
  );
  expect(portalLocked.response.headers.get("retry-after") === "60", "portal rate limit returns Retry-After", portalLocked.data);

  await expectLogin(
    "/api/admin/login",
    { username: adminUsername, password: "wrong-password" },
    401,
    "admin records one bad password without locking",
  );
  const adminClear = await expectLogin(
    "/api/admin/login",
    { username: adminUsername, password: adminPassword },
    200,
    "admin successful login clears the failure bucket",
  );
  expect(adminClear.data.ok === true, "admin success returns ok", adminClear.data);

  await expectLogin("/api/admin/login", { username: adminUsername, password: "wrong-1" }, 401, "admin first bad password");
  await expectLogin("/api/admin/login", { username: adminUsername, password: "wrong-2" }, 401, "admin second bad password");
  const adminLocked = await expectLogin(
    "/api/admin/login",
    { username: adminUsername, password: adminPassword },
    429,
    "admin locks further login attempts after threshold",
  );
  expect(adminLocked.response.headers.get("retry-after") === "60", "admin rate limit returns Retry-After", adminLocked.data);
} finally {
  child.kill();
  await rm(usersFile, { force: true }).catch(() => {});
  await rm(courseStatusFile, { force: true }).catch(() => {});
}

if (process.exitCode) process.exit(process.exitCode);
