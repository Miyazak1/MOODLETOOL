import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");

const args = parseArgs(process.argv.slice(2));
const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "");
const objectPrefix = stripSlash(args.prefix || process.env.OSS_COURSEWARE_PREFIX || "courseware-active");
const courseFilter = new Set(args.courses);
const limit = Number(args.limit || 20);
const timeoutMs = Number(args.timeoutMs || 10000);

function parseArgs(argv) {
  const out = {
    registry: "",
    cdnBaseUrl: "",
    prefix: "",
    courses: [],
    limit: "",
    timeoutMs: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--registry") out.registry = argv[++i] || "";
    else if (arg === "--cdn-base-url") out.cdnBaseUrl = argv[++i] || "";
    else if (arg === "--prefix") out.prefix = argv[++i] || "";
    else if (arg === "--course") out.courses.push(...String(argv[++i] || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
    else if (arg === "--limit") out.limit = argv[++i] || "";
    else if (arg === "--timeout-ms") out.timeoutMs = argv[++i] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/smoke-cdn-published.mjs --course HFC3M --cdn-base-url https://cdn.moodletool.work/courseware-active
  node scripts/smoke-cdn-published.mjs --course HFC3M --limit 50

Options:
  --registry PATH       asset-registry.json path.
  --cdn-base-url URL    CDN asset base URL, usually https://cdn.example.com/courseware-active.
  --prefix PREFIX       OSS object prefix. Default courseware-active.
  --course CODE[,CODE]  Filter courses.
  --limit N             Maximum URLs to test. Default 20.
  --timeout-ms N        Per request timeout. Default 10000.`);
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function encodeObjectKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function relativeKey(key) {
  const normalized = toPosix(key);
  return normalized.startsWith(`${objectPrefix}/`) ? normalized.slice(objectPrefix.length + 1) : normalized;
}

function courseFromKey(key) {
  const parts = toPosix(key).split("/");
  return parts[0] === objectPrefix ? (parts[1] || "").toUpperCase() : "";
}

function urlForAsset(asset, effectiveCdnBaseUrl) {
  if (typeof asset === "object" && asset?.cdnUrl) return asset.cdnUrl;
  const key = typeof asset === "string" ? asset : asset.objectKey;
  return `${effectiveCdnBaseUrl}/${encodeObjectKey(relativeKey(key))}`;
}

function keyForAsset(asset) {
  return toPosix(typeof asset === "string" ? asset : asset.objectKey || "");
}

function priorityForKey(key) {
  const lower = key.toLowerCase();
  const ext = extname(lower);
  if (lower.endsWith("/course-manifest.json")) return 0;
  if (lower.endsWith("/presentation.html")) return 1;
  if (lower.endsWith("/index.html")) return 2;
  if ([".js", ".css"].includes(ext)) return 3;
  if ([".mp4", ".webm"].includes(ext)) return 4;
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"].includes(ext)) return 5;
  return 9;
}

function isVideo(key) {
  return [".mp4", ".webm"].includes(extname(key).toLowerCase());
}

async function requestWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkAsset(item) {
  const headers = isVideo(item.key) ? { Range: "bytes=0-1023" } : {};
  const method = isVideo(item.key) ? "GET" : "HEAD";
  const response = await requestWithTimeout(item.url, { method, headers });
  const contentType = response.headers.get("content-type") || "";
  const contentRange = response.headers.get("content-range") || "";
  const acceptRanges = response.headers.get("accept-ranges") || "";
  const ok = isVideo(item.key) ? [200, 206].includes(response.status) : response.status >= 200 && response.status < 400;
  const rangeOk = isVideo(item.key) ? response.status === 206 || Boolean(contentRange) || /bytes/i.test(acceptRanges) : true;
  if (response.body) await response.arrayBuffer();
  return {
    ...item,
    status: response.status,
    ok: ok && rangeOk,
    contentType,
    contentRange,
    acceptRanges,
    rangeOk,
  };
}

if (!existsSync(registryPath)) {
  console.error(`Missing asset registry: ${registryPath}`);
  process.exit(1);
}

const registry = readJson(registryPath);
const effectiveCdnBaseUrl = cdnBaseUrl || stripSlash(registry.cdnBaseUrl || "");
if (!effectiveCdnBaseUrl) {
  console.error("Missing --cdn-base-url or COURSEWARE_ASSET_BASE_URL, and registry has no cdnBaseUrl.");
  process.exit(1);
}

const candidates = (registry.assets || [])
  .map((asset) => ({ asset, key: keyForAsset(asset) }))
  .filter((item) => item.key)
  .filter((item) => !courseFilter.size || courseFilter.has(courseFromKey(item.key)))
  .map((item) => ({
    key: item.key,
    course: courseFromKey(item.key),
    url: urlForAsset(item.asset, effectiveCdnBaseUrl),
    priority: priorityForKey(item.key),
  }))
  .sort((a, b) => a.priority - b.priority || a.course.localeCompare(b.course) || a.key.localeCompare(b.key))
  .slice(0, Math.max(1, limit));

if (!candidates.length) {
  console.error("No CDN assets matched the requested filters.");
  process.exit(1);
}

const results = [];
let failed = false;
for (const item of candidates) {
  try {
    const result = await checkAsset(item);
    results.push(result);
    const marker = result.ok ? "OK" : "FAIL";
    console.log(`${marker} ${result.status} ${result.course} ${result.key} ${result.contentType}`);
    if (!result.ok) failed = true;
  } catch (error) {
    failed = true;
    results.push({ ...item, ok: false, error: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL 0 ${item.course} ${item.key} ${error instanceof Error ? error.message : String(error)}`);
  }
}

const summary = {
  checked: results.length,
  ok: results.filter((item) => item.ok).length,
  failed: results.filter((item) => !item.ok).length,
};

console.log(JSON.stringify(summary, null, 2));
if (failed) process.exit(1);
