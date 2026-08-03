import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function safeSegment(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\\/]+/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+$/, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
}

function readJsonFile(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function indexItem(record) {
  return {
    id: record.id,
    course: record.course,
    courseSource: record.courseSource || "",
    kind: record.kind,
    status: record.status,
    fileName: record.fileName,
    fileSize: record.fileSize,
    objectKey: record.objectKey,
    requestedBy: record.requestedBy,
    requestedAt: record.requestedAt,
    completedAt: record.completedAt || null,
    importId: record.importId || "",
    importStatus: record.importStatus || "",
    jobId: record.jobId || "",
    mediaJobWarning: record.mediaJobWarning || "",
    error: record.error || "",
  };
}

export function publicOssUpload(record) {
  if (!record) return null;
  return {
    id: record.id,
    course: record.course,
    kind: record.kind,
    status: record.status,
    fileName: record.fileName,
    fileSize: record.fileSize,
    contentType: record.contentType,
    bucket: record.bucket,
    endpoint: record.endpoint,
    objectKey: record.objectKey,
    ossUri: record.ossUri,
    requestedBy: record.requestedBy,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
    completedAt: record.completedAt || null,
    courseSource: record.courseSource || "",
    importId: record.importId || "",
    importStatus: record.importStatus || "",
    jobId: record.jobId || "",
    mediaJobWarning: record.mediaJobWarning || "",
    error: record.error || "",
  };
}

export function createOssUploadRecordStore({ dataRoot, indexPath, indexLimit = 300 }) {
  if (!dataRoot) throw new Error("dataRoot is required.");
  if (!indexPath) throw new Error("indexPath is required.");

  function uploadDir(id) {
    return join(dataRoot, safeSegment(id));
  }

  function uploadPath(id, name = "upload.json") {
    return join(uploadDir(id), name);
  }

  function readIndex() {
    return readJsonFile(indexPath, { schemaVersion: 1, updatedAt: "", uploads: [] });
  }

  function writeRecord(record) {
    if (!record?.id) throw new Error("Upload record id is required.");
    mkdirSync(uploadDir(record.id), { recursive: true });
    writeJsonFile(uploadPath(record.id), record);
    const index = readIndex();
    const uploads = Array.isArray(index.uploads) ? index.uploads : [];
    const existingIndex = uploads.findIndex((item) => item.id === record.id);
    const item = indexItem(record);
    if (existingIndex >= 0) uploads[existingIndex] = item;
    else uploads.unshift(item);
    writeJsonFile(indexPath, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      uploads: uploads.slice(0, Math.max(1, indexLimit)),
    });
    return record;
  }

  function readRecord(id) {
    return readJsonFile(uploadPath(id), null);
  }

  function patchRecord(id, patch) {
    const current = readRecord(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    writeRecord(next);
    return next;
  }

  function listRecords({ course = "", limit = 50 } = {}) {
    const normalizedCourse = safeSegment(course || "").toUpperCase();
    const index = readIndex();
    return (index.uploads || [])
      .filter((item) => !normalizedCourse || item.course === normalizedCourse)
      .slice(0, Math.max(1, Math.min(200, Number(limit || 50))));
  }

  function exists(id) {
    return existsSync(uploadPath(id));
  }

  return {
    dataRoot,
    indexPath,
    uploadDir,
    uploadPath,
    readIndex,
    writeRecord,
    readRecord,
    patchRecord,
    listRecords,
    exists,
    publicRecord: publicOssUpload,
  };
}
