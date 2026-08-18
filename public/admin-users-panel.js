(function () {
  function createPanel({ elements = {}, escapeHtml = window.AdminMediaView.escapeHtml, sortCourses } = {}) {
    let data = { users: [], courses: [] };

    function normalizeCourses(courses) {
      const list = Array.isArray(courses) ? courses : [];
      return typeof sortCourses === "function"
        ? sortCourses(list)
        : list.slice().sort((left, right) => String(left.code || "").localeCompare(String(right.code || ""), "en", { numeric: true, sensitivity: "base" }));
    }

    function renderCourseCheckboxes(selectedCourses = []) {
      if (!elements.coursesContainer) return;
      const selected = new Set(selectedCourses);
      const courses = normalizeCourses(data.courses);
      elements.coursesContainer.innerHTML = `
          <label><input type="checkbox" value="*" ${selected.has("*") ? "checked" : ""} /> 全部课程</label>
          ${courses
            .map(
              (course) =>
                `<label><input type="checkbox" value="${escapeHtml(course.code)}" ${selected.has(course.code) ? "checked" : ""} /> ${escapeHtml(course.code)}</label>`,
            )
            .join("")}
        `;
    }

    function selectedCourses() {
      if (!elements.coursesContainer) return [];
      const values = [...elements.coursesContainer.querySelectorAll("input:checked")].map((input) => input.value);
      return values.includes("*") ? ["*"] : values;
    }

    function clearForm() {
      if (elements.username) elements.username.value = "";
      if (elements.displayName) elements.displayName.value = "";
      if (elements.password) elements.password.value = "";
      if (elements.role) elements.role.value = "teacher";
      if (elements.status) elements.status.value = "active";
      renderCourseCheckboxes([]);
    }

    function fillForm(username) {
      const user = data.users.find((item) => item.username === username);
      if (!user) return null;
      if (elements.username) elements.username.value = user.username;
      if (elements.displayName) elements.displayName.value = user.displayName || "";
      if (elements.password) elements.password.value = "";
      if (elements.role) elements.role.value = user.role || "teacher";
      if (elements.status) elements.status.value = user.status || "active";
      renderCourseCheckboxes(user.courses || []);
      return user;
    }

    function formData({ course = "" } = {}) {
      return {
        course,
        username: String(elements.username?.value || "").trim(),
        displayName: String(elements.displayName?.value || "").trim(),
        password: elements.password?.value || "",
        role: elements.role?.value || "teacher",
        status: elements.status?.value || "active",
        courses: selectedCourses(),
      };
    }

    function render(nextData = {}) {
      data = {
        users: Array.isArray(nextData.users) ? nextData.users : [],
        courses: Array.isArray(nextData.courses) ? nextData.courses : [],
        usersFile: nextData.usersFile || "",
      };
      renderCourseCheckboxes(selectedCourses());
      if (!elements.table) return data;

      const rows = data.users
        .map(
          (user) => `
              <tr>
                <td><strong>${escapeHtml(user.username)}</strong></td>
                <td>${escapeHtml(user.displayName || "")}</td>
                <td>${escapeHtml(user.role)}</td>
                <td>${escapeHtml(user.status)}</td>
                <td>${escapeHtml((user.courses || []).join(", "))}</td>
                <td>${escapeHtml(user.passwordStored || "")}</td>
                <td class="nowrap"><button class="small" type="button" data-user-action="edit" data-username="${escapeHtml(user.username)}">编辑</button></td>
              </tr>
            `,
        )
        .join("");
      elements.table.innerHTML = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Display name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Courses</th>
                  <th>Password</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>${rows || '<tr><td colspan="7">No users configured.</td></tr>'}</tbody>
            </table>
          </div>
          <p class="meta-line">Users file: ${escapeHtml(data.usersFile || "")}</p>
        `;
      elements.table.hidden = false;
      return data;
    }

    function getData() {
      return data;
    }

    return {
      clearForm,
      fillForm,
      formData,
      getData,
      render,
      renderCourseCheckboxes,
      selectedCourses,
    };
  }

  window.AdminUsersPanel = { createPanel };
})();
