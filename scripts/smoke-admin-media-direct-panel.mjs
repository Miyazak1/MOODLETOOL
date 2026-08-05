import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-media-direct-panel.js", "utf8");

function element() {
  return {
    classList: {
      toggled: [],
      toggle(name, value) {
        this.toggled.push([name, value]);
      },
    },
    disabled: false,
    hidden: true,
    innerHTML: "",
    addEventListener() {},
    style: {},
    textContent: "",
    title: "",
    value: "",
  };
}

const context = {
  window: {
    AdminMediaView: {
      formatBytes(bytes) {
        return `${bytes} B`;
      },
      renderOssDirectQueue(items) {
        return `queue:${items.length}`;
      },
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-media-direct-panel.js" });

const elements = {
  cancelButton: element(),
  fileInput: element(),
  progress: element(),
  progressBar: element(),
  queue: element(),
  status: element(),
  statusDetail: element(),
  statusTitle: element(),
  uploadButton: element(),
};

let preview = { ok: true, courses: ["ENG4U"], files: 1, totalBytes: 2048, errors: [], warnings: [] };
let uploading = false;
let cancelCount = 0;
let uploadCount = 0;
const controller = {
  cancelActiveUpload() {
    cancelCount += 1;
    uploading = false;
  },
  isUploading() {
    return uploading;
  },
  previewSelected() {
    return preview;
  },
  async uploadSelected() {
    uploadCount += 1;
    return { ok: true };
  },
};

const panel = context.window.AdminMediaDirectPanel.createPanel({
  elements,
  getController: () => controller,
});

panel.renderConfig({ directUpload: { enabled: false, configured: false, reason: "missing CORS" } });
assert.equal(elements.uploadButton.disabled, true);
assert.equal(elements.uploadButton.title, "missing CORS");
assert.equal(elements.uploadButton.textContent, "直传媒体到 OSS");
assert.equal(elements.statusTitle.textContent, "OSS 直传暂不可用");
assert.deepEqual(elements.status.classList.toggled.slice(-2), [["error", true], ["warn", false]]);

panel.renderConfig({ directUpload: { enabled: true, configured: true, bucket: "oss://moodletool", maxGb: 5 } });
assert.equal(elements.uploadButton.disabled, false);
assert.equal(elements.status.hidden, true);

elements.fileInput.files = [{ name: "ENG4U.zip", size: 2048 }];
panel.refreshPreview();
assert.equal(elements.statusTitle.textContent, "OSS 直传预检通过");
assert.match(elements.statusDetail.textContent, /2048 B/);
assert.match(elements.statusDetail.textContent, /ENG4U/);
assert.equal(elements.uploadButton.textContent, "直传到 OSS");
assert.equal(elements.uploadButton.disabled, false);

preview = {
  ok: true,
  courses: ["ESLDO", "ENG4U"],
  files: 2,
  totalBytes: 3072,
  errors: [],
  warnings: ["当前左侧课程是 ENG3U，但本次选择包含 ESLDO、ENG4U；完整课件包会按文件名分别上传。"],
};
elements.fileInput.files = [{ name: "ESLDO.zip", size: 1024 }, { name: "ENG4U.zip", size: 2048 }];
panel.refreshPreview();
assert.equal(elements.statusTitle.textContent, "OSS 直传预检通过，有提示");
assert.match(elements.statusDetail.textContent, /ESLDO、ENG4U/);
assert.match(elements.statusDetail.textContent, /完整课件包会按文件名分别上传/);
assert.equal(elements.uploadButton.textContent, "直传 2 个文件到 OSS");
assert.deepEqual(elements.status.classList.toggled.slice(-2), [["error", false], ["warn", true]]);

preview = {
  ok: false,
  courses: [],
  files: 2,
  totalBytes: 1024,
  errors: ["无法识别课程码", "ENG4U 在本次选择里出现了多个完整课件包"],
};
elements.fileInput.files = [{ name: "unknown.zip", size: 1024 }];
panel.refreshPreview();
assert.equal(elements.statusTitle.textContent, "OSS 直传预检失败");
assert.match(elements.statusDetail.textContent, /无法识别课程码/);
assert.match(elements.statusDetail.textContent, /ENG4U 在本次选择里出现了多个完整课件包/);
assert.equal(elements.uploadButton.disabled, true);
assert.match(elements.uploadButton.title, /无法识别课程码/);
assert.equal(elements.uploadButton.textContent, "修正后再上传");

panel.renderQueue([{ name: "ENG4U.zip" }]);
assert.equal(elements.queue.innerHTML, "queue:1");
panel.renderQueue([]);
assert.equal(elements.queue.hidden, true);
assert.equal(elements.queue.innerHTML, "");

uploading = true;
panel.setActiveUpload({});
assert.equal(elements.cancelButton.hidden, false);
assert.equal(panel.cancelActiveUpload(), true);
assert.equal(cancelCount, 1);
assert.equal(elements.cancelButton.disabled, true);
assert.equal(elements.statusTitle.textContent, "正在取消 OSS 直传");

elements.fileInput.value = "fake-file";
await panel.uploadSelected();
assert.equal(uploadCount, 1);
assert.equal(elements.fileInput.value, "");
assert.equal(elements.uploadButton.textContent, "直传媒体到 OSS");

console.log("admin media direct panel smoke ok");
