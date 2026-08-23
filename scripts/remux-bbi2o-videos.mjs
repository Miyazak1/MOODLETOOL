import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = resolve(workspaceRoot, "courseware", "BBI2O");
const stagingRoot = resolve(projectRoot, "deployment", "course-package-staging", "BBI2O");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = resolve(workspaceRoot, "backups", "ossd-course-portal", "bbi2o-video-remux-originals", timestamp);
const reportPath = resolve(projectRoot, "deployment", "bbi2o-video-remux-report.json");
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
const apply = process.argv.includes("--apply");
const includeWebm = process.argv.includes("--include-webm");

function toPosix(value) { return String(value || "").replaceAll("\\", "/"); }
function walkFiles(dir, result = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, result);
    else if (/\.(mp4|webm|mov|m4v)$/i.test(entry.name)) result.push(full);
  }
  return result;
}
function boxPositions(file, marker, max = 5) {
  const b = readFileSync(file);
  const out = [];
  let i = 0;
  while ((i = b.indexOf(marker, i)) >= 0 && out.length < max) {
    out.push(i);
    i += marker.length;
  }
  return out;
}
function inspect(file) {
  const ext = extname(file).toLowerCase();
  const moof = boxPositions(file, "moof", 3);
  const mfra = boxPositions(file, "mfra", 3);
  const sidx = boxPositions(file, "sidx", 3);
  const moov = boxPositions(file, "moov", 3);
  const mdat = boxPositions(file, "mdat", 3);
  return {
    ext,
    sizeBytes: statSync(file).size,
    moov: moov[0] ?? -1,
    mdat: mdat[0] ?? -1,
    firstMoof: moof[0] ?? -1,
    moofFound: moof.length > 0,
    mfra: mfra[0] ?? -1,
    sidx: sidx[0] ?? -1,
    fragmented: moof.length > 0 || mfra.length > 0,
  };
}
function sha256(file) {
  const h = createHash("sha256");
  h.update(readFileSync(file));
  return h.digest("hex");
}
function probe(file) {
  const result = spawnSync(ffprobePath, ["-v", "error", "-show_entries", "format=duration,size,bit_rate", "-show_entries", "stream=index,codec_type,codec_name,width,height,duration", "-of", "json", file], { encoding: "utf8", windowsHide: true });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: (result.stderr || result.stdout || `ffprobe exited ${result.status}`).trim() };
  return { ok: true, data: JSON.parse(result.stdout || "{}") };
}
function runFfmpeg(input, output) {
  const result = spawnSync(ffmpegPath, ["-y", "-i", input, "-map", "0", "-c", "copy", "-movflags", "+faststart", output], { encoding: "utf8", windowsHide: true });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `ffmpeg exited ${result.status}`).trim());
}
function updateManifestBytes(manifestPath, fileSizesByRelPath) {
  if (!existsSync(manifestPath)) return { updated: 0, exists: false };
  const json = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  let updated = 0;
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const p = toPosix(value.path || "");
    if (p && fileSizesByRelPath.has(p)) {
      const nextBytes = fileSizesByRelPath.get(p);
      if (value.bytes !== nextBytes) {
        value.bytes = nextBytes;
        updated += 1;
      }
    }
    Object.values(value).forEach(visit);
  }
  visit(json);
  if (apply && updated) writeFileSync(manifestPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return { updated, exists: true };
}

if (!existsSync(courseRoot)) throw new Error(`Missing BBI2O course root: ${courseRoot}`);
const files = walkFiles(courseRoot).sort((a, b) => a.localeCompare(b));
const rows = [];
const changedSizes = new Map();
for (const file of files) {
  const rel = toPosix(relative(courseRoot, file));
  const before = inspect(file);
  const shouldRemux = before.ext === ".mp4" && before.fragmented;
  const shouldCopyWebm = includeWebm && before.ext === ".webm";
  const row = { rel, action: shouldRemux ? (apply ? "remuxed" : "would-remux") : shouldCopyWebm ? "webm-reviewed" : "skipped", before };
  if (shouldRemux && apply) {
    const backupPath = resolve(backupRoot, rel);
    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(file, backupPath);
    const output = `${file}.remux-${timestamp}.mp4`;
    runFfmpeg(file, output);
    const afterProbe = probe(output);
    if (!afterProbe.ok) throw new Error(`ffprobe failed for ${output}: ${afterProbe.error}`);
    const after = inspect(output);
    if (after.fragmented) throw new Error(`Remux output is still fragmented: ${output}`);
    if (after.ext !== ".mp4") throw new Error(`Unexpected output extension for ${output}`);
    renameSync(output, file);
    row.backupPath = backupPath;
    row.after = inspect(file);
    row.afterProbe = afterProbe.data;
    row.sha256 = sha256(file);
    changedSizes.set(rel, row.after.sizeBytes);
  }
  rows.push(row);
}

const manifestUpdate = updateManifestBytes(resolve(courseRoot, "course-manifest.json"), changedSizes);
const stagingUpdates = [];
if (apply && existsSync(stagingRoot)) {
  for (const [rel] of changedSizes) {
    const source = resolve(courseRoot, rel);
    const target = resolve(stagingRoot, rel);
    if (!existsSync(target)) continue;
    copyFileSync(source, target);
    stagingUpdates.push(toPosix(rel));
  }
  stagingUpdates.push(`manifest:${updateManifestBytes(resolve(stagingRoot, "course-manifest.json"), changedSizes).updated}`);
}
const summary = {
  course: "BBI2O",
  apply,
  backupRoot: apply ? backupRoot : null,
  totalVideos: rows.length,
  remuxCandidates: rows.filter((r) => r.action === "would-remux" || r.action === "remuxed").length,
  remuxed: rows.filter((r) => r.action === "remuxed").length,
  skipped: rows.filter((r) => r.action === "skipped").length,
  manifestUpdate,
  stagingUpdates,
  reportPath,
  rows,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...summary, rows: undefined }, null, 2));
