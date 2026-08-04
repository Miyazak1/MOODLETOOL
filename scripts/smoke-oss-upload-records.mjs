import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOssUploadRecordStore, publicOssUpload } from "./lib/oss-upload-records.mjs";

const root = mkdtempSync(join(tmpdir(), "oss-upload-records-"));

try {
  const store = createOssUploadRecordStore({
    dataRoot: join(root, "records"),
    indexPath: join(root, "index.json"),
    indexLimit: 2,
  });

  const baseRecord = {
    id: "upl-1",
    course: "ENG3U",
    courseSource: "filename",
    kind: "course-package",
    status: "initialized",
    fileName: "ENG3U-course-package.zip",
    fileSize: 1234,
    contentType: "application/zip",
    bucket: "moodletool",
    endpoint: "https://oss-cn-hongkong.aliyuncs.com",
    objectKey: "inbox/uploads/ENG3U/upl-1/ENG3U-course-package.zip",
    ossUri: "oss://moodletool/inbox/uploads/ENG3U/upl-1/ENG3U-course-package.zip",
    requestedBy: "admin",
    requestedAt: "2026-08-03T00:00:00.000Z",
    expiresAt: "2026-08-03T00:30:00.000Z",
    internalOnly: "hidden",
  };

  store.writeRecord(baseRecord);
  assert.equal(store.exists("upl-1"), true);
  assert.equal(store.readRecord("upl-1").fileName, "ENG3U-course-package.zip");
  assert.equal(store.listRecords({ course: "ENG3U" }).length, 1);
  assert.equal(store.listRecords({ course: "ESLDO" }).length, 0);

  const patched = store.patchRecord("upl-1", {
    status: "queued",
    jobId: "media-1",
    completedAt: "2026-08-03T00:10:00.000Z",
    importMode: "oss-only",
    ossOnly: true,
    ingestMessage: "等待 OSS-side 解压/索引",
  });
  assert.equal(patched.status, "queued");
  assert.equal(store.readRecord("upl-1").jobId, "media-1");
  assert.equal(store.readIndex().uploads[0].status, "queued");

  store.writeRecord({ ...baseRecord, id: "upl-2", course: "ESLDO", objectKey: "inbox/uploads/ESLDO/upl-2/package.zip" });
  store.writeRecord({ ...baseRecord, id: "upl-3", course: "ENG4U", objectKey: "inbox/uploads/ENG4U/upl-3/package.zip" });
  assert.deepEqual(store.readIndex().uploads.map((item) => item.id), ["upl-3", "upl-2"]);

  const publicRecord = publicOssUpload(store.readRecord("upl-1"));
  assert.equal(publicRecord.id, "upl-1");
  assert.equal(publicRecord.jobId, "media-1");
  assert.equal(publicRecord.importMode, "oss-only");
  assert.equal(publicRecord.ossOnly, true);
  assert.equal(publicRecord.ingestMessage, "等待 OSS-side 解压/索引");
  assert.equal(publicRecord.internalOnly, undefined);

  assert.equal(store.patchRecord("missing", { status: "failed" }), null);

  console.log("oss upload records smoke ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
