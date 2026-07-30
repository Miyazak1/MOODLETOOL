import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { acquireCourseLocks } from "./lib/course-operation-locks.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const deploymentRoot = join(projectRoot, "deployment");
const defaultCoursewareRoot = join(workspaceRoot, "courseware");

const args = parseArgs(process.argv.slice(2));
const coursewareRoot = resolve(args.coursewareRoot || process.env.COURSE_ACTIVE_ROOT || defaultCoursewareRoot);
const bucket = normalizeBucket(args.bucket || process.env.OSS_BUCKET_URI || "");
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "");
const objectPrefix = stripSlash(args.prefix || process.env.OSS_COURSEWARE_PREFIX || "courseware-active");
const dryRun = !args.apply;
const includeHash = args.hash;
const limit = Number(args.limit || 0);
const requestedCourses = args.courses;
const scanAll = args.all || !requestedCourses.length;
const ossutilPath = args.ossutil || process.env.OSSUTIL_PATH || detectOssutil();

const ignoredPathParts = new Set([".git", "_admin_uploads", ".ossutil_checkpoint"]);

function parseArgs(argv) {
  const out = {
    apply: false,
    all: false,
    courses: [],
    coursewareRoot: "",
    bucket: "",
    cdnBaseUrl: "",
    prefix: "",
    hash: false,
    limit: "",
    ossutil: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--apply") {
      out.apply = true;
    } else if (arg === "--dry-run") {
      out.apply = false;
    } else if (arg === "--all") {
      out.all = true;
    } else if (arg === "--course") {
      out.courses.push(...String(argv[++i] || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
    } else if (arg === "--courseware-root") {
      out.coursewareRoot = argv[++i] || "";
    } else if (arg === "--bucket") {
      out.bucket = argv[++i] || "";
    } else if (arg === "--cdn-base-url") {
      out.cdnBaseUrl = argv[++i] || "";
    } else if (arg === "--prefix") {
      out.prefix = argv[++i] || "";
    } else if (arg === "--hash") {
      out.hash = true;
    } else if (arg === "--limit") {
      out.limit = argv[++i] || "";
    } else if (arg === "--ossutil") {
      out.ossutil = argv[++i] || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/sync-courseware-oss.mjs --all --dry-run
  node scripts/sync-courseware-oss.mjs --course HFC3M --bucket oss://moodletool-courseware --cdn-base-url https://cdn.moodletool.work/courseware-active --dry-run
  node scripts/sync-courseware-oss.mjs --course HFC3M --bucket oss://moodletool-courseware --cdn-base-url https://cdn.moodletool.work/courseware-active --apply

Options:
  --courseware-root PATH  Defaults to COURSE_ACTIVE_ROOT or ../courseware.
  --bucket URI           OSS bucket URI, for example oss://moodletool-courseware.
  --cdn-base-url URL     CDN asset base URL, usually https://cdn.example.com/courseware-active.
  --prefix PREFIX        OSS object prefix. Default courseware-active.
  --hash                 Include sha256 hashes in the registry.
  --limit N              Limit files for smoke checks.
  --ossutil PATH         ossutil executable path.`);
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeBucket(value) {
  const trimmed = stripSlash(value);
  return trimmed ? trimmed.replace(/^oss:\/(?!\/)/, "oss://") : "";
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(digits);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function availableCourses() {
  if (!existsSync(coursewareRoot)) throw new Error(`Missing courseware root: ${coursewareRoot}`);
  return readdirSync(coursewareRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(coursewareRoot, entry.name, "course-manifest.json")))
    .map((entry) => entry.name.toUpperCase())
    .sort((a, b) => a.localeCompare(b));
}

function shouldIgnore(relPath) {
  return toPosix(relPath)
    .split("/")
    .some((part) => ignoredPathParts.has(part) || part.startsWith("."));
}

function walkFiles(root, result = []) {
  if (!existsSync(root)) return result;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    const rel = relative(root, full);
    if (shouldIgnore(rel)) continue;
    if (entry.isDirectory()) walkFiles(full, result);
    else result.push(full);
  }
  return result;
}

function contentTypeFor(path) {
  const ext = extname(path).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".h5p": "application/octet-stream",
  };
  return types[ext] || "application/octet-stream";
}

function cacheControlFor(path) {
  const ext = extname(path).toLowerCase();
  if ([".html", ".htm", ".json"].includes(ext)) return "public, max-age=300";
  if ([".mp4", ".webm", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".js", ".css"].includes(ext)) {
    return "public, max-age=2592000";
  }
  return "public, max-age=604800";
}

function sha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function encodeObjectKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function cdnUrlForObjectKey(key) {
  if (!cdnBaseUrl) return "";
  const normalizedKey = toPosix(key);
  const normalizedPrefix = stripSlash(objectPrefix);
  const baseLooksPrefixed = normalizedPrefix && cdnBaseUrl.toLowerCase().endsWith(`/${normalizedPrefix.toLowerCase()}`);
  const relativeKey = baseLooksPrefixed && normalizedKey.startsWith(`${normalizedPrefix}/`)
    ? normalizedKey.slice(normalizedPrefix.length + 1)
    : normalizedKey;
  return `${cdnBaseUrl}/${encodeObjectKey(relativeKey)}`;
}

function detectOssutil() {
  for (const candidate of ["ossutil", "ossutil64"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true });
    if (!result.error) return candidate;
  }
  return "";
}

function buildItem(course, file) {
  const courseRoot = join(coursewareRoot, course);
  const relPath = toPosix(relative(courseRoot, file));
  const stat = statSync(file);
  const objectKey = `${objectPrefix}/${course}/${relPath}`;
  const contentType = contentTypeFor(file);
  const cacheControl = cacheControlFor(file);
  const ossUri = bucket ? `${bucket}/${objectKey}` : "";
  return {
    course,
    localPath: file,
    relativePath: relPath,
    objectKey,
    ossUri,
    cdnUrl: cdnUrlForObjectKey(objectKey),
    contentType,
    cacheControl,
    sizeBytes: stat.size,
    sizeMb: stat.size / 1024 / 1024,
    mtimeMs: stat.mtimeMs,
    sha256: includeHash ? sha256(file) : "",
    action: dryRun ? "dry-run" : "pending",
  };
}

function uploadItem(item) {
  if (!bucket) throw new Error("Missing --bucket or OSS_BUCKET_URI.");
  if (!ossutilPath) throw new Error("ossutil is not available. Install/configure ossutil or pass --ossutil PATH.");
  const meta = `Cache-Control:${item.cacheControl}#Content-Type:${item.contentType}`;
  const result = spawnSync(ossutilPath, ["cp", item.localPath, item.ossUri, `--meta=${meta}`], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `ossutil exited ${result.status}`).trim());
  return {
    ...item,
    action: "uploaded",
  };
}

function renderMarkdown(report) {
  const rows = report.items
    .slice(0, 300)
    .map(
      (item) =>
        `| ${item.action} | ${item.course} | ${formatNumber(item.sizeMb)} | ${escapeMarkdown(item.contentType)} | ${escapeMarkdown(item.cacheControl)} | ${escapeMarkdown(item.objectKey)} |`,
    )
    .join("\n");
  return `# OSS Courseware Sync ${report.dryRun ? "Plan" : "Report"}

Generated: ${report.generatedAt}

Courseware root: ${report.coursewareRoot}

Bucket: ${report.bucket || "(not set)"}

CDN base URL: ${report.cdnBaseUrl || "(not set)"}

Object prefix: ${report.objectPrefix}

Mode: ${report.dryRun ? "dry-run" : "apply"}

ossutil: ${report.ossutil || "(not found)"}

## Summary

| Item | Value |
| --- | ---: |
| Courses | ${report.summary.courses} |
| Files | ${report.summary.files} |
| Total size | ${formatNumber(report.summary.totalGb)} GB |
| Uploaded | ${report.summary.uploaded} |
| Failed | ${report.summary.failed} |

## First Files

Showing first 300 files.

| Action | Course | MB | Content-Type | Cache-Control | OSS Key |
| --- | --- | ---: | --- | --- | --- |
${rows || "| - | - | - | - | - | No files. |"}
`;
}

const courses = scanAll ? availableCourses() : requestedCourses;
const missing = courses.filter((course) => !existsSync(join(coursewareRoot, course, "course-manifest.json")));
if (missing.length) {
  console.error(`Missing course manifest(s): ${missing.join(", ")} in ${coursewareRoot}`);
  process.exit(1);
}

let planned = [];
for (const course of courses) {
  const courseRoot = join(coursewareRoot, course);
  const files = walkFiles(courseRoot).sort((a, b) => a.localeCompare(b));
  planned.push(...files.map((file) => buildItem(course, file)));
}
if (limit > 0) planned = planned.slice(0, limit);

const items = [];
let failed = 0;
let releaseLocks = () => {};
try {
  if (!dryRun) releaseLocks = acquireCourseLocks(courses, { operation: "sync-oss" });
  for (const item of planned) {
    if (dryRun) {
      items.push(item);
      continue;
    }
    try {
      items.push(uploadItem(item));
    } catch (error) {
      failed += 1;
      items.push({
        ...item,
        action: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
} finally {
  releaseLocks();
}

const uploaded = items.filter((item) => item.action === "uploaded").length;
const report = {
  generatedAt: new Date().toISOString(),
  dryRun,
  coursewareRoot,
  bucket,
  cdnBaseUrl,
  objectPrefix,
  ossutil: ossutilPath,
  includeHash,
  summary: {
    courses: courses.length,
    files: items.length,
    totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    totalGb: items.reduce((sum, item) => sum + item.sizeBytes, 0) / 1024 / 1024 / 1024,
    uploaded,
    failed,
  },
  items,
};

mkdirSync(deploymentRoot, { recursive: true });
const suffix = dryRun ? "plan" : "report";
const jsonPath = join(deploymentRoot, `oss-sync-${suffix}.json`);
const mdPath = join(deploymentRoot, `oss-sync-${suffix}.md`);
const registryPath = join(deploymentRoot, "asset-registry.json");
writeJson(jsonPath, report);
writeFileSync(mdPath, renderMarkdown(report), "utf8");
writeJson(registryPath, {
  generatedAt: report.generatedAt,
  coursewareRoot,
  bucket,
  cdnBaseUrl,
  objectPrefix,
  assetCount: items.length,
  assets: items.map((item) => item.objectKey),
});

console.log(
  JSON.stringify(
    {
      dryRun,
      courses: report.summary.courses,
      files: report.summary.files,
      totalGb: Number(report.summary.totalGb.toFixed(2)),
      uploaded,
      failed,
      json: jsonPath,
      markdown: mdPath,
      registry: registryPath,
    },
    null,
    2,
  ),
);

if (failed) process.exit(1);
