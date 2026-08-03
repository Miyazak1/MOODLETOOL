import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-course-lifecycle-panel.js", "utf8");

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
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-course-lifecycle-panel.js" });

let filter = "all";
let query = "";
let selected = "ENG4U";
const elements = {
  jobs: element(),
  notice: element(),
  selectedBanner: element(),
  summary: element(),
  table: element(),
};
const panel = context.window.AdminCourseLifecyclePanel.createPanel({
  elements,
  getFilter: () => filter,
  getQuery: () => query,
  getSelectedCourse: () => selected,
  sortCourses: (courses) => courses.slice().sort((left, right) => left.code.localeCompare(right.code)),
});

const courses = [
  { code: "ESLDO", title: "ESL & Writing", status: "archived", catalogStatus: "ready", updatedAt: "t1", updatedBy: "admin", note: "old" },
  { code: "ENG4U", title: "English", status: "active", catalogStatus: "planning-only", updatedAt: "t2", updatedBy: "admin", note: "risk" },
  { code: "SCH3U", title: "Chemistry", status: "active", catalogStatus: "ready", updatedAt: "t3", updatedBy: "ops", note: "" },
];

assert.match(panel.lifecycleLabel("active"), /status-ok/);
assert.equal(panel.isPlanningActive(courses[1]), true);
const counts = panel.statusCounts(courses);
assert.equal(counts.total, 3);
assert.equal(counts.active, 2);
assert.equal(counts.archived, 1);
assert.equal(counts.risk, 1);

let result = panel.renderCourses({ courses, statusFile: "/status.json" }, "");
assert.equal(result.courses[0].code, "ENG4U");
assert.equal(elements.summary.hidden, false);
assert.match(elements.summary.innerHTML, /未完成但 Active/);
assert.equal(elements.notice.hidden, false);
assert.match(elements.notice.innerHTML, /1/);
assert.equal(elements.selectedBanner.hidden, false);
assert.match(elements.selectedBanner.innerHTML, /ENG4U/);
assert.equal(elements.table.hidden, false);
assert.match(elements.table.innerHTML, /selected-row/);
assert.match(elements.table.innerHTML, /data-course-action="select"/);
assert.match(elements.table.innerHTML, /Status file: \/status.json/);
assert.match(elements.table.innerHTML, /ESL &amp; Writing/);

filter = "risk";
result = panel.renderCourses({ courses }, "");
assert.equal(result.visibleCourses.length, 1);
assert.match(elements.table.innerHTML, /ENG4U/);
assert.doesNotMatch(elements.table.innerHTML, /SCH3U/);

filter = "all";
query = "chem";
result = panel.renderCourses({ courses }, "");
assert.equal(result.visibleCourses.length, 1);
assert.match(elements.table.innerHTML, /SCH3U/);

query = "";
panel.renderJobs({
  activeRoot: "/active",
  archiveRoot: "/archive",
  jobs: [
    { action: "archive", course: "ENG4U", deleteActive: true, finishedAt: "done", payload: { archivePath: "/a.zip" }, requestedAt: "start", status: "done" },
  ],
});
assert.equal(elements.jobs.hidden, false);
assert.match(elements.jobs.innerHTML, /archive/);
assert.match(elements.jobs.innerHTML, /yes/);
assert.match(elements.jobs.innerHTML, /\/a.zip/);

panel.renderJobs({ jobs: [] });
assert.match(elements.jobs.innerHTML, /No lifecycle jobs yet/);

console.log("admin course lifecycle panel smoke ok");
