import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMediaJobStore } from "./lib/media-job-store.mjs";

const root = mkdtempSync(join(tmpdir(), "media-job-store-"));

try {
  const store = createMediaJobStore({
    dataRoot: join(root, "jobs"),
    indexPath: join(root, "jobs", "index.json"),
    indexLimit: 2,
  });

  const queued = {
    id: "media-queued",
    type: "publish-course",
    scope: "course",
    course: "ENG3U",
    status: "queued",
    requestedBy: "smoke",
    requestedAt: "2026-01-01T00:00:00.000Z",
  };
  const running = {
    id: "media-running",
    type: "publish-course",
    scope: "course",
    course: "ENG4U",
    status: "running",
    pid: 12345,
    requestedBy: "smoke",
    requestedAt: "2026-01-02T00:00:00.000Z",
  };
  const failed = {
    id: "media-failed",
    type: "sync-oss",
    scope: "all",
    course: "",
    status: "failed",
    requestedBy: "smoke",
    requestedAt: "2026-01-03T00:00:00.000Z",
    error: "boom",
  };

  store.writeJob(queued);
  store.writeJob(running);
  store.writeJob(failed);
  const indexItems = store.writeIndex([queued, running, failed]);
  assert.equal(indexItems.length, 2);
  assert.deepEqual(indexItems.map((item) => item.id), ["media-failed", "media-running"]);

  const loaded = store.loadJobs({ now: "2026-01-04T00:00:00.000Z" });
  assert.equal(loaded.length, 2);
  const interrupted = loaded.find((job) => job.id === "media-running");
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.pid, null);
  assert.match(interrupted.error, /server restarted/i);

  const loadedFailed = loaded.find((job) => job.id === "media-failed");
  assert.equal(loadedFailed.status, "failed");
  assert.equal(loadedFailed.error, "boom");

  store.writeReport(failed, { id: failed.id, status: failed.status });
  assert.equal(existsSync(store.jobPath(failed.id, "report.json")), true);

  assert.equal(store.readJob("missing", null), null);
  console.log("media job store smoke ok");
} finally {
  rmSync(root, { recursive: true, force: true });
}
