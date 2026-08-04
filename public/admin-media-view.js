(function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatDurationSeconds(value) {
    const seconds = Math.max(0, Math.round(Number(value || 0)));
    if (!seconds) return "计算中";
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分${seconds % 60 ? `${seconds % 60} 秒` : ""}`;
    const hours = Math.floor(minutes / 60);
    return `${hours} 小时${minutes % 60 ? `${minutes % 60} 分` : ""}`;
  }

  function statusLabel(status) {
    const value = String(status || "unknown");
    const className = ["succeeded", "ready"].includes(value)
      ? "status-ok"
      : ["failed", "interrupted", "cancelled"].includes(value)
        ? "status-risk"
        : "warn";
    const labels = {
      queued: "排队中",
      running: "运行中",
      cancelling: "取消中",
      succeeded: "已完成",
      warning: "有提示",
      failed: "失败",
      cancelled: "已取消",
      interrupted: "已中断",
      ready: "就绪",
    };
    return `<span class="${className}">${escapeHtml(labels[value] || value)}</span>`;
  }

  function uploadStatusLabel(status) {
    const value = String(status || "unknown");
    const className = ["uploaded", "queued", "importing", "imported"].includes(value)
      ? "status-ok"
      : ["failed", "expired", "cancelled"].includes(value)
        ? "status-risk"
        : "warn";
    const labels = {
      created: "待上传",
      uploaded: "已上传",
      importing: "导入中",
      imported: "已导入",
      queued: "已排队",
      failed: "失败",
      expired: "已过期",
      cancelled: "已取消",
    };
    return `<span class="${className}">${escapeHtml(labels[value] || value)}</span>`;
  }

  function uploadKindLabel(kind) {
    const labels = {
      "course-package": "完整课件包",
      video: "视频",
      h5p: "H5P",
      "ispring-package": "iSpring 包",
    };
    return labels[kind] || kind || "";
  }

  function jobTypeLabel(type) {
    const labels = {
      "audit-videos": "视频审计",
      "optimize-videos": "视频压缩",
      "sync-oss": "同步 OSS",
      "export-cdn-preheat": "CDN 预热清单",
      "check-readiness": "配置检查",
      "publish-course": "发布课程",
      "publish-all": "全量发布",
      "publish-upload": "发布直传文件",
    };
    return labels[type] || type || "";
  }

  function jobDuration(job) {
    const start = new Date(job?.startedAt || job?.requestedAt || "");
    const end = job?.finishedAt ? new Date(job.finishedAt) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
    const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return `${minutes}m ${rest}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  function coursePublishState(course) {
    const state = course?.publishState || "";
    if (state === "publishing") {
      return {
        className: "warn",
        label: "发布中",
        detail: course?.activeJob?.progress?.message || course?.activeJob?.type || "任务运行中",
      };
    }
    if (state === "published") {
      return {
        className: "status-ok",
        label: "已发布",
        detail: `${course?.publishedCount || 0}/${course?.fileCount || 0} 可播放资源`,
      };
    }
    if (state === "partial") {
      return {
        className: "status-missing",
        label: "部分发布",
        detail: `${course?.publishedCount || 0}/${course?.fileCount || 0} 可播放资源`,
      };
    }
    if (state === "empty") {
      return {
        className: "meta-line",
        label: "无可发布媒体",
        detail: course?.localFileCount ? `${course.localFileCount} local files` : "0 local files",
      };
    }
    return {
      className: "status-risk",
      label: "未发布",
      detail: `${course?.fileCount || 0} 可播放资源`,
    };
  }

  function percent(value) {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }

  function renderCourseState(course) {
    const state = coursePublishState(course);
    const latestJob = course?.latestJob || null;
    const latestStatus = latestJob?.status || "";
    const hasPublishableAssets = Number(course?.fileCount || 0) > 0;
    const latest = hasPublishableAssets && latestStatus && !["succeeded", "ready"].includes(latestStatus)
      ? ` · 最近任务：${jobResult(latestJob) || latestStatus}`
      : "";
    return `
      <div class="media-course-status">
        <strong class="${state.className}">${escapeHtml(state.label)}</strong>
        <small>${escapeHtml(state.detail)}${escapeHtml(latest)}</small>
      </div>
    `;
  }

  function renderCourseRow(course, { activeWriteJob = null, selectedCourse = "" } = {}) {
    const hasPublishableAssets = Number(course?.fileCount || 0) > 0;
    const publishDisabled = activeWriteJob || course?.publishState === "publishing" || !hasPublishableAssets;
    const publishTitle = activeWriteJob
      ? `已有写任务运行中：${activeWriteJob.course || activeWriteJob.scope || "all"}`
      : course?.publishState === "publishing"
        ? "该课程已有媒体任务运行中"
        : !hasPublishableAssets
          ? "该课程没有可发布媒体"
          : "";
    const code = escapeHtml(course?.code || "");
    const isSelected = String(course?.code || "").toUpperCase() === String(selectedCourse || "").toUpperCase();
    return `
      <tr${isSelected ? ' class="media-course-row-current"' : ""}>
        <td><strong>${code}</strong>${isSelected ? '<span class="media-course-current-badge">当前</span>' : ""}</td>
        <td>${escapeHtml(course?.title || "")}</td>
        <td class="nowrap">${formatBytes(course?.totalBytes || 0)}</td>
        <td>${course?.fileCount || 0}</td>
        <td>${course?.localFileCount || course?.fileCount || 0}</td>
        <td>${course?.skippedLocalFileCount || 0}</td>
        <td>${course?.videoCount || 0}</td>
        <td>${course?.publishedCount || 0}</td>
        <td>${course?.unpublishedCount || 0}</td>
        <td>${percent(course?.cdnCoverage)}</td>
        <td>${renderCourseState(course)}</td>
        <td class="nowrap">
          <button class="small" type="button" data-media-course-action="publish" data-course="${code}" ${publishDisabled ? "disabled" : ""} title="${escapeHtml(publishTitle)}">发布</button>
          <button class="small" type="button" data-media-course-action="audit" data-course="${code}">审计</button>
        </td>
      </tr>
    `;
  }

  function renderCoursesSection({
    courses = [],
    allCourses = courses,
    assetScope = "playable",
    activeWriteJob = null,
    selectedCourse = "",
  } = {}) {
    const rows = courses.map((course) => renderCourseRow(course, { activeWriteJob, selectedCourse })).join("");
    return `
      <div class="media-section-title">
        <h3>课程发布状态</h3>
        <span class="meta-line">显示 ${courses.length}/${allCourses.length} 门 · 发布范围：${assetScope === "all" ? "全部文件" : "可播放资源（视频 / H5P / iSpring）"}</span>
      </div>
      <div class="table-wrap media-course-table-wrap">
        <table class="media-course-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Title</th>
              <th>Size</th>
              <th>可发布</th>
              <th>本地总文件</th>
              <th>已跳过</th>
              <th>Videos</th>
              <th>CDN</th>
              <th>Remaining</th>
              <th>Coverage</th>
              <th>Publish State</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="12">No media courses found.</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  function hasActiveJobs(jobs = []) {
    return jobs.some((job) => ["queued", "running", "cancelling"].includes(job.status));
  }

  function hasActiveUploads(uploads = []) {
    return uploads.some((upload) =>
      ["created", "importing", "queued"].includes(upload.status)
      || ["queued", "running", "processing"].includes(upload.importStatus)
    );
  }

  function activeWriteJob(jobs = []) {
    const writeTypes = new Set(["publish-course", "publish-all", "publish-upload", "sync-oss", "optimize-videos"]);
    return jobs.find((job) => writeTypes.has(job.type) && ["queued", "running", "cancelling"].includes(job.status)) || null;
  }

  function jobResult(job) {
    if (job?.display?.result) return job.display.result;
    const raw = job?.error || job?.summary?.status || job?.payload?.status || "";
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

  function jobDetail(job) {
    if (job?.display?.detail) return job.display.detail;
    const raw = job?.error || job?.progress?.message || job?.summary?.status || job?.payload?.status || "";
    return String(raw || "").trim();
  }

  function jobRawText(job) {
    return [
      job?.error,
      job?.summary?.status,
      job?.payload?.status,
      job?.stderrTail,
      job?.stdoutTail,
    ].filter(Boolean).join("\n");
  }

  function jobNextStep(job) {
    if (job?.display?.nextStep) return job.display.nextStep;
    const text = String(jobRawText(job) || "").replace(/\s+/g, " ").trim();
    const lockMatch = /Course\s+([A-Z0-9]+)\s+is locked/i.exec(text);
    if (lockMatch) return `确认没有发布任务运行后，清理 ${lockMatch[1].toUpperCase()} 课程锁并重试。`;
    if (/AccessDenied|Forbidden|HTTP\s*403|x-oss-ec|oss-cdn-auth/i.test(text)) return "检查 CDN 私有 Bucket 回源授权、OSS Bucket 权限和回源 Host，然后重试。";
    if (/CORS|cross-origin|network error|Failed to fetch/i.test(text)) return "检查 OSS CORS 是否允许当前域名、PUT/POST/HEAD 和必要 Headers，然后重新直传。";
    if (/Unknown argument:\s*--all|invalid usage/i.test(text)) return "先更新线上代码和脚本命令，再重试媒体任务。";
    if (/ffprobe is unavailable|ffprobe.*not found|Command 'ffprobe' not found/i.test(text)) return "安装或配置 ffprobe 后，重新执行视频审计或发布任务。";
    if (/ffmpeg is unavailable|ffmpeg.*not found|Command 'ffmpeg' not found/i.test(text)) return "安装或配置 ffmpeg 后，再执行视频压缩或发布任务。";
    if (/Missing course manifest/i.test(text)) return "确认课程目录已完整导入并生成 manifest，再发布到 OSS/CDN。";
    if (/Video audit report is missing/i.test(text)) return "先运行视频审计，或重新执行发布任务让系统自动生成审计报告。";
    if (/ossutil/i.test(text) && /not available|not found/i.test(text)) return "安装并配置 ossutil 后重试；直传上传本身不依赖它，但服务器同步/检查会用到。";
    const stepMatch = /name:\s*['"]([^'"]+)['"]/i.exec(text) || /Error:\s*([A-Za-z0-9 _-]+)\s+failed with exit code/i.exec(text);
    if (stepMatch) return `打开详情/日志查看 ${stepMatch[1].trim()} 的输出，修复后重试。`;
    if (/ready-with-warnings/i.test(text) || job?.status === "warning") return "打开详情确认提示；没有 blocker 时课程通常已经可继续使用。";
    if (job?.status === "failed") return "打开详情/日志查看失败步骤，修复配置或文件后重试。";
    return "";
  }

  function jobSuggestedAction(job) {
    if (job?.display?.action) return job.display.action;
    const text = String(jobRawText(job) || "").replace(/\s+/g, " ").trim();
    const lockMatch = /Course\s+([A-Z0-9]+)\s+is locked/i.exec(text);
    if (lockMatch) {
      return { type: "clear-lock", course: lockMatch[1].toUpperCase(), label: "清理课程锁" };
    }
    return null;
  }

  function renderJobResolution(job) {
    const next = jobNextStep(job);
    if (!next) return "";
    return `
      <div class="media-job-resolution">
        <strong>下一步</strong>
        <span>${escapeHtml(next)}</span>
      </div>
    `;
  }

  function jobCardClass(job) {
    if (job?.display?.tone) return job.display.tone;
    if (["failed", "cancelled", "interrupted"].includes(job?.status)) return "issue";
    if (job?.status === "warning") return "warning";
    if (["queued", "running", "cancelling"].includes(job?.status)) return "active";
    return "";
  }

  function jobSummarySource(job) {
    return job?.summary || job?.payload?.summaries || job?.payload?.summary || job?.payload || {};
  }

  function jobMetricValues(job) {
    if (Array.isArray(job?.display?.metrics)) return job.display.metrics;
    const summary = jobSummarySource(job);
    const values = [];
    if (job?.progress?.total) values.push(`进度 ${job.progress.current || 0}/${job.progress.total}`);
    if (Number.isFinite(summary.files)) values.push(`文件 ${summary.files}`);
    if (Number.isFinite(summary.uploaded)) values.push(`已上传 ${summary.uploaded}`);
    if (Number.isFinite(summary.failed) && summary.failed > 0) values.push(`失败 ${summary.failed}`);
    if (Number.isFinite(summary.totalGb)) values.push(`大小 ${Number(summary.totalGb).toFixed(2)} GB`);
    if (Number.isFinite(summary.optimized)) values.push(`压缩 ${summary.optimized}`);
    if (Number.isFinite(summary.savedMb) && summary.savedMb > 0) values.push(`节省 ${Number(summary.savedMb).toFixed(1)} MB`);
    if (summary.audit) {
      if (Number.isFinite(summary.audit.files)) values.push(`审计 ${summary.audit.files}`);
      if (Number.isFinite(summary.audit.totalGb)) values.push(`视频 ${Number(summary.audit.totalGb).toFixed(2)} GB`);
    }
    if (summary.optimization) {
      if (Number.isFinite(summary.optimization.optimized)) values.push(`压缩 ${summary.optimization.optimized}`);
      if (Number.isFinite(summary.optimization.savedMb) && summary.optimization.savedMb > 0) values.push(`节省 ${Number(summary.optimization.savedMb).toFixed(1)} MB`);
    }
    if (summary.registry?.assetCount) values.push(`Registry ${summary.registry.assetCount}`);
    return [...new Set(values)].slice(0, 6);
  }

  function shortDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function detailItem(label, value) {
    const normalized = value === undefined || value === null || value === "" ? "-" : value;
    return `
      <div class="media-detail-item">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(normalized)}</strong>
      </div>
    `;
  }

  function statItem(label, value) {
    const normalized = value === undefined || value === null || value === "" ? "-" : value;
    return `<div class="stat"><span>${escapeHtml(label)}</span><strong class="${String(normalized).length > 24 ? "small-value" : ""}">${escapeHtml(normalized)}</strong></div>`;
  }

  function renderStatGrid(rows = []) {
    return rows.map(([label, value]) => statItem(label, value)).join("");
  }

  function mediaConfigRows(data = {}) {
    const config = data.config || {};
    const summary = data.summary || {};
    const assetScopeText = config.assetScope === "all" ? "all" : "playable";
    return [
      ["任务中心", config.enabled ? "已启用" : "未启用"],
      ["Asset mode", config.assetMode || ""],
      ["Asset scope", assetScopeText],
      ["OSS", config.bucket || "未配置"],
      ["CDN", config.cdnBaseUrl || "未配置"],
      ["Registry", `${data.registry?.assetCount || 0} assets`],
      ["可发布资源", summary.files || 0],
      ["本地总文件", summary.localFiles || summary.files || 0],
      ["已跳过", summary.skippedFiles || 0],
      ["已发布", summary.published || 0],
      ["未发布", summary.unpublished || 0],
      ["运行中任务", summary.runningJobs || 0],
      ["课程锁", `${summary.locks || 0}${summary.staleLocks ? ` / ${summary.staleLocks} stale` : ""}`],
    ];
  }

  function renderMediaConfigStats(data = {}) {
    return renderStatGrid(mediaConfigRows(data));
  }

  function mediaOssRows(oss = {}) {
    const status = !oss.enabled
      ? "未配置"
      : oss.ok
        ? "正常"
        : "检查失败";
    const checkedAt = oss.generatedAt ? shortDateTime(oss.generatedAt) : "";
    const cacheText = oss.cacheHit ? `缓存 ${oss.cacheSeconds || 60}s` : "刚检查";
    const rows = [
      ["OSS 实况", status],
      ["对象数量", oss.ok ? `${oss.objectCount || 0}` : "-"],
      ["OSS 占用", oss.ok ? formatBytes(oss.totalBytes || 0) : "-"],
      ["监控路径", oss.target || oss.bucket || "-"],
      ["上次检查", checkedAt ? `${checkedAt} · ${cacheText}` : cacheText],
    ];
    if (oss.error) rows.push(["提示", oss.error]);
    return rows;
  }

  function renderMediaOssStats(oss) {
    if (!oss) return "";
    return renderStatGrid(mediaOssRows(oss));
  }

  function renderJobMetrics(job) {
    const values = jobMetricValues(job);
    if (!values.length) return "";
    return `<div class="media-job-metrics">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>`;
  }

  function renderJobProgress(job) {
    const progress = job?.progress || {};
    const hasProgress = progress.percent !== null && progress.percent !== undefined;
    const active = ["queued", "running", "cancelling"].includes(job?.status);
    if (!hasProgress && !active && !progress.message) return "";
    const percentValue = hasProgress ? Math.max(0, Math.min(100, Number(progress.percent || 0))) : 0;
    const count = progress.total ? `${progress.current || 0}/${progress.total}` : "";
    const failed = Number(progress.failed || 0);
    const detailParts = [
      count,
      hasProgress ? `${percentValue}%` : "",
      failed > 0 ? `失败 ${failed}` : "",
    ].filter(Boolean);
    const phase = progress.phase || job?.type;
    const message = String(progress.message || "").trim();
    return `
      <div class="media-job-progress">
        <div class="media-job-progress-meta">
          <span>${escapeHtml(phase)}</span>
          <span>${escapeHtml(detailParts.join(" · "))}</span>
        </div>
        ${hasProgress ? `<div class="progress"><div class="progress-bar" style="width: ${percentValue}%"></div></div>` : ""}
        ${message ? `<div class="media-job-progress-message">${escapeHtml(message)}</div>` : ""}
        ${progress.currentFile ? `<div class="media-job-current" title="${escapeHtml(progress.currentFile)}">${escapeHtml(progress.currentFile)}</div>` : ""}
      </div>
    `;
  }

  function renderJobSummary(job) {
    if (!job) return "";
    const items = [
      ["任务", job.id],
      ["类型", jobTypeLabel(job.type)],
      ["课程/范围", job.course || job.scope || "all"],
      ["状态", job.status],
      ["开始", shortDateTime(job.startedAt || job.requestedAt)],
      ["完成", shortDateTime(job.finishedAt)],
      ["耗时", jobDuration(job)],
      ["进度", job.progress?.message || ""],
    ];
    const detail = jobDetail(job);
    return `
      <div class="media-detail-grid">${items.map(([label, value]) => detailItem(label, value)).join("")}</div>
      ${detail ? `<div class="media-job-result">${escapeHtml(detail)}</div>` : ""}
      ${renderJobMetrics(job)}
      ${renderJobProgress(job)}
    `;
  }

  function renderJobLogDetail(job, logText = "") {
    const logs = typeof logText === "object" && logText !== null
      ? {
          stdout: logText.stdout || "",
          stderr: logText.stderr || "",
        }
      : {
          stdout: String(logText || ""),
          stderr: "",
        };
    return `
      ${renderJobSummary(job)}
      <h3>任务日志</h3>
      <h4>stdout</h4>
      <pre>${escapeHtml(logs.stdout || "(empty)")}</pre>
      <h4>stderr</h4>
      <pre>${escapeHtml(logs.stderr || "(empty)")}</pre>
    `;
  }

  function renderJobCard(job) {
    const jobId = escapeHtml(job?.id || "");
    const result = jobResult(job);
    const detail = jobDetail(job);
    const action = jobSuggestedAction(job);
    const detailHtml = detail && detail !== result
      ? `<details><summary>展开详情</summary><pre>${escapeHtml(detail)}</pre></details>`
      : "";
    const duration = jobDuration(job);
    return `
      <article class="media-job-card ${jobCardClass(job)}">
        <div>
          <header>
            <strong>${escapeHtml(job?.course || job?.scope || "all")}</strong>
            ${statusLabel(job?.status)}
            <span class="media-job-id" title="${jobId}">${jobId}</span>
          </header>
          <div class="media-job-card-meta">
            <span>${escapeHtml(jobTypeLabel(job?.type))}</span>
            <span>开始 ${escapeHtml(shortDateTime(job?.startedAt || job?.requestedAt) || "-")}</span>
            <span>完成 ${escapeHtml(shortDateTime(job?.finishedAt) || "-")}</span>
            ${duration ? `<span>耗时 ${escapeHtml(duration)}</span>` : ""}
          </div>
          <div class="media-job-result" title="${escapeHtml(String(job?.error || result || ""))}">
            ${escapeHtml(result || job?.progress?.message || "")}
            ${detailHtml}
          </div>
          ${renderJobResolution(job)}
          ${renderJobMetrics(job)}
          ${renderJobProgress(job)}
        </div>
        <div class="media-job-card-actions">
          <button class="small" type="button" data-media-job-action="log" data-job="${jobId}">详情/日志</button>
          ${action?.type === "clear-lock" && action.course ? `<button class="small" type="button" data-media-job-action="clear-lock" data-course="${escapeHtml(action.course)}">${escapeHtml(action.label || "清理课程锁")}</button>` : ""}
          ${job?.status === "running" ? `<button class="small" type="button" data-media-job-action="cancel" data-job="${jobId}">取消</button>` : ""}
          ${["failed", "warning", "cancelled", "interrupted"].includes(job?.status) ? `<button class="small" type="button" data-media-job-action="retry" data-job="${jobId}">重试</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderJobsSection({ jobs = [], allJobs = jobs } = {}) {
    const activeCount = allJobs.filter((job) => ["queued", "running", "cancelling"].includes(job.status)).length;
    const attentionCount = allJobs.filter((job) => ["failed", "warning", "cancelled", "interrupted"].includes(job.status)).length;
    const cards = jobs.map(renderJobCard).join("");
    return `
      <div class="media-section-title">
        <h3>媒体任务</h3>
        <span class="meta-line">显示 ${jobs.length}/${allJobs.length} 个 · 运行中 ${activeCount} · 需关注 ${attentionCount}</span>
      </div>
      <div class="media-job-card-list">${cards || '<p class="media-job-empty">没有符合当前筛选条件的媒体任务。</p>'}</div>
    `;
  }

  function uploadTimeline(upload, jobs = []) {
    const relatedJob = upload?.jobId ? jobs.find((job) => job.id === upload.jobId) : null;
    const uploadDone = ["uploaded", "importing", "ready", "needs-review", "imported", "queued"].includes(upload?.status);
    const uploadFailed = ["failed", "expired", "cancelled"].includes(upload?.status);
    const importStarted = Boolean(upload?.importId || upload?.importStatus);
    const importDone = ["committed", "ready", "imported"].includes(upload?.importStatus) || ["imported", "queued"].includes(upload?.status);
    const importFailed = upload?.status === "needs-review" || upload?.importStatus === "needs-review" || uploadFailed;
    const publishStarted = Boolean(upload?.jobId);
    const publishDone = ["succeeded", "ready"].includes(relatedJob?.status);
    const publishIssue = ["failed", "warning", "cancelled", "interrupted"].includes(relatedJob?.status) || Boolean(upload?.mediaJobWarning);

    const steps = [
      {
        label: "直传 OSS",
        state: uploadFailed ? "issue" : uploadDone ? "done" : "active",
        detail: uploadFailed ? "上传异常" : uploadDone ? "对象已保存" : "等待浏览器上传",
      },
      {
        label: "导入课程",
        state: importFailed ? "issue" : importDone ? "done" : importStarted ? "active" : "",
        detail: importFailed ? "需要处理" : importDone ? "课程已导入" : importStarted ? upload.importStatus || "导入中" : "等待导入",
      },
      {
        label: "发布媒体",
        state: publishIssue ? "issue" : publishDone ? "done" : publishStarted ? "active" : "",
        detail: publishIssue ? "有提示或失败" : publishDone ? "媒体已发布" : publishStarted ? (relatedJob?.progress?.message || relatedJob?.status || "任务排队中") : "等待任务",
      },
      {
        label: "可播放",
        state: publishIssue ? "issue" : publishDone ? "done" : "",
        detail: publishIssue ? "请看日志" : publishDone ? "CDN/OSS 就绪" : "等待完成",
      },
    ];

    if (upload?.kind !== "course-package") {
      steps[1] = {
        label: "归档到 inbox",
        state: uploadDone ? "done" : uploadFailed ? "issue" : "",
        detail: uploadDone ? "等待后续处理" : uploadFailed ? "上传异常" : "等待上传",
      };
    }

    return steps
      .map((step) => `
        <div class="media-upload-step ${step.state}">
          <strong>${escapeHtml(step.label)}</strong>
          <span>${escapeHtml(step.detail)}</span>
        </div>
      `)
      .join("");
  }

  function renderUploadCard(upload, jobs = []) {
    const objectKey = upload?.objectKey || upload?.ossUri || "";
    const uploadId = escapeHtml(upload?.id || "");
    const related = upload?.jobId
      ? `媒体任务 ${upload.jobId}`
      : upload?.importId
        ? `导入任务 ${upload.importId}${upload.importStatus ? ` · ${upload.importStatus}` : ""}`
        : "";
    return `
      <article class="media-upload-card">
        <div>
          <header>
            <strong>${escapeHtml(upload?.course || "未识别课程")}</strong>
            ${uploadStatusLabel(upload?.status)}
            <span class="meta-line">${escapeHtml(uploadKindLabel(upload?.kind))}</span>
          </header>
          <div class="media-upload-card-meta">
            <span>${escapeHtml(upload?.fileName || "")}</span>
            <span>${formatBytes(upload?.fileSize || 0)}</span>
            <span>创建 ${escapeHtml(shortDateTime(upload?.requestedAt) || "-")}</span>
            <span>完成 ${escapeHtml(shortDateTime(upload?.completedAt) || "-")}</span>
            ${related ? `<span>${escapeHtml(related)}</span>` : ""}
          </div>
          <div class="media-upload-timeline">${uploadTimeline(upload, jobs)}</div>
          ${objectKey ? `<div class="media-upload-object" title="${escapeHtml(objectKey)}">${escapeHtml(objectKey)}</div>` : ""}
          ${upload?.error || upload?.mediaJobWarning ? `<div class="media-job-result status-risk">${escapeHtml(upload.error || upload.mediaJobWarning)}</div>` : ""}
        </div>
        <div class="media-job-card-actions">
          <button class="small" type="button" data-media-upload-action="detail" data-upload="${uploadId}">详情</button>
          ${upload?.jobId ? `<button class="small" type="button" data-media-job-action="log" data-job="${escapeHtml(upload.jobId)}">任务日志</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderUploadsSection({ uploads = [], jobs = [] } = {}) {
    const visibleUploads = uploads.slice(0, 20);
    const cards = visibleUploads.map((upload) => renderUploadCard(upload, jobs)).join("");
    return `
      <div class="media-section-title">
        <h3>OSS 直传记录</h3>
        <span class="meta-line">${uploads.length ? `最近 ${Math.min(uploads.length, 20)}/${uploads.length} 条` : "暂无直传记录"}</span>
      </div>
      <div class="media-upload-card-list">${cards || '<p class="media-job-empty">还没有 OSS 直传记录。</p>'}</div>
    `;
  }

  function renderUploadDetail(upload, { relatedJob = null, jobs = [] } = {}) {
    const items = [
      ["课程", upload?.course || "未识别"],
      ["上传类型", uploadKindLabel(upload?.kind)],
      ["状态", upload?.status],
      ["文件", upload?.fileName],
      ["大小", formatBytes(upload?.fileSize || 0)],
      ["创建", shortDateTime(upload?.requestedAt)],
      ["完成", shortDateTime(upload?.completedAt)],
      ["课程识别", upload?.courseSource || ""],
      ["导入任务", upload?.importId || ""],
      ["导入状态", upload?.importStatus || ""],
      ["媒体任务", upload?.jobId || ""],
      ["OSS 对象", upload?.objectKey || upload?.ossUri || ""],
    ];
    const issue = upload?.error || upload?.mediaJobWarning || "";
    const actions = upload?.jobId
      ? `<div class="media-detail-actions"><button class="small" type="button" data-media-job-action="log" data-job="${escapeHtml(upload.jobId)}">打开关联任务日志</button></div>`
      : "";
    return `
      <div class="media-detail-grid">${items.map(([label, value]) => detailItem(label, value)).join("")}</div>
      <div class="media-upload-timeline">${uploadTimeline(upload, jobs)}</div>
      ${issue ? `<div class="media-job-result status-risk">${escapeHtml(issue)}</div>` : ""}
      ${relatedJob ? `<h3>关联媒体任务</h3>${renderJobSummary(relatedJob)}` : ""}
      ${actions}
    `;
  }

  function ossDirectQueueStatusText(status) {
    const labels = {
      queued: "等待",
      ready: "可上传",
      authorizing: "授权",
      uploading: "上传中",
      verifying: "校验",
      done: "完成",
      warning: "提示",
      failed: "失败",
      cancelled: "已取消",
      skipped: "已跳过",
    };
    return labels[status] || status || "未知";
  }

  function ossDirectQueueSourceText(source) {
    if (source === "filename") return "文件名识别";
    if (source === "selected-course") return "当前课程";
    return "待确认";
  }

  function renderOssDirectQueueItem(item) {
    const percentValue = Math.max(0, Math.min(100, Number(item?.percent || 0)));
    const progressMeta = Number.isFinite(item?.loaded) && Number.isFinite(item?.total) && item.total > 0
      ? ` · ${formatBytes(item.loaded)} / ${formatBytes(item.total)}`
      : "";
    const course = item?.course || "未识别";
    const status = item?.status || "";
    const metrics = [
      item?.speedText ? `速度 ${item.speedText}` : "",
      item?.etaText ? `剩余约 ${item.etaText}` : "",
      item?.overallText ? `总进度 ${item.overallText}` : "",
    ].filter(Boolean);
    return `
      <div class="oss-direct-queue-item ${escapeHtml(status)}">
        <div>
          <div class="oss-direct-queue-heading">
            <span class="oss-direct-course">${escapeHtml(course)}</span>
            <strong title="${escapeHtml(item?.name || "")}">${escapeHtml(item?.name || "")}</strong>
          </div>
          <small>${escapeHtml(formatBytes(item?.size || 0))}${escapeHtml(progressMeta)} · ${escapeHtml(ossDirectQueueSourceText(item?.source))}</small>
          ${item?.detail ? `<small class="oss-direct-queue-detail" title="${escapeHtml(item.detail)}">${escapeHtml(item.detail)}</small>` : ""}
          ${metrics.length ? `<small class="oss-direct-queue-metrics">${metrics.map(escapeHtml).join(" · ")}</small>` : ""}
          <div class="oss-direct-queue-progress"><span style="width:${percentValue}%"></span></div>
        </div>
        <div class="oss-direct-queue-status">
          <strong>${escapeHtml(ossDirectQueueStatusText(status))}</strong>
          <small>${Math.round(percentValue)}%</small>
        </div>
      </div>
    `;
  }

  function renderOssDirectQueue(items = []) {
    const totalBytes = items.reduce((sum, item) => sum + Number(item?.size || 0), 0);
    const loadedBytes = items.reduce((sum, item) => {
      if (["done", "warning"].includes(item?.status)) return sum + Number(item?.size || 0);
      if (!["authorizing", "uploading", "verifying"].includes(item?.status)) return sum;
      return sum + Math.min(Number(item?.loaded || 0), Number(item?.total || item?.size || 0));
    }, 0);
    const totalPercent = totalBytes ? Math.max(0, Math.min(100, Math.round((loadedBytes / totalBytes) * 100))) : 0;
    const courses = [...new Set(items.map((item) => item?.course).filter(Boolean))];
    const failed = items.filter((item) => item?.status === "failed").length;
    const skipped = items.filter((item) => item?.status === "skipped").length;
    const uploading = items.filter((item) => ["authorizing", "uploading", "verifying"].includes(item?.status)).length;
    const done = items.filter((item) => ["done", "warning"].includes(item?.status)).length;
    const summary = `
      <div class="oss-direct-queue-summary">
        <span>${items.length} 个文件</span>
        <span>${courses.length} 门课程</span>
        <span>${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}</span>
        <span>总进度 ${totalPercent}%</span>
        ${uploading ? `<span>${uploading} 个处理中</span>` : ""}
        ${done ? `<span>${done} 个完成</span>` : ""}
        ${skipped ? `<span>${skipped} 个跳过</span>` : ""}
        ${failed ? `<span class="status-risk">${failed} 个失败</span>` : ""}
      </div>
      <div class="oss-direct-overall-progress" aria-label="OSS 直传总进度">
        <span style="width:${totalPercent}%"></span>
      </div>
    `;
    return `${summary}${items.map(renderOssDirectQueueItem).join("")}`;
  }

  function renderLockCard(lock) {
    const course = escapeHtml(lock?.course || "");
    const age = Number.isFinite(lock?.ageSeconds) ? formatDurationSeconds(lock.ageSeconds) : "-";
    const state = lock?.stale ? "疑似遗留锁" : lock?.pidAlive ? "任务锁定中" : "状态未知";
    const activeJob = lock?.activeJob
      ? `${lock.activeJob.course || lock.activeJob.scope || "all"} · ${jobTypeLabel(lock.activeJob.type)} · ${lock.activeJob.status}`
      : "";
    const action = lock?.canClear
      ? `<button class="small" type="button" data-media-lock-action="clear" data-course="${course}">清理遗留锁</button>`
      : `<span class="meta-line">${lock?.stale ? "需确认无任务后再清理" : "任务运行时不可清理"}</span>`;
    return `
      <article class="media-lock-card ${lock?.stale ? "issue" : ""}">
        <div>
          <header>
            <strong>${course}</strong>
            <span class="status-badge ${lock?.stale ? "status-warning" : "status-running"}">${escapeHtml(state)}</span>
            <span class="meta-line">${escapeHtml(lock?.operation || "course operation")}</span>
          </header>
          <div class="media-upload-card-meta">
            <span>PID ${escapeHtml(lock?.pid || "-")}</span>
            <span>年龄 ${escapeHtml(age)}</span>
            <span>开始 ${escapeHtml(shortDateTime(lock?.startedAt) || "-")}</span>
            ${activeJob ? `<span>关联任务 ${escapeHtml(activeJob)}</span>` : ""}
          </div>
        </div>
        <div class="media-job-card-actions">${action}</div>
      </article>
    `;
  }

  function renderLocksSection(lockData = {}) {
    const locks = Array.isArray(lockData?.locks) ? lockData.locks : [];
    const cards = locks.map(renderLockCard).join("");
    const clearableCount = Number(lockData?.clearableCount || 0);
    const clearAllAction = clearableCount
      ? `<button class="small" type="button" data-media-lock-action="clear-stale">清理全部遗留锁</button>`
      : "";
    return `
      <div class="media-section-title">
        <div>
          <h3>课程操作锁</h3>
          <span class="meta-line">${locks.length} 个锁 · ${lockData?.staleCount || 0} 个疑似遗留 · ${clearableCount} 个可清理</span>
        </div>
        ${clearAllAction}
      </div>
      <div class="media-lock-list">${cards || '<p class="meta-line">当前没有课程操作锁。</p>'}</div>
    `;
  }

  function uploadProgressFormatter(file) {
    const startedAt = Date.now();
    let lastAt = startedAt;
    let lastLoaded = 0;
    let smoothedBytesPerSecond = 0;
    return ({ percent, loaded, total, objectKey }) => {
      const now = Date.now();
      const elapsedMs = Math.max(1, now - lastAt);
      const deltaBytes = Math.max(0, loaded - lastLoaded);
      const instantBytesPerSecond = (deltaBytes / elapsedMs) * 1000;
      if (instantBytesPerSecond > 0) {
        smoothedBytesPerSecond = smoothedBytesPerSecond
          ? smoothedBytesPerSecond * 0.7 + instantBytesPerSecond * 0.3
          : instantBytesPerSecond;
      }
      lastAt = now;
      lastLoaded = loaded;
      const averageBytesPerSecond = loaded > 0 ? loaded / Math.max(1, (now - startedAt) / 1000) : 0;
      const bytesPerSecond = smoothedBytesPerSecond || averageBytesPerSecond;
      const remainingBytes = Math.max(0, total - loaded);
      const eta = bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : 0;
      const speedText = bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : "计算中";
      const totalText = total || file?.size || 0;
      const etaText = formatDurationSeconds(eta);
      const loadedText = `${formatBytes(loaded)} / ${formatBytes(totalText)}`;
      return {
        detail: `${percent}% · ${loadedText} · 速度 ${speedText} · 剩余约 ${etaText} · ${objectKey}`,
        etaSeconds: eta,
        etaText,
        loaded,
        loadedText,
        objectKey,
        percent,
        speedText,
        total: totalText,
      };
    };
  }

  window.AdminMediaView = {
    activeWriteJob,
    coursePublishState,
    detailItem,
    escapeHtml,
    formatBytes,
    hasActiveJobs,
    hasActiveUploads,
    jobCardClass,
    jobDetail,
    jobDuration,
    jobMetricValues,
    jobNextStep,
    jobResult,
    jobSuggestedAction,
    jobSummarySource,
    jobTypeLabel,
    mediaConfigRows,
    mediaOssRows,
    renderJobCard,
    renderJobMetrics,
    renderJobProgress,
    renderJobResolution,
    renderJobSummary,
    renderJobLogDetail,
    renderJobsSection,
    renderLockCard,
    renderLocksSection,
    percent,
    renderCourseRow,
    renderCourseState,
    renderCoursesSection,
    renderMediaConfigStats,
    renderMediaOssStats,
    renderOssDirectQueue,
    renderOssDirectQueueItem,
    renderStatGrid,
    renderUploadCard,
    renderUploadDetail,
    renderUploadsSection,
    shortDateTime,
    statItem,
    statusLabel,
    ossDirectQueueStatusText,
    uploadKindLabel,
    uploadProgressFormatter,
    uploadTimeline,
    uploadStatusLabel,
  };
})();
