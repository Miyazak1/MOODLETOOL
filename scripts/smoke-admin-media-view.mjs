import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-media-view.js", "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-media-view.js" });

const view = context.window.AdminMediaView;
assert.equal(typeof view, "object");
assert.match(view.statusLabel("running"), /运行中/);
assert.match(view.statusLabel("failed"), /status-risk/);
assert.equal(view.uploadKindLabel("course-package"), "完整课件包");
assert.equal(view.jobTypeLabel("sync-oss"), "同步 OSS");
assert.equal(view.jobTypeLabel("index-oss"), "索引 OSS");
assert.equal(view.hasActiveJobs([{ status: "queued" }]), true);
assert.equal(view.hasActiveUploads([{ importStatus: "running" }]), true);
assert.equal(view.activeWriteJob([{ type: "sync-oss", status: "running", course: "ENG4U" }]).course, "ENG4U");
assert.equal(view.activeWriteJob([{ type: "index-oss", status: "running", course: "ENG4U" }]).course, "ENG4U");
assert.equal(view.jobCardClass({ status: "warning" }), "warning");
assert.match(view.jobResult({ error: "Course ENG3U is locked by another operation" }), /ENG3U/);
assert.match(view.jobNextStep({ error: "Course ENG3U is locked by another operation" }), /清理 ENG3U 课程锁/);
const lockAction = view.jobSuggestedAction({ error: "Course ENG3U is locked by another operation" });
assert.equal(lockAction.type, "clear-lock");
assert.equal(lockAction.course, "ENG3U");
assert.equal(lockAction.label, "清理课程锁");
assert.match(view.jobResult({ error: "HTTP/1.1 403 Forbidden x-oss-ec: 0003-00000001" }), /OSS\/CDN 权限/);
assert.match(view.jobResult({ error: "Error: Unknown argument: --all" }), /媒体脚本参数不兼容/);
assert.match(view.jobResult({ error: "BLOCK: ffprobe is unavailable: unknown error" }), /ffprobe 不可用/);
assert.match(view.jobResult({ error: "Error: OSS sync apply failed with exit code 1 step: { name: 'OSS sync apply' }" }), /OSS sync apply 失败/);

const state = view.coursePublishState({
  publishState: "partial",
  publishedCount: 4,
  fileCount: 10,
});
assert.equal(state.label, "部分发布");
assert.match(state.detail, /4\/10/);
assert.equal(view.percent(0.375), "38%");
assert.match(view.renderCourseState({ publishState: "publishing", activeJob: { progress: { message: "同步 OSS" } } }), /发布中/);
assert.match(
  view.renderCourseState({
    publishState: "partial",
    publishedCount: 2,
    fileCount: 5,
    latestJob: { status: "failed", error: "Course ENG4U is locked by another operation" },
  }),
  /ENG4U 存在旧操作锁/,
);

const configStats = view.renderMediaConfigStats({
  config: {
    enabled: true,
    assetMode: "hybrid",
    assetScope: "playable",
    bucket: "oss://moodletool",
    cdnBaseUrl: "https://cdn.moodletool.work/courseware-active",
  },
  registry: { assetCount: 566 },
  summary: {
    files: 610,
    localFiles: 12228,
    skippedFiles: 11618,
    published: 566,
    unpublished: 44,
    runningJobs: 1,
    locks: 2,
    staleLocks: 1,
  },
});
assert.match(configStats, /任务中心/);
assert.match(configStats, /已启用/);
assert.match(configStats, /oss:\/\/moodletool/);
assert.match(configStats, /可发布资源/);
assert.match(configStats, /Package import/);
assert.match(configStats, /本地总文件/);
assert.match(configStats, /已跳过/);
assert.match(configStats, /12228/);
assert.match(configStats, /11618/);

const ossStats = view.renderMediaOssStats({
  enabled: true,
  ok: true,
  objectCount: 5546,
  totalBytes: 7945689497,
  target: "oss://moodletool/courseware-active/",
  generatedAt: "2026-08-03T05:48:22.000Z",
  cacheHit: true,
  cacheSeconds: 60,
});
assert.match(ossStats, /OSS 实况/);
assert.match(ossStats, /正常/);
assert.match(ossStats, /5546/);
assert.match(ossStats, /GB/);
assert.match(ossStats, /缓存 60s/);

const courseSection = view.renderCoursesSection({
  assetScope: "playable",
  allCourses: [
    { code: "ENG4U", title: "English", fileCount: 10, publishedCount: 5, cdnCoverage: 0.5, publishState: "partial" },
    { code: "HFC3M", title: "Food", fileCount: 0, publishState: "empty" },
  ],
  courses: [
    {
      code: "ENG4U",
      title: "English",
      totalBytes: 2048,
      fileCount: 10,
      localFileCount: 12,
      skippedLocalFileCount: 2,
      videoCount: 2,
      publishedCount: 5,
      unpublishedCount: 5,
      cdnCoverage: 0.5,
      publishState: "partial",
    },
  ],
  activeWriteJob: { course: "ESLDO", scope: "course", status: "running" },
  selectedCourse: "ENG4U",
});
assert.match(courseSection, /课程发布状态/);
assert.match(courseSection, /media-course-table-wrap/);
assert.match(courseSection, /class="media-course-table"/);
assert.match(courseSection, /显示 1\/2 门/);
assert.match(courseSection, /发布范围：可播放资源（视频 \/ H5P \/ iSpring）/);
assert.match(courseSection, /部分发布/);
assert.match(courseSection, /50%/);
assert.match(courseSection, /已跳过/);
assert.match(courseSection, />2<\/td>/);
assert.match(courseSection, /media-course-row-current/);
assert.match(courseSection, /media-course-current-badge/);
assert.match(courseSection, /当前/);
assert.match(courseSection, /data-media-course-action="publish"/);
assert.match(courseSection, /disabled/);

const emptyCourseRow = view.renderCourseRow({
  code: "ZZZEMPTY",
  title: "Empty",
  fileCount: 0,
  localFileCount: 0,
  publishState: "empty",
});
assert.match(emptyCourseRow, /无可发布媒体/);
assert.match(emptyCourseRow, /该课程没有可发布媒体/);
assert.match(emptyCourseRow, /disabled/);
assert.doesNotMatch(
  view.renderCourseState({
    publishState: "empty",
    fileCount: 0,
    latestJob: { status: "failed", error: "Course ZZZEMPTY is locked by another operation" },
  }),
  /最近任务/,
);

const detail = view.uploadProgressFormatter({ size: 1024 })({
  percent: 50,
  loaded: 512,
  total: 1024,
  objectKey: "inbox/uploads/ENG4U/file.zip",
});
assert.equal(typeof detail, "object");
assert.match(detail.detail, /50%/);
assert.match(detail.detail, /inbox\/uploads\/ENG4U/);

const jobSection = view.renderJobsSection({
  allJobs: [
    { id: "job-1", type: "sync-oss", status: "running", course: "ENG4U", progress: { percent: 25, phase: "upload", current: 25, total: 100, failed: 1, message: "OSS sync progress: 25/100 uploaded, failed 1", currentFile: "ENG4U/video.mp4" } },
    { id: "job-2", type: "publish-course", status: "failed", course: "ESLDO", error: "Course ESLDO is locked" },
  ],
  jobs: [
    { id: "job-1", type: "sync-oss", status: "running", course: "ENG4U", progress: { percent: 25, phase: "upload", current: 25, total: 100, failed: 1, message: "OSS sync progress: 25/100 uploaded, failed 1", currentFile: "ENG4U/video.mp4" } },
  ],
});
assert.match(jobSection, /媒体任务/);
assert.match(jobSection, /data-media-job-action="log"/);
assert.match(jobSection, /width: 25%/);
assert.match(jobSection, /25\/100 · 25% · 失败 1/);
assert.match(jobSection, /OSS sync progress: 25\/100 uploaded, failed 1/);
assert.match(jobSection, /ENG4U\/video\.mp4/);

const failedLockJob = view.renderJobCard({
  id: "job-lock",
  type: "publish-course",
  status: "failed",
  course: "ENG3U",
  error: "Error: Course ENG3U is locked by another operation: /deployment/locks/ENG3U.lock",
});
assert.match(failedLockJob, /下一步/);
assert.match(failedLockJob, /确认没有发布任务运行后/);
assert.match(failedLockJob, /data-media-job-action="clear-lock"/);
assert.match(failedLockJob, /data-course="ENG3U"/);

const uploadSection = view.renderUploadsSection({
  jobs: [{ id: "job-3", type: "publish-upload", status: "succeeded", course: "ENG4U" }],
  uploads: [{
    id: "upl-1",
    course: "ENG4U",
    kind: "course-package",
    status: "queued",
    fileName: "ENG4U-course.zip",
    fileSize: 2048,
    jobId: "job-3",
    objectKey: "inbox/uploads/ENG4U/ENG4U-course.zip",
  }],
});
assert.match(uploadSection, /OSS 直传记录/);
assert.match(uploadSection, /ENG4U-course\.zip/);
assert.match(uploadSection, /data-media-upload-action="detail"/);
assert.match(uploadSection, /任务日志/);

const uploadDetail = view.renderUploadDetail(
  {
    id: "upl-1",
    course: "ENG4U",
    kind: "course-package",
    status: "queued",
    importMode: "oss-only",
    importStatus: "oss-extract-required",
    ossOnly: true,
    targetPrefix: "courseware-active/ENG4U/",
    extractedAt: "",
    ingestMessage: "完整课件包已保存在 OSS inbox，等待 OSS-side 解压/索引；不会下载到 ECS。",
    fileName: "ENG4U-course.zip",
    fileSize: 2048,
    jobId: "job-3",
    objectKey: "inbox/uploads/ENG4U/ENG4U-course.zip",
  },
  { relatedJob: { id: "job-3", type: "publish-upload", status: "succeeded", course: "ENG4U" }, jobs: [] },
);
assert.match(uploadDetail, /OSS 对象/);
assert.match(uploadDetail, /OSS 解压/);
assert.match(uploadDetail, /等待 OSS-side 处理/);
assert.match(uploadDetail, /oss-only/);
assert.match(uploadDetail, /OSS-only/);
assert.match(uploadDetail, /目标前缀/);
assert.match(uploadDetail, /courseware-active\/ENG4U\//);
assert.match(uploadDetail, /inbox\/uploads\/ENG4U\/ENG4U-course\.zip/);
assert.match(uploadDetail, /关联媒体任务/);
assert.match(uploadDetail, /data-media-job-action="log"/);

const ossQueue = view.renderOssDirectQueue([
  {
    course: "ENG4U",
    name: "ENG4U-course-package.zip",
    size: 4096,
    etaText: "10秒",
    source: "filename",
    detail: "已从文件名识别课程",
    loaded: 2048,
    overallText: "2 KB / 5 KB",
    status: "uploading",
    percent: 50,
    speedText: "2 MB/s",
    total: 4096,
  },
  {
    course: "",
    name: "unknown.zip",
    size: 1024,
    loaded: 256,
    source: "",
    detail: "无法识别课程码",
    status: "failed",
    percent: 0,
    total: 1024,
  },
  {
    course: "ESLDO",
    name: "ESLDO-course-package.zip",
    size: 1024,
    source: "filename",
    detail: "已取消 OSS 直传。",
    status: "cancelled",
    percent: 0,
  },
]);
assert.match(ossQueue, /ENG4U-course-package\.zip/);
assert.match(ossQueue, /文件名识别/);
assert.match(ossQueue, /上传中/);
assert.match(ossQueue, /未识别/);
assert.match(ossQueue, /失败/);
assert.match(ossQueue, /已取消/);
assert.match(ossQueue, /2 个可上传文件/);
assert.match(ossQueue, /1 门课程/);
assert.match(ossQueue, /批量总进度 40%/);
assert.match(ossQueue, /oss-direct-overall-progress/);
assert.match(ossQueue, /oss-direct-overall-progress" value="40"/);
assert.match(ossQueue, /aria-valuenow="50"/);
assert.match(ossQueue, /oss-direct-queue-progress-bar" style="width: 50%"/);
assert.match(ossQueue, /速度 2 MB\/s/);
assert.match(ossQueue, /剩余约 10秒/);
assert.doesNotMatch(ossQueue, /总进度 2 KB \/ 5 KB/);

const singleOssQueue = view.renderOssDirectQueue([
  {
    course: "MCR3U",
    name: "MCR3U-course-package.zip",
    size: 4096,
    etaText: "10秒",
    source: "filename",
    detail: "上传中",
    loaded: 2048,
    overallText: "2 KB / 22 GB",
    status: "uploading",
    percent: 50,
    speedText: "2 MB/s",
    total: 4096,
  },
]);
assert.match(singleOssQueue, /MCR3U-course-package\.zip/);
assert.match(singleOssQueue, /2\.0 KB \/ 4\.0 KB/);
assert.doesNotMatch(singleOssQueue, /oss-direct-overall-progress/);
assert.doesNotMatch(singleOssQueue, /批量总进度/);
assert.doesNotMatch(singleOssQueue, /22 GB/);

const singleUploadableQueue = view.renderOssDirectQueue([
  {
    course: "MCR3U",
    name: "MCR3U-course-package.zip",
    size: 4096,
    source: "filename",
    detail: "上传中",
    loaded: 2048,
    status: "uploading",
    percent: 50,
    total: 4096,
  },
  {
    course: "MPM1D",
    name: "MPM1D-course-package-old.zip",
    size: 1024,
    source: "filename",
    detail: "本次选择里已有更新课件包",
    status: "skipped",
    percent: 0,
  },
  {
    course: "MHF4U",
    name: "MHF4U-course-package.zip",
    size: 1024,
    source: "filename",
    detail: "已取消这个文件的 OSS 直传。",
    status: "cancelled",
    percent: 0,
  },
]);
assert.match(singleUploadableQueue, /MCR3U-course-package\.zip/);
assert.match(singleUploadableQueue, /MPM1D-course-package-old\.zip/);
assert.match(singleUploadableQueue, /MHF4U-course-package\.zip/);
assert.doesNotMatch(singleUploadableQueue, /oss-direct-overall-progress/);
assert.doesNotMatch(singleUploadableQueue, /批量总进度/);

const progressInfo = view.uploadProgressFormatter({ name: "big.zip", size: 1024 })({
  percent: 50,
  loaded: 512,
  total: 1024,
  objectKey: "inbox/uploads/big.zip",
});
assert.equal(typeof progressInfo, "object");
assert.match(progressInfo.detail, /速度/);
assert.equal(progressInfo.loadedText, "512 B / 1.0 KB");

const summary = view.renderJobSummary({
  id: "job-4",
  type: "check-readiness",
  status: "warning",
  scope: "all",
  progress: { message: "ready-with-warnings" },
});
assert.match(summary, /配置检查/);
assert.match(summary, /ready-with-warnings/);

const logDetail = view.renderJobLogDetail(
  { id: "job-5", type: "sync-oss", status: "running", course: "ENG4U" },
  {
    stdout: "OSS sync progress: 100/610 uploaded",
    stderr: "WARN: retrying upload",
  },
);
assert.match(logDetail, /任务日志/);
assert.match(logDetail, /stdout/);
assert.match(logDetail, /stderr/);
assert.match(logDetail, /OSS sync progress/);
assert.match(logDetail, /WARN: retrying upload/);
assert.match(logDetail, /ENG4U/);

const locks = view.renderLocksSection({
  locks: [{
    course: "ENG4U",
    stale: true,
    canClear: true,
    operation: "sync-oss",
    ageSeconds: 125,
    activeJob: { course: "ENG4U", type: "sync-oss", status: "failed" },
  }],
  staleCount: 1,
  clearableCount: 1,
});
assert.match(locks, /课程操作锁/);
assert.match(locks, /疑似遗留锁/);
assert.match(locks, /data-media-lock-action="clear"/);
assert.match(locks, /data-media-lock-action="clear-stale"/);

console.log("admin media view smoke ok");
