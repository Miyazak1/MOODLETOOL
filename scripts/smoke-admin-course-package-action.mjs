import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-course-package-action.js", "utf8");
const context = {
  URLSearchParams,
  window: {},
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-course-package-action.js" });

const mod = context.window.AdminCoursePackageAction;

function makeFile(overrides = {}) {
  return {
    name: "ENG4U-course.zip",
    size: 25,
    slice(start, end) {
      return { start, end };
    },
    ...overrides,
  };
}

function makeFields(file = makeFile(), course = "ENG4U") {
  return {
    course: { value: course },
    coursePackageFile: { files: file ? [file] : [] },
  };
}

function createHarness({
  file = makeFile(),
  course = "ENG4U",
  chunkBytes = 10,
  restoredTask = null,
  uploadChunk,
  waitForReview,
  currentImport = null,
  commitState,
  confirmCommit = () => true,
  commitPackage,
} = {}) {
  const statuses = [];
  const writes = [];
  const remembers = [];
  const disabled = [];
  const previews = [];
  const clears = [];
  const successes = [];
  const commitSuccesses = [];
  const uploadedChunks = [];
  const commits = [];
  const fields = makeFields(file, course);
  fields.coursePackageFile.value = file ? `C:\\fake\\${file.name}` : "";
  const action = mod.createAction({
    fields,
    chunkBytes,
    chunkMaxRetries: 5,
    formatBytes(bytes) {
      return `${bytes} B`;
    },
    async uploadChunk(args) {
      uploadedChunks.push(args);
      return uploadChunk ? uploadChunk(args, uploadedChunks.length - 1) : { ok: true, complete: true, operations: [{}] };
    },
    async restoreTask() {
      return restoredTask;
    },
    async waitForReview(importId) {
      return waitForReview ? waitForReview(importId) : { ok: true, importId, operations: [{}] };
    },
    rememberTask(task) {
      remembers.push(task);
    },
    setStatus(status) {
      statuses.push(status);
    },
    clearPreview() {
      clears.push("preview");
    },
    clearCommitState() {
      clears.push("commit");
    },
    reusableImportId(uploadedFile) {
      return `import-${uploadedFile.name}-${uploadedFile.size}`;
    },
    renderPreview(data) {
      previews.push(data);
    },
    write(value) {
      writes.push(value);
    },
    async afterSuccess(data, uploadedFile) {
      successes.push({ data, uploadedFile });
    },
    getCurrentImport() {
      return currentImport;
    },
    setUploadDisabled(value) {
      disabled.push(value);
    },
    updateCommitState(data) {
      return commitState || { hasReady: true, courseMatches: true, selected: fields.course.value, previewCourse: data?.course };
    },
    async commitPackage(args) {
      commits.push(args);
      return commitPackage ? commitPackage(args) : { ok: true, backups: ["manifest"] };
    },
    confirmCommit,
    clearPackageFile() {
      fields.coursePackageFile.value = "";
    },
    async afterCommitSuccess(data) {
      commitSuccesses.push(data);
    },
  });
  return { action, disabled, fields, previews, remembers, statuses, successes, uploadedChunks, writes, clears, commits, commitSuccesses };
}

assert.equal(mod.chunkCount(25, 10), 3);
assert.equal(
  mod.chunkUrl({ course: "ENG4U", filename: "course.zip", importId: "abc", index: 2, chunkTotal: 5, totalBytes: 123 }),
  "/api/admin/course-package/chunk?course=ENG4U&filename=course.zip&importId=abc&chunkIndex=2&chunkTotal=5&totalBytes=123",
);
assert.equal(
  mod.resumableStartChunk({
    restoredTask: { importId: "a", filename: "x.zip", totalBytes: 20, chunksReceived: 9 },
    importId: "a",
    filename: "x.zip",
    totalBytes: 20,
    chunkTotal: 4,
  }),
  4,
);

{
  const { action, statuses, writes } = createHarness({ file: null });
  const result = await action.uploadCoursePackage();
  assert.equal(result, undefined);
  assert.equal(statuses.at(-1).title, "请选择整课 ZIP 压缩包");
  assert.equal(writes.at(-1), "请选择整课 ZIP 压缩包。");
}

{
  const { action, statuses, writes } = createHarness({ file: makeFile({ name: "ENG4U.txt" }) });
  const result = await action.uploadCoursePackage();
  assert.equal(result, undefined);
  assert.equal(statuses.at(-1).title, "整课包必须是 .zip 文件");
  assert.equal(writes.at(-1), "整课包必须是 .zip 文件。");
}

{
  const { action, disabled, previews, remembers, statuses, successes, uploadedChunks, writes, clears } = createHarness({
    uploadChunk(args, index) {
      args.onProgress(5);
      if (index < 2) return { complete: false, chunksReceived: index + 1, bytesReceived: (index + 1) * 10 };
      return { ok: true, complete: true, importId: "final-import", operations: [{ kind: "video" }] };
    },
  });
  const data = await action.uploadCoursePackage();
  assert.equal(data.ok, true);
  assert.deepEqual(disabled, [true, false]);
  assert.deepEqual(clears, ["commit", "preview"]);
  assert.equal(uploadedChunks.length, 3);
  assert.match(uploadedChunks[0].url, /chunkIndex=0/);
  assert.match(uploadedChunks[1].url, /chunkIndex=1/);
  assert.match(uploadedChunks[2].url, /chunkIndex=2/);
  assert.deepEqual(uploadedChunks[2].blob, { start: 20, end: 25 });
  assert.equal(previews.length, 1);
  assert.equal(successes.length, 1);
  assert.equal(successes[0].uploadedFile.name, "ENG4U-course.zip");
  assert.equal(remembers.at(-1).status, "complete");
  assert.equal(remembers.at(-1).chunksReceived, 3);
  assert.equal(statuses.at(-1).title, "上传完成，服务器已生成预览");
  assert.match(writes[0], /正在分片上传整课包/);
}

{
  const file = makeFile();
  const importId = `import-${file.name}-${file.size}`;
  const { action, uploadedChunks } = createHarness({
    file,
    restoredTask: { importId, filename: file.name, totalBytes: file.size, chunksReceived: 2 },
    uploadChunk() {
      return { ok: true, complete: true, operations: [{ kind: "book" }] };
    },
  });
  await action.uploadCoursePackage();
  assert.equal(uploadedChunks.length, 1);
  assert.match(uploadedChunks[0].url, /chunkIndex=2/);
}

{
  let waitedFor = "";
  const { action, previews } = createHarness({
    uploadChunk() {
      return { complete: true, processing: true };
    },
    waitForReview(importId) {
      waitedFor = importId;
      return { ok: true, importId, operations: [{ kind: "ispring" }] };
    },
  });
  await action.uploadCoursePackage();
  assert.match(waitedFor, /^import-/);
  assert.equal(previews.at(-1).operations[0].kind, "ispring");
}

{
  const { action, remembers, statuses, writes } = createHarness({
    restoredTask: { chunksReceived: 1 },
    uploadChunk() {
      throw new Error("network down");
    },
  });
  const result = await action.uploadCoursePackage();
  assert.equal(result, undefined);
  assert.equal(remembers.at(-1).status, "failed");
  assert.equal(remembers.at(-1).chunksReceived, 1);
  assert.equal(statuses.at(-1).title, "上传失败");
  assert.match(statuses.at(-1).detail, /network down/);
  assert.match(writes.at(-1), /Error: network down/);
}

{
  const { action, writes } = createHarness({ currentImport: null });
  const result = await action.commitCoursePackage();
  assert.equal(result.canceled, true);
  assert.match(writes.at(-1), /请先上传整课 ZIP/);
}

{
  const { action, statuses, writes } = createHarness({
    currentImport: { ok: true, importId: "imp-1", course: "ENG4U", summary: { ready: 0 } },
    commitState: { hasReady: false, courseMatches: true, selected: "ENG4U", previewCourse: "ENG4U" },
  });
  const result = await action.commitCoursePackage();
  assert.equal(result.canceled, true);
  assert.equal(statuses.at(-1).title, "无法导入");
  assert.match(writes.at(-1), /没有可导入/);
}

{
  const { action, statuses, writes } = createHarness({
    currentImport: { ok: true, importId: "imp-2", course: "ESLDO", summary: { ready: 3 } },
    commitState: { hasReady: true, courseMatches: false, selected: "ENG4U", previewCourse: "ESLDO" },
  });
  const result = await action.commitCoursePackage();
  assert.equal(result.canceled, true);
  assert.equal(statuses.at(-1).title, "课程不匹配，无法导入");
  assert.match(writes.at(-1), /ESLDO/);
}

{
  const { action, commits } = createHarness({
    currentImport: { ok: true, importId: "imp-3", course: "ENG4U", summary: { ready: 3 } },
    confirmCommit: () => false,
  });
  const result = await action.commitCoursePackage();
  assert.equal(result.canceled, true);
  assert.equal(commits.length, 0);
}

{
  const { action, commits, commitSuccesses, fields, writes } = createHarness({
    currentImport: { ok: true, importId: "imp-4", course: "ENG4U", summary: { ready: 3 } },
  });
  const result = await action.commitCoursePackage();
  assert.equal(result.ok, true);
  assert.equal(commits[0].course, "ENG4U");
  assert.equal(commits[0].importId, "imp-4");
  assert.equal(fields.coursePackageFile.value, "");
  assert.equal(commitSuccesses.length, 1);
  assert.match(writes.at(-2), /正在导入整课包：imp-4/);
}

console.log("admin course package action smoke ok");
