import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const course = "ZZZCOURSEOVERVIEWISPRING";
const courseRoot = resolve(projectRoot, "..", "courseware", course);
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8898);
const baseUrl = `http://127.0.0.1:${port}`;
const username = "course-overview-ispring-smoke";
const password = "course-overview-ispring-password";

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function check(url, label, expectedStatus, options = {}) {
  const response = await fetch(url, options);
  if (response.status !== expectedStatus) {
    throw new Error(`${label} returned ${response.status}, expected ${expectedStatus}: ${await response.text()}`);
  }
  return response;
}

async function prepareCourse() {
  await rm(courseRoot, { recursive: true, force: true });
  await mkdir(resolve(courseRoot, "course-sections", "course-overview"), { recursive: true });
  await mkdir(resolve(courseRoot, "ispring-localized", "unit-00", "course-overview", "js"), { recursive: true });
  await mkdir(resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "data"), { recursive: true });
  await writeFile(
    resolve(courseRoot, "course-sections", "course-overview", "index.html"),
    '<!doctype html><iframe class="localized-ispring" src="../../ispring-localized/unit-00/course-overview/presentation.html"></iframe>',
    "utf8",
  );
  await writeFile(
    resolve(courseRoot, "ispring-localized", "unit-00", "course-overview", "presentation.html"),
    `<!doctype html>
<html>
  <head>
    <script src="./js/luxon.js"></script>
    <script src="./js/index.js"></script>
    <script>window.onload = () => Preview.createPlayer("{}", "en-US");</script>
  </head>
  <body>Course Overview iSpring</body>
</html>`,
    "utf8",
  );
  await writeFile(resolve(courseRoot, "ispring-localized", "unit-00", "course-overview", "js", "luxon.js"), "window.luxon = {};", "utf8");
  await writeFile(
    resolve(courseRoot, "ispring-localized", "unit-00", "course-overview", "js", "index.js"),
    "function UFe(){let t=parent.window;t.history.replaceState(null,'','/')} function Sfe(){return parent.window.location.hash} window.Preview={createPlayer(){}};",
    "utf8",
  );
  await writeFile(
    resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "presentation.html"),
    '<!doctype html><html><head><script src="lms.js"></script></head><body><script src="data/browsersupport.js"></script><script src="data/player.js"></script><script>PresentationPlayer.start("{}", "content", "playerView", function(){}, null);</script></body></html>',
    "utf8",
  );
  await writeFile(resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "lms.js"), "window.lmsLoaded = true;", "utf8");
  await writeFile(resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "data", "browsersupport.js"), "window.browserSupportLoaded = true;", "utf8");
  await writeFile(resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "data", "player.js"), "window.PresentationPlayer={start(){}};", "utf8");
  await writeFile(
    resolve(courseRoot, "course-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        course: { code: course, title: "Course Overview iSpring Smoke", audience: "Smoke", source: "Smoke" },
        sourceAudit: { lessonCount: 1, ispringExpected: 2, ispringComplete: 2 },
        navigation: { primary: "unit", secondary: "lesson" },
        courseDownloads: [],
        courseSections: [
          {
            label: "Course Overview",
            type: "html",
            category: "moodle_course_section",
            role: "course_overview",
            path: "course-sections/course-overview/index.html",
            ispring: [
              {
                label: "Course Overview iSpring",
                type: "ispring",
                category: "ispring",
                mode: "page",
                path: "ispring-localized/unit-00/course-overview/presentation.html",
                packagePath: "ispring-localized/unit-00/course-overview",
                role: "course_overview_ispring",
              },
            ],
          },
        ],
        texts: [],
        units: [
          {
            unit: 1,
            title: "Unit 1",
            summary: { downloads: 0, ispring: 1, docx: 0, pdf: 0, video: 0, h5p: 0 },
            lessons: [
              {
                id: "U01L01",
                unit: 1,
                lesson: 1,
                title: "Lesson iSpring",
                path: "Unit 1/Lesson 1",
                downloads: [],
                handsOn: [],
                bookSections: [],
                ispring: [
                  {
                    label: "Traditional Lesson iSpring",
                    type: "ispring",
                    category: "ispring",
                    mode: "page",
                    path: "ispring-localized/unit-01/U01L01/presentation.html",
                    packagePath: "ispring-localized/unit-01/U01L01",
                    role: "lesson_ispring",
                  },
                ],
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

function startServer() {
  return spawn("node", ["server.mjs", "--root", "dist", "--port", String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ADMIN_UPLOADS_ENABLED: "1",
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
      ADMIN_SESSION_SECRET: "course-overview-ispring-smoke-session",
      EMBED_TOKEN_SECRET: "course-overview-ispring-smoke-embed",
    },
    stdio: "ignore",
    windowsHide: true,
  });
}

await prepareCourse();
const server = startServer();
try {
  await sleep(1200);
  const login = await check(`${baseUrl}/api/admin/login`, "admin login", 200, {
    body: JSON.stringify({ username, password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login did not return a session cookie.");

  const response = await check(`${baseUrl}/api/admin/moodle-embeds?course=${course}`, "Moodle embed rows", 200, {
    headers: { Cookie: cookie },
  });
  const data = await response.json();
  const overviewRow = data.rows?.find((item) => item.kind === "ispring" && item.lessonId === "COURSE" && item.path === "ispring-localized/unit-00/course-overview/presentation.html");
  const lessonRow = data.rows?.find((item) => item.kind === "ispring" && item.lessonId === "U01L01" && item.path === "ispring-localized/unit-01/U01L01/presentation.html");
  if (!overviewRow) throw new Error(`Course overview iSpring embed row missing: ${JSON.stringify(data)}`);
  if (!lessonRow) throw new Error(`Traditional lesson iSpring embed row missing: ${JSON.stringify(data)}`);

  const overviewEmbed = await check(overviewRow.embedUrl, "course overview iSpring embed wrapper", 200);
  const overviewHtml = await overviewEmbed.text();
  if (!overviewHtml.includes("<iframe") || !overviewHtml.includes("/embed/t/") || overviewHtml.includes("Preview.createPlayer")) {
    throw new Error(`Course overview iSpring should return a same-origin wrapper, got: ${overviewHtml.slice(0, 500)}`);
  }
  const wrapperSrc = /<iframe[\s\S]*?\bsrc="([^"]+)"/i.exec(overviewHtml)?.[1];
  if (!wrapperSrc?.startsWith("/embed/t/")) throw new Error(`Unexpected wrapper iframe src: ${wrapperSrc}`);
  const rawOverview = await check(`${baseUrl}${wrapperSrc}`, "course overview tokenized iSpring page", 200);
  const rawOverviewHtml = await rawOverview.text();
  if (!rawOverviewHtml.includes("Preview.createPlayer") || !rawOverviewHtml.includes("window.ispringPresentationConnector")) {
    throw new Error(`Tokenized overview iSpring page is missing expected player content: ${rawOverviewHtml.slice(0, 500)}`);
  }
  const overviewBaseHref = /<base href="([^"]+)"/.exec(rawOverviewHtml)?.[1];
  if (!overviewBaseHref?.includes("/embed/t/")) throw new Error(`Tokenized overview page is missing an embed base: ${rawOverviewHtml.slice(0, 500)}`);
  const overviewScript = await check(new URL("js/index.js", `${baseUrl}${overviewBaseHref}`).toString(), "course overview tokenized iSpring script", 200);
  const overviewScriptText = await overviewScript.text();
  if (!overviewScriptText.includes("parent.window.location.hash")) {
    throw new Error(`Course overview script should not be globally rewritten: ${overviewScriptText}`);
  }

  const lessonEmbed = await check(lessonRow.embedUrl, "traditional lesson iSpring embed", 200);
  const lessonHtml = await lessonEmbed.text();
  if (lessonHtml.includes("<iframe") || !lessonHtml.includes("PresentationPlayer.start") || !lessonHtml.includes("window.ispringPresentationConnector")) {
    throw new Error(`Traditional lesson iSpring should keep the raw player page: ${lessonHtml.slice(0, 500)}`);
  }
  const lessonBaseHref = /<base href="([^"]+)"/.exec(lessonHtml)?.[1];
  if (!lessonBaseHref?.includes("/embed/t/")) throw new Error(`Traditional lesson page is missing an embed base: ${lessonHtml.slice(0, 500)}`);
  await check(new URL("lms.js", `${baseUrl}${lessonBaseHref}`).toString(), "traditional lesson lms.js", 200);
  await check(new URL("data/browsersupport.js", `${baseUrl}${lessonBaseHref}`).toString(), "traditional lesson browsersupport.js", 200);
  await check(new URL("data/player.js", `${baseUrl}${lessonBaseHref}`).toString(), "traditional lesson player.js", 200);

  console.log("Course overview iSpring embed smoke passed.");
} finally {
  server.kill();
  if (!process.argv.includes("--keep-output")) await rm(courseRoot, { recursive: true, force: true });
}
