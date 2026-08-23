import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".bbi2o-video-activity-smoke");
const port = 8999;
const secret = "bbi2o-video-activity-smoke-secret-0123456789";
const cdnBaseUrl = "https://cdn.example.test/courseware-active";
const videoRelPath = "localized-moodle-activities/folder/U01L09-6877-6877-414d9a4ff2/files/U1L6-Ethical-Dilemma-video-1.mp4";
const activityRelPath = "localized-moodle-activities/folder/U01L09-6877-6877-414d9a4ff2/index.html";
const videoSha = "3a60cf82af820fe59242ef5bef1fd85a16934f69e25697e27c7368e5ab69b136";

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !/^[A-Za-z]:/.test(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function encodePathSegments(value) {
  return String(value || "").split("/").map(encodeURIComponent).join("/");
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function signEmbedPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

assertInside(projectRoot, smokeRoot, "smoke root");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });

const coursewareRoot = join(smokeRoot, "courseware");
const courseRoot = join(coursewareRoot, "BBI2O");
mkdirSync(join(courseRoot, "localized-moodle-activities", "folder", "U01L09-6877-6877-414d9a4ff2", "files"), { recursive: true });
writeFileSync(join(courseRoot, "course-manifest.json"), '{"schemaVersion":1,"course":{"code":"BBI2O"},"units":[]}\n', "utf8");
writeFileSync(join(courseRoot, videoRelPath), Buffer.alloc(4096, 1));
writeFileSync(
  join(courseRoot, activityRelPath),
  `<!doctype html><html><head><title>BBI2O</title></head><body>
<div class="video-open-list" data-bbi2o-video-link="true">
  <a class="video-open-card" href="files/U1L6-Ethical-Dilemma-video-1.mp4" target="_blank" rel="noopener">
    <span class="video-open-title">U1L6 Ethical Dilemma video 1</span>
    <span class="video-open-action">播放</span>
  </a>
</div>
</body></html>`,
  "utf8",
);

const registryPath = join(smokeRoot, "asset-registry.json");
writeFileSync(
  registryPath,
  `${JSON.stringify(
    {
      objectPrefix: "courseware-active",
      assets: [
        {
          objectKey: `courseware-active/BBI2O/${videoRelPath}`,
          cdnUrl: `${cdnBaseUrl}/BBI2O/${encodePathSegments(videoRelPath)}`,
          sha256: videoSha,
        },
      ],
      assetRecords: [],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const server = spawn("node", ["server.mjs", "--root", "dist", "--port", String(port)], {
  cwd: projectRoot,
  windowsHide: true,
  stdio: "ignore",
  env: {
    ...process.env,
    PORTAL_AUTH_ENABLED: "0",
    COURSE_ACTIVE_ROOT: coursewareRoot,
    EMBED_TOKEN_SECRET: secret,
    COURSEWARE_ASSET_MODE: "hybrid",
    COURSEWARE_ASSET_BASE_URL: cdnBaseUrl,
    COURSEWARE_ASSET_REGISTRY_FILE: registryPath,
  },
});

try {
  await sleep(900);
  const activityUrl = `http://127.0.0.1:${port}/courseware/BBI2O/${encodePathSegments(activityRelPath)}`;
  const html = await fetchText(activityUrl);
  if (html.includes('href="files/U1L6-Ethical-Dilemma-video-1.mp4"')) {
    throw new Error("Activity video play link still points to the raw local MP4.");
  }
  if (html.includes(`${cdnBaseUrl}/BBI2O/${encodePathSegments(videoRelPath)}`)) {
    throw new Error("Activity video play link should not point directly to the CDN MP4.");
  }
  const embedMatch = html.match(/href="(http:\/\/127\.0\.0\.1:8999\/embed\/video\/BBI2O\/[^"]+)"/);
  if (!embedMatch) throw new Error("Activity video play link did not become an embed/video URL.");
  const embedHtml = await fetchText(embedMatch[1].replaceAll("&amp;", "&"));
  const expectedCdn = `${cdnBaseUrl}/BBI2O/${encodePathSegments(videoRelPath)}?v=${videoSha.slice(0, 12)}`;
  if (!embedHtml.includes(expectedCdn)) throw new Error(`Embed page did not use versioned CDN video URL: ${expectedCdn}`);
  console.log("BBI2O video activity link smoke passed.");
} finally {
  server.kill();
  await sleep(100);
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
}
