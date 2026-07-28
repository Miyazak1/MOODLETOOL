import { createServer } from "node:http";
import { appendFile, cp, mkdir, readdir, readFile, rename, rm, stat, statfs } from "node:fs/promises";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, normalize, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { finished, pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const projectRoot = resolve(import.meta.dirname);
const workspaceRoot = resolve(projectRoot, "..");
const courseCatalogPath = join(projectRoot, "public", "course-catalog.json");
const portArgIndex = process.argv.indexOf("--port");
const port = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 8890;
const portEndArgIndex = process.argv.indexOf("--port-end");
const portEnd = portEndArgIndex >= 0 ? Number(process.argv[portEndArgIndex + 1]) : port;
const shouldOpen = process.argv.includes("--open");
const rootArgIndex = process.argv.indexOf("--root");
const webRoot = rootArgIndex >= 0 ? resolve(projectRoot, process.argv[rootArgIndex + 1]) : projectRoot;
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
const xAccelCoursewarePrefix = process.env.X_ACCEL_COURSEWARE_PREFIX || "";
const embedTokenSecret = process.env.EMBED_TOKEN_SECRET || adminSessionSecret || portalSessionSecret || "";
const embedTokenMaxAgeSeconds = Number(process.env.EMBED_TOKEN_MAX_AGE_SECONDS || 3650 * 24 * 60 * 60);
const embedPublicOrigin = process.env.EMBED_PUBLIC_ORIGIN || "";
const loginRateLimitMaxFailures = Number(process.env.LOGIN_RATE_LIMIT_MAX_FAILURES || 8);
const loginRateLimitWindowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS || 15 * 60) * 1000;
const loginRateLimitLockMs = Number(process.env.LOGIN_RATE_LIMIT_LOCK_SECONDS || 15 * 60) * 1000;
const maxDocumentUploadBytes = Number(process.env.ADMIN_MAX_DOCUMENT_MB || 50) * 1024 * 1024;
const maxIspringUploadBytes = Number(process.env.ADMIN_MAX_ISPRING_MB || 2048) * 1024 * 1024;
const maxCoursePackageUploadBytes = Number(process.env.ADMIN_MAX_COURSE_PACKAGE_MB || 4096) * 1024 * 1024;
const generatePreviewsAfterUploads = process.env.GENERATE_PREVIEWS_AFTER_UPLOADS === "1";
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
const loginFailures = new Map();
const coursePackageTasks = new Map();
const coursePackageFinalizeTasks = new Map();

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
  if (decoded === "/login") {
    return join(webRoot, "login.html");
  }
  if (decoded === "/teacher-admin") {
    return join(webRoot, "teacher-admin.html");
  }
  if (decoded === "/" || decoded === "") {
    return join(webRoot, "index.html");
  }

  if (decoded.startsWith("/courseware/") && decoded.split("/").includes("_admin_uploads")) {
    return null;
  }

  const isCoursewareRequest = decoded.startsWith("/courseware/");
  const relativePath = isCoursewareRequest ? decoded.replace(/^\/courseware\/?/i, "") : decoded;
  const root = isCoursewareRequest ? courseActiveRoot : webRoot;
  const candidate = normalize(join(root, relativePath));
  const allowedRoot = root;

  if (!candidate.startsWith(allowedRoot)) {
    return null;
  }
  return candidate;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(data, null, 2)}\n`);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function sendRateLimitJson(res, retryAfterSeconds) {
  res.writeHead(429, {
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": String(Math.max(1, retryAfterSeconds)),
  });
  res.end(`${JSON.stringify({ ok: false, error: "Too many failed login attempts. Try again later.", retryAfterSeconds }, null, 2)}\n`);
}

function hasLocalResource(item) {
  return Boolean(item?.path || item?.previewPath || item?.downloadPath);
}

function sanitizePublicResource(item) {
  if (!item || typeof item !== "object") return null;
  const sanitized = { ...item };
  if (!sanitized.path) delete sanitized.url;
  if (!sanitized.previewPath) delete sanitized.previewUrl;
  if (!sanitized.downloadPath) delete sanitized.downloadUrl;
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
  const activeCourses = (catalog.courses || []).filter((course) => isCourseActive(course.code));
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
  const activeCourses = (roadmap.courses || []).filter((course) => isCourseActive(course.course));
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
  sendJson(res, 200, filterCatalogForSession(catalog, readPortalSession(req)));
  return true;
}

async function sendPublicCourseRoadmap(req, pathname, res) {
  if (pathname !== "/course-roadmap.json") return false;
  const roadmap = JSON.parse(await readFile(join(projectRoot, "public", "course-roadmap.json"), "utf8"));
  sendJson(res, 200, filterRoadmapForSession(roadmap, readPortalSession(req)));
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
  sendJson(res, 200, sanitizePublicManifest(manifest));
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
  return {
    username: String(user.username || "").trim(),
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
  mkdirSync(dirname(courseStatusPath), { recursive: true });
  const normalized = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    courses: store.courses || {},
  };
  writeFileSync(courseStatusPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
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
  const catalogCourses = (catalog.courses || []).map((courseEntry) => safeSegment(courseEntry.code).toUpperCase()).filter(Boolean);
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
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
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

function startCourseLifecycleJob({ action, course, actor, deleteActive = false, force = false, setArchived = false }) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!["archive", "activate"].includes(normalizedAction)) {
    throw new Error("Action must be archive or activate.");
  }
  const code = safeSegment(course).toUpperCase();
  if (!code) throw new Error("Course is required.");

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
  mkdirSync(dirname(portalUsersPath), { recursive: true });
  const normalized = users.map(normalizePortalUser).filter((user) => user.username);
  writeFileSync(
    portalUsersPath,
    `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), users: normalized }, null, 2)}\n`,
    "utf8",
  );
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
        role: session.role,
        courses: session.courses,
      }
    : {
        authenticated: false,
        username: null,
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

function shouldBypassPortalLogin(pathname) {
  return (
    pathname === "/login" ||
    pathname === "/api/portal/session" ||
    pathname === "/api/portal/login" ||
    pathname === "/api/portal/logout" ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/embed/") ||
    pathname.startsWith("/assets/") ||
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

function publicOrigin(req) {
  if (embedPublicOrigin) return embedPublicOrigin.replace(/\/+$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `127.0.0.1:${port}`;
  const proto = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`.replace(/\/+$/, "");
}

function embedTokenForResource({ course, kind, path, label, section, lessonId }) {
  const normalizedPath = toPosixPath(path);
  return signEmbedPayload({
    v: 1,
    course: safeSegment(course).toUpperCase(),
    kind,
    lessonId,
    label,
    section,
    path: normalizedPath,
    prefix: dirnamePosix(normalizedPath),
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

function shouldUseCoursewareViewerStyle(filePath) {
  if (extname(filePath).toLowerCase() !== ".html") return false;
  const relativePath = toPosixPath(relative(courseActiveRoot, filePath)).toLowerCase();
  if (relativePath.startsWith("../") || relativePath === "..") return false;
  if (basename(filePath).toLowerCase() === "presentation.html") return false;
  if (relativePath.includes("/html5-package") || relativePath.includes("/html5-package-admin")) return false;
  return relativePath.includes("/book_sections/") || relativePath.includes("/downloaded_resources/imported/");
}

function shouldUseCoursewareTextViewer(filePath) {
  if (![".md", ".txt"].includes(extname(filePath).toLowerCase())) return false;
  const relativePath = toPosixPath(relative(courseActiveRoot, filePath)).toLowerCase();
  if (relativePath.startsWith("../") || relativePath === "..") return false;
  return relativePath.includes("/book_sections/") || relativePath.includes("/downloaded_resources/imported/");
}

function renderCoursewareTextViewer(filePath, text) {
  const title = basename(filePath);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  ${coursewareViewerStyle}
  <style>
    .ossd-text-document {
      max-width: 1080px;
      margin: 18px auto 64px;
      padding: 28px 32px;
      border: 1px solid #d4e1f0;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 14px 36px rgba(14, 44, 74, 0.08);
    }
    .ossd-text-document h1 {
      margin: 0 0 18px;
      font-size: 24px;
    }
    .ossd-text-document pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: inherit;
    }
  </style>
</head>
<body>
  <article class="ossd-text-document">
    <h1>${htmlEscape(title)}</h1>
    <pre>${htmlEscape(text)}</pre>
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
  await sendFile(req, res, filePath);
  return true;
}

function localResourceCandidatesForLesson(lesson) {
  const candidates = [];
  for (const item of lesson.ispring || []) {
    if (item.path) candidates.push({ kind: "ispring", role: item.role || "lesson_ispring", item });
  }
  for (const item of lesson.downloads || []) {
    if (!item.path) continue;
    const type = String(item.type || "").toLowerCase();
    const kind = type === "mp4" || type === "video" ? "video" : type === "h5p" ? "h5p" : "file";
    candidates.push({ kind, role: item.role || "download", item });
  }
  for (const item of lesson.bookSections || []) {
    if (item.path) candidates.push({ kind: "book-section", role: item.role || "lesson_book_section", item });
  }
  return candidates;
}

function moodleEmbedRowsForCourse(req, course, manifest) {
  const origin = publicOrigin(req);
  const rows = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      const lessonId = `U${String(unit.unit).padStart(2, "0")}L${String(lesson.lesson).padStart(2, "0")}`;
      for (const candidate of localResourceCandidatesForLesson(lesson)) {
        const item = candidate.item;
        const token = embedTokenForResource({
          course,
          kind: candidate.kind,
          path: item.path,
          label: item.label,
          section: item.sectionLabel || candidate.role,
          lessonId,
        });
        const resourceId = resourceIdFor(item.path);
        const embedUrl = `${origin}/embed/${candidate.kind}/${encodeURIComponent(course)}/${lessonId}/${resourceId}?token=${encodeURIComponent(token)}`;
        const fileUrl = `${origin}/embed/file/${encodeURIComponent(course)}/${lessonId}/${resourceId}?token=${encodeURIComponent(token)}`;
        let moodleHtml = "";
        let status = "ready";
        if (candidate.kind === "ispring") {
          moodleHtml = `<iframe src="${embedUrl}" width="100%" height="720" frameborder="0" scrolling="auto" allowfullscreen="allowfullscreen"></iframe>`;
        } else if (candidate.kind === "video") {
          moodleHtml = `<iframe src="${embedUrl}" width="100%" height="540" frameborder="0" allowfullscreen="allowfullscreen"></iframe>`;
        } else if (candidate.kind === "book-section") {
          moodleHtml = `<iframe src="${embedUrl}" width="100%" height="720" frameborder="0"></iframe>`;
        } else if (candidate.kind === "h5p") {
          moodleHtml = `<a href="${fileUrl}" target="_blank" rel="noopener">${htmlEscape(item.label || "Download H5P")}</a>`;
          status = "needs-h5p-runtime";
        } else if (String(item.type || "").toLowerCase() === "pdf") {
          moodleHtml = `<iframe src="${fileUrl}" width="100%" height="720" frameborder="0"></iframe>`;
        } else {
          moodleHtml = `<a href="${fileUrl}" target="_blank" rel="noopener">${htmlEscape(item.label || "Download resource")}</a>`;
        }
        rows.push({
          course,
          unit: unit.unit,
          lesson: lesson.lesson,
          lessonId,
          lessonTitle: lesson.title,
          kind: candidate.kind,
          role: candidate.role,
          label: item.label || "",
          path: item.path,
          source: item.source || null,
          status,
          embedUrl,
          fileUrl,
          moodleHtml,
        });
      }
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
    return sendEmbedCoursewareFile(req, res, course, requestedPath, payload);
  }

  const coursewareMatch = /^\/embed\/courseware\/([^/]+)\/(.+)$/i.exec(requestUrl.pathname);
  if (coursewareMatch) {
    const course = safeSegment(coursewareMatch[1]).toUpperCase();
    const requestedPath = decodePath(coursewareMatch[2]);
    return sendEmbedCoursewareFile(req, res, course, requestedPath, payload);
  }

  const match = /^\/embed\/(ispring|video|file|book-section|h5p)\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/i.exec(requestUrl.pathname);
  if (!match) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Unknown embed endpoint");
    return true;
  }
  const kind = match[1].toLowerCase();
  const course = safeSegment(match[2]).toUpperCase();
  const lessonId = match[3];
  if (payload.kind !== kind && !(kind === "file" && ["file", "h5p"].includes(payload.kind))) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: embed token kind mismatch");
    return true;
  }
  if (payload.lessonId && String(payload.lessonId).toUpperCase() !== String(lessonId).toUpperCase()) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: embed token lesson mismatch");
    return true;
  }

  const tokenizedRawUrl = `/embed/t/${encodeURIComponent(token)}/${encodeURIComponent(course)}/${encodePathSegments(payload.path)}`;
  if (kind === "ispring") {
    const root = courseRoot(course);
    const filePath = ensureInside(root, join(root, toPosixPath(payload.path)));
    const html = await readFile(filePath, "utf8");
    const baseHref = `/embed/t/${encodeURIComponent(token)}/${encodeURIComponent(course)}/${encodePathSegments(dirnamePosix(payload.path))}/`;
    sendHtml(res, 200, injectEmbedBase(html, baseHref));
    return true;
  }
  if (kind === "video") {
    sendHtml(
      res,
      200,
      `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${htmlEscape(payload.label || "Video")}</title>
    <style>html,body{margin:0;background:#000;}video{display:block;width:100%;height:100vh;max-height:100vh;background:#000;}</style>
  </head>
  <body>
    <video controls preload="metadata" src="${htmlEscape(tokenizedRawUrl)}"></video>
  </body>
</html>`,
    );
    return true;
  }
  if (kind === "book-section") {
    const root = courseRoot(course);
    const filePath = ensureInside(root, join(root, toPosixPath(payload.path)));
    const html = await readFile(filePath, "utf8");
    sendHtml(res, 200, html);
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
    course: {
      code,
      title: code,
      grade: "",
      description: "",
    },
    courseDownloads: [],
    units: [],
    textMaterials: [],
    sourceAudit: {
      generatedFrom: "empty-admin-import",
      lessonCount: 0,
      ispringComplete: 0,
    },
    generatedAt: new Date().toISOString(),
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

async function readCourseCatalog() {
  return JSON.parse(await readFile(courseCatalogPath, "utf8"));
}

async function ensureCourseCatalogEntry(course, manifest) {
  const code = safeSegment(course).toUpperCase();
  if (!code) throw new Error("Course is required.");
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

async function courseReadinessRecord(course) {
  const manifest = await readManifest(course.code);
  const readiness = manifestReadiness(manifest);
  return {
    code: course.code,
    title: course.title,
    status: course.status,
    level: course.level,
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
  return (catalog.courses || []).map((course) => ({
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
  const manifest = await readManifest(course.code);
  return {
    code: course.code,
    title: course.title,
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

async function storageOverview() {
  const catalog = await readCourseCatalog();
  const catalogMap = new Map((catalog.courses || []).map((course) => [String(course.code || "").toUpperCase(), course]));
  const activeDirs = await listDirectoryNames(courseActiveRoot);
  const archiveDirs = await listDirectoryNames(courseArchiveRoot);
  const courseCodes = new Set([
    ...(catalog.courses || []).map((course) => String(course.code || "").toUpperCase()).filter(Boolean),
    ...activeDirs.map((name) => String(name || "").toUpperCase()).filter(Boolean),
    ...archiveDirs.map((name) => String(name || "").replace(/\.(tar\.gz|zip)$/i, "").toUpperCase()).filter(Boolean),
  ]);
  const courses = (await Promise.all([...courseCodes].map((course) => courseStorageRecord(course, catalogMap.get(course)))))
    .sort((a, b) => b.totalBytes - a.totalBytes || a.course.localeCompare(b.course));
  const disk = await diskInfoFor(courseActiveRoot);
  const activeRootBytes = await directorySize(courseActiveRoot);
  const archiveRootBytes = await directorySize(courseArchiveRoot);
  const adminUploadBytes = courses.reduce((sum, course) => sum + course.adminUploadBytes, 0);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    activeRoot: courseActiveRoot,
    archiveRoot: courseArchiveRoot,
    disk,
    summary: {
      courseCount: courses.length,
      activeRootBytes,
      archiveRootBytes,
      adminUploadBytes,
      courseTotalBytes: courses.reduce((sum, course) => sum + course.totalBytes, 0),
    },
    courses,
  };
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
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
  const supported = new Set([".docx", ".doc", ".pdf", ".pptx", ".xlsx", ".txt", ".md", ".html", ".mp4", ".h5p", ".zip"]);
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
  const role = ext === ".mp4" ? section.key : ext === ".h5p" ? section.key : section.key === "resource" ? "lesson_resource" : section.key;
  return {
    kind: ext === ".mp4" ? "video" : ext === ".h5p" ? "h5p" : "lesson-resource",
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
  if (!review.contentRoot || !existsSync(review.contentRoot)) {
    throw new Error("Package content root is missing. Re-upload the course ZIP and generate preview again.");
  }
  const packageManifest = await readPackageManifest(review.contentRoot, await listPackageFiles(review.contentRoot));
  if (!packageManifest) {
    throw new Error("Package course-manifest.json is missing. Re-upload the course ZIP and generate preview again.");
  }

  const root = courseRoot(course);
  const manifest = normalizeManifestCourse(packageManifest.manifest, course);
  await clearCourseRootForManifestPackage(course);
  const copiedTopLevelEntries = await copyManifestPackageContent(review.contentRoot, root);
  const removedGeneratedLocalPackageNotes = await pruneGeneratedLocalPackageNotes(course, manifest);
  recomputeManifestSummaries(manifest);
  writeJsonFile(join(root, "course-manifest.json"), manifest);
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
    cleanup,
    catalogEntry,
    lifecycle,
    lightweightPreview: lightweightPreview?.stdout?.trim() || null,
    lightweightPreviewWarning,
    manifest: "manifest restored from course package",
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
    importId,
    originalFilename: review.originalFilename,
    installedCount: installed.length,
    removedGeneratedLocalPackageNotes,
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
    lightweightPreview: lightweightPreview?.stdout?.trim() || null,
    lightweightPreviewWarning,
    manifest: "manifest updated directly from course package import",
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
        sendJson(res, 200, { ok: true, username: adminUsername, role: "admin", authSource: "admin" });
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

    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized. Please login first." });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/readiness" && req.method === "GET") {
      const catalog = await readCourseCatalog();
      const courses = await Promise.all((catalog.courses || []).map((courseEntry) => courseReadinessRecord(courseEntry)));
      sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        courseCount: courses.length,
        courses,
        summary: {
          missingCourseOutlines: courses.filter((courseEntry) => !courseEntry.readiness.courseOutline.ok).length,
          missingIntroductions: courses.filter((courseEntry) => !courseEntry.readiness.introduction.ok).length,
          unitPlanGapCourses: courses.filter((courseEntry) => courseEntry.readiness.unitPlans.missing.length).length,
          lessonPlanGapCourses: courses.filter((courseEntry) => courseEntry.readiness.lessonPlans.missing.length).length,
          ispringMissingCourses: courses.filter((courseEntry) => !courseEntry.readiness.ispring.connected).length,
          textReviewCourses: courses.filter((courseEntry) => courseEntry.readiness.texts.needsReview.length).length,
        },
      });
      return true;
    }

    if (requestUrl.pathname === "/api/admin/storage" && req.method === "GET") {
      sendJson(res, 200, await storageOverview());
      return true;
    }

    if (requestUrl.pathname === "/api/admin/upload-gaps" && req.method === "GET") {
      const catalog = await readCourseCatalog();
      const courses = await Promise.all((catalog.courses || []).map((courseEntry) => courseUploadGapRecord(courseEntry)));
      const uploadItems = courses.flatMap((courseEntry) => courseEntry.uploadItems);
      const reviewItems = courses.flatMap((courseEntry) => courseEntry.reviewItems);
      const externalItems = courses.flatMap((courseEntry) => courseEntry.externalItems);
      sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        courseCount: courses.length,
        courses,
        summary: {
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
          files: rows.filter((row) => row.kind === "file").length,
          h5pNeedsRuntime: rows.filter((row) => row.status === "needs-h5p-runtime").length,
          bookSections: rows.filter((row) => row.kind === "book-section").length,
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
      const users = ensurePortalUsersFile();
      const user = upsertPortalUser(users, body);
      const saved = savePortalUsers(users);
      await appendAdminHistory(body.course || "ENG3U", {
        actor: adminActor(req),
        action: "portal-user-upsert",
        username: user.username,
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
      return true;
    }

    if (requestUrl.pathname === "/api/admin/users" && req.method === "DELETE") {
      const username = requestUrl.searchParams.get("username");
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
      return true;
    }

    if (requestUrl.pathname === "/api/admin/course-status" && req.method === "GET") {
      const catalog = await readCourseCatalog();
      const store = readCourseStatusStore();
      const courses = (catalog.courses || []).map((courseEntry) => ({
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
      return true;
    }

    const course = (requestUrl.searchParams.get("course") || "ENG3U").toUpperCase();
    if (requestUrl.pathname === "/api/admin/status" && req.method === "GET") {
      const manifest = await readManifest(course);
      const lessons = (manifest.units || []).flatMap((unit) => unit.lessons || []);
      const readiness = manifestReadiness(manifest);
      const root = courseRoot(course);
      const adminRoot = join(root, "_admin_uploads");
      const disk = await diskInfoFor(root);
      sendJson(res, 200, {
        ok: true,
        course,
        lifecycle: courseLifecycleRecord(course),
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
      return true;
    }

    if (requestUrl.pathname === "/api/admin/generate-previews" && req.method === "POST") {
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
      const packageDir = coursePackageDir(course, importId);
      const sourceZip = ensureInside(packageDir, join(packageDir, safeSegment(originalFilename)));
      await mkdir(dirname(sourceZip), { recursive: true });
      writeCoursePackageTask(course, importId, {
        status: "uploading",
        phase: "uploading",
        filename: originalFilename,
        bytesReceived: 0,
        totalBytes: contentLength,
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
        writeCoursePackageTask(course, importId, {
          status: "failed",
          phase: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
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

      await mkdir(coursePackageChunkDir(course, importId), { recursive: true });
      writeCoursePackageTask(course, importId, {
        status: "uploading",
        phase: "chunk-uploading",
        filename: originalFilename,
        totalBytes,
        chunkTotal,
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
        writeCoursePackageTask(course, importId, {
          status: "failed",
          phase: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
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
        sendJson(res, task ? 200 : 404, task ? { ok: true, task } : { ok: false, error: "Course package task not found." });
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
      const result = await commitCoursePackageImport({ course: requestedCourse, importId, actor: adminActor(req) });
      sendJson(res, 200, result);
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
        batch = await installIspringBatch(upload, manifest);
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
          file: rows.filter((row) => row.kind === "file").length,
          bookSection: rows.filter((row) => row.kind === "book-section").length,
        },
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

async function sendFile(req, res, filePath) {
  const fileStat = await stat(filePath);
  if (fileStat.isDirectory()) {
    const indexPath = join(filePath, "index.html");
    return sendFile(req, res, indexPath);
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  if (shouldUseCoursewareViewerStyle(filePath)) {
    const html = await readFile(filePath, "utf8");
    sendHtml(res, 200, injectCoursewareViewerStyle(html));
    return;
  }
  if (shouldUseCoursewareTextViewer(filePath)) {
    const text = await readFile(filePath, "utf8");
    sendHtml(res, 200, renderCoursewareTextViewer(filePath, text));
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
    await sendFile(req, res, filePath);
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
