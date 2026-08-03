import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("public/admin-course-data-client.js", "utf8");
const calls = [];
const context = {
  encodeURIComponent,
  window: {
    fetch: async (url, options) => {
      calls.push({ url, options });
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

const client = context.window.AdminCourseDataClient.createClient({ fetchImpl: context.window.fetch });

await client.courseOptions();
assert.equal(calls.at(-1).url, "/admin-course-options.json");
assert.equal(calls.at(-1).options.cache, "no-store");

const manifest = await client.courseManifest("eng 3u");
assert.equal(manifest.url, "/courseware/ENG%203U/course-manifest.json");

console.log("admin course data client smoke ok");
