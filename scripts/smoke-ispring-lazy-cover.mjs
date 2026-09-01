import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const course = "ZZZISPRINGLAZYCOVER";
const courseRoot = resolve(projectRoot, "..", "courseware", course);
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : 8902);
const baseUrl = `http://127.0.0.1:${port}`;
const username = "ispring-lazy-cover-smoke";
const password = "ispring-lazy-cover-password";

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
  await mkdir(resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "data"), { recursive: true });
  await writeFile(
    resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "presentation.html"),
    '<!doctype html><html><head><script src="lms.js"></script></head><body><script src="data/player.js"></script><script>PresentationPlayer.start("{}", "content", "playerView", function(){}, null);</script><main>Lazy cover smoke iSpring</main></body></html>',
    "utf8",
  );
  await writeFile(resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "lms.js"), "window.lmsLoaded = true;", "utf8");
  await writeFile(resolve(courseRoot, "ispring-localized", "unit-01", "U01L01", "data", "player.js"), "window.PresentationPlayer={start(){}};", "utf8");
  await writeFile(
    resolve(courseRoot, "course-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        course: { code: course, title: "iSpring Lazy Cover Smoke", audience: "Smoke", source: "Smoke" },
        sourceAudit: { lessonCount: 1, ispringExpected: 1, ispringComplete: 1 },
        navigation: { primary: "unit", secondary: "lesson" },
        courseDownloads: [],
        courseSections: [],
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
                    label: "Lazy Cover iSpring",
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
      ADMIN_SESSION_SECRET: "ispring-lazy-cover-smoke-session",
      EMBED_TOKEN_SECRET: "ispring-lazy-cover-smoke-embed",
      ISPRING_EMBED_LAZY_COVER: "1",
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

  const rowsResponse = await check(`${baseUrl}/api/admin/moodle-embeds?course=${course}`, "Moodle embed rows", 200, {
    headers: { Cookie: cookie },
  });
  const data = await rowsResponse.json();
  const row = data.rows?.find((item) => item.kind === "ispring" && item.lessonId === "U01L01");
  if (!row?.embedUrl) throw new Error(`iSpring embed row missing: ${JSON.stringify(data)}`);

  const coverResponse = await check(row.embedUrl, "lazy iSpring cover", 200);
  const coverHtml = await coverResponse.text();
  if (!coverHtml.includes("Lazy Cover iSpring") || !coverHtml.includes("id=\"playButton\"")) {
    throw new Error(`Lazy cover is missing expected launch UI: ${coverHtml.slice(0, 500)}`);
  }
  if (coverHtml.includes("<iframe") || coverHtml.includes("PresentationPlayer.start")) {
    throw new Error(`Lazy cover should not eagerly render the iSpring player: ${coverHtml.slice(0, 500)}`);
  }
  const target = /var target = "([^"]+)"/.exec(coverHtml)?.[1];
  if (!target?.startsWith("/embed/t/")) throw new Error(`Lazy cover did not expose a tokenized player target: ${coverHtml.slice(0, 500)}`);

  const targetResponse = await check(`${baseUrl}${target}`, "lazy cover click target", 200);
  const targetHtml = await targetResponse.text();
  if (!targetHtml.includes("PresentationPlayer.start") || !targetHtml.includes("window.ispringPresentationConnector")) {
    throw new Error(`Lazy cover click target is missing player content: ${targetHtml.slice(0, 500)}`);
  }

  const bypassUrl = `${row.embedUrl}&lazy=0`;
  const bypassResponse = await check(bypassUrl, "lazy cover bypass", 200);
  const bypassHtml = await bypassResponse.text();
  if (!bypassHtml.includes("PresentationPlayer.start") || !bypassHtml.includes("window.ispringPresentationConnector")) {
    throw new Error(`lazy=0 should preserve the original immediate player response: ${bypassHtml.slice(0, 500)}`);
  }

  console.log("iSpring lazy cover smoke passed.");
} finally {
  server.kill();
  if (!process.argv.includes("--keep-output")) await rm(courseRoot, { recursive: true, force: true });
}
