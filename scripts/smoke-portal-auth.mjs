import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const port = Number(readArg("--port") || 8896);
const baseUrl = `http://127.0.0.1:${port}`;
const usersFile = join(tmpdir(), `ossd-portal-users-smoke-${process.pid}.json`);
const courseStatusFile = join(tmpdir(), `ossd-course-status-smoke-${process.pid}.json`);
const adminUsername = "admin";
const adminPassword = "admin-smoke-password";
const teacherUsername = "teacher-smoke";
const teacherPassword = "teacher-smoke-password";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setCookieValue(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function jsonRequest(path, options = {}) {
  const response = await request(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function check(path, label, expectedStatus, options = {}) {
  const response = await request(path, options);
  const ok = response.status === expectedStatus;
  console.log(`${ok ? "OK" : "FAIL"} ${response.status} ${label}`);
  if (!ok) {
    console.error(`  Expected: ${expectedStatus}`);
    console.error(`  URL: ${baseUrl}${path}`);
    process.exitCode = 1;
  }
  return response;
}

function expectJson(ok, label, data) {
  console.log(`${ok ? "OK" : "FAIL"} ${label}`);
  if (!ok) {
    console.error(JSON.stringify(data, null, 2));
    process.exitCode = 1;
  }
}

function coursewareUrl(course, path) {
  return `/courseware/${course}/${String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

const child = spawn("node", ["server.mjs", "--root", "dist", "--port", String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ADMIN_UPLOADS_ENABLED: "1",
    ADMIN_USERNAME: adminUsername,
    ADMIN_PASSWORD: adminPassword,
    ADMIN_SESSION_SECRET: "admin-smoke-session-secret",
    PORTAL_AUTH_ENABLED: "1",
    PORTAL_SESSION_SECRET: "portal-smoke-session-secret",
    PORTAL_USERS_FILE: usersFile,
    COURSE_STATUS_FILE: courseStatusFile,
    X_ACCEL_COURSEWARE_PREFIX: "/_protected_courseware/",
    PORTAL_USERS_JSON: JSON.stringify([
      { username: adminUsername, password: adminPassword, role: "admin", courses: ["*"] },
    ]),
  },
  stdio: "ignore",
  windowsHide: true,
});

try {
  await sleep(1500);
  await check("/", "portal serves login screen to anonymous visitors", 200);

  const badLogin = await jsonRequest("/api/portal/login", {
    method: "POST",
    body: JSON.stringify({ username: teacherUsername, password: "wrong-password" }),
  });
  expectJson(badLogin.response.status === 401, "portal rejects missing teacher before admin creates it", badLogin.data);

  const adminLogin = await jsonRequest("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  expectJson(adminLogin.response.status === 200 && adminLogin.data.ok, "admin login succeeds", adminLogin.data);
  const adminCookie = setCookieValue(adminLogin.response);

  const adminPortalLogin = await jsonRequest("/api/portal/login", {
    method: "POST",
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  expectJson(adminPortalLogin.response.status === 200 && adminPortalLogin.data.authenticated, "admin portal login succeeds", adminPortalLogin.data);
  const adminPortalCookie = setCookieValue(adminPortalLogin.response);

  const adminUsersViaPortalSession = await jsonRequest("/api/admin/users", {
    headers: { Cookie: adminPortalCookie },
  });
  expectJson(
    adminUsersViaPortalSession.response.status === 200 && adminUsersViaPortalSession.data.ok,
    "portal admin session can access admin backend",
    adminUsersViaPortalSession.data,
  );

  const usersBefore = await jsonRequest("/api/admin/users", {
    headers: { Cookie: adminCookie },
  });
  expectJson(usersBefore.response.status === 200 && usersBefore.data.ok, "admin can read users", usersBefore.data);

  const createTeacher = await jsonRequest("/api/admin/users", {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: JSON.stringify({
      username: teacherUsername,
      password: teacherPassword,
      role: "teacher",
      status: "active",
      courses: ["ENG3U", "MTH1W"],
    }),
  });
  expectJson(
    createTeacher.response.status === 200 &&
      createTeacher.data.ok &&
      createTeacher.data.user?.passwordStored === "hash",
    "admin creates hashed teacher with one course",
    createTeacher.data,
  );

  const teacherLogin = await jsonRequest("/api/portal/login", {
    method: "POST",
    body: JSON.stringify({ username: teacherUsername, password: teacherPassword }),
  });
  expectJson(teacherLogin.response.status === 200 && teacherLogin.data.authenticated, "teacher portal login succeeds", teacherLogin.data);
  const teacherCookie = setCookieValue(teacherLogin.response);

  const teacherAdminLogin = await jsonRequest("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username: teacherUsername, password: teacherPassword }),
  });
  expectJson(teacherAdminLogin.response.status === 403, "teacher cannot login to admin backend", teacherAdminLogin.data);

  const adminEmbeds = await jsonRequest("/api/portal/moodle-embeds?course=ENG3U", {
    headers: { Cookie: adminPortalCookie },
  });
  expectJson(
    adminEmbeds.response.status === 200 && adminEmbeds.data.ok && adminEmbeds.data.rows?.some((row) => row.kind === "ispring"),
    "admin portal can generate Moodle embed code for a course",
    adminEmbeds.data,
  );
  const teacherEmbeds = await jsonRequest("/api/portal/moodle-embeds?course=ENG3U", {
    headers: { Cookie: teacherCookie },
  });
  expectJson(teacherEmbeds.response.status === 403, "teacher portal cannot generate Moodle embed code", teacherEmbeds.data);

  const catalog = await jsonRequest("/course-catalog.json", {
    headers: { Cookie: teacherCookie },
  });
  const catalogCodes = (catalog.data.courses || []).map((course) => course.code);
  expectJson(
    catalog.response.status === 200 && catalogCodes.includes("ENG3U") && catalogCodes.includes("MTH1W"),
    "teacher catalog includes assigned active courses",
    catalog.data,
  );

  const eng3uManifestResponse = await check("/courseware/ENG3U/course-manifest.json", "teacher can access assigned course manifest", 200, {
    headers: { Cookie: teacherCookie },
  });
  const eng3uManifest = await eng3uManifestResponse.json();
  const firstDownload =
    eng3uManifest.courseDownloads?.find((item) => item.path) ||
    eng3uManifest.units?.flatMap((unit) => unit.lessons || []).find((lesson) => lesson.lessonPlan?.path)?.lessonPlan;
  if (firstDownload?.path) {
    const fileResponse = await check(coursewareUrl("ENG3U", firstDownload.path), "assigned course file uses X-Accel redirect transport", 200, {
      headers: { Cookie: teacherCookie },
    });
    const xAccel = fileResponse.headers.get("x-accel-redirect") || "";
    expectJson(xAccel.startsWith("/_protected_courseware/ENG3U/"), "course file response carries protected X-Accel redirect", { xAccel });
  } else {
    console.error("Could not find an ENG3U downloadable file to validate X-Accel redirect.");
    process.exitCode = 1;
  }
  await check("/courseware/MTH1W/course-manifest.json", "teacher can access second assigned active course manifest", 200, {
    headers: { Cookie: teacherCookie },
  });

  const archiveCourse = await jsonRequest("/api/admin/course-status", {
    method: "POST",
    headers: { Cookie: adminCookie },
    body: JSON.stringify({
      course: "MTH1W",
      status: "archived",
      note: "smoke test archive gate",
    }),
  });
  expectJson(archiveCourse.response.status === 200 && archiveCourse.data.course?.status === "archived", "admin archives a course", archiveCourse.data);

  const archivedCatalog = await jsonRequest("/course-catalog.json", {
    headers: { Cookie: teacherCookie },
  });
  const archivedCatalogCodes = (archivedCatalog.data.courses || []).map((course) => course.code);
  expectJson(
    archivedCatalog.response.status === 200 && archivedCatalogCodes.includes("ENG3U") && !archivedCatalogCodes.includes("MTH1W"),
    "archived course is hidden from teacher catalog",
    archivedCatalog.data,
  );
  await check("/courseware/MTH1W/course-manifest.json", "archived course manifest is locked even for assigned teacher", 423, {
    headers: { Cookie: teacherCookie },
  });

  const deleteTeacher = await jsonRequest(`/api/admin/users?username=${encodeURIComponent(teacherUsername)}`, {
    method: "DELETE",
    headers: { Cookie: adminCookie },
  });
  expectJson(
    deleteTeacher.response.status === 200 &&
      deleteTeacher.data.ok &&
      !deleteTeacher.data.users?.some((user) => user.username === teacherUsername),
    "admin deletes teacher",
    deleteTeacher.data,
  );
} finally {
  child.kill();
  await rm(usersFile, { force: true }).catch(() => {});
  await rm(courseStatusFile, { force: true }).catch(() => {});
}

if (process.exitCode) process.exit(process.exitCode);
