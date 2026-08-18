(function () {
  function createPanel({
    elements = {},
    escapeHtml = window.AdminMediaView.escapeHtml,
    formatBytes = window.AdminMediaView.formatBytes,
    meterHtml,
  } = {}) {
    const root = elements.root;
    let state = {
      errors: {},
      lifecycle: null,
      readiness: null,
      storage: null,
    };

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
      const n = Array.isArray(value) ? count(value) : number(value);
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

    function renderPlaceholder(text) {
      return `<div class="feedback-bar"><strong>${escapeHtml(text)}</strong></div>`;
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
      state = {
        errors: {},
        lifecycle: null,
        readiness: null,
        storage: null,
      };
      render(state);
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

    function update(patch = {}) {
      state = {
        ...state,
        ...patch,
        errors: {
          ...(state.errors || {}),
          ...(patch.errors || {}),
        },
      };
      render(state);
    }

    function render({ storage = null, readiness = null, lifecycle = null, errors = {} } = {}) {
      if (!root) return;
      const hasStorage = Boolean(storage?.ok);
      const hasReadiness = Boolean(readiness?.ok);
      const hasLifecycle = Boolean(lifecycle?.ok);
      const disk = hasStorage ? storage.disk || {} : {};
      const storageSummary = hasStorage ? storage.summary || {} : {};
      const readinessSummary = hasReadiness ? readiness.summary || {} : {};
      const lifecycleCourses = hasLifecycle ? lifecycle.courses || [] : [];
      const storageCourses = hasStorage ? storage.courses || [] : [];
      const catalogCourseCount = hasReadiness
        ? number(readiness.courseCount) || count(lifecycleCourses) || count(storageCourses)
        : "读取中";
      const uploadedCourses = hasReadiness ? number(readinessSummary.uploadedCourses) || count(storageCourses) : "读取中";
      const completedCourses = hasReadiness ? number(readinessSummary.completedCourses ?? readinessSummary.displayableCourses) : "读取中";
      const displayGapCourses = hasReadiness ? number(readinessSummary.displayGapCourses) : "读取中";
      const missingManifest = hasReadiness ? number(readinessSummary.missingManifestCourses) : "读取中";
      const activeDirectoryCourses = hasStorage
        ? number(storageSummary.activeDirectoryCourses) || count(storageCourses.filter((course) => number(course.activeBytes) > 0))
        : "读取中";
      const extraDirectoryCourses = hasStorage ? number(storageSummary.extraActiveDirectoryCourses) : 0;
      const storageMeter = hasStorage && typeof meterHtml === "function"
        ? meterHtml("数据盘", disk.usedBytes || 0, disk.totalBytes || 0)
        : renderPlaceholder(errors.storage || "存储统计读取中...");
      const storageCache = hasStorage ? storage.cache || {} : {};
      const storageDetail = storageSummary.lightweight
        ? storageCache.usable
          ? `可用 ${formatBytes(disk.freeBytes || 0)} · 课程目录 ${formatBytes(storageSummary.activeRootBytes || 0)} · 缓存 ${storageCache.updatedAt || "已生成"}`
          : `可用 ${formatBytes(disk.freeBytes || 0)} · 课程目录大小未缓存，请点“查看存储空间”生成`
        : `可用 ${formatBytes(disk.freeBytes || 0)} · 课程目录 ${formatBytes(storageSummary.activeRootBytes || 0)} · 后台临时 ${formatBytes(storageSummary.adminUploadBytes || 0)}`;

      root.innerHTML = `
        <div class="dashboard-stack">
          <div class="stats">
            ${stat("课程列表", catalogCourseCount, "后台课程下拉与 catalog 口径")}
            ${stat("线上完成课", completedCourses, "已上传、manifest 可解析且有可展示内容")}
            ${stat("导入/展示缺口", displayGapCourses, `其中缺 manifest ${missingManifest} 门；有 manifest ${uploadedCourses} 门`)}
            ${stat("课程目录记录", activeDirectoryCourses, extraDirectoryCourses ? `含 ${extraDirectoryCourses} 个列表外目录` : "本地 course root 目录口径")}
          </div>

          <div class="dashboard-grid">
            <div class="dashboard-card">
              <h3>存储空间</h3>
              ${storageMeter}
              <p class="meta-line">${escapeHtml(storageDetail)}</p>
            </div>
            <div class="dashboard-card">
              <h3>课程状态</h3>
              <div class="badge-row">${hasLifecycle ? renderLifecycle(lifecycleCourses) : `<span class="badge">${escapeHtml(errors.lifecycle || "读取中")}</span>`}</div>
              <p class="meta-line">状态来自启用/归档列表；用于快速判断哪些课程已经对前台开放。</p>
            </div>
          </div>

          <div class="dashboard-card">
            <h3>完整性风险</h3>
            ${hasReadiness ? renderRiskList(readinessSummary) : renderPlaceholder(errors.readiness || "完整性摘要读取中...")}
          </div>

          <div class="dashboard-card">
            <h3>占用空间最大的课程</h3>
            ${hasStorage && !storageSummary.lightweight ? renderLargestCourses(storageCourses) : renderPlaceholder(errors.storage || (storageCache.usable ? "排行已缓存；点击“查看存储空间”查看明细。" : "点击“查看存储空间”后生成课程空间排行。"))}
          </div>

          <p class="meta-line">Updated: ${escapeHtml(storage?.generatedAt || readiness?.generatedAt || "")}</p>
        </div>
      `;
      root.hidden = false;
    }

    return {
      render,
      renderError,
      renderLoading,
      update,
    };
  }

  window.AdminDashboardPanel = {
    createPanel,
  };
})();
