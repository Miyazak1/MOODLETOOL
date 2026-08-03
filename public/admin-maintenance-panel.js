(function () {
  function createPanel({ elements, escapeHtml, formatBytes }) {
    const backupList = elements.backupList;

    function renderBackupList(data) {
      const backups = data?.backups || [];
      if (!backups.length) {
        backupList.innerHTML = '<p class="meta-line">当前课程暂无覆盖备份。</p>';
        backupList.hidden = false;
        return;
      }

      const rows = backups
        .map((backup) => {
          const files =
            (backup.files || [])
              .map((file) => escapeHtml(file.path || ""))
              .filter(Boolean)
              .join("<br />") || "No files";
          return `
            <tr>
              <td><strong>${escapeHtml(backup.id || "")}</strong></td>
              <td>${formatBytes(backup.bytes || 0)}</td>
              <td>${escapeHtml(backup.path || "")}</td>
              <td>${files}</td>
            </tr>
          `;
        })
        .join("");

      backupList.innerHTML = `
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Backup</th>
                <th>Size</th>
                <th>Folder</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      backupList.hidden = false;
    }

    return {
      renderBackupList,
    };
  }

  window.AdminMaintenancePanel = {
    createPanel,
  };
})();
