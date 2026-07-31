import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".media-jobs-smoke");
const dataRoot = join(smokeRoot, "data");
const coursewareRoot = join(smokeRoot, "courseware");
const port = Number(process.env.SMOKE_MEDIA_JOBS_PORT || 8898);
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function waitForServer(child) {
  let lastError = null;
  for (let index = 0; index < 80; index += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited before smoke could run: ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/admin/session`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for media jobs smoke server: ${lastError?.message || "unknown error"}`);
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const data = await response.json();
  return { response, data };
}

if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(join(coursewareRoot, "SMOKE"), { recursive: true });
mkdirSync(dataRoot, { recursive: true });
writeFileSync(join(coursewareRoot, "SMOKE", "course-manifest.json"), JSON.stringify({ course: { code: "SMOKE" }, units: [] }, null, 2), "utf8");

const child = spawn(process.execPath, ["server.mjs", "--port", String(port), "--root", "dist"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    ADMIN_UPLOADS_ENABLED: "1",
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "media-smoke-password",
    ADMIN_SESSION_SECRET: "media-smoke-secret",
    MEDIA_JOBS_ENABLED: "0",
    PORTAL_DATA_DIR: dataRoot,
    COURSE_ACTIVE_ROOT: coursewareRoot,
    COURSEWARE_ASSET_MODE: "hybrid",
    COURSEWARE_ASSET_BASE_URL: "https://cdn.example.com/courseware-active",
    OSS_BUCKET_URI: "oss://media-smoke",
  },
  stdio: "pipe",
  windowsHide: true,
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  await waitForServer(child);
  const login = await jsonFetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "media-smoke-password" }),
  });
  if (!login.response.ok || !login.data.ok) throw new Error(`Login failed: ${JSON.stringify(login.data)}`);
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
  if (!cookie) throw new Error("Login did not set an admin cookie.");

  const config = await jsonFetch("/api/admin/media/config", { headers: { Cookie: cookie } });
  if (!config.response.ok || !config.data.ok) throw new Error(`Media config failed: ${JSON.stringify(config.data)}`);
  if (config.data.config.enabled !== false) throw new Error("Media jobs should be disabled in this smoke.");

  const create = await jsonFetch("/api/admin/media/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ type: "publish-course", course: "SMOKE" }),
  });
  if (create.response.ok || create.data.ok) throw new Error("Disabled media jobs unexpectedly allowed job creation.");
  if (!String(create.data.error || "").includes("MEDIA_JOBS_ENABLED=1")) {
    throw new Error(`Disabled media job error was not actionable: ${JSON.stringify(create.data)}`);
  }

  console.log("Media jobs smoke passed.");
} finally {
  child.kill("SIGTERM");
  await wait(200);
  if (child.exitCode === null) child.kill("SIGKILL");
  if (stderr && process.env.SMOKE_VERBOSE) process.stderr.write(stderr);
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}
