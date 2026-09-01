import { createServer } from "node:http";
import { appendFile, cp, mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, normalize, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { finished, pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  directUploadKindCanAutoPublish,
  isCoursePackageUploadKind,
  isPlayableCoursewareAsset,
  isRawCoursePackageUploadKind,
  playableCoursewareVideoExts,
} from "./scripts/lib/media-delivery-assets.mjs";
import {
  activeMediaJobStatuses,
  mediaJobDisplay,
  mediaJobScope,
  mediaJobSucceededStatus,
  mediaWriteJobTypes,
  normalizeMediaJobType,
  parseMediaJobProgressFromText,
  retryableMediaJobStatuses,
} from "./scripts/lib/media-job-model.mjs";
import { mediaJobCommand as buildMediaJobCommand } from "./scripts/lib/media-job-command.mjs";
import { createMediaJobStore } from "./scripts/lib/media-job-store.mjs";
import {
  completeDirectMultipartUpload,
  createDirectMultipartUpload,
  createDirectUploadPolicy as buildDirectUploadPolicy,
  directUploadConfigFromEnv,
  directUploadPublicConfig as buildDirectUploadPublicConfig,
  listDirectMultipartUploadedParts,
  resolveDirectUploadCourse,
  resumeDirectMultipartUpload,
} from "./scripts/lib/oss-direct-upload.mjs";
import {
  coursePackageEntryKind,
  isLightweightCourseContentAsset,
} from "./scripts/lib/oss-course-package-extractor-core.mjs";
import { createOssUploadRecordStore } from "./scripts/lib/oss-upload-records.mjs";
import { listCourseLocks, removeCourseLock } from "./scripts/lib/course-operation-locks.mjs";

const projectRoot = resolve(import.meta.dirname);
const workspaceRoot = resolve(projectRoot, "..");
const courseCatalogPath = join(projectRoot, "public", "course-catalog.json");
const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 8890;
const portEndArgIndex = process.argv.indexOf("--port-end");
const portEnd = portEndArgIndex >= 0 ? Number(process.argv[portEndArgIndex + 1]) : port;
const shouldOpen = process.argv.includes("--open");
const rootArgIndex = process.argv.indexOf("--root");
const webRoot = rootArgIndex >= 0 ? resolve(projectRoot, process.argv[rootArgIndex + 1]) : join(projectRoot, "public");
const distRoot = join(projectRoot, "dist");
const distIndexPath = join(distRoot, "index.html");
const shouldServeDistApp = rootArgIndex < 0 && existsSync(distIndexPath);
const adminUploadsEnabled = process.env.ADMIN_UPLOADS_ENABLED === "1";
const adminToken = process.env.ADMIN_TOKEN || "";
const adminUsername = process.env.ADMIN_USERNAME || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || adminToken || "";
const adminCookieSecure = process.env.ADMIN_COOKIE_SECURE === "1";
const adminSessionMaxAgeSeconds = Number(process.env.ADMIN_SESSION_MAX_AGE_SECONDS || 8 * 60 * 60);
const adminSessionCookie = "ossd_admin_session";
const portalAuthUsername = process.env.PORTAL_AUTH_USERNAME || "";
const portalAuthPassword = process.env.PORTAL_AUTH_PASSWORD || "";
const portalAuthRealm = process.env.PORTAL_AUTH_REALM || "OSSD Course Portal";
const portalUsersJson = process.env.PORTAL_USERS_JSON || "";
const portalSessionSecret = process.env.PORTAL_SESSION_SECRET || adminSessionSecret || "";
const portalCookieSecure = process.env.PORTAL_COOKIE_SECURE === "1" || adminCookieSecure;
const portalSessionMaxAgeSeconds = Number(process.env.PORTAL_SESSION_MAX_AGE_SECONDS || 12 * 60 * 60);
const portalSessionCookie = "ossd_portal_session";
const portalAuthEnabled = process.env.PORTAL_AUTH_ENABLED === "1" || Boolean(portalUsersJson);
const portalDataRoot = resolve(process.env.PORTAL_DATA_DIR || join(projectRoot, "data"));
const portalUsersPath = resolve(process.env.PORTAL_USERS_FILE || join(portalDataRoot, "portal-users.json"));
const courseStatusPath = resolve(process.env.COURSE_STATUS_FILE || join(portalDataRoot, "course-status.json"));
const courseActiveRoot = resolve(process.env.COURSE_ACTIVE_ROOT || join(workspaceRoot, "courseware"));
const courseArchiveRoot = resolve(process.env.COURSE_ARCHIVE_ROOT || join(workspaceRoot, "courseware-archive"));
const storageOverviewCacheVersion = 1;
const storageOverviewCachePath = resolve(process.env.STORAGE_OVERVIEW_CACHE_FILE || join(portalDataRoot, "storage-overview-cache.json"));
const xAccelCoursewarePrefix = process.env.X_ACCEL_COURSEWARE_PREFIX || "";
const coursewareAssetBaseUrl = String(process.env.COURSEWARE_ASSET_BASE_URL || "").replace(/\/+$/, "");
const coursewareAssetMode = ["local", "hybrid", "cdn"].includes(String(process.env.COURSEWARE_ASSET_MODE || "").toLowerCase())
  ? String(process.env.COURSEWARE_ASSET_MODE || "").toLowerCase()
  : coursewareAssetBaseUrl
    ? "hybrid"
    : "local";
const coursewareAssetPrefix = toPosixPath(process.env.COURSEWARE_ASSET_PREFIX || "courseware-active").replace(/\/+$/, "");
const coursewareAssetRegistryPath = resolve(process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(projectRoot, "deployment", "asset-registry.json"));
const coursewareOssAssetScope = ["playable", "all"].includes(String(process.env.COURSEWARE_OSS_ASSET_SCOPE || "").toLowerCase())
  ? String(process.env.COURSEWARE_OSS_ASSET_SCOPE || "").toLowerCase()
  : "playable";
const ossExtractCallbackSecret = process.env.OSS_EXTRACT_CALLBACK_SECRET || "";
const embedTokenSecret = process.env.EMBED_TOKEN_SECRET || adminSessionSecret || portalSessionSecret || "";
const embedTokenMaxAgeSeconds = Number(process.env.EMBED_TOKEN_MAX_AGE_SECONDS || 3650 * 24 * 60 * 60);
const embedPublicOrigin = process.env.EMBED_PUBLIC_ORIGIN || "";
const shareTokenMaxAgeSeconds = Number(process.env.SHARE_TOKEN_MAX_AGE_SECONDS || 30 * 24 * 60 * 60);
const loginRateLimitMaxFailures = Number(process.env.LOGIN_RATE_LIMIT_MAX_FAILURES || 8);
const loginRateLimitWindowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS || 15 * 60) * 1000;
const loginRateLimitLockMs = Number(process.env.LOGIN_RATE_LIMIT_LOCK_SECONDS || 15 * 60) * 1000;
const maxDocumentUploadBytes = Number(process.env.ADMIN_MAX_DOCUMENT_MB || 50) * 1024 * 1024;
const maxIspringUploadBytes = Number(process.env.ADMIN_MAX_ISPRING_MB || 2048) * 1024 * 1024;
const maxCoursePackageUploadBytes = Number(process.env.ADMIN_MAX_COURSE_PACKAGE_MB || 32768) * 1024 * 1024;
const coursePackageEcsSpaceFactor = Math.max(1, Number(process.env.COURSE_PACKAGE_ECS_SPACE_FACTOR || 3));
const coursePackageDiskReserveBytes = Math.max(0, Number(process.env.COURSE_PACKAGE_DISK_RESERVE_MB || 4096)) * 1024 * 1024;
const generatePreviewsAfterUploads = process.env.GENERATE_PREVIEWS_AFTER_UPLOADS === "1";
const mediaJobsEnabled = process.env.MEDIA_JOBS_ENABLED === "1";
const mediaJobsDataRoot = resolve(process.env.MEDIA_JOBS_DATA_ROOT || join(portalDataRoot, "media-jobs"));
const mediaJobsIndexPath = join(mediaJobsDataRoot, "index.json");
const mediaJobStore = createMediaJobStore({ dataRoot: mediaJobsDataRoot, indexPath: mediaJobsIndexPath });
const mediaJobsMaxConcurrency = Math.max(1, Number(process.env.MEDIA_JOBS_MAX_CONCURRENCY || 1));
const mediaJobsLogTailBytes = Math.max(16 * 1024, Number(process.env.MEDIA_JOBS_LOG_TAIL_BYTES || 200000));
const mediaJobsAutoPublishAfterUpload = process.env.MEDIA_JOBS_AUTO_PUBLISH_AFTER_UPLOAD === "1";
const mediaJobsAutoPublishAfterPackage = process.env.MEDIA_JOBS_AUTO_PUBLISH_AFTER_PACKAGE === "1";
const mediaJobsAutoPublishAfterActivate = process.env.MEDIA_JOBS_AUTO_PUBLISH_AFTER_ACTIVATE === "1";
const configuredCoursePackageImportMode = String(process.env.COURSE_PACKAGE_IMPORT_MODE || "ecs-first")
  .trim()
  .toLowerCase();
const supportedCoursePackageImportModes = new Set(["ecs-first", "hybrid-worker"]);
const coursePackageImportMode = supportedCoursePackageImportModes.has(configuredCoursePackageImportMode)
  ? configuredCoursePackageImportMode
  : "ecs-first";
if (configuredCoursePackageImportMode && !supportedCoursePackageImportModes.has(configuredCoursePackageImportMode)) {
  console.warn(`COURSE_PACKAGE_IMPORT_MODE=${configuredCoursePackageImportMode} is no longer supported; using ecs-first.`);
}
const rawCoursePackageImportRetries = Math.max(1, Number(process.env.COURSE_RAW_IMPORT_RETRIES || 3));
const courseLocalContentEnabled = process.env.COURSE_LOCAL_CONTENT_ENABLED !== "0";
const courseLocalMaxFileBytes = Math.max(1, Number(process.env.COURSE_LOCAL_MAX_FILE_MB || 50)) * 1024 * 1024;
const courseLocalMaxCourseBytes = Math.max(1, Number(process.env.COURSE_LOCAL_MAX_COURSE_MB || 1024)) * 1024 * 1024;
const courseOperationLockRoot = resolve(process.env.COURSE_OPERATION_LOCK_DIR || join(projectRoot, "deployment", "locks"));
const ossBucketUri = process.env.OSS_BUCKET_URI || "";
const ossDirectUploadConfig = directUploadConfigFromEnv(process.env, { ossBucketUri });
const ossUploadsDataRoot = resolve(process.env.OSS_UPLOADS_DATA_ROOT || join(portalDataRoot, "oss-uploads"));
const ossUploadsIndexPath = join(ossUploadsDataRoot, "index.json");
const ossUploadStore = createOssUploadRecordStore({ dataRoot: ossUploadsDataRoot, indexPath: ossUploadsIndexPath });
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
const ossutilPath = process.env.OSSUTIL_PATH || "ossutil";
const ossStatsCacheMs = Math.max(10 * 1000, Number(process.env.OSS_STATS_CACHE_SECONDS || 60) * 1000);
const ossStatsTimeoutMs = Math.max(5 * 1000, Number(process.env.OSS_STATS_TIMEOUT_MS || 30 * 1000));
const allowedExtensionsByType = {
  "course-outline": new Set([".docx", ".pdf", ".pptx", ".txt", ".md"]),
  "course-introduction": new Set([".docx", ".pdf", ".pptx", ".txt", ".md"]),
  "unit-plan": new Set([".docx", ".pdf", ".pptx", ".xlsx", ".txt", ".md"]),
  "lesson-plan": new Set([".docx", ".pdf", ".pptx", ".xlsx", ".txt", ".md"]),
  "text-material": new Set([".docx", ".pdf", ".txt", ".md"]),
  "ispring-zip": new Set([".zip"]),
  "ispring-batch-zip": new Set([".zip"]),
};
const lifecycleJobs = new Map();
const mediaJobs = new Map();
const mediaJobQueue = [];
const mediaJobChildren = new Map();
let mediaJobsInitialized = false;
let mediaJobsRunningCount = 0;
let ossStorageStatusCache = null;
const loginFailures = new Map();
const coursePackageTasks = new Map();
const coursePackageFinalizeTasks = new Map();
const operationLocks = new Map();

function isExcludedCourseCode(course) {
  return /C$/i.test(String(course || "").trim());
}

function visibleCatalogCourses(catalog) {
  return (catalog.courses || []).filter((course) => !isExcludedCourseCode(course.code));
}

function visibleRoadmapCourses(roadmap) {
  return (roadmap.courses || []).filter((course) => !isExcludedCourseCode(course.course));
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".h5p": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

function decodePath(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return urlPath;
  }
}

function resolveRequestPath(urlPath) {
  const decoded = decodePath(urlPath.split("?")[0]);
  if (decoded === "/favicon.ico") {
    return join(webRoot, "favicon.svg");
  }
  if (decoded === "/login") {
    return join(webRoot, "login.html");
  }
  if (decoded === "/teacher-admin" || decoded === "/teacher-admin/") {
    return join(webRoot, "teacher-admin.html");
  }
  if (decoded === "/" || decoded === "") {
    return shouldServeDistApp ? distIndexPath : join(webRoot, "index.html");
  }

  if (decoded.startsWith("/courseware/") && decoded.split("/").includes("_admin_uploads")) {
    return null;
  }

  const isCoursewareRequest = decoded.startsWith("/courseware/");
  const isDistAssetRequest = shouldServeDistApp && decoded.startsWith("/assets/");
  const relativePath = isCoursewareRequest ? decoded.replace(/^\/courseware\/?/i, "") : decoded;
  const root = isCoursewareRequest ? courseActiveRoot : isDistAssetRequest ? distRoot : webRoot;
  const candidate = normalize(join(root, relativePath));
  const allowedRoot = root;

  if (!candidate.startsWith(allowedRoot)) {
    return null;
  }
  return candidate;
}

function sendJson(res, statusCode, data) {
  if (res.headersSent || res.writableEnded) {
    console.warn(`Skipped JSON response ${statusCode}; headers already sent.${data?.error ? ` ${data.error}` : ""}`);
    return;
  }
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function sendNoStoreJson(res, statusCode, data) {
  if (res.headersSent || res.writableEnded) {
    console.warn(`Skipped no-store JSON response ${statusCode}; headers already sent.${data?.error ? ` ${data.error}` : ""}`);
    return;
  }
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
  });
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function lockKey(value) {
  return String(value || "global").trim().toLowerCase() || "global";
}

async function withOperationLock(key, operation) {
  const normalizedKey = lockKey(key);
  const previous = operationLocks.get(normalizedKey) || Promise.resolve();
  let release;
  const gate = new Promise((resolveGate) => {
    release = resolveGate;
  });
  const current = previous.catch(() => {}).then(() => gate);
  operationLocks.set(normalizedKey, current);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (operationLocks.get(normalizedKey) === current) {
      operationLocks.delete(normalizedKey);
    }
  }
}

function writeFileAtomicSync(path, content, encoding = "utf8") {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    writeFileSync(tmpPath, content, encoding);
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function directoryHrefForRequest(req) {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = requestUrl.pathname || "/";
  if (pathname.endsWith("/")) return pathname;
  const slashIndex = pathname.lastIndexOf("/");
  return slashIndex >= 0 ? `${pathname.slice(0, slashIndex + 1)}` : "/";
}

function injectIspringEmbedCompatibility(html, baseHref) {
  const compatibilityScript = `<script>
    (function disableIspringWebglTransitions() {
      if (!window.HTMLCanvasElement || !HTMLCanvasElement.prototype) return;
      var originalGetContext = HTMLCanvasElement.prototype.getContext;
      if (!originalGetContext || originalGetContext.__ispringNoWebgl) return;

      function patchedGetContext(type) {
        var name = String(type || "").toLowerCase();
        if (name === "webgl" || name === "experimental-webgl" || name === "webgl2") {
          return null;
        }
        return originalGetContext.apply(this, arguments);
      }

      patchedGetContext.__ispringNoWebgl = true;
      HTMLCanvasElement.prototype.getContext = patchedGetContext;
    })();

    window.ispringPresentationConnector = window.ispringPresentationConnector || {
      getState: function() { return undefined; },
      getStateText: function() { return null; },
      getStateValue: null,
      setState: function() {},
      setStateText: function() {},
      setStateValue: function() {},
      register: function(player) {
        window.__ispringPlayer = player;
      }
    };
  </script>`;
  const baseTag = baseHref && !/<base\s/i.test(html) ? `<base href="${htmlEscape(baseHref)}">` : "";
  const injection = [baseTag, compatibilityScript].filter(Boolean).join("\n    ");
  if (!injection) return html;
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n    ${injection}`);
  }
  return `${injection}\n${html}`;
}

function isRollPreviewIspringHtml(html) {
  const value = String(html || "");
  return /Preview\.createPlayer/.test(value)
    || /__PACK_NAME__/.test(value)
    || /roll-preview/i.test(value);
}

function renderIspringSameOriginEmbedWrapper({ title, src }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(title || "iSpring Courseware")}</title>
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        background: #f4f7fb;
        overflow: hidden;
      }

      iframe {
        display: block;
        width: 100%;
        height: 100vh;
        border: 0;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <iframe
      src="${htmlEscape(src)}"
      allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture"
      allowfullscreen="allowfullscreen"></iframe>
  </body>
</html>`;
}

function directoryHrefForUrl(value) {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isTrustedCoursewareAssetUrl(value) {
  if (!coursewareAssetBaseUrl) return false;
  try {
    const url = new URL(value);
    const base = new URL(`${coursewareAssetBaseUrl}/`);
    return url.protocol === "https:" && url.origin === base.origin && url.pathname.startsWith(base.pathname);
  } catch {
    return false;
  }
}

async function fetchTrustedCoursewareHtml(value) {
  if (!isTrustedCoursewareAssetUrl(value)) throw new Error("Remote iSpring URL is outside COURSEWARE_ASSET_BASE_URL.");
  const response = await fetch(value, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Remote HTML returned HTTP ${response.status}`);
  return response.text();
}

function toPosixPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function encodePathSegments(value) {
  return toPosixPath(value)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

let coursewareAssetRegistryCache = null;

function coursewareObjectKey(course, requestedPath) {
  const coursePart = safeSegment(course).toUpperCase();
  const resourcePath = encodePathSegments(requestedPath);
  return [coursewareAssetPrefix, coursePart, resourcePath].filter(Boolean).join("/");
}

function coursewareObjectKeyVariants(course, requestedPath) {
  const coursePart = safeSegment(course).toUpperCase();
  const rawPath = toPosixPath(requestedPath);
  const encodedPath = encodePathSegments(requestedPath);
  return Array.from(new Set([
    [coursewareAssetPrefix, coursePart, rawPath].filter(Boolean).join("/"),
    [coursewareAssetPrefix, coursePart, encodedPath].filter(Boolean).join("/"),
  ]));
}

function generatedCoursewareAssetUrl(course, requestedPath) {
  if (!coursewareAssetBaseUrl) return "";
  return `${coursewareAssetBaseUrl}/${encodeURIComponent(safeSegment(course).toUpperCase())}/${encodePathSegments(requestedPath)}`;
}

function appendAssetVersionQuery(url, version) {
  const value = String(url || "");
  const token = String(version || "").replace(/[^a-f0-9]/gi, "").slice(0, 12);
  if (!value || !token) return value;
  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  return `${beforeHash}${beforeHash.includes("?") ? "&" : "?"}v=${token}${hash}`;
}

function coursewareRegistryAssetUrl(asset, fallbackUrl) {
  return appendAssetVersionQuery(asset?.cdnUrl || fallbackUrl, asset?.sha256);
}

function readCoursewareAssetRegistry() {
  if (!existsSync(coursewareAssetRegistryPath)) {
    if (coursewareAssetRegistryCache?.missing) return coursewareAssetRegistryCache;
    coursewareAssetRegistryCache = { byKey: new Map(), missing: true, mtimeMs: 0 };
    return coursewareAssetRegistryCache;
  }
  try {
    const mtimeMs = statSync(coursewareAssetRegistryPath).mtimeMs;
    if (coursewareAssetRegistryCache && !coursewareAssetRegistryCache.missing && coursewareAssetRegistryCache.mtimeMs === mtimeMs) {
      return coursewareAssetRegistryCache;
    }
    const data = JSON.parse(readFileSync(coursewareAssetRegistryPath, "utf8").replace(/^\uFEFF/, ""));
    const byKey = new Map();
    for (const asset of data.assetRecords || []) {
      if (asset?.objectKey) byKey.set(toPosixPath(asset.objectKey), asset);
    }
    for (const asset of data.assets || []) {
      if (typeof asset === "string") {
        const key = toPosixPath(asset);
        if (!byKey.has(key)) byKey.set(key, {});
      } else if (asset?.objectKey) {
        const key = toPosixPath(asset.objectKey);
        byKey.set(key, { ...(byKey.get(key) || {}), ...asset });
      }
    }
    coursewareAssetRegistryCache = { byKey, missing: false, mtimeMs };
  } catch (error) {
    console.warn(`Failed to read COURSEWARE_ASSET_REGISTRY_FILE ${coursewareAssetRegistryPath}:`, error instanceof Error ? error.message : error);
    coursewareAssetRegistryCache = { byKey: new Map(), missing: true, mtimeMs: 0 };
  }
  return coursewareAssetRegistryCache;
}

function coursewareAssetUrl(course, requestedPath) {
  if (!coursewareAssetBaseUrl || coursewareAssetMode === "local") return "";
  const path = toPosixPath(requestedPath);
  if (!path) return "";
  if (coursewareAssetMode === "hybrid") {
    const registry = readCoursewareAssetRegistry();
    const asset = coursewareObjectKeyVariants(course, path)
      .map((key) => registry.byKey.get(key))
      .find(Boolean);
    if (!asset) return "";
    return coursewareRegistryAssetUrl(asset, generatedCoursewareAssetUrl(course, path));
  }
  return generatedCoursewareAssetUrl(course, path);
}

function coursewareAssetDirectoryHref(course, requestedPath) {
  const assetUrl = coursewareAssetUrl(course, requestedPath);
  if (!assetUrl) return "";
  const slash = assetUrl.lastIndexOf("/");
  return slash >= 0 ? `${assetUrl.slice(0, slash + 1)}` : "";
}

function isCoursewareCdnFallbackPath(requestedPath) {
  const normalized = `/${toPosixPath(requestedPath).toLowerCase()}`;
  return normalized.includes("/html5-package/")
    || normalized.includes("/html5-package-admin/")
    || normalized.includes("/ispring-localized/");
}

function coursewareCdnFallbackUrl(course, requestedPath) {
  if (!coursewareAssetBaseUrl || coursewareAssetMode === "local") return "";
  const assetUrl = coursewareAssetUrl(course, requestedPath);
  if (assetUrl) return assetUrl;
  if (!isCoursewareCdnFallbackPath(requestedPath)) return "";
  return generatedCoursewareAssetUrl(course, requestedPath);
}

function shouldProxyCoursewareCdnFallback(requestedPath) {
  return new Set([
    ".css",
    ".js",
    ".json",
    ".map",
    ".wasm",
    ".xml",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
  ]).has(extname(requestedPath).toLowerCase());
}

async function sendCoursewareCdnFallback(req, res, course, requestedPath) {
  const assetUrl = coursewareCdnFallbackUrl(course, requestedPath);
  if (!assetUrl) return false;
  if (!shouldProxyCoursewareCdnFallback(requestedPath)) {
    res.writeHead(302, {
      Location: assetUrl,
      "Cache-Control": "public, max-age=300",
    });
    res.end();
    return true;
  }

  const response = await fetch(assetUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) return false;
  const ext = extname(requestedPath).toLowerCase();
  const headers = {
    "Content-Type": response.headers.get("content-type") || mimeTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  await pipeline(Readable.fromWeb(response.body), res);
  return true;
}

function sendRateLimitJson(res, retryAfterSeconds) {
  res.writeHead(429, {
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": String(Math.max(1, retryAfterSeconds)),
  });
  res.end(`${JSON.stringify({ ok: false, error: "Too many failed login attempts. Try again later.", retryAfterSeconds }, null, 2)}\n`);
}

function hasLocalResource(item) {
  const source = String(item?.source || "").toLowerCase();
  const trustedRemote = ["cdn", "oss"].includes(source);
  return Boolean(item?.path || item?.previewPath || item?.downloadPath || (trustedRemote && (item?.url || item?.previewUrl || item?.downloadUrl)));
}

function sanitizePublicResource(item) {
  if (!item || typeof item !== "object") return null;
  const sanitized = { ...item };
  const source = String(sanitized.source || "").toLowerCase();
  const trustedRemote = ["cdn", "oss"].includes(source);
  if (!sanitized.path && !trustedRemote) delete sanitized.url;
  if (!sanitized.previewPath && !trustedRemote) delete sanitized.previewUrl;
  if (!sanitized.downloadPath && !trustedRemote) delete sanitized.downloadUrl;
  if (String(sanitized.source || "").toLowerCase().includes("moodle")) delete sanitized.source;
  return hasLocalResource(sanitized) ? sanitized : null;
}

function sanitizePublicResourceList(items) {
  return (items || []).map(sanitizePublicResource).filter(Boolean);
}

function sanitizePublicText(text) {
  const sanitized = { ...text };
  sanitized.materials = sanitizePublicResourceList(text.materials || []);
  sanitized.externalLinks = [];
  if (String(sanitized.sourceStatus || "").toLowerCase().includes("moodle")) {
    sanitized.sourceStatus = sanitized.materials.length ? "downloadable" : "pending_download";
  }
  return sanitized;
}

function sanitizePublicSourceAudit(sourceAudit = {}) {
  return Object.fromEntries(
    Object.entries(sourceAudit).filter(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      const normalizedValue = String(value || "").toLowerCase();
      if (normalizedKey.includes("moodle")) return false;
      if (normalizedKey === "outlineurl" && normalizedValue.includes("esunnybrook.com")) return false;
      return true;
    }),
  );
}

function sanitizePublicLesson(lesson, course) {
  const bookSections = (lesson.bookSections || []).filter((item) => !isGeneratedLocalPackageNoteResource(course, item));
  return {
    ...lesson,
    title: lesson.title === "Moodle Activity Index" ? "Resource Index" : lesson.title,
    lessonPlan: sanitizePublicResource(lesson.lessonPlan),
    downloads: sanitizePublicResourceList(lesson.downloads || []),
    textExports: sanitizePublicResourceList(lesson.textExports || []),
    bookSections: sanitizePublicResourceList(bookSections),
    ispring: sanitizePublicResourceList(lesson.ispring || []),
  };
}

function sanitizePublicManifest(manifest) {
  return {
    ...manifest,
    course: {
      ...manifest.course,
      source: String(manifest.course?.source || "").toLowerCase().includes("moodle")
        ? "Authenticated course shell"
        : manifest.course?.source,
    },
    sourceAudit: sanitizePublicSourceAudit(manifest.sourceAudit),
    courseDownloads: sanitizePublicResourceList(manifest.courseDownloads || []),
    texts: (manifest.texts || []).map(sanitizePublicText),
    units: (manifest.units || []).map((unit) => ({
      ...unit,
      unitPlan: sanitizePublicResource(unit.unitPlan),
      lessons: (unit.lessons || []).map((lesson) => sanitizePublicLesson(lesson, manifest.course?.code)),
    })),
  };
}

function filterCatalogForSession(catalog, session) {
  const activeCourses = visibleCatalogCourses(catalog).filter((course) => isCourseActive(course.code));
  if (!portalLoginConfigured() || hasAllCourseAccess(session)) {
    return {
      ...catalog,
      defaultCourse: activeCourses.some((course) => course.code === catalog.defaultCourse) ? catalog.defaultCourse : activeCourses[0]?.code || "",
      courses: activeCourses,
    };
  }
  const courses = activeCourses.filter((course) => canAccessCourse(session, course.code));
  return {
    ...catalog,
    defaultCourse: courses.some((course) => course.code === catalog.defaultCourse) ? catalog.defaultCourse : courses[0]?.code || "",
    courses,
  };
}

function filterRoadmapForSession(roadmap, session) {
  const activeCourses = visibleRoadmapCourses(roadmap).filter((course) => isCourseActive(course.course));
  if (!portalLoginConfigured() || hasAllCourseAccess(session)) {
    return {
      ...roadmap,
      courses: activeCourses,
    };
  }
  return {
    ...roadmap,
    courses: activeCourses.filter((course) => canAccessCourse(session, course.course)),
  };
}

async function sendPublicCourseCatalog(req, pathname, res) {
  if (pathname !== "/course-catalog.json") return false;
  const catalog = await readCourseCatalog();
  sendNoStoreJson(res, 200, filterCatalogForSession(catalog, readPortalSession(req)));
  return true;
}

async function sendPublicCourseRoadmap(req, pathname, res) {
  if (pathname !== "/course-roadmap.json") return false;
  const roadmap = JSON.parse(await readFile(join(projectRoot, "public", "course-roadmap.json"), "utf8"));
  sendNoStoreJson(res, 200, filterRoadmapForSession(roadmap, readPortalSession(req)));
  return true;
}

async function sendPublicCourseManifest(req, pathname, res) {
  const match = /^\/courseware\/([^/]+)\/course-manifest\.json$/i.exec(pathname);
  if (!match) return false;
  const course = safeSegment(match[1]).toUpperCase();
  if (!isCourseActive(course)) {
    sendJson(res, 423, { ok: false, error: "This course is archived and must be activated by an administrator." });
    return true;
  }
  if (!canAccessCourse(readPortalSession(req), course)) {
    sendJson(res, 403, { ok: false, error: "You do not have access to this course." });
    return true;
  }
  const manifest = await readManifest(course);
  sendNoStoreJson(res, 200, sanitizePublicManifest(manifest));
  return true;
}

function timingSafeStringEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function portalAuthConfigured() {
  return Boolean(portalAuthUsername && portalAuthPassword);
}

function readBasicAuth(req) {
  const header = req.headers.authorization || "";
  if (!header.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isPortalAuthorized(req) {
  if (!portalAuthConfigured()) return true;
  const credentials = readBasicAuth(req);
  if (!credentials) return false;
  return timingSafeStringEqual(credentials.username, portalAuthUsername) && timingSafeStringEqual(credentials.password, portalAuthPassword);
}

function requestPortalAuth(res) {
  res.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "WWW-Authenticate": `Basic realm="${portalAuthRealm.replaceAll('"', "")}", charset="UTF-8"`,
  });
  res.end("Authentication required");
}

function loadPortalUsers() {
  if (portalUsersJson) {
    const parsed = JSON.parse(portalUsersJson);
    if (!Array.isArray(parsed)) throw new Error("PORTAL_USERS_JSON must be a JSON array.");
    return parsed.map(normalizePortalUser).filter((user) => user.username);
  }
  if (adminUsername && adminPassword) {
    return [
      normalizePortalUser({
        username: adminUsername,
        password: adminPassword,
        role: "admin",
        courses: ["*"],
      }),
    ];
  }
  return [];
}

function normalizePortalUser(user) {
  const displayName = String(user.displayName || user.nickname || user.name || user.fullName || "").trim();
  return {
    username: String(user.username || "").trim(),
    displayName,
    password: user.password ? String(user.password) : undefined,
    passwordHash: user.passwordHash ? String(user.passwordHash) : undefined,
    role: String(user.role || "teacher").trim() || "teacher",
    courses: Array.isArray(user.courses) ? user.courses.map((course) => String(course).trim().toUpperCase()).filter(Boolean) : [],
    status: String(user.status || "active"),
    createdAt: user.createdAt || new Date().toISOString(),
    updatedAt: user.updatedAt || new Date().toISOString(),
  };
}

function publicPortalUser(user) {
  return {
    username: user.username,
    displayName: user.displayName || "",
    role: user.role,
    courses: user.courses,
    status: user.status || "active",
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    passwordStored: user.passwordHash ? "hash" : user.password ? "env" : "missing",
  };
}

function normalizeCourseLifecycleStatus(status) {
  const value = String(status || "active").trim().toLowerCase();
  return ["active", "archived", "extracting", "archiving", "error"].includes(value) ? value : "active";
}

function readCourseStatusStore() {
  if (!existsSync(courseStatusPath)) return { schemaVersion: 1, updatedAt: null, courses: {} };
  const parsed = JSON.parse(readFileSync(courseStatusPath, "utf8"));
  const rawCourses = parsed && typeof parsed === "object" && parsed.courses && typeof parsed.courses === "object" ? parsed.courses : {};
  const courses = {};
  for (const [code, record] of Object.entries(rawCourses)) {
    const normalizedCode = safeSegment(code).toUpperCase();
    if (!normalizedCode) continue;
    courses[normalizedCode] = {
      status: normalizeCourseLifecycleStatus(record?.status),
      updatedAt: record?.updatedAt || null,
      updatedBy: record?.updatedBy || null,
      note: record?.note ? String(record.note) : "",
    };
  }
  return {
    schemaVersion: 1,
    updatedAt: parsed.updatedAt || null,
    courses,
  };
}

function saveCourseStatusStore(store) {
  const normalized = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    courses: store.courses || {},
  };
  writeJsonFile(courseStatusPath, normalized);
  return normalized;
}

function courseLifecycleRecord(course) {
  const code = safeSegment(course).toUpperCase();
  const record = readCourseStatusStore().courses[code];
  return {
    course: code,
    status: normalizeCourseLifecycleStatus(record?.status || "active"),
    updatedAt: record?.updatedAt || null,
    updatedBy: record?.updatedBy || null,
    note: record?.note || "",
  };
}

function isCourseActive(course) {
  return courseLifecycleRecord(course).status === "active";
}

function setCourseLifecycleStatus(course, status, actor, note = "") {
  const code = safeSegment(course).toUpperCase();
  if (!code) throw new Error("Course is required.");
  const store = readCourseStatusStore();
  const now = new Date().toISOString();
  store.courses[code] = {
    status: normalizeCourseLifecycleStatus(status),
    updatedAt: now,
    updatedBy: actor || null,
    note: String(note || "").slice(0, 500),
  };
  const saved = saveCourseStatusStore(store);
  return { course: code, ...saved.courses[code] };
}

async function setLaunchCourseAllowlist(courses, actor, note = "") {
  const catalog = await readCourseCatalog();
  const catalogCourses = visibleCatalogCourses(catalog).map((courseEntry) => safeSegment(courseEntry.code).toUpperCase()).filter(Boolean);
  const catalogSet = new Set(catalogCourses);
  const activeSet = new Set((courses || []).map((course) => safeSegment(course).toUpperCase()).filter(Boolean));
  const unknown = [...activeSet].filter((course) => !catalogSet.has(course));
  if (!activeSet.size) throw new Error("At least one launch course is required.");
  if (unknown.length) throw new Error(`Launch course(s) are not in the catalog: ${unknown.join(", ")}`);

  const now = new Date().toISOString();
  const store = readCourseStatusStore();
  store.courses = store.courses || {};
  for (const course of catalogCourses) {
    const active = activeSet.has(course);
    store.courses[course] = {
      status: active ? "active" : "archived",
      updatedAt: now,
      updatedBy: actor || null,
      note: active
        ? String(note || "Initial launch course; visible to assigned teachers.").slice(0, 500)
        : "Hidden from launch until this course is completed and activated.",
    };
  }
  const saved = saveCourseStatusStore(store);
  return {
    launchCourses: [...activeSet],
    catalogCourseCount: catalogCourses.length,
    activeCourseCount: activeSet.size,
    archivedCourseCount: catalogCourses.length - activeSet.size,
    courses: catalogCourses.map((course) => ({ course, ...saved.courses[course] })),
  };
}

function parseJobPayload(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const end = text.lastIndexOf("}");
    if (end < 0) return null;
    for (let start = text.lastIndexOf("{"); start >= 0; start = text.lastIndexOf("{", start - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Keep walking backward; media jobs print several JSON summaries.
      }
    }
    return null;
  }
}

function effectiveMediaJobStatus(job) {
  if (job.exitCode !== 0 || !["warning", "succeeded"].includes(job.status)) return job.status;
  const stdoutPath = mediaJobPath(job.id, "stdout.log");
  const stderrPath = mediaJobPath(job.id, "stderr.log");
  const stdout = readFileTail(stdoutPath, Math.min(mediaJobsLogTailBytes, 300000));
  const stderr = readFileTail(stderrPath, Math.min(mediaJobsLogTailBytes, 120000));
  const payload = job.payload || parseJobPayload(stdout) || parseJobPayload(stderr);
  return mediaJobSucceededStatus({ ...job, payload }, stdout, stderr);
}

function publicLifecycleJob(job) {
  return {
    id: job.id,
    action: job.action,
    course: job.course,
    status: job.status,
    requestedBy: job.requestedBy,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    exitCode: job.exitCode ?? null,
    deleteActive: Boolean(job.deleteActive),
    force: Boolean(job.force),
    setArchived: Boolean(job.setArchived),
    payload: job.payload || null,
    error: job.error || null,
    stdout: job.stdout ? job.stdout.slice(-4000) : "",
    stderr: job.stderr ? job.stderr.slice(-4000) : "",
  };
}

function listLifecycleJobs() {
  return [...lifecycleJobs.values()]
    .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
    .slice(0, 50)
    .map(publicLifecycleJob);
}

function mediaJobPath(id, name) {
  return mediaJobStore.jobPath(id, name);
}

function readJsonFileSync(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function mediaConfig() {
  return {
    enabled: mediaJobsEnabled,
    maxConcurrency: mediaJobsMaxConcurrency,
    coursewareRoot: courseActiveRoot,
    assetMode: coursewareAssetMode,
    assetScope: coursewareOssAssetScope,
    bucket: ossBucketUri,
    cdnBaseUrl: coursewareAssetBaseUrl,
    assetPrefix: coursewareAssetPrefix,
    registryFile: coursewareAssetRegistryPath,
    ffmpeg: ffmpegPath,
    ffprobe: ffprobePath,
    ossutil: ossutilPath,
    autoPublishAfterUpload: mediaJobsAutoPublishAfterUpload,
    autoPublishAfterPackage: mediaJobsAutoPublishAfterPackage,
    autoPublishAfterActivate: mediaJobsAutoPublishAfterActivate,
    coursePackageImportMode,
    directUpload: directUploadPublicConfig(),
  };
}

function directUploadPublicConfig() {
  return buildDirectUploadPublicConfig(ossDirectUploadConfig);
}

async function createDirectUploadPolicy({ course, fileName, fileSize, contentType, kind, actor }) {
  if (!isRawCoursePackageUploadKind(kind)) {
    throw new Error("OSS browser upload is reserved for raw course ZIP packages handled by the ECS worker. Use the course package upload entry; media/iSpring/H5P publishing is automatic.");
  }
  const catalog = await readCourseCatalog();
  const courseCodes = (catalog.courses || []).map((entry) => entry.code);
  const size = Number(fileSize || 0);
  if (isRawCoursePackageUploadKind(kind) || size > ossDirectUploadConfig.simpleMaxBytes) {
    const resolved = resolveDirectUploadCourse({ course, fileName, kind, courseCodes });
    const reusable = findReusableMultipartUpload({
      course: resolved.course,
      kind: resolved.kind,
      fileName,
      fileSize: size,
    });
    if (reusable) {
      try {
        const { record, multipart } = await resumeDirectMultipartUpload({
          config: ossDirectUploadConfig,
          record: reusable,
        });
        ossUploadStore.writeRecord(record);
        return { record, multipart };
      } catch (error) {
        reusable.resumeError = error.message || String(error);
        reusable.resumeFailedAt = new Date().toISOString();
        ossUploadStore.writeRecord(reusable);
      }
    }
    const { record, multipart } = await createDirectMultipartUpload({
      config: ossDirectUploadConfig,
      courseCodes,
      course,
      fileName,
      fileSize,
      contentType,
      kind,
      actor,
      mimeTypes,
    });
    ossUploadStore.writeRecord(record);
    return { record, multipart };
  }
  const { record, form } = buildDirectUploadPolicy({
    config: ossDirectUploadConfig,
    courseCodes,
    course,
    fileName,
    fileSize,
    contentType,
    kind,
    actor,
    mimeTypes,
  });
  ossUploadStore.writeRecord(record);
  return { record, form };
}

function findReusableMultipartUpload({ course, kind, fileName, fileSize }) {
  const normalizedCourse = safeSegment(course || "").toUpperCase();
  const normalizedKind = String(kind || "");
  const normalizedFileName = String(fileName || "");
  const normalizedSize = Number(fileSize || 0);
  const reusableStatuses = new Set(["initialized", "failed"]);
  return ossUploadStore.listRecords({ course: normalizedCourse, limit: 200 })
    .map((item) => ossUploadStore.readRecord(item.id))
    .find((record) =>
      record?.uploadMode === "multipart"
      && record?.multipartUploadId
      && reusableStatuses.has(record.status)
      && !record.completedAt
      && !record.importId
      && record.course === normalizedCourse
      && record.kind === normalizedKind
      && record.fileName === normalizedFileName
      && Number(record.fileSize || 0) === normalizedSize
    ) || null;
}

function verifyOssObjectWithOssutil(ossUri) {
  if (!ossUri) throw new Error("Missing OSS object URI.");
  if (!ossutilPath) throw new Error("ossutil is not configured.");
  const result = spawnSync(ossutilPath, ["ls", ossUri], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: ossStatsTimeoutMs,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `ossutil exited ${result.status}`).trim());
  }
  return parseOssListOutput(result.stdout || "");
}

function runOssutilCapture(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(ossutilPath, args, {
      cwd: projectRoot,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const keepTail = (value, chunk) => `${value}${chunk.toString("utf8")}`.slice(-20000);
    child.stdout.on("data", (chunk) => {
      stdout = keepTail(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = keepTail(stderr, chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error((stderr || stdout || `ossutil exited ${code}`).trim()));
    });
  });
}

function ossStatsTargetUri() {
  if (!ossBucketUri) return "";
  const bucket = String(ossBucketUri).replace(/\/+$/, "");
  const prefix = toPosixPath(coursewareAssetPrefix).replace(/\/+$/, "");
  return prefix ? `${bucket}/${prefix}/` : `${bucket}/`;
}

function parseOssListOutput(output) {
  let objectCount = null;
  let totalBytes = 0;
  let listedObjects = 0;
  for (const line of String(output || "").split(/\r?\n/)) {
    const countMatch = /Object Number is:\s*(\d+)/i.exec(line);
    if (countMatch) objectCount = Number(countMatch[1]);
    const objectMatch = /^\d{4}-\d{2}-\d{2}\s+\S+\s+(?:[+-]\d{4}\s+)?(?:[A-Z]{2,5}\s+)?(\d+)\s+\S+\s+\S+\s+oss:\/\//.exec(line.trim());
    if (objectMatch) {
      listedObjects += 1;
      totalBytes += Number(objectMatch[1]);
    }
  }
  return {
    objectCount: objectCount ?? listedObjects,
    totalBytes,
  };
}

function readOssStorageStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && ossStorageStatusCache && ossStorageStatusCache.expiresAt > now) {
    return { ...ossStorageStatusCache.value, cacheHit: true };
  }
  const generatedAt = new Date().toISOString();
  const target = ossStatsTargetUri();
  const base = {
    enabled: Boolean(ossBucketUri),
    ok: false,
    status: "unconfigured",
    bucket: ossBucketUri,
    target,
    prefix: coursewareAssetPrefix,
    objectCount: 0,
    totalBytes: 0,
    generatedAt,
    cacheHit: false,
    cacheSeconds: Math.round(ossStatsCacheMs / 1000),
    command: "",
    error: "",
  };
  if (!target) {
    const value = { ...base, error: "OSS_BUCKET_URI is not configured." };
    ossStorageStatusCache = { expiresAt: now + ossStatsCacheMs, value };
    return value;
  }

  const command = `${ossutilPath} ls ${target}`;
  try {
    const result = spawnSync(ossutilPath, ["ls", target], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: ossStatsTimeoutMs,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || `ossutil exited ${result.status}`).trim());
    }
    const parsed = parseOssListOutput(result.stdout || "");
    const value = {
      ...base,
      ok: true,
      status: "ok",
      objectCount: parsed.objectCount,
      totalBytes: parsed.totalBytes,
      command,
      error: "",
    };
    ossStorageStatusCache = { expiresAt: now + ossStatsCacheMs, value };
    return value;
  } catch (error) {
    const value = {
      ...base,
      status: "error",
      command,
      error: error instanceof Error ? error.message : String(error),
    };
    ossStorageStatusCache = { expiresAt: now + ossStatsCacheMs, value };
    return value;
  }
}

function assertMediaJobsEnabled() {
  if (!mediaJobsEnabled) {
    throw new Error("Media jobs are disabled. Set MEDIA_JOBS_ENABLED=1 after the current command-line migration is complete.");
  }
}

function parseMediaJobProgress(job) {
  const stdoutPath = mediaJobPath(job.id, "stdout.log");
  const stderrPath = mediaJobPath(job.id, "stderr.log");
  const stdout = readFileTail(stdoutPath, Math.min(mediaJobsLogTailBytes, 300000));
  const stderr = readFileTail(stderrPath, Math.min(mediaJobsLogTailBytes, 120000));
  return parseMediaJobProgressFromText(job, `${stdout}\n${stderr}`);
}

function publicMediaJob(job) {
  const status = effectiveMediaJobStatus(job);
  const progress = parseMediaJobProgress({ ...job, status });
  const stdoutTail = readFileTail(mediaJobPath(job.id, "stdout.log"), Math.min(mediaJobsLogTailBytes, 80000));
  const stderrTail = readFileTail(mediaJobPath(job.id, "stderr.log"), Math.min(mediaJobsLogTailBytes, 80000));
  const displayJob = { ...job, status, progress, stdoutTail, stderrTail };
  return {
    id: job.id,
    type: job.type,
    scope: job.scope,
    course: job.course || null,
    status,
    requestedBy: job.requestedBy,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    pid: job.pid || null,
    exitCode: job.exitCode ?? null,
    params: job.params || {},
    progress,
    display: mediaJobDisplay(displayJob),
    summary: job.summary || null,
    payload: job.payload || null,
    error: job.error || null,
    logs: {
      stdout: mediaJobPath(job.id, "stdout.log"),
      stderr: mediaJobPath(job.id, "stderr.log"),
      report: mediaJobPath(job.id, "report.json"),
    },
  };
}

function publicCourseOperationLock(lock) {
  const activeJob = [...mediaJobs.values()]
    .filter((job) => activeMediaJobStatuses.has(job.status) && mediaWriteJobTypes.has(job.type))
    .find((job) => job.course === lock.course || job.scope === "all") || null;
  return {
    course: lock.course,
    operation: lock.operation,
    pid: lock.pid,
    pidAlive: lock.pidAlive,
    startedAt: lock.startedAt,
    ageSeconds: lock.ageSeconds,
    stale: lock.stale,
    activeJob: activeJob ? publicMediaJob(activeJob) : null,
    canClear: lock.stale && !activeJob,
  };
}

function mediaLockStatus() {
  ensureMediaJobsLoaded();
  const locks = listCourseLocks({ lockRoot: courseOperationLockRoot }).map(publicCourseOperationLock);
  return {
    root: courseOperationLockRoot,
    count: locks.length,
    staleCount: locks.filter((lock) => lock.stale).length,
    clearableCount: locks.filter((lock) => lock.canClear).length,
    locks,
  };
}

function clearStaleCourseOperationLock(course) {
  ensureMediaJobsLoaded();
  const safeCourse = safeSegment(course || "").toUpperCase();
  if (!safeCourse) throw new Error("Course is required.");
  const activeJob = [...mediaJobs.values()]
    .filter((job) => activeMediaJobStatuses.has(job.status))
    .find((job) => job.course === safeCourse || job.scope === "all");
  if (activeJob) throw new Error(`Course ${safeCourse} has an active media job (${activeJob.id}); refusing to clear its lock.`);
  const removed = removeCourseLock(safeCourse, { lockRoot: courseOperationLockRoot, requireStale: true });
  return publicCourseOperationLock(removed);
}

function clearAllStaleCourseOperationLocks() {
  ensureMediaJobsLoaded();
  const before = mediaLockStatus();
  const removed = [];
  const skipped = [];
  const failed = [];
  for (const lock of before.locks) {
    if (!lock.canClear) {
      skipped.push({
        course: lock.course,
        reason: lock.activeJob ? `active media job ${lock.activeJob.id}` : lock.stale ? "not clearable" : "not stale",
      });
      continue;
    }
    try {
      removed.push(clearStaleCourseOperationLock(lock.course));
    } catch (error) {
      failed.push({
        course: lock.course,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    removed,
    skipped,
    failed,
    locks: mediaLockStatus(),
  };
}

function persistMediaJobsIndex() {
  mediaJobStore.writeIndex(mediaJobs.values());
}

function persistMediaJob(job) {
  mediaJobStore.writeJobAndIndex(job, mediaJobs.values());
}

function ensureMediaJobsLoaded() {
  if (mediaJobsInitialized) return;
  mediaJobsInitialized = true;
  for (const job of mediaJobStore.loadJobs()) {
    mediaJobs.set(job.id, job);
  }
  for (const job of mediaJobs.values()) {
    if (job.status === "queued") mediaJobQueue.push(job.id);
  }
  if (mediaJobs.size) persistMediaJobsIndex();
}

function listMediaJobs({ status = "", course = "", limit = 50 } = {}) {
  ensureMediaJobsLoaded();
  const normalizedCourse = safeSegment(course || "").toUpperCase();
  return [...mediaJobs.values()]
    .filter((job) => !status || job.status === status)
    .filter((job) => !normalizedCourse || job.course === normalizedCourse)
    .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
    .slice(0, limit)
    .map(publicMediaJob);
}

function mediaJobCommand(job) {
  return buildMediaJobCommand(job, {
    coursewareRoot: courseActiveRoot,
    bucket: ossBucketUri,
    cdnBaseUrl: coursewareAssetBaseUrl,
    assetMode: coursewareAssetMode,
    assetScope: coursewareOssAssetScope,
    registry: coursewareAssetRegistryPath,
    ffmpeg: ffmpegPath,
    ffprobe: ffprobePath,
    ossutil: ossutilPath,
    uploadsRoot: ossUploadsDataRoot,
  });
}

function createMediaJob({ type, course, actor, params = {} }) {
  ensureMediaJobsLoaded();
  assertMediaJobsEnabled();
  const normalizedType = normalizeMediaJobType(type);
  const scope = mediaJobScope(normalizedType, course);
  const runningPublish = [...mediaJobs.values()].find((job) => activeMediaJobStatuses.has(job.status) && mediaWriteJobTypes.has(job.type));
  if (runningPublish && mediaWriteJobTypes.has(normalizedType)) {
    throw new Error(`A media publish/sync job is already active (${runningPublish.id}). Wait for it to finish before starting another.`);
  }
  const id = `media-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  const job = {
    schemaVersion: 1,
    id,
    type: normalizedType,
    ...scope,
    status: "queued",
    requestedBy: actor || "unknown",
    requestedAt: now,
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    params: {
      coursewareRoot: params.coursewareRoot || courseActiveRoot,
      bucket: params.bucket || ossBucketUri,
      cdnBaseUrl: params.cdnBaseUrl || coursewareAssetBaseUrl,
      assetMode: params.assetMode || coursewareAssetMode,
      assetScope: params.assetScope || coursewareOssAssetScope,
      registry: params.registry || coursewareAssetRegistryPath,
      ffmpeg: params.ffmpeg || ffmpegPath,
      ffprobe: params.ffprobe || ffprobePath,
      ossutil: params.ossutil || ossutilPath,
      applyOptimize: params.applyOptimize !== false,
      applyOss: params.applyOss !== false,
      skipPreheat: Boolean(params.skipPreheat),
      skipReadiness: Boolean(params.skipReadiness),
      audit: params.audit || "",
      uploadId: params.uploadId || "",
    },
    command: [],
    summary: null,
    payload: null,
    error: null,
  };
  job.command = [process.execPath, ...mediaJobCommand(job)];
  mediaJobs.set(id, job);
  mediaJobQueue.push(id);
  persistMediaJob(job);
  runNextMediaJobs();
  return publicMediaJob(job);
}

function tryCreateMediaJob({ type, course, actor, params = {} }) {
  try {
    if (!mediaJobsEnabled) return { job: null, warning: "" };
    return { job: createMediaJob({ type, course, actor, params }), warning: "" };
  } catch (error) {
    return { job: null, warning: error instanceof Error ? error.message : String(error) };
  }
}

function syncOssUploadFromMediaJob(job) {
  const uploadId = safeSegment(job?.params?.uploadId || "");
  if (!uploadId) return;
  const record = ossUploadStore.readRecord(uploadId);
  if (!record) return;
  if (job.type !== "index-oss") return;

  const done = ["succeeded", "warning"].includes(job.status);
  const stopped = ["failed", "cancelled", "interrupted"].includes(job.status);
  if (!done && !stopped) return;

  const now = new Date().toISOString();
  const patch = {
    jobId: job.id,
    mediaJobWarning: job.status === "warning" ? "OSS 索引完成但存在警告，请查看媒体任务日志。" : "",
  };
  if (done) {
    Object.assign(patch, {
      status: "imported",
      importStatus: job.status === "warning" ? "indexed-with-warnings" : "indexed",
      mediaStatus: job.status === "warning" ? "warning" : "ready",
      hasPlayableMedia: true,
      importedAt: now,
      ingestMessage: "OSS 资源已索引，播放和下载将使用 OSS/CDN；课程壳由 ECS 提供。",
      error: "",
    });
  } else {
    Object.assign(patch, {
      status: "uploaded",
      importStatus: `oss-index-${job.status}`,
      mediaStatus: "failed",
      ingestMessage: "OSS 资源索引任务未完成，请查看媒体任务日志后重试索引。",
      error: job.error || "",
    });
  }
  ossUploadStore.patchRecord(uploadId, patch);
}

function runNextMediaJobs() {
  ensureMediaJobsLoaded();
  while (mediaJobsRunningCount < mediaJobsMaxConcurrency && mediaJobQueue.length) {
    const id = mediaJobQueue.shift();
    const job = mediaJobs.get(id);
    if (!job || job.status !== "queued") continue;
    runMediaJob(job);
  }
}

function runMediaJob(job) {
  mediaJobsRunningCount += 1;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.command = [process.execPath, ...mediaJobCommand(job)];
  persistMediaJob(job);
  const stdoutPath = mediaJobPath(job.id, "stdout.log");
  const stderrPath = mediaJobPath(job.id, "stderr.log");
  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });
  const child = spawn(process.execPath, job.command.slice(1), {
    cwd: projectRoot,
    env: process.env,
    windowsHide: true,
  });
  let settled = false;
  mediaJobChildren.set(job.id, child);
  job.pid = child.pid || null;
  persistMediaJob(job);
  child.stdout.on("data", (chunk) => stdoutStream.write(chunk));
  child.stderr.on("data", (chunk) => stderrStream.write(chunk));
  child.on("error", (error) => {
    if (settled) return;
    settled = true;
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    stdoutStream.end();
    stderrStream.end();
    mediaJobChildren.delete(job.id);
    mediaJobsRunningCount = Math.max(0, mediaJobsRunningCount - 1);
    syncOssUploadFromMediaJob(job);
    persistMediaJob(job);
    runNextMediaJobs();
  });
  child.on("close", (exitCode) => {
    if (settled) return;
    settled = true;
    stdoutStream.end();
    stderrStream.end();
    mediaJobChildren.delete(job.id);
    mediaJobsRunningCount = Math.max(0, mediaJobsRunningCount - 1);
    job.exitCode = exitCode;
    job.finishedAt = new Date().toISOString();
    const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf8") : "";
    const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
    job.payload = parseJobPayload(stdout) || parseJobPayload(stderr);
    job.summary = job.payload?.summaries || job.payload?.summary || job.payload || null;
    if (job.status === "cancelling") {
      job.status = "cancelled";
    } else if (exitCode === 0) {
      job.status = mediaJobSucceededStatus(job, stdout, stderr);
    } else {
      job.status = "failed";
      job.error = stderr.slice(-4000) || stdout.slice(-4000) || `Media job exited ${exitCode}`;
    }
    syncOssUploadFromMediaJob(job);
    mediaJobStore.writeReport(job, publicMediaJob(job));
    persistMediaJob(job);
    runNextMediaJobs();
  });
}

function cancelMediaJob(id) {
  ensureMediaJobsLoaded();
  const job = mediaJobs.get(safeSegment(id));
  if (!job) throw new Error("Media job not found.");
  if (job.status === "queued") {
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    persistMediaJob(job);
    return publicMediaJob(job);
  }
  if (job.status !== "running") return publicMediaJob(job);
  job.status = "cancelling";
  persistMediaJob(job);
  const child = mediaJobChildren.get(job.id);
  if (child) child.kill("SIGTERM");
  return publicMediaJob(job);
}

function retryMediaJob(id, actor) {
  ensureMediaJobsLoaded();
  const job = mediaJobs.get(safeSegment(id));
  if (!job) throw new Error("Media job not found.");
  if (!retryableMediaJobStatuses.has(job.status)) {
    throw new Error("Only failed, warning, cancelled, or interrupted media jobs can be retried.");
  }
  return createMediaJob({ type: job.type, course: job.course, actor, params: job.params });
}

function readFileTail(path, maxBytes = mediaJobsLogTailBytes) {
  if (!existsSync(path)) return "";
  const buffer = readFileSync(path);
  return buffer.slice(Math.max(0, buffer.length - maxBytes)).toString("utf8");
}

function mediaJobLog(id, stream, tailLines) {
  const job = mediaJobs.get(safeSegment(id));
  if (!job) throw new Error("Media job not found.");
  const filename = stream === "stderr" ? "stderr.log" : "stdout.log";
  const text = readFileTail(mediaJobPath(job.id, filename));
  const lines = Number(tailLines || 0);
  return lines > 0 ? text.split(/\r?\n/).slice(-lines).join("\n") : text;
}

function registryAssetSet() {
  const parsed = readJsonFileSync(coursewareAssetRegistryPath, { assets: [] });
  const assets = Array.isArray(parsed?.assets) ? parsed.assets : [];
  return new Set(assets.map((item) => typeof item === "string" ? item : item?.objectKey).filter(Boolean));
}

function walkCourseFilesSync(root, result = []) {
  if (!existsSync(root)) return result;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "_admin_uploads" || entry.name.startsWith(".")) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkCourseFilesSync(full, result);
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

async function mediaCourseStatus(courseEntry, assetSet) {
  const code = safeSegment(courseEntry.code || courseEntry).toUpperCase();
  const root = courseRoot(code);
  const manifest = readJsonFileSync(join(root, "course-manifest.json"), null);
  const files = walkCourseFilesSync(root);
  const mediaFiles = coursewareOssAssetScope === "all"
    ? files
    : files.filter((file) => isPlayableCoursewareAsset(relative(root, file)));
  const videoExts = playableCoursewareVideoExts;
  let totalBytes = 0;
  let videoCount = 0;
  for (const file of mediaFiles) {
    try {
      const itemStat = await stat(file);
      totalBytes += itemStat.size;
      if (videoExts.has(extname(file).toLowerCase())) videoCount += 1;
    } catch {
      // Ignore files that change during upload/import.
    }
  }
  const prefix = `${coursewareAssetPrefix}/${code}/`;
  const published = mediaFiles.filter((file) => {
    const objectKey = `${prefix}${toPosixPath(relative(root, file))}`;
    return assetSet.has(objectKey);
  }).length;
  const relatedJobs = [...mediaJobs.values()]
    .filter((job) => job.course === code || job.scope === "all")
    .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  const courseJobs = relatedJobs.filter((job) => job.course === code);
  const activeJob = relatedJobs.find((job) =>
    activeMediaJobStatuses.has(job.status)
    && (job.course === code || (job.scope === "all" && mediaWriteJobTypes.has(job.type)))
  ) || null;
  const latestJob = courseJobs[0] || null;
  const publishState = activeJob
    ? "publishing"
    : mediaFiles.length === 0
      ? "no-media"
      : published === mediaFiles.length
        ? "published"
        : published > 0
          ? "partial"
          : "unpublished";
  return {
    code,
    title: courseEntry.title || "",
    fileCount: mediaFiles.length,
    localFileCount: files.length,
    skippedLocalFileCount: Math.max(0, files.length - mediaFiles.length),
    totalBytes,
    totalMb: totalBytes / 1024 / 1024,
    videoCount,
    publishedCount: published,
    unpublishedCount: Math.max(0, mediaFiles.length - published),
    cdnCoverage: mediaFiles.length ? published / mediaFiles.length : 0,
    assetScope: coursewareOssAssetScope,
    publishState,
    importStatus: manifest?.sourceAudit?.importStatus || (existsSync(join(root, "course-manifest.json")) ? "course-created" : ""),
    mediaStatus: mediaFiles.length ? (published === mediaFiles.length ? "ready" : published > 0 ? "warning" : "pending") : "not-required",
    localContentStatus: files.length ? "available" : "missing",
    hasPlayableMedia: mediaFiles.length > 0,
    activeJob: activeJob ? publicMediaJob(activeJob) : null,
    latestJob: latestJob ? publicMediaJob(latestJob) : null,
  };
}

async function mediaCoursesStatus({ refreshOss = false } = {}) {
  ensureMediaJobsLoaded();
  const catalog = await readCourseCatalog();
  const assetSet = registryAssetSet();
  const courses = await Promise.all(visibleCatalogCourses(catalog).map((courseEntry) => mediaCourseStatus(courseEntry, assetSet)));
  const oss = readOssStorageStatus({ force: refreshOss });
  const locks = mediaLockStatus();
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    config: mediaConfig(),
    registry: {
      file: coursewareAssetRegistryPath,
      assetCount: assetSet.size,
      exists: existsSync(coursewareAssetRegistryPath),
    },
    oss,
    locks,
    courses,
    summary: {
      courses: courses.length,
      files: courses.reduce((sum, course) => sum + course.fileCount, 0),
      localFiles: courses.reduce((sum, course) => sum + course.localFileCount, 0),
      skippedFiles: courses.reduce((sum, course) => sum + course.skippedLocalFileCount, 0),
      totalBytes: courses.reduce((sum, course) => sum + course.totalBytes, 0),
      published: courses.reduce((sum, course) => sum + course.publishedCount, 0),
      unpublished: courses.reduce((sum, course) => sum + course.unpublishedCount, 0),
      runningJobs: [...mediaJobs.values()].filter((job) => activeMediaJobStatuses.has(job.status)).length,
      locks: locks.count,
      staleLocks: locks.staleCount,
    },
  };
}

function runningLifecycleJobForCourse(course) {
  const code = safeSegment(course).toUpperCase();
  return [...lifecycleJobs.values()].find((job) => job.course === code && job.status === "running") || null;
}

function startCourseLifecycleJob({ action, course, actor, deleteActive = false, force = false, setArchived = false }) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!["archive", "activate"].includes(normalizedAction)) {
    throw new Error("Action must be archive or activate.");
  }
  const code = safeSegment(course).toUpperCase();
  if (!code) throw new Error("Course is required.");
  const runningJob = runningLifecycleJobForCourse(code);
  if (runningJob) {
    throw new Error(`Course ${code} already has a running ${runningJob.action} job (${runningJob.id}). Wait for it to finish before starting another lifecycle job.`);
  }

  const id = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const requestedAt = new Date().toISOString();
  const script = normalizedAction === "archive" ? "scripts/archive-course.mjs" : "scripts/activate-course.mjs";
  const args =
    normalizedAction === "archive"
      ? [script, "--course", code, "--source-root", courseActiveRoot, "--archive-root", courseArchiveRoot]
      : [script, "--course", code, "--target-root", courseActiveRoot, "--archive-root", courseArchiveRoot];
  if (deleteActive) args.push("--delete-active");
  if (force) args.push("--force");

  const job = {
    id,
    action: normalizedAction,
    course: code,
    status: "running",
    requestedBy: actor || "unknown",
    requestedAt,
    startedAt: requestedAt,
    finishedAt: null,
    exitCode: null,
    deleteActive,
    force,
    setArchived,
    stdout: "",
    stderr: "",
    payload: null,
    error: null,
  };
  lifecycleJobs.set(id, job);

  setCourseLifecycleStatus(code, normalizedAction === "archive" ? "archiving" : "extracting", actor, `job ${id}`);

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => {
    job.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    job.stderr += chunk;
  });
  child.on("error", (error) => {
    job.status = "error";
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
    setCourseLifecycleStatus(code, "error", actor, job.error);
  });
  child.on("close", (codeNumber) => {
    job.exitCode = codeNumber;
    job.finishedAt = new Date().toISOString();
    job.payload = parseJobPayload(job.stdout) || parseJobPayload(job.stderr);
    if (codeNumber === 0) {
      job.status = "completed";
      const nextStatus = normalizedAction === "activate" ? "active" : setArchived || deleteActive ? "archived" : "active";
      setCourseLifecycleStatus(code, nextStatus, actor, `job ${id} completed`);
      if (normalizedAction === "activate" && mediaJobsAutoPublishAfterActivate) {
        const media = tryCreateMediaJob({ type: "publish-course", course: code, actor });
        job.payload = { ...(job.payload || {}), mediaJob: media.job || null, mediaJobWarning: media.warning || null };
      }
    } else {
      job.status = "error";
      job.error = job.stderr || job.stdout || `${script} exited ${codeNumber}`;
      setCourseLifecycleStatus(code, "error", actor, `job ${id} failed`);
    }
  });

  return publicLifecycleJob(job);
}

function hashPortalPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(String(password), salt, 64).toString("base64url");
  return `scrypt$${salt}$${derived}`;
}

function verifyPortalPassword(user, password) {
  if (user.passwordHash?.startsWith("scrypt$")) {
    const [, salt, expected] = user.passwordHash.split("$");
    if (!salt || !expected) return false;
    const actual = scryptSync(String(password), salt, 64).toString("base64url");
    return timingSafeStringEqual(actual, expected);
  }
  return Boolean(user.password) && timingSafeStringEqual(user.password, password || "");
}

function readPortalUsersFromFile() {
  if (!existsSync(portalUsersPath)) return null;
  const parsed = JSON.parse(readFileSync(portalUsersPath, "utf8"));
  const users = Array.isArray(parsed) ? parsed : parsed.users;
  if (!Array.isArray(users)) throw new Error("Portal users file must contain a users array.");
  return users.map(normalizePortalUser).filter((user) => user.username);
}

function getPortalUsers() {
  return readPortalUsersFromFile() || loadPortalUsers();
}

function savePortalUsers(users) {
  const normalized = users.map(normalizePortalUser).filter((user) => user.username);
  writeJsonFile(portalUsersPath, { schemaVersion: 1, updatedAt: new Date().toISOString(), users: normalized });
  return normalized;
}

function ensurePortalUsersFile() {
  const users = getPortalUsers().map((user) => {
    if (user.password && !user.passwordHash) {
      const { password, ...rest } = user;
      return { ...rest, passwordHash: hashPortalPassword(password), updatedAt: new Date().toISOString() };
    }
    return user;
  });
  return savePortalUsers(users);
}

function portalLoginConfigured() {
  return portalAuthEnabled && Boolean(portalSessionSecret) && getPortalUsers().length > 0;
}

function signPortalSessionPayload(payload) {
  return createHmac("sha256", portalSessionSecret).update(payload).digest("base64url");
}

function createPortalSessionToken(user) {
  const payload = Buffer.from(
    JSON.stringify({
      username: user.username,
      role: user.role,
      courses: user.courses,
      exp: Math.floor(Date.now() / 1000) + portalSessionMaxAgeSeconds,
    }),
  ).toString("base64url");
  return `${payload}.${signPortalSessionPayload(payload)}`;
}

function readPortalSession(req) {
  if (!portalLoginConfigured()) return null;
  const token = parseCookies(req)[portalSessionCookie];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !timingSafeStringEqual(signature, signPortalSessionPayload(payload))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.exp < Math.floor(Date.now() / 1000)) return null;
    const user = getPortalUsers().find((item) => item.username === session.username && item.status !== "disabled");
    if (!user) return null;
    return {
      username: user.username,
      displayName: user.displayName || "",
      role: user.role,
      courses: user.courses,
    };
  } catch {
    return null;
  }
}

function setPortalSessionCookie(res, user) {
  const token = createPortalSessionToken(user);
  const secure = portalCookieSecure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${portalSessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${portalSessionMaxAgeSeconds}${secure}`,
  );
}

function clearPortalSessionCookie(res) {
  const secure = portalCookieSecure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${portalSessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function appendSetCookieHeader(res, cookieValue) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieValue);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieValue]);
  } else {
    res.setHeader("Set-Cookie", [existing, cookieValue]);
  }
}

function clearPortalSessionCookieAppend(res) {
  const secure = portalCookieSecure ? "; Secure" : "";
  appendSetCookieHeader(res, `${portalSessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function publicPortalSession(session) {
  return session
    ? {
        authenticated: true,
        username: session.username,
        displayName: session.displayName || "",
        role: session.role,
        courses: session.courses,
      }
    : {
        authenticated: false,
        username: null,
        displayName: null,
        role: null,
        courses: [],
      };
}

function hasAllCourseAccess(session) {
  return Boolean(session?.courses?.includes("*") || session?.role === "admin" || session?.role === "superadmin");
}

function canAccessCourse(session, course) {
  if (!portalLoginConfigured()) return true;
  if (!session) return false;
  if (hasAllCourseAccess(session)) return true;
  return session.courses.includes(String(course || "").toUpperCase());
}

function canGenerateMoodleEmbeds(session) {
  return Boolean(session && hasAllCourseAccess(session));
}

function courseFromCoursewarePath(pathname) {
  const match = /^\/courseware\/([^/]+)(?:\/|$)/i.exec(pathname);
  return match ? safeSegment(match[1]).toUpperCase() : null;
}

function pathFromCoursewarePath(pathname) {
  const match = /^\/courseware\/[^/]+\/(.+)$/i.exec(pathname);
  return match ? toPosixPath(match[1]) : "";
}

function shouldBypassPortalLogin(pathname) {
  return (
    pathname === "/login" ||
    pathname === "/api/portal/session" ||
    pathname === "/api/portal/login" ||
    pathname === "/api/portal/logout" ||
    pathname === "/teacher-admin" ||
    pathname === "/teacher-admin/" ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/embed/") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/vendor/") ||
    pathname === "/downloads/filter_portalembed.zip" ||
    pathname === "/favicon.ico"
  );
}

function redirectToLogin(res) {
  res.writeHead(302, { Location: "/login" });
  res.end();
}

function xAccelRedirectForCourseware(filePath) {
  if (!xAccelCoursewarePrefix) return null;
  const root = resolve(courseActiveRoot);
  const file = resolve(filePath);
  if (file !== root && !file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) return null;
  const relativePath = relative(root, file).replaceAll("\\", "/");
  if (!relativePath || relativePath.startsWith("../")) return null;
  const prefix = xAccelCoursewarePrefix.startsWith("/") ? xAccelCoursewarePrefix : `/${xAccelCoursewarePrefix}`;
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${normalizedPrefix}${relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signEmbedPayload(payload) {
  if (!embedTokenSecret) throw new Error("EMBED_TOKEN_SECRET is not configured.");
  const body = base64UrlJson(payload);
  const signature = createHmac("sha256", embedTokenSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyEmbedToken(token) {
  if (!embedTokenSecret) return null;
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", embedTokenSecret).update(body).digest("base64url");
  if (!timingSafeStringEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Number(payload.exp) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function resourceIdFor(path) {
  return createHash("sha1").update(toPosixPath(path)).digest("hex").slice(0, 12);
}

function dirnamePosix(path) {
  const value = toPosixPath(path);
  const index = value.lastIndexOf("/");
  return index >= 0 ? value.slice(0, index) : "";
}

function cleanExternalUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

const shareableEmbedKinds = new Set(["ispring", "video", "h5p", "interactive"]);

function pathTextForResource(item) {
  return `${item?.path || ""} ${item?.previewPath || ""} ${item?.downloadPath || ""} ${item?.url || ""} ${item?.previewUrl || ""} ${item?.downloadUrl || ""}`.toLowerCase();
}

function embedKindForShareableItem(item) {
  const type = String(item?.type || "").toLowerCase();
  const category = String(item?.category || "").toLowerCase();
  const role = String(item?.role || "").toLowerCase();
  const path = pathTextForResource(item);
  if (type === "ispring" || category.includes("ispring") || path.includes("ispring-localized/")) return "ispring";
  if (type === "mp4" || type === "webm" || type === "mov" || type === "m4v" || type === "video" || category.includes("video") || /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(path)) return "video";
  if (type === "h5p" || type === "h5pactivity" || category.includes("h5p") || path.includes("/h5p/") || /\.h5p(?:$|[?#])/i.test(path)) return "h5p";
  if (
    type === "interactive_lab" ||
    type === "geogebra_lab" ||
    category === "localized_external_lab" ||
    category === "interactive_lab" ||
    role === "interactive_lab" ||
    path.includes("/external-labs/")
  ) {
    return "interactive";
  }
  return "";
}

function shareTokenForResource({ course, kind, path, previewPath, url, previewUrl, downloadUrl, label, expiresInSeconds }) {
  const rawPath = toPosixPath(path || previewPath || "");
  const viewPath = toPosixPath(previewPath || path || "");
  const rawUrl = cleanExternalUrl(downloadUrl || url || previewUrl);
  const viewUrl = cleanExternalUrl(previewUrl || url || downloadUrl);
  if (!rawPath && !viewPath && !rawUrl && !viewUrl) throw new Error("A local resource path or trusted URL is required.");
  return signEmbedPayload({
    v: 1,
    share: true,
    course: safeSegment(course).toUpperCase(),
    kind: kind || "file",
    label,
    path: viewPath || rawPath,
    downloadPath: rawPath || viewPath,
    url: viewUrl || rawUrl,
    downloadUrl: rawUrl || viewUrl,
    exp: Math.floor(Date.now() / 1000) + Math.max(60, Math.min(Number(expiresInSeconds) || shareTokenMaxAgeSeconds, embedTokenMaxAgeSeconds)),
  });
}

function tokenForSharedPath(payload, requestedPath) {
  const normalizedPath = toPosixPath(requestedPath);
  return signEmbedPayload({
    v: 1,
    shareFile: true,
    course: safeSegment(payload.course).toUpperCase(),
    kind: payload.kind || "file",
    label: payload.label,
    path: normalizedPath,
    prefix: dirnamePosix(normalizedPath),
    exp: payload.exp,
  });
}

function tokenForEmbedPath(payload, requestedPath) {
  const normalizedPath = toPosixPath(requestedPath);
  return signEmbedPayload({
    v: 1,
    course: safeSegment(payload.course).toUpperCase(),
    kind: payload.kind || "file",
    lessonId: payload.lessonId,
    label: payload.label,
    section: payload.section,
    path: normalizedPath,
    prefix: dirnamePosix(normalizedPath),
    exp: payload.exp,
  });
}

function shareKindLabel(kind) {
  const labels = {
    ispring: "iSpring Courseware",
    h5p: "H5P Activity",
    interactive: "Interactive Activity",
    video: "Video",
    "book-section": "Lesson Page",
    file: "Course Resource",
  };
  return labels[kind] || "Course Resource";
}

function renderSharePage(req, token, payload) {
  const course = safeSegment(payload.course).toUpperCase();
  const viewPath = toPosixPath(payload.path || payload.downloadPath || "");
  const downloadPath = toPosixPath(payload.downloadPath || payload.path || "");
  const externalViewUrl = cleanExternalUrl(payload.url);
  const externalDownloadUrl = cleanExternalUrl(payload.downloadUrl || payload.url);
  const viewToken = viewPath ? tokenForSharedPath(payload, viewPath) : "";
  const downloadToken = downloadPath ? tokenForSharedPath(payload, downloadPath) : "";
  const viewHref = externalViewUrl || `/embed/t/${encodeURIComponent(viewToken)}/${encodeURIComponent(course)}/${encodePathSegments(viewPath)}`;
  const downloadHref = externalDownloadUrl || `/embed/t/${encodeURIComponent(downloadToken)}/${encodeURIComponent(course)}/${encodePathSegments(downloadPath)}?download=1`;
  const expiresAt = payload.exp ? new Date(Number(payload.exp) * 1000).toLocaleString("zh-CN", { hour12: false }) : "未设置";
  const title = payload.label || basename(downloadPath || viewPath) || "Shared resource";
  const metaTarget = downloadPath || viewPath || externalDownloadUrl || externalViewUrl;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(title)}</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f3f7fb; color: #001f3f; font-family: Inter, "Segoe UI", Arial, sans-serif; }
      .share-shell { max-width: 1180px; margin: 0 auto; padding: 28px 20px 36px; }
      .share-header { background: #fff; border: 1px solid #d4e0ee; border-radius: 8px; box-shadow: 0 18px 48px rgba(0,31,63,.08); padding: 24px; }
      .kicker { margin: 0 0 8px; color: #57708f; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(24px, 3vw, 38px); line-height: 1.12; }
      .meta { margin-top: 10px; color: #3f5878; line-height: 1.55; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
      .button { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 9px 14px; border: 1px solid #9bb8d8; border-radius: 6px; color: #00366d; background: #f7fbff; font-weight: 800; text-decoration: none; }
      .button.primary { border-color: #116b61; background: #eaf8f4; color: #00564d; }
      .viewer { margin-top: 18px; background: #fff; border: 1px solid #d4e0ee; border-radius: 8px; min-height: 72vh; overflow: hidden; box-shadow: 0 18px 48px rgba(0,31,63,.08); }
      iframe { display: block; width: 100%; min-height: 72vh; border: 0; background: #fff; }
    </style>
  </head>
  <body>
    <main class="share-shell">
      <section class="share-header">
        <p class="kicker">${htmlEscape(course)} · ${htmlEscape(shareKindLabel(payload.kind))}</p>
        <h1>${htmlEscape(title)}</h1>
        <div class="meta">${htmlEscape(metaTarget)}<br>分享有效期至：${htmlEscape(expiresAt)}</div>
        <div class="actions">
          <a class="button primary" href="${htmlEscape(viewHref)}" target="_blank" rel="noopener">新窗口查看</a>
          <a class="button" href="${htmlEscape(downloadHref)}">下载原始文件</a>
        </div>
      </section>
      <section class="viewer">
        <iframe src="${htmlEscape(viewHref)}" title="${htmlEscape(title)}"></iframe>
      </section>
    </main>
  </body>
</html>`;
}

function publicOrigin(req) {
  if (embedPublicOrigin) return embedPublicOrigin.replace(/\/+$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${port}`;
  const proto = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`.replace(/\/+$/, "");
}

function embedTokenForResource({ course, kind, path, downloadPath, url, downloadUrl, label, section, lessonId }) {
  const normalizedPath = toPosixPath(path || "");
  const normalizedDownloadPath = toPosixPath(downloadPath || "");
  const normalizedUrl = cleanExternalUrl(url || "");
  const normalizedDownloadUrl = cleanExternalUrl(downloadUrl || normalizedUrl);
  return signEmbedPayload({
    v: 1,
    course: safeSegment(course).toUpperCase(),
    kind,
    lessonId,
    label,
    section,
    path: normalizedPath,
    downloadPath: normalizedDownloadPath,
    url: normalizedUrl,
    downloadUrl: normalizedDownloadUrl,
    prefix: normalizedPath ? dirnamePosix(normalizedPath) : "",
    exp: Math.floor(Date.now() / 1000) + embedTokenMaxAgeSeconds,
  });
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
}

function injectEmbedBase(html, baseHref) {
  const base = `<base href="${htmlEscape(baseHref)}">`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b([^>]*)>/i, `<head$1>${base}`);
  return `${base}\n${html}`;
}

function replaceJsStringOption(html, key, value) {
  const pattern = new RegExp(`(\\b${key}\\s*:\\s*)(["'])(?:\\\\.|(?!\\2)[\\s\\S])*?\\2`, "m");
  return String(html).replace(pattern, `$1${JSON.stringify(value)}`);
}

function isH5pStandalonePreviewPath(path) {
  return /(?:^|\/)h5p-external\/[^/]+\/index\.html$/i.test(toPosixPath(path));
}

function h5pPackagePathFromPreviewPath(path) {
  const normalizedPath = toPosixPath(path);
  return isH5pStandalonePreviewPath(normalizedPath)
    ? normalizedPath.replace(/\/index\.html$/i, ".h5p")
    : "";
}

function h5pPreviewPathFromPackagePath(path) {
  const normalizedPath = toPosixPath(path);
  return /(?:^|\/)h5p-external\/[^/]+\.h5p$/i.test(normalizedPath)
    ? normalizedPath.replace(/\.h5p$/i, "/index.html")
    : "";
}

function addEmbeddedClassToBody(html) {
  if (!/<body\b/i.test(html)) return html;
  return String(html).replace(/<body\b([^>]*)>/i, (match, attributes) => {
    const classMatch = /\bclass=(["'])([^"']*)\1/i.exec(attributes);
    if (!classMatch) return `<body${attributes} class="is-embedded">`;
    if (classMatch[2].split(/\s+/).includes("is-embedded")) return match;
    const nextClass = `${classMatch[2]} is-embedded`.trim();
    return `<body${attributes.replace(classMatch[0], `class=${classMatch[1]}${nextClass}${classMatch[1]}`)}>`;
  });
}

function injectH5pEmbedCompatibility(html, { resourceBaseHref, vendorBaseHref, downloadHref }) {
  const vendorBase = String(vendorBaseHref || "").replace(/\/+$/, "");
  const resourceBase = String(resourceBaseHref || "").replace(/\/+$/, "");
  const mainJs = `${vendorBase}/vendor/h5p-standalone/main.bundle.js`;
  const frameJs = `${vendorBase}/vendor/h5p-standalone/frame.bundle.js`;
  const frameCss = `${vendorBase}/vendor/h5p-standalone/styles/h5p.css`;
  let nextHtml = String(html || "");

  nextHtml = nextHtml
    .replace(/href=(["'])\/vendor\/h5p-standalone\/styles\/h5p\.css\1/gi, `href="${htmlEscape(frameCss)}"`)
    .replace(/src=(["'])\/vendor\/h5p-standalone\/main\.bundle\.js\1/gi, `src="${htmlEscape(mainJs)}"`);
  nextHtml = replaceJsStringOption(nextHtml, "h5pJsonPath", resourceBase);
  nextHtml = replaceJsStringOption(nextHtml, "librariesPath", resourceBase);
  nextHtml = replaceJsStringOption(nextHtml, "contentJsonPath", `${resourceBase}/content`);
  nextHtml = replaceJsStringOption(nextHtml, "frameJs", frameJs);
  nextHtml = replaceJsStringOption(nextHtml, "frameCss", frameCss);
  if (downloadHref) {
    nextHtml = replaceJsStringOption(nextHtml, "downloadUrl", downloadHref);
    nextHtml = nextHtml.replace(/(<a\b[^>]*\bhref=)(["'])\.\.\/[^"']+\.h5p\2/gi, `$1"${htmlEscape(downloadHref)}"`);
  }
  return addEmbeddedClassToBody(nextHtml);
}

const coursewareViewerStyle = `
<style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    background: #f3f7fb;
    color: #001f3f;
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.65;
  }
  body > * {
    max-width: 1080px;
    margin-left: auto;
    margin-right: auto;
  }
  body > :first-child {
    margin-top: 28px;
  }
  h1, h2, h3, h4 {
    color: #001f3f;
    line-height: 1.2;
  }
  a { color: #064f9e; font-weight: 700; }
  img, video, iframe {
    max-width: 100%;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th, td {
    border: 1px solid #d4e1f0;
    padding: 8px 10px;
  }
</style>`;

function injectCoursewareViewerStyle(html) {
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${coursewareViewerStyle}</head>`)
    : `${coursewareViewerStyle}\n${html}`;
}

const localCoursewareRoots = [
  courseActiveRoot,
  join(workspaceRoot, "courseware"),
  join(projectRoot, "courseware"),
].map((root) => resolve(root));

function relativeInsideRoot(root, filePath) {
  const relativePath = toPosixPath(relative(root, filePath));
  if (!relativePath || relativePath.startsWith("../") || relativePath === "..") return "";
  return relativePath;
}

function coursewareRelativePath(filePath) {
  const resolvedFilePath = resolve(filePath);
  for (const root of localCoursewareRoots) {
    const relativePath = relativeInsideRoot(root, resolvedFilePath);
    if (relativePath) return relativePath;
  }
  return "";
}

function shouldUseCoursewareViewerStyle(filePath) {
  if (extname(filePath).toLowerCase() !== ".html") return false;
  const relativePath = coursewareRelativePath(filePath).toLowerCase();
  if (!relativePath) return false;
  if (basename(filePath).toLowerCase() === "presentation.html") return false;
  if (relativePath.includes("/html5-package") || relativePath.includes("/html5-package-admin")) return false;
  return relativePath.includes("/book_sections/") || relativePath.includes("/downloaded_resources/imported/");
}

function shouldUseCoursewareTextViewer(filePath) {
  if (![".md", ".txt"].includes(extname(filePath).toLowerCase())) return false;
  return Boolean(coursewareRelativePath(filePath));
}

function shouldUseCoursewareIspringCdnBase(course, requestedPath, filePath) {
  if (basename(filePath).toLowerCase() !== "presentation.html") return false;
  if (!isCoursewareCdnFallbackPath(requestedPath)) return false;
  return Boolean(coursewareAssetDirectoryHref(course, requestedPath));
}

function titleFromText(filePath, text) {
  const titleMatch = /^Title:\s*(.+)$/im.exec(text);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  const firstMeaningfulLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^the project gutenberg ebook of\b/i.test(line));
  return firstMeaningfulLine || basename(filePath);
}

function authorFromText(text) {
  const authorMatch = /^Author:\s*(.+)$/im.exec(text);
  if (authorMatch?.[1]) return authorMatch[1].trim();
  const byMatch = /^by\s+(.+)$/im.exec(text);
  return byMatch?.[1]?.trim() || "";
}

function textHeadingLevel(line) {
  const trimmed = line.trim();
  if (/^(ACT|CHAPTER|BOOK|PART)\s+\b/i.test(trimmed)) return 2;
  if (/^SCENE\s+\b/i.test(trimmed)) return 3;
  if (/^[A-Z][A-Z0-9 ,.'’:-]{4,}$/.test(trimmed) && trimmed.length <= 80) return 2;
  return 0;
}

function buildTextToc(lines) {
  const items = [];
  for (const line of lines) {
    const text = line.trim();
    const level = textHeadingLevel(text);
    if (!level) continue;
    if (/PROJECT GUTENBERG|LICENSE|TRANSCRIBER|PRODUCED BY/i.test(text)) continue;
    if (items.some((item) => item.text === text)) continue;
    items.push({ id: `section-${items.length + 1}`, text, level });
    if (items.length >= 36) break;
  }
  return items;
}

function renderTextLines(lines, toc) {
  const headingIds = new Map(toc.map((item) => [item.text, item.id]));
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "<div class=\"text-blank\" aria-hidden=\"true\"></div>";
      const level = textHeadingLevel(trimmed);
      const id = headingIds.get(trimmed);
      if (level && id) {
        const tag = level === 3 ? "h3" : "h2";
        return `<${tag} id="${htmlEscape(id)}" class="text-heading text-heading-${level}">${htmlEscape(trimmed)}</${tag}>`;
      }
      return `<p>${htmlEscape(line)}</p>`;
    })
    .join("\n");
}

function renderCoursewareTextViewer(filePath, text, rawHref = "") {
  const title = titleFromText(filePath, text);
  const author = authorFromText(text);
  const relativePath = coursewareRelativePath(filePath) || basename(filePath);
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const toc = buildTextToc(lines);
  const downloadHref = rawHref ? `${rawHref}${rawHref.includes("?") ? "&" : "?"}download=1` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  ${coursewareViewerStyle}
  <style>
    .ossd-text-document {
      max-width: 1180px;
      margin: 24px auto 72px;
      padding: 0;
      border: 1px solid #d4e1f0;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 14px 36px rgba(14, 44, 74, 0.08);
      overflow: hidden;
    }
    .text-hero {
      padding: 30px 36px 26px;
      border-bottom: 1px solid #dbe7f3;
      background: linear-gradient(180deg, #f8fbff 0%, #fff 100%);
    }
    .text-kicker {
      margin: 0 0 8px;
      color: #58708e;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .ossd-text-document h1 {
      margin: 0;
      font-size: 32px;
      line-height: 1.16;
      letter-spacing: 0;
    }
    .text-meta {
      margin-top: 10px;
      color: #3d5575;
      font-size: 15px;
    }
    .text-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    .text-action {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 14px;
      border: 1px solid #9fb8d4;
      border-radius: 7px;
      background: #f8fbff;
      color: #003366;
      font-weight: 800;
      text-decoration: none;
    }
    .text-layout {
      display: grid;
      grid-template-columns: minmax(0, 230px) minmax(0, 1fr);
      gap: 0;
    }
    .text-toc {
      padding: 24px 18px;
      border-right: 1px solid #e0e9f4;
      background: #f7fafe;
    }
    .text-toc-title {
      margin: 0 0 12px;
      color: #58708e;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .text-toc a {
      display: block;
      padding: 7px 8px;
      border-radius: 6px;
      color: #003366;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
    }
    .text-toc a.level-3 {
      padding-left: 18px;
      color: #48617f;
      font-weight: 600;
    }
    .text-toc a:hover {
      background: #e8f1fb;
    }
    .text-body {
      max-width: 820px;
      padding: 34px 44px 56px;
      color: #0a2440;
      font-family: Georgia, "Times New Roman", serif;
      font-size: 18px;
      line-height: 1.72;
    }
    .text-body p {
      margin: 0 0 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .text-heading {
      margin: 34px 0 16px;
      color: #001f3f;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      letter-spacing: 0;
    }
    .text-heading-2 {
      font-size: 25px;
    }
    .text-heading-3 {
      font-size: 20px;
    }
    .text-blank {
      height: 18px;
    }
    @media (max-width: 900px) {
      .text-layout {
        grid-template-columns: 1fr;
      }
      .text-toc {
        border-right: 0;
        border-bottom: 1px solid #e0e9f4;
      }
      .text-body {
        padding: 26px 22px 44px;
        font-size: 17px;
      }
      .text-hero {
        padding: 24px 22px;
      }
      .ossd-text-document h1 {
        font-size: 26px;
      }
    }
  </style>
</head>
<body>
  <article class="ossd-text-document">
    <header class="text-hero">
      <p class="text-kicker">Course Text</p>
      <h1>${htmlEscape(title)}</h1>
      <div class="text-meta">${author ? `${htmlEscape(author)} · ` : ""}${htmlEscape(relativePath)}</div>
      ${downloadHref ? `<div class="text-actions"><a class="text-action" href="${htmlEscape(downloadHref)}" download>下载原始 TXT</a></div>` : ""}
    </header>
    <div class="text-layout">
      ${toc.length ? `<nav class="text-toc" aria-label="Text sections"><p class="text-toc-title">Contents</p>${toc.map((item) => `<a class="level-${item.level}" href="#${htmlEscape(item.id)}">${htmlEscape(item.text)}</a>`).join("")}</nav>` : ""}
      <main class="text-body">
        ${renderTextLines(lines, toc)}
      </main>
    </div>
  </article>
</body>
</html>`;
}

function isEmbedPathAllowed(payload, course, requestedPath) {
  if (!payload || safeSegment(payload.course).toUpperCase() !== safeSegment(course).toUpperCase()) return false;
  const normalizedPath = toPosixPath(requestedPath);
  const payloadPath = toPosixPath(payload.path);
  const payloadPrefix = toPosixPath(payload.prefix || dirnamePosix(payloadPath));
  if (payloadPath && normalizedPath === payloadPath) return true;
  if (!payloadPrefix) return false;
  return normalizedPath.startsWith(`${payloadPrefix}/`);
}

async function sendEmbedCoursewareFile(req, res, course, requestedPath, payload) {
  if (!isCourseActive(course)) {
    res.writeHead(423, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Locked: course is archived");
    return true;
  }
  if (!isEmbedPathAllowed(payload, course, requestedPath)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: invalid embed token");
    return true;
  }
  const root = courseRoot(course);
  const filePath = ensureInside(root, join(root, toPosixPath(requestedPath)));
  if (payload.kind === "ispring" && basename(filePath).toLowerCase() === "presentation.html") {
    try {
      const html = await readFile(filePath, "utf8");
      sendHtml(res, 200, injectIspringEmbedCompatibility(html, directoryHrefForRequest(req)));
    } catch (error) {
      if (await sendCoursewareCdnFallback(req, res, course, requestedPath)) return true;
      throw error;
    }
    return true;
  }
  try {
    await sendFile(req, res, filePath);
  } catch (error) {
    if (await sendCoursewareCdnFallback(req, res, course, requestedPath)) return true;
    throw error;
  }
  return true;
}

async function sendEmbedH5pPreview(req, res, course, requestedPath, payload) {
  const normalizedPath = toPosixPath(requestedPath);
  if (!isEmbedPathAllowed(payload, course, normalizedPath)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: invalid embed token");
    return true;
  }
  const previewPath = isH5pStandalonePreviewPath(normalizedPath)
    ? normalizedPath
    : h5pPreviewPathFromPackagePath(normalizedPath);
  if (!previewPath) return sendEmbedCoursewareFile(req, res, course, normalizedPath, payload);
  const resourceToken = tokenForEmbedPath(payload, previewPath);
  const resourceHref = `/embed/t/${encodeURIComponent(resourceToken)}/${encodeURIComponent(course)}/${encodePathSegments(previewPath)}`;
  const resourceBaseHref = resourceHref.slice(0, resourceHref.lastIndexOf("/") + 1);
  const fallbackDownloadPath = h5pPackagePathFromPreviewPath(previewPath) || (/\.h5p$/i.test(normalizedPath) ? normalizedPath : "");
  const downloadPath = toPosixPath(payload.downloadPath || fallbackDownloadPath);
  const downloadToken = downloadPath ? tokenForEmbedPath(payload, downloadPath) : "";
  const downloadHref = downloadPath
    ? `/embed/t/${encodeURIComponent(downloadToken)}/${encodeURIComponent(course)}/${encodePathSegments(downloadPath)}?download=1`
    : cleanExternalUrl(payload.downloadUrl || payload.url);
  const root = courseRoot(course);
  const filePath = ensureInside(root, join(root, previewPath));
  let html = "";
  try {
    html = await readFile(filePath, "utf8");
  } catch (error) {
    const fallbackUrl = coursewareAssetUrl(course, previewPath) || cleanExternalUrl(payload.url);
    if (!isTrustedCoursewareAssetUrl(fallbackUrl)) throw error;
    html = await fetchTrustedCoursewareHtml(fallbackUrl);
  }
  sendHtml(res, 200, injectH5pEmbedCompatibility(html, {
    resourceBaseHref,
    vendorBaseHref: publicOrigin(req),
    downloadHref,
  }));
  return true;
}

function localResourceCandidatesForLesson(lesson) {
  const candidates = [];
  for (const item of lesson.ispring || []) {
    candidates.push(...localResourceCandidatesFromResource(item, item.role || "lesson_ispring"));
  }
  for (const item of [
    lesson.lessonPlan,
    ...(lesson.lessonText || []),
    ...(lesson.textExports || []),
    ...(lesson.downloads || []),
    ...(lesson.handsOn || []),
    ...(lesson.bookSections || []),
  ]) {
    candidates.push(...localResourceCandidatesFromResource(item, item?.role || "download"));
  }
  return candidates;
}

function localResourceCandidatesFromResource(resource, fallbackRole = "resource", parentResource = null) {
  if (!resource) return [];
  const candidates = [];
  if (resource.path || resource.url || resource.previewPath || resource.previewUrl || resource.downloadPath || resource.downloadUrl) {
    const kind = embedKindForShareableItem(resource);
    if (shareableEmbedKinds.has(kind)) {
      candidates.push({
        kind,
        role: resource.role || fallbackRole,
        item: parentResource && !resource.sectionLabel
          ? { ...resource, sectionLabel: parentResource.label || parentResource.sectionLabel || fallbackRole }
          : resource,
      });
    }
  }
  for (const attachment of resource.attachments || []) {
    candidates.push(...localResourceCandidatesFromResource(attachment, attachment.role || `${resource.role || fallbackRole}_attachment`, resource));
  }
  for (const ispring of resource.ispring || []) {
    candidates.push(...localResourceCandidatesFromResource(ispring, ispring.role || `${resource.role || fallbackRole}_ispring`, resource));
  }
  return candidates;
}

function localResourceCandidatesFromResources(resources, fallbackRole = "resource") {
  const candidates = [];
  for (const resource of resources || []) {
    if (Array.isArray(resource)) {
      candidates.push(...localResourceCandidatesFromResources(resource, fallbackRole));
    } else {
      candidates.push(...localResourceCandidatesFromResource(resource, resource?.role || fallbackRole));
    }
  }
  return candidates;
}

function moodleIspringIframeHtml(src) {
  return `<iframe style="display: block; width: 100%; max-width: 100%; border: none; background-color: transparent;"
    src="${htmlEscape(src)}"
    width="100%" height="720" frameborder="0" scrolling="auto"
    allow="autoplay; fullscreen; clipboard-write; encrypted-media; picture-in-picture"
    allowfullscreen="allowfullscreen"></iframe>`;
}

function moodleShortcodeAttribute(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("[", "&#91;").replaceAll("]", "&#93;");
}

function moodlePortalIframeShortcode(src, { width = "100%", height = 720 } = {}) {
  return `[portal_iframe src="${moodleShortcodeAttribute(src)}" width="${moodleShortcodeAttribute(width)}" height="${moodleShortcodeAttribute(height)}"]`;
}

function moodleH5pIframeHtml(src, { height = 560 } = {}) {
  return `<iframe src="${htmlEscape(src)}"
    class="h5p-iframe" name="h5pcontent"
    style="height: ${height}px; width: 100%; border: 0px;"
    allowfullscreen="allowfullscreen"></iframe>`;
}

function moodleVideoHtml(src, label = "Video", mimeType = "video/mp4") {
  return `<div style="width: 100%; max-width: 960px; height: 540px; max-height: 70vh; background: #000; margin: 12px 0 18px;">
    <video controls preload="metadata" style="display: block; width: 100%; height: 100%; object-fit: contain; background: #000;">
      <source src="${htmlEscape(src)}" type="${htmlEscape(mimeType)}">
      <a href="${htmlEscape(src)}" target="_blank" rel="noopener">${htmlEscape(label)}</a>
    </video>
  </div>`;
}

function moodleContentIframeHtml(src, { height = 750 } = {}) {
  return `<iframe style="border: none; background-color: transparent;"
    src="${htmlEscape(src)}"
    width="100%" height="${height}" frameborder="0" scrolling="auto"
    allowfullscreen="allowfullscreen"></iframe>`;
}

function moodleEmbedRowsForCourse(req, course, manifest) {
  const origin = publicOrigin(req);
  const rows = [];
  const appendRows = ({ unit = 0, lesson = 0, lessonId = "COURSE", lessonTitle = "Course Resources" }, candidates) => {
    for (const candidate of candidates) {
      const item = candidate.item;
      const viewPath = candidate.kind === "h5p"
        ? (item.previewPath || item.path || item.downloadPath)
        : (item.path || item.previewPath || item.downloadPath);
      const downloadPath = candidate.kind === "h5p"
        ? (item.path || item.downloadPath || item.previewPath)
        : (item.downloadPath || item.path || item.previewPath);
      const token = embedTokenForResource({
        course,
        kind: candidate.kind,
        path: viewPath,
        downloadPath,
        url: item.previewUrl || item.url,
        downloadUrl: item.downloadUrl || item.url,
        label: item.label,
        section: item.sectionLabel || candidate.role,
        lessonId,
      });
      const resourceKey = item.path || item.previewPath || item.downloadPath || item.previewUrl || item.url || item.downloadUrl || item.label || candidate.role;
      const resourceId = resourceIdFor(resourceKey);
      let embedUrl = `${origin}/embed/${candidate.kind}/${encodeURIComponent(course)}/${lessonId}/${resourceId}?token=${encodeURIComponent(token)}`;
      const fileUrl = `${origin}/embed/file/${encodeURIComponent(course)}/${lessonId}/${resourceId}?token=${encodeURIComponent(token)}`;
      let moodleHtml = "";
      let moodleIframeHtml = "";
      let moodleShortcode = "";
      let status = "ready";
      if (candidate.kind === "ispring") {
        moodleIframeHtml = moodleIspringIframeHtml(embedUrl);
        moodleShortcode = moodlePortalIframeShortcode(embedUrl, { width: "100%", height: 720 });
        moodleHtml = moodleShortcode;
      } else if (candidate.kind === "video") {
        const ext = extname(item.path || item.url || "").toLowerCase();
        moodleIframeHtml = moodleContentIframeHtml(embedUrl, { height: 540 });
        moodleShortcode = moodlePortalIframeShortcode(embedUrl, { width: "100%", height: 540 });
        moodleHtml = moodleVideoHtml(fileUrl, item.label || "Video", mimeTypes[ext] || "video/mp4");
      } else if (candidate.kind === "h5p") {
        embedUrl = `${embedUrl}&embed=1`;
        moodleIframeHtml = moodleH5pIframeHtml(embedUrl);
        moodleShortcode = moodlePortalIframeShortcode(embedUrl, { width: "100%", height: 560 });
        moodleHtml = moodleShortcode;
      } else if (candidate.kind === "interactive") {
        moodleIframeHtml = moodleContentIframeHtml(embedUrl, { height: 700 });
        moodleShortcode = moodlePortalIframeShortcode(embedUrl, { width: "100%", height: 700 });
        moodleHtml = moodleShortcode;
      } else {
        continue;
      }
      rows.push({
        course,
        unit,
        lesson,
        lessonId,
        lessonTitle,
        kind: candidate.kind,
        role: candidate.role,
        label: item.label || "",
        path: viewPath || item.previewUrl || item.url || item.downloadUrl,
        source: item.source || null,
        status,
        embedUrl,
        fileUrl,
        moodleShortcode,
        moodleIframeHtml,
        moodleHtml,
      });
    }
  };

  appendRows(
    { lessonId: "COURSE", lessonTitle: "Course Resources" },
    localResourceCandidatesFromResources([
      ...(manifest.courseSections || []),
      ...(manifest.courseDownloads || []),
      ...(manifest.teacherResources || []),
      ...((manifest.texts || []).flatMap((text) => [text, ...(text.materials || [])])),
    ], "course_resource"),
  );
  for (const unit of manifest.units || []) {
    const unitId = `U${String(unit.unit).padStart(2, "0")}`;
    appendRows(
      { unit: unit.unit, lesson: 0, lessonId: unitId, lessonTitle: unit.title || `Unit ${unit.unit}` },
      localResourceCandidatesFromResources([
        unit.unitPlan,
        ...Object.values(unit.unitResources || {}),
      ], "unit_resource"),
    );
    for (const lesson of unit.lessons || []) {
      const lessonId = `U${String(unit.unit).padStart(2, "0")}L${String(lesson.lesson).padStart(2, "0")}`;
      appendRows(
        { unit: unit.unit, lesson: lesson.lesson, lessonId, lessonTitle: lesson.title },
        localResourceCandidatesForLesson(lesson),
      );
    }
  }
  return rows;
}

async function handleEmbedRequest(req, res, requestUrl) {
  if (!requestUrl.pathname.startsWith("/embed/")) return false;
  const tokenPathMatch = /^\/embed\/t\/([^/]+)\/([^/]+)\/(.+)$/i.exec(requestUrl.pathname);
  const token = tokenPathMatch ? decodeURIComponent(tokenPathMatch[1]) : requestUrl.searchParams.get("token");
  const payload = verifyEmbedToken(token);
  if (!payload) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: invalid or expired embed token");
    return true;
  }

  if (tokenPathMatch) {
    const course = safeSegment(tokenPathMatch[2]).toUpperCase();
    const requestedPath = decodePath(tokenPathMatch[3]);
    if (payload.kind === "h5p" && isH5pStandalonePreviewPath(requestedPath)) {
      return sendEmbedH5pPreview(req, res, course, requestedPath, payload);
    }
    return sendEmbedCoursewareFile(req, res, course, requestedPath, payload);
  }

  const coursewareMatch = /^\/embed\/courseware\/([^/]+)\/(.+)$/i.exec(requestUrl.pathname);
  if (coursewareMatch) {
    const course = safeSegment(coursewareMatch[1]).toUpperCase();
    const requestedPath = decodePath(coursewareMatch[2]);
    if (payload.kind === "h5p" && isH5pStandalonePreviewPath(requestedPath)) {
      return sendEmbedH5pPreview(req, res, course, requestedPath, payload);
    }
    return sendEmbedCoursewareFile(req, res, course, requestedPath, payload);
  }

  const match = /^\/embed\/(ispring|video|file|book-section|h5p|interactive)\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/i.exec(requestUrl.pathname);
  if (!match) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Unknown embed endpoint");
    return true;
  }
  const kind = match[1].toLowerCase();
  const course = safeSegment(match[2]).toUpperCase();
  const lessonId = match[3];
  if (payload.kind !== kind && !(kind === "file" && (payload.kind === "file" || shareableEmbedKinds.has(payload.kind)))) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: embed token kind mismatch");
    return true;
  }
  if (payload.lessonId && String(payload.lessonId).toUpperCase() !== String(lessonId).toUpperCase()) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: embed token lesson mismatch");
    return true;
  }

  const payloadUrl = cleanExternalUrl(payload.url);
  const payloadDownloadUrl = cleanExternalUrl(payload.downloadUrl || payload.url);
  const tokenizedRawUrl = payload.path
    ? `/embed/t/${encodeURIComponent(token)}/${encodeURIComponent(course)}/${encodePathSegments(payload.path)}`
    : "";
  const assetRawUrl = payloadUrl || coursewareAssetUrl(course, payload.path) || tokenizedRawUrl;
  if (kind === "ispring") {
    if (payloadUrl) {
      if (isTrustedCoursewareAssetUrl(payloadUrl)) {
        try {
          const html = await fetchTrustedCoursewareHtml(payloadUrl);
          if (tokenizedRawUrl && isRollPreviewIspringHtml(html)) {
            sendHtml(res, 200, renderIspringSameOriginEmbedWrapper({
              title: payload.label || "iSpring Courseware",
              src: tokenizedRawUrl,
            }));
            return true;
          }
          const rawBaseHref = tokenizedRawUrl
            ? tokenizedRawUrl.slice(0, tokenizedRawUrl.lastIndexOf("/") + 1)
            : directoryHrefForUrl(payloadUrl);
          sendHtml(res, 200, injectIspringEmbedCompatibility(html, rawBaseHref));
        } catch (error) {
          console.warn(`Trusted CDN iSpring proxy failed; redirecting to source: ${error.message}`);
          res.writeHead(302, { Location: payloadUrl });
          res.end();
        }
      } else {
        res.writeHead(302, { Location: payloadUrl });
        res.end();
      }
      return true;
    }
    const root = courseRoot(course);
    const filePath = ensureInside(root, join(root, toPosixPath(payload.path)));
    const html = await readFile(filePath, "utf8");
    if (tokenizedRawUrl && isRollPreviewIspringHtml(html)) {
      sendHtml(res, 200, renderIspringSameOriginEmbedWrapper({
        title: payload.label || "iSpring Courseware",
        src: tokenizedRawUrl,
      }));
      return true;
    }
    const rawBaseHref = tokenizedRawUrl.slice(0, tokenizedRawUrl.lastIndexOf("/") + 1)
      || coursewareAssetDirectoryHref(course, payload.path);
    sendHtml(res, 200, injectIspringEmbedCompatibility(html, rawBaseHref));
    return true;
  }
  if (kind === "video") {
    const videoType = mimeTypes[extname(payload.path || payloadUrl || "").toLowerCase()] || "video/mp4";
    const videoSrc = htmlEscape(assetRawUrl);
    const videoLabel = htmlEscape(payload.label || "Video");
    sendHtml(
      res,
      200,
      `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${videoLabel}</title>
    <style>
      html,body{margin:0;background:#000;color:#fff;font-family:Arial,sans-serif;}
      .video-shell{position:relative;width:100vw;height:100vh;background:#000;}
      video{display:block;width:100%;height:100%;background:#000;}
    </style>
  </head>
  <body>
    <div class="video-shell">
      <video controls preload="metadata" playsinline aria-label="${videoLabel}">
        <source src="${videoSrc}" type="${htmlEscape(videoType)}">
        <a href="${videoSrc}" target="_blank" rel="noopener">Open video file</a>
      </video>
    </div>
  </body>
</html>`,
    );
    return true;
  }
  if (kind === "book-section") {
    if (payloadUrl) {
      res.writeHead(302, { Location: payloadUrl });
      res.end();
      return true;
    }
    const root = courseRoot(course);
    const filePath = ensureInside(root, join(root, toPosixPath(payload.path)));
    const html = await readFile(filePath, "utf8");
    sendHtml(res, 200, html);
    return true;
  }
  if (kind === "h5p" && payload.path) {
    return sendEmbedH5pPreview(req, res, course, payload.path, payload);
  }
  if (!payload.path && payloadDownloadUrl) {
    res.writeHead(302, { Location: payloadDownloadUrl });
    res.end();
    return true;
  }
  return sendEmbedCoursewareFile(req, res, course, payload.path, payload);
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index > 0) {
        cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
      }
      return cookies;
    }, {});
}

function signSessionPayload(payload) {
  return createHmac("sha256", adminSessionSecret).update(payload).digest("base64url");
}

function createSessionToken(username) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      exp: Math.floor(Date.now() / 1000) + adminSessionMaxAgeSeconds,
    }),
  ).toString("base64url");
  return `${payload}.${signSessionPayload(payload)}`;
}

function readSession(req) {
  if (!adminSessionSecret) return null;
  const token = parseCookies(req)[adminSessionCookie];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !timingSafeStringEqual(signature, signSessionPayload(payload))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.exp < Math.floor(Date.now() / 1000)) return null;
    if (session.username !== adminUsername) return null;
    return session;
  } catch {
    return null;
  }
}

function setSessionCookie(res, username) {
  const token = createSessionToken(username);
  const secure = adminCookieSecure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    [
      `${adminSessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${adminSessionMaxAgeSeconds}${secure}`,
      `${adminSessionCookie}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    ],
  );
}

function clearSessionCookie(res) {
  const secure = adminCookieSecure ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `${adminSessionCookie}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    `${adminSessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  ]);
}

function loginConfigured() {
  return Boolean(adminUsername && adminPassword && adminSessionSecret);
}

function adminLoginConfigured() {
  return loginConfigured() || portalLoginConfigured();
}

function loginRateLimitEnabled() {
  return loginRateLimitMaxFailures > 0 && loginRateLimitWindowMs > 0 && loginRateLimitLockMs > 0;
}

function clientAddress(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0];
  return forwarded || String(req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown");
}

function loginRateKeys(req, scope, username) {
  const address = clientAddress(req);
  const subject = String(username || "unknown").trim().toLowerCase() || "unknown";
  return [`${scope}:ip:${address}`, `${scope}:user:${address}:${subject}`];
}

function pruneLoginFailures(now = Date.now()) {
  if (!loginRateLimitEnabled()) return;
  for (const [key, bucket] of loginFailures.entries()) {
    const windowExpired = bucket.firstAttemptAt + loginRateLimitWindowMs < now;
    const lockExpired = !bucket.lockedUntil || bucket.lockedUntil <= now;
    if (windowExpired && lockExpired) loginFailures.delete(key);
  }
}

function loginRateLimitStatus(keys) {
  if (!loginRateLimitEnabled()) return null;
  const now = Date.now();
  pruneLoginFailures(now);
  const locked = keys
    .map((key) => loginFailures.get(key))
    .filter((bucket) => bucket?.lockedUntil && bucket.lockedUntil > now)
    .sort((a, b) => b.lockedUntil - a.lockedUntil)[0];
  if (!locked) return null;
  return {
    retryAfterSeconds: Math.max(1, Math.ceil((locked.lockedUntil - now) / 1000)),
  };
}

function recordLoginFailure(keys) {
  if (!loginRateLimitEnabled()) return;
  const now = Date.now();
  pruneLoginFailures(now);
  for (const key of keys) {
    const existing = loginFailures.get(key);
    const bucket =
      existing && existing.firstAttemptAt + loginRateLimitWindowMs >= now
        ? existing
        : { failures: 0, firstAttemptAt: now, lockedUntil: 0 };
    bucket.failures += 1;
    if (bucket.failures >= loginRateLimitMaxFailures) {
      bucket.lockedUntil = now + loginRateLimitLockMs;
    }
    loginFailures.set(key, bucket);
  }
}

function clearLoginFailures(keys) {
  for (const key of keys) loginFailures.delete(key);
}

async function readJsonBody(req, maxBytes = 16 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function safeSegment(value) {
  return String(value || "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function courseRoot(course) {
  return resolve(courseActiveRoot, safeSegment(course).toUpperCase());
}

function uploadHistoryPath(course) {
  return join(courseRoot(course), "_admin_uploads", "upload-history.jsonl");
}

function ensureInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}\\`) &&
    !resolvedCandidate.startsWith(`${resolvedRoot}/`)
  ) {
    throw new Error("Target path escaped the allowed course directory.");
  }
  return resolvedCandidate;
}

function adminPrincipal(req) {
  const legacySession = readSession(req);
  if (legacySession) {
    return {
      username: legacySession.username,
      displayName: legacySession.username,
      role: "admin",
      courses: ["*"],
      source: "admin",
    };
  }
  const portalSession = readPortalSession(req);
  if (hasAllCourseAccess(portalSession)) {
    return {
      ...portalSession,
      source: "portal",
    };
  }
  return null;
}

function isAuthorized(req) {
  if (adminPrincipal(req)) return true;
  const header = req.headers.authorization || "";
  return Boolean(adminToken) && header === `Bearer ${adminToken}`;
}

function isOssExtractCallbackAuthorized(req) {
  if (!ossExtractCallbackSecret) return false;
  const header = req.headers.authorization || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const token = bearer || String(req.headers["x-oss-extract-secret"] || "");
  return Boolean(token) && timingSafeStringEqual(token, ossExtractCallbackSecret);
}

function adminActor(req) {
  const principal = adminPrincipal(req);
  if (principal?.username) return principal.username;
  const header = req.headers.authorization || "";
  if (adminToken && header === `Bearer ${adminToken}`) return "token";
  return "anonymous";
}

async function readManifest(course) {
  const root = courseRoot(course);
  return JSON.parse(await readFile(join(root, "course-manifest.json"), "utf8"));
}

function emptyCourseManifest(course) {
  const code = safeSegment(course).toUpperCase();
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    course: {
      code,
      title: code,
      audience: "",
      source: "oss-hybrid-course-shell",
      description: "",
    },
    navigation: {
      primary: "Units",
      secondary: "Activities",
    },
    courseDownloads: [],
    units: [],
    texts: [],
    sourceAudit: {
      generatedFrom: "oss-hybrid-course-shell",
      lessonCount: 0,
      ispringComplete: 0,
      importStatus: "course-created",
      mediaStatus: "not-required",
      hasPlayableMedia: false,
    },
  };
}

async function readManifestOrEmpty(course) {
  try {
    return await readManifest(course);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return emptyCourseManifest(course);
  }
}

async function readManifestForAdminStatus(course) {
  try {
    return {
      manifest: await readManifest(course),
      manifestStatus: "ready",
      manifestError: "",
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const code = safeSegment(course).toUpperCase();
    return {
      manifest: emptyCourseManifest(code),
      manifestStatus: "missing",
      manifestError: `Missing course-manifest.json for ${code}. Upload or import this course before publishing.`,
    };
  }
}

function normalizedOssExtractSummary(body = {}) {
  const summary = body.summary || {};
  const mediaExtracted = Number(body.mediaExtracted ?? summary.mediaExtracted ?? summary.extracted ?? 0);
  const lightweightCandidates = Number(body.lightweightCandidates ?? summary.lightweightCandidates ?? summary.lightweight ?? 0);
  const entries = Number(body.entries ?? summary.entries ?? 0);
  const skipped = Number(body.skipped ?? summary.skipped ?? 0);
  const status = String(body.status || summary.status || (mediaExtracted > 0 ? "media-ready" : "no-media")).toLowerCase();
  return {
    entries: Number.isFinite(entries) ? entries : 0,
    mediaExtracted: Number.isFinite(mediaExtracted) ? mediaExtracted : 0,
    lightweightCandidates: Number.isFinite(lightweightCandidates) ? lightweightCandidates : 0,
    skipped: Number.isFinite(skipped) ? skipped : 0,
    status,
    manifestObjectKey: String(body.manifestObjectKey || summary.manifestObjectKey || ""),
  };
}

async function ensureHybridCourseShell({ course, actor, extractSummary = {}, sourceObjectKey = "", uploadId = "" }) {
  const code = safeSegment(course).toUpperCase();
  if (!code) throw new Error("Course is required.");
  const root = courseRoot(code);
  const manifestPath = join(root, "course-manifest.json");
  await mkdir(root, { recursive: true });
  let manifest = null;
  let created = false;
  if (existsSync(manifestPath)) {
    manifest = await readManifestOrEmpty(code);
  } else {
    manifest = emptyCourseManifest(code);
    manifest.sourceAudit = {
      ...(manifest.sourceAudit || {}),
      generatedFrom: "oss-hybrid-course-shell",
      sourceObjectKey,
      latestUploadId: uploadId,
      importStatus: "course-created",
      mediaStatus: extractSummary.mediaExtracted > 0 ? "pending" : "not-required",
      hasPlayableMedia: extractSummary.mediaExtracted > 0,
      lightweightCandidates: extractSummary.lightweightCandidates || 0,
    };
    writeJsonFile(manifestPath, manifest);
    created = true;
  }
  const catalogEntry = await ensureCourseCatalogEntry(code, manifest);
  const lifecycle = setCourseLifecycleStatus(code, "active", actor, "Activated automatically after OSS course package shell import.");
  try {
    await appendAdminHistory(code, {
      actor,
      action: "oss-course-shell-import",
      uploadId,
      sourceObjectKey,
      created,
      entries: extractSummary.entries || 0,
      mediaExtracted: extractSummary.mediaExtracted || 0,
      lightweightCandidates: extractSummary.lightweightCandidates || 0,
      status: extractSummary.status || "",
      lifecycleStatus: lifecycle.status,
    });
  } catch {
    // History is helpful for audits, but shell creation should not fail because of it.
  }
  return { manifest, catalogEntry, lifecycle, created };
}

async function createPortalOssClient() {
  if (!ossDirectUploadConfig.bucket || !ossDirectUploadConfig.accessKeyId || !ossDirectUploadConfig.accessKeySecret) {
    throw new Error("OSS credentials are not configured for lightweight course content import.");
  }
  const module = await import("ali-oss");
  const OSS = module.default || module;
  const options = {
    bucket: ossDirectUploadConfig.bucket,
    secure: true,
    accessKeyId: ossDirectUploadConfig.accessKeyId,
    accessKeySecret: ossDirectUploadConfig.accessKeySecret,
  };
  if (ossDirectUploadConfig.endpoint) options.endpoint = ossDirectUploadConfig.endpoint;
  if (ossDirectUploadConfig.securityToken) options.stsToken = ossDirectUploadConfig.securityToken;
  return new OSS(options);
}

async function ossObjectStream(client, objectKey) {
  const result = await client.getStream(objectKey);
  return result.stream || result.res || result;
}

async function readOssJsonObject(client, objectKey) {
  const stream = await ossObjectStream(client, objectKey);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
}

function safeLightweightRelativePath(value) {
  const normalized = normalizeImportPath(value).replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return "";
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return "";
  return normalized;
}

function lightweightStagingRoot(course, uploadId) {
  const root = courseRoot(course);
  return ensureInside(root, join(root, "_admin_uploads", "lightweight-staging", safeSegment(uploadId || `manual-${Date.now()}`)));
}

async function downloadOssObjectToFile(client, objectKey, targetPath) {
  await mkdir(dirname(targetPath), { recursive: true });
  const stream = await ossObjectStream(client, objectKey);
  await pipeline(stream, createWriteStream(targetPath));
}

async function copyLightweightStagingContent(stagingRoot, targetRoot) {
  const entries = await readdir(stagingRoot, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (entry.name === "_admin_uploads") continue;
    const source = join(stagingRoot, entry.name);
    const target = ensureInside(targetRoot, join(targetRoot, entry.name));
    await cp(source, target, { recursive: true });
    copied += 1;
  }
  return copied;
}

function activityTitleFromPath(relativePath) {
  const parts = normalizeImportPath(relativePath).split("/");
  const folder = parts.length > 1 ? parts[parts.length - 2] : fileStem(parts[0] || "");
  return cleanImportLabel(folder.replace(/^[A-Z]\d{2}L\d{2}[-_ ]*/i, "")) || "Moodle Activity";
}

function lessonKeyFromPath(relativePath, fallbackIndex) {
  const detected = detectUnitLesson(relativePath);
  if (detected?.unit && detected?.lesson) return detected;
  return { unit: 1, lesson: fallbackIndex };
}

function buildManifestFromLightweightFiles(course, lightweightFiles = []) {
  const code = safeSegment(course).toUpperCase();
  const manifest = emptyCourseManifest(code);
  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    generatedFrom: "oss-lightweight-import",
    importStatus: "lightweight-imported",
    mediaStatus: "not-required",
    hasPlayableMedia: false,
  };
  const files = lightweightFiles
    .map((item) => ({ ...item, path: safeLightweightRelativePath(item.path) }))
    .filter((item) => item.path);
  const indexFiles = files.filter((item) => /(?:^|\/)localized-moodle-activities\/.+\/index\.html$/i.test(item.path));
  const indexDirs = new Map(indexFiles.map((item, index) => {
    const key = lessonKeyFromPath(item.path, index + 1);
    return [dirname(item.path).replaceAll("\\", "/"), { item, unit: key.unit, lesson: key.lesson }];
  }));
  if (!indexDirs.size) {
    for (const item of files.filter((file) => file.path !== "course-manifest.json")) {
      const ext = extname(item.path).toLowerCase().replace(".", "") || "file";
      upsertResource(manifest.courseDownloads, {
        label: cleanImportLabel(fileStem(basename(item.path))),
        type: ext,
        category: "course_resource",
        role: "course_resource",
        path: item.path,
        bytes: Number(item.bytes || 0),
        source: "local",
      });
    }
    recomputeManifestSummaries(manifest);
    return manifest;
  }

  for (const { item, unit, lesson } of indexDirs.values()) {
    const lessonRecord = ensureManifestLesson(manifest, unit, lesson, activityTitleFromPath(item.path));
    lessonRecord.path = dirname(item.path).replaceAll("\\", "/");
    lessonRecord.downloads = lessonRecord.downloads || [];
    upsertResource(lessonRecord.downloads, {
      label: "Activity page",
      type: "html",
      category: "moodle_activity",
      role: "lesson_resource",
      path: item.path,
      bytes: Number(item.bytes || 0),
      source: "local",
    });
  }

  for (const item of files) {
    if (item.path === "course-manifest.json" || item.path.endsWith("/index.html")) continue;
    const parent = [...indexDirs.keys()].find((dir) => item.path.startsWith(`${dir}/`));
    const ext = extname(item.path).toLowerCase().replace(".", "") || "file";
    const record = {
      label: cleanImportLabel(fileStem(basename(item.path))),
      type: ext,
      category: coursePackageEntryKind(item.path) === "document" ? "course_document" : "moodle_activity",
      role: "lesson_resource",
      path: item.path,
      bytes: Number(item.bytes || 0),
      source: "local",
    };
    if (parent && indexDirs.has(parent)) {
      const owner = indexDirs.get(parent);
      const lessonRecord = ensureManifestLesson(manifest, owner.unit, owner.lesson, activityTitleFromPath(owner.item.path));
      lessonRecord.downloads = lessonRecord.downloads || [];
      upsertResource(lessonRecord.downloads, record);
    } else {
      upsertResource(manifest.courseDownloads, { ...record, role: "course_resource" });
    }
  }
  recomputeManifestSummaries(manifest);
  return manifest;
}

function shouldUseCdnForManifestPath(path) {
  const kind = coursePackageEntryKind(path);
  return ["video", "audio", "h5p", "ispring"].includes(kind);
}

function rewriteResourceForHybridStorage(course, item) {
  if (!item || typeof item !== "object") return item;
  const path = item.path || item.previewPath || "";
  if (!path || !shouldUseCdnForManifestPath(path)) return item;
  const cdnUrl = generatedCoursewareAssetUrl(course, path);
  if (!cdnUrl) return item;
  const next = { ...item, source: "cdn" };
  if (item.path) {
    next.url = cdnUrl;
    delete next.path;
  }
  if (item.previewPath) {
    next.previewUrl = generatedCoursewareAssetUrl(course, item.previewPath);
    delete next.previewPath;
  }
  if (item.downloadPath) {
    next.downloadUrl = generatedCoursewareAssetUrl(course, item.downloadPath);
    delete next.downloadPath;
  }
  return next;
}

function rewriteManifestForHybridStorage(manifest, course) {
  const code = safeSegment(course).toUpperCase();
  const rewriteList = (items = []) => items.map((item) => rewriteResourceForHybridStorage(code, item));
  manifest.courseDownloads = rewriteList(manifest.courseDownloads || []);
  manifest.texts = (manifest.texts || []).map((text) => ({
    ...text,
    materials: rewriteList(text.materials || []),
  }));
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) unit.unitPlan = rewriteResourceForHybridStorage(code, unit.unitPlan);
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) lesson.lessonPlan = rewriteResourceForHybridStorage(code, lesson.lessonPlan);
      lesson.downloads = rewriteList(lesson.downloads || []);
      lesson.textExports = rewriteList(lesson.textExports || []);
      lesson.bookSections = rewriteList(lesson.bookSections || []);
      lesson.ispring = rewriteList(lesson.ispring || []);
    }
  }
  return manifest;
}

function stripCoursewareReferencePrefix(course, referencePath) {
  const normalized = toPosixPath(referencePath || "").replace(/^\/+/, "");
  const code = safeSegment(course).toUpperCase();
  if (!normalized || !code) return normalized;

  const coursewarePrefix = `courseware/${code}/`;
  if (normalized.toUpperCase().startsWith(coursewarePrefix.toUpperCase())) {
    return normalized.slice(coursewarePrefix.length);
  }

  const assetPrefix = toPosixPath(coursewareAssetPrefix || "courseware-active").replace(/^\/+|\/+$/g, "");
  const assetCoursePrefix = assetPrefix ? `${assetPrefix}/${code}/` : "";
  if (assetCoursePrefix && normalized.toUpperCase().startsWith(assetCoursePrefix.toUpperCase())) {
    return normalized.slice(assetCoursePrefix.length);
  }

  return normalized;
}

function htmlReferenceValueToCoursePath(course, htmlPath, rawValue) {
  const value = String(rawValue || "").trim();
  if (
    !value ||
    value.startsWith("#") ||
    /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(value)
  ) {
    return "";
  }
  const rawPath = decodePath(value.split(/[?#]/)[0] || "").replace(/\\/g, "/");
  if (!rawPath) return "";
  const strippedRootPath = stripCoursewareReferencePrefix(course, rawPath);
  const combined = value.startsWith("/") || strippedRootPath !== rawPath.replace(/^\/+/, "")
    ? strippedRootPath
    : normalize(toPosixPath(join(dirname(htmlPath), rawPath)));
  const normalized = toPosixPath(combined);
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

function rewriteHtmlPlayableReferencesForHybridStorage(html, course, htmlPath) {
  let rewritten = 0;
  const body = String(html || "").replace(/\b(href|src|poster)\s*=\s*(["'])([^"']+)\2/gi, (match, attr, quote, rawValue) => {
    const coursePath = htmlReferenceValueToCoursePath(course, htmlPath, rawValue);
    if (!coursePath || !isPlayableCoursewareAsset(coursePath)) return match;
    const cdnUrl = generatedCoursewareAssetUrl(course, coursePath);
    if (!cdnUrl) return match;
    rewritten += 1;
    return `${attr}=${quote}${cdnUrl}${quote}`;
  });
  return { html: body, rewritten };
}

function rewriteJsonPlayableReferencesForHybridStorage(value, course, jsonPath) {
  let rewritten = 0;
  const pathLikeKeys = new Set(["path", "src", "href", "poster", "url", "file"]);
  const rewriteNode = (node, key = "") => {
    if (Array.isArray(node)) return node.map((item) => rewriteNode(item, key));
    if (node && typeof node === "object") {
      const next = {};
      for (const [childKey, child] of Object.entries(node)) next[childKey] = rewriteNode(child, childKey);
      return next;
    }
    if (typeof node !== "string") return node;
    if (!pathLikeKeys.has(String(key || "").toLowerCase())) return node;
    const coursePath = htmlReferenceValueToCoursePath(course, jsonPath, node);
    if (!coursePath || !isPlayableCoursewareAsset(coursePath)) return node;
    const cdnUrl = generatedCoursewareAssetUrl(course, coursePath);
    if (!cdnUrl) return node;
    rewritten += 1;
    return cdnUrl;
  };
  return { value: rewriteNode(value), rewritten };
}

async function importLightweightContentFromOssManifest({ course, manifestObjectKey, uploadId, actor }) {
  const code = safeSegment(course).toUpperCase();
  if (!courseLocalContentEnabled) return { status: "skipped", reason: "COURSE_LOCAL_CONTENT_ENABLED=0" };
  if (!manifestObjectKey) return { status: "skipped", reason: "No import manifest object key." };
  const client = await createPortalOssClient();
  const importManifest = await readOssJsonObject(client, manifestObjectKey);
  const lightweightFiles = Array.isArray(importManifest.lightweightFiles) ? importManifest.lightweightFiles : [];
  const selectedFiles = lightweightFiles
    .map((item) => ({
      ...item,
      path: safeLightweightRelativePath(item.path),
      objectKey: String(item.objectKey || ""),
      bytes: Number(item.bytes || 0),
    }))
    .filter((item) => item.path && item.objectKey && isLightweightCourseContentAsset(item.path, { size: item.bytes, maxBytes: courseLocalMaxFileBytes }));
  const totalBytes = selectedFiles.reduce((sum, item) => sum + Math.max(0, Number(item.bytes || 0)), 0);
  if (totalBytes > courseLocalMaxCourseBytes) {
    throw new Error(`Lightweight content exceeds course limit: ${Math.round(totalBytes / 1024 / 1024)} MB.`);
  }
  const stagingRoot = lightweightStagingRoot(code, uploadId);
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  for (const item of selectedFiles) {
    const target = ensureInside(stagingRoot, join(stagingRoot, item.path));
    await downloadOssObjectToFile(client, item.objectKey, target);
  }

  let lightweightHtmlPlayableRefsRewritten = 0;
  let lightweightJsonPlayableRefsRewritten = 0;
  for (const item of selectedFiles) {
    const target = ensureInside(stagingRoot, join(stagingRoot, item.path));
    if (!existsSync(target)) continue;
    if (/\.(?:html?|htm)$/i.test(item.path)) {
      const currentHtml = await readFile(target, "utf8");
      const rewritten = rewriteHtmlPlayableReferencesForHybridStorage(currentHtml, code, item.path);
      if (rewritten.rewritten > 0) {
        await writeFile(target, rewritten.html, "utf8");
        lightweightHtmlPlayableRefsRewritten += rewritten.rewritten;
      }
    } else if (/\.json$/i.test(item.path) && !/(?:^|\/)course-manifest\.json$/i.test(item.path)) {
      try {
        const currentJson = JSON.parse(await readFile(target, "utf8"));
        const rewritten = rewriteJsonPlayableReferencesForHybridStorage(currentJson, code, item.path);
        if (rewritten.rewritten > 0) {
          await writeFile(target, `${JSON.stringify(rewritten.value, null, 2)}\n`, "utf8");
          lightweightJsonPlayableRefsRewritten += rewritten.rewritten;
        }
      } catch {
        // Non-JSON files with a .json suffix are left as-is.
      }
    }
  }

  const root = courseRoot(code);
  await mkdir(root, { recursive: true });
  const copiedTopLevelEntries = await copyLightweightStagingContent(stagingRoot, root);
  const stagedManifestPath = join(stagingRoot, "course-manifest.json");
  let manifest = null;
  if (existsSync(stagedManifestPath)) {
    manifest = normalizeManifestCourse(JSON.parse(await readFile(stagedManifestPath, "utf8")), code);
  } else {
    manifest = buildManifestFromLightweightFiles(code, selectedFiles);
  }
  rewriteManifestForHybridStorage(manifest, code);
  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    generatedFrom: manifest.sourceAudit?.generatedFrom || "oss-lightweight-import",
    importStatus: "lightweight-imported",
    mediaStatus: (manifest.sourceAudit?.hasPlayableMedia || false) ? "pending" : "not-required",
    hasPlayableMedia: Boolean(manifest.sourceAudit?.hasPlayableMedia),
    latestUploadId: uploadId,
    lightweightFilesImported: selectedFiles.length,
    lightweightBytes: totalBytes,
    lightweightHtmlPlayableRefsRewritten,
    lightweightJsonPlayableRefsRewritten,
    lightweightPlayableRefsRewritten: lightweightHtmlPlayableRefsRewritten + lightweightJsonPlayableRefsRewritten,
    importManifestObjectKey: manifestObjectKey,
  };
  recomputeManifestSummaries(manifest);
  writeJsonFile(join(root, "course-manifest.json"), manifest);
  const catalogEntry = await ensureCourseCatalogEntry(code, manifest);
  const lifecycle = setCourseLifecycleStatus(code, "active", actor, "Activated automatically after OSS lightweight course content import.");
  await rm(stagingRoot, { recursive: true, force: true });
  return {
    status: "imported",
    files: selectedFiles.length,
    bytes: totalBytes,
    htmlPlayableRefsRewritten: lightweightHtmlPlayableRefsRewritten,
    jsonPlayableRefsRewritten: lightweightJsonPlayableRefsRewritten,
    playableRefsRewritten: lightweightHtmlPlayableRefsRewritten + lightweightJsonPlayableRefsRewritten,
    copiedTopLevelEntries,
    catalogEntry,
    lifecycle,
  };
}

async function readCourseCatalog() {
  return JSON.parse(await readFile(courseCatalogPath, "utf8"));
}

async function ensureCourseCatalogEntry(course, manifest) {
  return withOperationLock("course-catalog", async () => {
    const code = safeSegment(course).toUpperCase();
    if (!code) throw new Error("Course is required.");
    if (isExcludedCourseCode(code)) throw new Error(`Course ${code} is excluded by policy.`);
    const catalog = await readCourseCatalog();
    catalog.courses = Array.isArray(catalog.courses) ? catalog.courses : [];
    const index = catalog.courses.findIndex((entry) => String(entry.code || "").toUpperCase() === code);
    const existing = index >= 0 ? catalog.courses[index] : {};
    const ispringCount = (manifest.units || []).reduce(
      (sum, unit) => sum + (unit.lessons || []).reduce((lessonSum, lesson) => lessonSum + (lesson.ispring || []).length, 0),
      0,
    );
    const nextEntry = {
      code,
      title: existing.title || manifest.course?.title || `${code} · Course`,
      level: existing.level || "",
      status: existing.status || (ispringCount ? "ready" : "planning-only"),
      manifestUrl: `/courseware/${code}/course-manifest.json`,
      baseUrl: `/courseware/${code}/`,
      notes: existing.notes || (ispringCount ? "Imported whole-course package." : "Planning documents imported."),
    };
    if (index >= 0) catalog.courses[index] = { ...existing, ...nextEntry };
    else catalog.courses.push(nextEntry);
    catalog.courses.sort((left, right) =>
      String(left.code || "").localeCompare(String(right.code || ""), "en", {
        numeric: true,
        sensitivity: "base",
      }),
    );
    if (!catalog.defaultCourse || !catalog.courses.some((entry) => entry.code === catalog.defaultCourse)) {
      catalog.defaultCourse = code;
    }
    writeJsonFile(courseCatalogPath, catalog);
    return nextEntry;
  });
}

function findLesson(manifest, unitNumber, lessonNumber) {
  for (const unit of manifest.units || []) {
    if (unit.unit !== unitNumber) continue;
    for (const lesson of unit.lessons || []) {
      if (lesson.lesson === lessonNumber) return lesson;
    }
  }
  return null;
}

function manifestReadiness(manifest) {
  const units = manifest.units || [];
  const lessons = units.flatMap((unit) =>
    (unit.lessons || []).map((lesson) => ({
      unit: unit.unit,
      unitTitle: unit.title,
      ...lesson,
    })),
  );
  const courseDownloads = manifest.courseDownloads || [];
  const lessonsRequiringPlans = lessons.filter((lesson) => lesson.planningStatus !== "unit_overview");
  const courseOutlineCount = courseDownloads.filter((item) => item.role === "course_outline").length;
  const introductionCount = courseDownloads.filter((item) => item.role === "introduction").length;
  const unitPlanCount = units.filter((unit) => unit.unitPlan).length;
  const lessonPlanCount = lessonsRequiringPlans.filter((lesson) => lesson.lessonPlan).length;
  const ispringCount = lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0);

  return {
    complete: Boolean(
      courseOutlineCount &&
        introductionCount &&
        units.every((unit) => unit.unitPlan) &&
        lessonsRequiringPlans.every((lesson) => lesson.lessonPlan),
    ),
    courseOutline: {
      count: courseOutlineCount,
      ok: courseOutlineCount > 0,
    },
    introduction: {
      count: introductionCount,
      ok: introductionCount > 0,
    },
    unitPlans: {
      count: unitPlanCount,
      expected: units.length,
      missing: units.filter((unit) => !unit.unitPlan).map((unit) => ({ unit: unit.unit, title: unit.title })),
    },
    lessonPlans: {
      count: lessonPlanCount,
      expected: lessonsRequiringPlans.length,
      missing: lessonsRequiringPlans
        .filter((lesson) => !lesson.lessonPlan)
        .map((lesson) => ({ id: lesson.id, unit: lesson.unit, lesson: lesson.lesson, title: lesson.title })),
    },
    ispring: {
      count: ispringCount,
      connected: ispringCount > 0,
    },
    texts: {
      count: manifest.texts?.length || 0,
      materials: (manifest.texts || []).reduce((sum, text) => sum + (text.materials?.length || 0), 0),
      needsReview: (manifest.texts || [])
        .filter((text) => text.copyrightStatus === "needs_review" || text.sourceStatus === "needs_review")
        .map((text) => ({ id: text.id, title: text.title, author: text.author })),
      missingDownloads: (manifest.texts || [])
        .filter((text) => text.sourceStatus !== "unavailable" && !(text.materials || []).length)
        .map((text) => ({ id: text.id, title: text.title, author: text.author })),
    },
  };
}

function manifestDisplayability(manifest, manifestStatus) {
  if (manifestStatus !== "ready") {
    return {
      ok: false,
      reason: manifestStatus === "missing" ? "missing-manifest" : "manifest-not-ready",
      units: 0,
      lessons: 0,
      bookSections: 0,
      resources: 0,
      ispring: 0,
      videos: 0,
      texts: 0,
      textMaterials: 0,
      courseDownloads: 0,
    };
  }

  const units = Array.isArray(manifest.units) ? manifest.units : [];
  const texts = Array.isArray(manifest.texts) ? manifest.texts : [];
  const courseDownloads = Array.isArray(manifest.courseDownloads) ? manifest.courseDownloads : [];
  let lessons = 0;
  let bookSections = 0;
  let resources = 0;
  let ispring = 0;
  let videos = 0;

  for (const unit of units) {
    for (const lesson of unit.lessons || []) {
      lessons += 1;
      bookSections += (lesson.bookSections || []).length;
      ispring += (lesson.ispring || []).length;
      for (const section of ["lesson", "downloads", "handsOn", "consolidation", "homework", "resources"]) {
        const items = Array.isArray(lesson[section]) ? lesson[section] : [];
        resources += items.length;
        videos += items.filter((item) => {
          const text = JSON.stringify(item || {});
          return /\.(mp4|webm|mov|m4v)(\?|#|"|$)/i.test(text);
        }).length;
      }
    }
  }

  const textMaterials = texts.reduce((sum, text) => sum + (text.materials?.length || 0), 0);
  const ok = Boolean(
    units.length &&
      (
        lessons ||
        bookSections ||
        resources ||
        ispring ||
        videos ||
        texts.length ||
        textMaterials ||
        courseDownloads.length
      ),
  );

  return {
    ok,
    reason: ok ? "" : "no-displayable-content",
    units: units.length,
    lessons,
    bookSections,
    resources,
    ispring,
    videos,
    texts: texts.length,
    textMaterials,
    courseDownloads: courseDownloads.length,
  };
}

async function courseReadinessRecord(course) {
  const { manifest, manifestStatus, manifestError } = await readManifestForAdminStatus(course.code);
  const readiness = manifestReadiness(manifest);
  const displayable = manifestDisplayability(manifest, manifestStatus);
  return {
    code: course.code,
    title: course.title,
    status: course.status,
    level: course.level,
    uploaded: manifestStatus === "ready",
    completed: displayable.ok,
    displayable,
    manifestStatus,
    manifestError,
    units: manifest.units?.length || 0,
    lessons: manifest.sourceAudit?.lessonCount || (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
    readiness,
  };
}

function directUploadGapItems(course, manifest) {
  const readiness = manifestReadiness(manifest);
  const items = [];
  if (!readiness.courseOutline.ok) {
    items.push({
      priority: "high",
      course: course.code,
      title: course.title,
      uploadType: "course-outline",
      unit: null,
      lesson: null,
      suggestedFilename: `${course.code}_Course_Outline.docx`,
      note: "Upload as Course Outline / Syllabus.",
    });
  }
  if (!readiness.introduction.ok) {
    items.push({
      priority: "medium",
      course: course.code,
      title: course.title,
      uploadType: "course-introduction",
      unit: null,
      lesson: null,
      suggestedFilename: `${course.code}_Introduction.md`,
      note: "Upload as Course Introduction.",
    });
  }
  for (const unit of readiness.unitPlans.missing) {
    items.push({
      priority: "high",
      course: course.code,
      title: course.title,
      uploadType: "unit-plan",
      unit: unit.unit,
      lesson: null,
      suggestedFilename: `${course.code}_U${String(unit.unit).padStart(2, "0")}_Unit_Plan.docx`,
      note: `Missing Unit Plan: ${unit.title}.`,
    });
  }
  for (const lesson of readiness.lessonPlans.missing) {
    items.push({
      priority: "high",
      course: course.code,
      title: course.title,
      uploadType: "lesson-plan",
      unit: lesson.unit,
      lesson: lesson.lesson,
      suggestedFilename: `${course.code}_U${String(lesson.unit).padStart(2, "0")}_L${String(lesson.lesson).padStart(2, "0")}_Lesson_Plan.docx`,
      note: `Missing Lesson Plan: ${lesson.id} ${lesson.title}.`,
    });
  }
  return items;
}

function reviewGapItems(course, manifest) {
  return (manifest.texts || [])
    .filter(
      (text) =>
        text.copyrightStatus === "needs_review" ||
        text.sourceStatus === "needs_review" ||
        text.sourceStatus === "link_only" ||
        text.sourceStatus === "pending_download" ||
        !(text.materials || []).length,
    )
    .map((text) => ({
      priority: "text-download",
      course: course.code,
      title: course.title,
      uploadType: "text-material",
      textId: text.id,
      textTitle: text.title,
      author: text.author,
      note: text.notes || "Add a downloadable text file for this literary work.",
    }));
}

function externalGapItems(course, manifest) {
  const lessons = (manifest.units || []).flatMap((unit) => unit.lessons || []);
  const ispringCount = lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0);
  if (course.code === "ENG3U" || ispringCount > 0) return [];
  return [
    {
      priority: "external",
      course: course.code,
      title: course.title,
      uploadType: "ispring-zip",
      lessonCount: lessons.length,
      connectedCount: ispringCount,
      note:
        lessons.length > 0
          ? "No iSpring packages connected. Upload ZIPs lesson by lesson if packages exist."
          : "No lessons are indexed yet, so iSpring cannot be attached until lesson structure exists.",
    },
  ];
}

function validatePortalUsername(username) {
  const value = String(username || "").trim();
  if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(value)) {
    throw new Error("Username must be 3-64 characters and use letters, numbers, dot, underscore, @, or hyphen.");
  }
  return value;
}

function normalizePortalCourses(courses) {
  if (!Array.isArray(courses)) return [];
  const normalized = courses.map((course) => String(course || "").trim().toUpperCase()).filter(Boolean);
  return normalized.includes("*") ? ["*"] : [...new Set(normalized)];
}

async function availablePortalCourses() {
  const catalog = await readCourseCatalog();
  return visibleCatalogCourses(catalog).map((course) => ({
    code: course.code,
    title: course.title,
    status: course.status,
    lifecycleStatus: courseLifecycleRecord(course.code).status,
    level: course.level,
  }));
}

function upsertPortalUser(users, input) {
  const username = validatePortalUsername(input.username);
  const role = String(input.role || "teacher").trim() || "teacher";
  const courses = normalizePortalCourses(input.courses);
  const now = new Date().toISOString();
  const index = users.findIndex((user) => user.username === username);
  const existing = index >= 0 ? users[index] : null;
  if (!existing && !input.password) throw new Error("Password is required for a new user.");

  const next = normalizePortalUser({
    ...(existing || {}),
    username,
    displayName:
      input.displayName !== undefined || input.nickname !== undefined || input.name !== undefined || input.fullName !== undefined
        ? String(input.displayName || input.nickname || input.name || input.fullName || "").trim()
        : existing?.displayName || "",
    role,
    courses,
    status: input.status === "disabled" ? "disabled" : "active",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    passwordHash: input.password ? hashPortalPassword(input.password) : existing?.passwordHash,
  });
  delete next.password;

  if (index >= 0) users[index] = next;
  else users.push(next);
  return next;
}

function removePortalUser(users, username) {
  const value = validatePortalUsername(username);
  const user = users.find((item) => item.username === value);
  if (!user) throw new Error("User not found.");
  const remainingAdmins = users.filter((item) => item.username !== value && item.status !== "disabled" && (item.role === "admin" || item.courses?.includes("*")));
  if ((user.role === "admin" || user.courses?.includes("*")) && !remainingAdmins.length) {
    throw new Error("Cannot remove the last active admin/all-course user.");
  }
  return users.filter((item) => item.username !== value);
}

async function courseUploadGapRecord(course) {
  const { manifest, manifestStatus, manifestError } = await readManifestForAdminStatus(course.code);
  if (manifestStatus !== "ready") {
    return {
      code: course.code,
      title: course.title,
      uploaded: false,
      manifestStatus,
      manifestError,
      uploadItems: [],
      reviewItems: [],
      externalItems: [],
    };
  }
  return {
    code: course.code,
    title: course.title,
    uploaded: true,
    manifestStatus,
    manifestError,
    uploadItems: directUploadGapItems(course, manifest),
    reviewItems: reviewGapItems(course, manifest),
    externalItems: externalGapItems(course, manifest),
  };
}

function runCommand(command, args, cwd, options = {}) {
  const allowedExitCodes = new Set(options.allowedExitCodes || []);
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0 || allowedExitCodes.has(code)) {
        resolveRun({ stdout, stderr, code });
      } else {
        rejectRun(new Error(`${command} exited ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function runPythonScript(scriptPath, args, cwd) {
  const candidates = [];
  if (process.env.PYTHON_BIN) candidates.push([process.env.PYTHON_BIN]);
  candidates.push(process.platform === "win32" ? ["python"] : ["python3"]);
  candidates.push(process.platform === "win32" ? ["py", "-3"] : ["python"]);

  let lastError;
  for (const candidate of candidates) {
    const [command, ...baseArgs] = candidate;
    try {
      return await runCommand(command, [...baseArgs, scriptPath, ...args], cwd);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const mayTryNext =
        message.includes("ENOENT") ||
        message.includes("not found") ||
        message.includes("No installed Python found") ||
        message.includes("exited 103");
      if (!mayTryNext) throw error;
    }
  }
  throw lastError || new Error("Python interpreter not found.");
}

async function rebuildManifest(course) {
  const scriptName = course.toUpperCase() === "ENG3U" ? "build_course_manifest.py" : "build_plan_course_manifest.py";
  const scriptPath = join(projectRoot, "tools", scriptName);
  return runPythonScript(scriptPath, ["--course", course], workspaceRoot);
}

async function generateDocumentPreviews(course) {
  const scriptPath = join(projectRoot, "scripts", "generate-document-previews.mjs");
  return runCommand("node", [scriptPath, "--course", course], projectRoot);
}

async function generateLightweightPreviews(course) {
  const scriptPath = join(projectRoot, "tools", "generate_lightweight_docx_previews.py");
  return runPythonScript(scriptPath, ["--course", course, "--workspace-root", workspaceRoot, "--course-root", courseRoot(course)], projectRoot);
}

async function generateContentWorkbench() {
  const scriptPath = join(projectRoot, "scripts", "generate-content-workbench.mjs");
  return runCommand("node", [scriptPath], projectRoot);
}

async function finalizeEcsFirstCourseStorage(course, importId) {
  const scriptPath = join(projectRoot, "scripts", "finalize-ecs-first-course-storage.mjs");
  const args = [
    scriptPath,
    "--course",
    safeSegment(course).toUpperCase(),
    "--courseware-root",
    courseActiveRoot,
    "--bucket",
    ossBucketUri,
    "--cdn-base-url",
    coursewareAssetBaseUrl,
    "--prefix",
    coursewareAssetPrefix,
    "--registry",
    coursewareAssetRegistryPath,
    "--ossutil",
    ossutilPath,
    "--apply",
  ];
  const result = await runCommand("node", args, projectRoot);
  return parseJobPayload(result.stdout) || {
    ok: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function readContentWorkbench() {
  return JSON.parse(await readFile(join(projectRoot, "deployment", "course-content-workbench.json"), "utf8"));
}

async function directorySize(root) {
  try {
    const rootStat = await stat(root);
    if (rootStat.isFile()) return rootStat.size;
  } catch {
    return 0;
  }
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile()) {
        try {
          total += (await stat(path)).size;
        } catch {
          // Ignore files that disappear during maintenance.
        }
      }
    }
  }
  return total;
}

async function diskInfoFor(path) {
  try {
    const info = await statfs(path);
    const totalBytes = Number(info.blocks) * Number(info.bsize);
    const freeBytes = Number(info.bavail) * Number(info.bsize);
    return {
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - freeBytes,
    };
  } catch {
    return null;
  }
}

function formatBytesForError(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function coursePackageEcsCapacityPreflight(totalBytes) {
  const packageBytes = Number(totalBytes || 0);
  const disk = await diskInfoFor(courseActiveRoot) || await diskInfoFor(projectRoot);
  const requiredBytes = Math.ceil(packageBytes * coursePackageEcsSpaceFactor + coursePackageDiskReserveBytes);
  const ok = !disk || disk.freeBytes >= requiredBytes;
  return {
    ok,
    disk,
    packageBytes,
    requiredBytes,
    freeBytes: disk?.freeBytes ?? null,
    spaceFactor: coursePackageEcsSpaceFactor,
    reserveBytes: coursePackageDiskReserveBytes,
    rawUploadRequired: !ok,
  };
}

async function assertCoursePackageEcsCapacity(totalBytes) {
  const capacity = await coursePackageEcsCapacityPreflight(totalBytes);
  if (capacity.ok) return capacity;
  throw new Error(`ECS 剩余空间不足，不能走 ECS 本地课程包导入：ZIP ${formatBytesForError(capacity.packageBytes)}，预估峰值需要 ${formatBytesForError(capacity.requiredBytes)}，当前可用 ${formatBytesForError(capacity.freeBytes)}。请走 OSS raw package，由 ECS worker 从 OSS 内网流式读取并分流。`);
}

async function listDirectoryNames(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function courseStorageRecord(courseCode, catalogEntry = null) {
  const course = safeSegment(courseCode).toUpperCase();
  const root = courseRoot(course);
  const adminRoot = join(root, "_admin_uploads");
  const archivePath = join(courseArchiveRoot, `${course}.tar.gz`);
  const archiveZipPath = join(courseArchiveRoot, `${course}.zip`);
  const archiveDir = join(courseArchiveRoot, course);
  const [activeBytes, adminUploadBytes, archiveFileBytes, archiveZipBytes, archiveDirBytes] = await Promise.all([
    directorySize(root),
    directorySize(adminRoot),
    directorySize(archivePath),
    directorySize(archiveZipPath),
    directorySize(archiveDir),
  ]);
  return {
    course,
    title: catalogEntry?.title || "",
    status: courseLifecycleRecord(course).status,
    activeBytes,
    adminUploadBytes,
    archiveBytes: archiveFileBytes + archiveZipBytes + archiveDirBytes,
    totalBytes: activeBytes + archiveFileBytes + archiveZipBytes + archiveDirBytes,
  };
}

async function storageCourseIndex() {
  const catalog = await readCourseCatalog();
  const catalogCourses = visibleCatalogCourses(catalog);
  const catalogMap = new Map(catalogCourses.map((course) => [String(course.code || "").toUpperCase(), course]));
  const activeDirs = await listDirectoryNames(courseActiveRoot);
  const archiveDirs = await listDirectoryNames(courseArchiveRoot);
  const activeDirCourses = activeDirs
    .map((name) => String(name || "").toUpperCase())
    .filter((name) => name && !isExcludedCourseCode(name));
  const extraActiveDirCourses = activeDirCourses.filter((course) => !catalogMap.has(course));
  const courseCodes = new Set([
    ...catalogCourses.map((course) => String(course.code || "").toUpperCase()).filter(Boolean),
    ...activeDirCourses,
    ...archiveDirs
      .map((name) => String(name || "").replace(/\.(tar\.gz|zip)$/i, "").toUpperCase())
      .filter((name) => name && !isExcludedCourseCode(name)),
  ]);
  return {
    catalogCourses,
    catalogMap,
    activeDirCourses,
    extraActiveDirCourses,
    courseCodes,
  };
}

function summarizeStorageCourses(courses, index) {
  return {
    courseCount: courses.length,
    catalogCourses: index.catalogCourses.length,
    activeDirectoryCourses: index.activeDirCourses.length,
    extraActiveDirectoryCourses: index.extraActiveDirCourses.length,
    activeRootBytes: courses.reduce((sum, course) => sum + Number(course.activeBytes || 0), 0),
    archiveRootBytes: courses.reduce((sum, course) => sum + Number(course.archiveBytes || 0), 0),
    adminUploadBytes: courses.reduce((sum, course) => sum + Number(course.adminUploadBytes || 0), 0),
    courseTotalBytes: courses.reduce((sum, course) => sum + Number(course.totalBytes || 0), 0),
  };
}

function normalizeStorageCourseRecord(record) {
  return {
    course: safeSegment(record?.course || "").toUpperCase(),
    title: String(record?.title || ""),
    status: String(record?.status || "active"),
    activeBytes: Number(record?.activeBytes || 0),
    adminUploadBytes: Number(record?.adminUploadBytes || 0),
    archiveBytes: Number(record?.archiveBytes || 0),
    totalBytes: Number(record?.totalBytes || 0),
  };
}

function storageCacheMeta(status, cache = null) {
  const updatedAt = cache?.updatedAt || cache?.generatedAt || null;
  const ageSeconds = updatedAt ? Math.max(0, Math.round((Date.now() - Date.parse(updatedAt)) / 1000)) : null;
  const usable = ["ready", "rebuilt", "updated"].includes(status);
  return {
    path: storageOverviewCachePath,
    exists: Boolean(cache),
    usable,
    status,
    updatedAt,
    ageSeconds,
  };
}

function storageCacheIsUsable(cache) {
  return Boolean(
    cache
      && cache.version === storageOverviewCacheVersion
      && cache.activeRoot === courseActiveRoot
      && cache.archiveRoot === courseArchiveRoot
      && Array.isArray(cache.courses)
      && cache.summary
  );
}

function readStorageOverviewCache() {
  const cache = readJsonFileSync(storageOverviewCachePath, null);
  if (!cache) return { cache: null, meta: storageCacheMeta("missing") };
  if (!storageCacheIsUsable(cache)) return { cache: null, meta: storageCacheMeta("stale", cache) };
  return { cache, meta: storageCacheMeta("ready", cache) };
}

async function writeStorageOverviewCache(cache) {
  await mkdir(dirname(storageOverviewCachePath), { recursive: true });
  writeJsonFile(storageOverviewCachePath, cache);
  return cache;
}

async function rebuildStorageOverviewCache() {
  const index = await storageCourseIndex();
  const courses = (await Promise.all([...index.courseCodes].map((course) => courseStorageRecord(course, index.catalogMap.get(course)))))
    .map(normalizeStorageCourseRecord)
    .filter((course) => course.course)
    .sort((a, b) => b.totalBytes - a.totalBytes || a.course.localeCompare(b.course));
  const now = new Date().toISOString();
  const cache = {
    ok: true,
    version: storageOverviewCacheVersion,
    generatedAt: now,
    updatedAt: now,
    activeRoot: courseActiveRoot,
    archiveRoot: courseArchiveRoot,
    summary: summarizeStorageCourses(courses, index),
    courses,
    warnings: [],
  };
  return writeStorageOverviewCache(cache);
}

function publicStorageOverview(cache, { disk, summaryOnly, cacheMeta }) {
  return {
    ok: true,
    generatedAt: cache.generatedAt || cache.updatedAt || new Date().toISOString(),
    updatedAt: cache.updatedAt || cache.generatedAt || null,
    activeRoot: courseActiveRoot,
    archiveRoot: courseArchiveRoot,
    disk,
    summary: {
      ...(cache.summary || {}),
      lightweight: summaryOnly,
      cached: Boolean(cacheMeta?.usable),
    },
    cache: cacheMeta,
    courses: summaryOnly ? [] : cache.courses || [],
    warnings: cache.warnings || [],
  };
}

async function storageOverview({ summaryOnly = false, refresh = false } = {}) {
  const disk = await diskInfoFor(courseActiveRoot);
  if (refresh || !summaryOnly) {
    const cached = readStorageOverviewCache();
    if (!refresh && cached.cache) return publicStorageOverview(cached.cache, { disk, summaryOnly, cacheMeta: cached.meta });
    const rebuilt = await rebuildStorageOverviewCache();
    return publicStorageOverview(rebuilt, { disk, summaryOnly, cacheMeta: storageCacheMeta("rebuilt", rebuilt) });
  }

  const cached = readStorageOverviewCache();
  if (cached.cache) return publicStorageOverview(cached.cache, { disk, summaryOnly, cacheMeta: cached.meta });

  const index = await storageCourseIndex();
  const now = new Date().toISOString();
  const lightweightCache = {
    ok: true,
    version: storageOverviewCacheVersion,
    generatedAt: now,
    updatedAt: now,
    activeRoot: courseActiveRoot,
    archiveRoot: courseArchiveRoot,
    summary: {
      courseCount: 0,
      catalogCourses: index.catalogCourses.length,
      activeDirectoryCourses: index.activeDirCourses.length,
      extraActiveDirectoryCourses: index.extraActiveDirCourses.length,
      activeRootBytes: null,
      archiveRootBytes: null,
      adminUploadBytes: null,
      courseTotalBytes: null,
    },
    courses: [],
    warnings: ["Storage cache is missing; open the storage page or rebuild the cache to calculate course sizes."],
  };
  return publicStorageOverview(lightweightCache, { disk, summaryOnly, cacheMeta: cached.meta });
}

async function refreshStorageCacheForCourse(courseCode) {
  const course = safeSegment(courseCode || "").toUpperCase();
  if (!course) return null;
  const current = readStorageOverviewCache();
  if (!current.cache) return null;
  const index = await storageCourseIndex();
  const record = normalizeStorageCourseRecord(await courseStorageRecord(course, index.catalogMap.get(course)));
  const courses = (current.cache.courses || [])
    .map(normalizeStorageCourseRecord)
    .filter((item) => item.course && item.course !== course);
  if (record.activeBytes || record.adminUploadBytes || record.archiveBytes || index.catalogMap.has(course)) {
    courses.push(record);
  }
  courses.sort((a, b) => b.totalBytes - a.totalBytes || a.course.localeCompare(b.course));
  const now = new Date().toISOString();
  const next = {
    ...current.cache,
    updatedAt: now,
    activeRoot: courseActiveRoot,
    archiveRoot: courseArchiveRoot,
    summary: summarizeStorageCourses(courses, index),
    courses,
  };
  return writeStorageOverviewCache(next);
}

async function appendAdminHistory(course, entry) {
  const path = uploadHistoryPath(course);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
}

async function readAdminHistory(course, limit = 30) {
  try {
    const content = await readFile(uploadHistoryPath(course), "utf8");
    return content
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { malformed: line };
        }
      })
      .reverse();
  } catch {
    return [];
  }
}

async function cleanupAdminUploads(course, mode) {
  const root = courseRoot(course);
  const adminRoot = ensureInside(root, join(root, "_admin_uploads"));
  const targets = [];
  if (mode === "zips" || mode === "all") {
    targets.push(join(adminRoot, "ispring"));
    targets.push(join(adminRoot, "ispring-batches"));
  }
  if (mode === "extracted" || mode === "temp" || mode === "all") {
    targets.push(join(adminRoot, "ispring-extracted"));
    targets.push(join(adminRoot, "ispring-batch-extracted"));
  }
  if (mode === "temp" || mode === "all") targets.push(join(adminRoot, "incoming"));
  if (mode === "temp" || mode === "all") targets.push(join(adminRoot, "course-packages"));

  let removedBytes = 0;
  const removed = [];
  for (const target of targets) {
    const safeTarget = ensureInside(adminRoot, target);
    const bytes = await directorySize(safeTarget);
    if (bytes > 0) {
      await rm(safeTarget, { recursive: true, force: true });
      removedBytes += bytes;
      removed.push(safeTarget);
    }
  }
  return { removedBytes, removed };
}

function timestampSegment() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function relativeCoursePath(course, target) {
  const root = courseRoot(course);
  return resolve(target).slice(resolve(root).length + 1);
}

async function backupExistingPath(course, target) {
  const root = courseRoot(course);
  const safeTarget = ensureInside(root, target);
  let targetStat;
  try {
    targetStat = await stat(safeTarget);
  } catch {
    return null;
  }

  const backupRoot = ensureInside(root, join(root, "_admin_uploads", "backups", timestampSegment()));
  const backupPath = ensureInside(backupRoot, join(backupRoot, relativeCoursePath(course, safeTarget)));
  await mkdir(dirname(backupPath), { recursive: true });
  if (targetStat.isDirectory()) {
    await cp(safeTarget, backupPath, { recursive: true });
  } else {
    await cp(safeTarget, backupPath);
  }
  return backupPath;
}

async function listFilesUnder(root, limit = 25) {
  const files = [];
  let bytes = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile()) {
        try {
          const size = (await stat(path)).size;
          bytes += size;
          if (files.length < limit) {
            files.push({
              path: normalize(path.slice(root.length + 1)).replaceAll("\\", "/"),
              bytes: size,
            });
          }
        } catch {
          // Ignore files that disappear while listing backups.
        }
      }
    }
  }
  return { files, bytes };
}

async function listAdminBackups(course, limit = 30) {
  const root = courseRoot(course);
  const backupsRoot = ensureInside(root, join(root, "_admin_uploads", "backups"));
  let entries = [];
  try {
    entries = await readdir(backupsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const backupDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, limit);

  const backups = [];
  for (const id of backupDirs) {
    const backupDir = ensureInside(backupsRoot, join(backupsRoot, id));
    const { files, bytes } = await listFilesUnder(backupDir);
    backups.push({
      id,
      path: relativeCoursePath(course, backupDir).replaceAll("\\", "/"),
      bytes,
      files,
    });
  }
  return backups;
}

function incomingUploadPath(course, filename) {
  const root = courseRoot(course);
  return ensureInside(root, join(root, "_admin_uploads", "incoming", `${Date.now()}-${safeSegment(filename || "upload.bin")}`));
}

function targetForUpload(search, manifest) {
  const course = (search.get("course") || "ENG3U").toUpperCase();
  const type = search.get("type") || "";
  const filename = safeSegment(search.get("filename") || "upload.bin");
  const ext = extname(filename);
  const root = courseRoot(course);

  if (!ext) throw new Error("Uploaded file must have an extension.");
  if (!allowedExtensionsByType[type]?.has(ext.toLowerCase())) {
    throw new Error(`.${ext.replace(".", "")} is not allowed for ${type}.`);
  }

  if (type === "course-outline") {
    return { course, type, target: ensureInside(root, join(root, "plans", "course", `Course_Outline${ext}`)) };
  }
  if (type === "course-introduction") {
    return { course, type, target: ensureInside(root, join(root, "plans", "course", `Introduction${ext}`)) };
  }
  if (type === "unit-plan") {
    const unit = Number(search.get("unit"));
    if (!Number.isInteger(unit) || unit < 1) throw new Error("unit-plan upload needs a valid unit number.");
    return { course, type, target: ensureInside(root, join(root, "plans", "unit-plans", `U${String(unit).padStart(2, "0")}_Unit_Plan${ext}`)) };
  }
  if (type === "lesson-plan") {
    const unit = Number(search.get("unit"));
    const lesson = Number(search.get("lesson"));
    if (!Number.isInteger(unit) || !Number.isInteger(lesson) || unit < 1 || lesson < 1) {
      throw new Error("lesson-plan upload needs valid unit and lesson numbers.");
    }
    return {
      course,
      type,
      target: ensureInside(root, join(root, "plans", "lesson-plans", `U${String(unit).padStart(2, "0")}_L${String(lesson).padStart(2, "0")}_Lesson_Plan${ext}`)),
    };
  }
  if (type === "text-material") {
    const textId = safeSegment(search.get("textId") || "");
    if (!textId) throw new Error("text-material upload needs a valid textId.");
    return {
      course,
      type,
      target: ensureInside(root, join(root, "texts", textId, filename)),
    };
  }
  if (type === "ispring-zip") {
    const unit = Number(search.get("unit"));
    const lesson = Number(search.get("lesson"));
    if (ext.toLowerCase() !== ".zip") throw new Error("iSpring upload must be a .zip file.");
    const lessonRecord = findLesson(manifest, unit, lesson);
    if (!lessonRecord) throw new Error(`Could not find Unit ${unit} Lesson ${lesson} in manifest.`);
    return {
      course,
      type,
      lessonDir: ensureInside(root, join(root, lessonRecord.path)),
      target: ensureInside(root, join(root, "_admin_uploads", "ispring", `${Date.now()}-${filename}`)),
    };
  }
  if (type === "ispring-batch-zip") {
    if (ext.toLowerCase() !== ".zip") throw new Error("iSpring batch upload must be a .zip file.");
    return {
      course,
      type,
      target: ensureInside(root, join(root, "_admin_uploads", "ispring-batches", `${Date.now()}-${filename}`)),
    };
  }
  throw new Error(`Unsupported upload type: ${type}`);
}

function maxBytesForUpload(type) {
  return type === "ispring-zip" || type === "ispring-batch-zip" ? maxIspringUploadBytes : maxDocumentUploadBytes;
}

function assertContentLength(req, type) {
  const contentLength = Number(req.headers["content-length"] || 0);
  const maxBytes = maxBytesForUpload(type);
  if (!contentLength) {
    throw new Error("Missing Content-Length header.");
  }
  if (contentLength > maxBytes) {
    throw new Error(`Upload is too large. Max for ${type} is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
}

async function extractZip(zipPath, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  if (process.platform === "win32") {
    const safeZip = zipPath.replaceAll("'", "''");
    const safeTarget = targetDir.replaceAll("'", "''");
    await runCommand("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Expand-Archive -LiteralPath '${safeZip}' -DestinationPath '${safeTarget}' -Force`], projectRoot);
  } else {
    const result = await runCommand("unzip", ["-q", zipPath, "-d", targetDir], projectRoot, { allowedExitCodes: [1] });
    if (result.code === 1) {
      const output = `${result.stderr || ""}\n${result.stdout || ""}`;
      const filenameEncodingWarning = /mismatching "local" filename|continuing with "central" filename/i.test(output);
      if (!filenameEncodingWarning || !(await directoryHasAnyFile(targetDir))) {
        throw new Error(`unzip exited 1\n${result.stderr || result.stdout}`);
      }
    }
  }
}

async function directoryHasAnyFile(rootDir) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
      if (entry.isFile()) return true;
      if (entry.isDirectory()) stack.push(join(dir, entry.name));
    }
  }
  return false;
}

async function locatePresentationDir(rootDir) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "presentation.html")) {
      return dir;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(join(dir, entry.name));
    }
  }
  return null;
}

async function listZipFilesUnder(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) {
        files.push(path);
      }
    }
  }
  return files.sort();
}

function parseIspringPackageName(filename, course) {
  const stem = safeSegment(filename).replace(/\.zip$/i, "");
  const coursePrefix = safeSegment(course).toUpperCase();
  const patterns = [
    new RegExp(`^${coursePrefix}[_\\s-]*U(\\d{1,2})[_\\s-]*L(\\d{1,2})$`, "i"),
    /^U(\d{1,2})[_\s-]*L(\d{1,2})$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(stem);
    if (!match) continue;
    return { unit: Number(match[1]), lesson: Number(match[2]) };
  }
  return null;
}

async function installIspringPackage({ course, sourceZip, lessonDir, label }) {
  const extractRoot = join(courseRoot(course), "_admin_uploads", "ispring-extracted", `${Date.now()}-${safeSegment(label || "package")}`);
  await extractZip(sourceZip, extractRoot);
  const presentationDir = await locatePresentationDir(extractRoot);
  if (!presentationDir) throw new Error(`${label || "Uploaded iSpring ZIP"} does not contain presentation.html.`);
  const packageDir = ensureInside(lessonDir, join(lessonDir, "html5-package-admin"));
  const backupPath = await backupExistingPath(course, packageDir);
  await rm(packageDir, { recursive: true, force: true });
  await cp(presentationDir, packageDir, { recursive: true });
  await cp(sourceZip, ensureInside(lessonDir, join(lessonDir, "html5-package-admin.zip")));
  return { packageDir, backupPath };
}

async function installIspringBatch(upload, manifest) {
  const batchExtractRoot = join(courseRoot(upload.course), "_admin_uploads", "ispring-batch-extracted", `${Date.now()}`);
  await extractZip(upload.target, batchExtractRoot);
  const zipFiles = await listZipFilesUnder(batchExtractRoot);
  const installed = [];
  const skipped = [];
  const backups = [];

  for (const zipFile of zipFiles) {
    const filename = zipFile.split(/[\\/]/).pop() || zipFile;
    const parsed = parseIspringPackageName(filename, upload.course);
    if (!parsed) {
      skipped.push({ filename, reason: "Filename must look like U01_L01.zip or COURSE_U01_L01.zip." });
      continue;
    }
    const lessonRecord = findLesson(manifest, parsed.unit, parsed.lesson);
    if (!lessonRecord) {
      skipped.push({ filename, unit: parsed.unit, lesson: parsed.lesson, reason: "No matching Unit/Lesson in manifest." });
      continue;
    }
    const lessonDir = ensureInside(courseRoot(upload.course), join(courseRoot(upload.course), lessonRecord.path));
    const result = await installIspringPackage({
      course: upload.course,
      sourceZip: zipFile,
      lessonDir,
      label: filename,
    });
    if (result.backupPath) backups.push(result.backupPath);
    installed.push({
      filename,
      unit: parsed.unit,
      lesson: parsed.lesson,
      lessonId: lessonRecord.id,
      path: result.packageDir,
    });
  }

  return { installed, skipped, backups, extractedCount: zipFiles.length };
}

function writeJsonFile(path, data) {
  writeFileAtomicSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function removeFileIfExists(path) {
  if (!path) return false;
  if (!existsSync(path)) return false;
  await rm(path, { force: true });
  return true;
}

function normalizeImportPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function fileStem(filename) {
  const ext = extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}

function cleanImportLabel(value) {
  return String(value || "Resource")
    .replace(/\b[A-Z]{3,5}\d[A-Z]\b/gi, "")
    .replace(/\bU(?:nit)?\s*0?\d{1,2}\b/gi, "")
    .replace(/\bL(?:esson)?\s*0?\d{1,2}\b/gi, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Resource";
}

function detectUnitLesson(value) {
  const text = normalizeImportPath(value);
  const compact = text.replace(/[_\s-]+/g, "");
  const simplePair = /(?:^|[^A-Za-z0-9])U(?:nit)?\s*0?(\d{1,2})[^A-Za-z0-9]*L(?:esson)?\s*0?(\d{1,2})(?=$|[^A-Za-z0-9])/i.exec(text);
  if (simplePair) return { unit: Number(simplePair[1]), lesson: Number(simplePair[2]) };
  const pairPatterns = [
    /(?:^|[^A-Za-z0-9])Unit\s*0?(\d{1,2}).{0,40}(?:^|[^A-Za-z0-9])Lesson\s*0?(\d{1,2})(?=$|[^A-Za-z0-9])/i,
    /(?:^|[^A-Za-z0-9])Lesson\s*0?(\d{1,2}).{0,40}(?:^|[^A-Za-z0-9])Unit\s*0?(\d{1,2})(?=$|[^A-Za-z0-9])/i,
  ];
  for (const pattern of pairPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (pattern === pairPatterns[1]) return { unit: Number(match[2]), lesson: Number(match[1]) };
    return { unit: Number(match[1]), lesson: Number(match[2]) };
  }
  const compactPair = /U0?(\d{1,2})L0?(\d{1,2})/i.exec(compact);
  if (compactPair) return { unit: Number(compactPair[1]), lesson: Number(compactPair[2]) };
  const unitMatch = /(?:^|[^A-Za-z0-9])(?:U|Unit)\s*[-_\s]*0?(\d{1,2})(?=$|[^A-Za-z0-9])/i.exec(text);
  const lessonMatch = /(?:^|[^A-Za-z0-9])(?:L|Lesson)\s*[-_\s]*0?(\d{1,2})(?=$|[^A-Za-z0-9])/i.exec(text);
  return {
    unit: unitMatch ? Number(unitMatch[1]) : null,
    lesson: lessonMatch ? Number(lessonMatch[1]) : null,
  };
}

function sectionRoleForPath(value) {
  const text = normalizeImportPath(value).toLowerCase();
  if (/expectation|learning[-_\s]*goal|success[-_\s]*criteria|overview/.test(text)) return { key: "expectations", label: "Lesson Expectations", index: 1 };
  if (/hands[-_\s]*on|handson|activity|quiz/.test(text)) return { key: "hands_on", label: "Hands On", index: 3 };
  if (/consolidation|exit[-_\s]*slip/.test(text)) return { key: "consolidation", label: "Consolidation", index: 4 };
  if (/homework|assignment/.test(text)) return { key: "homework", label: "Homework", index: 5 };
  if (/introduction|lesson/.test(text)) return { key: "lesson", label: "Lesson", index: 2 };
  return { key: "resource", label: "Files / Activities", index: 9 };
}

function coursePackageId() {
  return `${timestampSegment()}-${randomBytes(4).toString("hex")}`;
}

function coursePackageDir(course, importId) {
  return ensureInside(courseRoot(course), join(courseRoot(course), "_admin_uploads", "course-packages", safeSegment(importId)));
}

function coursePackageReviewPath(course, importId) {
  return ensureInside(coursePackageDir(course, importId), join(coursePackageDir(course, importId), "review.json"));
}

function coursePackageStatusPath(course, importId) {
  return ensureInside(coursePackageDir(course, importId), join(coursePackageDir(course, importId), "status.json"));
}

function coursePackageTaskKey(course, importId) {
  return `${safeSegment(course).toUpperCase()}:${safeSegment(importId)}`;
}

function readJsonFileSyncSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readCoursePackageTask(course, importId) {
  const safeCourse = safeSegment(course).toUpperCase();
  const safeImportId = safeSegment(importId);
  if (!safeImportId) return null;
  const key = coursePackageTaskKey(safeCourse, safeImportId);
  const cached = coursePackageTasks.get(key);
  if (cached) return cached;

  const status = readJsonFileSyncSafe(coursePackageStatusPath(safeCourse, safeImportId));
  if (status) {
    if (status.status === "complete" && !status.review) {
      const review = readJsonFileSyncSafe(coursePackageReviewPath(safeCourse, safeImportId));
      if (review) {
        const restored = {
          ...status,
          ok: status.ok ?? true,
          course: status.course || safeCourse,
          importId: status.importId || safeImportId,
          summary: status.summary || review.summary,
          review,
          updatedAt: status.updatedAt || review.generatedAt || new Date().toISOString(),
        };
        coursePackageTasks.set(key, restored);
        return restored;
      }
    }
    coursePackageTasks.set(key, status);
    return status;
  }

  const review = readJsonFileSyncSafe(coursePackageReviewPath(safeCourse, safeImportId));
  if (!review) return null;
  const restored = {
    ok: true,
    course: safeCourse,
    importId: safeImportId,
    status: "complete",
    phase: "ready",
    percent: 100,
    summary: review.summary,
    review,
    updatedAt: review.generatedAt || new Date().toISOString(),
  };
  coursePackageTasks.set(key, restored);
  return restored;
}

function writeCoursePackageTask(course, importId, patch) {
  const safeCourse = safeSegment(course).toUpperCase();
  const safeImportId = safeSegment(importId);
  const key = coursePackageTaskKey(safeCourse, safeImportId);
  const previous = coursePackageTasks.get(key) || readJsonFileSyncSafe(coursePackageStatusPath(safeCourse, safeImportId)) || {};
  const next = {
    ...previous,
    ok: patch.status !== "failed",
    course: safeCourse,
    importId: safeImportId,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(coursePackageDir(safeCourse, safeImportId), { recursive: true });
  writeJsonFile(coursePackageStatusPath(safeCourse, safeImportId), next);
  coursePackageTasks.set(key, next);
  return next;
}

async function latestCoursePackageTasks(course, limit = 5) {
  const packagesRoot = ensureInside(courseRoot(course), join(courseRoot(course), "_admin_uploads", "course-packages"));
  if (!existsSync(packagesRoot)) return [];
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const tasks = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => readCoursePackageTask(course, entry.name))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return tasks.slice(0, limit);
}

async function writeRequestToFileWithProgress(req, targetPath, { course, importId, contentLength }) {
  let bytesReceived = 0;
  let lastWriteAt = 0;
  const progress = new Transform({
    transform(chunk, encoding, callback) {
      bytesReceived += chunk.length;
      const now = Date.now();
      if (now - lastWriteAt > 1000 || bytesReceived === contentLength) {
        lastWriteAt = now;
        writeCoursePackageTask(course, importId, {
          status: "uploading",
          phase: "uploading",
          bytesReceived,
          totalBytes: contentLength,
          percent: contentLength ? Math.round((bytesReceived / contentLength) * 100) : null,
        });
      }
      callback(null, chunk);
    },
  });
  await pipeline(req, progress, createWriteStream(targetPath));
  writeCoursePackageTask(course, importId, {
    status: "processing",
    phase: "extracting",
    bytesReceived,
    totalBytes: contentLength,
    percent: 100,
  });
}

function coursePackageChunkDir(course, importId) {
  return ensureInside(coursePackageDir(course, importId), join(coursePackageDir(course, importId), "chunks"));
}

function coursePackageChunkPath(course, importId, index) {
  return ensureInside(coursePackageChunkDir(course, importId), join(coursePackageChunkDir(course, importId), `part-${String(index).padStart(6, "0")}`));
}

async function coursePackageChunkProgress(course, importId, chunkTotal) {
  let chunksReceived = 0;
  let bytesReceived = 0;
  for (let index = 0; index < chunkTotal; index += 1) {
    const path = coursePackageChunkPath(course, importId, index);
    if (!existsSync(path)) continue;
    const info = await stat(path);
    chunksReceived += 1;
    bytesReceived += info.size;
  }
  return { chunksReceived, bytesReceived, complete: chunksReceived === chunkTotal };
}

function pipeFileIntoWriter(filePath, writer) {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = createReadStream(filePath);
    const onDrain = () => reader.resume();
    const cleanup = () => {
      reader.removeAllListeners();
      writer.removeListener("drain", onDrain);
      writer.removeListener("error", rejectPromise);
    };
    reader.on("data", (chunk) => {
      if (!writer.write(chunk)) reader.pause();
    });
    writer.on("drain", onDrain);
    reader.on("end", () => {
      cleanup();
      resolvePromise();
    });
    reader.on("error", (error) => {
      cleanup();
      rejectPromise(error);
    });
    writer.on("error", rejectPromise);
  });
}

async function mergeCoursePackageChunks({ course, importId, originalFilename, chunkTotal, totalBytes, actor }) {
  const packageDir = coursePackageDir(course, importId);
  const sourceZip = ensureInside(packageDir, join(packageDir, safeSegment(originalFilename)));
  await mkdir(dirname(sourceZip), { recursive: true });
  let merged = existsSync(sourceZip) ? await stat(sourceZip) : null;
  if (!merged || (totalBytes && merged.size !== totalBytes)) {
    const writer = createWriteStream(sourceZip);
    for (let index = 0; index < chunkTotal; index += 1) {
      await pipeFileIntoWriter(coursePackageChunkPath(course, importId, index), writer);
      writeCoursePackageTask(course, importId, {
        status: "processing",
        phase: "merging",
        mergeIndex: index + 1,
        chunkTotal,
        percent: Math.round(((index + 1) / chunkTotal) * 100),
      });
    }
    writer.end();
    await finished(writer);
    merged = await stat(sourceZip);
  } else {
    writeCoursePackageTask(course, importId, {
      status: "processing",
      phase: "merging",
      mergeIndex: chunkTotal,
      chunkTotal,
      percent: 100,
    });
  }

  if (totalBytes && merged.size !== totalBytes) {
    throw new Error(`Merged ZIP size mismatch. Expected ${totalBytes} bytes, got ${merged.size} bytes.`);
  }
  await rm(coursePackageChunkDir(course, importId), { recursive: true, force: true });

  writeCoursePackageTask(course, importId, {
    status: "processing",
    phase: "extracting",
    bytesReceived: merged.size,
    totalBytes,
    percent: 100,
  });
  const review = await createCoursePackageReview({ course, sourceZip, originalFilename, importId });
  const uploadedZipRemoved = await removeFileIfExists(sourceZip);
  review.uploadedZipRemoved = uploadedZipRemoved;
  review.uploadedZipRemovedAt = uploadedZipRemoved ? new Date().toISOString() : null;
  writeJsonFile(coursePackageReviewPath(course, importId), review);
  writeCoursePackageTask(course, importId, {
    status: "complete",
    phase: "ready",
    percent: 100,
    summary: review.summary,
    review,
  });
  await appendAdminHistory(course, {
    actor,
    action: "course-package-chunk-upload-preview",
    importId: review.importId,
    filename: originalFilename,
    bytes: merged.size,
    summary: review.summary,
  });
  return review;
}

function startCoursePackageFinalize({ course, importId, actor }) {
  const task = readCoursePackageTask(course, importId);
  if (!task || task.status === "complete") return task;
  if (!task.chunkTotal || Number(task.chunksReceived || 0) < Number(task.chunkTotal || 0)) return task;

  const key = coursePackageTaskKey(course, importId);
  if (coursePackageFinalizeTasks.has(key)) {
    return writeCoursePackageTask(course, importId, {
      status: "processing",
      phase: task.phase === "extracting" ? "extracting" : "merging",
      filename: task.filename,
      totalBytes: task.totalBytes,
      chunkTotal: task.chunkTotal,
      chunksReceived: task.chunksReceived,
      percent: task.percent || 100,
    });
  }

  const promise = mergeCoursePackageChunks({
    course,
    importId,
    originalFilename: task.filename || "course-package.zip",
    chunkTotal: Number(task.chunkTotal),
    totalBytes: Number(task.totalBytes || 0),
    actor,
  })
    .catch((error) => {
      writeCoursePackageTask(course, importId, {
        status: "failed",
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      coursePackageFinalizeTasks.delete(key);
    });
  coursePackageFinalizeTasks.set(key, promise);
  return writeCoursePackageTask(course, importId, {
    status: "processing",
    phase: "merging",
    filename: task.filename,
    totalBytes: task.totalBytes,
    chunkTotal: task.chunkTotal,
    chunksReceived: task.chunksReceived,
    percent: 100,
  });
}

function isRetryableRawCoursePackageImportError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /unexpected end of file|Z_BUF_ERROR|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|Premature close|aborted|read ECONNRESET/i.test(message);
}

async function runRawCoursePackageImportCommand({ args, course, importId, filename, record }) {
  let lastError = null;
  for (let attempt = 1; attempt <= rawCoursePackageImportRetries; attempt += 1) {
    if (attempt > 1) {
      writeCoursePackageTask(course, importId, {
        status: "processing",
        phase: "retrying-oss-raw",
        filename,
        source: "oss-raw-package",
        ossUri: record.ossUri,
        totalBytes: record.fileSize || null,
        percent: 10,
        importMode: "hybrid-raw",
        attempt,
        maxAttempts: rawCoursePackageImportRetries,
        previousError: lastError instanceof Error ? lastError.message : String(lastError || ""),
      });
      ossUploadStore.patchRecord(record.id, {
        status: "importing",
        importStatus: "oss-raw-retrying",
        ingestMessage: `OSS raw 导入读取流中断，正在重新从 OSS raw ZIP 启动 worker（${attempt}/${rawCoursePackageImportRetries}）。`,
        error: "",
      });
    }
    try {
      return await runCommand("node", args, projectRoot);
    } catch (error) {
      lastError = error;
      if (attempt >= rawCoursePackageImportRetries || !isRetryableRawCoursePackageImportError(error)) throw error;
    }
  }
  throw lastError || new Error("OSS raw package import failed.");
}

function startRawOssCoursePackageImport({ record, actor }) {
  const course = safeSegment(record?.course || "").toUpperCase();
  const importId = safeSegment(record?.id || coursePackageId());
  const filename = safeSegment(record?.fileName || "course-package.zip") || "course-package.zip";
  const key = coursePackageTaskKey(course, importId);
  if (!course) throw new Error("Course is required for raw OSS package import.");
  if (!record?.ossUri) throw new Error("Raw OSS course package is missing ossUri.");
  if (coursePackageFinalizeTasks.has(key)) {
    return writeCoursePackageTask(course, importId, {
      status: "processing",
      phase: "streaming-oss-raw",
      filename,
      source: "oss-raw-package",
      ossUri: record.ossUri,
      totalBytes: record.fileSize || null,
      percent: 10,
      importMode: "hybrid-raw",
    });
  }

  const promise = (async () => {
    writeCoursePackageTask(course, importId, {
      status: "processing",
      phase: "streaming-oss-raw",
      filename,
      source: "oss-raw-package",
      ossUri: record.ossUri,
      totalBytes: record.fileSize || null,
      percent: 10,
      startedAt: new Date().toISOString(),
      importMode: "hybrid-raw",
    });
    ossUploadStore.patchRecord(record.id, {
      status: "importing",
      importId,
      importStatus: "oss-raw-streaming",
      importMode: "hybrid-raw",
      ossOnly: false,
      error: "",
      ingestMessage: "课程包已进入 ECS worker：从 OSS raw ZIP 流式读取，普通资料落 ECS，高并发资源发布到 OSS/CDN。",
    });

    const scriptPath = join(projectRoot, "scripts", "import-hybrid-raw-package.mjs");
    const rawImportArgs = [
      scriptPath,
      "--course",
      course,
      "--import-id",
      importId,
      "--source-oss-uri",
      record.ossUri,
      "--courseware-root",
      courseActiveRoot,
      "--bucket",
      ossBucketUri,
      "--cdn-base-url",
      coursewareAssetBaseUrl,
      "--prefix",
      coursewareAssetPrefix,
      "--registry",
      coursewareAssetRegistryPath,
      "--actor",
      actor || "unknown",
    ];
    const result = await runRawCoursePackageImportCommand({
      args: rawImportArgs,
      course,
      importId,
      filename,
      record,
    });
    const payload = parseJobPayload(result.stdout) || { ok: true, stdout: result.stdout, stderr: result.stderr };
    const manifest = await readManifest(course);
    const catalogEntry = await ensureCourseCatalogEntry(course, manifest);
    const lifecycle = setCourseLifecycleStatus(course, "active", actor, "Activated automatically after hybrid raw course package import.");
    let lightweightPreview = null;
    let lightweightPreviewWarning = null;
    try {
      lightweightPreview = await generateLightweightPreviews(course);
    } catch (error) {
      lightweightPreviewWarning = error instanceof Error ? error.message : String(error);
    }
    const finalResult = {
      ok: true,
      course,
      importId,
      imported: true,
      mode: "hybrid-raw",
      payload,
      catalogEntry,
      lifecycle,
      lightweightPreview: lightweightPreview?.stdout?.trim() || null,
      lightweightPreviewWarning,
      manifest: "manifest imported from OSS raw package and finalized for hybrid ECS/OSS storage",
    };
    writeCoursePackageTask(course, importId, {
      status: "committed",
      phase: "imported",
      percent: 100,
      filename,
      result: finalResult,
      importMode: "hybrid-raw",
    });
    ossUploadStore.patchRecord(record.id, {
      status: "imported",
      importStatus: "committed",
      mediaStatus: manifest.sourceAudit?.mediaStatus || "",
      hasPlayableMedia: manifest.sourceAudit?.hasPlayableMedia === true,
      latestUploadId: record.id,
      latestImportSummary: payload,
      importedAt: new Date().toISOString(),
      importResult: {
        mode: finalResult.mode,
        manifest: finalResult.manifest,
      },
      ingestMessage: "OSS raw 导入完成：普通资料保存在 ECS，高并发资源已发布到 OSS/CDN。",
      error: "",
    });
    await appendAdminHistory(course, {
      actor,
      action: "course-package-raw-import",
      importId,
      filename,
      ossUri: record.ossUri,
      payload,
      lifecycleStatus: lifecycle.status,
      lightweightPreview: lightweightPreview?.stdout?.trim() || null,
      lightweightPreviewWarning,
    });
  })()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      writeCoursePackageTask(course, importId, {
        status: "failed",
        phase: "failed",
        filename,
        source: "oss-raw-package",
        ossUri: record.ossUri,
        importMode: "hybrid-raw",
        error: message,
      });
      ossUploadStore.patchRecord(record.id, {
        status: "failed",
        importId,
        importStatus: "failed",
        importMode: "hybrid-raw",
        error: message,
      });
    })
    .finally(() => {
      coursePackageFinalizeTasks.delete(key);
    });
  coursePackageFinalizeTasks.set(key, promise);

  return writeCoursePackageTask(course, importId, {
    status: "processing",
    phase: "streaming-oss-raw",
    filename,
    source: "oss-raw-package",
    ossUri: record.ossUri,
    totalBytes: record.fileSize || null,
    percent: 10,
    startedAt: new Date().toISOString(),
    importMode: "hybrid-raw",
  });
}

function startOssCoursePackageImport({ record, actor, autoCommit = true }) {
  if (!isRawCoursePackageUploadKind(record?.kind)) {
    throw new Error("这个课程包记录来自已停用的历史导入接口，不能继续处理。请通过课程压缩包入口重新上传课程 ZIP。");
  }
  const course = safeSegment(record?.course || "").toUpperCase();
  const importId = safeSegment(record?.id || coursePackageId());
  if (!course) throw new Error("Course is required for OSS course package import.");
  if (!record?.ossUri) throw new Error("OSS upload record is missing ossUri.");
  const filename = safeSegment(record.fileName || "course-package.zip") || "course-package.zip";
  if (extname(filename).toLowerCase() !== ".zip") throw new Error("Course package import requires a .zip file.");

  if (isRawCoursePackageUploadKind(record?.kind)) {
    return startRawOssCoursePackageImport({ record, actor });
  }

  const key = coursePackageTaskKey(course, importId);
  if (coursePackageFinalizeTasks.has(key)) {
    return writeCoursePackageTask(course, importId, {
      status: "processing",
      phase: "downloading-oss",
      filename,
      source: "oss-direct-upload",
      ossUri: record.ossUri,
      percent: 5,
    });
  }

  const existing = readCoursePackageTask(course, importId);
  if (existing && ["complete", "committed"].includes(existing.status)) return existing;

  const promise = (async () => {
    const packageDir = coursePackageDir(course, importId);
    const sourceZip = ensureInside(packageDir, join(packageDir, filename));
    await mkdir(dirname(sourceZip), { recursive: true });
    writeCoursePackageTask(course, importId, {
      status: "processing",
      phase: "downloading-oss",
      filename,
      source: "oss-direct-upload",
      ossUri: record.ossUri,
      totalBytes: record.fileSize || null,
      percent: 5,
      startedAt: new Date().toISOString(),
    });
    ossUploadStore.patchRecord(record.id, {
      status: "importing",
      importId,
      importStatus: "downloading-oss",
      error: "",
    });

    await runOssutilCapture(["cp", record.ossUri, sourceZip]);
    const downloaded = await stat(sourceZip);
    writeCoursePackageTask(course, importId, {
      status: "processing",
      phase: "extracting",
      filename,
      bytesReceived: downloaded.size,
      totalBytes: record.fileSize || downloaded.size,
      percent: 35,
    });
    ossUploadStore.patchRecord(record.id, {
      status: "importing",
      importStatus: "extracting",
    });

    const review = await createCoursePackageReview({ course, sourceZip, originalFilename: filename, importId });
    const uploadedZipRemoved = await removeFileIfExists(sourceZip);
    review.uploadedZipRemoved = uploadedZipRemoved;
    review.uploadedZipRemovedAt = uploadedZipRemoved ? new Date().toISOString() : null;
    review.sourceOssUri = record.ossUri;
    writeJsonFile(coursePackageReviewPath(course, importId), review);
    writeCoursePackageTask(course, importId, {
      status: "complete",
      phase: "ready",
      percent: 60,
      summary: review.summary,
      review,
    });
    await appendAdminHistory(course, {
      actor,
      action: "oss-course-package-upload-preview",
      importId,
      filename,
      ossUri: record.ossUri,
      bytes: downloaded.size,
      summary: review.summary,
    });
    ossUploadStore.patchRecord(record.id, {
      status: autoCommit ? "importing" : "ready",
      importId,
      importStatus: autoCommit ? "ready-to-commit" : "ready",
      reviewSummary: review.summary,
    });

    if (!autoCommit) return;
    if (Number(review.summary?.needsReview || 0) > 0) {
      writeCoursePackageTask(course, importId, {
        status: "complete",
        phase: "needs-review",
        percent: 60,
        summary: review.summary,
        review,
      });
      ossUploadStore.patchRecord(record.id, {
        status: "needs-review",
        importStatus: "needs-review",
        error: "Package preview contains items that need manual review before commit.",
      });
      return;
    }

    writeCoursePackageTask(course, importId, {
      status: "processing",
      phase: "committing",
      percent: 80,
      summary: review.summary,
      review,
    });
    ossUploadStore.patchRecord(record.id, {
      status: "importing",
      importStatus: "committing",
    });

    const result = await withOperationLock(`course:${course}:write`, () => commitCoursePackageImport({ course, importId, actor }));
    const media = tryCreateMediaJob({ type: "publish-course", course, actor });
    writeCoursePackageTask(course, importId, {
      status: "committed",
      phase: media.job ? "media-queued" : "media-not-queued",
      percent: 100,
      result,
      mediaJob: media.job,
      mediaJobWarning: media.warning || "",
    });
    ossUploadStore.patchRecord(record.id, {
      status: media.job ? "queued" : "imported",
      importStatus: "committed",
      jobId: media.job?.id || "",
      mediaJobWarning: media.warning || "",
      importResult: {
        installedCount: Array.isArray(result.installed) ? result.installed.length : null,
        mode: result.mode || "",
        manifest: result.manifest || "",
      },
      error: "",
    });
    await appendAdminHistory(course, {
      actor,
      action: "oss-course-package-auto-commit",
      importId,
      filename,
      mediaJobId: media.job?.id || null,
      mediaJobWarning: media.warning || null,
    });
  })()
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      writeCoursePackageTask(course, importId, {
        status: "failed",
        phase: "failed",
        filename,
        source: "oss-direct-upload",
        ossUri: record.ossUri,
        error: message,
      });
      ossUploadStore.patchRecord(record.id, {
        status: "failed",
        importId,
        importStatus: "failed",
        error: message,
      });
    })
    .finally(() => {
      coursePackageFinalizeTasks.delete(key);
    });
  coursePackageFinalizeTasks.set(key, promise);

  return writeCoursePackageTask(course, importId, {
    status: "processing",
    phase: "downloading-oss",
    filename,
    source: "oss-direct-upload",
    ossUri: record.ossUri,
    totalBytes: record.fileSize || null,
    percent: 5,
    startedAt: existing?.startedAt || new Date().toISOString(),
  });
}

async function markOssCoursePackageAwaitingExtract({ record, actor }) {
  if (coursePackageImportMode === "ecs-first") {
    throw new Error("历史 OSS-side 解压等待状态已停用。请通过课程压缩包入口上传课程 ZIP。");
  }
  const course = safeSegment(record?.course || "").toUpperCase();
  const importId = safeSegment(record?.id || coursePackageId());
  if (!course) throw new Error("Course is required for OSS course package ingest.");
  if (!record?.ossUri) throw new Error("OSS upload record is missing ossUri.");
  const filename = safeSegment(record.fileName || "course-package.zip") || "course-package.zip";
  if (extname(filename).toLowerCase() !== ".zip") throw new Error("Course package ingest requires a .zip file.");

  const message = "历史 OSS-side 课程包链路已停用；请通过课程压缩包入口重新上传课程 ZIP。";
  const task = {
    ok: true,
    course,
    importId,
    status: "waiting",
    phase: "oss-extract-required",
    filename,
    source: "oss-direct-upload",
    ossUri: record.ossUri,
    totalBytes: record.fileSize || null,
    percent: 100,
    startedAt: new Date().toISOString(),
    message,
    importMode: "oss-only",
    targetPrefix: `${coursewareAssetPrefix}/${course}/`,
  };
  writeJsonFile(ossUploadStore.uploadPath(record.id, "oss-ingest-handoff.json"), {
    ...task,
    actor,
    createdAt: task.startedAt,
    objectKey: record.objectKey || "",
    bucket: record.bucket || ossDirectUploadConfig.bucket || "",
    nextAction: "Extract the ZIP in OSS, write playable assets under targetPrefix, then run index-oss-courseware-assets.",
  });

  ossUploadStore.patchRecord(record.id, {
    status: "uploaded",
    importId,
    importStatus: "oss-extract-required",
    importMode: "oss-only",
    ossOnly: true,
    targetPrefix: task.targetPrefix,
    error: "",
    ingestMessage: message,
    mediaJobWarning: "",
  });

  return task;
}

async function markOssCoursePackageExtracted({ record, actor, body = {} }) {
  if (coursePackageImportMode === "ecs-first") {
    throw new Error("历史 OSS-side 解压回调已停用。请通过课程压缩包入口重新上传课程 ZIP。");
  }
  const course = safeSegment(record?.course || "").toUpperCase();
  if (!course) throw new Error("Course is required for OSS course package indexing.");
  if (record?.kind !== "course-package") throw new Error("Only course package uploads can be marked extracted.");
  if (record?.importMode !== "oss-only" && record?.ossOnly !== true) {
    throw new Error("Only OSS-only course package uploads can be marked extracted.");
  }
  const now = new Date().toISOString();
  const targetPrefix = toPosixPath(body.targetPrefix || record.targetPrefix || `${coursewareAssetPrefix}/${course}/`).replace(/^\/+/, "").replace(/\/?$/, "/");
  const extractSummary = normalizedOssExtractSummary(body);
  const extractReport = {
    schemaVersion: 1,
    uploadId: record.id,
    course,
    actor,
    recordedAt: now,
    sourceObjectKey: record.objectKey || "",
    sourceOssUri: record.ossUri || "",
    targetPrefix,
    extractor: safeSegment(body.extractor || "external"),
    summary: body.summary || null,
    entries: extractSummary.entries,
    mediaExtracted: extractSummary.mediaExtracted,
    lightweightCandidates: extractSummary.lightweightCandidates,
    skipped: extractSummary.skipped,
    status: extractSummary.status,
    manifestObjectKey: extractSummary.manifestObjectKey,
    note: String(body.note || ""),
  };
  writeJsonFile(ossUploadStore.uploadPath(record.id, "oss-extract-result.json"), extractReport);

  const shell = await ensureHybridCourseShell({
    course,
    actor,
    extractSummary,
    sourceObjectKey: record.objectKey || "",
    uploadId: record.id,
  });
  let lightweightImport = null;
  let lightweightWarning = "";
  if (extractSummary.manifestObjectKey) {
    try {
      lightweightImport = await importLightweightContentFromOssManifest({
        course,
        manifestObjectKey: extractSummary.manifestObjectKey,
        uploadId: record.id,
        actor,
      });
    } catch (error) {
      lightweightWarning = error instanceof Error ? error.message : String(error);
    }
  }

  if (extractSummary.mediaExtracted <= 0) {
    const next = ossUploadStore.patchRecord(record.id, {
      status: "imported",
      importStatus: "no-media",
      mediaStatus: "not-required",
      localContentStatus: lightweightImport?.status === "imported"
        ? "lightweight-imported"
        : extractSummary.lightweightCandidates > 0
          ? "pending-lightweight-import"
          : "course-shell-only",
      hasPlayableMedia: false,
      latestUploadId: record.id,
      latestImportSummary: {
        entries: extractSummary.entries,
        mediaExtracted: extractSummary.mediaExtracted,
        lightweightCandidates: extractSummary.lightweightCandidates,
        lightweightImported: lightweightImport?.files || 0,
        skipped: extractSummary.skipped,
        status: extractSummary.status,
        manifestObjectKey: extractSummary.manifestObjectKey,
      },
      importMode: "oss-only",
      ossOnly: true,
      importedAt: now,
      extractedAt: now,
      extractedBy: actor,
      extractReport: "oss-extract-result.json",
      targetPrefix,
      jobId: "",
      mediaJobWarning: lightweightWarning,
      ingestMessage: lightweightImport?.status === "imported"
        ? `课程壳和轻量内容已导入（${lightweightImport.files || 0} files）；未发现视频/H5P/iSpring。媒体发布不需要执行。`
        : extractSummary.lightweightCandidates > 0
          ? "课程壳已创建；未发现视频/H5P/iSpring，轻量内容等待导入。媒体发布不需要执行。"
          : "课程壳已创建；未发现可发布媒体。媒体发布不需要执行。",
      error: "",
    });
    return { upload: next, job: null, warning: lightweightWarning, shell, lightweightImport };
  }

  const { job, warning } = tryCreateMediaJob({
    type: "index-oss",
    course,
    actor,
    params: { uploadId: record.id, applyOss: true },
  });
  const next = ossUploadStore.patchRecord(record.id, {
    status: job ? "queued" : "uploaded",
    importStatus: job ? "oss-index-queued" : "oss-extracted",
    mediaStatus: job ? "pending" : "warning",
    localContentStatus: lightweightImport?.status === "imported"
      ? "lightweight-imported"
      : extractSummary.lightweightCandidates > 0
        ? "pending-lightweight-import"
        : "course-shell-only",
    hasPlayableMedia: true,
    latestUploadId: record.id,
    latestImportSummary: {
      entries: extractSummary.entries,
      mediaExtracted: extractSummary.mediaExtracted,
      lightweightCandidates: extractSummary.lightweightCandidates,
      lightweightImported: lightweightImport?.files || 0,
      skipped: extractSummary.skipped,
      status: extractSummary.status,
      manifestObjectKey: extractSummary.manifestObjectKey,
    },
    importMode: "oss-only",
    ossOnly: true,
    extractedAt: now,
    extractedBy: actor,
    extractReport: "oss-extract-result.json",
    targetPrefix,
    jobId: job?.id || record.jobId || "",
    mediaJobWarning: warning || lightweightWarning || "",
    ingestMessage: job
      ? `课程壳已创建；${lightweightImport?.status === "imported" ? "轻量内容已导入；" : ""}OSS-side 媒体解压已确认，正在索引 OSS 资源。`
      : `OSS-side 解压已确认，但索引任务未创建：${warning || "任务中心未启用"}`,
    error: "",
  });
  return { upload: next, job, warning: warning || lightweightWarning, shell, lightweightImport };
}

async function packageContentRoot(extractRoot) {
  const entries = await readdir(extractRoot, { withFileTypes: true });
  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  if (visible.length === 1 && visible[0].isDirectory()) return join(extractRoot, visible[0].name);
  return extractRoot;
}

async function listPackageFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files.sort();
}

function packageManifestFile(contentRoot, files) {
  const direct = join(contentRoot, "course-manifest.json");
  if (existsSync(direct)) return direct;
  return files.find((file) => normalizeImportPath(relative(contentRoot, file)).toLowerCase().endsWith("/course-manifest.json")) || null;
}

async function readPackageManifest(contentRoot, files) {
  const manifestPath = packageManifestFile(contentRoot, files);
  if (!manifestPath) return null;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return { manifestPath, manifest };
}

function isInsideDirectory(filePath, dirPath) {
  const file = resolve(filePath);
  const dir = resolve(dirPath);
  return file === dir || file.startsWith(`${dir}\\`) || file.startsWith(`${dir}/`);
}

function lessonForImport(manifest, unitNumber, lessonNumber) {
  if (!unitNumber || !lessonNumber) return null;
  return findLesson(manifest, unitNumber, lessonNumber);
}

function targetFilename(prefix, sourcePath) {
  const ext = extname(sourcePath);
  const name = safeSegment(basename(sourcePath));
  return prefix ? `${prefix}${ext || extname(name)}` : name;
}

function importedFileRecord(course, relativePath, sourcePath, category, role, label) {
  const absolute = join(courseRoot(course), relativePath);
  const ext = extname(relativePath).toLowerCase().replace(".", "") || "file";
  let bytes = 0;
  try {
    bytes = existsSync(absolute) ? statSyncSafe(absolute) : 0;
  } catch {
    bytes = 0;
  }
  return {
    label: label || basename(sourcePath),
    type: ext,
    category,
    role,
    path: normalizeImportPath(relativePath),
    bytes,
  };
}

function statSyncSafe(path) {
  return readFileSync(path).byteLength;
}

function upsertResource(list, record) {
  const index = list.findIndex((item) => item.path === record.path || (item.role === record.role && item.label === record.label));
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

function ensureManifestUnit(manifest, unitNumber) {
  let unit = (manifest.units || []).find((item) => Number(item.unit) === Number(unitNumber));
  if (unit) return unit;
  manifest.units = manifest.units || [];
  unit = {
    unit: Number(unitNumber),
    title: `Unit ${unitNumber}`,
    coreTexts: [],
    unitPlan: null,
    unitResources: {},
    summary: { downloads: 0, ispring: 0, docx: 0, pdf: 0, video: 0, h5p: 0 },
    lessons: [],
  };
  manifest.units.push(unit);
  manifest.units.sort((left, right) => Number(left.unit) - Number(right.unit));
  return unit;
}

function ensureManifestLesson(manifest, unitNumber, lessonNumber, title) {
  const unit = ensureManifestUnit(manifest, unitNumber);
  let lesson = (unit.lessons || []).find((item) => Number(item.lesson) === Number(lessonNumber));
  if (lesson) return lesson;
  unit.lessons = unit.lessons || [];
  lesson = {
    id: `U${unitNumber}L${lessonNumber}`,
    unit: Number(unitNumber),
    lesson: Number(lessonNumber),
    title: title || `Lesson ${lessonNumber}`,
    path: `lessons/U${String(unitNumber).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}`,
    bookPageCount: 0,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads: [],
    bookSections: [],
    resourceCounts: {},
  };
  unit.lessons.push(lesson);
  unit.lessons.sort((left, right) => Number(left.lesson) - Number(right.lesson));
  return lesson;
}

function normalizeManifestCourse(manifest, course) {
  const code = safeSegment(course).toUpperCase();
  return {
    ...manifest,
    course: {
      ...(manifest.course || {}),
      code,
      title: manifest.course?.title || code,
    },
    courseDownloads: manifest.courseDownloads || [],
    units: manifest.units || [],
    texts: manifest.texts || manifest.textMaterials || [],
    textMaterials: manifest.textMaterials || manifest.texts || [],
    sourceAudit: manifest.sourceAudit || {},
  };
}

function manifestCourseCode(manifest) {
  return safeSegment(manifest?.course?.code || manifest?.courseCode || manifest?.code || "").toUpperCase();
}

function manifestCoursePackageSummary(manifest, fileCount) {
  const units = manifest.units || [];
  const lessons = units.flatMap((unit) => unit.lessons || []);
  const downloads = lessons.reduce((sum, lesson) => sum + (lesson.downloads || []).length + (lesson.textExports || []).length + (lesson.bookSections || []).length, 0);
  const ispring = lessons.reduce((sum, lesson) => sum + (lesson.ispring || []).length, 0);
  return {
    total: 1,
    ready: 1,
    needsReview: 0,
    skipped: 0,
    byKind: { "manifest-course-package": 1 },
    units: units.length,
    lessons: lessons.length,
    ispring,
    downloads,
    files: fileCount,
  };
}

function recomputeManifestSummaries(manifest) {
  for (const unit of manifest.units || []) {
    const summary = { downloads: 0, ispring: 0, docx: 0, pdf: 0, video: 0, h5p: 0 };
    for (const lesson of unit.lessons || []) {
      lesson.bookSections = lesson.bookSections || [];
      lesson.downloads = lesson.downloads || [];
      lesson.ispring = lesson.ispring || [];
      lesson.textExports = lesson.textExports || [];
      lesson.bookPageCount = lesson.bookSections.length || lesson.bookPageCount || 0;
      const localResources = [...lesson.downloads, ...lesson.textExports, ...lesson.bookSections];
      lesson.resourceCounts = {
        ...(lesson.resourceCounts || {}),
        downloads: lesson.downloads.length,
        bookSections: lesson.bookSections.length,
        ispring: lesson.ispring.length,
      };
      summary.downloads += localResources.length;
      summary.ispring += lesson.ispring.length;
      for (const item of localResources) {
        const type = String(item.type || "").toLowerCase();
        if (type === "docx") summary.docx += 1;
        if (type === "pdf") summary.pdf += 1;
        if (type === "mp4") summary.video += 1;
        if (type === "h5p") summary.h5p += 1;
      }
    }
    unit.summary = summary;
  }
  manifest.sourceAudit = manifest.sourceAudit || {};
  manifest.sourceAudit.lessonCount = (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons || []).length, 0);
  manifest.sourceAudit.ispringComplete = (manifest.units || []).reduce(
    (sum, unit) => sum + (unit.lessons || []).reduce((lessonSum, lesson) => lessonSum + (lesson.ispring || []).length, 0),
    0,
  );
  manifest.generatedAt = new Date().toISOString();
}

async function findExpandedIspringDirs(files) {
  const dirs = [];
  const seen = new Set();
  for (const file of files) {
    if (basename(file).toLowerCase() !== "presentation.html") continue;
    const dir = dirname(file);
    if (seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }
  return dirs;
}

function classifyCoursePackageFile({ course, manifest, contentRoot, file, ispringDirs }) {
  if (ispringDirs.some((dir) => isInsideDirectory(file, dir))) return null;
  const sourcePath = normalizeImportPath(relative(contentRoot, file));
  const lower = sourcePath.toLowerCase();
  const ext = extname(file).toLowerCase();
  const detected = detectUnitLesson(sourcePath);
  const section = sectionRoleForPath(sourcePath);
  const supported = new Set([".docx", ".doc", ".pdf", ".pptx", ".xlsx", ".txt", ".md", ".html", ".mp4", ".webm", ".h5p", ".zip"]);
  if (!supported.has(ext)) {
    return { kind: "skip", sourcePath, status: "skipped", reason: `Unsupported extension ${ext || "(none)"}.` };
  }
  if (isGeneratedLocalPackageNoteFile(file, ext)) {
    return { kind: "skip", sourcePath, status: "skipped", reason: "Generated local playback note, not Moodle lesson content." };
  }
  if (ext === ".zip") {
    const parsed = parseIspringPackageName(basename(file), course) || detected;
    const lesson = lessonForImport(manifest, parsed.unit, parsed.lesson);
    if (!lesson) return { kind: "ispring-zip", sourcePath, status: "needs-review", reason: "ZIP may be iSpring, but Unit/Lesson could not be matched.", unit: parsed.unit, lesson: parsed.lesson };
    return {
      kind: "ispring-zip",
      sourcePath,
      sourceAbs: file,
      status: "ready",
      unit: parsed.unit,
      lesson: parsed.lesson,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      targetPath: normalizeImportPath(join(lesson.path, "html5-package-admin")),
      label: cleanImportLabel(fileStem(basename(file))) || "iSpring",
    };
  }
  if (/course[-_\s]*(outline|syllabus)|curriculum[-_\s]*outline|syllabus/.test(lower)) {
    const target = normalizeImportPath(join("plans", "course", targetFilename("Course_Outline", file)));
    return { kind: "course-document", role: "course_outline", sourcePath, sourceAbs: file, status: "ready", targetPath: target, label: basename(file) };
  }
  if (/course[-_\s]*(intro|introduction)|\bintroduction\b/.test(lower) && !detected.unit && !detected.lesson) {
    const target = normalizeImportPath(join("plans", "course", targetFilename("Introduction", file)));
    return { kind: "course-document", role: "introduction", sourcePath, sourceAbs: file, status: "ready", targetPath: target, label: basename(file) };
  }
  if (/unit[-_\s]*plan|unit plan|unit-plans|unit plans/.test(lower) && detected.unit && !/lesson[-_\s]*plan|lesson plan/.test(lower)) {
    const target = normalizeImportPath(join("plans", "unit-plans", targetFilename(`U${String(detected.unit).padStart(2, "0")}_Unit_Plan`, file)));
    return { kind: "unit-plan", sourcePath, sourceAbs: file, status: "ready", targetPath: target, unit: detected.unit, label: basename(file) };
  }
  if (/lesson[-_\s]*plan|lesson plan|lesson-plans|lesson plans/.test(lower) && detected.unit && detected.lesson) {
    const lesson = lessonForImport(manifest, detected.unit, detected.lesson) || ensureManifestLesson(manifest, detected.unit, detected.lesson, cleanImportLabel(fileStem(basename(file))));
    const target = normalizeImportPath(join("plans", "lesson-plans", targetFilename(`U${String(detected.unit).padStart(2, "0")}_L${String(detected.lesson).padStart(2, "0")}_Lesson_Plan`, file)));
    return { kind: "lesson-plan", sourcePath, sourceAbs: file, status: "ready", targetPath: target, unit: detected.unit, lesson: detected.lesson, lessonId: lesson.id, lessonTitle: lesson.title, label: basename(file) };
  }
  if (!detected.unit || !detected.lesson) {
    return { kind: "resource", sourcePath, status: "needs-review", reason: "Could not detect Unit/Lesson from path or filename." };
  }
  const lesson = lessonForImport(manifest, detected.unit, detected.lesson) || ensureManifestLesson(manifest, detected.unit, detected.lesson, cleanImportLabel(fileStem(basename(file))));
  const sectionFolder = section.key === "resource" ? "resources" : section.key;
  if ([".html", ".md", ".txt"].includes(ext) && /book|section|lesson[-_\s]*book|expectation|hands[-_\s]*on|consolidation|homework|introduction/.test(lower)) {
    const name = bookSectionImportFilename(section, file);
    return {
      kind: "book-section",
      role: "lesson_book_section",
      sectionLabel: section.label,
      sectionIndex: section.index,
      sourcePath,
      sourceAbs: file,
      status: "ready",
      targetPath: normalizeImportPath(join(lesson.path, "book_sections", name)),
      unit: detected.unit,
      lesson: detected.lesson,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      label: section.label,
    };
  }
  const typeFolder = ext.replace(".", "") || "file";
  const role = [".mp4", ".webm"].includes(ext) ? section.key : ext === ".h5p" ? section.key : section.key === "resource" ? "lesson_resource" : section.key;
  return {
    kind: [".mp4", ".webm"].includes(ext) ? "video" : ext === ".h5p" ? "h5p" : "lesson-resource",
    role,
    sourcePath,
    sourceAbs: file,
    status: "ready",
    targetPath: normalizeImportPath(join(lesson.path, "downloaded_resources", "imported", sectionFolder, typeFolder, safeSegment(basename(file)))),
    unit: detected.unit,
    lesson: detected.lesson,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    label: basename(file),
  };
}

function shouldIgnoreCoursePackagePath(sourcePath) {
  const normalized = normalizeImportPath(sourcePath).toLowerCase();
  return normalized.startsWith("previews-html/") || normalized.includes("/previews-html/");
}

function isGeneratedLocalPackageNoteText(text) {
  const value = String(text || "").slice(0, 4096);
  return (
    /local package/i.test(value) &&
    /local playback url tested/i.test(value) &&
    /current status:/i.test(value) &&
    (/presentation\.html/i.test(value) || /ispring package/i.test(value) || /启动本地播放服务/.test(value))
  );
}

function isGeneratedLocalPackageNoteFile(file, ext = extname(file).toLowerCase()) {
  if (![".md", ".txt"].includes(ext)) return false;
  try {
    return isGeneratedLocalPackageNoteText(readFileSync(file, "utf8"));
  } catch {
    return false;
  }
}

function isGeneratedLocalPackageNoteResource(course, item) {
  if (!course || !item?.path) return false;
  try {
    const root = courseRoot(course);
    const file = ensureInside(root, join(root, toPosixPath(item.path)));
    return isGeneratedLocalPackageNoteFile(file);
  } catch {
    return false;
  }
}

async function pruneGeneratedLocalPackageNotes(course, manifest) {
  let removed = 0;
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      const nextSections = [];
      for (const item of lesson.bookSections || []) {
        if (isGeneratedLocalPackageNoteResource(course, item)) {
          removed += 1;
          try {
            const root = courseRoot(course);
            const file = ensureInside(root, join(root, toPosixPath(item.path)));
            await rm(file, { force: true });
          } catch {
            // Best effort cleanup; the manifest filter still hides stale entries.
          }
          continue;
        }
        nextSections.push(item);
      }
      lesson.bookSections = nextSections;
    }
  }
  return removed;
}

async function clearCourseRootForManifestPackage(course) {
  const root = courseRoot(course);
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "_admin_uploads") continue;
    await rm(join(root, entry.name), { recursive: true, force: true });
  }
}

async function copyManifestPackageContent(contentRoot, targetRoot) {
  const entries = await readdir(contentRoot, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (entry.name === "_admin_uploads") continue;
    const source = join(contentRoot, entry.name);
    const target = ensureInside(targetRoot, join(targetRoot, entry.name));
    await cp(source, target, { recursive: true });
    copied += 1;
  }
  return copied;
}

function bookSectionImportFilename(section, file) {
  const name = safeSegment(basename(file));
  if (/^\d{2}-/.test(name)) return name;
  return `${String(section.index).padStart(2, "0")}-${name}`;
}

async function createCoursePackageReview({ course, sourceZip, originalFilename, importId = coursePackageId() }) {
  const packageDir = coursePackageDir(course, importId);
  const extractRoot = ensureInside(packageDir, join(packageDir, "extract"));
  await rm(extractRoot, { recursive: true, force: true });
  await extractZip(sourceZip, extractRoot);
  const contentRoot = await packageContentRoot(extractRoot);
  const files = (await listPackageFiles(contentRoot)).filter((file) => !shouldIgnoreCoursePackagePath(relative(contentRoot, file)));
  const packageManifest = await readPackageManifest(contentRoot, files);
  if (packageManifest) {
    const selectedCourse = safeSegment(course).toUpperCase();
    const embeddedCourse = manifestCourseCode(packageManifest.manifest);
    if (embeddedCourse && embeddedCourse !== selectedCourse) {
      throw new Error(`Course package is for ${embeddedCourse}, but current course is ${selectedCourse}. Switch the current course before uploading.`);
    }
    const manifest = normalizeManifestCourse(packageManifest.manifest, course);
    const operations = [
      {
        kind: "manifest-course-package",
        sourcePath: normalizeImportPath(relative(contentRoot, packageManifest.manifestPath)),
        sourceAbs: packageManifest.manifestPath,
        status: "ready",
        targetPath: ".",
        label: `${safeSegment(course).toUpperCase()} complete course package`,
        reason: "Package contains course-manifest.json; importing exact course structure.",
      },
    ];
    const review = {
      ok: true,
      mode: "manifest-course-package",
      importId,
      course,
      packageCourse: embeddedCourse || selectedCourse,
      originalFilename,
      uploadedZip: sourceZip,
      packageDir,
      extractRoot,
      contentRoot,
      packageManifestPath: packageManifest.manifestPath,
      generatedAt: new Date().toISOString(),
      operations,
      summary: manifestCoursePackageSummary(manifest, files.length),
    };
    return review;
  }
  const manifest = await readManifestOrEmpty(course);
  const expandedIspringDirs = await findExpandedIspringDirs(files);
  const operations = [];
  const ispringDirOps = [];
  for (const dir of expandedIspringDirs) {
    const sourcePath = normalizeImportPath(relative(contentRoot, dir));
    const detected = detectUnitLesson(sourcePath);
    const lesson = lessonForImport(manifest, detected.unit, detected.lesson) || (detected.unit && detected.lesson ? ensureManifestLesson(manifest, detected.unit, detected.lesson, cleanImportLabel(basename(dir))) : null);
    ispringDirOps.push(
      lesson
        ? {
            kind: "ispring-dir",
            sourcePath,
            sourceAbs: dir,
            status: "ready",
            unit: detected.unit,
            lesson: detected.lesson,
            lessonId: lesson.id,
            lessonTitle: lesson.title,
            targetPath: normalizeImportPath(join(lesson.path, safeSegment(basename(dir)) || "html5-package")),
            label: cleanImportLabel(basename(dir)) || "iSpring",
          }
        : { kind: "ispring-dir", sourcePath, status: "needs-review", reason: "Expanded iSpring folder has presentation.html, but Unit/Lesson could not be matched.", unit: detected.unit, lesson: detected.lesson },
    );
  }
  operations.push(...ispringDirOps);
  for (const file of files) {
    const operation = classifyCoursePackageFile({ course, manifest, contentRoot, file, ispringDirs: expandedIspringDirs });
    if (operation) operations.push(operation);
  }
  const ready = operations.filter((item) => item.status === "ready");
  const review = {
    ok: true,
    importId,
    course,
    originalFilename,
    uploadedZip: sourceZip,
    packageDir,
    extractRoot,
    contentRoot,
    generatedAt: new Date().toISOString(),
    operations,
    summary: {
      total: operations.length,
      ready: ready.length,
      needsReview: operations.filter((item) => item.status === "needs-review").length,
      skipped: operations.filter((item) => item.status === "skipped").length,
      courseDocuments: ready.filter((item) => item.kind === "course-document").length,
      unitPlans: ready.filter((item) => item.kind === "unit-plan").length,
      lessonPlans: ready.filter((item) => item.kind === "lesson-plan").length,
      bookSections: ready.filter((item) => item.kind === "book-section").length,
      ispring: ready.filter((item) => item.kind === "ispring-zip" || item.kind === "ispring-dir").length,
      resources: ready.filter((item) => ["lesson-resource", "video", "h5p"].includes(item.kind)).length,
    },
  };
  writeJsonFile(coursePackageReviewPath(course, importId), review);
  return review;
}

function ispringRecordForPackage(course, packageDir, label) {
  const presentation = join(packageDir, "presentation.html");
  const dataDir = join(packageDir, "data");
  let slideCount = 0;
  let videoSegmentCount = 0;
  try {
    const entries = readdirSyncSafe(dataDir);
    slideCount = entries.filter((name) => /^slide\d+\.js$/i.test(name)).length;
    videoSegmentCount = entries.filter((name) => /^video\d+\.mp4$/i.test(name)).length;
  } catch {
    // Optional iSpring data folder.
  }
  const packagePath = normalizeImportPath(relative(courseRoot(course), packageDir));
  const zipPath = `${packagePath}.zip`;
  return {
    label,
    mode: "page",
    path: normalizeImportPath(relative(courseRoot(course), presentation)),
    packagePath,
    ...(existsSync(join(courseRoot(course), zipPath)) ? { downloadPath: zipPath } : {}),
    slideCount,
    videoSegmentCount,
  };
}

function readdirSyncSafe(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

async function commitManifestCoursePackageImport({ course, importId, actor, review }) {
  const selectedCourse = safeSegment(course).toUpperCase();
  const reviewCourse = safeSegment(review.course || review.packageCourse || "").toUpperCase();
  if (reviewCourse && reviewCourse !== selectedCourse) {
    throw new Error(`This package preview belongs to ${reviewCourse}, not ${selectedCourse}. Switch to ${reviewCourse} or upload a package for ${selectedCourse}.`);
  }
  if (!review.contentRoot || !existsSync(review.contentRoot)) {
    throw new Error("Package content root is missing. Re-upload the course ZIP and generate preview again.");
  }
  const packageManifest = await readPackageManifest(review.contentRoot, await listPackageFiles(review.contentRoot));
  if (!packageManifest) {
    throw new Error("Package course-manifest.json is missing. Re-upload the course ZIP and generate preview again.");
  }

  const root = courseRoot(course);
  let manifest = normalizeManifestCourse(packageManifest.manifest, course);
  await clearCourseRootForManifestPackage(course);
  const copiedTopLevelEntries = await copyManifestPackageContent(review.contentRoot, root);
  const removedGeneratedLocalPackageNotes = await pruneGeneratedLocalPackageNotes(course, manifest);
  recomputeManifestSummaries(manifest);
  writeJsonFile(join(root, "course-manifest.json"), manifest);
  const ecsFirstStorage = await finalizeEcsFirstCourseStorage(course, importId);
  if (ecsFirstStorage) {
    manifest = normalizeManifestCourse(JSON.parse(await readFile(join(root, "course-manifest.json"), "utf8")), course);
  }
  const catalogEntry = await ensureCourseCatalogEntry(course, manifest);
  const lifecycle = setCourseLifecycleStatus(course, "active", actor, "Activated automatically after whole-course ZIP import.");
  let lightweightPreview = null;
  let lightweightPreviewWarning = null;
  try {
    lightweightPreview = await generateLightweightPreviews(course);
  } catch (error) {
    lightweightPreviewWarning = error instanceof Error ? error.message : String(error);
  }
  await appendAdminHistory(course, {
    actor,
    action: "course-package-import",
    mode: "manifest-course-package",
    importId,
    originalFilename: review.originalFilename,
    copiedTopLevelEntries,
    removedGeneratedLocalPackageNotes,
    ecsFirstStorage,
    lifecycleStatus: lifecycle.status,
    lightweightPreview: lightweightPreview?.stdout?.trim() || null,
    lightweightPreviewWarning,
  });

  let cleanup = { removed: false };
  try {
    await rm(coursePackageDir(course, importId), { recursive: true, force: true });
    cleanup = { removed: true };
  } catch (error) {
    cleanup = { removed: false, error: error instanceof Error ? error.message : String(error) };
  }

  return {
    ok: true,
    course,
    importId,
    mode: "manifest-course-package",
    installed: review.operations || [],
    copiedTopLevelEntries,
    removedGeneratedLocalPackageNotes,
    ecsFirstStorage,
    cleanup,
    catalogEntry,
    lifecycle,
    lightweightPreview: lightweightPreview?.stdout?.trim() || null,
    lightweightPreviewWarning,
    manifest: ecsFirstStorage ? "manifest restored and finalized for hybrid ECS/OSS storage" : "manifest restored from course package",
  };
}

async function commitCoursePackageImport({ course, importId, actor }) {
  const review = JSON.parse(await readFile(coursePackageReviewPath(course, importId), "utf8"));
  if (review.mode === "manifest-course-package") {
    return commitManifestCoursePackageImport({ course, importId, actor, review });
  }
  const manifest = await readManifestOrEmpty(course);
  const backups = [];
  const installed = [];
  await mkdir(courseRoot(course), { recursive: true });
  for (const op of review.operations || []) {
    if (op.status !== "ready") continue;
    const root = courseRoot(course);
    const lesson = op.unit && op.lesson ? ensureManifestLesson(manifest, op.unit, op.lesson, op.lessonTitle) : null;
    if (op.kind === "ispring-zip") {
      if (!lesson) continue;
      const result = await installIspringPackage({
        course,
        sourceZip: op.sourceAbs,
        lessonDir: ensureInside(root, join(root, lesson.path)),
        label: op.label,
      });
      if (result.backupPath) backups.push(result.backupPath);
      const record = ispringRecordForPackage(course, result.packageDir, op.label || "iSpring");
      upsertResource(lesson.ispring, record);
      installed.push({ ...op, installedPath: record.path });
      continue;
    }
    if (op.kind === "ispring-dir") {
      if (!lesson) continue;
      const target = ensureInside(root, join(root, op.targetPath));
      const backup = await backupExistingPath(course, target);
      if (backup) backups.push(backup);
      await rm(target, { recursive: true, force: true });
      await mkdir(dirname(target), { recursive: true });
      await cp(op.sourceAbs, target, { recursive: true });
      const record = ispringRecordForPackage(course, target, op.label || "iSpring");
      upsertResource(lesson.ispring, record);
      installed.push({ ...op, installedPath: record.path });
      continue;
    }
    const target = ensureInside(root, join(root, op.targetPath));
    const backup = await backupExistingPath(course, target);
    if (backup) backups.push(backup);
    await mkdir(dirname(target), { recursive: true });
    await cp(op.sourceAbs, target);
    const bytes = (await stat(target)).size;
    const type = extname(target).toLowerCase().replace(".", "") || "file";
    if (op.kind === "course-document") {
      manifest.courseDownloads = manifest.courseDownloads || [];
      upsertResource(manifest.courseDownloads, {
        label: op.label,
        type,
        category: "course_document",
        role: op.role,
        path: op.targetPath,
        bytes,
      });
    } else if (op.kind === "unit-plan") {
      const unit = ensureManifestUnit(manifest, op.unit);
      unit.unitPlan = { label: op.label, type, category: "teacher_plan", role: "plan", path: op.targetPath, bytes };
    } else if (op.kind === "lesson-plan") {
      if (lesson) lesson.lessonPlan = { label: op.label, type, category: "teacher_plan", role: "plan", path: op.targetPath, bytes };
    } else if (op.kind === "book-section") {
      if (!lesson) continue;
      lesson.bookSections = lesson.bookSections || [];
      upsertResource(lesson.bookSections, {
        label: op.label,
        type,
        category: "lesson_book_section",
        role: "lesson_book_section",
        sectionLabel: op.sectionLabel,
        sectionIndex: op.sectionIndex,
        path: op.targetPath,
        bytes,
      });
    } else if (lesson) {
      lesson.downloads = lesson.downloads || [];
      upsertResource(lesson.downloads, {
        label: op.label,
        type,
        category: op.kind === "video" ? "video" : op.kind === "h5p" ? "h5p" : "teacher_resource",
        role: op.role || "lesson_resource",
        path: op.targetPath,
        bytes,
      });
    }
    installed.push({ ...op, installedPath: op.targetPath });
  }
  const removedGeneratedLocalPackageNotes = await pruneGeneratedLocalPackageNotes(course, manifest);
  recomputeManifestSummaries(manifest);
  writeJsonFile(join(courseRoot(course), "course-manifest.json"), manifest);
  const ecsFirstStorage = await finalizeEcsFirstCourseStorage(course, importId);
  const finalManifest = ecsFirstStorage
    ? normalizeManifestCourse(JSON.parse(await readFile(join(courseRoot(course), "course-manifest.json"), "utf8")), course)
    : manifest;
  const catalogEntry = await ensureCourseCatalogEntry(course, finalManifest);
  const lifecycle = setCourseLifecycleStatus(course, "active", actor, "Activated automatically after whole-course ZIP import.");
  let lightweightPreview = null;
  let lightweightPreviewWarning = null;
  try {
    lightweightPreview = await generateLightweightPreviews(course);
  } catch (error) {
    lightweightPreviewWarning = error instanceof Error ? error.message : String(error);
  }
  await appendAdminHistory(course, {
    actor,
    action: "course-package-import",
    importId,
    originalFilename: review.originalFilename,
    installedCount: installed.length,
    removedGeneratedLocalPackageNotes,
    ecsFirstStorage,
    backups,
    lifecycleStatus: lifecycle.status,
    lightweightPreview: lightweightPreview?.stdout?.trim() || null,
    lightweightPreviewWarning,
  });
  let cleanup = { removed: false };
  try {
    await rm(coursePackageDir(course, importId), { recursive: true, force: true });
    cleanup = { removed: true };
  } catch (error) {
    cleanup = { removed: false, error: error instanceof Error ? error.message : String(error) };
  }
  return {
    ok: true,
    course,
    importId,
    installed,
    backups,
    cleanup,
    catalogEntry,
    lifecycle,
    removedGeneratedLocalPackageNotes,
    ecsFirstStorage,
    lightweightPreview: lightweightPreview?.stdout?.trim() || null,
    lightweightPreviewWarning,
    manifest: ecsFirstStorage ? "manifest updated and finalized for hybrid ECS/OSS storage" : "manifest updated directly from course package import",
  };
}

async function handleAdminApi(req, res) {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (!requestUrl.pathname.startsWith("/api/admin/")) return false;

  if (!adminUploadsEnabled) {
    sendJson(res, 503, { ok: false, error: "Admin uploads are disabled. Set ADMIN_UPLOADS_ENABLED=1 to enable." });
    return true;
  }

  try {
    if (requestUrl.pathname === "/api/admin/session" && req.method === "GET") {
      const principal = adminPrincipal(req);
      sendJson(res, 200, {
        ok: true,
        authenticated: Boolean(principal),
        loginEnabled: adminLoginConfigured(),
        username: principal?.username || null,
        displayName: principal?.displayName || null,
        role: principal?.role || null,
        authSource: principal?.source || null,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/login" && req.method === "POST") {
      if (!adminLoginConfigured()) {
        sendJson(res, 500, { ok: false, error: "Admin login is not configured. Set ADMIN_USERNAME/ADMIN_PASSWORD or create a portal admin user." });
        return true;
      }
      const body = await readJsonBody(req);
      const rateKeys = loginRateKeys(req, "admin", body.username);
      const rateLimit = loginRateLimitStatus(rateKeys);
      if (rateLimit) {
        sendRateLimitJson(res, rateLimit.retryAfterSeconds);
        return true;
      }
      const legacyUsernameOk = loginConfigured() && timingSafeStringEqual(body.username || "", adminUsername);
      const legacyPasswordOk = loginConfigured() && timingSafeStringEqual(body.password || "", adminPassword);
      if (legacyUsernameOk && legacyPasswordOk) {
        clearLoginFailures(rateKeys);
        setSessionCookie(res, adminUsername);
        sendJson(res, 200, { ok: true, username: adminUsername, displayName: adminUsername, role: "admin", authSource: "admin" });
        return true;
      }

      const portalUser = portalLoginConfigured() ? getPortalUsers().find((item) => timingSafeStringEqual(item.username, body.username || "")) : null;
      const portalPasswordOk = portalUser && portalUser.status !== "disabled" ? verifyPortalPassword(portalUser, body.password || "") : false;
      if (portalPasswordOk && hasAllCourseAccess(portalUser)) {
        clearLoginFailures(rateKeys);
        setPortalSessionCookie(res, portalUser);
        sendJson(res, 200, {
          ok: true,
          username: portalUser.username,
          displayName: portalUser.displayName || "",
          role: portalUser.role,
          courses: portalUser.courses,
          authSource: "portal",
        });
        return true;
      }

      if (portalPasswordOk && !hasAllCourseAccess(portalUser)) {
        recordLoginFailure(rateKeys);
        sendJson(res, 403, { ok: false, error: "This account is not allowed to use the admin backend." });
        return true;
      }

      recordLoginFailure(rateKeys);
      sendJson(res, 401, { ok: false, error: "Invalid username or password." });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/logout" && req.method === "POST") {
      clearSessionCookie(res);
      clearPortalSessionCookieAppend(res);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const ossExtractCallbackMatch = /^\/api\/admin\/oss\/uploads\/([^/]+)\/extracted$/.exec(requestUrl.pathname);
    if (ossExtractCallbackMatch && req.method === "POST" && coursePackageImportMode === "ecs-first") {
      sendJson(res, 410, { ok: false, error: "历史课程包回调接口已停用。请使用课程压缩包入口上传导入。" });
      return true;
    }
    if (ossExtractCallbackMatch && req.method === "POST" && isOssExtractCallbackAuthorized(req)) {
      const uploadId = safeSegment(ossExtractCallbackMatch[1]);
      const record = ossUploadStore.readRecord(uploadId);
      if (!record) {
        sendJson(res, 404, { ok: false, error: "OSS upload record not found." });
        return true;
      }
      const body = await readJsonBody(req, 256 * 1024);
      const result = await markOssCoursePackageExtracted({
        record,
        actor: "oss-extractor",
        body,
      });
      sendJson(res, result.job ? 202 : 200, {
        ok: true,
        upload: ossUploadStore.publicRecord(result.upload),
        job: result.job,
        warning: result.warning,
      });
      return true;
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized. Please login first." });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/media/config" && req.method === "GET") {
      ensureMediaJobsLoaded();
      sendJson(res, 200, {
        ok: true,
        config: mediaConfig(),
        jobs: {
          running: [...mediaJobs.values()].filter((job) => activeMediaJobStatuses.has(job.status)).map(publicMediaJob),
        },
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/oss/uploads" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        config: directUploadPublicConfig(),
        uploads: ossUploadStore.listRecords({
          course: requestUrl.searchParams.get("course") || "",
          limit: Number(requestUrl.searchParams.get("limit") || 50),
        }).map(ossUploadStore.publicRecord),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/oss/uploads/init" && req.method === "POST") {
      const body = await readJsonBody(req, 64 * 1024);
      const { record, form, multipart } = await createDirectUploadPolicy({
        course: body.course,
        fileName: body.fileName,
        fileSize: body.fileSize,
        contentType: body.contentType,
        kind: body.kind,
        actor: adminActor(req),
      });
      sendJson(res, 200, {
        ok: true,
        config: directUploadPublicConfig(),
        upload: ossUploadStore.publicRecord(record),
        form,
        multipart,
      });
      return true;
    }

    const ossUploadMatch = /^\/api\/admin\/oss\/uploads\/([^/]+)(?:\/([^/]+))?$/.exec(requestUrl.pathname);
    if (ossUploadMatch) {
      const uploadId = safeSegment(ossUploadMatch[1]);
      const action = ossUploadMatch[2] || "";
      const record = ossUploadStore.readRecord(uploadId);
      if (!record) {
        sendJson(res, 404, { ok: false, error: "OSS upload record not found." });
        return true;
      }
      if (!action && req.method === "GET") {
        sendJson(res, 200, { ok: true, upload: ossUploadStore.publicRecord(record) });
        return true;
      }
      if (action === "parts" && req.method === "GET") {
        if (record.uploadMode !== "multipart") {
          sendJson(res, 200, {
            ok: true,
            upload: ossUploadStore.publicRecord(record),
            multipart: {
              uploadedBytes: 0,
              uploadedParts: [],
              uploadedPartCount: 0,
              partCount: Number(record.multipartPartCount || 0),
            },
          });
          return true;
        }
        const uploadedParts = await listDirectMultipartUploadedParts({
          config: ossDirectUploadConfig,
          record,
        });
        const uploadedBytes = uploadedParts.reduce((sum, part) => sum + Math.max(0, Number(part.size || 0)), 0);
        sendJson(res, 200, {
          ok: true,
          upload: ossUploadStore.publicRecord(record),
          multipart: {
            uploadedBytes,
            uploadedParts,
            uploadedPartCount: uploadedParts.length,
            partCount: Number(record.multipartPartCount || 0),
          },
        });
        return true;
      }
      if (action === "complete" && req.method === "POST") {
        if (!isRawCoursePackageUploadKind(record.kind)) {
          throw new Error("这个直传记录来自已停用的历史入口，不能继续完成或发布。请通过课程压缩包入口重新上传课程 ZIP。");
        }
        const body = await readJsonBody(req, 64 * 1024);
        if (body.objectKey && body.objectKey !== record.objectKey) throw new Error("Completed object key does not match this upload.");
        if (record.uploadMode === "multipart") {
          await completeDirectMultipartUpload({
            config: ossDirectUploadConfig,
            record,
            parts: body.parts,
          });
          record.multipartCompletedAt = new Date().toISOString();
          record.multipartPartEtags = Array.isArray(body.parts) ? body.parts : [];
        }
        const parsed = verifyOssObjectWithOssutil(record.ossUri);
        const expectedBytes = Number(record.fileSize || 0);
        if (expectedBytes > 0 && parsed.totalBytes !== expectedBytes) {
          throw new Error(`OSS object size mismatch after upload: expected ${expectedBytes} bytes, got ${parsed.totalBytes} bytes. Please retry the upload; the raw ZIP object is incomplete.`);
        }
        record.status = "uploaded";
        record.completedAt = new Date().toISOString();
        record.completedBy = adminActor(req);
        record.verified = {
          at: record.completedAt,
          objectCount: parsed.objectCount,
          totalBytes: parsed.totalBytes,
        };
        let job = null;
        let warning = "";
        const wantsAutoPublish = body.autoPublish === true || body.autoPublish === "1";
        let coursePackageTask = null;
        if (wantsAutoPublish && isCoursePackageUploadKind(record.kind)) {
          ossUploadStore.writeRecord(record);
          if (isRawCoursePackageUploadKind(record.kind)) {
            record.status = "importing";
            record.importId = record.id;
            record.importStatus = "oss-raw-queued";
            record.importMode = "hybrid-raw";
            ossUploadStore.writeRecord(record);
            coursePackageTask = startOssCoursePackageImport({
              record: { ...record },
              actor: adminActor(req),
              autoCommit: true,
            });
            warning = "完整课件包已保存为 OSS raw package，ECS worker 会从 OSS 内网流式读取并自动分流；不使用 FC 解压。";
          } else {
            throw new Error("完整课件包已切换为 ECS worker 导入：历史 OSS course-package 记录不能继续发布。请使用课程压缩包入口触发 raw package 上传。");
          }
          sendJson(res, 200, {
            ok: true,
            upload: ossUploadStore.publicRecord(ossUploadStore.readRecord(record.id) || record),
            coursePackageTask,
            job: null,
            warning,
          });
          return true;
        }
        if (wantsAutoPublish && directUploadKindCanAutoPublish(record.kind)) {
          job = createMediaJob({
            type: "publish-upload",
            course: record.course,
            actor: adminActor(req),
            params: { uploadId: record.id },
          });
          record.status = "queued";
          record.jobId = job.id;
        } else if (wantsAutoPublish) {
          warning = "历史 OSS 直传媒体发布入口已停用；媒体/H5P/iSpring 请通过课程压缩包导入或媒体发布任务处理。";
        }
        ossUploadStore.writeRecord(record);
        sendJson(res, 200, { ok: true, upload: ossUploadStore.publicRecord(record), job, warning });
        return true;
      }
      if (action === "extracted" && req.method === "POST") {
        const body = await readJsonBody(req, 256 * 1024);
        const result = await markOssCoursePackageExtracted({
          record,
          actor: adminActor(req),
          body,
        });
        sendJson(res, result.job ? 202 : 200, {
          ok: true,
          upload: ossUploadStore.publicRecord(result.upload),
          job: result.job,
          warning: result.warning,
        });
        return true;
      }
    }

    if (requestUrl.pathname === "/api/admin/media/courses" && req.method === "GET") {
      sendJson(res, 200, await mediaCoursesStatus({ refreshOss: requestUrl.searchParams.get("refreshOss") === "1" }));
      return true;
    }

    if (requestUrl.pathname === "/api/admin/media/jobs" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        config: mediaConfig(),
        jobs: listMediaJobs({
          status: requestUrl.searchParams.get("status") || "",
          course: requestUrl.searchParams.get("course") || "",
          limit: Number(requestUrl.searchParams.get("limit") || 50),
        }),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/media/jobs" && req.method === "POST") {
      const body = await readJsonBody(req, 64 * 1024);
      const job = createMediaJob({
        type: body.type,
        course: body.course,
        actor: adminActor(req),
        params: body,
      });
      sendJson(res, 202, { ok: true, job });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/media/locks" && req.method === "GET") {
      sendJson(res, 200, { ok: true, locks: mediaLockStatus() });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/media/locks/clear-stale" && req.method === "POST") {
      sendJson(res, 200, { ok: true, ...clearAllStaleCourseOperationLocks() });
      return true;
    }

    const mediaLockMatch = /^\/api\/admin\/media\/locks\/([^/]+)\/clear$/.exec(requestUrl.pathname);
    if (mediaLockMatch && req.method === "POST") {
      const removed = clearStaleCourseOperationLock(mediaLockMatch[1]);
      sendJson(res, 200, { ok: true, removed, locks: mediaLockStatus() });
      return true;
    }

    const mediaJobMatch = /^\/api\/admin\/media\/jobs\/([^/]+)(?:\/([^/]+))?$/.exec(requestUrl.pathname);
    if (mediaJobMatch) {
      const jobId = mediaJobMatch[1];
      const action = mediaJobMatch[2] || "";
      ensureMediaJobsLoaded();
      if (!action && req.method === "GET") {
        const job = mediaJobs.get(safeSegment(jobId));
        sendJson(res, job ? 200 : 404, job ? { ok: true, job: publicMediaJob(job) } : { ok: false, error: "Media job not found." });
        return true;
      }
      if (action === "log" && req.method === "GET") {
        const stream = requestUrl.searchParams.get("stream") === "stderr" ? "stderr" : "stdout";
        sendJson(res, 200, {
          ok: true,
          id: safeSegment(jobId),
          stream,
          text: mediaJobLog(jobId, stream, requestUrl.searchParams.get("tail") || 200),
        });
        return true;
      }
      if (action === "cancel" && req.method === "POST") {
        sendJson(res, 200, { ok: true, job: cancelMediaJob(jobId) });
        return true;
      }
      if (action === "retry" && req.method === "POST") {
        sendJson(res, 202, { ok: true, job: retryMediaJob(jobId, adminActor(req)) });
        return true;
      }
    }

    if (requestUrl.pathname === "/api/admin/readiness" && req.method === "GET") {
      const catalog = await readCourseCatalog();
      const courses = await Promise.all(visibleCatalogCourses(catalog).map((courseEntry) => courseReadinessRecord(courseEntry)));
      const uploadedCourses = courses.filter((courseEntry) => courseEntry.uploaded);
      const completedCourses = courses.filter((courseEntry) => courseEntry.completed);
      sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        courseCount: courses.length,
        courses,
        summary: {
          uploadedCourses: uploadedCourses.length,
          completedCourses: completedCourses.length,
          displayableCourses: completedCourses.length,
          displayGapCourses: courses.length - completedCourses.length,
          nonDisplayableUploadedCourses: uploadedCourses.filter((courseEntry) => !courseEntry.completed).length,
          missingManifestCourses: courses.filter((courseEntry) => !courseEntry.uploaded).length,
          missingCourseOutlines: uploadedCourses.filter((courseEntry) => !courseEntry.readiness.courseOutline.ok).length,
          missingIntroductions: uploadedCourses.filter((courseEntry) => !courseEntry.readiness.introduction.ok).length,
          unitPlanGapCourses: uploadedCourses.filter((courseEntry) => courseEntry.readiness.unitPlans.missing.length).length,
          lessonPlanGapCourses: uploadedCourses.filter((courseEntry) => courseEntry.readiness.lessonPlans.missing.length).length,
          ispringMissingCourses: uploadedCourses.filter((courseEntry) => !courseEntry.readiness.ispring.connected).length,
          textReviewCourses: uploadedCourses.filter((courseEntry) => courseEntry.readiness.texts.needsReview.length).length,
        },
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/storage" && req.method === "GET") {
      const summaryOnly = ["1", "true", "yes"].includes(String(requestUrl.searchParams.get("summary") || "").toLowerCase());
      const refresh = ["1", "true", "yes"].includes(String(requestUrl.searchParams.get("refresh") || "").toLowerCase());
      sendJson(res, 200, await storageOverview({ summaryOnly, refresh }));
      return true;
    }

    if (requestUrl.pathname === "/api/admin/storage/rebuild" && req.method === "POST") {
      sendJson(res, 200, await storageOverview({ summaryOnly: false, refresh: true }));
      return true;
    }

    if (requestUrl.pathname === "/api/admin/upload-gaps" && req.method === "GET") {
      const catalog = await readCourseCatalog();
      const courses = await Promise.all(visibleCatalogCourses(catalog).map((courseEntry) => courseUploadGapRecord(courseEntry)));
      const uploadItems = courses.flatMap((courseEntry) => courseEntry.uploadItems);
      const reviewItems = courses.flatMap((courseEntry) => courseEntry.reviewItems);
      const externalItems = courses.flatMap((courseEntry) => courseEntry.externalItems);
      sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        courseCount: courses.length,
        courses,
        summary: {
          uploadedCourses: courses.filter((courseEntry) => courseEntry.uploaded).length,
          missingManifestCourses: courses.filter((courseEntry) => !courseEntry.uploaded).length,
          directUploads: uploadItems.length,
          textReviews: reviewItems.length,
          externalDecisions: externalItems.length,
        },
        uploadItems,
        reviewItems,
        externalItems,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/moodle-embeds" && req.method === "GET") {
      const requestedCourse = safeSegment(requestUrl.searchParams.get("course") || "ENG3U").toUpperCase();
      const manifest = await readManifest(requestedCourse);
      const rows = moodleEmbedRowsForCourse(req, requestedCourse, manifest);
      sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        course: requestedCourse,
        publicOrigin: publicOrigin(req),
        tokenMaxAgeSeconds: embedTokenMaxAgeSeconds,
        rows,
        summary: {
          total: rows.length,
          ispring: rows.filter((row) => row.kind === "ispring").length,
          video: rows.filter((row) => row.kind === "video").length,
          h5p: rows.filter((row) => row.kind === "h5p").length,
          h5pNeedsRuntime: rows.filter((row) => row.status === "needs-h5p-runtime").length,
        },
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/content-workbench" && req.method === "GET") {
      let refresh = null;
      try {
        refresh = await generateContentWorkbench();
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        refresh: refresh.stdout.trim(),
        ...(await readContentWorkbench()),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/users" && req.method === "GET") {
      const users = ensurePortalUsersFile();
      sendJson(res, 200, {
        ok: true,
        users: users.map(publicPortalUser),
        courses: await availablePortalCourses(),
        usersFile: portalUsersPath,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/users" && req.method === "POST") {
      const body = await readJsonBody(req, 64 * 1024);
      await withOperationLock("portal-users", async () => {
        const users = ensurePortalUsersFile();
        const user = upsertPortalUser(users, body);
        const saved = savePortalUsers(users);
        await appendAdminHistory(body.course || "ENG3U", {
          actor: adminActor(req),
          action: "portal-user-upsert",
          username: user.username,
          displayName: user.displayName || "",
          role: user.role,
          courses: user.courses,
          status: user.status,
        });
        sendJson(res, 200, {
          ok: true,
          user: publicPortalUser(user),
          users: saved.map(publicPortalUser),
          courses: await availablePortalCourses(),
          usersFile: portalUsersPath,
        });
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/users" && req.method === "DELETE") {
      const username = requestUrl.searchParams.get("username");
      await withOperationLock("portal-users", async () => {
        const users = ensurePortalUsersFile();
        const saved = savePortalUsers(removePortalUser(users, username));
        await appendAdminHistory(requestUrl.searchParams.get("course") || "ENG3U", {
          actor: adminActor(req),
          action: "portal-user-delete",
          username,
        });
        sendJson(res, 200, {
          ok: true,
          users: saved.map(publicPortalUser),
          courses: await availablePortalCourses(),
          usersFile: portalUsersPath,
        });
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-status" && req.method === "GET") {
      const catalog = await readCourseCatalog();
      const store = readCourseStatusStore();
      const courses = visibleCatalogCourses(catalog).map((courseEntry) => ({
        code: courseEntry.code,
        title: courseEntry.title,
        catalogStatus: courseEntry.status,
        level: courseEntry.level,
        ...courseLifecycleRecord(courseEntry.code),
      }));
      sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        statusFile: courseStatusPath,
        updatedAt: store.updatedAt,
        courses,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-status" && req.method === "POST") {
      const body = await readJsonBody(req, 64 * 1024);
      const actor = adminActor(req);
      await withOperationLock("course-status", async () => {
        const record = setCourseLifecycleStatus(body.course, body.status, actor, body.note);
        await appendAdminHistory(record.course, {
          actor,
          action: "course-lifecycle-status",
          status: record.status,
          note: record.note,
        });
        sendJson(res, 200, {
          ok: true,
          statusFile: courseStatusPath,
          course: record,
        });
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-status/launch-allowlist" && req.method === "POST") {
      const body = await readJsonBody(req, 64 * 1024);
      const actor = adminActor(req);
      const courses = Array.isArray(body.courses)
        ? body.courses
        : String(body.courses || "")
            .split(",")
            .map((course) => course.trim())
            .filter(Boolean);
      await withOperationLock("course-status", async () => {
        const result = await setLaunchCourseAllowlist(courses, actor, body.note);
        for (const course of result.launchCourses) {
          await appendAdminHistory(course, {
            actor,
            action: "launch-course-allowlist",
            launchCourses: result.launchCourses,
            activeCourseCount: result.activeCourseCount,
            archivedCourseCount: result.archivedCourseCount,
          });
        }
        sendJson(res, 200, {
          ok: true,
          statusFile: courseStatusPath,
          ...result,
        });
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-lifecycle-jobs" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        activeRoot: courseActiveRoot,
        archiveRoot: courseArchiveRoot,
        jobs: listLifecycleJobs(),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-lifecycle-jobs" && req.method === "POST") {
      const body = await readJsonBody(req, 64 * 1024);
      const actor = adminActor(req);
      const requestedCourse = safeSegment(body.course || "").toUpperCase();
      await withOperationLock(`course:${requestedCourse}:lifecycle`, async () => {
        const job = startCourseLifecycleJob({
          action: body.action,
          course: body.course,
          actor,
          deleteActive: Boolean(body.deleteActive),
          force: Boolean(body.force),
          setArchived: Boolean(body.setArchived),
        });
        await appendAdminHistory(job.course, {
          actor,
          action: "course-lifecycle-job-start",
          jobId: job.id,
          jobAction: job.action,
          deleteActive: job.deleteActive,
          force: job.force,
          setArchived: job.setArchived,
        });
        sendJson(res, 202, {
          ok: true,
          activeRoot: courseActiveRoot,
          archiveRoot: courseArchiveRoot,
          job,
        });
      });
      return true;
    }

    const course = (requestUrl.searchParams.get("course") || "ENG3U").toUpperCase();
    if (requestUrl.pathname === "/api/admin/status" && req.method === "GET") {
      const { manifest, manifestStatus, manifestError } = await readManifestForAdminStatus(course);
      const lessons = (manifest.units || []).flatMap((unit) => unit.lessons || []);
      const readiness = manifestReadiness(manifest);
      const root = courseRoot(course);
      const adminRoot = join(root, "_admin_uploads");
      const disk = await diskInfoFor(root);
      sendJson(res, 200, {
        ok: true,
        course,
        lifecycle: courseLifecycleRecord(course),
        uploaded: manifestStatus === "ready",
        manifestStatus,
        manifestError,
        units: manifest.units?.length || 0,
        lessons: lessons.length,
        courseDownloads: manifest.courseDownloads?.length || 0,
        unitPlans: (manifest.units || []).filter((unit) => unit.unitPlan).length,
        lessonPlans: lessons.filter((lesson) => lesson.lessonPlan).length,
        ispring: lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0),
        downloads: lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0),
        readiness,
        storage: {
          coursewareBytes: await directorySize(root),
          adminUploadBytes: await directorySize(adminRoot),
          disk,
        },
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/history" && req.method === "GET") {
      const limit = Math.min(Number(requestUrl.searchParams.get("limit") || 30), 100);
      sendJson(res, 200, {
        ok: true,
        course,
        history: await readAdminHistory(course, limit),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/backups" && req.method === "GET") {
      const limit = Math.min(Number(requestUrl.searchParams.get("limit") || 30), 100);
      const backups = await listAdminBackups(course, limit);
      sendJson(res, 200, {
        ok: true,
        course,
        backups,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/cleanup" && req.method === "POST") {
      const mode = requestUrl.searchParams.get("mode") || "temp";
      if (!["temp", "extracted", "zips", "all"].includes(mode)) {
        sendJson(res, 400, { ok: false, error: "Unsupported cleanup mode." });
        return true;
      }
      await withOperationLock(`course:${course}:write`, async () => {
        const cleanup = await cleanupAdminUploads(course, mode);
        await appendAdminHistory(course, {
          actor: adminActor(req),
          action: "cleanup",
          mode,
          removedBytes: cleanup.removedBytes,
          removed: cleanup.removed,
        });
        sendJson(res, 200, {
          ok: true,
          course,
          mode,
          removedBytes: cleanup.removedBytes,
          removed: cleanup.removed,
        });
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/generate-previews" && req.method === "POST") {
      await withOperationLock(`course:${course}:write`, async () => {
        let preview = null;
        let previewWarning = null;
        try {
          preview = await generateDocumentPreviews(course);
        } catch (error) {
          previewWarning = error instanceof Error ? error.message : String(error);
        }
        await appendAdminHistory(course, {
          actor: adminActor(req),
          action: "generate-previews",
          preview: preview?.stdout?.trim() || null,
          previewWarning,
        });
        sendJson(res, 200, {
          ok: !previewWarning,
          course,
          preview: preview?.stdout?.trim() || null,
          previewWarning,
        });
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-package/upload" && req.method === "POST") {
      const contentLength = Number(req.headers["content-length"] || 0);
      if (!contentLength) throw new Error("Missing Content-Length header.");
      if (contentLength > maxCoursePackageUploadBytes) {
        throw new Error(`Course package is too large. Max is ${Math.round(maxCoursePackageUploadBytes / 1024 / 1024)} MB.`);
      }
      const originalFilename = requestUrl.searchParams.get("filename") || "course-package.zip";
      if (extname(originalFilename).toLowerCase() !== ".zip") throw new Error("Course package upload must be a .zip file.");
      const importId = safeSegment(requestUrl.searchParams.get("importId") || coursePackageId());
      let capacity = null;
      try {
        capacity = await assertCoursePackageEcsCapacity(contentLength);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeCoursePackageTask(course, importId, {
          status: "blocked",
          phase: "ecs-space-insufficient",
          filename: originalFilename,
          totalBytes: contentLength,
          percent: 0,
          rawUploadRequired: true,
          error: message,
        });
        throw error;
      }
      const packageDir = coursePackageDir(course, importId);
      const sourceZip = ensureInside(packageDir, join(packageDir, safeSegment(originalFilename)));
      await mkdir(dirname(sourceZip), { recursive: true });
      writeCoursePackageTask(course, importId, {
        status: "uploading",
        phase: "uploading",
        filename: originalFilename,
        bytesReceived: 0,
        totalBytes: contentLength,
        capacity,
        percent: 0,
        startedAt: new Date().toISOString(),
      });
      try {
        await writeRequestToFileWithProgress(req, sourceZip, { course, importId, contentLength });
        const review = await createCoursePackageReview({ course, sourceZip, originalFilename, importId });
        const uploadedZipRemoved = await removeFileIfExists(sourceZip);
        review.uploadedZipRemoved = uploadedZipRemoved;
        review.uploadedZipRemovedAt = uploadedZipRemoved ? new Date().toISOString() : null;
        writeJsonFile(coursePackageReviewPath(course, importId), review);
        writeCoursePackageTask(course, importId, {
          status: "complete",
          phase: "ready",
          percent: 100,
          summary: review.summary,
          review,
        });
        await appendAdminHistory(course, {
          actor: adminActor(req),
          action: "course-package-upload-preview",
          importId: review.importId,
          filename: originalFilename,
          bytes: contentLength,
          summary: review.summary,
        });
        sendJson(res, 200, review);
      } catch (error) {
        if (readCoursePackageTask(course, importId)?.status !== "blocked") {
          writeCoursePackageTask(course, importId, {
            status: "failed",
            phase: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-package/chunk" && req.method === "POST") {
      const contentLength = Number(req.headers["content-length"] || 0);
      if (!contentLength) throw new Error("Missing Content-Length header.");
      const originalFilename = requestUrl.searchParams.get("filename") || "course-package.zip";
      if (extname(originalFilename).toLowerCase() !== ".zip") throw new Error("Course package upload must be a .zip file.");
      const importId = safeSegment(requestUrl.searchParams.get("importId") || "");
      if (!importId) throw new Error("Missing importId.");
      const chunkIndex = Number(requestUrl.searchParams.get("chunkIndex"));
      const chunkTotal = Number(requestUrl.searchParams.get("chunkTotal"));
      const totalBytes = Number(requestUrl.searchParams.get("totalBytes") || 0);
      if (!Number.isInteger(chunkIndex) || !Number.isInteger(chunkTotal) || chunkIndex < 0 || chunkTotal < 1 || chunkIndex >= chunkTotal) {
        throw new Error("Invalid chunk index.");
      }
      if (totalBytes > maxCoursePackageUploadBytes) {
        throw new Error(`Course package is too large. Max is ${Math.round(maxCoursePackageUploadBytes / 1024 / 1024)} MB.`);
      }
      let capacity = null;
      try {
        capacity = await assertCoursePackageEcsCapacity(totalBytes || contentLength);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeCoursePackageTask(course, importId, {
          status: "blocked",
          phase: "ecs-space-insufficient",
          filename: originalFilename,
          totalBytes,
          chunkTotal,
          percent: 0,
          rawUploadRequired: true,
          error: message,
        });
        throw error;
      }

      await mkdir(coursePackageChunkDir(course, importId), { recursive: true });
      writeCoursePackageTask(course, importId, {
        status: "uploading",
        phase: "chunk-uploading",
        filename: originalFilename,
        totalBytes,
        chunkTotal,
        capacity,
        startedAt: readCoursePackageTask(course, importId)?.startedAt || new Date().toISOString(),
      });
      const chunkPath = coursePackageChunkPath(course, importId, chunkIndex);
      try {
        await pipeline(req, createWriteStream(chunkPath));
        const progress = await coursePackageChunkProgress(course, importId, chunkTotal);
        writeCoursePackageTask(course, importId, {
          status: progress.complete ? "processing" : "uploading",
          phase: progress.complete ? "merging" : "chunk-uploading",
          filename: originalFilename,
          totalBytes,
          bytesReceived: progress.bytesReceived,
          chunkTotal,
          chunksReceived: progress.chunksReceived,
          percent: totalBytes ? Math.min(99, Math.round((progress.bytesReceived / totalBytes) * 100)) : null,
        });
        if (!progress.complete) {
          sendJson(res, 200, {
            ok: true,
            complete: false,
            course,
            importId,
            filename: originalFilename,
            ...progress,
            totalBytes,
            percent: totalBytes ? Math.min(99, Math.round((progress.bytesReceived / totalBytes) * 100)) : null,
          });
          return true;
        }

        const task = startCoursePackageFinalize({
          course,
          importId,
          actor: adminActor(req),
        });
        sendJson(res, 202, {
          ok: true,
          complete: true,
          processing: true,
          task,
          course,
          importId,
          filename: originalFilename,
        });
      } catch (error) {
        if (readCoursePackageTask(course, importId)?.status !== "blocked") {
          writeCoursePackageTask(course, importId, {
            status: "failed",
            phase: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-package/status" && req.method === "GET") {
      const requestedCourse = safeSegment(requestUrl.searchParams.get("course") || course).toUpperCase();
      const importId = safeSegment(requestUrl.searchParams.get("importId") || "");
      if (importId) {
        let task = readCoursePackageTask(requestedCourse, importId);
        const failedManifestOnly = task?.status === "failed" && /course-manifest\.json|ENOENT/i.test(String(task.error || ""));
        const hasCompleteChunks = task && Number(task.chunksReceived || 0) >= Number(task.chunkTotal || Infinity);
        const mergedZipPath = task?.filename ? ensureInside(coursePackageDir(requestedCourse, importId), join(coursePackageDir(requestedCourse, importId), safeSegment(task.filename))) : "";
        const hasMergedZip = Boolean(mergedZipPath && existsSync(mergedZipPath));
        if (task && task.status !== "complete" && (task.status !== "failed" || failedManifestOnly) && (hasCompleteChunks || hasMergedZip)) {
          task = startCoursePackageFinalize({
            course: requestedCourse,
            importId,
            actor: adminActor(req),
          });
        }
        if (task) {
          task = {
            ...task,
            packageBytes: await directorySize(coursePackageDir(requestedCourse, importId)),
            chunkBytes: await directorySize(coursePackageChunkDir(requestedCourse, importId)),
          };
        }
        sendJson(res, 200, task ? { ok: true, task } : {
          ok: true,
          task: {
            course: requestedCourse,
            importId,
            status: "missing",
            phase: "idle",
            error: "",
            message: "Course package task is no longer active.",
          },
        });
        return true;
      }
      const tasks = await latestCoursePackageTasks(requestedCourse);
      sendJson(res, 200, { ok: true, course: requestedCourse, tasks });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-package/commit" && req.method === "POST") {
      const body = await readJsonBody(req, 64 * 1024);
      const requestedCourse = safeSegment(body.course || course).toUpperCase();
      const importId = safeSegment(body.importId || "");
      if (!importId) throw new Error("Missing course package importId.");
      await withOperationLock(`course:${requestedCourse}:write`, async () => {
        const result = await commitCoursePackageImport({ course: requestedCourse, importId, actor: adminActor(req) });
        let storageCache = null;
        let storageCacheWarning = null;
        try {
          storageCache = await refreshStorageCacheForCourse(requestedCourse);
        } catch (error) {
          storageCacheWarning = error instanceof Error ? error.message : String(error);
        }
        // The manual "confirm/replace course package" path swaps the active manifest just like
        // the raw-upload callback, so it must also queue the publish job. Otherwise iSpring/video
        // entries remain on /courseware/... indefinitely instead of being rewritten to CDN.
        const media = tryCreateMediaJob({ type: "publish-course", course: requestedCourse, actor: adminActor(req) });
        sendJson(res, 200, {
          ...result,
          storageCache: storageCache ? storageCacheMeta("updated", storageCache) : null,
          storageCacheWarning,
          mediaJob: media.job,
          mediaJobWarning: media.warning || null,
        });
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/upload" && req.method === "POST") {
      const manifest = await readManifest(course);
      const upload = targetForUpload(requestUrl.searchParams, manifest);
      assertContentLength(req, upload.type);
      const originalFilename = requestUrl.searchParams.get("filename") || "";
      const isSpringUpload = upload.type === "ispring-zip" || upload.type === "ispring-batch-zip";
      const streamedPath = isSpringUpload ? upload.target : incomingUploadPath(upload.course, originalFilename);
      await mkdir(dirname(streamedPath), { recursive: true });
      await pipeline(req, createWriteStream(streamedPath));

      await withOperationLock(`course:${upload.course}:write`, async () => {
        let installedPath = upload.target;
        const backups = [];
        let batch = null;
        if (upload.type === "ispring-zip") {
          const result = await installIspringPackage({
            course: upload.course,
            sourceZip: upload.target,
            lessonDir: upload.lessonDir,
            label: originalFilename,
          });
          if (result.backupPath) backups.push(result.backupPath);
          installedPath = result.packageDir;
        } else if (upload.type === "ispring-batch-zip") {
          const latestManifest = await readManifest(upload.course);
          batch = await installIspringBatch(upload, latestManifest);
          backups.push(...batch.backups);
          installedPath = upload.target;
        } else {
          const backupPath = await backupExistingPath(upload.course, upload.target);
          if (backupPath) backups.push(backupPath);
          await mkdir(dirname(upload.target), { recursive: true });
          await rename(streamedPath, upload.target);
        }

        const rebuild = await rebuildManifest(upload.course);
        let lightweightPreview = null;
        let lightweightPreviewWarning = null;
        if (!isSpringUpload && upload.course.toUpperCase() === "ENG3U") {
          try {
            lightweightPreview = await generateLightweightPreviews(upload.course);
          } catch (error) {
            lightweightPreviewWarning = error instanceof Error ? error.message : String(error);
          }
        }
        let preview = null;
        let previewWarning = null;
        if (generatePreviewsAfterUploads && !isSpringUpload) {
          try {
            preview = await generateDocumentPreviews(upload.course);
          } catch (error) {
            previewWarning = error instanceof Error ? error.message : String(error);
          }
        }
        await appendAdminHistory(upload.course, {
          actor: adminActor(req),
          action: "upload",
          type: upload.type,
          filename: originalFilename,
          installedPath,
          batch,
          backups,
          bytes: Number(req.headers["content-length"] || 0),
          lightweightPreview: lightweightPreview?.stdout?.trim() || null,
          lightweightPreviewWarning,
          preview: preview?.stdout?.trim() || null,
          previewWarning,
        });
        let storageCache = null;
        let storageCacheWarning = null;
        try {
          storageCache = await refreshStorageCacheForCourse(upload.course);
        } catch (error) {
          storageCacheWarning = error instanceof Error ? error.message : String(error);
        }
        const media = mediaJobsAutoPublishAfterUpload
          ? tryCreateMediaJob({ type: "publish-course", course: upload.course, actor: adminActor(req) })
          : { job: null, warning: "" };
        sendJson(res, 200, {
          ok: true,
          course: upload.course,
          type: upload.type,
          path: installedPath,
          batch,
          backups,
          manifest: rebuild.stdout.trim(),
          lightweightPreview: lightweightPreview?.stdout?.trim() || null,
          lightweightPreviewWarning,
          preview: preview?.stdout?.trim() || null,
          previewWarning,
          storageCache: storageCache ? storageCacheMeta("updated", storageCache) : null,
          storageCacheWarning,
          mediaJob: media.job,
          mediaJobWarning: media.warning || null,
        });
      });
      return true;
    }

    sendJson(res, 404, { ok: false, error: "Unknown admin endpoint." });
    return true;
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    return true;
  }
}

async function handlePortalApi(req, res) {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  if (!requestUrl.pathname.startsWith("/api/portal/")) return false;

  try {
    if (requestUrl.pathname === "/api/portal/session" && req.method === "GET") {
      const session = readPortalSession(req);
      sendJson(res, 200, {
        ok: true,
        loginEnabled: portalLoginConfigured(),
        ...publicPortalSession(session),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/portal/login" && req.method === "POST") {
      if (!portalLoginConfigured()) {
        sendJson(res, 500, { ok: false, error: "Portal login is not configured. Set PORTAL_USERS_JSON and PORTAL_SESSION_SECRET." });
        return true;
      }
      const body = await readJsonBody(req);
      const rateKeys = loginRateKeys(req, "portal", body.username);
      const rateLimit = loginRateLimitStatus(rateKeys);
      if (rateLimit) {
        sendRateLimitJson(res, rateLimit.retryAfterSeconds);
        return true;
      }
      const user = getPortalUsers().find((item) => timingSafeStringEqual(item.username, body.username || ""));
      const passwordOk = user && user.status !== "disabled" ? verifyPortalPassword(user, body.password || "") : false;
      if (!user || !passwordOk) {
        recordLoginFailure(rateKeys);
        sendJson(res, 401, { ok: false, error: "Invalid username or password." });
        return true;
      }
      clearLoginFailures(rateKeys);
      setPortalSessionCookie(res, user);
      sendJson(res, 200, {
        ok: true,
        ...publicPortalSession({
          username: user.username,
          displayName: user.displayName || "",
          role: user.role,
          courses: user.courses,
        }),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/portal/logout" && req.method === "POST") {
      clearPortalSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (requestUrl.pathname === "/api/portal/moodle-embeds" && req.method === "GET") {
      const session = readPortalSession(req);
      if (!canGenerateMoodleEmbeds(session)) {
        sendJson(res, 403, { ok: false, error: "Admin portal access is required to generate Moodle embed code." });
        return true;
      }
      const requestedCourse = safeSegment(requestUrl.searchParams.get("course") || "ENG3U").toUpperCase();
      if (!canAccessCourse(session, requestedCourse)) {
        sendJson(res, 403, { ok: false, error: `No portal access to ${requestedCourse}.` });
        return true;
      }
      const manifest = await readManifest(requestedCourse);
      const rows = moodleEmbedRowsForCourse(req, requestedCourse, manifest);
      sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        course: requestedCourse,
        publicOrigin: publicOrigin(req),
        tokenMaxAgeSeconds: embedTokenMaxAgeSeconds,
        rows,
        summary: {
          total: rows.length,
          ispring: rows.filter((row) => row.kind === "ispring").length,
          video: rows.filter((row) => row.kind === "video").length,
          h5p: rows.filter((row) => row.kind === "h5p").length,
        },
      });
      return true;
    }

    if (requestUrl.pathname === "/api/portal/share-link" && req.method === "POST") {
      const session = readPortalSession(req);
      if (!canGenerateMoodleEmbeds(session)) {
        sendJson(res, 403, { ok: false, error: "Admin portal access is required to generate public share links." });
        return true;
      }
      const body = await readJsonBody(req, 64 * 1024);
      const requestedCourse = safeSegment(body.course || "ENG3U").toUpperCase();
      if (!canAccessCourse(session, requestedCourse)) {
        sendJson(res, 403, { ok: false, error: `No portal access to ${requestedCourse}.` });
        return true;
      }
      const path = toPosixPath(body.path || "");
      const previewPath = toPosixPath(body.previewPath || "");
      const url = cleanExternalUrl(body.url || "");
      const previewUrl = cleanExternalUrl(body.previewUrl || "");
      const downloadUrl = cleanExternalUrl(body.downloadUrl || "");
      if (!path && !previewPath && !url && !previewUrl && !downloadUrl) {
        sendJson(res, 400, { ok: false, error: "A local resource path, preview path, or trusted URL is required." });
        return true;
      }
      const kind = String(body.kind || "").toLowerCase();
      if (!shareableEmbedKinds.has(kind)) {
        sendJson(res, 400, { ok: false, error: "Only iSpring, video, H5P, and interactive resources can generate public share links." });
        return true;
      }
      const days = Number(body.expiresInDays || 30);
      const expiresInSeconds = Math.round(Math.max(1, Math.min(days, 3650)) * 24 * 60 * 60);
      const token = shareTokenForResource({
        course: requestedCourse,
        kind,
        label: body.label || basename(path || previewPath),
        path,
        previewPath,
        url,
        previewUrl,
        downloadUrl,
        expiresInSeconds,
      });
      const payload = verifyEmbedToken(token);
      sendJson(res, 200, {
        ok: true,
        shareUrl: `${publicOrigin(req)}/share/${encodeURIComponent(token)}`,
        expiresAt: payload?.exp ? new Date(Number(payload.exp) * 1000).toISOString() : null,
        tokenMaxAgeSeconds: expiresInSeconds,
      });
      return true;
    }

    sendJson(res, 404, { ok: false, error: "Unknown portal endpoint." });
    return true;
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    return true;
  }
}

async function handleShareRequest(req, res, requestUrl) {
  const match = /^\/share\/([^/]+)$/i.exec(requestUrl.pathname);
  if (!match) return false;
  const token = decodeURIComponent(match[1]);
  const payload = verifyEmbedToken(token);
  if (!payload?.share) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: invalid or expired share link");
    return true;
  }
  const course = safeSegment(payload.course).toUpperCase();
  if (!isCourseActive(course)) {
    res.writeHead(423, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Locked: course is archived");
    return true;
  }
  sendHtml(res, 200, renderSharePage(req, token, payload));
  return true;
}

function shouldUseLinkedVideoActivityPage(course, requestedPath, filePath) {
  if (safeSegment(course).toUpperCase() !== "BBI2O") return false;
  if (extname(filePath).toLowerCase() !== ".html") return false;
  const normalizedPath = toPosixPath(requestedPath || "");
  return /^localized-moodle-activities\/.+\/index\.html$/i.test(normalizedPath);
}

function labelFromVideoBlock(block, src) {
  const captionMatch = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(block);
  const captionText = captionMatch?.[1]
    ?.replace(/<[^>]+>/g, " ")
    ?.replace(/\s+/g, " ")
    ?.trim();
  if (captionText) return captionText;
  const titleMatch = /\btitle=(["'])([\s\S]*?)\1/i.exec(block);
  if (titleMatch?.[2]) return titleMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const anchorMatch = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(block);
  const anchorText = anchorMatch?.[1]
    ?.replace(/<[^>]+>/g, " ")
    ?.replace(/\s+/g, " ")
    ?.trim();
  if (anchorText) return anchorText;
  try {
    const pathPart = new URL(src, "https://local.invalid/").pathname;
    return decodeURIComponent(pathPart.split("/").filter(Boolean).pop() || "Open video");
  } catch {
    return "Open video";
  }
}

function videoSrcFromBlock(block) {
  for (const pattern of [
    /<source\b[^>]*\b(?:data-src|src)\s*=\s*(["'])(https?:\/\/[^"']+\.(?:mp4|webm|mov|m4v)(?:\?[^"']*)?|[^"']+\.(?:mp4|webm|mov|m4v)(?:\?[^"']*)?)\1/i,
    /<video\b[^>]*\b(?:data-src|src)\s*=\s*(["'])(https?:\/\/[^"']+\.(?:mp4|webm|mov|m4v)(?:\?[^"']*)?|[^"']+\.(?:mp4|webm|mov|m4v)(?:\?[^"']*)?)\1/i,
  ]) {
    const match = pattern.exec(block);
    if (match?.[2]) return match[2];
  }
  return "";
}

function injectLinkedVideoStyle(html) {
  if (/ossd-linked-video-list/i.test(html)) return html;
  const style = `<style>
.ossd-linked-video-list{display:grid;gap:10px;margin:18px 0;}
.ossd-linked-video-item{align-items:center;background:#f7fbff;border:1px solid #c8def5;border-radius:6px;display:flex;gap:12px;justify-content:space-between;padding:12px 14px;}
.ossd-linked-video-name{color:#002b55;font-weight:700;overflow-wrap:anywhere;}
.ossd-linked-video-action{border:1px solid #6fa3dc;border-radius:5px;color:#00396f;font-weight:700;padding:7px 11px;text-decoration:none;white-space:nowrap;}
.ossd-linked-video-action:hover{background:#eaf4ff;}
</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}\n$&`);
  return `${style}\n${html}`;
}

function renderLinkedVideoItem(src, label) {
  return `<div class="ossd-linked-video-item">
  <span class="ossd-linked-video-name">${htmlEscape(label)}</span>
  <a class="ossd-linked-video-action" href="${htmlEscape(src)}" target="_blank" rel="noopener">播放</a>
</div>`;
}

function linkedActivityVideoEmbedUrl(req, course, htmlPath, rawHref, label) {
  if (!embedTokenSecret) return rawHref;
  const coursePath = htmlReferenceValueToCoursePath(course, htmlPath, rawHref);
  if (!coursePath || !isPlayableCoursewareAsset(coursePath)) return rawHref;
  const lessonId = resourceIdFor(htmlPath).toUpperCase();
  const token = embedTokenForResource({
    course,
    kind: "video",
    path: coursePath,
    label: label || basename(coursePath),
    section: "activity",
    lessonId,
  });
  const resourceId = resourceIdFor(coursePath);
  return `${publicOrigin(req)}/embed/video/${encodeURIComponent(safeSegment(course).toUpperCase())}/${lessonId}/${resourceId}?token=${encodeURIComponent(token)}`;
}

function replaceLinkedVideoAnchorsWithEmbedLinks(html, req, course, htmlPath) {
  let changed = false;
  const body = String(html || "").replace(/<a\b([^>]*\bhref=(["'])([^"']+\.(?:mp4|webm|mov|m4v)(?:\?[^"']*)?)\2[^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, _quote, href, innerHtml) => {
    const label = innerHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || basename(href.split(/[?#]/)[0] || "Video");
    const embedUrl = linkedActivityVideoEmbedUrl(req, course, htmlPath, href, label);
    if (embedUrl === href) return match;
    changed = true;
    return `<a${attrs.replace(/\bhref=(["'])([^"']+)\1/i, `href="${htmlEscape(embedUrl)}"`)}>${innerHtml}</a>`;
  });
  return { html: body, changed };
}

function replaceMultiVideoEmbedsWithLinks(html, req, course, htmlPath) {
  const body = String(html || "");
  const videoBlocks = Array.from(body.matchAll(/<figure\b[\s\S]*?<video\b[\s\S]*?<\/video>[\s\S]*?<\/figure>|<video\b[\s\S]*?<\/video>/gi));
  const linkableVideos = videoBlocks
    .map((match) => {
      const block = match[0];
      const src = videoSrcFromBlock(block);
      if (!src) return null;
      const label = labelFromVideoBlock(block, src);
      return { block, src: linkedActivityVideoEmbedUrl(req, course, htmlPath, src, label), label };
    })
    .filter(Boolean);

  const linkedAnchors = replaceLinkedVideoAnchorsWithEmbedLinks(body, req, course, htmlPath);
  if (linkableVideos.length < 2) {
    return linkedAnchors.changed ? { html: linkedAnchors.html, changed: true } : { html, changed: false };
  }

  let nextHtml = linkedAnchors.html;
  for (const item of linkableVideos) {
    nextHtml = nextHtml.replace(item.block, renderLinkedVideoItem(item.src, item.label));
  }
  if (!/class=(["'])[^"']*\bossd-linked-video-list\b[^"']*\1/i.test(nextHtml)) {
    nextHtml = nextHtml.replace(/(<div class="ossd-linked-video-item">[\s\S]*?<\/div>)/, '<div class="ossd-linked-video-list">$1</div>');
  }
  nextHtml = injectLinkedVideoStyle(nextHtml);
  return { html: nextHtml, changed: true };
}

async function sendFile(req, res, filePath) {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const shouldDownloadRaw = requestUrl.searchParams.get("download") === "1";
  const fileStat = await stat(filePath);
  if (fileStat.isDirectory()) {
    const indexPath = join(filePath, "index.html");
    return sendFile(req, res, indexPath);
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  if (!shouldDownloadRaw && shouldUseCoursewareViewerStyle(filePath)) {
    const html = await readFile(filePath, "utf8");
    sendHtml(res, 200, injectCoursewareViewerStyle(html));
    return;
  }
  if (!shouldDownloadRaw && shouldUseCoursewareTextViewer(filePath)) {
    const text = await readFile(filePath, "utf8");
    sendHtml(res, 200, renderCoursewareTextViewer(filePath, text, requestUrl.pathname));
    return;
  }
  const xAccelRedirect = xAccelRedirectForCourseware(filePath);
  if (xAccelRedirect) {
    res.writeHead(200, {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "X-Accel-Redirect": xAccelRedirect,
    });
    res.end();
    return;
  }
  const range = req.headers.range;

  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  if (shouldDownloadRaw) {
    res.setHeader("Content-Disposition", `attachment; filename="${basename(filePath).replaceAll("\"", "")}"`);
  }
  if (ext === ".html" || ext === ".json") {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
  }

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : fileStat.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
        "Content-Length": end - start + 1,
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  res.setHeader("Content-Length", fileStat.size);
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = decodePath(requestUrl.pathname);

    if (!isPortalAuthorized(req)) {
      requestPortalAuth(res);
      return;
    }
    if (await handlePortalApi(req, res)) return;
    if (await handleAdminApi(req, res)) return;
    if (await handleEmbedRequest(req, res, requestUrl)) return;
    if (await handleShareRequest(req, res, requestUrl)) return;

    if (portalLoginConfigured() && !shouldBypassPortalLogin(pathname) && !readPortalSession(req)) {
      redirectToLogin(res);
      return;
    }

    if (await sendPublicCourseCatalog(req, pathname, res)) return;
    if (await sendPublicCourseRoadmap(req, pathname, res)) return;
    if (await sendPublicCourseManifest(req, pathname, res)) return;

    const requestedCourse = courseFromCoursewarePath(pathname);
    if (requestedCourse && !isCourseActive(requestedCourse)) {
      res.writeHead(423, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Locked: course is archived and must be activated by an administrator");
      return;
    }
    if (requestedCourse && !canAccessCourse(readPortalSession(req), requestedCourse)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden: course access denied");
      return;
    }

    const filePath = resolveRequestPath(req.url || "/");
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const requestedPath = requestedCourse ? pathFromCoursewarePath(pathname) : "";
      if (
        requestedCourse
        && !requestUrl.searchParams.has("download")
        && shouldUseLinkedVideoActivityPage(requestedCourse, requestedPath, filePath)
      ) {
        const html = await readFile(filePath, "utf8");
        const linkedVideoPage = replaceMultiVideoEmbedsWithLinks(html, req, requestedCourse, requestedPath);
        if (linkedVideoPage.changed) {
          sendHtml(res, 200, linkedVideoPage.html);
          return;
        }
      }
      if (
        requestedCourse
        && !requestUrl.searchParams.has("download")
        && shouldUseCoursewareIspringCdnBase(requestedCourse, requestedPath, filePath)
      ) {
        const html = await readFile(filePath, "utf8");
        sendHtml(res, 200, injectIspringEmbedCompatibility(html, coursewareAssetDirectoryHref(requestedCourse, requestedPath)));
        return;
      }
      await sendFile(req, res, filePath);
    } catch (error) {
      if (requestedCourse && await sendCoursewareCdnFallback(req, res, requestedCourse, pathFromCoursewarePath(pathname))) return;
      throw error;
    }
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(process.env.DEBUG_NOT_FOUND === "1" ? `Not found\n${error instanceof Error ? error.stack || error.message : String(error)}` : "Not found");
  }
});

function listenOnAvailablePort(currentPort) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && currentPort < portEnd) {
      console.log(`Port ${currentPort} is already in use. Trying ${currentPort + 1}...`);
      server.removeAllListeners("listening");
      listenOnAvailablePort(currentPort + 1);
      return;
    }

    console.error(error.message || error);
    process.exitCode = 1;
  });

  server.listen(currentPort, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${currentPort}/`;
    console.log(`OSSD Course Portal running at ${url}`);
    if (adminUploadsEnabled) {
      console.log("Teacher admin is available from the 管理后台 link in the website header.");
    }
    if (shouldOpen) {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    }
  });
}

listenOnAvailablePort(port);
