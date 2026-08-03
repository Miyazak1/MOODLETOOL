import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-media-actions.js", "utf8");
const calls = [];
const writes = [];
const details = [];
const confirms = [];
let refreshCount = 0;
let autoRefreshCount = 0;

const api = {
  async cancelJob(jobId) {
    calls.push(["cancel", jobId]);
    return { ok: true, job: { id: jobId, status: "cancelled" } };
  },
  async clearLock(course) {
    calls.push(["clear-lock", course]);
    return { ok: true, removed: { course } };
  },
  async clearStaleLocks() {
    calls.push(["clear-stale-locks"]);
    return { ok: true, removed: [{ course: "ENG4U" }], skipped: [], failed: [] };
  },
  async createJob(payload) {
    calls.push(["create", payload]);
    return { ok: true, job: { id: `job-${calls.length}`, ...payload } };
  },
  async jobLog(jobId, options = {}) {
    calls.push(["log", jobId, options.stream]);
    return {
      ok: true,
      text: options.stream === "stderr"
        ? "Error: OSS sync apply failed"
        : "OSS sync progress: 100/610 uploaded",
    };
  },
  async retryJob(jobId) {
    calls.push(["retry", jobId]);
    return { ok: true, job: { id: `${jobId}-retry`, status: "queued" } };
  },
};

const data = {
  config: { enabled: true },
  jobs: [{ id: "job-1", course: "ENG4U", type: "sync-oss", status: "failed" }],
  uploads: [{ id: "upl-1", course: "ENG4U", fileName: "ENG4U.zip", jobId: "job-1" }],
  locks: { clearableCount: 1 },
  summary: { files: 610, unpublished: 1, skippedFiles: 11618 },
};

const context = {
  window: {
    AdminMediaState: {
      mediaActionState(state, selectedCourse, { jobTypeLabel }) {
        return {
          activeWriteJob: state.activeJob || null,
          configEnabled: Boolean(state.config.enabled),
          selectedCourse,
          jobTypeLabel,
        };
      },
    },
    AdminMediaView: {
      jobTypeLabel(type) {
        return type;
      },
      renderJobLogDetail(job, logs) {
        return `log:${job?.id}:${logs.stdout}:${logs.stderr}`;
      },
      renderUploadDetail(upload, { relatedJob }) {
        return `upload:${upload.id}:${relatedJob?.id}`;
      },
    },
    confirm(message) {
      confirms.push(message);
      return true;
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-media-actions.js" });

const actions = context.window.AdminMediaActions.createController({
  api,
  getData: () => data,
  getSelectedCourse: () => "eng4u",
  refresh: async () => {
    refreshCount += 1;
  },
  renderDetail: (title, html) => details.push({ title, html }),
  startAutoRefresh: () => {
    autoRefreshCount += 1;
  },
  write: (payload) => writes.push(payload),
});

assert.equal((await actions.publishCurrentCourse()).job.course, "ENG4U");
assert.equal(calls[0][0], "create");
assert.equal(calls[0][1].type, "publish-course");
assert.equal(calls[0][1].course, "ENG4U");
assert.equal(refreshCount, 1);
assert.equal(autoRefreshCount, 1);
assert.match(confirms[0], /确认发布 ENG4U/);

assert.equal((await actions.auditCurrentCourse()).job.type, "audit-videos");
assert.equal((await actions.syncCurrentCourse()).job.type, "sync-oss");
assert.equal((await actions.publishCurrentCourse("ESLDO")).job.course, "ESLDO");
assert.equal((await actions.auditCurrentCourse("HFC3M")).job.course, "HFC3M");
assert.equal((await actions.publishAllMedia()).job.type, "publish-all");
assert.match(confirms.at(-1), /可发布资源：610/);
assert.match(confirms.at(-1), /已跳过非播放文件：11618/);
assert.match(confirms.at(-1), /视频、H5P 和 iSpring/);
assert.equal((await actions.checkReadiness()).job.type, "check-readiness");

actions.showUploadDetail("upl-1");
assert.match(details.at(-1).title, /OSS 直传详情/);
assert.equal(details.at(-1).html, "upload:upl-1:job-1");

await actions.showJobLog("job-1");
assert.match(details.at(-1).title, /媒体任务详情/);
assert.match(details.at(-1).html, /OSS sync progress/);
assert.match(details.at(-1).html, /OSS sync apply failed/);
assert.deepEqual(calls.slice(-2), [
  ["log", "job-1", "stdout"],
  ["log", "job-1", "stderr"],
]);

await actions.cancelJob("job-1");
await actions.retryJob("job-1");
await actions.clearLock("eng4u");
let handledClearLock = null;
let handledClearLockPromise = null;
actions.handleJobAction(
  { dataset: { mediaJobAction: "clear-lock", course: "esleo" } },
  (button, pendingText, task, successText) => {
    handledClearLock = { pendingText, successText };
    handledClearLockPromise = task();
  },
);
await handledClearLockPromise;
await actions.clearStaleLocks();
assert.deepEqual(calls.slice(-5), [
  ["cancel", "job-1"],
  ["retry", "job-1"],
  ["clear-lock", "ENG4U"],
  ["clear-lock", "ESLEO"],
  ["clear-stale-locks"],
]);
assert.match(handledClearLock.pendingText, /清理课程锁/);
assert.match(handledClearLock.successText, /课程锁已清理/);
assert.ok(writes.length >= 9);

data.activeJob = { course: "ENG3U", type: "sync-oss", status: "running" };
await assert.rejects(
  () => actions.publishCurrentCourse(),
  /已有写任务运行中：ENG3U/,
);

console.log("admin media actions smoke ok");
