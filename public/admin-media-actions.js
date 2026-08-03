(function () {
  function createController({
    api,
    confirm: confirmDialog = window.confirm.bind(window),
    getData,
    getSelectedCourse,
    jobTypeLabel = window.AdminMediaView.jobTypeLabel,
    refresh,
    renderDetail,
    startAutoRefresh,
    write,
  } = {}) {
    if (!api) throw new Error("AdminMediaActions requires an api client.");

    function currentData() {
      return typeof getData === "function" ? getData() || {} : {};
    }

    function selectedCourse(courseOverride = "") {
      return String(courseOverride || (typeof getSelectedCourse === "function" ? getSelectedCourse() || "" : "")).trim().toUpperCase();
    }

    function jobById(jobId) {
      return (currentData().jobs || []).find((job) => job.id === jobId) || null;
    }

    function uploadById(uploadId) {
      return (currentData().uploads || []).find((upload) => upload.id === uploadId) || null;
    }

    async function refreshMedia() {
      if (typeof refresh === "function") await refresh({ writeOutput: false });
    }

    function writeOutput(data) {
      if (typeof write === "function") write(data);
    }

    async function createJob(payload) {
      const data = await api.createJob(payload);
      writeOutput(data);
      await refreshMedia();
      if (typeof startAutoRefresh === "function") startAutoRefresh();
      return data;
    }

    function ensureWriteJobCanStart(label, courseOverride = "") {
      const state = window.AdminMediaState.mediaActionState(currentData(), selectedCourse(courseOverride), { jobTypeLabel });
      if (!state.configEnabled) throw new Error("媒体任务中心未启用，不能在后台创建媒体任务。");
      const activeWriteJob = state.activeWriteJob;
      if (activeWriteJob) {
        throw new Error(`已有写任务运行中：${activeWriteJob.course || activeWriteJob.scope || "all"} · ${jobTypeLabel(activeWriteJob.type)}。请等它完成后再${label}。`);
      }
    }

    async function publishCurrentCourse(courseOverride = "") {
      const course = selectedCourse(courseOverride);
      ensureWriteJobCanStart("发布课程", course);
      if (!confirmDialog(`确认发布 ${course} 到 OSS/CDN？\n\n系统会审计视频、压缩候选视频、上传该课程可播放资源，并更新 registry。`)) {
        return { canceled: true, message: "已取消发布当前课程。" };
      }
      return createJob({ type: "publish-course", course });
    }

    async function auditCurrentCourse(courseOverride = "") {
      return createJob({ type: "audit-videos", course: selectedCourse(courseOverride) });
    }

    async function syncCurrentCourse(courseOverride = "") {
      const course = selectedCourse(courseOverride);
      ensureWriteJobCanStart("上传课程", course);
      if (!confirmDialog(`确认只上传 ${course} 到 OSS/CDN？\n\n这不会重新压缩视频，只同步当前课程的可播放资源并更新 registry。`)) {
        return { canceled: true, message: "已取消上传当前课程。" };
      }
      return createJob({ type: "sync-oss", course });
    }

    async function publishAllMedia() {
      ensureWriteJobCanStart("发布全部可播放资源");
      const summary = currentData().summary || {};
      const skippedText = Number.isFinite(summary.skippedFiles)
        ? `\n已跳过非播放文件：${summary.skippedFiles || 0}`
        : "";
      if (!confirmDialog(`确认发布所有课程的可播放资源？\n\n可发布资源：${summary.files || 0}\n未发布：${summary.unpublished || 0}${skippedText}\n\n范围只包含视频、H5P 和 iSpring 包。系统会压缩候选视频并上传到 OSS/CDN，可能运行很久。`)) {
        return { canceled: true, message: "已取消全量发布。" };
      }
      return createJob({ type: "publish-all" });
    }

    async function checkReadiness() {
      return createJob({ type: "check-readiness" });
    }

    function showUploadDetail(uploadId) {
      const upload = uploadById(uploadId);
      if (!upload) throw new Error("找不到这条 OSS 直传记录，请刷新媒体状态后再试。");
      const relatedJob = upload.jobId ? jobById(upload.jobId) : null;
      renderDetail(
        `OSS 直传详情：${upload.course || upload.fileName || upload.id}`,
        window.AdminMediaView.renderUploadDetail(upload, { relatedJob, jobs: currentData().jobs || [] }),
      );
    }

    async function showJobLog(jobId) {
      const [stdoutResult, stderrResult] = await Promise.allSettled([
        api.jobLog(jobId, { stream: "stdout", tail: 240 }),
        api.jobLog(jobId, { stream: "stderr", tail: 240 }),
      ]);
      if (stdoutResult.status === "rejected") throw stdoutResult.reason;
      const stdoutData = stdoutResult.value || {};
      const stderrData = stderrResult.status === "fulfilled"
        ? stderrResult.value || {}
        : { text: `stderr 读取失败：${stderrResult.reason?.message || stderrResult.reason}` };
      const job = jobById(jobId);
      renderDetail(
        `媒体任务详情：${job?.course || job?.scope || jobId}`,
        window.AdminMediaView.renderJobLogDetail(job, {
          stdout: stdoutData.text || "",
          stderr: stderrData.text || "",
        }),
      );
      const data = { ok: true, jobId, stdout: stdoutData.text || "", stderr: stderrData.text || "" };
      writeOutput(data);
      return data;
    }

    async function cancelJob(jobId) {
      if (!confirmDialog(`确认取消媒体任务 ${jobId}？已经上传到 OSS 的对象不会自动删除。`)) {
        return { canceled: true, message: "已取消操作。" };
      }
      const data = await api.cancelJob(jobId);
      await refreshMedia();
      writeOutput(data);
      return data;
    }

    async function retryJob(jobId) {
      if (!confirmDialog(`确认重试媒体任务 ${jobId}？`)) {
        return { canceled: true, message: "已取消重试。" };
      }
      const data = await api.retryJob(jobId);
      await refreshMedia();
      writeOutput(data);
      return data;
    }

    async function clearLock(course) {
      const safeCourse = String(course || "").trim().toUpperCase();
      if (!safeCourse) throw new Error("缺少课程码。");
      if (!confirmDialog(`确认清理 ${safeCourse} 的遗留课程锁？只有在没有后台发布任务运行时才应该清理。`)) {
        return { canceled: true, message: "已取消清理。" };
      }
      const data = await api.clearLock(safeCourse);
      await refreshMedia();
      writeOutput(data);
      return data;
    }

    async function clearStaleLocks() {
      const data = currentData();
      const count = Number(data?.locks?.clearableCount || 0);
      if (!count) throw new Error("当前没有可清理的遗留课程锁。");
      if (!confirmDialog(`确认批量清理 ${count} 个遗留课程锁？正在运行或状态未知的锁会自动跳过。`)) {
        return { canceled: true, message: "已取消批量清理。" };
      }
      const result = await api.clearStaleLocks();
      await refreshMedia();
      writeOutput(result);
      return result;
    }

    function handleJobAction(button, runButtonAction) {
      const jobId = button.dataset.job;
      const action = button.dataset.mediaJobAction;
      if (action === "log") {
        runButtonAction(button, "正在读取媒体任务日志...", () => showJobLog(jobId), "任务日志已读取");
      } else if (action === "cancel") {
        runButtonAction(button, "正在取消媒体任务...", () => cancelJob(jobId), "媒体任务已取消");
      } else if (action === "retry") {
        runButtonAction(button, "正在重试媒体任务...", () => retryJob(jobId), "媒体任务已重新排队");
      } else if (action === "clear-lock") {
        runButtonAction(button, "正在清理课程锁...", () => clearLock(button.dataset.course), "课程锁已清理");
      }
    }

    return {
      auditCurrentCourse,
      cancelJob,
      checkReadiness,
      clearLock,
      clearStaleLocks,
      createJob,
      ensureWriteJobCanStart,
      handleJobAction,
      jobById,
      publishAllMedia,
      publishCurrentCourse,
      retryJob,
      showJobLog,
      showUploadDetail,
      syncCurrentCourse,
      uploadById,
    };
  }

  window.AdminMediaActions = {
    createController,
  };
})();
