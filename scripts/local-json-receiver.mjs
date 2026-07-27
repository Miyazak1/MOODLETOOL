import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const port = Number(process.env.LOCAL_JSON_RECEIVER_PORT || 8897);
const root = resolve(process.env.LOCAL_JSON_RECEIVER_ROOT || "inbox");

mkdirSync(root, { recursive: true });

function safeRelativePath(value) {
  const decoded = decodeURIComponent(value || "upload.json").replaceAll("\\", "/");
  const parts = decoded
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[^A-Za-z0-9_. ()-]/g, "_"));
  return parts.join("/") || "upload.json";
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") {
    res.end("ok");
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("method not allowed");
    return;
  }

  const filename = safeRelativePath(req.url.slice(1));
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const target = join(root, filename);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, filename, bytes: body.length }));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`local-json-receiver listening on http://127.0.0.1:${port}/ -> ${root}`);
});
