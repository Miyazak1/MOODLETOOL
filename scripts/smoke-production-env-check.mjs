import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".env-check-smoke");

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function runCheck(envPath) {
  return spawnSync("node", ["scripts/check-production-env.mjs", "--env", envPath, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

assertInside(projectRoot, smokeRoot, "smoke output");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(smokeRoot, { recursive: true });

try {
  const goodEnvPath = join(smokeRoot, ".env.production.good");
  const badEnvPath = join(smokeRoot, ".env.production.bad");
  const secretA = "portal-secret-0123456789-0123456789-0123456789";
  const secretB = "admin-secret-0123456789-0123456789-0123456789";
  const secretC = "embed-secret-0123456789-0123456789-0123456789";

  writeFileSync(goodEnvPath, [
    "NODE_ENV=production",
    "PORTAL_AUTH_ENABLED=1",
    `PORTAL_SESSION_SECRET=${secretA}`,
    "PORTAL_COOKIE_SECURE=1",
    "PORTAL_DATA_DIR=/www/wwwroot/ossd-portal/data",
    "COURSE_STATUS_FILE=/www/wwwroot/ossd-portal/data/course-status.json",
    "COURSE_ACTIVE_ROOT=/www/wwwroot/ossd-portal/courseware-active",
    "COURSE_ARCHIVE_ROOT=/www/wwwroot/ossd-portal/courseware-archive",
    "X_ACCEL_COURSEWARE_PREFIX=/_protected_courseware/",
    `EMBED_TOKEN_SECRET=${secretC}`,
    "EMBED_PUBLIC_ORIGIN=https://courses.example.com",
    'PORTAL_USERS_JSON=[{"username":"admin","password":"StrongAdminPassword123!","role":"admin","courses":["*"]},{"username":"teacher1","password":"StrongTeacherPassword123!","role":"teacher","courses":["ENG3U"]}]',
    "ADMIN_UPLOADS_ENABLED=1",
    "ADMIN_USERNAME=admin-main",
    "ADMIN_PASSWORD=AnotherStrongAdminPassword123!",
    `ADMIN_SESSION_SECRET=${secretB}`,
    "ADMIN_COOKIE_SECURE=1",
    "",
  ].join("\n"), "utf8");

  writeFileSync(badEnvPath, [
    "PORTAL_AUTH_ENABLED=1",
    "PORTAL_SESSION_SECRET=CHANGE_ME",
    "PORTAL_COOKIE_SECURE=0",
    "PORTAL_DATA_DIR=D:\\\\wrong",
    "COURSE_STATUS_FILE=/www/wwwroot/ossd-portal/data/course-status.json",
    "COURSE_ACTIVE_ROOT=/www/wwwroot/ossd-portal/courseware-active",
    "COURSE_ARCHIVE_ROOT=/www/wwwroot/ossd-portal/courseware-active",
    "X_ACCEL_COURSEWARE_PREFIX=_protected_courseware",
    'PORTAL_USERS_JSON=[{"username":"admin","password":"CHANGE_ME_ADMIN_PASSWORD","role":"admin","courses":["*"]}]',
    "ADMIN_UPLOADS_ENABLED=1",
    "ADMIN_USERNAME=admin",
    "ADMIN_PASSWORD=CHANGE_ME_ADMIN_PASSWORD",
    "ADMIN_SESSION_SECRET=",
    "ADMIN_COOKIE_SECURE=0",
    "",
  ].join("\n"), "utf8");

  const good = runCheck(goodEnvPath);
  if (good.status !== 0) throw new Error(`Expected good production env to pass:\n${good.stderr || good.stdout}`);
  const goodReport = JSON.parse(good.stdout);
  if (goodReport.status !== "ready") throw new Error(`Expected ready env, got ${goodReport.status}`);

  const bad = runCheck(badEnvPath);
  if (bad.status === 0) throw new Error("Expected bad production env to fail.");
  const badReport = JSON.parse(bad.stdout);
  if (!badReport.errors.length) throw new Error("Expected bad production env report to include blockers.");

  console.log("Production env check smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}
