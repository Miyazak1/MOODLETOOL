import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const viewSource = readFileSync("public/admin-media-view.js", "utf8");
const uploadSource = readFileSync("public/admin-media-upload.js", "utf8");

const context = {
  window: {
    confirm: () => true,
  },
  setTimeout,
  clearTimeout,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(viewSource, context, { filename: "public/admin-media-view.js" });
vm.runInContext(uploadSource, context, { filename: "public/admin-media-upload.js" });

const upload = context.window.AdminMediaUpload;
assert.equal(upload.inferCourseCodeFromFilename("ESLDO-course-package-20260803.zip", ["ENG4U", "ESLDO"]), "ESLDO");
assert.equal(upload.inferCourseCodeFromFilename("ENG4U Unit 1.zip", ["ENG4U", "ENG3U"]), "ENG4U");
assert.equal(upload.inferCourseCodeFromFilename("unknown.zip", ["ENG4U"]), "");
const selectedCourse = upload.resolveDirectUploadCourse({
  kind: "video",
  file: { name: "clip.mp4", size: 1024 },
  selectedCourse: "eng4u",
  courseCodes: ["ENG4U"],
});
assert.equal(selectedCourse.course, "ENG4U");
assert.equal(selectedCourse.source, "selected-course");

const preview = upload.createDirectUploadPreview({
  kind: "course-package",
  files: [
    { name: "ESLDO-course-package.zip", size: 1024 },
    { name: "ENG4U-course-package.zip", size: 2048 },
  ],
  selectedCourse: "ENG3U",
  courseCodes: ["ENG4U", "ESLDO", "ENG3U"],
});
assert.equal(preview.ok, true);
assert.equal(preview.files, 2);
assert.equal(preview.totalBytes, 3072);
assert.equal(JSON.stringify(preview.courses), JSON.stringify(["ESLDO", "ENG4U"]));
assert.equal(preview.items[0].status, "ready");
assert.equal(preview.items[0].source, "filename");
assert.match(preview.warnings.join("\n"), /当前左侧课程是 ENG3U/);
assert.match(preview.warnings.join("\n"), /完整课件包会按文件名分别上传/);

const mismatchedPreview = upload.createDirectUploadPreview({
  kind: "course-package",
  files: [{ name: "ESLDO-course-package.zip", size: 1024 }],
  selectedCourse: "ENG3U",
  courseCodes: ["ENG4U", "ESLDO", "ENG3U"],
});
assert.equal(mismatchedPreview.ok, true);
assert.match(mismatchedPreview.warnings[0], /当前左侧课程是 ENG3U/);
assert.match(mismatchedPreview.warnings[0], /文件名识别为 ESLDO/);

const invalidPreview = upload.createDirectUploadPreview({
  kind: "course-package",
  files: [{ name: "unknown-course-package.zip", size: 1 }],
  courseCodes: ["ENG4U"],
});
assert.equal(invalidPreview.ok, false);
assert.equal(invalidPreview.items[0].status, "failed");
assert.match(invalidPreview.errors[0], /无法从完整课件包文件名识别课程码/);

const duplicatePreview = upload.createDirectUploadPreview({
  kind: "course-package",
  files: [
    { name: "ENG4U-course-package.zip", size: 1 },
    { name: "ENG4U-course-package-new.zip", size: 2 },
  ],
  courseCodes: ["ENG4U"],
});
assert.equal(duplicatePreview.ok, true);
assert.equal(duplicatePreview.items.filter((item) => item.uploadable !== false).length, 1);
assert.equal(duplicatePreview.items.find((item) => item.status === "skipped").name, "ENG4U-course-package.zip");
assert.match(duplicatePreview.warnings.join("\n"), /ENG4U 本次选择了 2 个完整课件包/);

const wrongTypePreview = upload.createDirectUploadPreview({
  kind: "course-package",
  files: [{ name: "ENG4U-course-package.pdf", size: 1 }],
  courseCodes: ["ENG4U"],
});
assert.equal(wrongTypePreview.ok, false);
assert.match(wrongTypePreview.errors[0], /不是 ZIP 完整课件包/);

const apiCalls = [];
const api = {
  async initOssUpload(payload) {
    apiCalls.push(["init", payload]);
    return {
      ok: true,
      upload: {
        id: `upl-${payload.course}`,
        course: payload.course,
        objectKey: `inbox/uploads/${payload.course}/${payload.fileName}`,
        ossUri: `oss://moodletool/inbox/uploads/${payload.course}/${payload.fileName}`,
      },
      form: {
        method: "POST",
        url: "https://oss.example.test",
        fields: { key: `inbox/uploads/${payload.course}/${payload.fileName}` },
      },
    };
  },
  async completeOssUpload(uploadId, payload) {
    apiCalls.push(["complete", uploadId, payload]);
    return {
      ok: true,
      upload: { id: uploadId, objectKey: payload.objectKey },
      coursePackageTask: { importId: `import-${uploadId}` },
    };
  },
};

const statuses = [];
const queueSnapshots = [];
let refreshes = 0;
let starts = 0;
let writes = 0;
const confirmations = [];
const controller = upload.createDirectUploadController({
  api,
  getKind: () => "course-package",
  getFiles: () => [
    { name: "ESLDO-course-package.zip", size: 1000, type: "application/zip" },
    { name: "ENG4U-course-package.zip", size: 2000, type: "application/zip" },
  ],
  getSelectedCourse: () => "ENG3U",
  getCourseCodes: () => ["ENG4U", "ESLDO", "ENG3U"],
  getAutoPublish: () => true,
  hasActiveWriteJob: () => null,
  jobTypeLabel: (type) => type,
  confirm: (message) => {
    confirmations.push(message);
    return true;
  },
  formatProgress: (file) => ({ percent, loaded, total, objectKey }) => ({
    detail: `${file.name}:${percent}:${loaded}/${total}:${objectKey}`,
    etaText: "10秒",
    speedText: "2 MB/s",
  }),
  onStatus: (status) => statuses.push(status),
  onQueueChange: (items) => queueSnapshots.push(items),
  onRefresh: async () => {
    refreshes += 1;
  },
  onStartRefresh: () => {
    starts += 1;
  },
  onWrite: () => {
    writes += 1;
  },
  uploadObject: async (_form, _file, { onActiveUploadChange, onProgress }) => {
    onActiveUploadChange?.({ abort() {} });
    onProgress?.({ percent: 50, loaded: 500, total: 1000 });
    onActiveUploadChange?.(null);
  },
});

const selectedPreview = controller.previewSelected();
assert.equal(selectedPreview.ok, true);
assert.equal(queueSnapshots.at(-1)[0].status, "ready");
assert.equal(queueSnapshots.at(-1)[1].course, "ENG4U");

const result = await controller.uploadSelected();
assert.equal(result.uploads.length, 2);
assert.match(confirmations.join("\n"), /OSS 直传预检提示/);
assert.match(confirmations.join("\n"), /当前左侧课程是 ENG3U/);
assert.equal(apiCalls.filter(([kind]) => kind === "init").length, 2);
assert.equal(apiCalls[0][1].course, "ESLDO");
assert.equal(apiCalls[2][1].course, "ENG4U");
assert.equal(refreshes, 3);
assert.equal(starts, 3);
assert.equal(writes, 2);
assert.match(statuses.map((item) => item.title).join("\n"), /OSS 直传完成/);
assert.ok(statuses.some((item) => item.detail.includes("ESLDO-course-package.zip:50")));
assert.equal(controller.isUploading(), false);
assert.equal(queueSnapshots[0].length, 2);
assert.equal(queueSnapshots[0][0].course, "ESLDO");
assert.ok(queueSnapshots.some((items) => items[0].status === "uploading" && items[0].percent === 50));
assert.ok(queueSnapshots.some((items) => items[0].loaded === 500 && items[0].total === 1000));
assert.ok(queueSnapshots.some((items) => items[0].speedText === "2 MB/s" && items[0].etaText === "10秒"));
assert.ok(queueSnapshots.some((items) => items[0].overallText === "500 B / 2.9 KB"));
assert.ok(queueSnapshots.at(-1).every((item) => item.status === "done"));

const singleCancelApiCalls = [];
const singleCancelApi = {
  async initOssUpload(payload) {
    singleCancelApiCalls.push(["init", payload]);
    return {
      ok: true,
      upload: {
        id: `single-${payload.course}`,
        course: payload.course,
        objectKey: `inbox/uploads/${payload.course}/${payload.fileName}`,
        ossUri: `oss://moodletool/inbox/uploads/${payload.course}/${payload.fileName}`,
      },
      form: {
        method: "POST",
        url: "https://oss.example.test",
        fields: { key: `inbox/uploads/${payload.course}/${payload.fileName}` },
      },
    };
  },
  async completeOssUpload(uploadId, payload) {
    singleCancelApiCalls.push(["complete", uploadId, payload]);
    return {
      ok: true,
      upload: { id: uploadId, objectKey: payload.objectKey },
    };
  },
};
const singleCancelSnapshots = [];
const singleCancelController = upload.createDirectUploadController({
  api: singleCancelApi,
  getKind: () => "course-package",
  getFiles: () => [
    { name: "ENG4U-course-package.zip", size: 1000, type: "application/zip" },
    { name: "ESLDO-course-package.zip", size: 1000, type: "application/zip" },
  ],
  getSelectedCourse: () => "ENG3U",
  getCourseCodes: () => ["ENG4U", "ESLDO", "ENG3U"],
  getAutoPublish: () => false,
  confirm: () => true,
  onQueueChange: (items) => singleCancelSnapshots.push(items),
  uploadObject: async (_form, _file, { onProgress }) => {
    onProgress?.({ percent: 100, loaded: 1000, total: 1000 });
  },
});
singleCancelController.previewSelected();
const cancelId = singleCancelSnapshots.at(-1)[1].id;
assert.equal(singleCancelController.cancelQueueItem(cancelId), true);
assert.equal(singleCancelSnapshots.at(-1)[1].status, "cancelled");
const singleCancelResult = await singleCancelController.uploadSelected();
assert.equal(singleCancelResult.uploads.length, 1);
assert.equal(singleCancelApiCalls.filter(([kind]) => kind === "init").length, 1);
assert.equal(singleCancelApiCalls.find(([kind]) => kind === "init")[1].course, "ENG4U");
assert.equal(singleCancelSnapshots.at(-1)[0].status, "done");
assert.equal(singleCancelSnapshots.at(-1)[1].status, "cancelled");

class FakeFormData {
  constructor() {
    this.entries = [];
  }
  append(key, value) {
    this.entries.push([key, value]);
  }
}

class FakeXhr {
  constructor() {
    this.upload = {};
    this.status = 204;
    this.responseText = "";
    FakeXhr.last = this;
  }
  open(method, url, asyncFlag) {
    this.method = method;
    this.url = url;
    this.asyncFlag = asyncFlag;
  }
  send(data) {
    this.data = data;
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 64, total: 128 });
      this.onload?.();
    }, 0);
  }
  abort() {
    this.onabort?.();
  }
}

let activeChanges = 0;
let progressEvent = null;
const postResult = await upload.uploadOssPostObject(
  { method: "POST", url: "https://oss.example.test", fields: { key: "object.zip" } },
  { name: "object.zip" },
  {
    XMLHttpRequestImpl: FakeXhr,
    FormDataImpl: FakeFormData,
    onActiveUploadChange: () => {
      activeChanges += 1;
    },
    onProgress: (event) => {
      progressEvent = event;
    },
  },
);
assert.equal(postResult.status, 204);
assert.equal(progressEvent.percent, 50);
assert.equal(activeChanges, 2);
assert.equal(FakeXhr.last.data.entries.at(-1)[0], "file");

const cancelledQueueSnapshots = [];
let cancelledController = null;
cancelledController = upload.createDirectUploadController({
  api,
  getKind: () => "course-package",
  getFiles: () => [
    { name: "ENG4U-course-package.zip", size: 1000, type: "application/zip" },
    { name: "ESLDO-course-package.zip", size: 1000, type: "application/zip" },
  ],
  getSelectedCourse: () => "ENG3U",
  getCourseCodes: () => ["ENG4U", "ESLDO", "ENG3U"],
  getAutoPublish: () => false,
  onStatus: (status) => statuses.push(status),
  onQueueChange: (items) => cancelledQueueSnapshots.push(items),
  uploadObject: async () => {
    cancelledController.cancelActiveUpload();
    throw new Error("已取消 OSS 直传。");
  },
});
const cancelledResult = await cancelledController.uploadSelected();
assert.equal(cancelledResult.canceled, true);
assert.equal(cancelledQueueSnapshots.at(-1)[0].status, "cancelled");
assert.equal(cancelledQueueSnapshots.at(-1)[1].status, "cancelled");
assert.ok(statuses.some((item) => item.title === "OSS 直传已取消"));

console.log("admin media upload smoke ok");
