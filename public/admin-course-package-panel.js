(function () {
  function createPanel({
    elements = {},
    escapeHtml = window.AdminMediaView.escapeHtml,
    formatBytes = window.AdminMediaView.formatBytes,
    getSelectedCourse,
    storage = window.localStorage,
  } = {}) {
    let currentImport = null;

    function selectedCourse() {
      return String(typeof getSelectedCourse === "function" ? getSelectedCourse() : "").trim().toUpperCase();
    }

    function reviewCourse(data) {
      return String(data?.course || data?.packageCourse || data?.review?.course || data?.review?.packageCourse || "").trim().toUpperCase();
    }

    function taskKey(course = selectedCourse()) {
      return `ossd-course-package-task:${String(course || "").toUpperCase()}`;
    }

    function createTaskId() {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const random = window.crypto?.randomUUID ? window.crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10);
      return `${stamp}-${random}`;
    }

    function rememberTask(task) {
      if (!task?.course || !task?.importId) return;
      storage?.setItem?.(
        taskKey(task.course),
        JSON.stringify({
          course: task.course,
          importId: task.importId,
          filename: task.filename || "",
          totalBytes: task.totalBytes || 0,
          chunkTotal: task.chunkTotal || 0,
          chunksReceived: task.chunksReceived || 0,
          status: task.status || "",
          updatedAt: task.updatedAt || new Date().toISOString(),
        }),
      );
    }

    function readRememberedTask(course = selectedCourse()) {
      try {
        return JSON.parse(storage?.getItem?.(taskKey(course)) || "null");
      } catch {
        return null;
      }
    }

    function setStatus({ title, detail = "", percent = null, showProgress = false, error = false }) {
      if (!elements.status) return;
      elements.status.hidden = false;
      if (elements.statusTitle) {
        elements.statusTitle.textContent = title;
        elements.statusTitle.className = error ? "error" : "";
      }
      if (elements.statusDetail) elements.statusDetail.textContent = detail;
      if (elements.progress) elements.progress.hidden = !showProgress;
      if (elements.progressBar) {
        elements.progressBar.style.width = percent === null
          ? "0%"
          : `${Math.max(0, Math.min(100, percent))}%`;
      }
    }

    function commitState(data = currentImport) {
      const selected = selectedCourse();
      const previewCourse = reviewCourse(data);
      const hasReady = Boolean(data?.summary?.ready > 0);
      const courseMatches = Boolean(data) && (!previewCourse || previewCourse === selected);
      const canCommit = Boolean(data) && hasReady && courseMatches;
      if (elements.commitButton) {
        elements.commitButton.disabled = !canCommit;
        elements.commitButton.textContent = selected ? `确认导入到 ${selected}` : "确认导入到当前课程";
        elements.commitButton.title = !data
          ? "请先上传整课 ZIP 并生成预览"
          : !hasReady
            ? "预览里没有可导入的资源"
            : !courseMatches
              ? `这次预览属于 ${previewCourse}，当前课程是 ${selected}`
              : `确认导入到 ${selected}`;
      }
      return { selected, previewCourse, hasReady, courseMatches, canCommit };
    }

    function setCurrentImport(data) {
      currentImport = data || null;
      commitState(currentImport);
      return currentImport;
    }

    function getCurrentImport() {
      return currentImport;
    }

    function hidePreview() {
      if (elements.panel) elements.panel.hidden = true;
    }

    function renderPreview(data) {
      currentImport = data?.ok ? data : null;
      const state = commitState(currentImport);
      const rows = (data?.operations || [])
        .slice(0, 200)
        .map((item) => {
          const statusClass = item.status === "ready" ? "status-ok" : item.status === "needs-review" ? "status-missing" : "meta-line";
          return `
              <tr>
                <td class="nowrap"><strong>${escapeHtml(item.kind || "")}</strong></td>
                <td class="${statusClass}">${escapeHtml(item.status || "")}</td>
                <td>${escapeHtml(item.lessonId || (item.unit ? `U${item.unit}${item.lesson ? `L${item.lesson}` : ""}` : ""))}</td>
                <td>${escapeHtml(item.sourcePath || "")}</td>
                <td>${escapeHtml(item.targetPath || item.reason || "")}</td>
              </tr>
            `;
        })
        .join("");
      const mismatchNotice = currentImport && !state.courseMatches
        ? `<p class="error">这次预览属于 ${escapeHtml(state.previewCourse || "未知课程")}，当前课程是 ${escapeHtml(state.selected || "未选择")}。请先切回正确课程，或重新上传当前课程的课包。</p>`
        : "";
      if (!elements.panel) return currentImport;
      elements.panel.innerHTML = `
          <div class="stats">
            <div class="stat"><span>Ready</span><strong>${data?.summary?.ready || 0}</strong></div>
            <div class="stat"><span>Need Review</span><strong>${data?.summary?.needsReview || 0}</strong></div>
            <div class="stat"><span>Skipped</span><strong>${data?.summary?.skipped || 0}</strong></div>
            <div class="stat"><span>iSpring</span><strong>${data?.summary?.ispring || 0}</strong></div>
            <div class="stat"><span>Book Sections</span><strong>${data?.summary?.bookSections || 0}</strong></div>
            <div class="stat"><span>Resources</span><strong>${data?.summary?.resources || 0}</strong></div>
          </div>
          <p class="meta-line">Import ID: ${escapeHtml(data?.importId || "")} · Package Course: ${escapeHtml(state.previewCourse || data?.course || "")} · Current Course: ${escapeHtml(state.selected || "")}</p>
          ${mismatchNotice}
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Lesson</th>
                  <th>Source</th>
                  <th>Target / Reason</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="5">No files found in this package.</td></tr>'}</tbody>
            </table>
          </div>
        `;
      elements.panel.hidden = false;
      return currentImport;
    }

    function renderTaskStatus(task) {
      if (!task) return;
      rememberTask(task);
      const total = task.totalBytes || 0;
      const loaded = task.bytesReceived || 0;
      const tempText = task.packageBytes ? ` 临时目录 ${formatBytes(task.packageBytes)}。` : "";
      if (task.status === "uploading") {
        const chunkText = task.chunkTotal ? ` 分片 ${task.chunksReceived || 0}/${task.chunkTotal}。` : "";
        setStatus({
          title: `正在上传 ${task.filename || "整课 ZIP"}`,
          detail: total
            ? `服务器已收到 ${formatBytes(loaded)} / ${formatBytes(total)} (${task.percent || 0}%)。${chunkText}${tempText}刷新页面会中断浏览器正在发送的上传。`
            : `服务器已收到 ${formatBytes(loaded)}。${chunkText}${tempText}刷新页面会中断浏览器正在发送的上传。`,
          percent: task.percent || 0,
          showProgress: true,
        });
        return;
      }
      if (task.status === "processing") {
        const phase = task.phase === "merging" ? "合并分片" : task.phase === "extracting" ? "解压和扫描" : "处理";
        const mergeText = task.mergeIndex && task.chunkTotal ? ` 合并 ${task.mergeIndex}/${task.chunkTotal}。` : "";
        const chunkText = task.chunkTotal ? ` 分片 ${task.chunksReceived || task.chunkTotal}/${task.chunkTotal}。` : "";
        setStatus({
          title: `服务器正在处理 ${task.filename || "整课 ZIP"}`,
          detail: `上传已到服务器，正在${phase}。${mergeText || chunkText}${tempText}大课包可能需要几分钟，请保持服务运行。`,
          percent: 100,
          showProgress: true,
        });
        return;
      }
      if (task.status === "complete") {
        setStatus({
          title: "最近一次上传已生成预览",
          detail: `已扫描 ${task.summary?.total || task.review?.operations?.length || 0} 个导入项。确认无误后点击“确认导入到当前课程”。`,
          percent: 100,
          showProgress: true,
        });
        if (task.review) {
          renderPreview(task.review);
        } else {
          currentImport = null;
          commitState(null);
          hidePreview();
          setStatus({
            title: "最近一次上传预览记录不完整",
            detail: "服务器有上传完成记录，但没有找到可恢复的预览详情。请点击“读取状态”或重新上传生成预览。",
            percent: 100,
            showProgress: true,
          });
        }
        return;
      }
      if (task.status === "failed") {
        setStatus({
          title: "最近一次上传未完成",
          detail: task.error || "上传连接已中断或服务器处理失败，请重新选择文件上传。",
          error: true,
        });
      }
    }

    function reusableImportId(file) {
      const remembered = readRememberedTask();
      if (
        remembered?.importId &&
        remembered.filename === file.name &&
        Number(remembered.totalBytes || 0) === file.size &&
        remembered.status !== "complete"
      ) {
        return remembered.importId;
      }
      return createTaskId();
    }

    return {
      commitState,
      createTaskId,
      getCurrentImport,
      hidePreview,
      readRememberedTask,
      rememberTask,
      renderPreview,
      renderTaskStatus,
      reusableImportId,
      reviewCourse,
      setCurrentImport,
      setStatus,
      taskKey,
    };
  }

  window.AdminCoursePackagePanel = {
    createPanel,
  };
})();
