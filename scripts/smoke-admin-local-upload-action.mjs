import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-local-upload-action.js", "utf8");
const context = {
  URLSearchParams,
  window: {
    fetch: async () => {
      throw new Error("fetch should be injected in tests");
    },
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-local-upload-action.js" });

const mod = context.window.AdminLocalUploadAction;
const file = { name: "lesson.zip", size: 1024 };
const calls = [];
const statuses = [];
const writes = [];
const successes = [];

function makeFields(overrides = {}) {
  return {
    course: { value: "ENG3U" },
    file: { files: [file], value: "C:\\fake\\lesson.zip" },
    lesson: { value: "U01L01", disabled: false },
    textId: { value: "" },
    type: { value: "lesson-plan" },
    unit: { value: "U01" },
    ...overrides,
  };
}

function createAction(fields, fetchImpl = async (url, options) => {
  calls.push({ url, options });
  return {
    ok: true,
    status: 200,
    async json() {
      return { ok: true, backups: ["manifest"] };
    },
  };
}) {
  return mod.createAction({
    fields,
    fetchImpl,
    responseMessage(data, fallback) {
      return data?.error || data?.message || fallback;
    },
    setStatus(title, detail = "", type = "info") {
      statuses.push({ title, detail, type });
    },
    unitLessonText({ unit, lesson }) {
      return `${unit}/${lesson}`;
    },
    uploadTypeLabel(type) {
      return `label:${type}`;
    },
    write(payload) {
      writes.push(payload);
    },
    afterSuccess(data, uploadedFile) {
      successes.push({ data, uploadedFile });
    },
  });
}

assert.equal(mod.uploadUrl(makeFields(), file), "/api/admin/upload?course=ENG3U&type=lesson-plan&filename=lesson.zip&unit=U01&lesson=U01L01&textId=");

await assert.rejects(
  () => createAction(makeFields({ file: { files: [], value: "" } })).upload(),
  /请选择文件/,
);
assert.equal(statuses.at(-1).title, "请选择文件");
assert.equal(statuses.at(-1).type, "error");

await assert.rejects(
  () => createAction(makeFields({ type: { value: "ispring-zip" }, lesson: { value: "", disabled: true } })).upload(),
  /当前 Unit 没有可绑定的 Lesson/,
);

await assert.rejects(
  () => createAction(makeFields({ type: { value: "text-material" }, textId: { value: " " } })).upload(),
  /请填写 Text ID/,
);

const fields = makeFields({ textId: { value: " reading-one " } });
const data = await createAction(fields).upload();
assert.equal(data.ok, true);
assert.equal(calls.at(-1).url, "/api/admin/upload?course=ENG3U&type=lesson-plan&filename=lesson.zip&unit=U01&lesson=U01L01&textId=reading-one");
assert.equal(calls.at(-1).options.method, "POST");
assert.equal(calls.at(-1).options.credentials, "same-origin");
assert.equal(calls.at(-1).options.headers["Content-Type"], "application/octet-stream");
assert.equal(calls.at(-1).options.body, file);
assert.equal(fields.file.value, "");
assert.equal(statuses.at(-1).title, "上传完成");
assert.equal(writes[0], "Uploading lesson.zip...");
assert.equal(successes.length, 1);
assert.equal(successes[0].uploadedFile, file);

await assert.rejects(
  () => createAction(makeFields(), async () => ({
    ok: false,
    status: 500,
    async json() {
      return { ok: false, error: "disk full" };
    },
  })).upload(),
  /disk full/,
);
assert.equal(statuses.at(-1).title, "上传失败");
assert.equal(statuses.at(-1).detail, "disk full");

console.log("admin local upload action smoke ok");
