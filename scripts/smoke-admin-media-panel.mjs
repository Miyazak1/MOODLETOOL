import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-media-panel.js", "utf8");

function element() {
  return {
    disabled: false,
    hidden: true,
    innerHTML: "",
    title: "",
    value: "",
  };
}

const calls = [];
const elements = {
  auditCurrentCourseButton: element(),
  configStats: element(),
  courseFilter: { value: "all" },
  courseSearch: { value: "" },
  courseTable: element(),
  jobFilter: { value: "all" },
  jobsTable: element(),
  locksPanel: element(),
  notice: element(),
  ossStats: element(),
  publishAllMediaButton: element(),
  publishCurrentCourseButton: element(),
  readinessMediaButton: element(),
  refreshState: element(),
  syncCurrentCourseButton: element(),
  uploadsTable: element(),
};

const context = {
  window: {
    AdminMediaState: {
      filterMediaCourses(courses, options) {
        calls.push(["filter-courses", options]);
        return courses.filter((course) => course.code !== "HIDDEN");
      },
      filterMediaJobs(jobs, options) {
        calls.push(["filter-jobs", options]);
        return jobs.filter((job) => job.status !== "hidden");
      },
      mediaActionState(data, selectedCourse) {
        calls.push(["action-state", selectedCourse]);
        return {
          buttons: {
            auditCurrentCourse: { enabled: true, reason: "" },
            publishAllMedia: { enabled: false, reason: "busy" },
            publishCurrentCourse: { enabled: true, reason: "" },
            readinessMedia: { enabled: true, reason: "" },
            syncCurrentCourse: { enabled: false, reason: "sync locked" },
          },
          configEnabled: Boolean(data.config?.enabled),
          notice: { hidden: false, html: "notice" },
        };
      },
    },
    AdminMediaView: {
      activeWriteJob(jobs = []) {
        return jobs.find((job) => job.status === "running") || null;
      },
      hasActiveJobs(jobs = []) {
        return jobs.some((job) => job.status === "running");
      },
      hasActiveUploads(uploads = []) {
        return uploads.some((upload) => upload.status === "uploading");
      },
      jobTypeLabel(type) {
        return type;
      },
      renderCoursesSection({ courses, allCourses, assetScope, activeWriteJob, selectedCourse }) {
        return `courses:${courses.length}/${allCourses.length}:${assetScope}:${activeWriteJob?.id || ""}:${selectedCourse}`;
      },
      renderJobsSection({ jobs, allJobs }) {
        return `jobs:${jobs.length}/${allJobs.length}`;
      },
      renderLocksSection(lockData) {
        return `locks:${lockData.locks.length}`;
      },
      renderMediaConfigStats(data) {
        return `config:${data.config.assetMode}`;
      },
      renderMediaOssStats(oss) {
        return `oss:${oss.objectCount}`;
      },
      renderUploadsSection({ uploads, jobs }) {
        return `uploads:${uploads.length}:${jobs.length}`;
      },
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-media-panel.js" });

let selectedCourse = "ENG4U";
let directUploadConfig = null;
const panel = context.window.AdminMediaPanel.createPanel({
  elements,
  getSelectedCourse: () => selectedCourse,
  renderOssDirectUploadConfig: (config) => {
    directUploadConfig = config;
  },
});

panel.render({
  config: { enabled: true, assetMode: "hybrid", assetScope: "playable" },
  courses: [{ code: "ENG4U" }, { code: "HIDDEN" }],
  jobs: [{ id: "job-1", status: "running" }, { id: "job-2", status: "hidden" }],
  uploads: [{ id: "upl-1", status: "uploaded" }],
  oss: { objectCount: 12 },
  locks: { locks: [{ course: "ENG4U" }] },
});

assert.equal(elements.configStats.innerHTML, "config:hybrid");
assert.equal(elements.ossStats.innerHTML, "oss:12");
assert.equal(elements.locksPanel.innerHTML, "locks:1");
assert.equal(elements.courseTable.innerHTML, "courses:1/2:playable:job-1:ENG4U");
assert.equal(elements.jobsTable.innerHTML, "jobs:1/2");
assert.equal(elements.uploadsTable.innerHTML, "uploads:1:2");
assert.equal(elements.publishAllMediaButton.disabled, true);
assert.equal(elements.publishAllMediaButton.title, "busy");
assert.equal(elements.syncCurrentCourseButton.title, "sync locked");
assert.equal(elements.notice.innerHTML, "notice");
assert.equal(directUploadConfig.assetMode, "hybrid");

panel.updateRefreshState({ updatedAt: new Date("2026-07-31T10:00:00Z") });
assert.match(elements.refreshState.textContent, /任务运行中/);
assert.match(elements.refreshState.textContent, /状态已同步/);
panel.updateRefreshState({ refreshing: true });
assert.match(elements.refreshState.textContent, /正在刷新媒体状态/);
panel.updateRefreshState({ nextDelayMs: 5000 });
assert.match(elements.refreshState.textContent, /下次约 5 秒后/);
assert.equal(panel.hasActive(), true);
assert.equal(panel.activeWriteJob().id, "job-1");

panel.render({
  summary: { published: 4 },
  registry: { assetCount: 14 },
  jobs: [{ id: "job-3", status: "failed" }],
  uploads: [{ id: "upl-1", status: "uploaded" }, { id: "upl-2", status: "created" }],
  oss: { objectCount: 15, totalBytes: 2048 },
});
assert.match(elements.refreshState.textContent, /运行任务 -1/);
assert.match(elements.refreshState.textContent, /需关注 \+1/);
assert.match(elements.refreshState.textContent, /已发布资源 \+4/);
assert.match(elements.refreshState.textContent, /Registry \+14/);

panel.render({
  summary: { published: 4 },
  registry: { assetCount: 14 },
  jobs: [{ id: "job-3", status: "failed" }],
  uploads: [{ id: "upl-1", status: "uploaded" }, { id: "upl-2", status: "created" }],
  oss: { objectCount: 15, totalBytes: 2048 },
});
assert.match(elements.refreshState.textContent, /本次无变化/);

selectedCourse = "ESLDO";
elements.courseFilter.value = "current";
panel.filteredCourses([{ code: "ESLDO" }]);
assert.equal(calls.at(-1)[1].selectedCourse, "ESLDO");

panel.renderLocks({ locks: [] });
assert.equal(elements.locksPanel.hidden, true);
assert.equal(elements.locksPanel.innerHTML, "");

console.log("admin media panel smoke ok");
