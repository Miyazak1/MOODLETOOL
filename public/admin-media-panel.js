(function () {
  function setButtonAvailability(button, enabled, reason = "") {
    if (!button) return;
    button.disabled = !enabled;
    button.title = enabled ? "" : reason;
  }

  function createPanel({
    elements = {},
    getSelectedCourse,
    jobTypeLabel = window.AdminMediaView.jobTypeLabel,
    renderOssDirectUploadConfig,
  } = {}) {
    let data = { courses: [], jobs: [], uploads: [], config: {} };
    let lastUpdatedAt = null;
    let lastChangeText = "";
    let renderedOnce = false;

    function selectedCourse() {
      return String(typeof getSelectedCourse === "function" ? getSelectedCourse() || "" : "").trim().toUpperCase();
    }

    function hasActiveJobs(jobs = data.jobs || []) {
      return window.AdminMediaView.hasActiveJobs(jobs);
    }

    function hasActiveUploads(uploads = data.uploads || []) {
      return window.AdminMediaView.hasActiveUploads(uploads);
    }

    function hasActive() {
      return hasActiveJobs() || hasActiveUploads();
    }

    function activeWriteJob(jobs = data.jobs || []) {
      return window.AdminMediaView.activeWriteJob(jobs);
    }

    function activeJobCount(jobs = []) {
      return jobs.filter((job) => ["queued", "running", "cancelling"].includes(job.status)).length;
    }

    function attentionJobCount(jobs = []) {
      return jobs.filter((job) => ["failed", "warning", "cancelled", "interrupted"].includes(job.status)).length;
    }

    function activeUploadCount(uploads = []) {
      return uploads.filter((upload) =>
        ["created", "importing", "queued"].includes(upload.status)
        || ["queued", "running", "processing"].includes(upload.importStatus)
      ).length;
    }

    function snapshot(nextData = data) {
      const jobs = nextData.jobs || [];
      const uploads = nextData.uploads || [];
      const courses = nextData.courses || [];
      return {
        activeJobs: activeJobCount(jobs),
        attentionJobs: attentionJobCount(jobs),
        coursesPublishing: courses.filter((course) => course.publishState === "publishing").length,
        publishedAssets: Number(nextData.summary?.published || 0),
        registryAssets: Number(nextData.registry?.assetCount || 0),
        ossObjects: Number(nextData.oss?.objectCount || 0),
        ossBytes: Number(nextData.oss?.totalBytes || 0),
        uploads: uploads.length,
        activeUploads: activeUploadCount(uploads),
      };
    }

    function deltaText(label, before, after) {
      const diff = Number(after || 0) - Number(before || 0);
      if (!diff) return "";
      return `${label} ${diff > 0 ? "+" : ""}${diff}`;
    }

    function summarizeChange(previous, current) {
      if (!renderedOnce) return "状态已同步";
      const before = snapshot(previous);
      const after = snapshot(current);
      const changes = [
        deltaText("运行任务", before.activeJobs, after.activeJobs),
        deltaText("需关注", before.attentionJobs, after.attentionJobs),
        deltaText("发布中课程", before.coursesPublishing, after.coursesPublishing),
        deltaText("已发布资源", before.publishedAssets, after.publishedAssets),
        deltaText("Registry", before.registryAssets, after.registryAssets),
        deltaText("OSS对象", before.ossObjects, after.ossObjects),
        deltaText("直传记录", before.uploads, after.uploads),
        deltaText("直传处理中", before.activeUploads, after.activeUploads),
      ].filter(Boolean);
      if (changes.length) return changes.slice(0, 4).join(" · ");
      return "本次无变化";
    }

    function renderOss(oss) {
      const target = elements.ossStats;
      if (!target) return;
      if (!oss) {
        target.hidden = true;
        target.innerHTML = "";
        return;
      }
      target.innerHTML = window.AdminMediaView.renderMediaOssStats(oss);
      target.hidden = false;
    }

    function renderLocks(lockData) {
      const target = elements.locksPanel;
      if (!target) return;
      const locks = Array.isArray(lockData?.locks) ? lockData.locks : [];
      if (!locks.length) {
        target.hidden = true;
        target.innerHTML = "";
        return;
      }
      target.innerHTML = window.AdminMediaView.renderLocksSection(lockData);
      target.hidden = false;
    }

    function updateActionControls(nextData = data) {
      const state = window.AdminMediaState.mediaActionState(nextData, selectedCourse(), { jobTypeLabel });
      setButtonAvailability(elements.publishCurrentCourseButton, state.buttons.publishCurrentCourse.enabled, state.buttons.publishCurrentCourse.reason);
      setButtonAvailability(elements.syncCurrentCourseButton, state.buttons.syncCurrentCourse.enabled, state.buttons.syncCurrentCourse.reason);
      setButtonAvailability(elements.publishAllMediaButton, state.buttons.publishAllMedia.enabled, state.buttons.publishAllMedia.reason);
      setButtonAvailability(elements.auditCurrentCourseButton, state.buttons.auditCurrentCourse.enabled, state.buttons.auditCurrentCourse.reason);
      setButtonAvailability(elements.readinessMediaButton, state.buttons.readinessMedia.enabled, state.buttons.readinessMedia.reason);
      if (elements.notice && state.notice) {
        elements.notice.hidden = state.notice.hidden;
        elements.notice.innerHTML = state.notice.html;
      }
      return state;
    }

    function renderConfig(nextData = data) {
      data = { ...data, ...nextData };
      const config = data.config || {};
      if (elements.configStats) {
        elements.configStats.innerHTML = window.AdminMediaView.renderMediaConfigStats(data);
        elements.configStats.hidden = false;
      }
      if (elements.notice) {
        elements.notice.hidden = Boolean(config.enabled);
        if (!config.enabled) {
          elements.notice.innerHTML = "媒体任务中心当前未启用。现有命令行迁移完成后，在生产环境设置 <strong>MEDIA_JOBS_ENABLED=1</strong> 再允许后台创建任务。";
        }
      }
      if (typeof renderOssDirectUploadConfig === "function") renderOssDirectUploadConfig(config);
      renderOss(data.oss);
      renderLocks(data.locks);
    }

    function filteredCourses(courses = data.courses || []) {
      return window.AdminMediaState.filterMediaCourses(courses, {
        filter: elements.courseFilter?.value || "all",
        query: elements.courseSearch?.value || "",
        selectedCourse: selectedCourse(),
      });
    }

    function renderCourses(nextData = data) {
      data = { ...data, ...nextData };
      const allCourses = data.courses || [];
      const visibleCourses = filteredCourses(allCourses);
      if (!elements.courseTable) return;
      elements.courseTable.innerHTML = window.AdminMediaView.renderCoursesSection({
        courses: visibleCourses,
        allCourses,
        assetScope: data.config?.assetScope || "playable",
        activeWriteJob: activeWriteJob(data.jobs || []),
        selectedCourse: selectedCourse(),
      });
      elements.courseTable.hidden = false;
    }

    function filteredJobs(jobs = data.jobs || []) {
      return window.AdminMediaState.filterMediaJobs(jobs, {
        filter: elements.jobFilter?.value || "all",
        selectedCourse: selectedCourse(),
      });
    }

    function renderJobs(nextData = data) {
      data = { ...data, ...nextData };
      const allJobs = data.jobs || [];
      const jobs = filteredJobs(allJobs);
      if (!elements.jobsTable) return;
      elements.jobsTable.innerHTML = window.AdminMediaView.renderJobsSection({ jobs, allJobs });
      elements.jobsTable.hidden = false;
    }

    function renderUploads(nextData = data) {
      data = { ...data, ...nextData };
      if (!elements.uploadsTable) return;
      elements.uploadsTable.innerHTML = window.AdminMediaView.renderUploadsSection({
        uploads: data.uploads || [],
        jobs: data.jobs || [],
      });
      elements.uploadsTable.hidden = false;
    }

    function updateRefreshState({ updatedAt = lastUpdatedAt, refreshing = false, nextDelayMs = null } = {}) {
      lastUpdatedAt = updatedAt || lastUpdatedAt;
      if (!elements.refreshState) return;
      const time = lastUpdatedAt
        ? lastUpdatedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : "尚未刷新";
      if (refreshing) {
        elements.refreshState.textContent = `正在刷新媒体状态... · 上次 ${time}`;
        return;
      }
      const cadence = hasActive() ? "任务运行中，每 5 秒自动刷新" : "每 15 秒自动刷新";
      const next = Number.isFinite(nextDelayMs) ? ` · 下次约 ${Math.max(1, Math.round(nextDelayMs / 1000))} 秒后` : "";
      const change = lastChangeText ? ` · ${lastChangeText}` : "";
      elements.refreshState.textContent = `${cadence}${next} · 上次 ${time}${change}`;
    }

    function render(nextData = {}) {
      const previous = data;
      data = { ...data, ...nextData };
      lastChangeText = summarizeChange(previous, data);
      renderedOnce = true;
      renderConfig(data);
      renderCourses(data);
      renderJobs(data);
      renderUploads(data);
      updateActionControls(data);
      updateRefreshState();
    }

    function renderQuiet(nextData = {}) {
      const previous = data;
      data = { ...data, ...nextData };
      lastChangeText = summarizeChange(previous, data);
      renderedOnce = true;
      renderConfig(data);
      updateActionControls(data);
      updateRefreshState();
    }

    function setData(nextData = {}) {
      data = { ...data, ...nextData };
      return data;
    }

    return {
      activeWriteJob,
      filteredCourses,
      filteredJobs,
      getData: () => data,
      hasActive,
      hasActiveJobs,
      hasActiveUploads,
      render,
      renderConfig,
      renderCourses,
      renderJobs,
      renderLocks,
      renderOss,
      renderQuiet,
      renderUploads,
      setData,
      updateActionControls,
      updateRefreshState,
    };
  }

  window.AdminMediaPanel = {
    createPanel,
    setButtonAvailability,
  };
})();
