(function () {
  function createPanel({ elements = {}, escapeHtml = window.AdminMediaView.escapeHtml, uploadTypeLabel, unitLessonText } = {}) {
    let data = null;
    let directItems = [];

    function typeLabel(type) {
      return typeof uploadTypeLabel === "function" ? uploadTypeLabel(type) : type;
    }

    function unitText(item) {
      return typeof unitLessonText === "function" ? unitLessonText(item) : "";
    }

    function taskCard(item, index) {
      return `
          <div class="task-card">
            <div>
              <strong>${escapeHtml(typeLabel(item.uploadType))}</strong>
              <div class="task-meta">
                <span class="chip">${escapeHtml(item.course)}</span>
                <span>${escapeHtml(unitText(item))}</span>
                <span class="filename">${escapeHtml(item.suggestedFilename || "")}</span>
              </div>
              ${item.note ? `<p class="meta-line">${escapeHtml(item.note)}</p>` : ""}
            </div>
            <button class="small" type="button" data-gap-action="fill" data-gap-index="${index}">填入表单</button>
          </div>
        `;
    }

    function renderCurrentCourseTasks(course) {
      if (!elements.courseTasks) return;
      if (!data) {
        elements.courseTasks.hidden = true;
        return;
      }
      const direct = directItems.map((item, index) => ({ item, index })).filter(({ item }) => item.course === course);
      const reviews = (data.reviewItems || []).filter((item) => item.course === course);
      const external = (data.externalItems || []).filter((item) => item.course === course);

      if (!direct.length && !reviews.length && !external.length) {
        elements.courseTasks.innerHTML = '<p class="meta-line">当前课程没有待上传文件。若要补 iSpring，请先确认是否有对应 ZIP 包。</p>';
        elements.courseTasks.hidden = false;
        return;
      }

      const directHtml = direct.map(({ item, index }) => taskCard(item, index)).join("");
      const reviewHtml = reviews
        .map((item) => `<li>${escapeHtml(item.textTitle)} · ${escapeHtml(item.author)}${item.note ? `：${escapeHtml(item.note)}` : ""}</li>`)
        .join("");
      const externalHtml = external
        .map((item) => `<li>${escapeHtml(typeLabel(item.uploadType))}：${item.connectedCount || 0}/${item.lessonCount || 0} connected. ${escapeHtml(item.note || "")}</li>`)
        .join("");

      elements.courseTasks.innerHTML = `
          <h3>当前课程待处理</h3>
          ${directHtml ? `<div class="task-list">${directHtml}</div>` : '<p class="meta-line">当前课程没有直接待上传文件。</p>'}
          ${reviewHtml ? `<ul class="gap-list">${reviewHtml}</ul>` : ""}
          ${externalHtml ? `<ul class="gap-list">${externalHtml}</ul>` : ""}
        `;
      elements.courseTasks.hidden = false;
    }

    function renderTable() {
      if (!elements.table || !data) return;
      const directRows = directItems
        .map(
          (item, index) => `
              <tr>
                <td class="nowrap"><strong>${escapeHtml(item.course)}</strong></td>
                <td>${escapeHtml(typeLabel(item.uploadType))}</td>
                <td class="nowrap">${escapeHtml(item.unit || "")}</td>
                <td class="nowrap">${escapeHtml(item.lesson || "")}</td>
                <td class="filename">${escapeHtml(item.suggestedFilename || "")}</td>
                <td>${escapeHtml(item.note || "")}</td>
                <td><button class="small" type="button" data-gap-action="fill" data-gap-index="${index}">填入表单</button></td>
              </tr>
            `,
        )
        .join("");
      const reviewRows = (data.reviewItems || [])
        .map(
          (item) => `
              <tr>
                <td class="nowrap"><strong>${escapeHtml(item.course)}</strong></td>
                <td class="nowrap">${escapeHtml(item.textId || "")}</td>
                <td>${escapeHtml(item.textTitle)}</td>
                <td>${escapeHtml(item.author)}</td>
                <td class="filename">${escapeHtml(item.suggestedFilename || "")}</td>
                <td>${escapeHtml(item.note || "")}</td>
              </tr>
            `,
        )
        .join("");
      const externalRows = (data.externalItems || [])
        .map(
          (item) => `
              <tr>
                <td class="nowrap"><strong>${escapeHtml(item.course)}</strong></td>
                <td>${escapeHtml(typeLabel(item.uploadType))}</td>
                <td class="nowrap">${escapeHtml(item.lessonCount)}</td>
                <td class="nowrap">${escapeHtml(item.connectedCount)}</td>
                <td>${escapeHtml(item.note || "")}</td>
              </tr>
            `,
        )
        .join("");

      elements.table.innerHTML = `
          <div class="stats">
            <div class="stat"><span>Direct uploads</span><strong>${escapeHtml(data.summary?.directUploads || 0)}</strong></div>
            <div class="stat"><span>Text reviews</span><strong>${escapeHtml(data.summary?.textReviews || 0)}</strong></div>
            <div class="stat"><span>iSpring decisions</span><strong>${escapeHtml(data.summary?.externalDecisions || 0)}</strong></div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Upload Type</th>
                  <th>Unit</th>
                  <th>Lesson</th>
                  <th>Suggested Filename</th>
                  <th>Note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>${directRows || '<tr><td colspan="7">No direct uploads pending.</td></tr>'}</tbody>
            </table>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Text ID</th>
                  <th>Text</th>
                  <th>Author</th>
                  <th>Suggested Filename</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>${reviewRows || '<tr><td colspan="6">No text review items.</td></tr>'}</tbody>
            </table>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Upload Type</th>
                  <th>Lessons</th>
                  <th>Connected</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>${externalRows || '<tr><td colspan="5">No external iSpring decisions.</td></tr>'}</tbody>
            </table>
          </div>
        `;
      elements.table.hidden = false;
    }

    function render(nextData = {}, { currentCourse = "" } = {}) {
      data = nextData;
      directItems = [...(data.uploadItems || []), ...(data.reviewItems || [])];
      renderCurrentCourseTasks(currentCourse);
      renderTable();
      return { data, directItems };
    }

    function itemAt(index) {
      return directItems[Number(index)] || null;
    }

    return {
      itemAt,
      render,
      renderCurrentCourseTasks,
    };
  }

  window.AdminUploadGapPanel = { createPanel };
})();
