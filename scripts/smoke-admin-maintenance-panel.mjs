import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/admin-maintenance-panel.js", "utf8");
const context = {
  window: {},
};
vm.createContext(context);
vm.runInContext(source, context);

assert.equal(typeof context.window.AdminMaintenancePanel.createPanel, "function");

const backupList = {
  hidden: true,
  innerHTML: "",
};

const panel = context.window.AdminMaintenancePanel.createPanel({
  elements: { backupList },
  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  },
  formatBytes(bytes) {
    return `${bytes} B`;
  },
});

panel.renderBackupList({ backups: [] });
assert.equal(backupList.hidden, false);
assert.match(backupList.innerHTML, /暂无覆盖备份/);

panel.renderBackupList({
  backups: [
    {
      id: "backup-1<script>",
      bytes: 2048,
      path: "/tmp/course<one>",
      files: [{ path: "a.html" }, { path: "danger<script>.zip" }],
    },
  ],
});

assert.match(backupList.innerHTML, /backup-1&lt;script&gt;/);
assert.match(backupList.innerHTML, /2048 B/);
assert.match(backupList.innerHTML, /\/tmp\/course&lt;one&gt;/);
assert.match(backupList.innerHTML, /danger&lt;script&gt;\.zip/);
assert.doesNotMatch(backupList.innerHTML, /danger<script>/);

console.log("admin maintenance panel smoke ok");
