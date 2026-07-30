import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const deploymentRoot = join(projectRoot, "deployment");
const defaultCoursewareRoot = join(workspaceRoot, "courseware");

const args = parseArgs(process.argv.slice(2));
const coursewareRoot = resolve(args.coursewareRoot || process.env.COURSE_ACTIVE_ROOT || defaultCoursewareRoot);
const ffprobePath = args.ffprobe || process.env.FFPROBE_PATH || "ffprobe";
const requestedCourses = args.courses;
const scanAll = args.all || !requestedCourses.length;
const fileLimit = Number(args.limit || 0);

const thresholds = {
  okMbps: Number(args.okMbps || 2),
  recommendMbps: Number(args.recommendMbps || 3),
  mustMbps: Number(args.mustMbps || 5),
  targetMbps: Number(args.targetMbps || 1.2),
  largeMb: Number(args.largeMb || 100),
  hugeMb: Number(args.hugeMb || 200),
};

const videoExts = new Set([".mp4", ".webm", ".m4v", ".mov"]);

function parseArgs(argv) {
  const out = {
    all: false,
    courses: [],
    coursewareRoot: "",
    ffprobe: "",
    limit: "",
    okMbps: "",
    recommendMbps: "",
    mustMbps: "",
    targetMbps: "",
    largeMb: "",
    hugeMb: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--all") {
      out.all = true;
    } else if (arg === "--course") {
      out.courses.push(...String(argv[++i] || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
    } else if (arg === "--courseware-root") {
      out.coursewareRoot = argv[++i] || "";
    } else if (arg === "--ffprobe") {
      out.ffprobe = argv[++i] || "";
    } else if (arg === "--limit") {
      out.limit = argv[++i] || "";
    } else if (arg === "--ok-mbps") {
      out.okMbps = argv[++i] || "";
    } else if (arg === "--recommend-mbps") {
      out.recommendMbps = argv[++i] || "";
    } else if (arg === "--must-mbps") {
      out.mustMbps = argv[++i] || "";
    } else if (arg === "--target-mbps") {
      out.targetMbps = argv[++i] || "";
    } else if (arg === "--large-mb") {
      out.largeMb = argv[++i] || "";
    } else if (arg === "--huge-mb") {
      out.hugeMb = argv[++i] || "";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printUsage() {
  console.log(`Usage:
  node scripts/audit-video-bitrate.mjs --all
  node scripts/audit-video-bitrate.mjs --course HFC3M
  node scripts/audit-video-bitrate.mjs --course ENG3U,HFC3M --target-mbps 1.2

Options:
  --courseware-root PATH   Course root. Defaults to COURSE_ACTIVE_ROOT or ../courseware.
  --ffprobe PATH           ffprobe executable path. Defaults to FFPROBE_PATH or ffprobe.
  --limit N                Limit files per course for quick smoke checks.
  --ok-mbps N              OK threshold. Default 2.
  --recommend-mbps N       Recommended optimization threshold. Default 3.
  --must-mbps N            Must optimize threshold. Default 5.
  --target-mbps N          Suggested target bitrate. Default 1.2.
  --large-mb N             Large file review threshold. Default 100.
  --huge-mb N              Huge file review threshold. Default 200.`);
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

function bytesToMb(bytes) {
  return bytes / 1024 / 1024;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return Number(value).toFixed(digits);
}

function walkFiles(root, matcher, result = []) {
  if (!existsSync(root)) return result;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, matcher, result);
    else if (matcher(full)) result.push(full);
  }
  return result;
}

function availableCourses() {
  if (!existsSync(coursewareRoot)) {
    throw new Error(`Missing courseware root: ${coursewareRoot}`);
  }
  return readdirSync(coursewareRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(coursewareRoot, entry.name, "course-manifest.json")))
    .map((entry) => entry.name.toUpperCase())
    .sort((a, b) => a.localeCompare(b));
}

function collectManifestPaths(value, paths = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectManifestPaths(item, paths);
    return paths;
  }
  if (!value || typeof value !== "object") return paths;
  for (const [key, item] of Object.entries(value)) {
    if (["path", "url", "previewPath", "previewUrl"].includes(key) && typeof item === "string") {
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(item) && !item.startsWith("/")) paths.add(toPosix(decodePath(item)));
    }
    collectManifestPaths(item, paths);
  }
  return paths;
}

function collectIspringRoots(manifest) {
  const roots = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.ispring || []) {
        const packagePath = item.packagePath || dirnameFromPosix(item.path || "");
        if (packagePath) {
          roots.push({
            path: toPosix(packagePath).replace(/\/$/, ""),
            lessonId: lesson.id || "",
            label: item.label || "",
          });
        }
      }
    }
  }
  return roots;
}

function dirnameFromPosix(path) {
  const normalized = toPosix(path).replace(/\/$/, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function decodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function firstMatchingIspringRoot(relativePath, roots) {
  const normalized = toPosix(relativePath);
  return roots.find((root) => normalized === root.path || normalized.startsWith(`${root.path}/`)) || null;
}

function probeVideo(path, stat) {
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
  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || `ffprobe exited ${result.status}`).trim(),
    };
  }
  let data;
  try {
    data = JSON.parse(result.stdout || "{}");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid ffprobe JSON",
    };
  }

  const streams = Array.isArray(data.streams) ? data.streams : [];
  const videoStream = streams.find((stream) => stream.codec_type === "video") || {};
  const audioStream = streams.find((stream) => stream.codec_type === "audio") || {};
  const durationSeconds = Number(data.format?.duration || 0) || null;
  const formatBitrate = Number(data.format?.bit_rate || 0) || null;
  const videoBitrate = Number(videoStream.bit_rate || 0) || null;
  const estimatedBitrate = durationSeconds ? Math.round((stat.size * 8) / durationSeconds) : null;
  const bitrate = formatBitrate || videoBitrate || estimatedBitrate;

  return {
    ok: true,
    durationSeconds,
    bitrateBps: bitrate,
    bitrateMbps: bitrate ? bitrate / 1000 / 1000 : null,
    estimatedBitrateBps: estimatedBitrate,
    width: Number(videoStream.width || 0) || null,
    height: Number(videoStream.height || 0) || null,
    videoCodec: videoStream.codec_name || "",
    audioCodec: audioStream.codec_name || "",
  };
}

function classifyVideo(file) {
  const bitrate = file.bitrateMbps;
  const sizeMb = file.sizeMb;
  if (file.probeError) return { status: "probe-error", action: "Install/check ffprobe and re-run audit." };
  if (bitrate === null || bitrate === undefined) return { status: "unknown", action: "Review manually; bitrate is unavailable." };
  if (bitrate > thresholds.mustMbps) return { status: "must-optimize", action: `Compress toward ${thresholds.targetMbps} Mbps.` };
  if (bitrate > thresholds.recommendMbps) return { status: "should-optimize", action: `Compress toward ${thresholds.targetMbps} Mbps after visual check.` };
  if (sizeMb > thresholds.hugeMb) return { status: "should-optimize", action: "Large file; review even if average bitrate is moderate." };
  if (bitrate > thresholds.okMbps || (sizeMb > thresholds.largeMb && bitrate > thresholds.okMbps)) {
    return { status: "watch", action: "Usually acceptable; optimize later if CDN traffic grows." };
  }
  return { status: "ok", action: "No compression needed." };
}

function auditCourse(course) {
  const courseRoot = join(coursewareRoot, course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {};
  const manifestPaths = collectManifestPaths(manifest);
  const ispringRoots = collectIspringRoots(manifest);
  let videoFiles = walkFiles(courseRoot, (path) => videoExts.has(extname(path).toLowerCase())).sort((a, b) => a.localeCompare(b));
  if (fileLimit > 0) videoFiles = videoFiles.slice(0, fileLimit);

  const videos = videoFiles.map((path) => {
    const stat = statSync(path);
    const relativePath = toPosix(relative(courseRoot, path));
    const ispring = firstMatchingIspringRoot(relativePath, ispringRoots);
    const probe = probeVideo(path, stat);
    const record = {
      course,
      path: relativePath,
      absolutePath: path,
      filename: basename(path),
      extension: extname(path).toLowerCase(),
      sizeBytes: stat.size,
      sizeMb: bytesToMb(stat.size),
      manifestReferenced: manifestPaths.has(relativePath),
      inIspringPackage: Boolean(ispring),
      ispringLessonId: ispring?.lessonId || "",
      ispringLabel: ispring?.label || "",
      probeOk: probe.ok,
      probeError: probe.ok ? "" : probe.error,
      durationSeconds: probe.ok ? probe.durationSeconds : null,
      bitrateBps: probe.ok ? probe.bitrateBps : null,
      bitrateMbps: probe.ok ? probe.bitrateMbps : null,
      estimatedBitrateBps: probe.ok ? probe.estimatedBitrateBps : null,
      width: probe.ok ? probe.width : null,
      height: probe.ok ? probe.height : null,
      videoCodec: probe.ok ? probe.videoCodec : "",
      audioCodec: probe.ok ? probe.audioCodec : "",
    };
    return {
      ...record,
      ...classifyVideo(record),
    };
  });

  return {
    course,
    courseRoot,
    manifestPath,
    summary: summarizeVideos(videos),
    videos,
  };
}

function summarizeVideos(videos) {
  const byStatus = {};
  for (const video of videos) byStatus[video.status] = (byStatus[video.status] || 0) + 1;
  return {
    files: videos.length,
    totalBytes: videos.reduce((sum, item) => sum + item.sizeBytes, 0),
    totalGb: videos.reduce((sum, item) => sum + item.sizeBytes, 0) / 1024 / 1024 / 1024,
    totalDurationHours: videos.reduce((sum, item) => sum + (item.durationSeconds || 0), 0) / 3600,
    averageBitrateMbps: average(videos.map((item) => item.bitrateMbps).filter((item) => typeof item === "number")),
    maxBitrateMbps: Math.max(0, ...videos.map((item) => item.bitrateMbps || 0)),
    maxSizeMb: Math.max(0, ...videos.map((item) => item.sizeMb || 0)),
    byStatus,
    optimizationCandidates: videos.filter((item) => ["must-optimize", "should-optimize"].includes(item.status)).length,
    watch: videos.filter((item) => item.status === "watch").length,
    probeErrors: videos.filter((item) => item.status === "probe-error").length,
  };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function combineSummary(courses) {
  const videos = courses.flatMap((course) => course.videos);
  return {
    courses: courses.length,
    ...summarizeVideos(videos),
    courseBreakdown: courses.map((course) => ({
      course: course.course,
      files: course.summary.files,
      totalGb: course.summary.totalGb,
      optimizationCandidates: course.summary.optimizationCandidates,
      mustOptimize: course.summary.byStatus["must-optimize"] || 0,
      shouldOptimize: course.summary.byStatus["should-optimize"] || 0,
      watch: course.summary.watch,
      maxBitrateMbps: course.summary.maxBitrateMbps,
      maxSizeMb: course.summary.maxSizeMb,
    })),
  };
}

function renderMarkdown(report) {
  const summary = report.summary;
  const candidates = report.courses
    .flatMap((course) => course.videos)
    .filter((item) => ["must-optimize", "should-optimize", "watch", "probe-error"].includes(item.status))
    .sort((a, b) => {
      const priority = { "must-optimize": 0, "should-optimize": 1, watch: 2, "probe-error": 3, ok: 4, unknown: 5 };
      return (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || (b.bitrateMbps || 0) - (a.bitrateMbps || 0) || b.sizeBytes - a.sizeBytes;
    });
  const courseRows = summary.courseBreakdown
    .map(
      (course) =>
        `| ${course.course} | ${course.files} | ${formatNumber(course.totalGb)} | ${course.optimizationCandidates} | ${course.mustOptimize} | ${course.shouldOptimize} | ${course.watch} | ${formatNumber(course.maxBitrateMbps)} | ${formatNumber(course.maxSizeMb)} |`,
    )
    .join("\n");
  const candidateRows = candidates
    .map(
      (item) =>
        `| ${item.status} | ${item.course} | ${formatNumber(item.bitrateMbps)} | ${formatNumber(item.sizeMb)} | ${formatNumber(item.durationSeconds / 60)} | ${item.width || ""}x${item.height || ""} | ${escapeMarkdown(item.path)} | ${escapeMarkdown(item.action)} |`,
    )
    .join("\n");

  return `# Video Bitrate Audit

Generated: ${report.generatedAt}

Courseware root: ${report.coursewareRoot}

ffprobe: ${report.ffprobe}

## Thresholds

| Rule | Value |
| --- | ---: |
| OK bitrate | <= ${thresholds.okMbps} Mbps |
| Watch bitrate | > ${thresholds.okMbps} Mbps |
| Should optimize bitrate | > ${thresholds.recommendMbps} Mbps |
| Must optimize bitrate | > ${thresholds.mustMbps} Mbps |
| Suggested target bitrate | ${thresholds.targetMbps} Mbps |
| Large file review | > ${thresholds.largeMb} MB |
| Huge file review | > ${thresholds.hugeMb} MB |

## Summary

| Item | Value |
| --- | ---: |
| Courses | ${summary.courses} |
| Video files | ${summary.files} |
| Total size | ${formatNumber(summary.totalGb)} GB |
| Total duration | ${formatNumber(summary.totalDurationHours)} hours |
| Average bitrate | ${formatNumber(summary.averageBitrateMbps)} Mbps |
| Max bitrate | ${formatNumber(summary.maxBitrateMbps)} Mbps |
| Max size | ${formatNumber(summary.maxSizeMb)} MB |
| Optimization candidates | ${summary.optimizationCandidates} |
| Watch | ${summary.watch} |
| Probe errors | ${summary.probeErrors} |

## Course Breakdown

| Course | Files | Size GB | Candidates | Must | Should | Watch | Max Mbps | Max MB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${courseRows || "| - | - | - | - | - | - | - | - | - |"}

## Candidate Files

| Status | Course | Mbps | MB | Minutes | Resolution | Path | Action |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
${candidateRows || "| ok | - | - | - | - | - | No oversized videos found. | - |"}
`;
}

if (!scanAll && !requestedCourses.length) {
  printUsage();
  process.exit(1);
}

const courses = scanAll ? availableCourses() : requestedCourses;
const missing = courses.filter((course) => !existsSync(join(coursewareRoot, course, "course-manifest.json")));
if (missing.length) {
  console.error(`Missing course manifest(s): ${missing.join(", ")} in ${coursewareRoot}`);
  process.exit(1);
}

const reports = courses.map(auditCourse);
const report = {
  generatedAt: new Date().toISOString(),
  coursewareRoot,
  ffprobe: ffprobePath,
  thresholds,
  summary: combineSummary(reports),
  courses: reports,
};

mkdirSync(deploymentRoot, { recursive: true });

const suffix = scanAll ? "" : `-${courses.join("-")}`;
const jsonPath = join(deploymentRoot, `video-bitrate-audit${suffix}.json`);
const mdPath = join(deploymentRoot, `video-bitrate-audit${suffix}.md`);
writeJson(jsonPath, report);
writeFileSync(mdPath, renderMarkdown(report), "utf8");

for (const course of reports) {
  if (scanAll) continue;
  writeJson(join(deploymentRoot, `video-bitrate-audit-${course.course}.json`), {
    generatedAt: report.generatedAt,
    coursewareRoot,
    ffprobe: ffprobePath,
    thresholds,
    summary: { courses: 1, ...course.summary },
    courses: [course],
  });
}

console.log(
  JSON.stringify(
    {
      generatedAt: report.generatedAt,
      coursewareRoot,
      courses: report.summary.courses,
      files: report.summary.files,
      totalGb: Number(report.summary.totalGb.toFixed(2)),
      optimizationCandidates: report.summary.optimizationCandidates,
      mustOptimize: report.summary.byStatus["must-optimize"] || 0,
      shouldOptimize: report.summary.byStatus["should-optimize"] || 0,
      watch: report.summary.watch,
      probeErrors: report.summary.probeErrors,
      json: jsonPath,
      markdown: mdPath,
    },
    null,
    2,
  ),
);
