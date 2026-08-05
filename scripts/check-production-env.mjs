import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const defaultEnvPath = resolve(process.cwd(), ".env.production");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnv(content) {
  const values = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = stripQuotes(match[2]);
  }
  return values;
}

const envPath = resolve(argValue("--env", defaultEnvPath));
const values = existsSync(envPath) ? { ...process.env, ...parseEnv(readFileSync(envPath, "utf8")) } : { ...process.env };
const errors = [];
const warnings = [];
const ok = [];

function placeholder(value) {
  return !value
    || /CHANGE_ME/i.test(value)
    || /replace-with/i.test(value)
    || /your-/i.test(value)
    || value === "admin"
    || value === "password";
}

function requireValue(name, detail = "") {
  const value = values[name] || "";
  if (!value) {
    errors.push(`${name} is required${detail ? `: ${detail}` : ""}.`);
    return "";
  }
  if (placeholder(value)) {
    errors.push(`${name} still looks like a placeholder.`);
    return value;
  }
  ok.push(`${name} is set.`);
  return value;
}

function requireFlag(name, expected) {
  const value = values[name] || "";
  if (value !== expected) errors.push(`${name} must be ${expected} for production.`);
  else ok.push(`${name}=${expected}.`);
}

function requireSecret(name) {
  const value = requireValue(name, "use at least 32 random characters");
  if (value && value.length < 32) errors.push(`${name} should be at least 32 characters.`);
  return value;
}

function requirePassword(name) {
  const value = requireValue(name, "use a strong password");
  if (value && value.length < 12) errors.push(`${name} should be at least 12 characters.`);
  return value;
}

function requireLinuxPath(name) {
  const value = requireValue(name);
  if (!value) return value;
  if (!value.startsWith("/")) errors.push(`${name} should be an absolute Linux path, got ${value}.`);
  if (/[A-Za-z]:\\/.test(value)) errors.push(`${name} looks like a Windows path; production Baota needs a Linux path.`);
  return value;
}

function checkUsersJson() {
  const usersJson = values.PORTAL_USERS_JSON || "";
  const usersFile = values.PORTAL_USERS_FILE || "";
  if (!usersJson && !usersFile) {
    errors.push("Either PORTAL_USERS_JSON or PORTAL_USERS_FILE is required for first production login.");
    return;
  }
  if (usersFile) {
    if (!usersFile.startsWith("/")) errors.push("PORTAL_USERS_FILE should be an absolute Linux path.");
    ok.push("PORTAL_USERS_FILE is set.");
  }
  if (!usersJson) return;

  let users;
  try {
    users = JSON.parse(usersJson);
  } catch (error) {
    errors.push(`PORTAL_USERS_JSON is not valid JSON: ${error.message}`);
    return;
  }
  if (!Array.isArray(users) || !users.length) {
    errors.push("PORTAL_USERS_JSON must be a non-empty array.");
    return;
  }

  const usernames = new Set();
  let hasAdmin = false;
  for (const user of users) {
    if (!user?.username) errors.push("Each portal user needs a username.");
    if (user?.username && usernames.has(user.username)) errors.push(`Duplicate portal username: ${user.username}`);
    if (user?.username) usernames.add(user.username);
    if (user?.role === "admin" && Array.isArray(user.courses) && user.courses.includes("*")) hasAdmin = true;
    if (!user?.password && !user?.passwordHash) errors.push(`Portal user ${user?.username || "(unknown)"} needs password or passwordHash.`);
    if (user?.password && placeholder(user.password)) errors.push(`Portal user ${user.username || "(unknown)"} password still looks like a placeholder.`);
    if (user?.password && user.password.length < 12) errors.push(`Portal user ${user.username || "(unknown)"} password should be at least 12 characters.`);
  }
  if (!hasAdmin) errors.push('PORTAL_USERS_JSON should include at least one admin user with courses ["*"].');
  ok.push(`PORTAL_USERS_JSON contains ${users.length} user(s).`);
}

requireFlag("PORTAL_AUTH_ENABLED", "1");
const portalSecret = requireSecret("PORTAL_SESSION_SECRET");
requireFlag("PORTAL_COOKIE_SECURE", "1");
requireLinuxPath("PORTAL_DATA_DIR");
requireLinuxPath("COURSE_STATUS_FILE");
const activeRoot = requireLinuxPath("COURSE_ACTIVE_ROOT");
const archiveRoot = requireLinuxPath("COURSE_ARCHIVE_ROOT");
const xAccelPrefix = requireValue("X_ACCEL_COURSEWARE_PREFIX");
requireSecret("EMBED_TOKEN_SECRET");
const embedOrigin = requireValue("EMBED_PUBLIC_ORIGIN");
checkUsersJson();

if (activeRoot && archiveRoot && activeRoot === archiveRoot) errors.push("COURSE_ACTIVE_ROOT and COURSE_ARCHIVE_ROOT must be different directories.");
if (xAccelPrefix && (!xAccelPrefix.startsWith("/") || !xAccelPrefix.endsWith("/"))) {
  errors.push("X_ACCEL_COURSEWARE_PREFIX should start and end with '/', for example /_protected_courseware/.");
}
if (embedOrigin && !/^https:\/\//i.test(embedOrigin)) errors.push("EMBED_PUBLIC_ORIGIN should be the production HTTPS origin, for example https://courses.example.com.");

const assetBaseUrl = values.COURSEWARE_ASSET_BASE_URL || "";
const assetMode = String(values.COURSEWARE_ASSET_MODE || (assetBaseUrl ? "hybrid" : "local")).toLowerCase();
const ossBucket = values.OSS_BUCKET_URI || "";
if (!["local", "hybrid", "cdn"].includes(assetMode)) {
  errors.push("COURSEWARE_ASSET_MODE must be local, hybrid, or cdn.");
} else {
  ok.push(`COURSEWARE_ASSET_MODE=${assetMode}.`);
}
if (ossBucket) {
  if (!/^oss:\/\/[^/]+/i.test(ossBucket)) errors.push("OSS_BUCKET_URI should look like oss://bucket-name.");
  else ok.push("OSS_BUCKET_URI is set.");
} else if (assetMode !== "local") {
  warnings.push("OSS_BUCKET_URI is not set; sync:oss commands must pass --bucket explicitly.");
}
if (assetBaseUrl) {
  if (!/^https:\/\//i.test(assetBaseUrl)) errors.push("COURSEWARE_ASSET_BASE_URL should be an HTTPS CDN URL, for example https://cdn.example.com/courseware-active.");
  else ok.push("COURSEWARE_ASSET_BASE_URL is set.");
  if (!/\/courseware-active$/i.test(assetBaseUrl.replace(/\/+$/, ""))) {
    warnings.push("COURSEWARE_ASSET_BASE_URL usually should end with /courseware-active to match sync:oss default object prefix.");
  }
}
if (assetMode === "hybrid") {
  const registryPath = values.COURSEWARE_ASSET_REGISTRY_FILE || "";
  if (registryPath && !registryPath.startsWith("/")) errors.push("COURSEWARE_ASSET_REGISTRY_FILE should be an absolute Linux path when set.");
  if (!registryPath) warnings.push("COURSEWARE_ASSET_MODE=hybrid will use deployment/asset-registry.json unless COURSEWARE_ASSET_REGISTRY_FILE is set.");
}
if (assetMode === "cdn" && !assetBaseUrl) errors.push("COURSEWARE_ASSET_BASE_URL is required when COURSEWARE_ASSET_MODE=cdn.");

const mediaJobsEnabled = values.MEDIA_JOBS_ENABLED || "";
if (mediaJobsEnabled === "1") {
  ok.push("MEDIA_JOBS_ENABLED=1.");
  const mediaJobsRoot = values.MEDIA_JOBS_DATA_ROOT || "";
  if (mediaJobsRoot && !mediaJobsRoot.startsWith("/")) errors.push("MEDIA_JOBS_DATA_ROOT should be an absolute Linux path when set.");
  const mediaConcurrency = Number(values.MEDIA_JOBS_MAX_CONCURRENCY || 1);
  if (!Number.isFinite(mediaConcurrency) || mediaConcurrency < 1) errors.push("MEDIA_JOBS_MAX_CONCURRENCY should be at least 1.");
  if (mediaConcurrency > 1) warnings.push("MEDIA_JOBS_MAX_CONCURRENCY > 1 can race over course locks/registry writes; keep it at 1 unless intentionally tested.");
} else {
  warnings.push("MEDIA_JOBS_ENABLED is not 1; media task center can display status but cannot create jobs.");
}

const directUploadEnabled = values.OSS_DIRECT_UPLOAD_ENABLED || "";
if (directUploadEnabled === "1") {
  ok.push("OSS_DIRECT_UPLOAD_ENABLED=1.");
  const directBucket = requireValue("OSS_DIRECT_UPLOAD_BUCKET");
  const directEndpoint = requireValue("OSS_DIRECT_UPLOAD_ENDPOINT");
  requireValue("OSS_DIRECT_UPLOAD_ACCESS_KEY_ID");
  requireValue("OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET");
  const directRoot = values.OSS_UPLOADS_DATA_ROOT || "";
  if (directBucket && /^(oss:\/\/|https?:\/\/)/i.test(directBucket)) errors.push("OSS_DIRECT_UPLOAD_BUCKET should be a plain bucket name, for example moodletool.");
  if (directEndpoint && !/^https:\/\/oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(directEndpoint)) {
    warnings.push("OSS_DIRECT_UPLOAD_ENDPOINT usually should look like https://oss-cn-hongkong.aliyuncs.com.");
  }
  if (directRoot && !directRoot.startsWith("/")) errors.push("OSS_UPLOADS_DATA_ROOT should be an absolute Linux path when set.");
} else {
  warnings.push("OSS_DIRECT_UPLOAD_ENABLED is not 1; ECS-first overflow raw ZIP fallback will be unavailable when ECS cannot safely receive the ZIP.");
}

const coursePackageImportMode = String(values.COURSE_PACKAGE_IMPORT_MODE || "ecs-first").toLowerCase();
if (coursePackageImportMode !== "ecs-first") {
  errors.push("COURSE_PACKAGE_IMPORT_MODE must be ecs-first. The old oss-only/legacy-local course package flows are disabled.");
} else {
  ok.push(`COURSE_PACKAGE_IMPORT_MODE=${coursePackageImportMode}.`);
}
if (coursePackageImportMode === "ecs-first") {
  if (assetMode === "local") {
    warnings.push("COURSE_PACKAGE_IMPORT_MODE=ecs-first with COURSEWARE_ASSET_MODE=local will keep all course assets on ECS; media/iSpring concurrency benefits require hybrid or cdn.");
  }
  if (!ossBucket) {
    warnings.push("COURSE_PACKAGE_IMPORT_MODE=ecs-first should set OSS_BUCKET_URI before importing media/iSpring/H5P courses.");
  }
  if (!assetBaseUrl) {
    warnings.push("COURSE_PACKAGE_IMPORT_MODE=ecs-first should set COURSEWARE_ASSET_BASE_URL before importing media/iSpring/H5P courses.");
  }
  const ossutilPath = values.OSSUTIL_PATH || "ossutil";
  ok.push(`ECS-first package import will publish selected assets with ${ossutilPath}.`);
  if (directUploadEnabled === "1") {
    ok.push("OSS browser upload is reserved for ECS-first overflow raw ZIP fallback; manual media/H5P/iSpring direct upload is disabled by the server.");
    const directMaxGb = Number(values.OSS_DIRECT_UPLOAD_MAX_GB || 20);
    if (Number.isFinite(directMaxGb) && directMaxGb < 10) {
      warnings.push("OSS_DIRECT_UPLOAD_MAX_GB is below 10; very large course ZIP overflow uploads may be blocked before the ECS worker can process them.");
    }
    ok.push(`OSS_COURSE_PACKAGE_OVERFLOW_PREFIX=${values.OSS_COURSE_PACKAGE_OVERFLOW_PREFIX || "course-import-overflow"}.`);
  }
}
if (values.OSS_EXTRACT_CALLBACK_SECRET || values.PORTAL_EXTRACT_CALLBACK_BASE || values.OSS_EXTRACT_BUCKET || values.OSS_EXTRACT_ENDPOINT) {
  warnings.push("Old FC/OSS extractor variables are ignored by the ECS-first package flow; remove them after verifying no other manual tooling needs them.");
}

if ((values.ADMIN_UPLOADS_ENABLED || "") === "1") {
  requireValue("ADMIN_USERNAME");
  requirePassword("ADMIN_PASSWORD");
  const adminSecret = requireSecret("ADMIN_SESSION_SECRET");
  requireFlag("ADMIN_COOKIE_SECURE", "1");
  if (adminSecret && portalSecret && adminSecret === portalSecret) warnings.push("ADMIN_SESSION_SECRET and PORTAL_SESSION_SECRET should be different.");
} else {
  warnings.push("ADMIN_UPLOADS_ENABLED is not 1; admin uploads will be disabled.");
}

if (values.ADMIN_TOKEN && placeholder(values.ADMIN_TOKEN)) errors.push("ADMIN_TOKEN still looks like a placeholder.");
if (values.ADMIN_TOKEN && values.ADMIN_TOKEN.length < 32) warnings.push("ADMIN_TOKEN should be at least 32 characters if direct API token fallback is used.");

for (const name of ["MOODLE_USERNAME", "MOODLE_PASSWORD", "MOODLE_COOKIE"]) {
  if (values[name]) warnings.push(`${name} is set. Keep Moodle credentials out of long-lived production env unless a batch import is running.`);
}

if (values.NODE_ENV && values.NODE_ENV !== "production") warnings.push(`NODE_ENV is ${values.NODE_ENV}; production should use NODE_ENV=production.`);
if (!values.NODE_ENV) warnings.push("NODE_ENV is not set; production should use NODE_ENV=production.");

const report = {
  envPath: existsSync(envPath) ? envPath : null,
  status: errors.length ? "blocked" : warnings.length ? "ready-with-warnings" : "ready",
  totals: {
    ok: ok.length,
    warnings: warnings.length,
    errors: errors.length,
  },
  errors,
  warnings,
  ok,
};

if (hasArg("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Production env check: ${report.status}`);
  if (report.envPath) console.log(`Env file: ${report.envPath}`);
  else console.log("Env file: not found; checked process environment only.");
  for (const item of errors) console.log(`BLOCK: ${item}`);
  for (const item of warnings) console.log(`WARN: ${item}`);
  console.log(`Summary: ${ok.length} ok, ${warnings.length} warning(s), ${errors.length} blocker(s).`);
}

if (errors.length) process.exit(1);
