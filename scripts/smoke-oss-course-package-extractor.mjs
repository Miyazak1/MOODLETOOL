import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  buildExtractCallbackPayload,
  contentTypeForObjectKey,
  courseRelativePathFromZipEntry,
  extractOssEventObject,
  isExtractableCoursewareAsset,
  isLightweightCourseContentAsset,
  normalizeZipEntryPath,
  parseCourseUploadFromObjectKey,
  targetObjectKeyForEntry,
} from "./lib/oss-course-package-extractor-core.mjs";

assert.equal(normalizeZipEntryPath("../bad.mp4"), "");
assert.equal(normalizeZipEntryPath("C:/tmp/MHF4U/video/a.mp4"), "tmp/MHF4U/video/a.mp4");
assert.equal(courseRelativePathFromZipEntry("courseware-active/MHF4U/localized-moodle/video/a.mp4", "MHF4U"), "localized-moodle/video/a.mp4");
assert.equal(courseRelativePathFromZipEntry("MHF4U/html5-package/data/slide.js", "MHF4U"), "html5-package/data/slide.js");
assert.equal(isExtractableCoursewareAsset("localized-moodle/video/a.mp4"), true);
assert.equal(isExtractableCoursewareAsset("localized-moodle/h5p/activity.h5p"), true);
assert.equal(isExtractableCoursewareAsset("Unit 1/html5-package/presentation.html"), true);
assert.equal(isExtractableCoursewareAsset("teacher-docs/notes.docx"), false);
assert.equal(isLightweightCourseContentAsset("localized-moodle-activities/assign/U01/index.html", { size: 1024 }), true);
assert.equal(isLightweightCourseContentAsset("previews-html/assign/U01/index.html", { size: 1024 }), false);
assert.equal(isLightweightCourseContentAsset("teacher-docs/huge.pdf", { size: 51 * 1024 * 1024 }), false);
assert.equal(targetObjectKeyForEntry("MHF4U/html5-package/data/slide.js", {
  course: "MHF4U",
  targetPrefix: "courseware-active/MHF4U/",
}), "courseware-active/MHF4U/html5-package/data/slide.js");
assert.equal(contentTypeForObjectKey("courseware-active/MHF4U/html5-package/data/slide.js"), "application/javascript; charset=utf-8");
assert.deepEqual(parseCourseUploadFromObjectKey("inbox/uploads/MHF4U/upl-123/MHF4U-course-package.zip"), {
  course: "MHF4U",
  uploadId: "upl-123",
  fileName: "MHF4U-course-package.zip",
  objectKey: "inbox/uploads/MHF4U/upl-123/MHF4U-course-package.zip",
});
assert.deepEqual(extractOssEventObject(JSON.stringify({
  events: [{ oss: { bucket: { name: "moodletool" }, object: { key: "inbox/uploads/MHF4U/upl-123/MHF4U-course-package.zip" } } }],
})), {
  bucket: "moodletool",
  objectKey: "inbox/uploads/MHF4U/upl-123/MHF4U-course-package.zip",
});
assert.equal(buildExtractCallbackPayload({
  uploadId: "upl-123",
  course: "mhf4u",
  sourceObjectKey: "inbox/uploads/MHF4U/upl-123/MHF4U-course-package.zip",
  targetPrefix: "courseware-active/MHF4U",
  summary: { extracted: 2 },
}).targetPrefix, "courseware-active/MHF4U/");

const { extractEntries } = await import("../functions/oss-course-package-extractor/index.mjs");

class FakeEntry extends Readable {
  constructor(path, content, vars = {}) {
    super();
    this.path = path;
    this.type = "File";
    this.vars = { uncompressedSize: Buffer.byteLength(content), ...vars };
    this.content = Buffer.from(content);
  }
  _read() {
    this.push(this.content);
    this.push(null);
  }
  autodrain() {
    this.resume();
  }
}

async function* entries() {
  yield new FakeEntry("MHF4U/localized-moodle/video/a.mp4", "video");
  yield new FakeEntry("MHF4U/html5-package/data/slide.js", "js");
  yield new FakeEntry("MHF4U/teacher-docs/notes.docx", "doc");
  yield new FakeEntry("MHF4U/previews-html/notes.html", "preview");
}

const putKeys = [];
let importManifest = null;
const client = {
  async putStream(key, stream, options) {
    putKeys.push({ key, contentType: options?.headers?.["Content-Type"] || "" });
    const chunks = [];
    for await (const _chunk of stream) {
      chunks.push(Buffer.from(_chunk));
    }
    if (key.endsWith("/import-manifest.json")) {
      importManifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
  },
};
const summary = await extractEntries({
  entries: Readable.from(entries()),
  client,
  bucket: "moodletool",
  objectKey: "inbox/uploads/MHF4U/upl-123/MHF4U-course-package.zip",
  course: "MHF4U",
  uploadId: "upl-123",
  targetPrefix: "courseware-active/MHF4U/",
  config: {
    objectPrefix: "courseware-active",
    assetScope: "playable",
    dryRun: false,
  },
});
assert.equal(summary.extracted, 2);
assert.equal(summary.mediaExtracted, 2);
assert.equal(summary.lightweightCandidates, 1);
assert.equal(summary.skipped, 1);
assert.equal(summary.status, "media-ready");
assert.deepEqual(putKeys.map((item) => item.key), [
  "courseware-active/MHF4U/localized-moodle/video/a.mp4",
  "courseware-active/MHF4U/html5-package/data/slide.js",
  "inbox/lightweight/MHF4U/upl-123/teacher-docs/notes.docx",
  "inbox/manifests/MHF4U/upl-123/import-manifest.json",
]);
assert.equal(putKeys[0].contentType, "video/mp4");
assert.equal(importManifest.summary.media, 2);
assert.equal(importManifest.summary.lightweight, 1);
assert.equal(importManifest.lightweightFiles[0].kind, "document");
assert.equal(importManifest.lightweightFiles[0].objectKey, "inbox/lightweight/MHF4U/upl-123/teacher-docs/notes.docx");

console.log("OSS course package extractor smoke passed.");
