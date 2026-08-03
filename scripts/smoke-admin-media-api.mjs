import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-media-api.js", "utf8");
const calls = [];
const payloads = {
  "/api/admin/media/courses?refreshOss=1": { ok: true, courses: [{ code: "ENG4U" }], summary: { files: 1 } },
  "/api/admin/media/jobs?limit=50": { ok: true, jobs: [{ id: "media-1", status: "running" }] },
  "/api/admin/oss/uploads?limit=50": { ok: true, uploads: [{ id: "upl-1", status: "uploaded" }] },
  "/api/admin/media/jobs": { ok: true, job: { id: "media-new" } },
  "/api/admin/media/jobs/media-1/log?stream=stdout&tail=240": { ok: true, text: "hello" },
  "/api/admin/media/jobs/media-1/cancel": { ok: true, job: { id: "media-1", status: "cancelled" } },
  "/api/admin/media/jobs/media-1/retry": { ok: true, job: { id: "media-2", status: "queued" } },
  "/api/admin/media/locks/ENG4U/clear": { ok: true, removed: { course: "ENG4U" } },
  "/api/admin/media/locks/clear-stale": { ok: true, removed: [{ course: "ENG4U" }], skipped: [], failed: [] },
  "/api/admin/oss/uploads/init": { ok: true, upload: { id: "upl-1" }, form: {} },
  "/api/admin/oss/uploads/upl-1/complete": { ok: true, upload: { id: "upl-1", status: "uploaded" } },
};

function fetchImpl(url, options = {}) {
  calls.push({ url, options });
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payloads[url] || { ok: true },
  });
}

const context = {
  window: {
    fetch: fetchImpl,
  },
  setTimeout,
  clearTimeout,
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-media-api.js" });

const api = context.window.AdminMediaApi.createClient({ fetchImpl });
const media = await api.read({ refreshOss: true });
assert.equal(media.courses[0].code, "ENG4U");
assert.equal(media.jobs[0].id, "media-1");
assert.equal(media.uploads[0].id, "upl-1");

assert.equal((await api.createJob({ type: "publish-course", course: "ENG4U" })).job.id, "media-new");
assert.equal((await api.jobLog("media-1")).text, "hello");
assert.equal((await api.cancelJob("media-1")).job.status, "cancelled");
assert.equal((await api.retryJob("media-1")).job.status, "queued");
assert.equal((await api.clearLock("ENG4U")).removed.course, "ENG4U");
assert.equal((await api.clearStaleLocks()).removed[0].course, "ENG4U");
assert.equal((await api.initOssUpload({ course: "ENG4U" })).upload.id, "upl-1");
assert.equal((await api.completeOssUpload("upl-1", { autoPublish: true })).upload.status, "uploaded");

const postCalls = calls.filter((call) => call.options.method === "POST");
assert.ok(postCalls.length >= 5);
assert.ok(postCalls.every((call) => call.options.credentials === "same-origin" || call.url.includes("/media/courses")));

let refreshCount = 0;
const refreshStatuses = [];
const refresher = context.window.AdminMediaApi.createAutoRefresh({
  isEnabled: () => true,
  read: async () => {
    refreshCount += 1;
  },
  hasActive: () => false,
  onStatus: (status, meta) => refreshStatuses.push([status, meta]),
});
refresher.schedule(1);
await new Promise((resolve) => setTimeout(resolve, 10));
refresher.stop();
assert.equal(refreshCount, 1);
assert.equal(refreshStatuses[0][0], "scheduled");
assert.equal(refreshStatuses[0][1].delayMs, 1);
assert.ok(refreshStatuses.some(([status]) => status === "refreshing"));
assert.equal(refreshStatuses.at(-1)[0], "stopped");

console.log("admin media api smoke ok");
