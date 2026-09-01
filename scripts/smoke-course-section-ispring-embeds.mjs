import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const course = "ZZZCOURSESECTIONISPRING";
const courseRoot = resolve(projectRoot, "..", "courseware", course);
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8897);
const baseUrl = `http://127.0.0.1:${port}`;
const username = "course-section-ispring-smoke";
const password = "course-section-ispring-password";

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
  await mkdir(resolve(courseRoot, "ispring-localized", "unit-00", "course-overview"), { recursive: true });
  await mkdir(resolve(courseRoot, "ispring-localized", "unit-00", "course-overview", "js"), { recursive: true });
  await writeFile(
    resolve(courseRoot, "course-sections", "course-overview", "index.html"),
    '<!doctype html><iframe class="localized-ispring" src="../../ispring-localized/unit-00/course-overview/presentation.html"></iframe>',
    "utf8",
  );
  await writeFile(
    resolve(courseRoot, "ispring-localized", "unit-00", "course-overview", "presentation.html"),
    '<!doctype html><head><base href="./"><title>Course Overview iSpring</title><script src="./js/index.js"></script></head><body>Course Overview iSpring</body>',
    "utf8",
  );
  await writeFile(
    resolve(courseRoot, "ispring-localized", "unit-00", "course-overview", "js", "index.js"),
    "function readPreviewHash(){return parent.window.location.hash;} const previewWindow = parent.window;",
    "utf8",
  );
  await writeFile(
    resolve(courseRoot, "course-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        course: { code: course, title: "Course Section iSpring Smoke", audience: "Smoke", source: "Smoke" },
        sourceAudit: { lessonCount: 0, ispringExpected: 1, ispringComplete: 1 },
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
                mode: "page",
                path: "ispring-localized/unit-00/course-overview/presentation.html",
                packagePath: "ispring-localized/unit-00/course-overview",
                role: "course_overview_ispring",
              },
            ],
          },
        ],
        texts: [],
        units: [],
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
      ADMIN_SESSION_SECRET: "course-section-ispring-smoke-session",
      EMBED_TOKEN_SECRET: "course-section-ispring-smoke-embed",
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
  const row = data.rows?.find((item) => item.kind === "ispring" && item.path === "ispring-localized/unit-00/course-overview/presentation.html");
  if (!row) throw new Error(`Course overview iSpring embed row missing: ${JSON.stringify(data)}`);
  if (!row.embedUrl?.includes(`/embed/ispring/${course}/COURSE/`)) throw new Error(`Unexpected embed URL: ${row.embedUrl}`);
  if (!row.moodleShortcode?.startsWith("[portal_iframe ") || !row.moodleShortcode.includes("/embed/ispring/")) {
    throw new Error(`Unexpected shortcode: ${row.moodleShortcode}`);
  }
  const embed = await check(row.embedUrl, "signed course overview iSpring embed", 200);
  const html = await embed.text();
  if (!html.includes("window.ispringPresentationConnector") || !html.includes("/embed/t/")) {
    throw new Error(`Signed embed is missing compatibility wrapper: ${html.slice(0, 500)}`);
  }
  const baseHref = /<base href="([^"]+)"/.exec(html)?.[1];
  if (!baseHref) throw new Error(`Signed embed is missing tokenized base href: ${html.slice(0, 500)}`);
  if (baseHref === "./" || !baseHref.includes("/embed/t/")) {
    throw new Error(`Signed embed did not replace the package base href: ${html.slice(0, 500)}`);
  }
  const scriptResponse = await check(new URL("js/index.js", `${baseUrl}${baseHref}`).toString(), "tokenized iSpring script", 200);
  const script = await scriptResponse.text();
  if (script.includes("parent.window.location.hash") || script.includes("parent.window;")) {
    throw new Error(`iSpring embed script still accesses parent window: ${script}`);
  }
  if (!script.includes("window.location.hash") || !script.includes("previewWindow=window")) {
    throw new Error(`iSpring embed script was not patched as expected: ${script}`);
  }
  console.log("Course section iSpring embed smoke passed.");
} finally {
  server.kill();
  if (!process.argv.includes("--keep-output")) await rm(courseRoot, { recursive: true, force: true });
}
