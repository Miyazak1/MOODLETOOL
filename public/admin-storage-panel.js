(function () {
  function createPanel({
    elements = {},
    escapeHtml = window.AdminMediaView.escapeHtml,
    formatBytes = window.AdminMediaView.formatBytes,
  } = {}) {
    function percentUsed(used, total) {
      if (!total) return 0;
      return Math.max(0, Math.min(100, Math.round((Number(used || 0) / Number(total || 1)) * 100)));
    }

    function meterHtml(label, used, total) {
      const percent = percentUsed(used, total);
      const fillClass = percent >= 90 ? "danger-fill" : percent >= 75 ? "warn-fill" : "";
      return `
          <div class="meter">
            <div class="meter-head">
              <span>${escapeHtml(label)}</span>
              <span>${formatBytes(used)} / ${formatBytes(total)} · ${percent}%</span>
            </div>
            <div class="meter-track"><div class="meter-fill ${fillClass}" style="width:${percent}%"></div></div>
          </div>
        `;
    }

    function renderMini(target, data, label = "数据盘") {
      if (!target || !data?.disk) return;
      target.innerHTML = `
          <div class="stat">
            ${meterHtml(label, data.disk.usedBytes || 0, data.disk.totalBytes || 0)}
            <p class="meta-line">可用 ${formatBytes(data.disk.freeBytes || 0)} · 课程目录 ${formatBytes(data.summary?.activeRootBytes || 0)} · 后台临时 ${formatBytes(data.summary?.adminUploadBytes || 0)}</p>
          </div>
        `;
      target.hidden = false;
    }

    function renderOverview(data = {}) {
      const disk = data.disk || {};
      if (elements.summary) {
        elements.summary.innerHTML = `
          <div class="stats">
            <div class="stat">${meterHtml("数据盘", disk.usedBytes || 0, disk.totalBytes || 0)}</div>
            <div class="stat"><span>剩余空间</span><strong>${formatBytes(disk.freeBytes || 0)}</strong></div>
            <div class="stat"><span>Active 课程目录</span><strong>${formatBytes(data.summary?.activeRootBytes || 0)}</strong></div>
            <div class="stat"><span>后台临时文件</span><strong>${formatBytes(data.summary?.adminUploadBytes || 0)}</strong></div>
            <div class="stat"><span>Archive 目录</span><strong>${formatBytes(data.summary?.archiveRootBytes || 0)}</strong></div>
          </div>
          <p class="meta-line">Active root: ${escapeHtml(data.activeRoot || "")}<br />Archive root: ${escapeHtml(data.archiveRoot || "")}<br />Updated: ${escapeHtml(data.generatedAt || "")}</p>
        `;
        elements.summary.hidden = false;
      }

      renderMini(elements.uploadMini, data);
      renderMini(elements.packageMini, data, "导入可用空间");

      if (!elements.courseTable) return;
      const rows = (data.courses || [])
        .map(
          (course) => `
              <tr>
                <td><strong>${escapeHtml(course.course)}</strong></td>
                <td>${escapeHtml(course.title || "")}</td>
                <td>${escapeHtml(course.status || "")}</td>
                <td class="nowrap">${formatBytes(course.activeBytes || 0)}</td>
                <td class="nowrap">${formatBytes(course.adminUploadBytes || 0)}</td>
                <td class="nowrap">${formatBytes(course.archiveBytes || 0)}</td>
                <td class="nowrap"><strong>${formatBytes(course.totalBytes || 0)}</strong></td>
              </tr>
            `,
        )
        .join("");
      elements.courseTable.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Active</th>
                  <th>Admin temp</th>
                  <th>Archive</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="7">No course storage found.</td></tr>'}</tbody>
            </table>
          </div>
        `;
      elements.courseTable.hidden = false;
    }

    return {
      meterHtml,
      percentUsed,
      renderMini,
      renderOverview,
    };
  }

  window.AdminStoragePanel = {
    createPanel,
  };
})();
