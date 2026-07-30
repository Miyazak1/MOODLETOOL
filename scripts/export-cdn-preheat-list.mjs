import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");

const args = parseArgs(process.argv.slice(2));
const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "");
const objectPrefix = stripSlash(args.prefix || process.env.OSS_COURSEWARE_PREFIX || "courseware-active");
const courseFilter = new Set(args.courses);
const limit = Number(args.limit || 500);
const includeAll = args.all;
const onlyVideos = args.videos;

function parseArgs(argv) {
  const out = {
    registry: "",
    cdnBaseUrl: "",
    prefix: "",
    courses: [],
    limit: "",
    all: false,
    videos: false,
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
    else if (arg === "--all") out.all = true;
    else if (arg === "--videos") out.videos = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/export-cdn-preheat-list.mjs --course HFC3M --cdn-base-url https://cdn.moodletool.work/courseware-active
  node scripts/export-cdn-preheat-list.mjs --all --limit 2000
  node scripts/export-cdn-preheat-list.mjs --course ENG3U --videos

Options:
  --registry PATH       asset-registry.json path.
  --cdn-base-url URL    CDN asset base URL, usually https://cdn.example.com/courseware-active.
  --prefix PREFIX       OSS object prefix. Default courseware-active.
  --course CODE[,CODE]  Filter courses.
  --limit N             Maximum URLs unless --all is passed. Default 500.
  --all                 Export all matching URLs.
  --videos              Export only video URLs.`);
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

function courseFromKey(key) {
  const parts = toPosix(key).split("/");
  return parts[0] === objectPrefix ? (parts[1] || "").toUpperCase() : "";
}

function relativeKey(key) {
  const normalized = toPosix(key);
  return normalized.startsWith(`${objectPrefix}/`) ? normalized.slice(objectPrefix.length + 1) : normalized;
}

function urlForKey(key, registry) {
  if (typeof registry === "object" && registry?.cdnUrl) return registry.cdnUrl;
  if (!cdnBaseUrl) return "";
  return `${cdnBaseUrl}/${encodeObjectKey(relativeKey(key))}`;
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
  if ([".pdf", ".docx", ".pptx", ".xlsx"].includes(ext)) return 6;
  return 9;
}

function shouldInclude(key) {
  const course = courseFromKey(key);
  if (courseFilter.size && !courseFilter.has(course)) return false;
  const ext = extname(key).toLowerCase();
  if (onlyVideos) return [".mp4", ".webm"].includes(ext);
  return true;
}

function normalizeAssets(registry) {
  return (registry.assets || [])
    .map((asset) => {
      if (typeof asset === "string") return { key: toPosix(asset), source: asset };
      return { key: toPosix(asset.objectKey || ""), source: asset };
    })
    .filter((asset) => asset.key);
}

if (!existsSync(registryPath)) {
  console.error(`Missing asset registry: ${registryPath}`);
  console.error("Run: npm run sync:oss -- --course HFC3M --bucket oss://... --cdn-base-url https://... --dry-run");
  process.exit(1);
}

const registry = readJson(registryPath);
const effectiveCdnBaseUrl = cdnBaseUrl || stripSlash(registry.cdnBaseUrl || "");
if (!effectiveCdnBaseUrl) {
  console.error("Missing --cdn-base-url or COURSEWARE_ASSET_BASE_URL, and registry has no cdnBaseUrl.");
  process.exit(1);
}

const selected = normalizeAssets(registry)
  .filter((asset) => shouldInclude(asset.key))
  .map((asset) => ({
    key: asset.key,
    url: urlForKey(asset.key, asset.source).replace(/^$/, `${effectiveCdnBaseUrl}/${encodeObjectKey(relativeKey(asset.key))}`),
    course: courseFromKey(asset.key),
    priority: priorityForKey(asset.key),
  }))
  .sort((a, b) => a.priority - b.priority || a.course.localeCompare(b.course) || a.key.localeCompare(b.key));

const urls = (includeAll ? selected : selected.slice(0, Math.max(1, limit))).map((item) => item.url);
const report = {
  generatedAt: new Date().toISOString(),
  registryPath,
  cdnBaseUrl: effectiveCdnBaseUrl,
  objectPrefix,
  courseFilter: [...courseFilter],
  onlyVideos,
  exported: urls.length,
  matched: selected.length,
  urls,
};

mkdirSync(deploymentRoot, { recursive: true });
const suffix = courseFilter.size ? `-${[...courseFilter].join("-")}` : "";
const jsonPath = join(deploymentRoot, `cdn-preheat-urls${suffix}.json`);
const mdPath = join(deploymentRoot, `cdn-preheat-urls${suffix}.md`);
const txtPath = join(deploymentRoot, `cdn-preheat-urls${suffix}.txt`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(txtPath, `${urls.join("\n")}\n`, "utf8");
writeFileSync(
  mdPath,
  `# CDN Preheat URLs

Generated: ${report.generatedAt}

Registry: ${registryPath}

CDN base URL: ${effectiveCdnBaseUrl}

- Matched assets: ${selected.length}
- Exported URLs: ${urls.length}
- Course filter: ${report.courseFilter.join(", ") || "all"}
- Videos only: ${onlyVideos ? "yes" : "no"}

## URLs

${urls.map((url) => `- ${url}`).join("\n") || "- None"}
`,
  "utf8",
);

console.log(
  JSON.stringify(
    {
      exported: urls.length,
      matched: selected.length,
      txt: txtPath,
      json: jsonPath,
      markdown: mdPath,
    },
    null,
    2,
  ),
);
