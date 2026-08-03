import { safeCourseSegment } from "./media-delivery-assets.mjs";

export const mediaJobTypes = new Set([
  "audit-videos",
  "optimize-videos",
  "sync-oss",
  "export-cdn-preheat",
  "check-readiness",
  "publish-course",
  "publish-all",
  "publish-upload",
]);

export const mediaWriteJobTypes = new Set(["publish-course", "publish-all", "publish-upload", "sync-oss", "optimize-videos"]);
export const activeMediaJobStatuses = new Set(["queued", "running", "cancelling"]);
export const retryableMediaJobStatuses = new Set(["failed", "warning", "cancelled", "interrupted"]);

export function normalizeMediaJobType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!mediaJobTypes.has(type)) throw new Error("Unsupported media job type.");
  return type;
}

export function mediaJobScope(type, course) {
  if (type === "publish-all") return { scope: "all", course: "" };
  if (type === "audit-videos" && !course) return { scope: "all", course: "" };
  if (type === "optimize-videos" && !course) return { scope: "all", course: "" };
  if (type === "sync-oss" && !course) return { scope: "all", course: "" };
  const normalizedCourse = safeCourseSegment(course || "").toUpperCase();
  if (!normalizedCourse && !["check-readiness", "export-cdn-preheat"].includes(type)) {
    throw new Error("Course is required for this media job type.");
  }
  return { scope: normalizedCourse ? "course" : "all", course: normalizedCourse };
}

export function mediaJobSucceededStatus(job, stdout = "", stderr = "") {
  const payloadStatus = String(job.payload?.status || "").toLowerCase();
  if (payloadStatus === "ready-with-warnings" || payloadStatus === "warning") return "warning";
  if (payloadStatus === "blocked" || payloadStatus === "failed") return "failed";
  if (payloadStatus === "ready" || payloadStatus === "ok" || payloadStatus === "succeeded") return "succeeded";

  const stepStatuses = Array.isArray(job.payload?.steps) ? job.payload.steps.map((step) => String(step?.status || "").toLowerCase()) : [];
  if (stepStatuses.includes("failed")) return "failed";
  if (stepStatuses.includes("warning")) return "warning";

  const output = `${stdout}\n${stderr}`;
  if (/^Media delivery readiness:\s*ready-with-warnings\b/im.test(output) || /^WARN:/m.test(output)) return "warning";
  return "succeeded";
}

export function parseMediaJobProgressFromText(job, text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  const progress = {
    phase: "",
    current: 0,
    total: 0,
    percent: null,
    failed: 0,
    currentFile: "",
    message: "",
  };
  for (const line of lines) {
    const phaseMatch = /^==\s+(.+?)\s+==$/.exec(line.trim());
    if (phaseMatch) {
      progress.phase = phaseMatch[1];
      progress.message = phaseMatch[1];
      continue;
    }
    let match = /^OSS sync uploading:\s+(\d+)\/(\d+)\s+([0-9.]+)\s+MB\s+(.+)$/i.exec(line);
    if (match) {
      progress.phase = "OSS upload";
      progress.current = Number(match[1]);
      progress.total = Number(match[2]);
      progress.percent = progress.total ? Math.max(0, Math.min(99, Math.round(((progress.current - 1) / progress.total) * 100))) : null;
      progress.currentFile = match[4];
      progress.message = `正在上传 ${match[1]}/${match[2]} · ${match[3]} MB`;
      continue;
    }
    match = /^OSS sync progress:\s+(\d+)\/(\d+)\s+uploaded,\s+failed\s+(\d+)$/i.exec(line);
    if (match) {
      progress.phase = "OSS upload";
      progress.current = Number(match[1]);
      progress.total = Number(match[2]);
      progress.failed = Number(match[3]);
      progress.percent = progress.total ? Math.round((progress.current / progress.total) * 100) : null;
      progress.message = `已上传 ${match[1]}/${match[2]}，失败 ${match[3]}`;
      continue;
    }
    match = /^Video optimization processing:\s+(\d+)\/(\d+)\s+([0-9.]+)\s+MB\s+(.+)$/i.exec(line);
    if (match) {
      progress.phase = "Video optimization";
      progress.current = Number(match[1]);
      progress.total = Number(match[2]);
      progress.percent = progress.total ? Math.max(0, Math.min(99, Math.round(((progress.current - 1) / progress.total) * 100))) : null;
      progress.currentFile = match[4];
      progress.message = `正在压缩 ${match[1]}/${match[2]} · ${match[3]} MB`;
      continue;
    }
    match = /^Video optimization progress:\s+(\d+)\/(\d+)\s+optimized,\s+failed\s+(\d+)$/i.exec(line);
    if (match) {
      progress.phase = "Video optimization";
      progress.current = Number(match[1]);
      progress.total = Number(match[2]);
      progress.failed = Number(match[3]);
      progress.percent = progress.total ? Math.round((progress.current / progress.total) * 100) : null;
      progress.message = `已压缩 ${match[1]}/${match[2]}，失败 ${match[3]}`;
    }
  }
  if (job.status === "succeeded" || job.status === "warning") {
    progress.percent = 100;
    progress.message = job.status === "warning" ? "已完成，有提示" : "已完成";
  } else if (job.status === "failed") {
    progress.message = progress.message || "任务失败";
  } else if (job.status === "queued") {
    progress.message = "等待执行";
  } else if (!progress.message && job.status === "running") {
    progress.message = "正在运行";
  }
  return progress;
}

export function mediaJobSummarySource(job) {
  return job?.summary || job?.payload?.summaries || job?.payload?.summary || job?.payload || {};
}

function mediaJobRawText(job) {
  return [
    job?.error,
    job?.summary?.status,
    job?.payload?.status,
    job?.stderrTail,
    job?.stdoutTail,
  ].filter(Boolean).join("\n");
}

export function mediaJobResultText(job) {
  const raw = mediaJobRawText(job);
  if (!raw) return job?.progress?.message || (job?.status === "running" ? "正在运行" : "");
  const text = String(raw).replace(/\s+/g, " ").trim();
  const lockMatch = /Course\s+([A-Z0-9]+)\s+is locked/i.exec(text);
  if (lockMatch) return `${lockMatch[1]} 存在旧操作锁，清理锁后重试`;
  const stepMatch = /name:\s*['"]([^'"]+)['"]/i.exec(text) || /Error:\s*([A-Za-z0-9 _-]+)\s+failed with exit code/i.exec(text);
  if (/AccessDenied|Forbidden|HTTP\s*403|x-oss-ec|oss-cdn-auth/i.test(text)) return "OSS/CDN 权限或私有 Bucket 回源授权被拒绝";
  if (/CORS|cross-origin|network error|Failed to fetch/i.test(text)) return "OSS 直传 CORS 或网络配置异常";
  if (/Unknown argument:\s*--all|invalid usage/i.test(text)) return "媒体脚本参数不兼容，请更新命令或脚本";
  if (/ffprobe is unavailable|ffprobe.*not found|Command 'ffprobe' not found/i.test(text)) return "ffprobe 不可用，无法审计视频码率";
  if (/ffmpeg is unavailable|ffmpeg.*not found|Command 'ffmpeg' not found/i.test(text)) return "ffmpeg 不可用，无法压缩视频";
  if (/Missing course manifest/i.test(text)) return "找不到课程 manifest，请确认课程目录已导入";
  if (stepMatch) return `${stepMatch[1].trim()} 失败，请打开日志查看详细输出`;
  if (/ready-with-warnings/i.test(text)) return "配置可用，但有提示";
  if (/Video audit report is missing/i.test(text)) return "缺少视频审计报告";
  if (/ossutil/i.test(text) && /not available|not found/i.test(text)) return "ossutil 不可用";
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

export function mediaJobNextStep(job) {
  const raw = mediaJobRawText(job);
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const lockMatch = /Course\s+([A-Z0-9]+)\s+is locked/i.exec(text);
  if (lockMatch) {
    const course = lockMatch[1].toUpperCase();
    return {
      text: `确认没有发布任务运行后，清理 ${course} 课程锁并重试。`,
      action: { type: "clear-lock", course, label: "清理课程锁" },
    };
  }
  if (/AccessDenied|Forbidden|HTTP\s*403|x-oss-ec|oss-cdn-auth/i.test(text)) {
    return {
      text: "检查 CDN 私有 Bucket 回源授权、OSS Bucket 权限和回源 Host，然后重试。",
      action: null,
    };
  }
  if (/CORS|cross-origin|network error|Failed to fetch/i.test(text)) {
    return {
      text: "检查 OSS CORS 是否允许当前域名、PUT/POST/HEAD 和必要 Headers，然后重新直传。",
      action: null,
    };
  }
  if (/Unknown argument:\s*--all|invalid usage/i.test(text)) {
    return {
      text: "先更新线上代码和脚本命令，再重试媒体任务。",
      action: null,
    };
  }
  if (/ffprobe is unavailable|ffprobe.*not found|Command 'ffprobe' not found/i.test(text)) {
    return {
      text: "安装或配置 ffprobe 后，重新执行视频审计或发布任务。",
      action: null,
    };
  }
  if (/ffmpeg is unavailable|ffmpeg.*not found|Command 'ffmpeg' not found/i.test(text)) {
    return {
      text: "安装或配置 ffmpeg 后，再执行视频压缩或发布任务。",
      action: null,
    };
  }
  if (/Missing course manifest/i.test(text)) {
    return {
      text: "确认课程目录已完整导入并生成 manifest，再发布到 OSS/CDN。",
      action: null,
    };
  }
  if (/Video audit report is missing/i.test(text)) {
    return {
      text: "先运行视频审计，或重新执行发布任务让系统自动生成审计报告。",
      action: null,
    };
  }
  if (/ossutil/i.test(text) && /not available|not found/i.test(text)) {
    return {
      text: "安装并配置 ossutil 后重试；直传上传本身不依赖它，但服务器同步/检查会用到。",
      action: null,
    };
  }
  const stepMatch = /name:\s*['"]([^'"]+)['"]/i.exec(text) || /Error:\s*([A-Za-z0-9 _-]+)\s+failed with exit code/i.exec(text);
  if (stepMatch) {
    return {
      text: `打开详情/日志查看 ${stepMatch[1].trim()} 的输出，修复后重试。`,
      action: null,
    };
  }
  if (/ready-with-warnings/i.test(text) || job?.status === "warning") {
    return {
      text: "打开详情确认提示；没有 blocker 时课程通常已经可继续使用。",
      action: null,
    };
  }
  if (job?.status === "failed") {
    return {
      text: "打开详情/日志查看失败步骤，修复配置或文件后重试。",
      action: null,
    };
  }
  return { text: "", action: null };
}

export function mediaJobDetailText(job) {
  const raw = job?.error || job?.progress?.message || job?.summary?.status || job?.payload?.status || "";
  return String(raw || "").trim();
}

function addMetric(values, label, value, formatter = (item) => item) {
  if (!Number.isFinite(value)) return;
  values.push(`${label} ${formatter(value)}`);
}

export function mediaJobMetricValues(job) {
  const summary = mediaJobSummarySource(job);
  const values = [];
  if (job?.progress?.total) values.push(`进度 ${job.progress.current || 0}/${job.progress.total}`);
  addMetric(values, "文件", summary.files);
  addMetric(values, "已上传", summary.uploaded);
  if (Number.isFinite(summary.failed) && summary.failed > 0) values.push(`失败 ${summary.failed}`);
  addMetric(values, "大小", summary.totalGb, (value) => `${Number(value).toFixed(2)} GB`);
  addMetric(values, "压缩", summary.optimized);
  if (Number.isFinite(summary.savedMb) && summary.savedMb > 0) values.push(`节省 ${Number(summary.savedMb).toFixed(1)} MB`);
  if (summary.audit) {
    addMetric(values, "审计", summary.audit.files);
    addMetric(values, "视频", summary.audit.totalGb, (value) => `${Number(value).toFixed(2)} GB`);
  }
  if (summary.optimization) {
    addMetric(values, "压缩", summary.optimization.optimized);
    if (Number.isFinite(summary.optimization.savedMb) && summary.optimization.savedMb > 0) {
      values.push(`节省 ${Number(summary.optimization.savedMb).toFixed(1)} MB`);
    }
  }
  if (summary.registry?.assetCount) values.push(`Registry ${summary.registry.assetCount}`);
  return [...new Set(values)].slice(0, 6);
}

export function mediaJobTone(job) {
  if (["failed", "cancelled", "interrupted"].includes(job?.status)) return "issue";
  if (job?.status === "warning") return "warning";
  if (activeMediaJobStatuses.has(job?.status)) return "active";
  return "";
}

export function mediaJobDisplay(job) {
  const next = mediaJobNextStep(job);
  return {
    result: mediaJobResultText(job),
    detail: mediaJobDetailText(job),
    metrics: mediaJobMetricValues(job),
    tone: mediaJobTone(job),
    nextStep: next.text,
    action: next.action,
  };
}
