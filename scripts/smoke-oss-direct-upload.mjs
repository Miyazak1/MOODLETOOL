import assert from "node:assert/strict";
import {
  completeDirectMultipartUpload,
  createDirectMultipartUpload,
  createDirectUploadPolicy,
  directUploadConfigFromEnv,
  directUploadPublicConfig,
  resolveDirectUploadCourse,
} from "./lib/oss-direct-upload.mjs";

const env = {
  OSS_DIRECT_UPLOAD_ENABLED: "1",
  OSS_DIRECT_UPLOAD_BUCKET: "moodletool",
  OSS_DIRECT_UPLOAD_ENDPOINT: "https://oss-cn-hongkong.aliyuncs.com/",
  OSS_DIRECT_UPLOAD_INBOX_PREFIX: "inbox/uploads/",
  OSS_DIRECT_UPLOAD_MAX_GB: "1",
  OSS_DIRECT_UPLOAD_TOKEN_TTL_SECONDS: "600",
  OSS_DIRECT_UPLOAD_ACCESS_KEY_ID: "test-key",
  OSS_DIRECT_UPLOAD_ACCESS_KEY_SECRET: "test-secret",
};

const config = directUploadConfigFromEnv(env);
const publicConfig = directUploadPublicConfig(config);
assert.equal(publicConfig.enabled, true);
assert.equal(publicConfig.configured, true);
assert.equal(publicConfig.bucket, "moodletool");
assert.equal(publicConfig.endpoint, "https://oss-cn-hongkong.aliyuncs.com");
assert.equal(publicConfig.inboxPrefix, "inbox/uploads");
assert.equal(publicConfig.maxGb, 1);

assert.deepEqual(
  resolveDirectUploadCourse({
    kind: "course-package",
    fileName: "ESLDO-course-package-20260803.zip",
    courseCodes: ["ENG3U", "ESLDO"],
  }),
  { course: "ESLDO", source: "filename", kind: "course-package" },
);

const { record, form } = createDirectUploadPolicy({
  config,
  courseCodes: ["ENG3U", "ESLDO"],
  kind: "course-package",
  fileName: "ESLDO-course-package-20260803.zip",
  fileSize: 1000,
  contentType: "",
  actor: "admin",
  mimeTypes: { ".zip": "application/zip" },
});

assert.equal(record.course, "ESLDO");
assert.equal(record.kind, "course-package");
assert.equal(record.bucket, "moodletool");
assert.match(record.objectKey, /^inbox\/uploads\/ESLDO\/upl-\d+-ESLDO-[a-f0-9]+\/ESLDO-course-package-20260803\.zip$/);
assert.equal(record.formUrl, "https://moodletool.oss-cn-hongkong.aliyuncs.com");
assert.equal(form.method, "POST");
assert.equal(form.url, record.formUrl);
assert.equal(form.fields.key, record.objectKey);
assert.equal(form.fields.OSSAccessKeyId, "test-key");
assert.equal(form.fields["Content-Type"], "application/zip");
assert.ok(form.fields.policy);
assert.ok(form.fields.Signature);

assert.throws(
  () => createDirectUploadPolicy({
    config,
    courseCodes: ["ENG3U"],
    kind: "course-package",
    fileName: "UNKNOWN.zip",
    fileSize: 1000,
  }),
  /Could not infer course code/,
);

assert.throws(
  () => createDirectUploadPolicy({
    config,
    courseCodes: ["ENG3U"],
    kind: "video",
    course: "ENG3U",
    fileName: "clip.mp4",
    fileSize: config.maxBytes + 1,
  }),
  /Upload is too large/,
);

const multipartEnv = {
  ...env,
  OSS_DIRECT_UPLOAD_MAX_GB: "10",
  OSS_DIRECT_UPLOAD_PART_MB: "512",
};
const multipartConfig = directUploadConfigFromEnv(multipartEnv);
const multipartCalls = [];
const mockFetch = async (url, options = {}) => {
  multipartCalls.push({ url: String(url), options });
  return {
    ok: true,
    status: 200,
    async text() {
      return "<InitiateMultipartUploadResult><UploadId>mock-upload-id</UploadId></InitiateMultipartUploadResult>";
    },
  };
};
const multipart = await createDirectMultipartUpload({
  config: multipartConfig,
  courseCodes: ["MHF4U"],
  kind: "course-package",
  fileName: "MHF4U-course-package-20260803.zip",
  fileSize: 6 * 1024 * 1024 * 1024,
  actor: "admin",
  fetchImpl: mockFetch,
});
assert.equal(multipart.record.uploadMode, "multipart");
assert.equal(multipart.multipart.uploadId, "mock-upload-id");
assert.equal(multipart.multipart.partCount, 12);
assert.match(multipart.multipart.parts[0].url, /partNumber=1/);
assert.match(multipart.multipart.parts[0].url, /uploadId=mock-upload-id/);
assert.match(multipartCalls[0].url, /\?uploads$/);

const completeCalls = [];
await completeDirectMultipartUpload({
  config: multipartConfig,
  record: multipart.record,
  parts: [
    { partNumber: 2, etag: "\"etag-two\"" },
    { partNumber: 1, etag: "etag-one" },
  ],
  fetchImpl: async (url, options = {}) => {
    completeCalls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async text() {
        return "<CompleteMultipartUploadResult />";
      },
    };
  },
});
assert.match(completeCalls[0].url, /\?uploadId=mock-upload-id$/);
assert.match(String(completeCalls[0].options.body), /<PartNumber>1<\/PartNumber><ETag>etag-one<\/ETag>/);
assert.match(String(completeCalls[0].options.body), /<PartNumber>2<\/PartNumber><ETag>etag-two<\/ETag>/);

console.log("oss direct upload smoke ok");
