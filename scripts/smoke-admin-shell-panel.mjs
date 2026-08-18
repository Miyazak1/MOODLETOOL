import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/admin-shell-panel.js", "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

function classList(initial = []) {
  const values = new Set(initial);
  return {
    contains(name) {
      return values.has(name);
    },
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
    },
    has(name) {
      return values.has(name);
    },
  };
}

function element(dataset = {}, classes = []) {
  return {
    classList: classList(classes),
    dataset,
    disabled: false,
    hidden: false,
    href: "",
    innerHTML: "",
    textContent: "",
    title: "",
  };
}

const navButton = element({ adminNav: "course", authRequired: "1" });
const loginPanel = element({ adminPanel: "login" });
const coursePanel = element({ adminPanel: "course" }, ["auth-required"]);
const link = element();
const sidebarCode = element();
const sidebarTitle = element();
const contextCode = element();
const contextTitle = element();
const contextNote = element();
const topAuthStatus = element();
const sidebarSessionStatus = element();
const adminSessionStatus = element();
const loginForm = element();
const courseContextBar = element();

const panel = context.window.AdminShellPanel.createPanel({
  elements: {
    adminNavButtons: [navButton],
    adminPanels: [loginPanel, coursePanel],
    adminSessionStatus,
    courseContextBar,
    courseNavigationLinks: [link],
    contextCourseCode: contextCode,
    contextCourseNote: contextNote,
    contextCourseTitle: contextTitle,
    loginForm,
    sidebarCourseCode: sidebarCode,
    sidebarCourseTitle: sidebarTitle,
    sidebarSessionStatus,
    topAuthStatus,
  },
  escapeHtml(value) {
    return String(value).replaceAll("<", "&lt;");
  },
});

const courseAccess = panel.panelAccess("course");
assert.equal(courseAccess.exists, true);
assert.equal(courseAccess.requiresAuth, true);
const missingAccess = panel.panelAccess("missing");
assert.equal(missingAccess.exists, false);
assert.equal(missingAccess.requiresAuth, false);

panel.renderCourseNavigation({ code: "ENG4U", href: "/?course=ENG4U", title: "English" });
assert.equal(link.href, "/?course=ENG4U");
assert.equal(link.title, "打开前台课程 ENG4U");
assert.equal(sidebarCode.textContent, "ENG4U");
assert.equal(contextTitle.textContent, "English");
assert.match(contextNote.textContent, /ENG4U 是当前课程/);

panel.renderAuthState({ authenticated: true, session: { username: "admin<script>", displayName: "Admin User", authSource: "env" } });
assert.equal(topAuthStatus.textContent, "已登录：Admin User · admin<script>");
assert.equal(topAuthStatus.classList.has("signed-out"), false);
assert.match(sidebarSessionStatus.innerHTML, /Admin User · admin&lt;script>/);
assert.equal(loginForm.hidden, true);
assert.equal(courseContextBar.hidden, false);

panel.renderAdminPanels({ authenticated: false, activePanel: "course" });
assert.equal(coursePanel.hidden, true);
assert.equal(navButton.disabled, true);

panel.renderAdminPanels({ authenticated: true, activePanel: "course" });
assert.equal(coursePanel.hidden, false);
assert.equal(navButton.disabled, false);
assert.equal(navButton.classList.has("active"), true);

console.log("admin shell panel smoke ok");
