(function () {
  function createPanel({ elements = {}, escapeHtml = window.AdminMediaView.escapeHtml } = {}) {
    function okText(ok) {
      return ok ? '<span class="status-ok">OK</span>' : '<span class="status-missing">Missing</span>';
    }

    function countText(count, expected) {
      const ok = count === expected;
      return `<span class="${ok ? "status-ok" : "status-missing"}">${escapeHtml(count)}/${escapeHtml(expected)}</span>`;
    }

    function renderStats(target, stats) {
      if (!target) return;
      target.innerHTML = stats.map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
      target.hidden = false;
    }

    function renderCourseReadiness(data = {}) {
      const summary = data.summary || {};
      renderStats(elements.readinessSummary, [
        ["Courses", data.courseCount || 0],
        ["Missing outlines", summary.missingCourseOutlines || 0],
        ["Unit gaps", summary.unitPlanGapCourses || 0],
        ["Lesson gaps", summary.lessonPlanGapCourses || 0],
        ["No iSpring", summary.ispringMissingCourses || 0],
        ["Text review", summary.textReviewCourses || 0],
      ]);
      if (!elements.readinessTable) return;

      const rows = (data.courses || [])
        .map((course) => {
          const readiness = course.readiness || {};
          return `
              <tr>
                <td><strong>${escapeHtml(course.code)}</strong></td>
                <td>${escapeHtml(course.title)}</td>
                <td>${okText(readiness.courseOutline?.ok)}</td>
                <td>${okText(readiness.introduction?.ok)}</td>
                <td>${countText(readiness.unitPlans?.count || 0, readiness.unitPlans?.expected || 0)}</td>
                <td>${countText(readiness.lessonPlans?.count || 0, readiness.lessonPlans?.expected || 0)}</td>
                <td>${readiness.ispring?.connected ? `<span class="status-ok">${escapeHtml(readiness.ispring.count)}</span>` : '<span class="status-missing">0</span>'}</td>
                <td>${readiness.texts?.needsReview?.length ? `<span class="status-missing">${escapeHtml(readiness.texts.needsReview.length)}</span>` : '<span class="status-ok">0</span>'}</td>
              </tr>
            `;
        })
        .join("");
      elements.readinessTable.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Title</th>
                  <th>Outline</th>
                  <th>Intro</th>
                  <th>Unit Plans</th>
                  <th>Lesson Plans</th>
                  <th>iSpring</th>
                  <th>Text Review</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="8">No course readiness records.</td></tr>'}</tbody>
            </table>
          </div>
        `;
      elements.readinessTable.hidden = false;
    }

    function renderContentWorkbench(data = {}) {
      if (!elements.workbenchTable) return;
      const rows = (data.rows || [])
        .slice(0, 27)
        .map(
          (row) => `
              <tr>
                <td class="nowrap"><strong>${escapeHtml(row.course)}</strong></td>
                <td>${escapeHtml(row.status)}</td>
                <td class="nowrap">${escapeHtml(row.priorityScore)}</td>
                <td class="nowrap">${escapeHtml(row.units)}</td>
                <td class="nowrap">${escapeHtml(row.lessons)}</td>
                <td>${row.missingCourseOutline ? '<span class="status-missing">Missing</span>' : '<span class="status-ok">OK</span>'}</td>
                <td>${row.iSpringMissing ? '<span class="status-missing">Missing</span>' : '<span class="status-ok">OK</span>'}</td>
                <td class="nowrap">${escapeHtml(row.previewQueue || 0)}</td>
                <td class="nowrap">${escapeHtml(row.textReviewItems || 0)}</td>
                <td>${escapeHtml((row.nextActions || [])[0] || "")}</td>
              </tr>
            `,
        )
        .join("");
      elements.workbenchTable.innerHTML = `
          <div class="stats">
            <div class="stat"><span>Courses</span><strong>${escapeHtml(data.totals?.courses || 0)}</strong></div>
            <div class="stat"><span>Missing outlines</span><strong>${escapeHtml(data.totals?.missingCourseOutlines || 0)}</strong></div>
            <div class="stat"><span>iSpring missing</span><strong>${escapeHtml(data.totals?.iSpringMissingCourses || 0)}</strong></div>
            <div class="stat"><span>Preview queue</span><strong>${escapeHtml(data.totals?.previewQueue || 0)}</strong></div>
            <div class="stat"><span>Text review</span><strong>${escapeHtml(data.totals?.textReviewItems || 0)}</strong></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Units</th>
                  <th>Lessons</th>
                  <th>Outline</th>
                  <th>iSpring</th>
                  <th>Preview</th>
                  <th>Text</th>
                  <th>Next Action</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="10">No content workbench records.</td></tr>'}</tbody>
            </table>
          </div>
        `;
      elements.workbenchTable.hidden = false;
    }

    return {
      countText,
      okText,
      renderContentWorkbench,
      renderCourseReadiness,
    };
  }

  window.AdminContentWorkbenchPanel = { createPanel };
})();
