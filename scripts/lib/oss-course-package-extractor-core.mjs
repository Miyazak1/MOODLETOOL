import { extname } from "node:path";

const playableVideoExts = new Set([".mp4", ".webm", ".mov", ".m4v"]);

export function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

export function stripSlash(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

export function safeCourse(value) {
  return String(value || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .trim()
    .toUpperCase();
}

export function normalizeZipEntryPath(entryPath) {
  const raw = toPosixPath(entryPath).replace(/\0/g, "").trim();
  if (!raw || raw.endsWith("/")) return "";
  const withoutDrive = raw.replace(/^[A-Za-z]:\//, "");
  const parts = [];
  for (const segment of withoutDrive.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return "";
    parts.push(segment);
  }
  return parts.join("/");
}

export function courseRelativePathFromZipEntry(entryPath, course, { objectPrefix = "courseware-active" } = {}) {
  const normalized = normalizeZipEntryPath(entryPath);
  if (!normalized) return "";
  const code = safeCourse(course);
  if (!code) return normalized;
  const parts = normalized.split("/");
  const prefix = stripSlash(objectPrefix).toLowerCase();
  const prefixedIndex = parts.findIndex((part, index) => (
    part.toLowerCase() === prefix
    && safeCourse(parts[index + 1] || "") === code
  ));
  if (prefixedIndex >= 0) return parts.slice(prefixedIndex + 2).join("/");
  const courseIndex = parts.findIndex((part) => safeCourse(part) === code);
  if (courseIndex >= 0) return parts.slice(courseIndex + 1).join("/");
  return normalized;
}

export function isIspringPackageAsset(relativePath) {
  const normalized = `/${toPosixPath(relativePath).toLowerCase()}`;
  return normalized.includes("/html5-package/") || normalized.includes("/html5-package-admin/");
}

export function isExtractableCoursewareAsset(relativePath, { assetScope = "playable" } = {}) {
  const rel = toPosixPath(relativePath);
  if (!rel || rel.endsWith("/")) return false;
  if (assetScope === "all") return true;
  const ext = extname(rel).toLowerCase();
  return playableVideoExts.has(ext) || ext === ".h5p" || isIspringPackageAsset(rel);
}

export function targetObjectKeyForEntry(entryPath, { course, targetPrefix, objectPrefix = "courseware-active", assetScope = "playable" } = {}) {
  const rel = courseRelativePathFromZipEntry(entryPath, course, { objectPrefix });
  if (!isExtractableCoursewareAsset(rel, { assetScope })) return "";
  const prefix = stripSlash(targetPrefix || `${stripSlash(objectPrefix)}/${safeCourse(course)}`);
  if (!prefix) return "";
  return `${prefix}/${rel}`.replace(/\/+/g, "/");
}

export function contentTypeForObjectKey(objectKey) {
  const ext = extname(toPosixPath(objectKey)).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
    ".h5p": "application/octet-stream",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".xml": "application/xml; charset=utf-8",
  };
  return map[ext] || "application/octet-stream";
}

export function parseCourseUploadFromObjectKey(objectKey, { inboxPrefix = "inbox/uploads" } = {}) {
  const key = stripSlash(toPosixPath(decodeURIComponent(String(objectKey || "").replace(/\+/g, "%20"))));
  const prefix = stripSlash(inboxPrefix);
  const parts = key.split("/");
  const prefixParts = prefix.split("/");
  const matchesPrefix = prefixParts.every((part, index) => parts[index] === part);
  if (!matchesPrefix || parts.length < prefixParts.length + 3) return null;
  const course = safeCourse(parts[prefixParts.length]);
  const uploadId = parts[prefixParts.length + 1] || "";
  const fileName = parts.slice(prefixParts.length + 2).join("/");
  if (!course || !uploadId || !fileName) return null;
  return { course, uploadId, fileName, objectKey: key };
}

function parseJsonPayload(value) {
  if (!value) return {};
  if (typeof value === "string") return value.trim() ? JSON.parse(value) : {};
  if (value instanceof ArrayBuffer) return parseJsonPayload(Buffer.from(value).toString("utf8"));
  if (ArrayBuffer.isView(value)) return parseJsonPayload(Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8"));
  if (typeof value === "object" && typeof value.body === "string") return parseJsonPayload(value.body);
  return value;
}

export function extractOssEventObject(event) {
  const payload = parseJsonPayload(event);
  const item = Array.isArray(payload.events) ? payload.events[0] : payload;
  const bucket = item?.oss?.bucket?.name || item?.bucket || item?.bucketName || "";
  const objectKey = item?.oss?.object?.key || item?.objectKey || item?.object || "";
  return {
    bucket,
    objectKey: objectKey ? decodeURIComponent(String(objectKey).replace(/\+/g, "%20")) : "",
  };
}

export function buildExtractCallbackPayload({ uploadId, course, sourceObjectKey, targetPrefix, summary, extractor = "oss-course-package-extractor" }) {
  return {
    uploadId,
    course: safeCourse(course),
    extractor,
    sourceObjectKey,
    targetPrefix: stripSlash(targetPrefix) ? `${stripSlash(targetPrefix)}/` : "",
    summary: summary || null,
  };
}
