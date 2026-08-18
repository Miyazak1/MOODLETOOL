(function () {
  function paramsToString(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      search.set(key, value);
    });
    return search.toString();
  }

  function appendParams(path, params) {
    const query = paramsToString(params);
    if (!query) return path;
    return `${path}${path.includes("?") ? "&" : "?"}${query}`;
  }

  function createClient({ fetchImpl = window.fetch.bind(window), credentials = "same-origin", responseMessage } = {}) {
    async function request(path, { method = "GET", params, body, headers = {}, throwOnError = false, fallback = "" } = {}) {
      const response = await fetchImpl(appendParams(path, params), {
        method,
        credentials,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (throwOnError && (!response.ok || data?.ok === false)) {
        const message = typeof responseMessage === "function"
          ? responseMessage(data, fallback || `HTTP ${response.status}`)
          : data?.error || data?.message || fallback || `HTTP ${response.status}`;
        const error = new Error(message);
        error.response = response;
        error.data = data;
        throw error;
      }
      return data;
    }

    return {
      applyLaunchCourseAllowlist(body) {
        return request("/api/admin/course-status/launch-allowlist", { method: "POST", body });
      },
      backups(course, limit = 30) {
        return request("/api/admin/backups", { params: { course, limit } });
      },
      cleanup(course, mode) {
        return request("/api/admin/cleanup", { method: "POST", params: { course, mode } });
      },
      contentWorkbench() {
        return request("/api/admin/content-workbench");
      },
      coursePackageCommit(body) {
        return request("/api/admin/course-package/commit", { method: "POST", body });
      },
      coursePackageStatus(course, importId) {
        return request("/api/admin/course-package/status", { params: { course, importId } });
      },
      courseLifecycle() {
        return request("/api/admin/course-status");
      },
      courseLifecycleJobs() {
        return request("/api/admin/course-lifecycle-jobs");
      },
      createCourseLifecycleJob(body) {
        return request("/api/admin/course-lifecycle-jobs", { method: "POST", body });
      },
      deleteUser(username, course) {
        return request("/api/admin/users", { method: "DELETE", params: { username, course } });
      },
      generatePreviews(course) {
        return request("/api/admin/generate-previews", { method: "POST", params: { course } });
      },
      history(course, limit = 30) {
        return request("/api/admin/history", { params: { course, limit } });
      },
      login(body) {
        return request("/api/admin/login", {
          method: "POST",
          body,
          throwOnError: true,
          fallback: "登录失败。",
        });
      },
      logout() {
        return request("/api/admin/logout", { method: "POST" });
      },
      readiness() {
        return request("/api/admin/readiness");
      },
      saveUser(body) {
        return request("/api/admin/users", { method: "POST", body });
      },
      session() {
        return request("/api/admin/session");
      },
      setCourseLifecycle(body) {
        return request("/api/admin/course-status", { method: "POST", body });
      },
      status(course) {
        return request("/api/admin/status", { params: { course } });
      },
      storage(params = {}) {
        return request("/api/admin/storage", { params });
      },
      uploadGaps() {
        return request("/api/admin/upload-gaps");
      },
      users() {
        return request("/api/admin/users");
      },
    };
  }

  window.AdminApiClient = {
    appendParams,
    createClient,
    paramsToString,
  };
})();
