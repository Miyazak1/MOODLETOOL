import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/admin-upload-transport.js", "utf8");
const requests = [];
const queue = [];

class FakeUpload {
  constructor() {
    this.listeners = {};
  }
  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }
  emit(name, event) {
    this.listeners[name]?.(event);
  }
}

class FakeXHR {
  constructor() {
    this.listeners = {};
    this.upload = new FakeUpload();
    this.headers = {};
    this.status = 0;
    this.responseText = "";
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(key, value) {
    this.headers[key] = value;
  }
  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }
  send(body) {
    requests.push({ method: this.method, url: this.url, headers: this.headers, body, withCredentials: this.withCredentials, timeout: this.timeout });
    const next = queue.shift() || { status: 200, body: { ok: true } };
    this.upload.emit("progress", { lengthComputable: true, loaded: next.loaded ?? 10, total: next.total ?? 20 });
    if (next.error) {
      this.listeners.error?.();
      return;
    }
    if (next.abort) {
      this.listeners.abort?.();
      return;
    }
    this.status = next.status;
    this.responseText = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    this.listeners.load?.();
  }
}

const context = {
  setTimeout,
  window: {
    XMLHttpRequest: FakeXHR,
  },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: "public/admin-upload-transport.js" });

const transport = context.window.AdminUploadTransport.createTransport({
  XMLHttpRequestImpl: FakeXHR,
  chunkMaxRetries: 3,
  retryDelay: () => 0,
  sleepImpl: async () => {},
});

const progress = [];
queue.push({ status: 200, body: { ok: true, complete: false }, loaded: 64, total: 128 });
const data = await transport.uploadBinaryWithProgress("/chunk/1", { part: 1 }, (loaded, total) => progress.push([loaded, total]));
assert.equal(data.ok, true);
assert.deepEqual(progress, [[64, 128]]);
assert.equal(requests.at(-1).method, "POST");
assert.equal(requests.at(-1).withCredentials, true);
assert.equal(requests.at(-1).timeout, 0);
assert.equal(requests.at(-1).headers["Content-Type"], "application/octet-stream");

queue.push({ status: 403, body: { error: "forbidden" } });
await assert.rejects(
  () => transport.uploadBinaryWithProgress("/chunk/2", { part: 2 }),
  /forbidden/,
);

const retries = [];
queue.push({ error: true }, { status: 200, body: { ok: true, complete: true } });
const retryData = await transport.uploadWithRetry({
  url: "/chunk/3",
  blob: { part: 3 },
  onRetry: (attempt, error) => retries.push([attempt, error.message]),
});
assert.equal(retryData.complete, true);
assert.equal(retries.length, 1);
assert.equal(retries[0][0], 1);
assert.match(retries[0][1], /上传连接失败/);

queue.push({ abort: true }, { status: 500, body: { error: "server failed" } }, { body: "not-json" });
await assert.rejects(
  () => transport.uploadWithRetry({ url: "/chunk/4", blob: { part: 4 } }),
  /not-json|server failed|上传已取消/,
);

console.log("admin upload transport smoke ok");
