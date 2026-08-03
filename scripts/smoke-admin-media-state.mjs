import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const viewSource = readFileSync("public/admin-media-view.js", "utf8");
const stateSource = readFileSync("public/admin-media-state.js", "utf8");

const context = { window: {} };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(viewSource, context, { filename: "public/admin-media-view.js" });
vm.runInContext(stateSource, context, { filename: "public/admin-media-state.js" });

const state = context.window.AdminMediaState;

assert.equal(state.normalizeCourseCode(" eng4u "), "ENG4U");

const sample = {
  config: { enabled: true },
  courses: [
    { code: "ENG4U", title: "English", publishState: "partial", fileCount: 10 },
    { code: "HFC3M", title: "Food", publishState: "published", fileCount: 0 },
  ],
  jobs: [
    { id: "job-1", type: "publish-course", course: "ENG4U", status: "running" },
    { id: "job-2", type: "audit-videos", course: "HFC3M", status: "warning" },
  ],
};

assert.equal(state.selectedCourseStatus(sample, "eng4u").code, "ENG4U");
assert.equal(state.activeWriteJob(sample).id, "job-1");

const controls = state.mediaActionState(sample, "ENG4U");
assert.equal(controls.configEnabled, true);
assert.equal(controls.buttons.publishCurrentCourse.enabled, false);
assert.equal(controls.buttons.auditCurrentCourse.enabled, true);
assert.equal(controls.buttons.publishAllMedia.enabled, false);
assert.match(controls.notice.html, /媒体写任务正在运行/);

const disabledControls = state.mediaActionState({ config: { enabled: false }, courses: [], jobs: [] }, "ENG4U");
assert.equal(disabledControls.buttons.readinessMedia.enabled, false);
assert.match(disabledControls.notice.html, /MEDIA_JOBS_ENABLED=1/);

const emptyCourseControls = state.mediaActionState({
  config: { enabled: true },
  courses: [{ code: "ZZZEMPTY", title: "Empty", publishState: "empty", fileCount: 0 }],
  jobs: [],
}, "ZZZEMPTY");
assert.equal(emptyCourseControls.buttons.auditCurrentCourse.enabled, true);
assert.equal(emptyCourseControls.buttons.publishCurrentCourse.enabled, false);
assert.equal(emptyCourseControls.buttons.syncCurrentCourse.enabled, false);
assert.match(emptyCourseControls.buttons.publishCurrentCourse.reason, /没有可发布媒体/);

assert.equal(state.filterMediaCourses(sample.courses, { filter: "unpublished" }).length, 1);
assert.equal(state.filterMediaCourses(sample.courses, { filter: "published" })[0].code, "HFC3M");
assert.equal(state.filterMediaCourses(sample.courses, { filter: "current", selectedCourse: "ENG4U" })[0].code, "ENG4U");
assert.equal(state.filterMediaCourses(sample.courses, { query: "food" })[0].code, "HFC3M");

assert.equal(state.filterMediaJobs(sample.jobs, { filter: "active" }).length, 1);
assert.equal(state.filterMediaJobs(sample.jobs, { filter: "attention" })[0].id, "job-2");
assert.equal(state.filterMediaJobs(sample.jobs, { filter: "current", selectedCourse: "HFC3M" })[0].id, "job-2");

console.log("admin media state smoke ok");
