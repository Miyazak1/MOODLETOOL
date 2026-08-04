#!/usr/bin/env node
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  buildExtractCallbackPayload,
  contentTypeForObjectKey,
  extractOssEventObject,
  parseCourseUploadFromObjectKey,
  safeCourse,
  stripSlash,
  targetObjectKeyForEntry,
} from "../../scripts/lib/oss-course-package-extractor-core.mjs";

function parseArgs(argv) {
  const out = {
    bucket: "",
    objectKey: "",
    course: "",
    uploadId: "",
    targetPrefix: "",
    objectPrefix: "",
    inboxPrefix: "",
    assetScope: "",
    portalCallback: "",
    callbackSecret: "",
    region: "",
    endpoint: "",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--bucket") out.bucket = argv[++i] || "";
    else if (arg === "--object-key") out.objectKey = argv[++i] || "";
    else if (arg === "--course") out.course = argv[++i] || "";
    else if (arg === "--upload-id") out.uploadId = argv[++i] || "";
    else if (arg === "--target-prefix") out.targetPrefix = argv[++i] || "";
    else if (arg === "--object-prefix") out.objectPrefix = argv[++i] || "";
    else if (arg === "--inbox-prefix") out.inboxPrefix = argv[++i] || "";
    else if (arg === "--asset-scope") out.assetScope = argv[++i] || "";
    else if (arg === "--portal-callback") out.portalCallback = argv[++i] || "";
    else if (arg === "--callback-secret") out.callbackSecret = argv[++i] || "";
    else if (arg === "--region") out.region = argv[++i] || "";
    else if (arg === "--endpoint") out.endpoint = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node functions/oss-course-package-extractor/index.mjs --bucket moodletool --object-key inbox/uploads/MHF4U/upl-123/MHF4U-course-package.zip --portal-callback https://www.moodletool.work/api/admin/oss/uploads/upl-123/extracted

Environment:
  OSS_EXTRACT_REGION=oss-cn-hongkong
  OSS_EXTRACT_BUCKET=moodletool
  OSS_EXTRACT_ENDPOINT=https://oss-cn-hongkong.aliyuncs.com
  OSS_EXTRACT_ACCESS_KEY_ID=...
  OSS_EXTRACT_ACCESS_KEY_SECRET=...
  OSS_EXTRACT_CALLBACK_SECRET=...
  PORTAL_EXTRACT_CALLBACK_BASE=https://www.moodletool.work

The worker streams the ZIP from OSS and writes playable assets to courseware-active/{COURSE}/ in OSS. It does not write course files to ECS.`);
}

function envConfig(env = process.env, args = {}) {
  return {
    bucket: args.bucket || env.OSS_EXTRACT_BUCKET || env.OSS_DIRECT_UPLOAD_BUCKET || "",
    region: args.region || env.OSS_EXTRACT_REGION || env.OSS_REGION || "oss-cn-hongkong",
    endpoint: String(args.endpoint || env.OSS_EXTRACT_ENDPOINT || env.OSS_DIRECT_UPLOAD_ENDPOINT || "https://oss-cn-hongkong.aliyuncs.com").replace(/\/+$/, ""),
    accessKeyId: env.OSS_EXTRACT_ACCESS_KEY_ID || env.OSS_DIRECT_UPLOAD_ACCESS_KEY_ID || env.ALIBABA_CLOUD_ACCESS_KEY_ID || env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: env.OSS_EXTRACT_ACCESS_KEY_SECRET || env.OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET || env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || env.OSS_ACCESS_KEY_SECRET || "",
    stsToken: env.OSS_EXTRACT_STS_TOKEN || env.OSS_DIRECT_UPLOAD_SECURITY_TOKEN || env.ALIBABA_CLOUD_SECURITY_TOKEN || "",
    objectPrefix: stripSlash(args.objectPrefix || env.COURSEWARE_ASSET_PREFIX || "courseware-active"),
    inboxPrefix: stripSlash(args.inboxPrefix || env.OSS_DIRECT_UPLOAD_INBOX_PREFIX || "inbox/uploads"),
    assetScope: String(args.assetScope || env.COURSEWARE_OSS_ASSET_SCOPE || "playable").toLowerCase(),
    portalCallback: args.portalCallback || env.PORTAL_EXTRACT_CALLBACK_URL || "",
    portalCallbackBase: String(env.PORTAL_EXTRACT_CALLBACK_BASE || env.EMBED_PUBLIC_ORIGIN || "").replace(/\/+$/, ""),
    callbackSecret: args.callbackSecret || env.OSS_EXTRACT_CALLBACK_SECRET || "",
    dryRun: Boolean(args.dryRun),
  };
}

async function createOssClient(config) {
  const module = await import("ali-oss");
  const OSS = module.default || module;
  const options = {
    bucket: config.bucket,
    region: config.region,
    secure: true,
  };
  if (config.endpoint) options.endpoint = config.endpoint;
  if (config.accessKeyId) options.accessKeyId = config.accessKeyId;
  if (config.accessKeySecret) options.accessKeySecret = config.accessKeySecret;
  if (config.stsToken) options.stsToken = config.stsToken;
  return new OSS(options);
}

async function streamFromOss(client, objectKey) {
  const result = await client.getStream(objectKey);
  return result.stream || result.res || result;
}

async function putEntryStream(client, objectKey, entry) {
  return client.putStream(objectKey, entry, {
    headers: {
      "Content-Type": contentTypeForObjectKey(objectKey),
      "Cache-Control": "public, max-age=2592000",
    },
  });
}

async function notifyPortal({ config, uploadId, payload, fetchImpl = fetch }) {
  const callbackUrl = config.portalCallback
    || (config.portalCallbackBase && uploadId
      ? `${config.portalCallbackBase}/api/admin/oss/uploads/${encodeURIComponent(uploadId)}/extracted`
      : "");
  if (!callbackUrl) return { skipped: true, reason: "No portal callback URL configured." };
  if (!config.callbackSecret) return { skipped: true, reason: "No OSS_EXTRACT_CALLBACK_SECRET configured." };
  const response = await fetchImpl(callbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.callbackSecret}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Portal callback failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, text };
  }
}

export async function extractEntries({ entries, client, bucket, objectKey, course, targetPrefix, config }) {
  const code = safeCourse(course);
  if (!code) throw new Error("Course is required.");
  const finalTargetPrefix = stripSlash(targetPrefix || `${config.objectPrefix}/${code}`);
  const summary = {
    bucket,
    sourceObjectKey: objectKey,
    course: code,
    targetPrefix: `${finalTargetPrefix}/`,
    assetScope: config.assetScope,
    entries: 0,
    extracted: 0,
    skipped: 0,
    uploadedBytes: 0,
    skippedBytes: 0,
    startedAt: new Date().toISOString(),
    finishedAt: "",
  };

  for await (const entry of entries) {
    summary.entries += 1;
    const targetKey = targetObjectKeyForEntry(entry.path, {
      course: code,
      targetPrefix: finalTargetPrefix,
      objectPrefix: config.objectPrefix,
      assetScope: config.assetScope,
    });
    const size = Number(entry.vars?.uncompressedSize || entry.vars?.compressedSize || 0);
    if (!targetKey || entry.type === "Directory") {
      summary.skipped += 1;
      summary.skippedBytes += Number.isFinite(size) ? size : 0;
      entry.autodrain();
      continue;
    }
    if (config.dryRun) {
      summary.extracted += 1;
      summary.uploadedBytes += Number.isFinite(size) ? size : 0;
      entry.autodrain();
      continue;
    }
    await putEntryStream(client, targetKey, entry);
    summary.extracted += 1;
    summary.uploadedBytes += Number.isFinite(size) ? size : 0;
  }
  summary.finishedAt = new Date().toISOString();
  return summary;
}

export async function extractCoursePackage({ client, bucket, objectKey, course, uploadId, targetPrefix, config, fetchImpl = fetch }) {
  if (!client) throw new Error("OSS client is required.");
  const code = safeCourse(course);
  if (!code) throw new Error("Course is required.");
  if (!objectKey) throw new Error("OSS object key is required.");
  const unzipper = await import("unzipper");
  const source = await streamFromOss(client, objectKey);
  const parser = source.pipe(unzipper.Parse({ forceStream: true }));
  const summary = await extractEntries({
    entries: parser,
    client,
    bucket,
    objectKey,
    course: code,
    targetPrefix,
    config,
  });

  const callbackPayload = buildExtractCallbackPayload({
    uploadId,
    course: code,
    sourceObjectKey: objectKey,
    targetPrefix: summary.targetPrefix,
    summary,
  });
  const callback = config.dryRun ? { skipped: true, reason: "dry-run" } : await notifyPortal({ config, uploadId, payload: callbackPayload, fetchImpl });
  return { ok: true, summary, callback };
}

function resolveInvocation(input = {}, config) {
  const bucket = input.bucket || config.bucket;
  const objectKey = input.objectKey || "";
  const parsed = parseCourseUploadFromObjectKey(objectKey, { inboxPrefix: config.inboxPrefix });
  const course = safeCourse(input.course || parsed?.course || "");
  const uploadId = input.uploadId || parsed?.uploadId || "";
  const targetPrefix = stripSlash(input.targetPrefix || `${config.objectPrefix}/${course}`);
  return { bucket, objectKey, course, uploadId, targetPrefix };
}

export async function run(input = {}, { env = process.env, fetchImpl = fetch } = {}) {
  const args = {
    ...input,
    objectKey: input.objectKey || input["object-key"] || "",
    targetPrefix: input.targetPrefix || input["target-prefix"] || "",
    objectPrefix: input.objectPrefix || input["object-prefix"] || "",
    inboxPrefix: input.inboxPrefix || input["inbox-prefix"] || "",
    assetScope: input.assetScope || input["asset-scope"] || "",
    portalCallback: input.portalCallback || input["portal-callback"] || "",
    callbackSecret: input.callbackSecret || input["callback-secret"] || "",
  };
  const config = envConfig(env, args);
  const invocation = resolveInvocation(args, config);
  if (!invocation.bucket) throw new Error("Missing OSS bucket.");
  if (!invocation.objectKey) throw new Error("Missing OSS object key.");
  if (!invocation.course) throw new Error("Cannot resolve course code from OSS object key.");
  const client = await createOssClient({ ...config, bucket: invocation.bucket });
  return extractCoursePackage({
    client,
    bucket: invocation.bucket,
    objectKey: invocation.objectKey,
    course: invocation.course,
    uploadId: invocation.uploadId,
    targetPrefix: invocation.targetPrefix,
    config,
    fetchImpl,
  });
}

export async function handler(event, context, callback) {
  try {
    const ossObject = extractOssEventObject(event);
    const result = await run({
      bucket: ossObject.bucket,
      objectKey: ossObject.objectKey,
    }, { env: process.env });
    callback?.(null, result);
    return result;
  } catch (error) {
    callback?.(error);
    throw error;
  }
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of Readable.from(process.stdin)) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const cliArgs = parseArgs(process.argv.slice(2));
    const event = await readStdinJson();
    const eventObject = event ? extractOssEventObject(event) : {};
    const result = await run({
      ...cliArgs,
      bucket: cliArgs.bucket || eventObject.bucket,
      objectKey: cliArgs.objectKey || eventObject.objectKey,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  }
}
