(function () {
  function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function inferCourseCodeFromFilename(fileName, courseCodes = []) {
    const normalized = String(fileName || "").toUpperCase();
    const codes = [...new Set(courseCodes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))]
      .sort((left, right) => right.length - left.length || left.localeCompare(right));
    for (const code of codes) {
      if (new RegExp(`(^|[^A-Z0-9])${escapeRegex(code)}([^A-Z0-9]|$)`).test(normalized)) return code;
    }
    return "";
  }

  function fileExtension(fileName) {
    const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function validateDirectUploadFile({ kind, file }) {
    const name = file?.name || "";
    const extension = fileExtension(name);
    if (!name) throw new Error("请选择有效文件。");
    if (!Number.isFinite(file?.size) || file.size <= 0) throw new Error(`${name} 是空文件，不能上传。`);
    if (kind === "course-package" && extension !== "zip") {
      throw new Error(`${name} 不是 ZIP 完整课件包。请选择 .zip 文件。`);
    }
    if (kind === "h5p" && extension !== "h5p") {
      throw new Error(`${name} 不是 H5P 文件。请选择 .h5p 文件。`);
    }
    if (kind === "ispring-package" && extension !== "zip") {
      throw new Error(`${name} 不是 iSpring 包。请选择 .zip 文件。`);
    }
    if (kind === "video" && !["mp4", "webm", "mov", "m4v"].includes(extension)) {
      throw new Error(`${name} 不是支持的视频文件。请上传 mp4、webm、mov 或 m4v。`);
    }
  }

  function resolveDirectUploadCourse({ kind, file, selectedCourse, courseCodes }) {
    validateDirectUploadFile({ kind, file });
    if (kind !== "course-package") {
      const selected = String(selectedCourse || "").trim().toUpperCase();
      if (!selected) throw new Error("请选择课程。");
      return { course: selected, source: "selected-course" };
    }
    const inferred = inferCourseCodeFromFilename(file?.name || "", courseCodes);
    if (!inferred) {
      throw new Error("无法从完整课件包文件名识别课程码。请把文件名改成类似 ESLDO-course-package-20260803.zip 后再上传。");
    }
    return { course: inferred, source: "filename" };
  }

  function createDirectUploadPreview({ kind = "course-package", files = [], selectedCourse = "", courseCodes = [] } = {}) {
    const fileList = Array.from(files || []);
    const normalizedSelectedCourse = String(selectedCourse || "").trim().toUpperCase();
    const items = fileList.map((file, index) => {
      try {
        const resolvedCourse = resolveDirectUploadCourse({ kind, file, selectedCourse, courseCodes });
        return {
          course: resolvedCourse.course,
          detail: resolvedCourse.source === "filename" ? "已从文件名识别课程" : "将保存到当前课程",
          file,
          id: `preview-${index}-${file.name}`,
          index,
          name: file.name,
          percent: 0,
          resolvedCourse,
          size: file.size || 0,
          source: resolvedCourse.source,
          status: "ready",
          valid: true,
        };
      } catch (error) {
        return {
          course: "",
          detail: error.message,
          file,
          id: `preview-${index}-${file?.name || "file"}`,
          index,
          name: file?.name || "",
          percent: 0,
          resolvedCourse: null,
          size: file?.size || 0,
          source: "",
          status: "failed",
          valid: false,
        };
      }
    });
    const errors = [];
    const warnings = [];
    if (fileList.length > 1 && kind !== "course-package") {
      errors.push("批量直传目前只支持完整课件包 ZIP。视频、H5P 和 iSpring 单包请一次传一个。");
    }
    if (kind === "course-package") {
      const courseCounts = items.reduce((counts, item) => {
        if (item.course) counts.set(item.course, (counts.get(item.course) || 0) + 1);
        return counts;
      }, new Map());
      [...courseCounts.entries()]
        .filter(([, count]) => count > 1)
        .forEach(([course]) => errors.push(`${course} 在本次选择里出现了多个完整课件包。请一次只保留这一门课的最新 ZIP。`));
      const recognizedCourses = [...courseCounts.keys()];
      const otherCourses = normalizedSelectedCourse
        ? recognizedCourses.filter((course) => course !== normalizedSelectedCourse)
        : [];
      if (otherCourses.length === 1 && recognizedCourses.length === 1) {
        warnings.push(`当前左侧课程是 ${normalizedSelectedCourse}，但文件名识别为 ${otherCourses[0]}；本次会按 ${otherCourses[0]} 上传。`);
      } else if (otherCourses.length > 0) {
        warnings.push(`当前左侧课程是 ${normalizedSelectedCourse}，但本次选择包含 ${recognizedCourses.join("、")}；完整课件包会按文件名分别上传。`);
      }
    }
    items.filter((item) => !item.valid).forEach((item) => errors.push(item.detail));
    return {
      ok: !errors.length,
      files: fileList.length,
      items,
      errors,
      totalBytes: items.reduce((sum, item) => sum + Number(item.size || 0), 0),
      courses: [...new Set(items.map((item) => item.course).filter(Boolean))],
      warnings,
    };
  }

  function uploadOssPostObject(form, file, {
    XMLHttpRequestImpl = window.XMLHttpRequest,
    FormDataImpl = window.FormData,
    onActiveUploadChange,
    onProgress,
  } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequestImpl();
      if (typeof onActiveUploadChange === "function") onActiveUploadChange(xhr);
      xhr.open(form.method || "POST", form.url, true);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === "function") {
          onProgress({
            percent: Math.round((event.loaded / event.total) * 100),
            loaded: event.loaded,
            total: event.total,
          });
        }
      };
      xhr.onload = () => {
        if (typeof onActiveUploadChange === "function") onActiveUploadChange(null);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ status: xhr.status, text: xhr.responseText || "" });
        } else {
          reject(new Error(`OSS 上传失败：HTTP ${xhr.status} ${xhr.responseText || ""}`.trim()));
        }
      };
      xhr.onerror = () => {
        if (typeof onActiveUploadChange === "function") onActiveUploadChange(null);
        reject(new Error("OSS 上传网络错误，请检查 CORS、网络或 OSS 域名配置。"));
      };
      xhr.ontimeout = () => {
        if (typeof onActiveUploadChange === "function") onActiveUploadChange(null);
        reject(new Error("OSS 上传超时，请重试。"));
      };
      xhr.onabort = () => {
        if (typeof onActiveUploadChange === "function") onActiveUploadChange(null);
        reject(new Error("已取消 OSS 直传。"));
      };
      const data = new FormDataImpl();
      Object.entries(form.fields || {}).forEach(([key, value]) => {
        data.append(key, value);
      });
      data.append("file", file);
      xhr.send(data);
    });
  }

  function uploadOssPutPart(part, blob, {
    XMLHttpRequestImpl = window.XMLHttpRequest,
    onActiveUploadChange,
    onProgress,
  } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequestImpl();
      if (typeof onActiveUploadChange === "function") onActiveUploadChange(xhr);
      xhr.open("PUT", part.url, true);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === "function") {
          onProgress({
            loaded: event.loaded,
            total: event.total,
          });
        }
      };
      xhr.onload = () => {
        if (typeof onActiveUploadChange === "function") onActiveUploadChange(null);
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader("ETag") || xhr.getResponseHeader("etag") || "";
          resolve({ partNumber: part.partNumber, etag: etag.replace(/^"|"$/g, "") });
        } else {
          reject(new Error(`OSS 分片上传失败：第 ${part.partNumber} 片 HTTP ${xhr.status} ${xhr.responseText || ""}`.trim()));
        }
      };
      xhr.onerror = () => {
        if (typeof onActiveUploadChange === "function") onActiveUploadChange(null);
        reject(new Error("OSS 分片上传网络错误，请检查 CORS、网络或 OSS 域名配置。"));
      };
      xhr.ontimeout = () => {
        if (typeof onActiveUploadChange === "function") onActiveUploadChange(null);
        reject(new Error("OSS 分片上传超时，请重试。"));
      };
      xhr.onabort = () => {
        if (typeof onActiveUploadChange === "function") onActiveUploadChange(null);
        reject(new Error("已取消 OSS 直传。"));
      };
      xhr.send(blob);
    });
  }

  async function uploadOssMultipartObject(multipart, file, {
    onActiveUploadChange,
    onProgress,
  } = {}) {
    const parts = Array.isArray(multipart?.parts) ? multipart.parts : [];
    if (!parts.length) throw new Error("OSS 分片上传授权缺少 parts。");
    const uploadedParts = [];
    let completedBytes = 0;
    for (const part of parts) {
      const blob = file.slice(part.start, part.end);
      const uploaded = await uploadOssPutPart(part, blob, {
        onActiveUploadChange,
        onProgress: ({ loaded, total }) => {
          const loadedBytes = completedBytes + Number(loaded || 0);
          const totalBytes = file.size || multipart.totalBytes || 0;
          if (typeof onProgress === "function") {
            onProgress({
              percent: totalBytes ? Math.max(0, Math.min(100, Math.round((loadedBytes / totalBytes) * 100))) : 0,
              loaded: loadedBytes,
              total: totalBytes,
              partNumber: part.partNumber,
              partCount: multipart.partCount || parts.length,
              partLoaded: loaded,
              partTotal: total,
            });
          }
        },
      });
      uploadedParts.push(uploaded);
      completedBytes += blob.size;
    }
    return { parts: uploadedParts };
  }

  function createDirectUploadController(options = {}) {
    const {
      api,
      confirm: confirmImpl = window.confirm.bind(window),
      formatProgress,
      getAutoPublish,
      getCourseCodes,
      getFiles,
      getKind,
      getSelectedCourse,
      hasActiveWriteJob,
      jobTypeLabel,
      onActiveUploadChange,
      onQueueChange,
      onRefresh,
      onStartRefresh,
      onStatus,
      onWrite,
      uploadObject = uploadOssPostObject,
      uploadMultipartObject = uploadOssMultipartObject,
    } = options;

    let activeXhr = null;
    let queue = [];
    let cancelRequested = false;

    function setActiveUpload(xhr) {
      activeXhr = xhr;
      if (typeof onActiveUploadChange === "function") onActiveUploadChange(xhr);
    }

    function setStatus(title, detail = "", percent = null, type = "info") {
      if (typeof onStatus === "function") onStatus({ title, detail, percent, type });
    }

    function notifyQueue() {
      if (typeof onQueueChange !== "function") return;
      onQueueChange(queue.map((item) => ({
        course: item.course,
        detail: item.detail,
        id: item.id,
        loaded: item.loaded,
        name: item.name,
        percent: item.percent,
        size: item.size,
        source: item.source,
        status: item.status,
        total: item.total,
        etaText: item.etaText,
        overallText: item.overallText,
        speedText: item.speedText,
      })));
    }

    function updateQueueItem(item, patch) {
      if (!item) return;
      Object.assign(item, patch);
      notifyQueue();
    }

    function markRemainingQueueCancelled(startIndex, detail = "已取消 OSS 直传。") {
      let changed = false;
      for (let index = Math.max(0, Number(startIndex || 0)); index < queue.length; index += 1) {
        if (["done", "warning", "failed", "cancelled"].includes(queue[index]?.status)) continue;
        Object.assign(queue[index], { detail, status: "cancelled" });
        changed = true;
      }
      if (changed) notifyQueue();
    }

    function createQueueItems(files, kind) {
      return files.map((file, index) => {
        const resolvedCourse = resolveDirectUploadCourse({
          kind,
          file,
          selectedCourse: typeof getSelectedCourse === "function" ? getSelectedCourse() : "",
          courseCodes: typeof getCourseCodes === "function" ? getCourseCodes() : [],
        });
        return {
          course: resolvedCourse.course,
          detail: "等待上传",
          file,
          id: `${Date.now()}-${index}-${file.name}`,
          index,
          name: file.name,
          percent: 0,
          resolvedCourse,
          size: file.size || 0,
          source: resolvedCourse.source,
          status: "queued",
        };
      });
    }

    function previewSelected() {
      const files = typeof getFiles === "function" ? Array.from(getFiles() || []) : [];
      if (!files.length) {
        queue = [];
        notifyQueue();
        return createDirectUploadPreview();
      }
      const kind = typeof getKind === "function" ? getKind() : "course-package";
      const preview = createDirectUploadPreview({
        kind,
        files,
        selectedCourse: typeof getSelectedCourse === "function" ? getSelectedCourse() : "",
        courseCodes: typeof getCourseCodes === "function" ? getCourseCodes() : [],
      });
      queue = preview.items;
      notifyQueue();
      return preview;
    }

    async function uploadSingle(file, { index = 0, totalFiles = 1, queueItem = null, resolvedCourse = null, batchProgress = null } = {}) {
      if (!file) throw new Error("请选择要直传到 OSS 的文件。");
      const kind = typeof getKind === "function" ? getKind() : "course-package";
      const courseInfo = resolvedCourse || resolveDirectUploadCourse({
        kind,
        file,
        selectedCourse: typeof getSelectedCourse === "function" ? getSelectedCourse() : "",
        courseCodes: typeof getCourseCodes === "function" ? getCourseCodes() : [],
      });
      const course = courseInfo.course;
      const autoPublish = Boolean(typeof getAutoPublish === "function" ? getAutoPublish() : false);
      if (autoPublish) {
        const activeWriteJob = typeof hasActiveWriteJob === "function" ? hasActiveWriteJob() : null;
        if (activeWriteJob) {
          const typeLabel = typeof jobTypeLabel === "function" ? jobTypeLabel(activeWriteJob.type) : activeWriteJob.type;
          throw new Error(`已有写任务运行中：${activeWriteJob.course || activeWriteJob.scope || "all"} · ${typeLabel}。请等待完成后再自动发布，或取消勾选“上传后自动创建发布任务”只直传到 OSS inbox。`);
        }
      }
      if (autoPublish && kind === "ispring-package") {
        const ok = confirmImpl("当前自动发布支持完整课件包 ZIP、单个视频和 H5P。iSpring 单包会先保存到 OSS inbox，暂不会自动覆盖课程。仍然继续上传吗？");
        if (!ok) return { canceled: true, message: "已取消 OSS 直传。" };
      }

      const courseSourceText = courseInfo.source === "filename" ? "文件名自动识别" : "当前课程";
      const batchText = totalFiles > 1 ? `第 ${index + 1}/${totalFiles} 个 · ` : "";
      const fileSizeText = window.AdminMediaView?.formatBytes ? window.AdminMediaView.formatBytes(file.size) : `${file.size || 0} B`;
      updateQueueItem(queueItem, { detail: "创建 OSS 上传授权", percent: 0, status: "authorizing" });
      setStatus("正在创建 OSS 上传授权", `${batchText}${course} · ${courseSourceText} · ${file.name} · ${fileSizeText}`, 0);
      const initData = await api.initOssUpload({
        course,
        kind,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "",
      });
      const isMultipart = Boolean(initData.multipart);
      updateQueueItem(queueItem, { detail: initData.upload.objectKey, percent: 1, status: "uploading" });
      setStatus(isMultipart ? "正在分片直传 OSS" : "正在直传 OSS", `${batchText}${initData.upload.course || course} · ${initData.upload.objectKey}`, 1);
      const progressText = typeof formatProgress === "function" ? formatProgress(file) : null;
      let multipartParts = null;
      const handleUploadProgress = ({ percent, loaded, total, partNumber, partCount }) => {
          const overall = typeof batchProgress === "function"
            ? batchProgress(index, loaded, total || file.size || 0)
            : { percent: Math.round(((index + percent / 100) / totalFiles) * 100), loaded, total };
          const progressInfo = progressText
            ? progressText({ percent, loaded, total, objectKey: initData.upload.objectKey })
            : null;
          const detail = typeof progressInfo === "string"
            ? progressInfo
            : progressInfo?.detail
              ? progressInfo.detail
              : `${percent}% · ${initData.upload.objectKey}`;
          const overallText = totalFiles > 1 && overall?.total
            ? `${window.AdminMediaView?.formatBytes(overall.loaded) || overall.loaded} / ${window.AdminMediaView?.formatBytes(overall.total) || overall.total}`
            : "";
          const partText = partNumber && partCount ? ` · 分片 ${partNumber}/${partCount}` : "";
          const batchDetail = totalFiles > 1 && overall?.total
            ? `${batchText}${detail}${partText} · 总进度 ${overallText}`
            : `${batchText}${detail}${partText}`;
          updateQueueItem(queueItem, {
            detail: `${detail}${partText}`,
            etaText: progressInfo?.etaText || "",
            loaded,
            overallText,
            percent,
            speedText: progressInfo?.speedText || "",
            status: "uploading",
            total,
          });
          setStatus(`正在直传 OSS · ${overall.percent}%`, batchDetail, overall.percent);
      };
      if (isMultipart) {
        const result = await uploadMultipartObject(initData.multipart, file, {
          onActiveUploadChange: setActiveUpload,
          onProgress: handleUploadProgress,
        });
        multipartParts = result.parts;
      } else {
        await uploadObject(initData.form, file, {
          onActiveUploadChange: setActiveUpload,
          onProgress: handleUploadProgress,
        });
      }
      updateQueueItem(queueItem, { detail: initData.upload.ossUri, percent: 100, status: "verifying" });
      setStatus("正在校验 OSS 对象", `${batchText}${initData.upload.ossUri}`, Math.round(((index + 1) / totalFiles) * 100));
      const completeData = await api.completeOssUpload(initData.upload.id, {
        objectKey: initData.upload.objectKey,
        autoPublish,
        ...(multipartParts ? { parts: multipartParts } : {}),
      });
      const finishedDetail = completeData.job
        ? `已创建媒体任务 ${completeData.job.id}`
        : completeData.coursePackageTask
          ? `已创建导入任务 ${completeData.coursePackageTask.importId || completeData.upload?.importId || ""}`.trim()
          : completeData.warning || "已保存到 OSS inbox";
      updateQueueItem(queueItem, { detail: finishedDetail, percent: 100, status: completeData.warning ? "warning" : "done" });
      if (typeof onRefresh === "function") await onRefresh();
      if (typeof onStartRefresh === "function") onStartRefresh();
      if (typeof onWrite === "function") onWrite(completeData);
      return completeData;
    }

    async function uploadSelected() {
      const files = typeof getFiles === "function" ? Array.from(getFiles() || []) : [];
      if (!files.length) throw new Error("请选择要直传到 OSS 的文件。");
      cancelRequested = false;
      const kind = typeof getKind === "function" ? getKind() : "course-package";
      if (files.length > 1 && kind !== "course-package") {
        throw new Error("批量直传目前只支持完整课件包 ZIP。视频、H5P 和 iSpring 单包请一次传一个。");
      }
      const preview = createDirectUploadPreview({
        kind,
        files,
        selectedCourse: typeof getSelectedCourse === "function" ? getSelectedCourse() : "",
        courseCodes: typeof getCourseCodes === "function" ? getCourseCodes() : [],
      });
      if (!preview.ok) {
        queue = preview.items;
        notifyQueue();
        throw new Error(`OSS 直传预检未通过：${preview.errors[0]}`);
      }
      if (preview.warnings?.length) {
        const ok = confirmImpl(`OSS 直传预检提示：\n\n${preview.warnings.join("\n")}\n\n确认继续上传吗？`);
        if (!ok) return { canceled: true, message: "已取消 OSS 直传。" };
      }
      queue = createQueueItems(files, kind);
      notifyQueue();
      const results = [];
      const fileSizes = files.map((file) => Number(file.size || 0));
      const totalBytes = fileSizes.reduce((sum, size) => sum + size, 0);
      function updateBatchProgress(index, loaded, total) {
        const completedBytes = fileSizes.slice(0, index).reduce((sum, size) => sum + size, 0);
        const currentLoaded = Math.min(Number(loaded || 0), Number(total || fileSizes[index] || 0));
        const loadedBytes = Math.min(totalBytes, completedBytes + currentLoaded);
        return {
          loaded: loadedBytes,
          percent: totalBytes ? Math.max(0, Math.min(100, Math.round((loadedBytes / totalBytes) * 100))) : 0,
          total: totalBytes,
        };
      }
      for (let index = 0; index < files.length; index += 1) {
        const queueItem = queue[index];
        try {
          results.push(await uploadSingle(files[index], {
            index,
            totalFiles: files.length,
            queueItem,
            resolvedCourse: queueItem.resolvedCourse,
            batchProgress: updateBatchProgress,
          }));
        } catch (error) {
          const wasCancelled = cancelRequested || /取消|中止|abort/i.test(error.message || "");
          updateQueueItem(queueItem, {
            detail: error.message,
            status: wasCancelled ? "cancelled" : "failed",
          });
          if (wasCancelled) {
            markRemainingQueueCancelled(index + 1);
            setStatus("OSS 直传已取消", "已经完成的 OSS 对象不会被删除，未开始的文件已停止上传。", null, "warn");
            if (typeof onRefresh === "function") await onRefresh();
            if (typeof onStartRefresh === "function") onStartRefresh();
            return { canceled: true, uploads: results };
          }
          throw error;
        }
      }
      const createdJobs = results.filter((item) => item?.job || item?.coursePackageTask).length;
      const detail = files.length > 1
        ? `已上传 ${files.length} 个文件，创建 ${createdJobs} 个后续任务。`
        : (results[0]?.job
          ? `已创建媒体任务 ${results[0].job.id}。`
          : results[0]?.coursePackageTask
            ? `已创建课程导入任务 ${results[0].coursePackageTask.importId || results[0].upload?.importId}，导入完成后会自动发布媒体。`
            : results[0]?.warning || "文件已保存到 OSS inbox。");
      setStatus("OSS 直传完成", detail, 100, results.some((item) => item?.warning) ? "warn" : "info");
      if (typeof onRefresh === "function") await onRefresh();
      if (typeof onStartRefresh === "function") onStartRefresh();
      return { ok: true, uploads: results };
    }

    function cancelActiveUpload() {
      cancelRequested = true;
      if (!activeXhr) return false;
      activeXhr.abort();
      return true;
    }

    return {
      cancelActiveUpload,
      previewSelected,
      inferCourseCodeFromFilename,
      isUploading: () => Boolean(activeXhr),
      resolveDirectUploadCourse,
      uploadSelected,
      uploadSingle,
    };
  }

  window.AdminMediaUpload = {
    createDirectUploadController,
    createDirectUploadPreview,
    inferCourseCodeFromFilename,
    resolveDirectUploadCourse,
    uploadOssPostObject,
  };
})();
