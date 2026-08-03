import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-upload-gap-panel.js", "utf8");

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
vm.runInContext(source, context, { filename: "public/admin-upload-gap-panel.js" });

const elements = {
  courseTasks: element(),
  table: element(),
};
const panel = context.window.AdminUploadGapPanel.createPanel({
  elements,
  uploadTypeLabel: (type) => ({ "lesson-plan": "Lesson Plan", "ispring-zip": "iSpring ZIP" })[type] || type,
  unitLessonText: (item) => `Unit ${item.unit || "?"} · Lesson ${item.lesson || "?"}`,
});

const result = panel.render(
  {
    uploadItems: [
      { course: "ENG4U", uploadType: "lesson-plan", unit: 1, lesson: 2, suggestedFilename: "lesson<2.pdf", note: "missing" },
    ],
    reviewItems: [
      { course: "ENG4U", uploadType: "text-material", textTitle: "Novel", author: "Author", suggestedFilename: "novel.pdf", note: "review" },
      { course: "ESLDO", uploadType: "text-material", textTitle: "Other", author: "Writer", suggestedFilename: "", note: "" },
    ],
    externalItems: [
      { course: "ENG4U", uploadType: "ispring-zip", lessonCount: 4, connectedCount: 3, note: "check" },
    ],
    summary: { directUploads: 1, textReviews: 2, externalDecisions: 1 },
  },
  { currentCourse: "ENG4U" },
);

assert.equal(result.directItems.length, 3);
assert.equal(elements.courseTasks.hidden, false);
assert.match(elements.courseTasks.innerHTML, /当前课程待处理/);
assert.match(elements.courseTasks.innerHTML, /Lesson Plan/);
assert.match(elements.courseTasks.innerHTML, /lesson&lt;2\.pdf/);
assert.match(elements.courseTasks.innerHTML, /Novel/);
assert.match(elements.courseTasks.innerHTML, /iSpring ZIP/);

assert.equal(elements.table.hidden, false);
assert.match(elements.table.innerHTML, /Direct uploads/);
assert.match(elements.table.innerHTML, /data-gap-action="fill"/);
assert.match(elements.table.innerHTML, /iSpring ZIP/);
assert.equal(panel.itemAt(0).course, "ENG4U");
assert.equal(panel.itemAt(99), null);

panel.render({ uploadItems: [], reviewItems: [], externalItems: [] }, { currentCourse: "SCH3U" });
assert.match(elements.courseTasks.innerHTML, /当前课程没有待上传文件/);
assert.match(elements.table.innerHTML, /No direct uploads pending/);

console.log("admin upload gap panel smoke ok");
