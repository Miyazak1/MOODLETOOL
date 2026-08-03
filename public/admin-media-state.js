(function () {
  function normalizeCourseCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function selectedCourseStatus(data = {}, selectedCourse = "") {
    const courseCode = normalizeCourseCode(selectedCourse);
    return (data.courses || []).find((course) => course.code === courseCode) || null;
  }

  function activeWriteJob(data = {}) {
    return window.AdminMediaView.activeWriteJob(data.jobs || []);
  }

  function mediaActionState(data = {}, selectedCourse = "", { jobTypeLabel = window.AdminMediaView.jobTypeLabel } = {}) {
    const config = data.config || {};
    const enabled = Boolean(config.enabled);
    const courseCode = normalizeCourseCode(selectedCourse);
    const hasCourse = Boolean(courseCode);
    const writeJob = activeWriteJob(data);
    const selectedStatus = selectedCourseStatus(data, courseCode);
    const selectedCourseKnown = Boolean(selectedStatus);
    const selectedHasPublishableAssets = !selectedCourseKnown || Number(selectedStatus?.fileCount || 0) > 0;
    const publishableReason = selectedCourseKnown && !selectedHasPublishableAssets
      ? `当前课程 ${courseCode} 没有可发布媒体。`
      : "";
    const activeReason = writeJob
      ? `已有写任务运行中：${writeJob.course || writeJob.scope || "all"} · ${jobTypeLabel(writeJob.type)} · ${writeJob.status}`
      : "";
    const disabledReason = enabled ? activeReason || publishableReason : "媒体任务中心未启用。";
    const selectCourseReason = enabled ? "请选择课程。" : disabledReason;

    let notice = null;
    if (!enabled) {
      notice = {
        hidden: false,
        html: "媒体任务中心当前未启用。现有命令行迁移完成后，在生产环境设置 <strong>MEDIA_JOBS_ENABLED=1</strong> 再允许后台创建任务。",
        tone: "warning",
      };
    } else if (writeJob) {
      notice = {
        hidden: false,
        html: `媒体写任务正在运行：<strong>${window.AdminMediaView.escapeHtml(writeJob.course || writeJob.scope || "all")}</strong> · ${window.AdminMediaView.escapeHtml(jobTypeLabel(writeJob.type))}。发布、同步和全量发布会暂时锁定，任务完成后自动恢复。`,
        tone: "info",
      };
    } else if (selectedStatus?.activeJob) {
      notice = {
        hidden: false,
        html: `当前课程已有任务运行：<strong>${window.AdminMediaView.escapeHtml(courseCode)}</strong> · ${window.AdminMediaView.escapeHtml(selectedStatus.activeJob.progress?.message || jobTypeLabel(selectedStatus.activeJob.type))}`,
        tone: "info",
      };
    } else {
      notice = { hidden: true, html: "", tone: "info" };
    }

    return {
      activeWriteJob: writeJob,
      buttons: {
        auditCurrentCourse: { enabled: enabled && hasCourse, reason: selectCourseReason },
        publishAllMedia: { enabled: enabled && !writeJob, reason: disabledReason || "已有写任务运行中。" },
        publishCurrentCourse: { enabled: enabled && hasCourse && !writeJob && selectedHasPublishableAssets, reason: disabledReason || "请选择课程。" },
        readinessMedia: { enabled, reason: disabledReason },
        syncCurrentCourse: { enabled: enabled && hasCourse && !writeJob && selectedHasPublishableAssets, reason: disabledReason || "请选择课程。" },
      },
      configEnabled: enabled,
      disabledReason,
      hasCourse,
      notice,
      selectedCourse: courseCode,
      selectedCourseStatus: selectedStatus,
    };
  }

  function filterMediaCourses(courses = [], { filter = "all", query = "", selectedCourse = "" } = {}) {
    const selected = normalizeCourseCode(selectedCourse);
    const search = String(query || "").trim().toLowerCase();
    return courses.filter((course) => {
      const state = course.publishState || "";
      if (filter === "current" && course.code !== selected) return false;
      if (filter === "active" && state !== "publishing") return false;
      if (filter === "unpublished" && !["unpublished", "partial"].includes(state)) return false;
      if (filter === "published" && state !== "published") return false;
      if (filter === "has-media" && !(course.fileCount > 0)) return false;
      if (!search) return true;
      return `${course.code} ${course.title || ""} ${state}`.toLowerCase().includes(search);
    });
  }

  function filterMediaJobs(jobs = [], { filter = "all", selectedCourse = "" } = {}) {
    const selected = normalizeCourseCode(selectedCourse);
    return jobs.filter((job) => {
      if (filter === "active") return ["queued", "running", "cancelling"].includes(job.status);
      if (filter === "attention") return ["failed", "warning", "cancelled", "interrupted"].includes(job.status);
      if (filter === "current") return selected && job.course === selected;
      return true;
    });
  }

  window.AdminMediaState = {
    activeWriteJob,
    filterMediaCourses,
    filterMediaJobs,
    mediaActionState,
    normalizeCourseCode,
    selectedCourseStatus,
  };
})();
