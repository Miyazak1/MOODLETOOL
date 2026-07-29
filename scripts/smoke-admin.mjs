import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const suppliedBaseUrl = readArg("--base-url");
const basePort = Number(readArg("--base-port") || 8894);
const baseUrl = suppliedBaseUrl || `http://127.0.0.1:${basePort}`;
const enabledPort = Number(readArg("--enabled-port") || 8892);
const token = readArg("--token") || "admin-smoke-token";
const username = readArg("--username") || "admin-smoke";
const password = readArg("--password") || "admin-smoke-password";
const smokeCourse = "ZZZSMOKE";
const emptyImportCourse = "ZZZEMPTY";
const smokeCourseRoot = resolve(process.cwd(), "..", "courseware", smokeCourse);
const emptyImportCourseRoot = resolve(process.cwd(), "..", "courseware", emptyImportCourse);
const smokeArchiveRoot = resolve(process.cwd(), "..", "courseware-archive-smoke");
const smokeCourseStatusFile = resolve(process.cwd(), "deployment", ".admin-smoke-course-status.json");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function check(url, label, expectedStatus, options = {}) {
  const response = await fetch(url, options);
  const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const ok = expectedStatuses.includes(response.status);
  console.log(`${ok ? "OK" : "FAIL"} ${response.status} ${label}`);
  if (!ok) {
    console.error(`  Expected: ${expectedStatuses.join(" or ")}`);
    console.error(`  URL: ${url}`);
    process.exitCode = 1;
  }
  return response;
}

function startEnabledServer() {
  const child = spawn("node", ["server.mjs", "--root", "dist", "--port", String(enabledPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADMIN_UPLOADS_ENABLED: "1",
      ADMIN_TOKEN: token,
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
      ADMIN_SESSION_SECRET: "admin-smoke-session-secret",
      EMBED_TOKEN_SECRET: "admin-smoke-embed-secret",
      COURSE_ARCHIVE_ROOT: smokeArchiveRoot,
      COURSE_STATUS_FILE: smokeCourseStatusFile,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  return child;
}

function startBaseServer() {
  if (suppliedBaseUrl) return null;
  return spawn("node", ["server.mjs", "--root", "dist", "--port", String(basePort)], {
    cwd: process.cwd(),
    stdio: "ignore",
    windowsHide: true,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prepareSmokeCourse() {
  await rm(smokeCourseRoot, { recursive: true, force: true });
  await mkdir(resolve(smokeCourseRoot, "plans", "course"), { recursive: true });
  await mkdir(resolve(smokeCourseRoot, "plans", "unit-plans"), { recursive: true });
  await mkdir(resolve(smokeCourseRoot, "plans", "lesson-plans"), { recursive: true });
  await writeFile(resolve(smokeCourseRoot, "plans", "course", "Introduction.md"), "# Old Smoke Introduction\n", "utf8");
  await writeFile(resolve(smokeCourseRoot, "plans", "unit-plans", "U01_Unit_Plan.md"), "# Smoke Unit Plan\n", "utf8");
  await writeFile(resolve(smokeCourseRoot, "plans", "lesson-plans", "U01_L01_Lesson_Plan.md"), "# Smoke Lesson Plan\n", "utf8");
  await writeFile(
    resolve(smokeCourseRoot, "course-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        course: { code: smokeCourse, title: "Smoke Test", audience: "Admin smoke", source: "Smoke" },
        sourceAudit: { lessonCount: 0, ispringExpected: 0, ispringComplete: 0, planningFileCount: 1 },
        navigation: { primary: "unit", secondary: "lesson" },
        courseDownloads: [
          {
            label: "Introduction.md",
            type: "md",
            category: "course_document",
            role: "introduction",
            path: "plans/course/Introduction.md",
            bytes: 25,
          },
        ],
        texts: [],
        units: [
          {
            unit: 1,
            title: "Unit 1",
            coreTexts: [],
            unitPlan: {
              label: "U01 Unit Plan.md",
              type: "md",
              category: "teacher_plan",
              role: "plan",
              path: "plans/unit-plans/U01_Unit_Plan.md",
              bytes: 18,
            },
            unitResources: {},
            summary: { downloads: 0, ispring: 0, docx: 0, pdf: 0, video: 0, h5p: 0 },
            lessons: [
              {
                id: "U1L1",
                unit: 1,
                lesson: 1,
                title: "Lesson 1",
                path: "lessons/U01L01",
                bookPageCount: 0,
                lessonText: [],
                textExports: [],
                lessonPlan: {
                  label: "U01 L01 Lesson Plan.md",
                  type: "md",
                  category: "teacher_plan",
                  role: "plan",
                  path: "plans/lesson-plans/U01_L01_Lesson_Plan.md",
                  bytes: 20,
                },
                ispring: [],
                downloads: [],
                resourceCounts: { downloads: 0, lessonPlan: 1 },
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function createSmokeIspringZip() {
  const packageRoot = resolve(smokeCourseRoot, "_smoke_zip_src");
  const zipPath = resolve(smokeCourseRoot, "_smoke_ispring.zip");
  await rm(packageRoot, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(resolve(packageRoot, "data"), { recursive: true });
  await writeFile(resolve(packageRoot, "presentation.html"), "<!doctype html><title>Smoke iSpring</title>", "utf8");
  await writeFile(resolve(packageRoot, "lms.js"), "", "utf8");
  await writeFile(resolve(packageRoot, "data", "slide1.js"), "", "utf8");
  await writeFile(resolve(packageRoot, "data", "video1.mp4"), "video", "utf8");

  if (process.platform === "win32") {
    const command = `Compress-Archive -Path '${packageRoot.replaceAll("'", "''")}\\*' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`;
    const result = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "inherit" }),
    );
    if (result.status !== 0) process.exit(result.status || 1);
  } else {
    const result = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync("zip", ["-qr", zipPath, "."], { cwd: packageRoot, stdio: "inherit" }),
    );
    if (result.status !== 0) process.exit(result.status || 1);
  }

  return zipPath;
}

async function createSmokeIspringBatchZip(innerZipPath) {
  const batchRoot = resolve(smokeCourseRoot, "_smoke_batch_src");
  const batchZipPath = resolve(smokeCourseRoot, "_smoke_ispring_batch.zip");
  await rm(batchRoot, { recursive: true, force: true });
  await rm(batchZipPath, { force: true });
  await mkdir(batchRoot, { recursive: true });
  await writeFile(resolve(batchRoot, `${smokeCourse}_U01_L01.zip`), await readFile(innerZipPath));

  if (process.platform === "win32") {
    const command = `Compress-Archive -Path '${batchRoot.replaceAll("'", "''")}\\*' -DestinationPath '${batchZipPath.replaceAll("'", "''")}' -Force`;
    const result = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "inherit" }),
    );
    if (result.status !== 0) process.exit(result.status || 1);
  } else {
    const result = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync("zip", ["-qr", batchZipPath, "."], { cwd: batchRoot, stdio: "inherit" }),
    );
    if (result.status !== 0) process.exit(result.status || 1);
  }

  return batchZipPath;
}

async function createSmokeCoursePackageZip() {
  const packageRoot = resolve(smokeCourseRoot, "_smoke_course_package_src");
  const zipPath = resolve(smokeCourseRoot, "_smoke_course_package.zip");
  await rm(packageRoot, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  await mkdir(resolve(packageRoot, "course"), { recursive: true });
  await mkdir(resolve(packageRoot, "unit-01", "lesson-01", "book_sections"), { recursive: true });
  await mkdir(resolve(packageRoot, "unit-01", "lesson-01", "html5-package"), { recursive: true });
  await mkdir(resolve(packageRoot, "unit-01", "lesson-01", "resources"), { recursive: true });
  await mkdir(resolve(packageRoot, "previews-html", "unit-01", "lesson-01", "text_export"), { recursive: true });
  await writeFile(resolve(packageRoot, "course", `${smokeCourse}_Course_Outline.md`), "# Smoke Course Outline\n", "utf8");
  await writeFile(resolve(packageRoot, "unit-01", "U01_Unit_Plan.md"), "# Imported Unit Plan\n", "utf8");
  await writeFile(resolve(packageRoot, "unit-01", "lesson-01", "U01_L01_Lesson_Plan.md"), "# Imported Lesson Plan\n", "utf8");
  await writeFile(resolve(packageRoot, "unit-01", "lesson-01", "book_sections", "02-lesson.html"), '<h1>Imported Lesson Section</h1><iframe src="../html5-package/presentation.html"></iframe>', "utf8");
  await writeFile(resolve(packageRoot, "unit-01", "lesson-01", "html5-package", "presentation.html"), "<!doctype html><title>Imported iSpring</title>", "utf8");
  await writeFile(resolve(packageRoot, "unit-01", "lesson-01", "html5-package", "lms.js"), "", "utf8");
  await writeFile(resolve(packageRoot, "previews-html", "unit-01", "lesson-01", "text_export", "complete_lesson.docx.html"), "<h1>Generated DOCX preview must not import</h1>", "utf8");
  await writeFile(resolve(packageRoot, "unit-01", "lesson-01", "resources", "U01_L01_Hands_On.mp4"), "video", "utf8");
  await writeFile(resolve(packageRoot, "unit-01", "lesson-01", "resources", "U01_L01_Worksheet.pdf"), "%PDF smoke", "utf8");

  if (process.platform === "win32") {
    const command = `Compress-Archive -Path '${packageRoot.replaceAll("'", "''")}\\*' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`;
    const result = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { stdio: "inherit" }),
    );
    if (result.status !== 0) process.exit(result.status || 1);
  } else {
    const result = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync("zip", ["-qr", zipPath, "."], { cwd: packageRoot, stdio: "inherit" }),
    );
    if (result.status !== 0) process.exit(result.status || 1);
  }

  return zipPath;
}

const baseServer = startBaseServer();
if (baseServer) {
  process.on("exit", () => baseServer.kill());
  await sleep(1500);
}

const teacherAdminResponse = await check(`${baseUrl}/teacher-admin`, "teacher admin page", 200);
const teacherAdminHtml = await teacherAdminResponse.text();
if (
  !teacherAdminHtml.includes("当前课程待处理") ||
  !teacherAdminHtml.includes("data-gap-action=\"fill\"") ||
  !teacherAdminHtml.includes("generatePreviewsButton") ||
  !teacherAdminHtml.includes("contentWorkbenchButton") ||
  !teacherAdminHtml.includes("archivePackageButton") ||
  !teacherAdminHtml.includes("refreshLifecycleJobsButton") ||
  !teacherAdminHtml.includes("applyLaunchCoursesButton") ||
  !teacherAdminHtml.includes("lifecycleFilter") ||
  !teacherAdminHtml.includes("courseLifecycleSummary") ||
  !teacherAdminHtml.includes("selectedCourseBanner") ||
  !teacherAdminHtml.includes("selectLifecycleCourse") ||
  !teacherAdminHtml.includes("selected-row")
) {
  console.error("Teacher admin page is missing required admin UI.");
  process.exitCode = 1;
}
await check(`${baseUrl}/api/admin/status?course=ENG3U`, "admin API unavailable to anonymous base server", [503, 401], {
  headers: { Authorization: `Bearer ${token}` },
});

const enabled = startEnabledServer();
try {
  await prepareSmokeCourse();
  await sleep(1500);
  const enabledUrl = `http://127.0.0.1:${enabledPort}`;
  await check(`${enabledUrl}/api/admin/status?course=ENG3U`, "admin enabled rejects anonymous status", 401);
  await check(`${enabledUrl}/api/admin/login`, "admin login rejects bad password", 401, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "wrong-password" }),
  });

  const loginResponse = await check(`${enabledUrl}/api/admin/login`, "admin login succeeds", 200, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    console.error("Missing session cookie from login response.");
    process.exitCode = 1;
    process.exit(process.exitCode);
  }

  const response = await check(`${enabledUrl}/api/admin/status?course=ENG3U`, "admin enabled session status", 200, {
    headers: { Cookie: cookie },
  });
  const data = await response.json();
  if (!data.ok || data.course !== "ENG3U" || data.lessons !== 36 || !data.storage) {
    console.error(`Unexpected admin status payload: ${JSON.stringify(data)}`);
    process.exitCode = 1;
  }
  if (
    data.readiness?.courseOutline?.ok !== true ||
    data.readiness?.lessonPlans?.missing?.length !== 0 ||
    !data.readiness?.ispring?.connected
  ) {
    console.error(`Unexpected admin readiness payload: ${JSON.stringify(data.readiness)}`);
    process.exitCode = 1;
  }

  await check(`${enabledUrl}/api/admin/history?course=ENG3U`, "admin history", 200, {
    headers: { Cookie: cookie },
  });
  const uploadResponse = await check(
    `${enabledUrl}/api/admin/upload?course=${smokeCourse}&type=course-introduction&filename=Introduction.md`,
    "admin upload backs up overwritten course document",
    200,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/octet-stream" },
      body: "# New Smoke Introduction\n",
    },
  );
  const uploadData = await uploadResponse.json();
  if (!uploadData.ok || uploadData.course !== smokeCourse || !uploadData.backups?.length) {
    console.error(`Unexpected upload backup payload: ${JSON.stringify(uploadData)}`);
    process.exitCode = 1;
  }
  const backupsResponse = await check(`${enabledUrl}/api/admin/backups?course=${smokeCourse}`, "admin backup listing", 200, {
    headers: { Cookie: cookie },
  });
  const backupsData = await backupsResponse.json();
  if (!backupsData.ok || backupsData.course !== smokeCourse || !backupsData.backups?.length || !backupsData.backups[0].files?.length) {
    console.error(`Unexpected backup listing payload: ${JSON.stringify(backupsData)}`);
    process.exitCode = 1;
  }
  const smokeZipPath = await createSmokeIspringZip();
  const smokeZip = await readFile(smokeZipPath);
  const ispringUploadResponse = await check(
    `${enabledUrl}/api/admin/upload?course=${smokeCourse}&type=ispring-zip&unit=1&lesson=1&filename=smoke-ispring.zip`,
    "admin uploads plan-only iSpring package",
    200,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/octet-stream", "Content-Length": String(smokeZip.length) },
      body: smokeZip,
    },
  );
  const ispringUploadData = await ispringUploadResponse.json();
  if (!ispringUploadData.ok || ispringUploadData.course !== smokeCourse || !String(ispringUploadData.path || "").includes("html5-package-admin")) {
    console.error(`Unexpected plan iSpring upload payload: ${JSON.stringify(ispringUploadData)}`);
    process.exitCode = 1;
  }
  const smokeBatchZipPath = await createSmokeIspringBatchZip(smokeZipPath);
  const smokeBatchZip = await readFile(smokeBatchZipPath);
  const batchUploadResponse = await check(
    `${enabledUrl}/api/admin/upload?course=${smokeCourse}&type=ispring-batch-zip&filename=smoke-ispring-batch.zip`,
    "admin uploads iSpring batch package",
    200,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/octet-stream", "Content-Length": String(smokeBatchZip.length) },
      body: smokeBatchZip,
    },
  );
  const batchUploadData = await batchUploadResponse.json();
  if (
    !batchUploadData.ok ||
    batchUploadData.course !== smokeCourse ||
    batchUploadData.batch?.installed?.length !== 1 ||
    batchUploadData.batch.installed[0].lessonId !== "U1L1" ||
    !batchUploadData.backups?.length
  ) {
    console.error(`Unexpected iSpring batch upload payload: ${JSON.stringify(batchUploadData)}`);
    process.exitCode = 1;
  }
  const smokeStatusResponse = await check(`${enabledUrl}/api/admin/status?course=${smokeCourse}`, "admin status sees plan-only iSpring", 200, {
    headers: { Cookie: cookie },
  });
  const smokeStatusData = await smokeStatusResponse.json();
  if (!smokeStatusData.ok || smokeStatusData.readiness?.ispring?.count !== 1 || smokeStatusData.readiness?.ispring?.connected !== true) {
    console.error(`Unexpected plan iSpring status payload: ${JSON.stringify(smokeStatusData)}`);
    process.exitCode = 1;
  }

  const smokeCoursePackagePath = await createSmokeCoursePackageZip();
  const smokeCoursePackage = await readFile(smokeCoursePackagePath);
  const coursePackagePreviewResponse = await check(
    `${enabledUrl}/api/admin/course-package/upload?course=${smokeCourse}&filename=smoke-course-package.zip`,
    "admin uploads whole-course package and gets import preview",
    200,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/octet-stream", "Content-Length": String(smokeCoursePackage.length) },
      body: smokeCoursePackage,
    },
  );
  const coursePackagePreview = await coursePackagePreviewResponse.json();
  if (
    !coursePackagePreview.ok ||
    !coursePackagePreview.importId ||
    coursePackagePreview.summary?.ready < 6 ||
    coursePackagePreview.summary?.bookSections !== 1 ||
    coursePackagePreview.summary?.resources < 2
  ) {
    console.error(`Unexpected course package preview payload: ${JSON.stringify(coursePackagePreview)}`);
    process.exitCode = 1;
  }
  const coursePackageCommitResponse = await check(`${enabledUrl}/api/admin/course-package/commit`, "admin commits whole-course package import", 200, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ course: smokeCourse, importId: coursePackagePreview.importId }),
  });
  const coursePackageCommit = await coursePackageCommitResponse.json();
  if (!coursePackageCommit.ok || coursePackageCommit.installed?.length < 6) {
    console.error(`Unexpected course package commit payload: ${JSON.stringify(coursePackageCommit)}`);
    process.exitCode = 1;
  }
  const importedManifestResponse = await check(`${enabledUrl}/courseware/${smokeCourse}/course-manifest.json`, "whole-course package updates manifest", 200);
  const importedManifest = await importedManifestResponse.json();
  const importedLesson = importedManifest.units?.[0]?.lessons?.[0];
  if (
    !importedManifest.courseDownloads?.some((item) => item.role === "course_outline") ||
    !importedManifest.units?.[0]?.unitPlan?.path?.includes("U01_Unit_Plan") ||
    !importedLesson?.lessonPlan?.path?.includes("U01_L01_Lesson_Plan") ||
    !importedLesson?.bookSections?.some((item) => item.path?.endsWith("book_sections/02-lesson.html")) ||
    importedLesson?.bookSections?.some((item) => item.path?.includes("complete_lesson")) ||
    !importedLesson?.ispring?.some((item) => item.path?.endsWith("html5-package/presentation.html")) ||
    !importedLesson?.downloads?.some((item) => item.type === "mp4") ||
    !importedLesson?.downloads?.some((item) => item.type === "pdf")
  ) {
    console.error(`Unexpected imported course manifest: ${JSON.stringify(importedManifest, null, 2)}`);
    process.exitCode = 1;
  }

  await rm(emptyImportCourseRoot, { recursive: true, force: true });
  await mkdir(emptyImportCourseRoot, { recursive: true });
  const emptyCoursePreviewResponse = await check(
    `${enabledUrl}/api/admin/course-package/upload?course=${emptyImportCourse}&filename=empty-course-package.zip`,
    "admin previews whole-course package without existing manifest",
    200,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/octet-stream", "Content-Length": String(smokeCoursePackage.length) },
      body: smokeCoursePackage,
    },
  );
  const emptyCoursePreview = await emptyCoursePreviewResponse.json();
  if (!emptyCoursePreview.ok || !emptyCoursePreview.importId || emptyCoursePreview.summary?.ready < 6) {
    console.error(`Unexpected empty course package preview payload: ${JSON.stringify(emptyCoursePreview)}`);
    process.exitCode = 1;
  }
  const emptyCourseCommitResponse = await check(`${enabledUrl}/api/admin/course-package/commit`, "admin commits whole-course package without existing manifest", 200, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ course: emptyImportCourse, importId: emptyCoursePreview.importId }),
  });
  const emptyCourseCommit = await emptyCourseCommitResponse.json();
  if (!emptyCourseCommit.ok || emptyCourseCommit.installed?.length < 6) {
    console.error(`Unexpected empty course package commit payload: ${JSON.stringify(emptyCourseCommit)}`);
    process.exitCode = 1;
  }
  const emptyImportedManifestResponse = await check(`${enabledUrl}/courseware/${emptyImportCourse}/course-manifest.json`, "empty course package writes new manifest", 200);
  const emptyImportedManifest = await emptyImportedManifestResponse.json();
  const emptyImportedLesson = emptyImportedManifest.units?.[0]?.lessons?.[0];
  if (
    emptyImportedManifest.course?.code !== emptyImportCourse ||
    !emptyImportedLesson?.downloads?.length ||
    !emptyImportedLesson?.bookSections?.some((item) => item.path?.endsWith("book_sections/02-lesson.html")) ||
    emptyImportedLesson?.bookSections?.some((item) => item.path?.includes("complete_lesson")) ||
    !emptyImportedLesson?.ispring?.some((item) => item.path?.endsWith("html5-package/presentation.html"))
  ) {
    console.error(`Unexpected empty imported course manifest: ${JSON.stringify(emptyImportedManifest, null, 2)}`);
    process.exitCode = 1;
  }

  const moodleEmbedsResponse = await check(`${enabledUrl}/api/admin/moodle-embeds?course=${smokeCourse}`, "admin generates Moodle embed codes", 200, {
    headers: { Cookie: cookie },
  });
  const moodleEmbedsData = await moodleEmbedsResponse.json();
  const ispringEmbed = moodleEmbedsData.rows?.find((row) => row.kind === "ispring");
  if (
    !moodleEmbedsData.ok ||
    !ispringEmbed?.moodleHtml?.startsWith("[portal_iframe ") ||
    !ispringEmbed.moodleHtml.includes("/embed/ispring/") ||
    /sandbox\s*=/i.test(ispringEmbed?.moodleIframeHtml || "") ||
    !ispringEmbed.embedUrl
  ) {
    console.error(`Unexpected Moodle embed payload: ${JSON.stringify(moodleEmbedsData)}`);
    process.exitCode = 1;
  } else {
    const embedResponse = await check(ispringEmbed.embedUrl, "signed Moodle iSpring embed opens", 200);
    const embedHtml = await embedResponse.text();
    if (!embedHtml.includes("<base ") || !embedHtml.includes("/embed/t/") || !embedHtml.includes("window.ispringPresentationConnector") || !embedHtml.includes("Smoke iSpring")) {
      console.error(`Unexpected signed embed HTML: ${embedHtml.slice(0, 500)}`);
      process.exitCode = 1;
    }
  }

  const lifecycleJobResponse = await check(`${enabledUrl}/api/admin/course-lifecycle-jobs`, "admin starts course archive lifecycle job", 202, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ course: smokeCourse, action: "archive", setArchived: false }),
  });
  const lifecycleJobData = await lifecycleJobResponse.json();
  if (!lifecycleJobData.ok || lifecycleJobData.job?.action !== "archive" || lifecycleJobData.job?.course !== smokeCourse) {
    console.error(`Unexpected lifecycle job start payload: ${JSON.stringify(lifecycleJobData)}`);
    process.exitCode = 1;
  }
  let completedLifecycleJob = null;
  for (let index = 0; index < 10; index += 1) {
    await sleep(700);
    const jobsResponse = await check(`${enabledUrl}/api/admin/course-lifecycle-jobs`, "admin lifecycle job listing", 200, {
      headers: { Cookie: cookie },
    });
    const jobsData = await jobsResponse.json();
    completedLifecycleJob = jobsData.jobs?.find((job) => job.id === lifecycleJobData.job.id);
    if (completedLifecycleJob && completedLifecycleJob.status !== "running") break;
  }
  if (
    !completedLifecycleJob ||
    completedLifecycleJob.status !== "completed" ||
    !completedLifecycleJob.payload?.archive?.hasManifest ||
    !completedLifecycleJob.payload?.archivePath
  ) {
    console.error(`Unexpected lifecycle job completion payload: ${JSON.stringify(completedLifecycleJob)}`);
    process.exitCode = 1;
  }

  await mkdir(resolve(smokeCourseRoot, "_admin_uploads", "incoming"), { recursive: true });
  await writeFile(resolve(smokeCourseRoot, "_admin_uploads", "incoming", "stale.tmp"), "stale incoming upload", "utf8");
  const smokeCleanupResponse = await check(`${enabledUrl}/api/admin/cleanup?course=${smokeCourse}&mode=temp`, "admin temp cleanup removes incoming uploads", 200, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const smokeCleanupData = await smokeCleanupResponse.json();
  if (!smokeCleanupData.ok || smokeCleanupData.removedBytes <= 0 || !smokeCleanupData.removed?.some((item) => item.includes("incoming"))) {
    console.error(`Unexpected smoke temp cleanup payload: ${JSON.stringify(smokeCleanupData)}`);
    process.exitCode = 1;
  }
  const readinessResponse = await check(`${enabledUrl}/api/admin/readiness`, "admin all-course readiness", 200, {
    headers: { Cookie: cookie },
  });
  const readinessData = await readinessResponse.json();
  const eng3u = readinessData.courses?.find((course) => course.code === "ENG3U");
  if (
    !readinessData.ok ||
    readinessData.courseCount < 27 ||
    !eng3u ||
    eng3u.readiness?.courseOutline?.ok !== true ||
    !eng3u.readiness?.ispring?.connected
  ) {
    console.error(`Unexpected all-course readiness payload: ${JSON.stringify(readinessData)}`);
    process.exitCode = 1;
  }
  const uploadGapsResponse = await check(`${enabledUrl}/api/admin/upload-gaps`, "admin upload gap checklist", 200, {
    headers: { Cookie: cookie },
  });
  const uploadGapsData = await uploadGapsResponse.json();
  if (
    !uploadGapsData.ok ||
    uploadGapsData.courseCount < 27 ||
    uploadGapsData.summary?.directUploads < 1 ||
    uploadGapsData.uploadItems?.some((item) => item.course === "ENG3U" && item.uploadType === "course-outline") ||
    !uploadGapsData.uploadItems?.some((item) => item.course !== "ENG3U" && item.uploadType)
  ) {
    console.error(`Unexpected upload gap checklist payload: ${JSON.stringify(uploadGapsData)}`);
    process.exitCode = 1;
  }
  const workbenchResponse = await check(`${enabledUrl}/api/admin/content-workbench`, "admin content workbench", 200, {
    headers: { Cookie: cookie },
  });
  const workbenchData = await workbenchResponse.json();
  if (
    !workbenchData.ok ||
    workbenchData.totals?.courses < 27 ||
    !Array.isArray(workbenchData.rows) ||
    !workbenchData.rows.some((item) => item.course === "ENG3U")
  ) {
    console.error(`Unexpected content workbench payload: ${JSON.stringify(workbenchData)}`);
    process.exitCode = 1;
  }
  await check(`${enabledUrl}/api/admin/cleanup?course=ENG3U&mode=temp`, "admin temp cleanup", 200, {
    method: "POST",
    headers: { Cookie: cookie },
  });

  await check(`${enabledUrl}/api/admin/status?course=ENG3U`, "admin token fallback status", 200, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const launchAllowlistResponse = await check(`${enabledUrl}/api/admin/course-status/launch-allowlist`, "admin applies launch course allowlist", 200, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ courses: ["ENG3U", "ESLEO"], note: "smoke launch allowlist" }),
  });
  const launchAllowlistData = await launchAllowlistResponse.json();
  if (
    !launchAllowlistData.ok ||
    launchAllowlistData.activeCourseCount !== 2 ||
    launchAllowlistData.archivedCourseCount < 1 ||
    !launchAllowlistData.launchCourses?.includes("ENG3U") ||
    !launchAllowlistData.launchCourses?.includes("ESLEO")
  ) {
    console.error(`Unexpected launch allowlist payload: ${JSON.stringify(launchAllowlistData)}`);
    process.exitCode = 1;
  }
  const lifecycleAfterAllowlistResponse = await check(`${enabledUrl}/api/admin/course-status`, "admin lifecycle after launch allowlist", 200, {
    headers: { Cookie: cookie },
  });
  const lifecycleAfterAllowlistData = await lifecycleAfterAllowlistResponse.json();
  const eng3uLifecycle = lifecycleAfterAllowlistData.courses?.find((course) => course.code === "ENG3U");
  const mth1wLifecycle = lifecycleAfterAllowlistData.courses?.find((course) => course.code === "MTH1W");
  if (eng3uLifecycle?.status !== "active" || mth1wLifecycle?.status !== "archived") {
    console.error(`Unexpected lifecycle after allowlist: ${JSON.stringify({ eng3uLifecycle, mth1wLifecycle })}`);
    process.exitCode = 1;
  }
} finally {
  enabled.kill();
  await rm(smokeCourseRoot, { recursive: true, force: true });
  await rm(emptyImportCourseRoot, { recursive: true, force: true });
  await rm(smokeArchiveRoot, { recursive: true, force: true });
  await rm(smokeCourseStatusFile, { force: true });
  baseServer?.kill();
}

if (process.exitCode) process.exit(process.exitCode);
