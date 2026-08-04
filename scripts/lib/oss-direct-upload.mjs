import { createHmac, randomBytes } from "node:crypto";
import { extname } from "node:path";
import { inferCourseCodeFromFileName, normalizeDirectUploadKind } from "./media-delivery-assets.mjs";

const maxPostObjectBytes = 5 * 1024 * 1024 * 1024;
const defaultMultipartPartBytes = 64 * 1024 * 1024;

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
  const maxGb = Math.max(1, Number(env.OSS_DIRECT_UPLOAD_MAX_GB || 20));
  const multipartPartMb = Math.max(5, Number(env.OSS_DIRECT_UPLOAD_PART_MB || 64));
  return {
    enabled: env.OSS_DIRECT_UPLOAD_ENABLED === "1",
    bucket: env.OSS_DIRECT_UPLOAD_BUCKET || bucketFromUri,
    endpoint: String(env.OSS_DIRECT_UPLOAD_ENDPOINT || "https://oss-cn-hongkong.aliyuncs.com").replace(/\/+$/, ""),
    inboxPrefix: toPosixPath(env.OSS_DIRECT_UPLOAD_INBOX_PREFIX || "inbox/uploads").replace(/^\/+|\/+$/g, ""),
    maxBytes: maxGb * 1024 * 1024 * 1024,
    simpleMaxBytes: maxPostObjectBytes,
    multipartPartBytes: multipartPartMb * 1024 * 1024,
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
    mode: "post-object+multipart",
    bucket: config?.bucket || "",
    endpoint: config?.endpoint || "",
    inboxPrefix: config?.inboxPrefix || "",
    maxBytes: config?.maxBytes || 0,
    maxGb: Math.round(((config?.maxBytes || 0) / 1024 / 1024 / 1024) * 100) / 100,
    simpleMaxGb: Math.round(((config?.simpleMaxBytes || maxPostObjectBytes) / 1024 / 1024 / 1024) * 100) / 100,
    multipartPartMb: Math.round(((config?.multipartPartBytes || defaultMultipartPartBytes) / 1024 / 1024) * 100) / 100,
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

function encodeObjectKey(key) {
  return String(key || "").split("/").map(encodeURIComponent).join("/");
}

function canonicalizedResource(config, objectKey, subresources = {}) {
  const pairs = Object.entries(subresources)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${value === true ? "" : `=${value}`}`);
  return `/${config.bucket}/${objectKey}${pairs.length ? `?${pairs.join("&")}` : ""}`;
}

function signOssRequest({ config, method, objectKey, expires = "", contentType = "", contentMd5 = "", subresources = {}, ossHeaders = {} }) {
  const canonicalHeaders = Object.entries(ossHeaders)
    .map(([key, value]) => [String(key).toLowerCase(), String(value).trim()])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
  const stringToSign = [
    method,
    contentMd5,
    contentType,
    expires,
    `${canonicalHeaders}${canonicalizedResource(config, objectKey, subresources)}`,
  ].join("\n");
  return createHmac("sha1", config.accessKeySecret).update(stringToSign).digest("base64");
}

function ossSignedUrl({ config, method, objectKey, expires, subresources = {} }) {
  const params = new URLSearchParams({
    OSSAccessKeyId: config.accessKeyId,
    Expires: String(expires),
    Signature: signOssRequest({ config, method, objectKey, expires: String(expires), subresources }),
  });
  if (config.securityToken) params.set("security-token", config.securityToken);
  const subresourceQuery = Object.entries(subresources)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => value === true ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${directUploadFormUrl(config.bucket, config.endpoint)}/${encodeObjectKey(objectKey)}?${subresourceQuery}${subresourceQuery ? "&" : ""}${params.toString()}`;
}

async function ossApiFetch({ config, method, objectKey, subresources = {}, body = "", headers = {}, fetchImpl = fetch }) {
  const date = new Date().toUTCString();
  const requestHeaders = {
    Date: date,
    ...headers,
  };
  if (config.securityToken) requestHeaders["x-oss-security-token"] = config.securityToken;
  requestHeaders.Authorization = `OSS ${config.accessKeyId}:${signOssRequest({
    config,
    method,
    objectKey,
    expires: date,
    contentType: requestHeaders["Content-Type"] || requestHeaders["content-type"] || "",
    subresources,
    ossHeaders: config.securityToken ? { "x-oss-security-token": config.securityToken } : {},
  })}`;
  const query = Object.entries(subresources)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => value === true ? encodeURIComponent(key) : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const url = `${directUploadFormUrl(config.bucket, config.endpoint)}/${encodeObjectKey(objectKey)}${query ? `?${query}` : ""}`;
  const response = await fetchImpl(url, {
    method,
    headers: requestHeaders,
    body: body || undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OSS API ${method} failed: HTTP ${response.status} ${text}`.trim());
  return { response, text };
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseUploadId(xml) {
  const match = String(xml || "").match(/<UploadId>([^<]+)<\/UploadId>/i);
  return match ? match[1] : "";
}

function parseXmlTag(xml, tagName) {
  const match = String(xml || "").match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1] : "";
}

function parseUploadedMultipartParts(xml) {
  const parts = [];
  for (const match of String(xml || "").matchAll(/<Part>([\s\S]*?)<\/Part>/gi)) {
    const block = match[1] || "";
    const partNumber = Number(parseXmlTag(block, "PartNumber"));
    const etag = parseXmlTag(block, "ETag").replace(/^"|"$/g, "");
    const size = Number(parseXmlTag(block, "Size") || 0);
    if (Number.isInteger(partNumber) && partNumber > 0 && etag) {
      parts.push({ partNumber, etag, size });
    }
  }
  return {
    parts,
    truncated: /^true$/i.test(parseXmlTag(xml, "IsTruncated").trim()),
    nextPartNumberMarker: parseXmlTag(xml, "NextPartNumberMarker").trim(),
  };
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
    uploadMode: "post-object",
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

export async function createDirectMultipartUpload({ config, courseCodes, course, fileName, fileSize, contentType, kind, actor, mimeTypes = {}, fetchImpl = fetch }) {
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
  const normalizedContentType = contentTypeForUpload(safeName, { fallback: contentType, mimeTypes });
  const initiated = await ossApiFetch({
    config,
    method: "POST",
    objectKey,
    subresources: { uploads: true },
    headers: normalizedContentType ? { "Content-Type": normalizedContentType } : {},
    fetchImpl,
  });
  const multipartUploadId = parseUploadId(initiated.text);
  if (!multipartUploadId) throw new Error("OSS did not return a multipart upload id.");
  const partSize = Math.max(5 * 1024 * 1024, Number(config.multipartPartBytes || defaultMultipartPartBytes));
  const partCount = Math.ceil(size / partSize);
  if (partCount > 10000) throw new Error("Upload has too many parts. Increase OSS_DIRECT_UPLOAD_PART_MB.");
  const expiresAt = new Date(Date.now() + config.ttlSeconds * 1000).toISOString();
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
    uploadMode: "multipart",
    multipartUploadId,
    multipartPartBytes: partSize,
    multipartPartCount: partCount,
    requestedBy: actor || "unknown",
    requestedAt: new Date().toISOString(),
    expiresAt,
    completedAt: null,
    jobId: "",
    error: "",
  };
  const multipart = createMultipartPlan({ config, record, uploadedParts: [] });
  return { record, multipart };
}

function createMultipartPlan({ config, record, uploadedParts = [] }) {
  const size = Number(record.fileSize || 0);
  const partSize = Math.max(5 * 1024 * 1024, Number(record.multipartPartBytes || config.multipartPartBytes || defaultMultipartPartBytes));
  const partCount = Math.ceil(size / partSize);
  if (partCount > 10000) throw new Error("Upload has too many parts. Increase OSS_DIRECT_UPLOAD_PART_MB.");
  const expiresAt = new Date(Date.now() + config.ttlSeconds * 1000).toISOString();
  const expires = Math.floor(Date.now() / 1000) + config.ttlSeconds;
  const parts = Array.from({ length: partCount }, (_, index) => {
    const partNumber = index + 1;
    return {
      partNumber,
      start: index * partSize,
      end: Math.min(size, (index + 1) * partSize),
      url: ossSignedUrl({
        config,
        method: "PUT",
        objectKey: record.objectKey,
        expires,
        subresources: { partNumber, uploadId: record.multipartUploadId },
      }),
    };
  });
  return {
    method: "PUT",
    uploadId: record.multipartUploadId,
    partSize,
    partCount,
    expiresAt,
    resume: uploadedParts.length > 0,
    uploadedParts,
    uploadedBytes: uploadedParts.reduce((sum, part) => sum + Math.max(0, Number(part.size || 0)), 0),
    parts,
  };
}

export async function listDirectMultipartUploadedParts({ config, record, fetchImpl = fetch }) {
  assertDirectUploadReady(config);
  if (!record?.objectKey || !record?.multipartUploadId) throw new Error("Multipart upload record is incomplete.");
  const parts = [];
  let marker = "";
  for (let page = 0; page < 100; page += 1) {
    const { text } = await ossApiFetch({
      config,
      method: "GET",
      objectKey: record.objectKey,
      subresources: {
        uploadId: record.multipartUploadId,
        ...(marker ? { "part-number-marker": marker } : {}),
      },
      fetchImpl,
    });
    const parsed = parseUploadedMultipartParts(text);
    parts.push(...parsed.parts);
    if (!parsed.truncated || !parsed.nextPartNumberMarker) break;
    marker = parsed.nextPartNumberMarker;
  }
  return parts.sort((left, right) => left.partNumber - right.partNumber);
}

export async function resumeDirectMultipartUpload({ config, record, fetchImpl = fetch }) {
  assertDirectUploadReady(config);
  if (record?.uploadMode !== "multipart") throw new Error("Upload record is not multipart.");
  const uploadedParts = await listDirectMultipartUploadedParts({ config, record, fetchImpl });
  const multipart = createMultipartPlan({ config, record, uploadedParts });
  record.expiresAt = multipart.expiresAt;
  record.multipartPartBytes = multipart.partSize;
  record.multipartPartCount = multipart.partCount;
  record.resumeCount = Number(record.resumeCount || 0) + 1;
  record.resumedAt = new Date().toISOString();
  record.status = "initialized";
  record.error = "";
  return { record, multipart };
}

export async function completeDirectMultipartUpload({ config, record, parts = [], fetchImpl = fetch }) {
  assertDirectUploadReady(config);
  if (!record?.objectKey || !record?.multipartUploadId) throw new Error("Multipart upload record is incomplete.");
  const validParts = (Array.isArray(parts) ? parts : [])
    .map((part) => ({
      partNumber: Number(part.partNumber),
      etag: String(part.etag || "").replace(/^"|"$/g, ""),
    }))
    .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && part.etag)
    .sort((left, right) => left.partNumber - right.partNumber);
  if (!validParts.length) throw new Error("No uploaded multipart parts were provided.");
  const body = [
    "<CompleteMultipartUpload>",
    ...validParts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`),
    "</CompleteMultipartUpload>",
  ].join("");
  await ossApiFetch({
    config,
    method: "POST",
    objectKey: record.objectKey,
    subresources: { uploadId: record.multipartUploadId },
    body,
    headers: { "Content-Type": "application/xml" },
    fetchImpl,
  });
  return { parts: validParts };
}
