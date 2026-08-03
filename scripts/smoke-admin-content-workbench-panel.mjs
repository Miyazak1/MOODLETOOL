import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-content-workbench-panel.js", "utf8");

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
vm.runInContext(source, context, { filename: "public/admin-content-workbench-panel.js" });

const elements = {
  readinessSummary: element(),
  readinessTable: element(),
  workbenchTable: element(),
};
const panel = context.window.AdminContentWorkbenchPanel.createPanel({ elements });

panel.renderCourseReadiness({
  courseCount: 1,
  summary: {
    ispringMissingCourses: 1,
    lessonPlanGapCourses: 0,
    missingCourseOutlines: 1,
    textReviewCourses: 1,
    unitPlanGapCourses: 0,
  },
  courses: [
    {
      code: "ENG<4U",
      title: "English & Literature",
      readiness: {
        courseOutline: { ok: false },
        introduction: { ok: true },
        unitPlans: { count: 4, expected: 4 },
        lessonPlans: { count: 19, expected: 20 },
        ispring: { connected: false, count: 0 },
        texts: { needsReview: [{ title: "Novel" }] },
      },
    },
  ],
});
assert.equal(elements.readinessSummary.hidden, false);
assert.match(elements.readinessSummary.innerHTML, /Missing outlines/);
assert.equal(elements.readinessTable.hidden, false);
assert.match(elements.readinessTable.innerHTML, /ENG&lt;4U/);
assert.match(elements.readinessTable.innerHTML, /English &amp; Literature/);
assert.match(elements.readinessTable.innerHTML, /19\/20/);
assert.match(elements.readinessTable.innerHTML, /Text Review/);

panel.renderContentWorkbench({
  totals: { courses: 1, iSpringMissingCourses: 1, missingCourseOutlines: 1, previewQueue: 2, textReviewItems: 3 },
  rows: [
    {
      course: "ENG4U",
      status: "active",
      priorityScore: 99,
      units: 4,
      lessons: 20,
      missingCourseOutline: true,
      iSpringMissing: false,
      previewQueue: 2,
      textReviewItems: 3,
      nextActions: ["Fix < outline"],
    },
  ],
});
assert.equal(elements.workbenchTable.hidden, false);
assert.match(elements.workbenchTable.innerHTML, /Priority/);
assert.match(elements.workbenchTable.innerHTML, /Missing/);
assert.match(elements.workbenchTable.innerHTML, /Fix &lt; outline/);

panel.renderContentWorkbench({ rows: [], totals: {} });
assert.match(elements.workbenchTable.innerHTML, /No content workbench records/);

console.log("admin content workbench panel smoke ok");
