import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-readiness-panel.js", "utf8");

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
        return String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      },
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-readiness-panel.js" });

const elements = {
  readiness: element(),
  statusStats: element(),
};
const panel = context.window.AdminReadinessPanel.createPanel({
  elements,
  formatBytes: (value) => `${value} bytes`,
  percentUsed: (used, total) => Math.round((used / total) * 100),
});

panel.renderStatusStats({
  units: 4,
  lessons: 20,
  storage: {
    adminUploadBytes: 20,
    coursewareBytes: 10,
    disk: { freeBytes: 75, totalBytes: 100, usedBytes: 25 },
  },
});
assert.equal(elements.statusStats.hidden, false);
assert.match(elements.statusStats.innerHTML, /Units/);
assert.match(elements.statusStats.innerHTML, /Disk used/);
assert.match(elements.statusStats.innerHTML, /25 bytes \(25%\)/);

panel.renderReadiness({});
assert.equal(elements.readiness.hidden, true);

panel.renderReadiness({
  readiness: {
    courseOutline: { ok: true },
    introduction: { ok: false },
    unitPlans: { count: 1, expected: 2, missing: [{ unit: 2, title: "Food < Safety" }] },
    lessonPlans: { count: 2, expected: 2, missing: [] },
    ispring: { connected: true, count: 8 },
    texts: {
      missingDownloads: [{ title: "Novel", author: "Author" }],
      needsReview: [],
    },
  },
});
assert.equal(elements.readiness.hidden, false);
assert.match(elements.readiness.innerHTML, /Course Outline/);
assert.match(elements.readiness.innerHTML, /Food &lt; Safety/);
assert.match(elements.readiness.innerHTML, /8 connected/);
assert.match(elements.readiness.innerHTML, /Missing text download/);

console.log("admin readiness panel smoke ok");
