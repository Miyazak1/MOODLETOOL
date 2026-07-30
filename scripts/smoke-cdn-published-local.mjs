import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".cdn-published-smoke");
const port = 8998;

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

assertInside(projectRoot, smokeRoot, "smoke root");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });

const coursewareRoot = join(smokeRoot, "courseware");
const courseRoot = join(coursewareRoot, "SMOKE");
mkdirSync(courseRoot, { recursive: true });
writeFileSync(join(courseRoot, "course-manifest.json"), '{"schemaVersion":1,"course":{"code":"SMOKE"},"units":[]}\n', "utf8");
writeFileSync(join(courseRoot, "index.html"), "<!doctype html><html><body>Smoke</body></html>\n", "utf8");
writeFileSync(join(courseRoot, "video.mp4"), Buffer.alloc(4096, 1));

const registryPath = join(smokeRoot, "asset-registry.json");
writeFileSync(
  registryPath,
  `${JSON.stringify(
    {
      objectPrefix: "courseware-active",
      assets: [
        "courseware-active/SMOKE/course-manifest.json",
        "courseware-active/SMOKE/index.html",
        "courseware-active/SMOKE/video.mp4",
      ],
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
  },
});

try {
  await sleep(900);
  const result = spawnSync(
    "node",
    [
      "scripts/smoke-cdn-published.mjs",
      "--registry",
      registryPath,
      "--cdn-base-url",
      `http://127.0.0.1:${port}/courseware`,
      "--course",
      "SMOKE",
      "--limit",
      "3",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `smoke-cdn-published exited ${result.status}`);
  }
  console.log("CDN published local smoke passed.");
} finally {
  server.kill();
  await sleep(100);
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
}
