(function () {
  function requireFunction(value, name) {
    if (typeof value !== "function") throw new Error(`AdminCoursePackageAction requires ${name}.`);
    return value;
  }

  function selectedPackageFile(fields) {
    return fields?.coursePackageFile?.files?.[0] || null;
  }

  function chunkCount(fileSize, chunkBytes) {
    return Math.ceil(fileSize / chunkBytes);
  }

  function chunkUrl({ course, filename, importId, index, chunkTotal, totalBytes }) {
    const params = new URLSearchParams({
      course,
      filename,
      importId,
      chunkIndex: String(index),
      chunkTotal: String(chunkTotal),
      totalBytes: String(totalBytes),
    });
    return `/api/admin/course-package/chunk?${params.toString()}`;
  }

  function resumableStartChunk({ restoredTask, importId, filename, totalBytes, chunkTotal }) {
    if (
      restoredTask?.importId === importId &&
      restoredTask.filename === filename &&
      Number(restoredTask.totalBytes || 0) === totalBytes
    ) {
      return Math.max(0, Math.min(chunkTotal, Number(restoredTask.chunksReceived || 0)));
    }
    return 0;
  }

  function rememberUpload({ rememberTask, course, importId, file, chunkTotal, chunksReceived, status }) {
    rememberTask({
      course,
      importId,
      filename: file.name,
      totalBytes: file.size,
      chunkTotal,
      chunksReceived,
      status,
    });
  }

  function createAction({
    fields,
    chunkBytes,
    chunkMaxRetries,
    formatBytes,
    uploadChunk,
    restoreTask,
    waitForReview,
    rememberTask,
    setStatus,
    clearPreview,
    clearCommitState,
    reusableImportId,
    renderPreview,
    write,
    afterSuccess,
    getCurrentImport,
    setUploadDisabled,
    updateCommitState,
    commitPackage,
    confirmCommit,
    clearPackageFile,
    afterCommitSuccess,
    uploadRawPackage,
    shouldUseRawUpload,
  } = {}) {
    if (!fields) throw new Error("AdminCoursePackageAction requires fields.");
    const bytesLabel = requireFunction(formatBytes, "formatBytes");
    const uploadOneChunk = requireFunction(uploadChunk, "uploadChunk");
    const restoreSavedTask = requireFunction(restoreTask, "restoreTask");
    const waitForServerReview = requireFunction(waitForReview, "waitForReview");
    const rememberSavedTask = requireFunction(rememberTask, "rememberTask");
    const showStatus = requireFunction(setStatus, "setStatus");
    const importIdFor = requireFunction(reusableImportId, "reusableImportId");
    const showPreview = requireFunction(renderPreview, "renderPreview");
    const currentImport = typeof getCurrentImport === "function" ? getCurrentImport : () => null;
    const rawUpload = typeof uploadRawPackage === "function" ? uploadRawPackage : null;
    const shouldUseRaw = typeof shouldUseRawUpload === "function" ? shouldUseRawUpload : () => false;

    function rawUploadRequired(error) {
      const message = error instanceof Error ? error.message : String(error || "");
      return Boolean(error?.data?.task?.rawUploadRequired || /ECS 剩余空间不足|OSS raw package|raw package/i.test(message));
    }

    function rawUploadImportId(data, fallback) {
      return data?.coursePackageTask?.importId
        || data?.upload?.importId
        || data?.uploads?.[0]?.coursePackageTask?.importId
        || data?.uploads?.[0]?.upload?.importId
        || fallback;
    }

    async function runRawPackageUpload({ course, file, importId, writeRawReason }) {
      if (!rawUpload) throw new Error("OSS raw package 上传入口未初始化。");
      if (writeRawReason && typeof write === "function") write(writeRawReason);
      const rawData = await rawUpload({
        course,
        file,
        importId,
        write,
        setStatus: showStatus,
      });
      const rawImportId = rawUploadImportId(rawData, importId);
      const finalData = await waitForServerReview(rawImportId);
      rememberUpload({
        rememberTask: rememberSavedTask,
        course,
        importId: rawImportId,
        file,
        chunkTotal: 0,
        chunksReceived: 0,
        status: finalData?.imported ? "committed" : "complete",
      });
      if (finalData?.imported) {
        showStatus({
          title: "OSS raw 导入完成",
          detail: "普通资料已保存到 ECS，高并发资源已发布到 OSS/CDN。",
          percent: 100,
          showProgress: true,
        });
        if (typeof write === "function") write(finalData);
        if (typeof clearPackageFile === "function") clearPackageFile();
        if (typeof afterSuccess === "function") await afterSuccess(finalData, file);
        return finalData;
      }
      showPreview(finalData);
      if (typeof afterSuccess === "function") await afterSuccess(finalData, file);
      return finalData;
    }

    async function uploadCoursePackage() {
      const file = selectedPackageFile(fields);
      if (!file) {
        showStatus({ title: "请选择整课 ZIP 压缩包", error: true });
        if (typeof write === "function") write("请选择整课 ZIP 压缩包。");
        return undefined;
      }
      if (!file.name.toLowerCase().endsWith(".zip")) {
        showStatus({ title: "整课包必须是 .zip 文件", detail: file.name, error: true });
        if (typeof write === "function") write("整课包必须是 .zip 文件。");
        return undefined;
      }

      const course = fields.course.value;
      if (typeof clearCommitState === "function") clearCommitState();
      if (typeof setUploadDisabled === "function") setUploadDisabled(true);
      if (typeof clearPreview === "function") clearPreview();

      const importId = importIdFor(file);
      const chunkTotal = chunkCount(file.size, chunkBytes);
      if (rawUpload && shouldUseRaw(file)) {
        showStatus({
          title: "正在准备 OSS raw 上传",
          detail: "这个课包将先 multipart 直传 OSS raw package，再由 ECS worker 通过内网流式读取并导入。",
          percent: 0,
          showProgress: true,
        });
        rememberUpload({
          rememberTask: rememberSavedTask,
          course,
          importId,
          file,
          chunkTotal: 0,
          chunksReceived: 0,
          status: "uploading",
        });
        try {
          return await runRawPackageUpload({
            course,
            file,
            importId,
            writeRawReason: "正在走 OSS raw package 导入：浏览器 multipart 直传原始 ZIP，ECS worker 内网流式处理。",
          });
        } catch (error) {
          rememberUpload({
            rememberTask: rememberSavedTask,
            course,
            importId,
            file,
            chunkTotal: 0,
            chunksReceived: 0,
            status: "failed",
          });
          showStatus({
            title: "OSS raw 上传或导入失败",
            detail: error instanceof Error ? error.message : String(error),
            error: true,
          });
          if (typeof write === "function") write(`Error: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        } finally {
          if (typeof setUploadDisabled === "function") setUploadDisabled(false);
        }
      }
      const restoredTask = await restoreSavedTask({ writeOutput: false });
      const startChunk = resumableStartChunk({
        restoredTask,
        importId,
        filename: file.name,
        totalBytes: file.size,
        chunkTotal,
      });

      rememberUpload({
        rememberTask: rememberSavedTask,
        course,
        importId,
        file,
        chunkTotal,
        chunksReceived: startChunk,
        status: "uploading",
      });
      showStatus({
        title: startChunk ? `继续上传 ${file.name}` : `正在上传 ${file.name}`,
        detail: startChunk
          ? `已恢复 ${startChunk}/${chunkTotal} 个分片，约 ${Math.round((startChunk / chunkTotal) * 100)}%。系统会自动续传和重试。`
          : `准备分片上传：${chunkTotal} 个分片，每片约 ${bytesLabel(chunkBytes)}。系统会自动续传和重试。`,
        percent: Math.round((startChunk / chunkTotal) * 100),
        showProgress: true,
      });
      if (typeof write === "function") write(`正在分片上传整课包：${file.name}，共 ${chunkTotal} 个分片...`);

      try {
        let finalData = null;
        for (let index = startChunk; index < chunkTotal; index += 1) {
          const start = index * chunkBytes;
          const end = Math.min(file.size, start + chunkBytes);
          const blob = file.slice(start, end);
          const data = await uploadOneChunk({
            url: chunkUrl({
              course,
              filename: file.name,
              importId,
              index,
              chunkTotal,
              totalBytes: file.size,
            }),
            blob,
            onProgress: (loaded) => {
              const totalLoaded = Math.min(file.size, start + loaded);
              const percent = Math.round((totalLoaded / file.size) * 100);
              showStatus({
                title: `正在上传 ${file.name}`,
                detail: `分片 ${index + 1}/${chunkTotal}，已上传 ${bytesLabel(totalLoaded)} / ${bytesLabel(file.size)} (${percent}%)。断线会自动重试。`,
                percent,
                showProgress: true,
              });
            },
            onRetry: (attempt, error) => {
              showStatus({
                title: "网络中断，正在自动重试",
                detail: `分片 ${index + 1}/${chunkTotal} 第 ${attempt + 1}/${chunkMaxRetries} 次尝试。${error instanceof Error ? error.message : String(error)}`,
                percent: Math.round((start / file.size) * 100),
                showProgress: true,
                error: true,
              });
            },
          });

          const chunksReceived = data.chunksReceived || index + 1;
          rememberUpload({
            rememberTask: rememberSavedTask,
            course,
            importId,
            file,
            chunkTotal,
            chunksReceived,
            status: "uploading",
          });
          showStatus({
            title: `正在上传 ${file.name}`,
            detail: data.complete
              ? "所有分片已上传，服务器正在合并、解压并生成预览。"
              : `已完成 ${chunksReceived}/${chunkTotal} 个分片，服务器已收到 ${bytesLabel(data.bytesReceived || end)} / ${bytesLabel(file.size)}。`,
            percent: data.percent ?? Math.round((Math.min(file.size, end) / file.size) * 100),
            showProgress: true,
          });

          if (data.complete) {
            finalData = data.processing ? await waitForServerReview(importId) : data;
            break;
          }
        }

        if (!finalData) {
          const task = await restoreSavedTask({ writeOutput: false });
          finalData = task?.review || currentImport();
        }
        if (finalData?.processing || !finalData?.operations) {
          finalData = await waitForServerReview(importId);
        }
        if (!finalData?.ok) throw new Error("所有分片已上传，但服务器没有返回导入预览。请刷新任务状态。");

        showStatus({
          title: "上传完成，服务器已生成预览",
          detail: `已扫描 ${finalData.operations?.length || 0} 个导入项。确认无误后点击“确认导入到当前课程”。`,
          percent: 100,
          showProgress: true,
        });
        rememberUpload({
          rememberTask: rememberSavedTask,
          course,
          importId: finalData.importId || importId,
          file,
          chunkTotal,
          chunksReceived: chunkTotal,
          status: "complete",
        });
        if (typeof write === "function") write(finalData);
        showPreview(finalData);
        if (typeof afterSuccess === "function") await afterSuccess(finalData, file);
        return finalData;
      } catch (error) {
        if (rawUpload && rawUploadRequired(error)) {
          showStatus({
            title: "ECS 空间不足，切换 OSS raw",
            detail: "课程 ZIP 会先直传到 OSS raw package，再由 ECS worker 通过内网流式读取并自动分流；不使用旧 FC 解压。",
            percent: 0,
            showProgress: true,
          });
          const finalData = await runRawPackageUpload({
            course,
            file,
            importId,
            writeRawReason: "ECS 空间不足，正在切换到 OSS raw package 导入。",
          });
          return finalData;
        }
        const latest = await restoreSavedTask({ writeOutput: false }).catch(() => null);
        rememberUpload({
          rememberTask: rememberSavedTask,
          course,
          importId,
          file,
          chunkTotal,
          chunksReceived: latest?.chunksReceived || startChunk,
          status: "failed",
        });
        showStatus({
          title: "上传失败",
          detail: `${error instanceof Error ? error.message : String(error)}。重新点“上传并生成预览”会从服务器已有分片继续。`,
          percent: null,
          showProgress: false,
          error: true,
        });
        if (typeof write === "function") write(`Error: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      } finally {
        if (typeof setUploadDisabled === "function") setUploadDisabled(false);
      }
    }

    async function commitCoursePackage() {
      const importData = currentImport();
      if (!importData?.importId) {
        if (typeof write === "function") write("请先上传整课 ZIP 并生成预览。");
        return { canceled: true, message: "请先上传整课 ZIP 并生成预览。" };
      }
      const commitState = typeof updateCommitState === "function"
        ? updateCommitState(importData)
        : {
            hasReady: Boolean(importData.summary?.ready),
            courseMatches: true,
            selected: fields.course.value,
            previewCourse: importData.course,
          };
      if (!commitState.hasReady) {
        showStatus({
          title: "无法导入",
          detail: "这次预览里没有可导入的资源，请重新上传正确的整课 ZIP。",
          showProgress: false,
        });
        if (typeof write === "function") write("这次预览里没有可导入的资源。");
        return { canceled: true, message: "这次预览里没有可导入的资源。" };
      }
      if (!commitState.courseMatches) {
        const message = `这次预览属于 ${commitState.previewCourse || "未知课程"}，当前课程是 ${commitState.selected || "未选择"}。请先切回正确课程，或重新上传当前课程的课包。`;
        showStatus({ title: "课程不匹配，无法导入", detail: message, showProgress: false });
        if (typeof write === "function") write(message);
        return { canceled: true, message };
      }

      const course = fields.course.value;
      const confirmed = typeof confirmCommit === "function"
        ? confirmCommit(`确认把 ${importData.summary?.ready || 0} 个资源导入 ${course}？现有同名文件会先备份。`)
        : true;
      if (!confirmed) return { canceled: true, message: "已取消整课 ZIP 导入。" };

      if (typeof write === "function") write(`正在导入整课包：${importData.importId}...`);
      const commit = requireFunction(commitPackage, "commitPackage");
      const data = await commit({
        course,
        importId: importData.importId,
      });
      if (typeof write === "function") write(data);
      if (data.ok) {
        if (typeof clearPackageFile === "function") clearPackageFile();
        if (typeof clearCommitState === "function") clearCommitState();
        if (typeof afterCommitSuccess === "function") await afterCommitSuccess(data);
      }
      return data;
    }

    return { commitCoursePackage, uploadCoursePackage };
  }

  window.AdminCoursePackageAction = {
    chunkCount,
    chunkUrl,
    createAction,
    resumableStartChunk,
    selectedPackageFile,
  };
})();
