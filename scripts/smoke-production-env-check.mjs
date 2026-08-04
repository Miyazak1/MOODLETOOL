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
  const cdnEnvPath = join(smokeRoot, ".env.production.cdn");
  const badEnvPath = join(smokeRoot, ".env.production.bad");
  const secretA = "portal-secret-0123456789-0123456789-0123456789";
  const secretB = "admin-secret-0123456789-0123456789-0123456789";
  const secretC = "embed-secret-0123456789-0123456789-0123456789";
  const secretD = "extract-secret-0123456789-0123456789-0123456789";

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
    "MEDIA_JOBS_ENABLED=1",
    "MEDIA_JOBS_MAX_CONCURRENCY=1",
    "MEDIA_JOBS_DATA_ROOT=/www/wwwroot/ossd-course-portal/data/media-jobs",
    "OSS_DIRECT_UPLOAD_ENABLED=1",
    "OSS_DIRECT_UPLOAD_BUCKET=moodletool",
    "OSS_DIRECT_UPLOAD_ENDPOINT=https://oss-cn-hongkong.aliyuncs.com",
    "OSS_UPLOADS_DATA_ROOT=/www/wwwroot/ossd-course-portal/data/oss-uploads",
    "OSS_DIRECT_UPLOAD_ACCESS_KEY_ID=LTAI5tExampleAccessKeyId",
    "OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET=exampleSecretForSmokeOnly1234567890",
    "COURSE_PACKAGE_IMPORT_MODE=oss-only",
    `OSS_EXTRACT_CALLBACK_SECRET=${secretD}`,
    "PORTAL_EXTRACT_CALLBACK_BASE=https://courses.example.com",
    "OSS_EXTRACT_BUCKET=moodletool",
    "OSS_EXTRACT_ENDPOINT=https://oss-cn-hongkong.aliyuncs.com",
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

  writeFileSync(cdnEnvPath, [
    "NODE_ENV=production",
    "PORTAL_AUTH_ENABLED=1",
    `PORTAL_SESSION_SECRET=${secretA}`,
    "PORTAL_COOKIE_SECURE=1",
    "PORTAL_DATA_DIR=/www/wwwroot/ossd-portal/data",
    "COURSE_STATUS_FILE=/www/wwwroot/ossd-portal/data/course-status.json",
    "COURSE_ACTIVE_ROOT=/www/wwwroot/ossd-portal/courseware-active",
    "COURSE_ARCHIVE_ROOT=/www/wwwroot/ossd-portal/courseware-archive",
    "X_ACCEL_COURSEWARE_PREFIX=/_protected_courseware/",
    "OSS_BUCKET_URI=oss://moodletool-courseware",
    "COURSEWARE_ASSET_MODE=hybrid",
    "COURSEWARE_ASSET_BASE_URL=https://cdn.example.com/courseware-active",
    "COURSEWARE_ASSET_PREFIX=courseware-active",
    "COURSEWARE_ASSET_REGISTRY_FILE=/www/wwwroot/ossd-course-portal/deployment/asset-registry.json",
    `EMBED_TOKEN_SECRET=${secretC}`,
    "EMBED_PUBLIC_ORIGIN=https://courses.example.com",
    'PORTAL_USERS_JSON=[{"username":"admin","password":"StrongAdminPassword123!","role":"admin","courses":["*"]},{"username":"teacher1","password":"StrongTeacherPassword123!","role":"teacher","courses":["ENG3U"]}]',
    "ADMIN_UPLOADS_ENABLED=1",
    "ADMIN_USERNAME=admin-main",
    "ADMIN_PASSWORD=AnotherStrongAdminPassword123!",
    `ADMIN_SESSION_SECRET=${secretB}`,
    "ADMIN_COOKIE_SECURE=1",
    "MEDIA_JOBS_ENABLED=1",
    "MEDIA_JOBS_MAX_CONCURRENCY=1",
    "MEDIA_JOBS_DATA_ROOT=/www/wwwroot/ossd-course-portal/data/media-jobs",
    "OSS_DIRECT_UPLOAD_ENABLED=1",
    "OSS_DIRECT_UPLOAD_BUCKET=moodletool-courseware",
    "OSS_DIRECT_UPLOAD_ENDPOINT=https://oss-cn-hongkong.aliyuncs.com",
    "OSS_UPLOADS_DATA_ROOT=/www/wwwroot/ossd-course-portal/data/oss-uploads",
    "OSS_DIRECT_UPLOAD_ACCESS_KEY_ID=LTAI5tExampleAccessKeyId",
    "OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET=exampleSecretForSmokeOnly1234567890",
    "COURSE_PACKAGE_IMPORT_MODE=oss-only",
    `OSS_EXTRACT_CALLBACK_SECRET=${secretD}`,
    "PORTAL_EXTRACT_CALLBACK_BASE=https://courses.example.com",
    "OSS_EXTRACT_BUCKET=moodletool-courseware",
    "OSS_EXTRACT_ENDPOINT=https://oss-cn-hongkong.aliyuncs.com",
    "",
  ].join("\n"), "utf8");

  const good = runCheck(goodEnvPath);
  if (good.status !== 0) throw new Error(`Expected good production env to pass:\n${good.stderr || good.stdout}`);
  const goodReport = JSON.parse(good.stdout);
  if (goodReport.status !== "ready") throw new Error(`Expected ready env, got ${goodReport.status}`);

  const cdn = runCheck(cdnEnvPath);
  if (cdn.status !== 0) throw new Error(`Expected CDN production env to pass:\n${cdn.stderr || cdn.stdout}`);
  const cdnReport = JSON.parse(cdn.stdout);
  if (cdnReport.status !== "ready") throw new Error(`Expected ready CDN env, got ${cdnReport.status}`);
  if (!cdnReport.ok.some((item) => item.includes("OSS_BUCKET_URI"))) throw new Error("Expected CDN env report to validate OSS_BUCKET_URI.");

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
