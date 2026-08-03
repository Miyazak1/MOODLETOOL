(function () {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function createTransport({
    XMLHttpRequestImpl = window.XMLHttpRequest,
    chunkMaxRetries = 5,
    retryDelay = (attempt) => Math.min(30000, 2000 * attempt),
    sleepImpl = sleep,
  } = {}) {
    if (!XMLHttpRequestImpl) throw new Error("AdminUploadTransport requires XMLHttpRequest.");

    function uploadBinaryWithProgress(url, file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequestImpl();
        xhr.open("POST", url);
        xhr.withCredentials = true;
        xhr.timeout = 0;
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable && typeof onProgress === "function") onProgress(event.loaded, event.total);
        });
        xhr.addEventListener("load", () => {
          let data = null;
          try {
            data = JSON.parse(xhr.responseText || "{}");
          } catch {
            reject(new Error(xhr.responseText || `Upload failed with HTTP ${xhr.status}.`));
            return;
          }
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data.error || `Upload failed with HTTP ${xhr.status}.`));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("上传连接失败，请检查网络、Nginx 限制或登录状态。")));
        xhr.addEventListener("abort", () => reject(new Error("上传已取消。")));
        xhr.send(file);
      });
    }

    async function uploadWithRetry({ url, blob, onProgress, onRetry }) {
      let lastError = null;
      for (let attempt = 1; attempt <= chunkMaxRetries; attempt += 1) {
        try {
          return await uploadBinaryWithProgress(url, blob, onProgress);
        } catch (error) {
          lastError = error;
          if (attempt >= chunkMaxRetries) break;
          if (typeof onRetry === "function") onRetry(attempt, error);
          await sleepImpl(retryDelay(attempt));
        }
      }
      throw lastError || new Error("分片上传失败。");
    }

    return {
      uploadBinaryWithProgress,
      uploadWithRetry,
    };
  }

  window.AdminUploadTransport = {
    createTransport,
    sleep,
  };
})();
