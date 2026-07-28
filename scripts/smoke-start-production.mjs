import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".start-production-smoke");

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

assertInside(projectRoot, smokeRoot, "smoke output");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(smokeRoot, { recursive: true });

try {
  const envPath = join(smokeRoot, ".env.production");
  writeFileSync(envPath, [
    "NODE_ENV=production",
    "PORTAL_AUTH_ENABLED=1",
    "PORTAL_SESSION_SECRET=portal-secret-0123456789-0123456789-0123456789",
    "PORTAL_COOKIE_SECURE=1",
    "PORTAL_DATA_DIR=/www/wwwroot/ossd-portal/data",
    "COURSE_STATUS_FILE=/www/wwwroot/ossd-portal/data/course-status.json",
    "COURSE_ACTIVE_ROOT=/www/wwwroot/ossd-portal/courseware-active",
    "COURSE_ARCHIVE_ROOT=/www/wwwroot/ossd-portal/courseware-archive",
    "X_ACCEL_COURSEWARE_PREFIX=/_protected_courseware/",
    "EMBED_TOKEN_SECRET=embed-secret-0123456789-0123456789-0123456789",
    "EMBED_PUBLIC_ORIGIN=https://courses.example.com",
    'PORTAL_USERS_JSON=[{"username":"admin","password":"StrongAdminPassword123!","role":"admin","courses":["*"]}]',
    "ADMIN_UPLOADS_ENABLED=1",
    "ADMIN_USERNAME=admin-main",
    "ADMIN_PASSWORD=AnotherStrongAdminPassword123!",
    "ADMIN_SESSION_SECRET=admin-secret-0123456789-0123456789-0123456789",
    "ADMIN_COOKIE_SECURE=1",
    "",
  ].join("\n"), "utf8");

  const result = spawnSync(
    process.execPath,
    ["scripts/start-production.mjs", "--env", envPath, "--root", "dist", "--port", "8891", "--dry-run"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) throw new Error(`start-production dry run failed:\n${result.stderr || result.stdout}`);
  const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  if (!payload.ok) throw new Error("start-production dry run did not report ok.");
  if (!payload.loadedKeys.includes("PORTAL_SESSION_SECRET")) throw new Error("start-production did not load env keys.");
  if (!payload.args.includes("server.mjs")) throw new Error("start-production did not target server.mjs.");
  console.log("Production start smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}
