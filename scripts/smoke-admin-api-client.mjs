import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/admin-api-client.js", "utf8");
const calls = [];
const context = {
  URLSearchParams,
  window: {
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/admin/login") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { ok: true, username: "admin" };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, url };
        },
      };
    },
  },
};
vm.createContext(context);
vm.runInContext(source, context);

assert.equal(context.window.AdminApiClient.paramsToString({ course: "ENG3U", empty: "", limit: 30 }), "course=ENG3U&limit=30");
assert.equal(context.window.AdminApiClient.appendParams("/api/test", { q: "A B" }), "/api/test?q=A+B");
assert.equal(context.window.AdminApiClient.appendParams("/api/test?x=1", { q: "A" }), "/api/test?x=1&q=A");

const api = context.window.AdminApiClient.createClient({
  fetchImpl: context.window.fetch,
  responseMessage(data, fallback) {
    return data?.error || fallback;
  },
});

await api.status("ENG3U");
assert.equal(calls.at(-1).url, "/api/admin/status?course=ENG3U");
assert.equal(calls.at(-1).options.method, "GET");
assert.equal(calls.at(-1).options.credentials, "same-origin");

await api.saveUser({ username: "teacher" });
assert.equal(calls.at(-1).url, "/api/admin/users");
assert.equal(calls.at(-1).options.method, "POST");
assert.equal(calls.at(-1).options.headers["Content-Type"], "application/json");
assert.equal(calls.at(-1).options.body, JSON.stringify({ username: "teacher" }));

await api.deleteUser("teacher", "ENG3U");
assert.equal(calls.at(-1).url, "/api/admin/users?username=teacher&course=ENG3U");
assert.equal(calls.at(-1).options.method, "DELETE");

await api.coursePackageStatus("ENG4U", "import-1");
assert.equal(calls.at(-1).url, "/api/admin/course-package/status?course=ENG4U&importId=import-1");

await api.coursePackageCommit({ course: "ENG4U", importId: "import-1" });
assert.equal(calls.at(-1).url, "/api/admin/course-package/commit");
assert.equal(calls.at(-1).options.method, "POST");

const login = await api.login({ username: "admin", password: "secret" });
assert.equal(login.username, "admin");

console.log("admin api client smoke ok");
