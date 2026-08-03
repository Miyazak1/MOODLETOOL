(function () {
  function createPanel({ elements = {}, escapeHtml = window.AdminMediaView.escapeHtml, formatBytes, percentUsed } = {}) {
    function bytes(value) {
      return typeof formatBytes === "function" ? formatBytes(value || 0) : `${value || 0} B`;
    }

    function percent(used, total) {
      return typeof percentUsed === "function" ? percentUsed(used || 0, total || 0) : 0;
    }

    function card(label, value, ok) {
      return `<div class="readiness-card ${ok ? "ok" : "warn-card"}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    }

    function shortList(items, formatter, emptyText) {
      if (!items.length) return `<li>${escapeHtml(emptyText)}</li>`;
      return items.slice(0, 8).map((item) => `<li>${escapeHtml(formatter(item))}</li>`).join("");
    }

    function renderStatusStats(data = {}) {
      if (!elements.statusStats) return;
      const disk = data.storage?.disk;
      const stats = [
        ["Units", data.units],
        ["Lessons", data.lessons],
        ["Courseware", bytes(data.storage?.coursewareBytes || 0)],
        ["Admin uploads", bytes(data.storage?.adminUploadBytes || 0)],
      ];
      if (disk) {
        stats.push(["Disk used", `${bytes(disk.usedBytes || 0)} (${percent(disk.usedBytes || 0, disk.totalBytes || 0)}%)`]);
        stats.push(["Disk free", bytes(disk.freeBytes)]);
        stats.push(["Disk total", bytes(disk.totalBytes)]);
      }
      elements.statusStats.innerHTML = stats
        .map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
        .join("");
      elements.statusStats.hidden = false;
    }

    function renderReadiness(data = {}) {
      if (!elements.readiness) return;
      const readiness = data.readiness;
      if (!readiness) {
        elements.readiness.hidden = true;
        return;
      }
      const unitMissing = readiness.unitPlans?.missing || [];
      const lessonMissing = readiness.lessonPlans?.missing || [];
      const textReview = readiness.texts?.needsReview || [];
      const missingDownloads = readiness.texts?.missingDownloads || [];
      elements.readiness.innerHTML = `
          <div class="readiness-grid">
            ${card("Course Outline", readiness.courseOutline?.ok ? "OK" : "Missing", readiness.courseOutline?.ok)}
            ${card("Introduction", readiness.introduction?.ok ? "OK" : "Missing", readiness.introduction?.ok)}
            ${card("Unit Plans", `${readiness.unitPlans?.count || 0}/${readiness.unitPlans?.expected || 0}`, unitMissing.length === 0)}
            ${card("Lesson Plans", `${readiness.lessonPlans?.count || 0}/${readiness.lessonPlans?.expected || 0}`, lessonMissing.length === 0)}
            ${card("iSpring", readiness.ispring?.connected ? `${readiness.ispring.count} connected` : "Not connected", readiness.ispring?.connected)}
            ${card("Missing Text Downloads", missingDownloads.length ? `${missingDownloads.length} item(s)` : "OK", missingDownloads.length === 0)}
          </div>
          <ul class="gap-list">
            ${shortList(unitMissing, (item) => `Missing unit plan: Unit ${item.unit} · ${item.title}`, "No missing unit plans.")}
            ${shortList(lessonMissing, (item) => `Missing lesson plan: ${item.id} · ${item.title}`, "No missing lesson plans.")}
            ${shortList(missingDownloads, (item) => `Missing text download: ${item.title} · ${item.author}`, "No missing text downloads.")}
            ${shortList(textReview, (item) => `Text needs review: ${item.title} · ${item.author}`, "No text review items.")}
          </ul>
        `;
      elements.readiness.hidden = false;
    }

    return {
      renderReadiness,
      renderStatusStats,
    };
  }

  window.AdminReadinessPanel = { createPanel };
})();
