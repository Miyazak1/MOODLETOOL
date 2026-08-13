import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".cdn-assets-smoke");
const secret = "cdn-assets-smoke-secret-0123456789";
const cdnBaseUrl = "https://cdn.example.test/courseware-active";

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function signEmbedPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function encodePathSegments(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function prepareCourseware() {
  assertInside(projectRoot, smokeRoot, "smoke root");
  if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
  const courseRoot = join(smokeRoot, "courseware", "SMOKE");
  const packageRoot = join(courseRoot, "Unit 1", "Lesson 1", "html5-package");
  mkdirSync(join(packageRoot, "data"), { recursive: true });
  writeFileSync(
    join(packageRoot, "presentation.html"),
    '<!doctype html><html><head><title>Smoke</title><script src="data/slide.js"></script></head><body>Smoke iSpring</body></html>',
    "utf8",
  );
  writeFileSync(join(packageRoot, "data", "slide.js"), "console.log('slide');\n", "utf8");
  writeFileSync(join(courseRoot, "video.mp4"), "video", "utf8");
  writeFileSync(join(courseRoot, "course-manifest.json"), '{"schemaVersion":1,"course":{"code":"SMOKE"},"units":[]}\n', "utf8");

  const registryPath = join(smokeRoot, "asset-registry.json");
  writeFileSync(
    registryPath,
    `${JSON.stringify(
      {
        assets: [
          {
            objectKey: "courseware-active/SMOKE/Unit 1/Lesson 1/html5-package/presentation.html",
            cdnUrl: `${cdnBaseUrl}/SMOKE/Unit%201/Lesson%201/html5-package/presentation.html`,
          },
          {
            objectKey: "courseware-active/SMOKE/video.mp4",
            cdnUrl: `${cdnBaseUrl}/SMOKE/video.mp4`,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    coursewareRoot: join(smokeRoot, "courseware"),
    registryPath,
  };
}

async function withServer({ port, mode, coursewareRoot, registryPath }, fn) {
  const server = spawn("node", ["server.mjs", "--root", "dist", "--port", String(port)], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PORTAL_AUTH_ENABLED: "0",
      COURSE_ACTIVE_ROOT: coursewareRoot,
      EMBED_TOKEN_SECRET: secret,
      COURSEWARE_ASSET_MODE: mode,
      COURSEWARE_ASSET_BASE_URL: cdnBaseUrl,
      COURSEWARE_ASSET_REGISTRY_FILE: registryPath,
    },
  });
  try {
    await sleep(900);
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.kill();
    await sleep(100);
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function assertLocalMode(baseUrl) {
  const ispringPath = "Unit 1/Lesson 1/html5-package/presentation.html";
  const token = signEmbedPayload({
    v: 1,
    course: "SMOKE",
    kind: "ispring",
    lessonId: "U01L01",
    path: ispringPath,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const html = await fetchText(`${baseUrl}/embed/ispring/SMOKE/U01L01/test?token=${encodeURIComponent(token)}`);
  if (!html.includes("/embed/t/")) throw new Error("Expected local mode iSpring base to use /embed/t/.");
  if (html.includes(cdnBaseUrl)) throw new Error("Local mode should not emit CDN base URLs.");
  const directHtml = await fetchText(`${baseUrl}/courseware/SMOKE/${encodePathSegments(ispringPath)}`);
  if (directHtml.includes(cdnBaseUrl)) throw new Error("Local mode direct iSpring page should not emit CDN base URLs.");

  const videoToken = signEmbedPayload({
    v: 1,
    course: "SMOKE",
    kind: "video",
    lessonId: "U01L01",
    path: "video.mp4",
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const videoHtml = await fetchText(`${baseUrl}/embed/video/SMOKE/U01L01/video?token=${encodeURIComponent(videoToken)}`);
  if (!videoHtml.includes("/embed/t/")) throw new Error("Expected local mode video source to use /embed/t/.");
  if (videoHtml.includes(cdnBaseUrl)) throw new Error("Local mode video should not emit CDN URLs.");
}

async function assertCdnMode(baseUrl) {
  const ispringPath = "Unit 1/Lesson 1/html5-package/presentation.html";
  const token = signEmbedPayload({
    v: 1,
    course: "SMOKE",
    kind: "ispring",
    lessonId: "U01L01",
    path: ispringPath,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const html = await fetchText(`${baseUrl}/embed/ispring/SMOKE/U01L01/test?token=${encodeURIComponent(token)}`);
  const expectedBase = `${cdnBaseUrl}/SMOKE/${encodePathSegments(dirname(ispringPath))}/`;
  if (!html.includes(`<base href="${expectedBase}">`)) throw new Error(`Expected CDN iSpring base: ${expectedBase}`);
  const directHtml = await fetchText(`${baseUrl}/courseware/SMOKE/${encodePathSegments(ispringPath)}`);
  if (!directHtml.includes(`<base href="${expectedBase}">`)) throw new Error(`Expected direct CDN iSpring base: ${expectedBase}`);

  const videoToken = signEmbedPayload({
    v: 1,
    course: "SMOKE",
    kind: "video",
    lessonId: "U01L01",
    path: "video.mp4",
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const videoHtml = await fetchText(`${baseUrl}/embed/video/SMOKE/U01L01/video?token=${encodeURIComponent(videoToken)}`);
  if (!videoHtml.includes(`${cdnBaseUrl}/SMOKE/video.mp4`)) throw new Error("Expected CDN video source.");
}

async function assertHybridMode(baseUrl) {
  const ispringPath = "Unit 1/Lesson 1/html5-package/presentation.html";
  const expectedBase = `${cdnBaseUrl}/SMOKE/${encodePathSegments(dirname(ispringPath))}/`;
  const directHtml = await fetchText(`${baseUrl}/courseware/SMOKE/${encodePathSegments(ispringPath)}`);
  if (!directHtml.includes(`<base href="${expectedBase}">`)) throw new Error(`Expected hybrid direct CDN iSpring base: ${expectedBase}`);

  const registeredToken = signEmbedPayload({
    v: 1,
    course: "SMOKE",
    kind: "video",
    lessonId: "U01L01",
    path: "video.mp4",
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const registeredHtml = await fetchText(`${baseUrl}/embed/video/SMOKE/U01L01/video?token=${encodeURIComponent(registeredToken)}`);
  if (!registeredHtml.includes(`${cdnBaseUrl}/SMOKE/video.mp4`)) throw new Error("Expected registered hybrid asset to use CDN.");

  const missingToken = signEmbedPayload({
    v: 1,
    course: "SMOKE",
    kind: "video",
    lessonId: "U01L01",
    path: "missing.mp4",
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const missingHtml = await fetchText(`${baseUrl}/embed/video/SMOKE/U01L01/missing?token=${encodeURIComponent(missingToken)}`);
  if (!missingHtml.includes("/embed/t/")) throw new Error("Expected unregistered hybrid asset to fall back to local token URL.");
  if (missingHtml.includes(`${cdnBaseUrl}/SMOKE/missing.mp4`)) throw new Error("Hybrid mode should not emit CDN URLs for unregistered assets.");
}

const { coursewareRoot, registryPath } = prepareCourseware();
try {
  await withServer({ port: 8995, mode: "local", coursewareRoot, registryPath }, assertLocalMode);
  await withServer({ port: 8996, mode: "cdn", coursewareRoot, registryPath }, assertCdnMode);
  await withServer({ port: 8997, mode: "hybrid", coursewareRoot, registryPath }, assertHybridMode);
  console.log("CDN asset smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
}
