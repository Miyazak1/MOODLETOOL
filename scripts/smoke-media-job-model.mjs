import assert from "node:assert/strict";
import {
  activeMediaJobStatuses,
  mediaJobScope,
  mediaJobSucceededStatus,
  mediaJobDisplay,
  mediaJobMetricValues,
  mediaJobNextStep,
  mediaJobResultText,
  mediaJobTone,
  mediaWriteJobTypes,
  normalizeMediaJobType,
  parseMediaJobProgressFromText,
  retryableMediaJobStatuses,
} from "./lib/media-job-model.mjs";

assert.equal(normalizeMediaJobType("PUBLISH-COURSE"), "publish-course");
assert.deepEqual(mediaJobScope("publish-all", ""), { scope: "all", course: "" });
assert.deepEqual(mediaJobScope("audit-videos", ""), { scope: "all", course: "" });
assert.deepEqual(mediaJobScope("index-oss", ""), { scope: "all", course: "" });
assert.deepEqual(mediaJobScope("sync-oss", " eng4u "), { scope: "course", course: "ENG4U" });
assert.throws(() => mediaJobScope("publish-course", ""), /Course is required/);

assert.equal(activeMediaJobStatuses.has("running"), true);
assert.equal(mediaWriteJobTypes.has("sync-oss"), true);
assert.equal(mediaWriteJobTypes.has("index-oss"), true);
assert.equal(retryableMediaJobStatuses.has("warning"), true);

const uploadProgress = parseMediaJobProgressFromText(
  { status: "running" },
  [
    "== OSS sync apply ==",
    "OSS sync uploading: 11/20 93.2 MB ENG4U/video.mp4",
    "OSS sync progress: 12/20 uploaded, failed 0",
  ].join("\n"),
);
assert.equal(uploadProgress.phase, "OSS upload");
assert.equal(uploadProgress.current, 12);
assert.equal(uploadProgress.total, 20);
assert.equal(uploadProgress.percent, 60);

const optimizeProgress = parseMediaJobProgressFromText(
  { status: "running" },
  "Video optimization processing: 2/4 85.4 MB ENG3U/high.mp4",
);
assert.equal(optimizeProgress.phase, "Video optimization");
assert.equal(optimizeProgress.percent, 25);

assert.equal(mediaJobSucceededStatus({ payload: { status: "ready" } }), "succeeded");
assert.equal(mediaJobSucceededStatus({ payload: { status: "ready-with-warnings" } }), "warning");
assert.equal(mediaJobSucceededStatus({ payload: { status: "blocked" } }), "failed");
assert.equal(mediaJobSucceededStatus({ payload: {} }, "WARN: Video audit report is missing"), "warning");

const displayJob = {
  status: "warning",
  progress: { current: 610, total: 610, message: "已上传 610/610，失败 0" },
  summary: {
    files: 610,
    uploaded: 610,
    failed: 0,
    totalGb: 1.54,
    status: "ready-with-warnings",
  },
};
assert.equal(mediaJobResultText(displayJob), "配置可用，但有提示");
assert.deepEqual(mediaJobMetricValues(displayJob).slice(0, 4), ["进度 610/610", "文件 610", "已上传 610", "大小 1.54 GB"]);
assert.equal(mediaJobTone(displayJob), "warning");
assert.deepEqual(mediaJobDisplay(displayJob), {
  result: "配置可用，但有提示",
  detail: "已上传 610/610，失败 0",
  metrics: ["进度 610/610", "文件 610", "已上传 610", "大小 1.54 GB"],
  tone: "warning",
  nextStep: "打开详情确认提示；没有 blocker 时课程通常已经可继续使用。",
  action: null,
});

assert.equal(
  mediaJobResultText({ status: "warning", stderrTail: "WARN: Video audit report is missing; run npm run audit:videos -- --all." }),
  "缺少视频审计报告",
);
assert.equal(
  mediaJobResultText({ status: "failed", stderrTail: "Error: Course ENG3U is locked by another operation: /deployment/locks/ENG3U.lock" }),
  "ENG3U 存在旧操作锁，清理锁后重试",
);
assert.deepEqual(
  mediaJobNextStep({ status: "failed", stderrTail: "Error: Course ENG3U is locked by another operation: /deployment/locks/ENG3U.lock" }),
  {
    text: "确认没有发布任务运行后，清理 ENG3U 课程锁并重试。",
    action: { type: "clear-lock", course: "ENG3U", label: "清理课程锁" },
  },
);
assert.deepEqual(
  mediaJobDisplay({ status: "failed", stderrTail: "Error: Course ENG3U is locked by another operation: /deployment/locks/ENG3U.lock" }).action,
  { type: "clear-lock", course: "ENG3U", label: "清理课程锁" },
);
assert.equal(
  mediaJobResultText({ status: "failed", stderrTail: "HTTP 403 Forbidden\nx-oss-cdn-auth: success\nx-oss-ec: 0003-00000001" }),
  "OSS/CDN 权限或私有 Bucket 回源授权被拒绝",
);
assert.equal(
  mediaJobResultText({ status: "failed", stderrTail: "Error: Unknown argument: --all" }),
  "媒体脚本参数不兼容，请更新命令或脚本",
);

console.log("media job model smoke ok");
