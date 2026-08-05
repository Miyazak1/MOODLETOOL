import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function secret(bytes = 36) {
  return randomBytes(bytes).toString("base64url");
}

function password() {
  return `${secret(18)}A1!`;
}

function courseList() {
  return (readArg("--courses", "ENG3U,ESLEO") || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function envLine(name, value) {
  return `${name}=${value}`;
}

const outPath = resolve(projectRoot, readArg("--out", ".env.production.generated"));
const credentialsPath = resolve(projectRoot, readArg("--credentials-out", `${outPath}.credentials.txt`));
const force = hasArg("--force");
const courses = courseList();
const teacherUsername = readArg("--teacher-username", "teacher1");
const portalAdminUsername = readArg("--portal-admin-username", "portal-admin");
const adminUsername = readArg("--admin-username", "admin-main");
const domain = readArg("--domain", "your-domain");
const assetMode = String(readArg("--asset-mode", "local") || "local").toLowerCase();
const cdnBaseUrl = String(readArg("--cdn-base-url", "") || "").replace(/\/+$/, "");
const ossBucket = String(readArg("--oss-bucket", "") || "").replace(/\/+$/, "");
const ossBucketName = ossBucket.replace(/^oss:\/\//i, "").split("/")[0];
const ossPublicEndpoint = readArg("--oss-direct-upload-endpoint", "https://oss-cn-hongkong.aliyuncs.com");
const ossServerEndpoint = readArg("--oss-server-endpoint", "https://oss-cn-hongkong-internal.aliyuncs.com");
const ossAccessKeyId = readArg("--oss-access-key-id", "CHANGE_ME_OSS_ACCESS_KEY_ID");
const ossAccessKeySecret = readArg("--oss-access-key-secret", "CHANGE_ME_OSS_ACCESS_KEY_SECRET");
const assetPrefix = String(readArg("--asset-prefix", "courseware-active") || "courseware-active").replace(/^\/+|\/+$/g, "");
const assetRegistryFile = readArg("--asset-registry-file", "/www/wwwroot/ossd-course-portal/deployment/asset-registry.json");

if (existsSync(outPath) && !force) {
  console.error(`Refusing to overwrite existing env file: ${outPath}`);
  console.error("Pass --force only after confirming the old file is no longer needed.");
  process.exit(1);
}
if (existsSync(credentialsPath) && !force) {
  console.error(`Refusing to overwrite existing credentials file: ${credentialsPath}`);
  console.error("Pass --force only after confirming the old file is no longer needed.");
  process.exit(1);
}
if (!courses.length) {
  console.error("At least one course is required, for example --courses ENG3U,ESLEO.");
  process.exit(2);
}
if (!["local", "hybrid", "cdn"].includes(assetMode)) {
  console.error("--asset-mode must be local, hybrid, or cdn.");
  process.exit(2);
}
if (assetMode !== "local" && !/^https:\/\//i.test(cdnBaseUrl)) {
  console.error("--cdn-base-url is required and must be HTTPS when --asset-mode is hybrid or cdn.");
  process.exit(2);
}
if (ossBucket && !/^oss:\/\//i.test(ossBucket)) {
  console.error("--oss-bucket should look like oss://bucket-name.");
  process.exit(2);
}
if (!assetPrefix) {
  console.error("--asset-prefix cannot be empty.");
  process.exit(2);
}

const generated = {
  portalSessionSecret: secret(42),
  adminSessionSecret: secret(42),
  embedTokenSecret: secret(42),
  adminToken: secret(32),
  portalAdminPassword: password(),
  teacherPassword: password(),
  adminPassword: password(),
};

const portalUsers = [
  {
    username: portalAdminUsername,
    password: generated.portalAdminPassword,
    role: "admin",
    courses: ["*"],
  },
  {
    username: teacherUsername,
    password: generated.teacherPassword,
    role: "teacher",
    courses,
  },
];

const env = [
  "# Generated production env for OSSD Course Portal.",
  "# Keep this file private. Do not commit or put it in a public web directory listing.",
  `# Generated at ${new Date().toISOString()}`,
  "",
  "VITE_COURSE_CATALOG_URL=/course-catalog.json",
  `VITE_COURSE_MANIFEST_URL=/courseware/${courses[0]}/course-manifest.json`,
  `VITE_COURSE_BASE_URL=/courseware/${courses[0]}/`,
  "",
  "NODE_ENV=production",
  "PORTAL_AUTH_ENABLED=1",
  envLine("PORTAL_SESSION_SECRET", generated.portalSessionSecret),
  "PORTAL_COOKIE_SECURE=1",
  "PORTAL_SESSION_MAX_AGE_SECONDS=43200",
  "PORTAL_DATA_DIR=/www/wwwroot/ossd-portal/data",
  "COURSE_STATUS_FILE=/www/wwwroot/ossd-portal/data/course-status.json",
  "COURSE_ACTIVE_ROOT=/www/wwwroot/ossd-portal/courseware-active",
  "COURSE_ARCHIVE_ROOT=/www/wwwroot/ossd-portal/courseware-archive",
  "X_ACCEL_COURSEWARE_PREFIX=/_protected_courseware/",
  envLine("OSS_BUCKET_URI", ossBucket),
  envLine("COURSEWARE_ASSET_MODE", assetMode),
  envLine("COURSEWARE_ASSET_BASE_URL", cdnBaseUrl),
  envLine("COURSEWARE_ASSET_PREFIX", assetPrefix),
  envLine("COURSEWARE_ASSET_REGISTRY_FILE", assetRegistryFile),
  envLine("EMBED_TOKEN_SECRET", generated.embedTokenSecret),
  `EMBED_PUBLIC_ORIGIN=https://${domain}`,
  "EMBED_TOKEN_MAX_AGE_SECONDS=315360000",
  envLine("PORTAL_USERS_JSON", JSON.stringify(portalUsers)),
  "LOGIN_RATE_LIMIT_MAX_FAILURES=8",
  "LOGIN_RATE_LIMIT_WINDOW_SECONDS=900",
  "LOGIN_RATE_LIMIT_LOCK_SECONDS=900",
  "",
  "ADMIN_UPLOADS_ENABLED=1",
  envLine("ADMIN_USERNAME", adminUsername),
  envLine("ADMIN_PASSWORD", generated.adminPassword),
  envLine("ADMIN_SESSION_SECRET", generated.adminSessionSecret),
  envLine("ADMIN_TOKEN", generated.adminToken),
  "ADMIN_COOKIE_SECURE=1",
  "ADMIN_MAX_DOCUMENT_MB=100",
  "ADMIN_MAX_ISPRING_MB=4096",
  "ADMIN_MAX_COURSE_PACKAGE_MB=32768",
  "",
  "MEDIA_JOBS_ENABLED=1",
  "MEDIA_JOBS_MAX_CONCURRENCY=1",
  "MEDIA_JOBS_DATA_ROOT=/www/wwwroot/ossd-course-portal/data/media-jobs",
  "COURSE_PACKAGE_IMPORT_MODE=hybrid-worker",
  "COURSE_IMPORT_RAW_PREFIX=course-import-raw",
  "COURSE_ECS_UPLOAD_MAX_GB=2",
  "OSS_DIRECT_UPLOAD_MAX_GB=50",
  "OSS_DIRECT_UPLOAD_PART_MB=64",
  "COURSE_LARGE_FILE_THRESHOLD_MB=100",
  "COURSE_LARGE_IMAGE_THRESHOLD_MB=25",
  "COURSE_LOCAL_MAX_COURSE_MB=2048",
  "COURSE_IMPORT_STORAGE_WARNING_FREE_GB=40",
  "COURSE_IMPORT_STORAGE_GUARDED_FREE_GB=25",
  "COURSE_IMPORT_STORAGE_BLOCKED_FREE_GB=15",
  "COURSE_IMPORT_SYSTEM_RESERVED_GB=10",
  ...(assetMode === "local" ? [
    "OSS_DIRECT_UPLOAD_ENABLED=0",
  ] : [
    "OSS_DIRECT_UPLOAD_ENABLED=1",
    envLine("OSS_DIRECT_UPLOAD_BUCKET", ossBucketName || "YOUR_OSS_BUCKET_NAME"),
    envLine("OSS_DIRECT_UPLOAD_ENDPOINT", ossPublicEndpoint),
    envLine("OSS_SERVER_ENDPOINT", ossServerEndpoint),
    envLine("OSS_DIRECT_UPLOAD_ACCESS_KEY_ID", ossAccessKeyId),
    envLine("OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET", ossAccessKeySecret),
    "OSS_UPLOADS_DATA_ROOT=/www/wwwroot/ossd-course-portal/data/oss-uploads",
  ]),
  "",
].join("\n");

const credentials = [
  "OSSD Course Portal Production Credentials",
  `Generated at: ${new Date().toISOString()}`,
  `Intended domain: https://${domain}`,
  "",
  "Portal admin login:",
  `  username: ${portalAdminUsername}`,
  `  password: ${generated.portalAdminPassword}`,
  "",
  "Teacher login:",
  `  username: ${teacherUsername}`,
  `  password: ${generated.teacherPassword}`,
  `  courses: ${courses.join(", ")}`,
  "",
  "Teacher-admin backend login:",
  `  username: ${adminUsername}`,
  `  password: ${generated.adminPassword}`,
  "",
  "Direct admin token fallback:",
  `  ADMIN_TOKEN: ${generated.adminToken}`,
  "",
  "Next commands:",
  `  npm run check:production-env -- --env ${outPath}`,
  assetMode === "local"
    ? "  npm run check:media-delivery -- --course HFC3M"
    : `  npm run check:media-delivery -- --course HFC3M --bucket ${ossBucket || "oss://YOUR_BUCKET"} --cdn-base-url ${cdnBaseUrl} --asset-mode ${assetMode} --require-oss`,
  `  npm run smoke:deployed-site -- --base-url https://${domain} --username ${teacherUsername} --password ${generated.teacherPassword} --course ${courses[0]}`,
  "",
].join("\n");

mkdirSync(dirname(outPath), { recursive: true });
mkdirSync(dirname(credentialsPath), { recursive: true });
writeFileSync(outPath, env, "utf8");
writeFileSync(credentialsPath, credentials, "utf8");

console.log(`Wrote env: ${outPath}`);
console.log(`Wrote credentials: ${credentialsPath}`);
console.log(`Courses: ${courses.join(", ")}`);
console.log("Run production env check before starting the server.");
