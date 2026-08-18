(function () {
  function createPanel({
    elements = {},
    escapeHtml = window.AdminMediaView.escapeHtml,
    formatBytes = window.AdminMediaView.formatBytes,
    meterHtml,
  } = {}) {
    const root = elements.root;

    function number(value) {
      const n = Number(value || 0);
      return Number.isFinite(n) ? n : 0;
    }

    function count(items) {
      return Array.isArray(items) ? items.length : 0;
    }

    function stat(label, value, detail = "") {
      return `
        <div class="stat">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          ${detail ? `<p class="meta-line">${escapeHtml(detail)}</p>` : ""}
        </div>
      `;
    }

    function issue(label, value, okText = "OK") {
      const n = count(value);
      return `
        <div class="readiness-card ${n ? "warn-card" : "ok"}">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(n ? `${n} 门` : okText)}</strong>
        </div>
      `;
    }

    function lifecycleCounts(courses = []) {
      return courses.reduce((memo, course) => {
        const key = String(course.status || course.lifecycle || "unknown").trim() || "unknown";
        memo[key] = (memo[key] || 0) + 1;
        return memo;
      }, {});
    }

    function courseTitle(course) {
      return course.title || course.courseTitle || course.name || "";
    }

    function renderLargestCourses(courses = []) {
      const rows = [...courses]
        .sort((left, right) => number(right.totalBytes) - number(left.totalBytes))
        .slice(0, 8)
        .map(
          (course) => `
            <tr>
              <td><strong>${escapeHtml(course.course || course.code || "")}</strong></td>
              <td>${escapeHtml(courseTitle(course))}</td>
              <td>${escapeHtml(course.status || "")}</td>
              <td class="nowrap"><strong>${formatBytes(course.totalBytes || 0)}</strong></td>
            </tr>
          `,
        )
        .join("");
      return `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Course</th>
                <th>Title</th>
                <th>Status</th>
                <th>Total storage</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="4">暂无课程存储记录。</td></tr>'}</tbody>
          </table>
        </div>
      `;
    }

    function renderRiskList(summary = {}) {
      return `
        <div class="readiness-grid">
          ${issue("缺 manifest", summary.missingManifestCourses)}
          ${issue("缺 Course Outline", summary.missingCourseOutlines)}
          ${issue("缺 Introduction", summary.missingIntroductions)}
          ${issue("Unit Plan 缺口", summary.unitPlanGapCourses)}
          ${issue("Lesson Plan 缺口", summary.lessonPlanGapCourses)}
          ${issue("iSpring 缺口", summary.ispringMissingCourses)}
          ${issue("文本待复核", summary.textReviewCourses)}
        </div>
      `;
    }

    function renderLifecycle(courses = []) {
      const counts = lifecycleCounts(courses);
      const labels = Object.entries(counts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, value]) => `<span class="badge">${escapeHtml(label)} · ${escapeHtml(value)}</span>`)
        .join("");
      return labels || '<span class="badge">暂无状态记录</span>';
    }

    function renderLoading() {
      if (!root) return;
      root.hidden = false;
      root.innerHTML = '<div class="feedback-bar"><strong>正在读取后台总览...</strong></div>';
    }

    function renderError(error) {
      if (!root) return;
      root.hidden = false;
      root.innerHTML = `
        <div class="feedback-bar error">
          <strong>后台总览读取失败</strong>
          <span class="feedback-detail">${escapeHtml(error?.message || error || "未知错误")}</span>
        </div>
      `;
    }

    function render({ storage = {}, readiness = {}, lifecycle = {} } = {}) {
      if (!root) return;
      const disk = storage.disk || {};
      const storageSummary = storage.summary || {};
      const readinessSummary = readiness.summary || {};
      const lifecycleCourses = lifecycle.courses || [];
      const storageCourses = storage.courses || [];
      const catalogCourseCount = number(readiness.courseCount) || count(lifecycleCourses) || count(storageCourses);
      const uploadedCourses = number(readinessSummary.uploadedCourses) || count(storageCourses);
      const missingManifest = count(readinessSummary.missingManifestCourses);
      const activeCourses = count(storageCourses.filter((course) => String(course.status || "").toLowerCase() === "active"));
      const archivedCourses = count(storageCourses.filter((course) => String(course.status || "").toLowerCase() === "archived"));
      const storageMeter = typeof meterHtml === "function"
        ? meterHtml("数据盘", disk.usedBytes || 0, disk.totalBytes || 0)
        : "";

      root.innerHTML = `
        <div class="dashboard-stack">
          <div class="stats">
            ${stat("课程列表", catalogCourseCount, "后台课程下拉与 catalog 口径")}
            ${stat("已上传完整课", uploadedCourses, "可读取 course-manifest 的课程")}
            ${stat("缺 manifest", missingManifest, "需要重新导入或检查 course root")}
            ${stat("Active 课程", activeCourses || count(storageCourses), archivedCourses ? `${archivedCourses} 门 archived` : "")}
          </div>

          <div class="dashboard-grid">
            <div class="dashboard-card">
              <h3>存储空间</h3>
              ${storageMeter}
              <p class="meta-line">可用 ${formatBytes(disk.freeBytes || 0)} · 课程目录 ${formatBytes(storageSummary.activeRootBytes || 0)} · 后台临时 ${formatBytes(storageSummary.adminUploadBytes || 0)}</p>
            </div>
            <div class="dashboard-card">
              <h3>课程状态</h3>
              <div class="badge-row">${renderLifecycle(lifecycleCourses)}</div>
              <p class="meta-line">状态来自启用/归档列表；用于快速判断哪些课程已经对前台开放。</p>
            </div>
          </div>

          <div class="dashboard-card">
            <h3>完整性风险</h3>
            ${renderRiskList(readinessSummary)}
          </div>

          <div class="dashboard-card">
            <h3>占用空间最大的课程</h3>
            ${renderLargestCourses(storageCourses)}
          </div>

          <p class="meta-line">Updated: ${escapeHtml(storage.generatedAt || readiness.generatedAt || "")}</p>
        </div>
      `;
      root.hidden = false;
    }

    return {
      render,
      renderError,
      renderLoading,
    };
  }

  window.AdminDashboardPanel = {
    createPanel,
  };
})();
