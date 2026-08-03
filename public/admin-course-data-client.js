(function () {
  function createClient({ fetchImpl = window.fetch.bind(window) } = {}) {
    async function readJson(url, fallback) {
      const response = await fetchImpl(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${fallback}: ${response.status}`);
      return response.json();
    }

    return {
      courseManifest(courseCode = "ENG3U") {
        const course = encodeURIComponent(String(courseCode || "ENG3U").trim().toUpperCase());
        return readJson(`/courseware/${course}/course-manifest.json`, "Manifest request failed");
      },
      courseOptions() {
        return readJson("/admin-course-options.json", "Course options request failed");
      },
    };
  }

  window.AdminCourseDataClient = {
    createClient,
  };
})();
