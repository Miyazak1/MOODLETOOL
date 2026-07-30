import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");

const args = parseArgs(process.argv.slice(2));
const course = String(args.course || "").trim().toUpperCase();
const auditPath = resolve(args.audit || join(deploymentRoot, "video-bitrate-audit.json"));
const optimizePlanPath = resolve(args.optimizePlan || join(deploymentRoot, "video-optimization-plan.json"));
const registryPath = resolve(args.registry || process.env.COURSEWARE_ASSET_REGISTRY_FILE || join(deploymentRoot, "asset-registry.json"));
const preheatPath = resolve(args.preheat || (course ? join(deploymentRoot, `cdn-preheat-urls-${course}.txt`) : join(deploymentRoot, "cdn-preheat-urls.txt")));
const bucket = args.bucket || process.env.OSS_BUCKET_URI || "";
const cdnBaseUrl = stripSlash(args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "");
const assetMode = String(args.assetMode || process.env.COURSEWARE_ASSET_MODE || "").toLowerCase();
const ffmpegPath = args.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = args.ffprobe || process.env.FFPROBE_PATH || "ffprobe";
const ossutilPath = args.ossutil || process.env.OSSUTIL_PATH || detectOssutil();
const requireOss = args.requireOss;
const jsonMode = args.json;

function parseArgs(argv) {
  const out = {
    course: "",
    audit: "",
    optimizePlan: "",
    registry: "",
    preheat: "",
    bucket: "",
    cdnBaseUrl: "",
    assetMode: "",
    ffmpeg: "",
    ffprobe: "",
    ossutil: "",
    requireOss: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--course") out.course = argv[++i] || "";
    else if (arg === "--audit") out.audit = argv[++i] || "";
    else if (arg === "--optimize-plan") out.optimizePlan = argv[++i] || "";
    else if (arg === "--registry") out.registry = argv[++i] || "";
    else if (arg === "--preheat") out.preheat = argv[++i] || "";
    else if (arg === "--bucket") out.bucket = argv[++i] || "";
    else if (arg === "--cdn-base-url") out.cdnBaseUrl = argv[++i] || "";
    else if (arg === "--asset-mode") out.assetMode = argv[++i] || "";
    else if (arg === "--ffmpeg") out.ffmpeg = argv[++i] || "";
    else if (arg === "--ffprobe") out.ffprobe = argv[++i] || "";
    else if (arg === "--ossutil") out.ossutil = argv[++i] || "";
    else if (arg === "--require-oss") out.requireOss = true;
    else if (arg === "--json") out.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/check-media-delivery-readiness.mjs --course HFC3M
  node scripts/check-media-delivery-readiness.mjs --course HFC3M --bucket oss://moodletool-courseware --cdn-base-url https://cdn.moodletool.work/courseware-active --require-oss

Options:
  --course CODE          Course to focus on.
  --audit PATH           Video audit report path.
  --optimize-plan PATH   Video optimization plan path.
  --registry PATH        asset-registry.json path.
  --preheat PATH         CDN preheat URL txt path.
  --bucket URI           OSS bucket URI or OSS_BUCKET_URI env.
  --cdn-base-url URL     CDN asset base URL.
  --asset-mode MODE      local, hybrid, or cdn.
  --ffmpeg PATH          ffmpeg executable path.
  --ffprobe PATH         ffprobe executable path.
  --ossutil PATH         ossutil executable path.
  --require-oss          Treat missing OSS/CDN settings as blockers.
  --json                 Output JSON.`);
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function commandAvailable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.error) return { ok: false, error: result.error.message };
  return { ok: result.status === 0, output: (result.stdout || result.stderr || "").split(/\r?\n/)[0] || "" };
}

function detectOssutil() {
  for (const candidate of ["ossutil", "ossutil64"]) {
    const result = commandAvailable(candidate);
    if (result.ok) return candidate;
  }
  return "";
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function countPreheatUrls(path) {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim()).length;
}

function videoAuditSummary() {
  if (!existsSync(auditPath)) return { exists: false };
  const audit = readJson(auditPath);
  const courses = audit.courses || [];
  const scoped = course ? courses.filter((item) => String(item.course || "").toUpperCase() === course) : courses;
  const videos = scoped.flatMap((item) => item.videos || []);
  return {
    exists: true,
    path: auditPath,
    courses: scoped.length,
    files: videos.length,
    mustOptimize: videos.filter((item) => item.status === "must-optimize").length,
    shouldOptimize: videos.filter((item) => item.status === "should-optimize").length,
    watch: videos.filter((item) => item.status === "watch").length,
    probeErrors: videos.filter((item) => item.status === "probe-error").length,
  };
}

function optimizationPlanSummary() {
  if (!existsSync(optimizePlanPath)) return { exists: false };
  const plan = readJson(optimizePlanPath);
  const items = course ? (plan.items || []).filter((item) => String(item.course || "").toUpperCase() === course) : plan.items || [];
  return {
    exists: true,
    path: optimizePlanPath,
    files: items.length,
    originalMb: items.reduce((sum, item) => sum + (item.originalSizeBytes || 0), 0) / 1024 / 1024,
  };
}

function registrySummary() {
  if (!existsSync(registryPath)) return { exists: false };
  const registry = readJson(registryPath);
  const assets = registry.assets || [];
  const filtered = course
    ? assets.filter((asset) => {
        const key = typeof asset === "string" ? asset : asset.objectKey || "";
        return key.split("/")[1]?.toUpperCase() === course;
      })
    : assets;
  return {
    exists: true,
    path: registryPath,
    bytes: statSync(registryPath).size,
    size: formatBytes(statSync(registryPath).size),
    assets: filtered.length,
    totalAssets: assets.length,
    cdnBaseUrl: registry.cdnBaseUrl || "",
  };
}

const checks = {
  ffmpeg: commandAvailable(ffmpegPath),
  ffprobe: commandAvailable(ffprobePath),
  ossutil: ossutilPath ? commandAvailable(ossutilPath) : { ok: false, error: "ossutil not found" },
  videoAudit: videoAuditSummary(),
  optimizationPlan: optimizationPlanSummary(),
  registry: registrySummary(),
  preheat: {
    path: preheatPath,
    exists: existsSync(preheatPath),
    urls: countPreheatUrls(preheatPath),
  },
  config: {
    course: course || "",
    bucket,
    cdnBaseUrl,
    assetMode: assetMode || "(not set)",
    requireOss,
  },
};

const blockers = [];
const warnings = [];
const ok = [];

if (checks.ffprobe.ok) ok.push("ffprobe is available.");
else blockers.push(`ffprobe is unavailable: ${checks.ffprobe.error || "unknown error"}`);

if (checks.ffmpeg.ok) ok.push("ffmpeg is available.");
else warnings.push(`ffmpeg is unavailable; audit can run, but optimize:videos --apply cannot: ${checks.ffmpeg.error || "unknown error"}`);

if (checks.videoAudit.exists) {
  ok.push(`Video audit exists with ${checks.videoAudit.files} scoped video file(s).`);
  if (checks.videoAudit.probeErrors) blockers.push(`Video audit has ${checks.videoAudit.probeErrors} ffprobe error(s).`);
  if (checks.videoAudit.mustOptimize) warnings.push(`${checks.videoAudit.mustOptimize} video(s) are still marked must-optimize.`);
  if (checks.videoAudit.shouldOptimize) warnings.push(`${checks.videoAudit.shouldOptimize} video(s) are marked should-optimize.`);
} else {
  warnings.push("Video audit report is missing; run npm run audit:videos -- --all.");
}

if (checks.optimizationPlan.exists) ok.push(`Optimization dry-run plan exists with ${checks.optimizationPlan.files} scoped candidate file(s).`);
else warnings.push("Optimization dry-run plan is missing; run npm run optimize:videos -- --dry-run.");

if (bucket) ok.push("OSS bucket is configured.");
else (requireOss ? blockers : warnings).push("OSS bucket is not configured; pass --bucket or set OSS_BUCKET_URI.");

if (cdnBaseUrl) {
  if (/^https:\/\//i.test(cdnBaseUrl)) ok.push("CDN base URL is configured.");
  else blockers.push("CDN base URL should be HTTPS for production.");
} else {
  (requireOss ? blockers : warnings).push("CDN base URL is not configured; pass --cdn-base-url or set COURSEWARE_ASSET_BASE_URL.");
}

if (assetMode) {
  if (["local", "hybrid", "cdn"].includes(assetMode)) ok.push(`COURSEWARE_ASSET_MODE=${assetMode}.`);
  else blockers.push("COURSEWARE_ASSET_MODE must be local, hybrid, or cdn.");
} else {
  warnings.push("COURSEWARE_ASSET_MODE is not set; Portal will default based on COURSEWARE_ASSET_BASE_URL.");
}

if (checks.registry.exists) {
  ok.push(`Asset registry exists with ${checks.registry.assets} scoped asset(s), size ${checks.registry.size}.`);
  if (cdnBaseUrl && checks.registry.cdnBaseUrl && stripSlash(checks.registry.cdnBaseUrl) !== cdnBaseUrl) {
    warnings.push(`Registry cdnBaseUrl differs from requested CDN base URL: ${checks.registry.cdnBaseUrl}`);
  }
} else {
  (requireOss ? blockers : warnings).push("Asset registry is missing; run npm run sync:oss -- --course COURSE --bucket oss://... --cdn-base-url https://... --dry-run/apply.");
}

if (checks.preheat.exists && checks.preheat.urls) ok.push(`CDN preheat URL list exists with ${checks.preheat.urls} URL(s).`);
else warnings.push("CDN preheat URL list is missing; run npm run export:cdn-preheat -- --course COURSE --cdn-base-url https://...");

if (checks.ossutil.ok) ok.push("ossutil is available.");
else (requireOss ? blockers : warnings).push(`ossutil is unavailable; sync:oss --apply cannot upload: ${checks.ossutil.error || "not found"}`);

const status = blockers.length ? "blocked" : warnings.length ? "ready-with-warnings" : "ready";
const report = {
  generatedAt: new Date().toISOString(),
  status,
  totals: {
    ok: ok.length,
    warnings: warnings.length,
    blockers: blockers.length,
  },
  blockers,
  warnings,
  ok,
  checks,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Media delivery readiness: ${status}`);
  for (const item of blockers) console.log(`BLOCK: ${item}`);
  for (const item of warnings) console.log(`WARN: ${item}`);
  console.log(`Summary: ${ok.length} ok, ${warnings.length} warning(s), ${blockers.length} blocker(s).`);
}

if (blockers.length) process.exit(1);
