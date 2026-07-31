import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");

const args = parseArgs(process.argv.slice(2));
const courses = args.courses;
const scanAll = args.all;

if (!scanAll && !courses.length) {
  console.error("Pass --course CODE[,CODE] or --all.");
  printUsage();
  process.exit(2);
}
if (args.applyOss && !args.bucket && !process.env.OSS_BUCKET_URI) {
  console.error("--apply-oss requires --bucket or OSS_BUCKET_URI.");
  process.exit(2);
}
if ((args.applyOss || (!args.skipPreheat && args.exportPreheat) || args.requireOss) && !args.cdnBaseUrl && !process.env.COURSEWARE_ASSET_BASE_URL) {
  console.error("OSS/CDN stages require --cdn-base-url or COURSEWARE_ASSET_BASE_URL.");
  process.exit(2);
}

function parseArgs(argv) {
  const out = {
    all: false,
    courses: [],
    coursewareRoot: "",
    bucket: "",
    cdnBaseUrl: "",
    assetMode: "",
    assetScope: "",
    prefix: "",
    audit: "",
    registry: "",
    preheat: "",
    ffmpeg: "",
    ffprobe: "",
    ossutil: "",
    targetMbps: "",
    audioKbps: "",
    limit: "",
    preheatLimit: "",
    includeWatch: false,
    includeHash: false,
    applyOptimize: false,
    applyOss: false,
    requireOss: false,
    exportPreheat: true,
    skipAudit: false,
    skipOptimize: false,
    skipOss: false,
    skipPreheat: false,
    skipReadiness: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--all") out.all = true;
    else if (arg === "--course") out.courses.push(...String(argv[++i] || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
    else if (arg === "--courseware-root") out.coursewareRoot = argv[++i] || "";
    else if (arg === "--bucket") out.bucket = argv[++i] || "";
    else if (arg === "--cdn-base-url") out.cdnBaseUrl = argv[++i] || "";
    else if (arg === "--asset-mode") out.assetMode = argv[++i] || "";
    else if (arg === "--asset-scope") out.assetScope = argv[++i] || "";
    else if (arg === "--prefix") out.prefix = argv[++i] || "";
    else if (arg === "--audit") out.audit = argv[++i] || "";
    else if (arg === "--registry") out.registry = argv[++i] || "";
    else if (arg === "--preheat") out.preheat = argv[++i] || "";
    else if (arg === "--ffmpeg") out.ffmpeg = argv[++i] || "";
    else if (arg === "--ffprobe") out.ffprobe = argv[++i] || "";
    else if (arg === "--ossutil") out.ossutil = argv[++i] || "";
    else if (arg === "--target-mbps") out.targetMbps = argv[++i] || "";
    else if (arg === "--audio-kbps") out.audioKbps = argv[++i] || "";
    else if (arg === "--limit") out.limit = argv[++i] || "";
    else if (arg === "--preheat-limit") out.preheatLimit = argv[++i] || "";
    else if (arg === "--include-watch") out.includeWatch = true;
    else if (arg === "--hash") out.includeHash = true;
    else if (arg === "--apply-optimize") out.applyOptimize = true;
    else if (arg === "--apply-oss") out.applyOss = true;
    else if (arg === "--require-oss") out.requireOss = true;
    else if (arg === "--skip-audit") out.skipAudit = true;
    else if (arg === "--skip-optimize") out.skipOptimize = true;
    else if (arg === "--skip-oss") out.skipOss = true;
    else if (arg === "--skip-preheat") out.skipPreheat = true;
    else if (arg === "--skip-readiness") out.skipReadiness = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/run-media-delivery-pipeline.mjs --course HFC3M --cdn-base-url https://cdn.example.com/courseware-active --bucket oss://bucket
  node scripts/run-media-delivery-pipeline.mjs --course HFC3M --apply-optimize --apply-oss --require-oss --cdn-base-url https://cdn.example.com/courseware-active --bucket oss://bucket

Default mode is safe:
  - audit writes reports
  - optimize runs dry-run only
  - OSS sync runs dry-run only
  - preheat list is exported
  - readiness runs without requiring OSS unless --require-oss is passed

Options:
  --course CODE[,CODE]      Course filter.
  --all                     Process all courses.
  --courseware-root PATH    Course root.
  --bucket URI              OSS bucket URI.
  --cdn-base-url URL        CDN asset base URL.
  --asset-mode MODE         local, hybrid, or cdn. Defaults to hybrid when CDN URL is set.
  --asset-scope SCOPE       playable or all. Default playable uploads videos, H5P, and iSpring packages.
  --apply-optimize          Actually transcode candidate videos.
  --apply-oss               Actually upload to OSS.
  --require-oss             Treat OSS/CDN readiness gaps as blockers.
  --skip-audit              Reuse an existing audit report.
  --skip-optimize           Skip video optimization planning/apply.
  --skip-oss                Skip OSS sync planning/apply.
  --skip-preheat            Skip CDN preheat export.
  --skip-readiness          Skip final media delivery readiness check.
  --audit PATH              Audit report path for optimize/readiness.
  --registry PATH           Registry path for preheat/readiness.
  --preheat PATH            Preheat txt path for readiness.
  --ffmpeg PATH             ffmpeg executable.
  --ffprobe PATH            ffprobe executable.
  --ossutil PATH            ossutil executable.
  --target-mbps N           Compression target bitrate.
  --audio-kbps N            Compression audio bitrate.
  --limit N                 Limit files for audit/optimize/sync smoke runs.
  --preheat-limit N         Limit exported preheat URLs.
  --include-watch           Include watch-level videos in optimization.
  --hash                    Include sha256 hashes in OSS registry.`);
}

function addValue(commandArgs, name, value) {
  if (value !== "" && value !== undefined && value !== null) commandArgs.push(name, String(value));
}

function addCourseArgs(commandArgs) {
  if (scanAll) commandArgs.push("--all");
  else commandArgs.push("--course", courses.join(","));
}

function runStep(name, script, scriptArgs, options = {}) {
  const fullArgs = [script, ...scriptArgs];
  const startedAt = new Date().toISOString();
  console.log(`\n== ${name} ==`);
  console.log(`${process.execPath} ${fullArgs.join(" ")}`);
  const result = spawnSync(process.execPath, fullArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const hasWarningOutput = options.warningPattern ? options.warningPattern.test(`${result.stdout || ""}\n${result.stderr || ""}`) : false;
  const step = {
    name,
    script,
    args: scriptArgs,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: result.status === 0 ? (hasWarningOutput ? "warning" : "ok") : options.allowFailure ? "warning" : "failed",
    exitCode: result.status,
  };
  if (result.status !== 0 && !options.allowFailure) {
    throw Object.assign(new Error(`${name} failed with exit code ${result.status}`), { step });
  }
  return step;
}

function readJsonIfExists(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function renderMarkdown(report) {
  const rows = report.steps.map((step) => `| ${step.status} | ${step.name} | ${step.exitCode ?? ""} | ${step.script} ${step.args.join(" ")} |`).join("\n");
  return `# Media Delivery Pipeline Report

Generated: ${report.generatedAt}

Mode:

- Courses: ${report.config.all ? "all" : report.config.courses.join(", ")}
- Optimize apply: ${report.config.applyOptimize ? "yes" : "no"}
- OSS apply: ${report.config.applyOss ? "yes" : "no"}
- Require OSS readiness: ${report.config.requireOss ? "yes" : "no"}

## Steps

| Status | Step | Exit | Command |
| --- | --- | ---: | --- |
${rows || "| - | - | - | - |"}

## Outputs

- Audit: ${report.outputs.audit || "(default or skipped)"}
- Optimization plan/report: ${report.outputs.optimization || "(skipped)"}
- OSS registry: ${report.outputs.registry || "(skipped)"}
- Preheat list: ${report.outputs.preheat || "(skipped)"}
`;
}

const steps = [];
const outputs = {
  audit: args.audit || "",
  optimization: "",
  registry: args.registry || join(deploymentRoot, "asset-registry.json"),
  preheat: args.preheat || "",
};

try {
  if (!args.skipAudit) {
    const stepArgs = [];
    addCourseArgs(stepArgs);
    addValue(stepArgs, "--courseware-root", args.coursewareRoot);
    addValue(stepArgs, "--ffprobe", args.ffprobe);
    addValue(stepArgs, "--limit", args.limit);
    steps.push(runStep("video audit", "scripts/audit-video-bitrate.mjs", stepArgs));
    outputs.audit = scanAll ? join(deploymentRoot, "video-bitrate-audit.json") : join(deploymentRoot, `video-bitrate-audit-${courses.join("-")}.json`);
  }

  if (!args.skipOptimize) {
    const stepArgs = [args.applyOptimize ? "--apply" : "--dry-run"];
    addCourseArgs(stepArgs);
    addValue(stepArgs, "--audit", outputs.audit || args.audit);
    addValue(stepArgs, "--ffmpeg", args.ffmpeg);
    addValue(stepArgs, "--ffprobe", args.ffprobe);
    addValue(stepArgs, "--target-mbps", args.targetMbps);
    addValue(stepArgs, "--audio-kbps", args.audioKbps);
    addValue(stepArgs, "--limit", args.limit);
    if (args.includeWatch) stepArgs.push("--include-watch");
    steps.push(runStep(args.applyOptimize ? "video optimization apply" : "video optimization plan", "scripts/optimize-video-bitrate.mjs", stepArgs));
    outputs.optimization = join(deploymentRoot, `video-optimization-${args.applyOptimize ? "report" : "plan"}.json`);
  }

  if (!args.skipOss) {
    const stepArgs = [args.applyOss ? "--apply" : "--dry-run"];
    addCourseArgs(stepArgs);
    addValue(stepArgs, "--courseware-root", args.coursewareRoot);
    addValue(stepArgs, "--bucket", args.bucket);
    addValue(stepArgs, "--cdn-base-url", args.cdnBaseUrl);
    addValue(stepArgs, "--prefix", args.prefix);
    addValue(stepArgs, "--registry", args.registry);
    addValue(stepArgs, "--asset-scope", args.assetScope);
    addValue(stepArgs, "--limit", args.limit);
    addValue(stepArgs, "--ossutil", args.ossutil);
    if (args.includeHash) stepArgs.push("--hash");
    steps.push(runStep(args.applyOss ? "OSS sync apply" : "OSS sync plan", "scripts/sync-courseware-oss.mjs", stepArgs));
    outputs.registry = args.registry || join(deploymentRoot, "asset-registry.json");
  }

  if (!args.skipPreheat) {
    const stepArgs = [];
    addCourseArgs(stepArgs);
    addValue(stepArgs, "--registry", outputs.registry || args.registry);
    addValue(stepArgs, "--cdn-base-url", args.cdnBaseUrl);
    addValue(stepArgs, "--prefix", args.prefix);
    addValue(stepArgs, "--limit", args.preheatLimit);
    steps.push(runStep("CDN preheat export", "scripts/export-cdn-preheat-list.mjs", stepArgs));
    outputs.preheat = scanAll ? join(deploymentRoot, "cdn-preheat-urls.txt") : join(deploymentRoot, `cdn-preheat-urls-${courses.join("-")}.txt`);
  }

  if (!args.skipReadiness) {
    const stepArgs = [];
    if (!scanAll && courses.length === 1) stepArgs.push("--course", courses[0]);
    addValue(stepArgs, "--audit", outputs.audit || args.audit);
    addValue(stepArgs, "--optimize-plan", outputs.optimization);
    addValue(stepArgs, "--registry", outputs.registry || args.registry);
    addValue(stepArgs, "--preheat", outputs.preheat || args.preheat);
    addValue(stepArgs, "--bucket", args.bucket);
    addValue(stepArgs, "--cdn-base-url", args.cdnBaseUrl);
    addValue(stepArgs, "--asset-mode", args.assetMode || (args.cdnBaseUrl ? "hybrid" : ""));
    addValue(stepArgs, "--ffmpeg", args.ffmpeg);
    addValue(stepArgs, "--ffprobe", args.ffprobe);
    addValue(stepArgs, "--ossutil", args.ossutil);
    if (args.requireOss) stepArgs.push("--require-oss");
    steps.push(runStep("media delivery readiness", "scripts/check-media-delivery-readiness.mjs", stepArgs, {
      allowFailure: !args.requireOss,
      warningPattern: /Media delivery readiness:\s*ready-with-warnings|^WARN:/m,
    }));
  }
} catch (error) {
  if (error.step) steps.push(error.step);
  const report = buildReport("failed");
  writeReport(report);
  throw error;
}

const status = steps.some((step) => step.status === "failed") ? "failed" : steps.some((step) => step.status === "warning") ? "ready-with-warnings" : "ready";
const report = buildReport(status);
writeReport(report);

console.log(
  JSON.stringify(
    {
      status,
      steps: steps.length,
      report: join(deploymentRoot, "media-delivery-pipeline-report.json"),
      markdown: join(deploymentRoot, "media-delivery-pipeline-report.md"),
      outputs,
      summaries: report.summaries,
    },
    null,
    2,
  ),
);

if (status === "failed") process.exit(1);

function buildReport(status) {
  const audit = readJsonIfExists(outputs.audit);
  const optimization = readJsonIfExists(outputs.optimization);
  const registry = readJsonIfExists(outputs.registry);
  return {
    generatedAt: new Date().toISOString(),
    status,
    config: {
      all: scanAll,
      courses,
      applyOptimize: args.applyOptimize,
      applyOss: args.applyOss,
      requireOss: args.requireOss,
      cdnBaseUrl: args.cdnBaseUrl || process.env.COURSEWARE_ASSET_BASE_URL || "",
      bucket: args.bucket || process.env.OSS_BUCKET_URI || "",
      assetScope: args.assetScope || process.env.COURSEWARE_OSS_ASSET_SCOPE || "playable",
    },
    steps,
    outputs,
    summaries: {
      audit: audit?.summary || null,
      optimization: optimization?.summary || null,
      registry: registry ? { assetCount: registry.assetCount || registry.assets?.length || 0, cdnBaseUrl: registry.cdnBaseUrl || "" } : null,
    },
  };
}

function writeReport(report) {
  mkdirSync(deploymentRoot, { recursive: true });
  writeFileSync(join(deploymentRoot, "media-delivery-pipeline-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(deploymentRoot, "media-delivery-pipeline-report.md"), renderMarkdown(report), "utf8");
}
