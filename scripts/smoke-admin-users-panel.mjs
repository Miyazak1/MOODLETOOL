import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-users-panel.js", "utf8");

function input(value = "") {
  return { value };
}

function container() {
  return {
    hidden: true,
    innerHTML: "",
    checkedValues: [],
    querySelectorAll(selector) {
      if (selector !== "input:checked") return [];
      return this.checkedValues.map((value) => ({ value }));
    },
  };
}

const context = {
  window: {
    AdminMediaView: {
      escapeHtml(value) {
        return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      },
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-users-panel.js" });

const elements = {
  coursesContainer: container(),
  displayName: input("Teacher Old"),
  password: input("secret"),
  role: input("admin"),
  status: input("disabled"),
  table: container(),
  username: input("old"),
};
const panel = context.window.AdminUsersPanel.createPanel({
  elements,
  sortCourses: (courses) => courses.slice().sort((left, right) => left.code.localeCompare(right.code)),
});

panel.render({
  courses: [{ code: "ENG4U" }, { code: "ENG3U" }],
  users: [
    { username: "teacher<&", displayName: "Ms <Teacher>", role: "teacher", status: "active", courses: ["ENG4U"], passwordStored: "hash" },
    { username: "admin", displayName: "Admin User", role: "admin", status: "disabled", courses: ["*"], passwordStored: "" },
  ],
  usersFile: "/portal-users.json",
});
assert.match(elements.coursesContainer.innerHTML, /value="\*"/);
assert.match(elements.coursesContainer.innerHTML, /ENG3U/);
assert.match(elements.table.innerHTML, /teacher&lt;&amp;/);
assert.match(elements.table.innerHTML, /Ms &lt;Teacher>/);
assert.match(elements.table.innerHTML, /data-user-action="edit"/);
assert.match(elements.table.innerHTML, /Users file: \/portal-users\.json/);

elements.coursesContainer.checkedValues = ["ENG3U", "ENG4U"];
assert.equal(JSON.stringify(panel.selectedCourses()), JSON.stringify(["ENG3U", "ENG4U"]));
elements.coursesContainer.checkedValues = ["*", "ENG4U"];
assert.equal(JSON.stringify(panel.selectedCourses()), JSON.stringify(["*"]));

const user = panel.fillForm("admin");
assert.equal(user.username, "admin");
assert.equal(elements.username.value, "admin");
assert.equal(elements.displayName.value, "Admin User");
assert.equal(elements.password.value, "");
assert.equal(elements.role.value, "admin");
assert.equal(elements.status.value, "disabled");

elements.coursesContainer.checkedValues = ["ENG4U"];
assert.equal(JSON.stringify(panel.formData({ course: "ENG4U" })), JSON.stringify({
  course: "ENG4U",
  username: "admin",
  displayName: "Admin User",
  password: "",
  role: "admin",
  status: "disabled",
  courses: ["ENG4U"],
}));

panel.clearForm();
assert.equal(elements.username.value, "");
assert.equal(elements.displayName.value, "");
assert.equal(elements.password.value, "");
assert.equal(elements.role.value, "teacher");
assert.equal(elements.status.value, "active");

console.log("admin users panel smoke ok");
