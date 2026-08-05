(function () {
  function createPanel({
    elements = {},
    formatBytes = window.AdminMediaView.formatBytes,
    getController,
  } = {}) {
    let configReady = false;
    let previewOk = true;
    let latestPreview = null;

    function controller() {
      return typeof getController === "function" ? getController() : null;
    }

    function setStatus(title, detail = "", percent = null, type = "info") {
      if (!elements.status) return;
      elements.status.hidden = false;
      elements.status.classList?.toggle?.("error", type === "error");
      elements.status.classList?.toggle?.("warn", type === "warn");
      if (elements.statusTitle) {
        elements.statusTitle.textContent = title;
        elements.statusTitle.className = type === "error" ? "error" : type === "warn" ? "warn" : "";
      }
      if (elements.statusDetail) elements.statusDetail.textContent = detail;
      if (Number.isFinite(percent)) {
        if (elements.progress) elements.progress.hidden = false;
        if (elements.progressBar) elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      } else {
        if (elements.progress) elements.progress.hidden = true;
        if (elements.progressBar) elements.progressBar.style.width = "0%";
      }
    }

    function renderQueue(items = []) {
      if (!elements.queue) return;
      if (!items.length) {
        elements.queue.hidden = true;
        elements.queue.innerHTML = "";
        return;
      }
      elements.queue.innerHTML = window.AdminMediaView.renderOssDirectQueue(items);
      elements.queue.hidden = false;
    }

    if (elements.queue) {
      elements.queue.addEventListener("click", (event) => {
        const button = event.target?.closest?.("[data-oss-direct-action='cancel-item']");
        if (!button) return;
        const id = button.getAttribute("data-oss-direct-id") || "";
        const activeController = controller();
        if (!activeController?.cancelQueueItem?.(id)) return;
        setStatus("已取消队列文件", "这个文件已从本次 OSS 直传队列中取消，其他文件会继续。", null, "warn");
      });
    }

    function previewCourseText(preview = {}) {
      const courses = Array.isArray(preview.courses) ? preview.courses : [];
      if (!courses.length) return "未识别课程";
      return courses.length <= 4 ? courses.join("、") : `${courses.slice(0, 4).join("、")} 等 ${courses.length} 门`;
    }

    function previewErrorText(preview = {}) {
      const errors = Array.isArray(preview.errors) ? preview.errors.filter(Boolean) : [];
      if (!errors.length) return "请检查文件名和上传类型。";
      const visible = errors.slice(0, 4);
      const suffix = errors.length > visible.length ? `；另有 ${errors.length - visible.length} 个问题` : "";
      return `${visible.join("；")}${suffix}`;
    }

    function previewWarningText(preview = {}) {
      const warnings = Array.isArray(preview.warnings) ? preview.warnings.filter(Boolean) : [];
      if (!warnings.length) return "";
      const visible = warnings.slice(0, 3);
      const suffix = warnings.length > visible.length ? `；另有 ${warnings.length - visible.length} 个提示` : "";
      return `${visible.join("；")}${suffix}`;
    }

    function uploadButtonText(preview = latestPreview) {
      if (!preview?.files) return "直传媒体到 OSS";
      if (!preview.ok) return "修正后再上传";
      if (preview.files === 1) return "直传到 OSS";
      return `直传 ${preview.files} 个文件到 OSS`;
    }

    function updateUploadButton(reason = "") {
      if (!elements.uploadButton) return;
      const enabled = configReady && previewOk;
      elements.uploadButton.disabled = !enabled;
      elements.uploadButton.title = enabled ? "" : reason || "OSS 直传当前不可用。";
      elements.uploadButton.textContent = uploadButtonText();
    }

    function refreshPreview() {
      const activeController = controller();
      if (!activeController || !elements.fileInput) return;
      const files = Array.from(elements.fileInput.files || []);
      if (!files.length) {
        renderQueue([]);
        latestPreview = null;
        previewOk = true;
        updateUploadButton();
        if (!elements.status?.hidden && /预检/.test(elements.statusTitle?.textContent || "")) {
          elements.status.hidden = true;
        }
        return;
      }

      const preview = activeController.previewSelected();
      latestPreview = preview;
      const totalSize = formatBytes(preview.totalBytes || 0);
      previewOk = Boolean(preview.ok);
      if (preview.ok) {
        const warning = previewWarningText(preview);
        setStatus(
          warning ? "OSS 直传预检通过，有提示" : "OSS 直传预检通过",
          `已识别 ${preview.courses.length} 门课程：${previewCourseText(preview)}；${preview.files} 个文件，合计 ${totalSize}。${warning ? `${warning} ` : ""}点击“${uploadButtonText(preview)}”开始上传。`,
          null,
          warning ? "warn" : "info",
        );
      } else {
        setStatus(
          "OSS 直传预检失败",
          previewErrorText(preview),
          null,
          "error",
        );
      }
      updateUploadButton(previewErrorText(preview));
    }

    function renderConfig(config = {}) {
      const direct = config.directUpload || {};
      const ready = Boolean(direct.enabled && direct.configured);
      configReady = ready;
      const detail = ready
        ? `可直传到 ${direct.bucket || "OSS"}，单文件上限 ${direct.maxGb || 0} GB；超过 ${direct.simpleMaxGb || 5} GB 自动分片上传。`
        : direct.reason || "OSS 直传未配置。";
      updateUploadButton(detail);
      if (!ready) {
        setStatus("OSS 直传暂不可用", detail, null, "error");
      } else if (!elements.status?.hidden && /暂不可用/.test(elements.statusTitle?.textContent || "")) {
        elements.status.hidden = true;
      }
    }

    function setActiveUpload(xhr) {
      if (!elements.cancelButton) return;
      elements.cancelButton.hidden = !xhr;
      elements.cancelButton.disabled = false;
    }

    function cancelActiveUpload() {
      const activeController = controller();
      if (!activeController?.isUploading()) return false;
      if (elements.cancelButton) elements.cancelButton.disabled = true;
      setStatus("正在取消 OSS 直传", "浏览器正在中止当前上传。已经完成的 OSS 对象不会被删除。", null, "warn");
      activeController.cancelActiveUpload();
      return true;
    }

    async function uploadSelected() {
      const activeController = controller();
      if (!activeController) throw new Error("OSS 直传控制器尚未初始化。");
      const result = await activeController.uploadSelected();
      if (elements.fileInput) elements.fileInput.value = "";
      latestPreview = null;
      updateUploadButton();
      return result;
    }

    return {
      cancelActiveUpload,
      previewCourseText,
      previewErrorText,
      previewWarningText,
      refreshPreview,
      renderConfig,
      renderQueue,
      setActiveUpload,
      setStatus,
      updateUploadButton,
      uploadSelected,
    };
  }

  window.AdminMediaDirectPanel = {
    createPanel,
  };
})();
