(function () {
  function defaultResponseMessage(data, fallback = "") {
    return data?.error || data?.message || fallback;
  }

  async function readJsonResponse(response, fallback) {
    const data = await response.json();
    if (!response.ok || data?.ok === false) {
      const message = defaultResponseMessage(data, fallback || `HTTP ${response.status}`);
      const error = new Error(message);
      error.response = response;
      error.data = data;
      throw error;
    }
    return data;
  }

  function createClient({ fetchImpl = window.fetch.bind(window), credentials = "same-origin", responseMessage = defaultResponseMessage } = {}) {
    async function requestJson(url, options = {}, fallback = "") {
      const response = await fetchImpl(url, {
        credentials,
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
      const data = await response.json();
      if (!response.ok || data?.ok === false) {
        const message = responseMessage(data, fallback || `HTTP ${response.status}`);
        const error = new Error(message);
        error.response = response;
        error.data = data;
        throw error;
      }
      return data;
    }

    return {
      async read({ refreshOss = false } = {}) {
        const coursesUrl = `/api/admin/media/courses${refreshOss ? "?refreshOss=1" : ""}`;
        const [coursesResponse, jobsResponse, uploadsResponse] = await Promise.all([
          fetchImpl(coursesUrl, { credentials }),
          fetchImpl("/api/admin/media/jobs?limit=50", { credentials }),
          fetchImpl("/api/admin/oss/uploads?limit=50", { credentials }),
        ]);
        const coursesData = await coursesResponse.json();
        const jobsData = await jobsResponse.json();
        const uploadsData = await uploadsResponse.json();
        return {
          ...(coursesData.ok ? coursesData : {}),
          jobs: jobsData.jobs || [],
          jobsOk: jobsData.ok,
          jobsError: jobsData.error || "",
          uploads: uploadsData.uploads || [],
          uploadsOk: uploadsData.ok,
          uploadsError: uploadsData.error || "",
          coursesOk: coursesData.ok,
          coursesError: coursesData.error || "",
        };
      },

      async createJob(payload) {
        return requestJson(
          "/api/admin/media/jobs",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          "媒体任务创建失败。",
        );
      },

      async jobLog(jobId, { stream = "stdout", tail = 240 } = {}) {
        return requestJson(
          `/api/admin/media/jobs/${encodeURIComponent(jobId)}/log?stream=${encodeURIComponent(stream)}&tail=${encodeURIComponent(tail)}`,
          {},
          "读取日志失败。",
        );
      },

      async cancelJob(jobId) {
        return requestJson(
          `/api/admin/media/jobs/${encodeURIComponent(jobId)}/cancel`,
          { method: "POST" },
          "取消媒体任务失败。",
        );
      },

      async retryJob(jobId) {
        return requestJson(
          `/api/admin/media/jobs/${encodeURIComponent(jobId)}/retry`,
          { method: "POST" },
          "重试媒体任务失败。",
        );
      },

      async clearLock(course) {
        return requestJson(
          `/api/admin/media/locks/${encodeURIComponent(course)}/clear`,
          { method: "POST" },
          "清理课程锁失败。",
        );
      },

      async clearStaleLocks() {
        return requestJson(
          "/api/admin/media/locks/clear-stale",
          { method: "POST" },
          "批量清理遗留课程锁失败。",
        );
      },

      async initOssUpload(payload) {
        return requestJson(
          "/api/admin/oss/uploads/init",
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          "创建 OSS 上传授权失败。",
        );
      },

      async completeOssUpload(uploadId, payload) {
        return requestJson(
          `/api/admin/oss/uploads/${encodeURIComponent(uploadId)}/complete`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
          "OSS 上传完成校验失败。",
        );
      },
    };
  }

  function createAutoRefresh({ isEnabled, read, hasActive, onStatus, onError } = {}) {
    let timer = null;
    let inFlight = false;

    function stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      inFlight = false;
      if (typeof onStatus === "function") onStatus("stopped");
    }

    function schedule(delayMs) {
      if (timer) clearTimeout(timer);
      if (typeof isEnabled === "function" && !isEnabled()) return;
      const active = typeof hasActive === "function" && hasActive();
      if (typeof onStatus === "function") onStatus("scheduled", { delayMs, active });
      timer = setTimeout(async () => {
        if (typeof isEnabled === "function" && !isEnabled()) return;
        if (inFlight) {
          schedule(2000);
          return;
        }
        inFlight = true;
        if (typeof onStatus === "function") onStatus("refreshing", { active: typeof hasActive === "function" && hasActive() });
        try {
          await read();
        } catch (error) {
          if (typeof onError === "function") onError(error);
        } finally {
          inFlight = false;
          schedule(typeof hasActive === "function" && hasActive() ? 5000 : 15000);
        }
      }, delayMs);
    }

    function start() {
      if (typeof isEnabled === "function" && !isEnabled()) return;
      if (typeof onStatus === "function") onStatus("started");
      schedule(typeof hasActive === "function" && hasActive() ? 5000 : 15000);
    }

    return {
      start,
      stop,
      schedule,
      isRunning() {
        return Boolean(timer);
      },
    };
  }

  window.AdminMediaApi = {
    createAutoRefresh,
    createClient,
    readJsonResponse,
  };
})();
