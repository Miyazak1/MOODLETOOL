(function () {
  function createPanel({
    elements = {},
    escapeHtml = window.AdminMediaView.escapeHtml,
    getFilter,
    getQuery,
    getSelectedCourse,
    sortCourses,
  } = {}) {
    function selectedCourse() {
      return String(typeof getSelectedCourse === "function" ? getSelectedCourse() : "").trim().toUpperCase();
    }

    function lifecycleLabel(status) {
      const value = String(status || "active");
      const className = value === "active" ? "status-ok" : value === "archived" ? "status-missing" : "warn";
      return `<span class="${className}">${escapeHtml(value)}</span>`;
    }

    function isPlanningActive(course) {
      return course.status === "active" && course.catalogStatus && course.catalogStatus !== "ready";
    }

    function statusCounts(courses) {
      return {
        total: courses.length,
        active: courses.filter((course) => course.status === "active").length,
        archived: courses.filter((course) => course.status === "archived").length,
        risk: courses.filter(isPlanningActive).length,
      };
    }

    function filteredCourses(courses) {
      const filter = typeof getFilter === "function" ? getFilter() : "all";
      const query = String(typeof getQuery === "function" ? getQuery() : "").trim().toLowerCase();
      return courses.filter((course) => {
        if (filter === "risk" && !isPlanningActive(course)) return false;
        if (filter === "active" && course.status !== "active") return false;
        if (filter === "archived" && course.status !== "archived") return false;
        if (filter === "ready" && course.catalogStatus !== "ready") return false;
        if (filter === "planning" && course.catalogStatus === "ready") return false;
        if (!query) return true;
        return `${course.code} ${course.title} ${course.catalogStatus} ${course.status}`.toLowerCase().includes(query);
      });
    }

    function renderSummary(courses, visibleCourses) {
      if (!elements.summary) return;
      const counts = statusCounts(courses);
      elements.summary.innerHTML = [
        ["全部", counts.total],
        ["当前显示", visibleCourses.length],
        ["Active", counts.active],
        ["Archived", counts.archived],
        ["未完成但 Active", counts.risk],
      ]
        .map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`)
        .join("");
      elements.summary.hidden = false;

      if (!elements.notice) return;
      if (counts.risk) {
        elements.notice.innerHTML = `有 <strong>${counts.risk}</strong> 门 catalog 仍是 planning-only 但 lifecycle 是 active。首批上线前建议点击“应用首批上线状态”，只开放首批课程，其余课程先隐藏。`;
        elements.notice.hidden = false;
      } else {
        elements.notice.hidden = true;
      }
    }

    function renderSelectedBanner(course) {
      if (!elements.selectedBanner) return;
      if (!course) {
        elements.selectedBanner.hidden = true;
        return;
      }
      elements.selectedBanner.innerHTML = `
          当前操作课程：<strong>${escapeHtml(course.code)}</strong> · ${escapeHtml(course.title || "")}
          · ${lifecycleLabel(course.status)}
          · Catalog: ${escapeHtml(course.catalogStatus || "")}
        `;
      elements.selectedBanner.hidden = false;
    }

    function normalizeCourses(data = {}) {
      const courses = data.courses || [];
      return typeof sortCourses === "function" ? sortCourses(courses) : courses.slice();
    }

    function renderCourses(data = {}, selectedLifecycleCourse = "") {
      const courses = normalizeCourses(data);
      const visibleCourses = filteredCourses(courses);
      renderSummary(courses, visibleCourses);
      const selectedRecord = courses.find((course) => course.code === selectedLifecycleCourse || course.code === selectedCourse());
      renderSelectedBanner(selectedRecord);
      if (!elements.table) return { courses, visibleCourses, selectedRecord };

      const rows = visibleCourses
        .map((course) => {
          const risk = isPlanningActive(course);
          const selected = course.code === (selectedLifecycleCourse || selectedCourse());
          return `
              <tr class="${selected ? "selected-row" : ""}">
                <td><strong>${escapeHtml(course.code)}</strong></td>
                <td>${escapeHtml(course.title)}</td>
                <td>${lifecycleLabel(course.status)}</td>
                <td>${escapeHtml(course.catalogStatus || "")}${risk ? ' <span class="badge risk">需隐藏</span>' : ""}</td>
                <td>${escapeHtml(course.updatedAt || "")}</td>
                <td>${escapeHtml(course.updatedBy || "")}</td>
                <td>${escapeHtml(course.note || "")}</td>
                <td class="nowrap"><button class="small ${selected ? "primary" : ""}" type="button" data-course-action="select" data-course="${escapeHtml(course.code)}">${selected ? "已选择" : "选择"}</button></td>
              </tr>
            `;
        })
        .join("");
      elements.table.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Title</th>
                  <th>Lifecycle</th>
                  <th>Catalog</th>
                  <th>Updated</th>
                  <th>By</th>
                  <th>Note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="8">No courses found.</td></tr>'}</tbody>
            </table>
          </div>
          <p class="meta-line">Status file: ${escapeHtml(data.statusFile || "")}</p>
        `;
      elements.table.hidden = false;
      return { courses, visibleCourses, selectedRecord };
    }

    function renderJobs(data = {}) {
      if (!elements.jobs) return;
      const rows = (data.jobs || [])
        .map(
          (job) => `
              <tr>
                <td><strong>${escapeHtml(job.course)}</strong></td>
                <td>${escapeHtml(job.action)}</td>
                <td>${lifecycleLabel(job.status)}</td>
                <td>${job.deleteActive ? "yes" : "no"}</td>
                <td>${escapeHtml(job.requestedAt || "")}</td>
                <td>${escapeHtml(job.finishedAt || "")}</td>
                <td>${escapeHtml(job.error || job.payload?.archivePath || job.payload?.targetCourseRoot || "")}</td>
              </tr>
            `,
        )
        .join("");
      elements.jobs.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Delete active</th>
                  <th>Started</th>
                  <th>Finished</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="7">No lifecycle jobs yet.</td></tr>'}</tbody>
            </table>
          </div>
          <p class="meta-line">Active root: ${escapeHtml(data.activeRoot || "")}<br />Archive root: ${escapeHtml(data.archiveRoot || "")}</p>
        `;
      elements.jobs.hidden = false;
    }

    return {
      filteredCourses,
      isPlanningActive,
      lifecycleLabel,
      renderCourses,
      renderJobs,
      renderSelectedBanner,
      renderSummary,
      statusCounts,
    };
  }

  window.AdminCourseLifecyclePanel = {
    createPanel,
  };
})();
