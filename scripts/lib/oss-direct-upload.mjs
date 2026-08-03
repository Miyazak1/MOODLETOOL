import { createHmac, randomBytes } from "node:crypto";
import { extname } from "node:path";
import { inferCourseCodeFromFileName, normalizeDirectUploadKind } from "./media-delivery-assets.mjs";

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

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

export function directUploadConfigFromEnv(env = process.env, { ossBucketUri = "" } = {}) {
  const bucketFromUri = String(ossBucketUri || "").replace(/^oss:\/\//i, "").split("/")[0] || "";
  const maxGb = Math.max(1, Number(env.OSS_DIRECT_UPLOAD_MAX_GB || 5));
  return {
    enabled: env.OSS_DIRECT_UPLOAD_ENABLED === "1",
    bucket: env.OSS_DIRECT_UPLOAD_BUCKET || bucketFromUri,
    endpoint: String(env.OSS_DIRECT_UPLOAD_ENDPOINT || "https://oss-cn-hongkong.aliyuncs.com").replace(/\/+$/, ""),
    inboxPrefix: toPosixPath(env.OSS_DIRECT_UPLOAD_INBOX_PREFIX || "inbox/uploads").replace(/^\/+|\/+$/g, ""),
    maxBytes: maxGb * 1024 * 1024 * 1024,
    ttlSeconds: Math.max(60, Number(env.OSS_DIRECT_UPLOAD_TOKEN_TTL_SECONDS || 1800)),
    accessKeyId: env.OSS_DIRECT_UPLOAD_ACCESS_KEY_ID || env.ALIBABA_CLOUD_ACCESS_KEY_ID || env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: env.OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET || env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || env.OSS_ACCESS_KEY_SECRET || "",
    securityToken: env.OSS_DIRECT_UPLOAD_SECURITY_TOKEN || env.ALIBABA_CLOUD_SECURITY_TOKEN || "",
  };
}

export function directUploadPublicConfig(config) {
  const configured = Boolean(config?.bucket && config?.endpoint && config?.accessKeyId && config?.accessKeySecret);
  return {
    enabled: Boolean(config?.enabled),
    configured,
    mode: "post-object",
    bucket: config?.bucket || "",
    endpoint: config?.endpoint || "",
    inboxPrefix: config?.inboxPrefix || "",
    maxBytes: config?.maxBytes || 0,
    maxGb: Math.round(((config?.maxBytes || 0) / 1024 / 1024 / 1024) * 100) / 100,
    ttlSeconds: config?.ttlSeconds || 0,
    reason: config?.enabled
      ? configured
        ? ""
        : "OSS direct upload credentials are not configured on the server."
      : "OSS direct upload is disabled. Set OSS_DIRECT_UPLOAD_ENABLED=1.",
  };
}

export function directUploadFormUrl(bucket, endpoint) {
  const parsed = new URL(endpoint);
  return `${parsed.protocol}//${bucket}.${parsed.host}`;
}

export function contentTypeForUpload(filename, { fallback = "", mimeTypes = {} } = {}) {
  const ext = extname(filename || "").toLowerCase();
  return fallback || mimeTypes[ext] || "application/octet-stream";
}

function assertDirectUploadReady(config) {
  const publicConfig = directUploadPublicConfig(config);
  if (!publicConfig.enabled) throw new Error(publicConfig.reason);
  if (!publicConfig.configured) throw new Error(publicConfig.reason);
}

export function resolveDirectUploadCourse({ course, fileName, kind, courseCodes = [] }) {
  const selectedCourse = safeSegment(course || "").toUpperCase();
  const uploadKind = normalizeDirectUploadKind(kind);
  if (uploadKind !== "course-package") {
    if (!selectedCourse) throw new Error("Course is required.");
    return { course: selectedCourse, source: "selected-course", kind: uploadKind };
  }
  const inferred = inferCourseCodeFromFileName(fileName, courseCodes);
  if (!inferred) {
    throw new Error("Could not infer course code from course package filename. Rename it like ESLDO-course-package-20260803.zip and try again.");
  }
  return { course: inferred, source: "filename", kind: uploadKind };
}

export function createDirectUploadPolicy({ config, courseCodes, course, fileName, fileSize, contentType, kind, actor, mimeTypes = {} }) {
  assertDirectUploadReady(config);
  const resolvedCourse = resolveDirectUploadCourse({ course, fileName, kind, courseCodes });
  const code = resolvedCourse.course;
  const safeName = safeSegment(fileName || "upload.bin") || "upload.bin";
  if (!extname(safeName)) throw new Error("Upload file must have an extension.");
  const size = Number(fileSize || 0);
  if (!Number.isFinite(size) || size <= 0) throw new Error("fileSize is required.");
  if (size > config.maxBytes) {
    throw new Error(`Upload is too large. Max direct upload size is ${Math.round(config.maxBytes / 1024 / 1024 / 1024)} GB.`);
  }
  const uploadId = `upl-${Date.now()}-${code}-${randomBytes(4).toString("hex")}`;
  const objectKey = `${config.inboxPrefix}/${code}/${uploadId}/${safeName}`;
  const expiresAt = new Date(Date.now() + config.ttlSeconds * 1000).toISOString();
  const policy = {
    expiration: expiresAt,
    conditions: [
      { bucket: config.bucket },
      ["eq", "$key", objectKey],
      ["content-length-range", 1, config.maxBytes],
      ["starts-with", "$Content-Type", ""],
    ],
  };
  if (config.securityToken) {
    policy.conditions.push({ "x-oss-security-token": config.securityToken });
  }
  const encodedPolicy = Buffer.from(JSON.stringify(policy), "utf8").toString("base64");
  const signature = createHmac("sha1", config.accessKeySecret).update(encodedPolicy).digest("base64");
  const normalizedContentType = contentTypeForUpload(safeName, { fallback: contentType, mimeTypes });
  const record = {
    schemaVersion: 1,
    id: uploadId,
    course: code,
    courseSource: resolvedCourse.source,
    kind: resolvedCourse.kind,
    status: "initialized",
    fileName: safeName,
    fileSize: size,
    contentType: normalizedContentType,
    bucket: config.bucket,
    endpoint: config.endpoint,
    objectKey,
    ossUri: `oss://${config.bucket}/${objectKey}`,
    formUrl: directUploadFormUrl(config.bucket, config.endpoint),
    requestedBy: actor || "unknown",
    requestedAt: new Date().toISOString(),
    expiresAt,
    completedAt: null,
    jobId: "",
    error: "",
  };
  return {
    record,
    form: {
      method: "POST",
      url: record.formUrl,
      fields: {
        key: objectKey,
        policy: encodedPolicy,
        OSSAccessKeyId: config.accessKeyId,
        Signature: signature,
        success_action_status: "200",
        "Content-Type": normalizedContentType,
        ...(config.securityToken ? { "x-oss-security-token": config.securityToken } : {}),
      },
    },
  };
}
