(function () {
  function createPanel({ elements, escapeHtml }) {
    const {
      adminNavButtons,
      adminPanels,
      adminSessionStatus,
      courseContextBar,
      courseNavigationLinks,
      contextCourseCode,
      contextCourseNote,
      contextCourseTitle,
      loginForm,
      sidebarCourseCode,
      sidebarCourseTitle,
      sidebarSessionStatus,
      topAuthStatus,
    } = elements;

    function panelAccess(panelName) {
      const target = adminPanels.find((panel) => panel.dataset.adminPanel === panelName);
      return {
        exists: Boolean(target),
        requiresAuth: Boolean(target?.classList?.contains("auth-required")),
      };
    }

    function renderCourseNavigation({ code, href, title }) {
      courseNavigationLinks.forEach((link) => {
        if (!link) return;
        link.href = href;
        link.title = `打开前台课程 ${code}`;
      });
      if (sidebarCourseCode) sidebarCourseCode.textContent = code;
      if (sidebarCourseTitle) sidebarCourseTitle.textContent = title;
      if (contextCourseCode) contextCourseCode.textContent = code;
      if (contextCourseTitle) contextCourseTitle.textContent = title;
      if (contextCourseNote) {
        contextCourseNote.textContent = `${code} 是当前课程。上传、整课导入、归档和当前课程维护都会作用于这门课。`;
      }
    }

    function renderAuthState({ authenticated, session }) {
      const username = session?.username || "admin";
      if (topAuthStatus) {
        topAuthStatus.textContent = authenticated ? `已登录：${username}` : "未登录";
        topAuthStatus.classList.toggle("signed-out", !authenticated);
      }
      if (sidebarSessionStatus) {
        sidebarSessionStatus.innerHTML = authenticated
          ? `<span>登录状态</span><strong>已登录 · ${escapeHtml(username)}</strong>`
          : "<span>登录状态</span><strong>未登录</strong>";
      }
      if (adminSessionStatus) {
        adminSessionStatus.classList.toggle("signed-out", !authenticated);
        adminSessionStatus.innerHTML = authenticated
          ? `
            <strong>已登录</strong>
            <span>当前管理员：${escapeHtml(username)}${session?.authSource ? ` · ${escapeHtml(session.authSource)}` : ""}。左侧功能已解锁，可以继续上传、导入、管理课程。</span>
          `
          : `
            <strong>未登录</strong>
            <span>请输入管理员账号。登录后会开放左侧所有后台功能。</span>
          `;
      }
      if (loginForm) loginForm.hidden = authenticated;
      if (courseContextBar) courseContextBar.hidden = !authenticated;
    }

    function renderAdminPanels({ authenticated, activePanel }) {
      adminPanels.forEach((panel) => {
        const requiresAuth = panel.classList.contains("auth-required");
        panel.hidden = panel.dataset.adminPanel !== activePanel || (requiresAuth && !authenticated);
      });
      adminNavButtons.forEach((button) => {
        const requiresAuth = button.dataset.authRequired === "1";
        button.disabled = requiresAuth && !authenticated;
        button.classList.toggle("active", button.dataset.adminNav === activePanel);
      });
    }

    return {
      panelAccess,
      renderAdminPanels,
      renderAuthState,
      renderCourseNavigation,
    };
  }

  window.AdminShellPanel = {
    createPanel,
  };
})();
