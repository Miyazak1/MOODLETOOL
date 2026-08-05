import { extname } from "node:path";

export const playableCoursewareVideoExts = new Set([".mp4", ".webm", ".mov", ".m4v"]);
export const directUploadKinds = new Set(["course-package", "course-package-raw", "video", "h5p", "ispring-package"]);

export function toPosixAssetPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

export function safeCourseSegment(value) {
  return String(value || "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDirectUploadKind(value) {
  const kind = String(value || "course-package").trim().toLowerCase();
  if (!directUploadKinds.has(kind)) throw new Error("Unsupported OSS direct upload kind.");
  return kind;
}

export function inferCourseCodeFromFileName(fileName, courseCodes = []) {
  const normalized = String(fileName || "").toUpperCase();
  const codes = [...new Set((courseCodes || []).map((code) => safeCourseSegment(code).toUpperCase()).filter(Boolean))]
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  for (const code of codes) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`).test(normalized)) return code;
  }
  return "";
}

export function directUploadKindCanAutoPublish(kind) {
  return ["video", "h5p"].includes(String(kind || "").toLowerCase());
}

export function isCoursePackageUploadKind(kind) {
  return ["course-package", "course-package-raw"].includes(String(kind || "").toLowerCase());
}

export function isRawCoursePackageUploadKind(kind) {
  return String(kind || "").toLowerCase() === "course-package-raw";
}

export function isIspringCoursewareAsset(relPath) {
  const normalized = `/${toPosixAssetPath(relPath).toLowerCase()}`;
  return normalized.includes("/html5-package/") || normalized.includes("/html5-package-admin/");
}

export function isPlayableCoursewareAsset(relPath) {
  const normalized = toPosixAssetPath(relPath);
  const ext = extname(normalized).toLowerCase();
  return playableCoursewareVideoExts.has(ext) || ext === ".h5p" || isIspringCoursewareAsset(normalized);
}
