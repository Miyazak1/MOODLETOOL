import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-storage-panel.js", "utf8");

function element() {
  return {
    hidden: true,
    innerHTML: "",
  };
}

const context = {
  window: {
    AdminMediaView: {
      escapeHtml(value) {
        return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
      },
      formatBytes(bytes) {
        return `${bytes} B`;
      },
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-storage-panel.js" });

const elements = {
  courseTable: element(),
  packageMini: element(),
  summary: element(),
  uploadMini: element(),
};
const panel = context.window.AdminStoragePanel.createPanel({ elements });

assert.equal(panel.percentUsed(0, 0), 0);
assert.equal(panel.percentUsed(75, 100), 75);
assert.equal(panel.percentUsed(200, 100), 100);
assert.match(panel.meterHtml("Data <disk>", 90, 100), /danger-fill/);
assert.match(panel.meterHtml("Data", 75, 100), /warn-fill/);
assert.match(panel.meterHtml("Data", 10, 100), /10 B \/ 100 B/);

const data = {
  activeRoot: "/active",
  archiveRoot: "/archive",
  generatedAt: "now",
  disk: {
    freeBytes: 100,
    totalBytes: 1000,
    usedBytes: 900,
  },
  summary: {
    activeRootBytes: 300,
    adminUploadBytes: 40,
    archiveRootBytes: 50,
  },
  courses: [
    {
      activeBytes: 10,
      adminUploadBytes: 20,
      archiveBytes: 30,
      course: "ENG4U",
      status: "active",
      title: "English & Media",
      totalBytes: 60,
    },
  ],
};

panel.renderOverview(data);
assert.equal(elements.summary.hidden, false);
assert.match(elements.summary.innerHTML, /剩余空间/);
assert.match(elements.summary.innerHTML, /\/active/);
assert.equal(elements.uploadMini.hidden, false);
assert.match(elements.uploadMini.innerHTML, /课程目录 300 B/);
assert.equal(elements.packageMini.hidden, false);
assert.match(elements.packageMini.innerHTML, /导入可用空间/);
assert.equal(elements.courseTable.hidden, false);
assert.match(elements.courseTable.innerHTML, /ENG4U/);
assert.match(elements.courseTable.innerHTML, /English &amp; Media/);
assert.match(elements.courseTable.innerHTML, /60 B/);

const emptyTable = element();
context.window.AdminStoragePanel.createPanel({ elements: { courseTable: emptyTable } }).renderOverview({ courses: [] });
assert.match(emptyTable.innerHTML, /No course storage found/);

console.log("admin storage panel smoke ok");
