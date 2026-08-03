import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-course-package-panel.js", "utf8");

function element() {
  return {
    className: "",
    disabled: false,
    hidden: true,
    innerHTML: "",
    style: {},
    textContent: "",
    title: "",
  };
}

const storageData = new Map();
const context = {
  Math,
  Date,
  window: {
    AdminMediaView: {
      escapeHtml(value) {
        return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
      },
      formatBytes(bytes) {
        return `${bytes} B`;
      },
    },
    crypto: {
      randomUUID() {
        return "12345678-1234-1234-1234-123456789abc";
      },
    },
    localStorage: {
      getItem(key) {
        return storageData.get(key) || null;
      },
      setItem(key, value) {
        storageData.set(key, value);
      },
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-course-package-panel.js" });

let selectedCourse = "ENG4U";
const elements = {
  commitButton: element(),
  panel: element(),
  progress: element(),
  progressBar: element(),
  status: element(),
  statusDetail: element(),
  statusTitle: element(),
};

const panel = context.window.AdminCoursePackagePanel.createPanel({
  elements,
  getSelectedCourse: () => selectedCourse,
});

const readyImport = {
  ok: true,
  course: "ENG4U",
  importId: "imp-1",
  summary: { ready: 2, needsReview: 1, skipped: 0, ispring: 1, bookSections: 0, resources: 1 },
  operations: [
    { kind: "video", status: "ready", lessonId: "U01L01", sourcePath: "a.mp4", targetPath: "video/a.mp4" },
  ],
};

assert.equal(panel.reviewCourse(readyImport), "ENG4U");
assert.equal(panel.renderPreview(readyImport), readyImport);
assert.equal(elements.commitButton.disabled, false);
assert.equal(elements.commitButton.textContent, "确认导入到 ENG4U");
assert.match(elements.panel.innerHTML, /imp-1/);
assert.match(elements.panel.innerHTML, /video\/a.mp4/);

selectedCourse = "ESLDO";
const mismatch = panel.commitState(readyImport);
assert.equal(mismatch.canCommit, false);
assert.equal(elements.commitButton.disabled, true);
assert.match(elements.commitButton.title, /ENG4U/);
panel.renderPreview(readyImport);
assert.match(elements.panel.innerHTML, /课程是 ESLDO/);

panel.setStatus({ title: "正在上传", detail: "detail", percent: 42, showProgress: true });
assert.equal(elements.status.hidden, false);
assert.equal(elements.statusTitle.textContent, "正在上传");
assert.equal(elements.progress.hidden, false);
assert.equal(elements.progressBar.style.width, "42%");

panel.renderTaskStatus({
  course: "ESLDO",
  importId: "imp-2",
  filename: "ESLDO.zip",
  status: "uploading",
  totalBytes: 100,
  bytesReceived: 50,
  chunkTotal: 4,
  chunksReceived: 2,
  percent: 50,
});
assert.equal(elements.statusTitle.textContent, "正在上传 ESLDO.zip");
assert.match(elements.statusDetail.textContent, /50 B \/ 100 B/);
assert.equal(panel.readRememberedTask("ESLDO").importId, "imp-2");

panel.renderTaskStatus({
  course: "ESLDO",
  importId: "imp-3",
  filename: "ESLDO.zip",
  status: "complete",
  review: readyImport,
});
assert.equal(panel.getCurrentImport(), readyImport);

panel.renderTaskStatus({ course: "ESLDO", importId: "imp-4", status: "failed", error: "boom" });
assert.equal(elements.statusTitle.textContent, "最近一次上传未完成");
assert.equal(elements.statusTitle.className, "error");

const taskId = panel.createTaskId();
assert.match(taskId, /^\d{4}-/);
assert.equal(panel.taskKey("eng4u"), "ossd-course-package-task:ENG4U");

console.log("admin course package panel smoke ok");
