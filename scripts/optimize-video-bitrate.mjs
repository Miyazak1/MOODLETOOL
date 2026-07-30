import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const deploymentRoot = join(projectRoot, "deployment");

const args = parseArgs(process.argv.slice(2));
const apply = args.apply;
const dryRun = !apply;
const auditPath = resolve(args.audit || join(deploymentRoot, "video-bitrate-audit.json"));
const courseFilter = new Set(args.courses);
const includeWatch = args.includeWatch;
const targetMbps = Number(args.targetMbps || 1.2);
const audioKbps = Number(args.audioKbps || 96);
const ffmpegPath = args.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = args.ffprobe || process.env.FFPROBE_PATH || "ffprobe";
const limit = Number(args.limit || 0);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = resolve(args.backupRoot || join(workspaceRoot, "backups", "ossd-course-portal", "video-originals", timestamp));

function parseArgs(argv) {
  const out = {
    apply: false,
    audit: "",
    courses: [],
    includeWatch: false,
    targetMbps: "",
    audioKbps: "",
    ffmpeg: "",
    ffprobe: "",
    backupRoot: "",
    limit: "",
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
    } else if (arg === "--audit") {
      out.audit = argv[++i] || "";
    } else if (arg === "--course") {
      out.courses.push(...String(argv[++i] || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
    } else if (arg === "--include-watch") {
      out.includeWatch = true;
    } else if (arg === "--target-mbps") {
      out.targetMbps = argv[++i] || "";
    } else if (arg === "--audio-kbps") {
      out.audioKbps = argv[++i] || "";
    } else if (arg === "--ffmpeg") {
      out.ffmpeg = argv[++i] || "";
    } else if (arg === "--ffprobe") {
      out.ffprobe = argv[++i] || "";
    } else if (arg === "--backup-root") {
      out.backupRoot = argv[++i] || "";
    } else if (arg === "--limit") {
      out.limit = argv[++i] || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/optimize-video-bitrate.mjs --dry-run
  node scripts/optimize-video-bitrate.mjs --course HFC3M --dry-run
  node scripts/optimize-video-bitrate.mjs --course HFC3M --apply

Options:
  --audit PATH          Audit report. Defaults to deployment/video-bitrate-audit.json.
  --course CODE[,CODE]  Limit by course.
  --include-watch       Include watch-level videos.
  --target-mbps N       Target video bitrate. Default 1.2.
  --audio-kbps N        Target audio bitrate. Default 96.
  --ffmpeg PATH         ffmpeg executable path.
  --ffprobe PATH        ffprobe executable path.
  --backup-root PATH    Original backup directory.
  --limit N             Limit processed files.`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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

function assertInside(root, path) {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const lowerRoot = resolvedRoot.toLowerCase();
  const lowerPath = resolvedPath.toLowerCase();
  if (lowerPath !== lowerRoot && !lowerPath.startsWith(`${lowerRoot.toLowerCase()}\\`) && !lowerPath.startsWith(`${lowerRoot.toLowerCase()}/`)) {
    throw new Error(`Refusing to operate outside ${resolvedRoot}: ${resolvedPath}`);
  }
  return resolvedPath;
}

function probeVideo(path) {
  const result = spawnSync(
    ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,bit_rate",
      "-show_entries",
      "stream=codec_name,codec_type,width,height,bit_rate",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: (result.stderr || result.stdout || `ffprobe exited ${result.status}`).trim() };

  const data = JSON.parse(result.stdout || "{}");
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === "video") || {};
  const audioStream = streams.find((stream) => stream.codec_type === "audio") || {};
  const stat = statSync(path);
  const durationSeconds = Number(data.format?.duration || 0) || null;
  const formatBitrate = Number(data.format?.bit_rate || 0) || null;
  const videoBitrate = Number(videoStream.bit_rate || 0) || null;
  const estimatedBitrate = durationSeconds ? Math.round((stat.size * 8) / durationSeconds) : null;
  const bitrateBps = formatBitrate || videoBitrate || estimatedBitrate;
  return {
    ok: true,
    sizeBytes: stat.size,
    durationSeconds,
    bitrateBps,
    bitrateMbps: bitrateBps ? bitrateBps / 1000 / 1000 : null,
    width: Number(videoStream.width || 0) || null,
    height: Number(videoStream.height || 0) || null,
    videoCodec: videoStream.codec_name || "",
    audioCodec: audioStream.codec_name || "",
  };
}

function targetArgsFor(path) {
  const ext = extname(path).toLowerCase();
  const targetKbps = Math.round(targetMbps * 1000);
  if (ext === ".webm") {
    return [
      "-vf",
      "scale='min(1280,iw)':-2",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      `${targetKbps}k`,
      "-crf",
      "32",
      "-c:a",
      "libopus",
      "-b:a",
      `${audioKbps}k`,
    ];
  }
  return [
    "-vf",
    "scale='min(1280,iw)':-2",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "24",
    "-maxrate",
    `${targetKbps}k`,
    "-bufsize",
    `${targetKbps * 2}k`,
    "-c:a",
    "aac",
    "-b:a",
    `${audioKbps}k`,
    "-movflags",
    "+faststart",
  ];
}

function ffmpegOptimize(sourcePath, outputPath) {
  const result = spawnSync(ffmpegPath, ["-y", "-i", sourcePath, ...targetArgsFor(sourcePath), outputPath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `ffmpeg exited ${result.status}`).trim());
}

function loadCandidates(audit) {
  const statuses = new Set(["must-optimize", "should-optimize"]);
  if (includeWatch) statuses.add("watch");
  const candidates = [];
  for (const course of audit.courses || []) {
    if (courseFilter.size && !courseFilter.has(String(course.course || "").toUpperCase())) continue;
    for (const video of course.videos || []) {
      if (!statuses.has(video.status)) continue;
      candidates.push({ ...video, coursewareRoot: audit.coursewareRoot });
    }
  }
  candidates.sort((a, b) => {
    const priority = { "must-optimize": 0, "should-optimize": 1, watch: 2 };
    return (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || (b.bitrateMbps || 0) - (a.bitrateMbps || 0);
  });
  return limit > 0 ? candidates.slice(0, limit) : candidates;
}

function planItem(video) {
  const sourcePath = assertInside(video.coursewareRoot, video.absolutePath);
  const relFromCourseware = toPosix(relative(video.coursewareRoot, sourcePath));
  const backupPath = resolve(backupRoot, relFromCourseware);
  const outputPath = `${sourcePath}.optimizing-${timestamp}${extname(sourcePath) || ".video"}`;
  return {
    course: video.course,
    status: video.status,
    sourcePath,
    relativePath: video.path,
    backupPath,
    outputPath,
    originalSizeBytes: video.sizeBytes,
    originalSizeMb: video.sizeMb,
    originalBitrateMbps: video.bitrateMbps,
    originalDurationSeconds: video.durationSeconds,
    targetMbps,
    action: dryRun ? "dry-run" : "pending",
  };
}

function applyItem(item) {
  if (!existsSync(item.sourcePath)) throw new Error(`Missing source file: ${item.sourcePath}`);
  mkdirSync(dirname(item.outputPath), { recursive: true });
  mkdirSync(dirname(item.backupPath), { recursive: true });
  rmSync(item.outputPath, { force: true });

  ffmpegOptimize(item.sourcePath, item.outputPath);
  const outputProbe = probeVideo(item.outputPath);
  if (!outputProbe.ok) throw new Error(`Output probe failed: ${outputProbe.error}`);

  const durationDelta = Math.abs((outputProbe.durationSeconds || 0) - (item.originalDurationSeconds || 0));
  const durationTolerance = Math.max(1, (item.originalDurationSeconds || 0) * 0.01);
  if (durationDelta > durationTolerance) {
    throw new Error(`Output duration changed too much: ${durationDelta.toFixed(2)} seconds`);
  }
  if (outputProbe.sizeBytes >= item.originalSizeBytes) {
    throw new Error("Output is not smaller than source.");
  }
  const relaxedTarget = Math.max(targetMbps * 1.5, (item.originalBitrateMbps || targetMbps) * 0.95);
  if ((outputProbe.bitrateMbps || 0) > relaxedTarget) {
    throw new Error(`Output bitrate ${formatNumber(outputProbe.bitrateMbps)} Mbps is above expected ceiling ${formatNumber(relaxedTarget)} Mbps.`);
  }

  copyFileSync(item.sourcePath, item.backupPath);
  const restoreFromBackup = () => {
    if (existsSync(item.backupPath)) copyFileSync(item.backupPath, item.sourcePath);
  };
  try {
    rmSync(item.sourcePath, { force: true });
    renameSync(item.outputPath, item.sourcePath);
  } catch (error) {
    restoreFromBackup();
    throw error;
  }

  return {
    ...item,
    action: "optimized",
    output: {
      sizeBytes: outputProbe.sizeBytes,
      sizeMb: outputProbe.sizeBytes / 1024 / 1024,
      bitrateMbps: outputProbe.bitrateMbps,
      durationSeconds: outputProbe.durationSeconds,
      width: outputProbe.width,
      height: outputProbe.height,
      videoCodec: outputProbe.videoCodec,
      audioCodec: outputProbe.audioCodec,
      savedBytes: item.originalSizeBytes - outputProbe.sizeBytes,
      savedMb: (item.originalSizeBytes - outputProbe.sizeBytes) / 1024 / 1024,
    },
  };
}

function renderMarkdown(report) {
  const rows = report.items
    .map((item) => {
      const output = item.output || {};
      return `| ${item.action} | ${item.course} | ${item.status} | ${formatNumber(item.originalBitrateMbps)} | ${formatNumber(output.bitrateMbps)} | ${formatNumber(item.originalSizeMb)} | ${formatNumber(output.sizeMb)} | ${formatNumber(output.savedMb)} | ${escapeMarkdown(item.relativePath)} |`;
    })
    .join("\n");
  return `# Video Optimization ${report.dryRun ? "Plan" : "Report"}

Generated: ${report.generatedAt}

Audit: ${report.auditPath}

Backup root: ${report.backupRoot}

Mode: ${report.dryRun ? "dry-run" : "apply"}

Target video bitrate: ${targetMbps} Mbps

Audio bitrate: ${audioKbps} kbps

## Summary

| Item | Value |
| --- | ---: |
| Planned files | ${report.summary.files} |
| Optimized files | ${report.summary.optimized} |
| Failed files | ${report.summary.failed} |
| Original size | ${formatNumber(report.summary.originalMb)} MB |
| Output size | ${formatNumber(report.summary.outputMb)} MB |
| Saved size | ${formatNumber(report.summary.savedMb)} MB |

## Files

| Action | Course | Status | Old Mbps | New Mbps | Old MB | New MB | Saved MB | Path |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${rows || "| - | - | - | - | - | - | - | - | No candidate files. |"}
`;
}

if (!existsSync(auditPath)) {
  console.error(`Missing audit report: ${auditPath}`);
  console.error("Run: npm run audit:videos -- --all");
  process.exit(1);
}

const audit = readJson(auditPath);
const planned = loadCandidates(audit).map(planItem);
const items = [];
let failed = 0;

for (const item of planned) {
  if (dryRun) {
    items.push(item);
    continue;
  }
  try {
    items.push(applyItem(item));
  } catch (error) {
    failed += 1;
    rmSync(item.outputPath, { force: true });
    items.push({
      ...item,
      action: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const optimized = items.filter((item) => item.action === "optimized");
const report = {
  generatedAt: new Date().toISOString(),
  dryRun,
  auditPath,
  backupRoot,
  ffmpeg: ffmpegPath,
  ffprobe: ffprobePath,
  targetMbps,
  audioKbps,
  summary: {
    files: items.length,
    optimized: optimized.length,
    failed,
    originalBytes: items.reduce((sum, item) => sum + (item.originalSizeBytes || 0), 0),
    originalMb: items.reduce((sum, item) => sum + (item.originalSizeBytes || 0), 0) / 1024 / 1024,
    outputBytes: optimized.reduce((sum, item) => sum + (item.output?.sizeBytes || 0), 0),
    outputMb: optimized.reduce((sum, item) => sum + (item.output?.sizeBytes || 0), 0) / 1024 / 1024,
    savedBytes: optimized.reduce((sum, item) => sum + (item.output?.savedBytes || 0), 0),
    savedMb: optimized.reduce((sum, item) => sum + (item.output?.savedBytes || 0), 0) / 1024 / 1024,
  },
  items,
};

mkdirSync(deploymentRoot, { recursive: true });
const suffix = dryRun ? "plan" : "report";
const jsonPath = join(deploymentRoot, `video-optimization-${suffix}.json`);
const mdPath = join(deploymentRoot, `video-optimization-${suffix}.md`);
writeJson(jsonPath, report);
writeFileSync(mdPath, renderMarkdown(report), "utf8");

console.log(
  JSON.stringify(
    {
      dryRun,
      files: report.summary.files,
      optimized: report.summary.optimized,
      failed: report.summary.failed,
      originalMb: Number(report.summary.originalMb.toFixed(2)),
      outputMb: Number(report.summary.outputMb.toFixed(2)),
      savedMb: Number(report.summary.savedMb.toFixed(2)),
      json: jsonPath,
      markdown: mdPath,
    },
    null,
    2,
  ),
);

if (failed) process.exit(1);
