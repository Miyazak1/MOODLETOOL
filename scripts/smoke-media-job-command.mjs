import assert from "node:assert/strict";
import { mediaJobCommand } from "./lib/media-job-command.mjs";

const defaults = {
  coursewareRoot: "/courseware",
  bucket: "oss://moodletool",
  cdnBaseUrl: "https://cdn.moodletool.work/courseware-active",
  assetMode: "hybrid",
  assetScope: "playable",
  registry: "/app/deployment/asset-registry.json",
  ffmpeg: "/usr/bin/ffmpeg",
  ffprobe: "/usr/bin/ffprobe",
  ossutil: "ossutil",
  uploadsRoot: "/app/data/oss-uploads",
};

function command(job) {
  return mediaJobCommand(job, defaults);
}

assert.deepEqual(command({ type: "audit-videos", scope: "course", course: "ENG4U" }), [
  "scripts/audit-video-bitrate.mjs",
  "--course",
  "ENG4U",
  "--courseware-root",
  "/courseware",
  "--ffprobe",
  "/usr/bin/ffprobe",
]);

assert.deepEqual(command({ type: "optimize-videos", scope: "all", course: "", params: { applyOptimize: false, audit: "/tmp/audit.json" } }), [
  "scripts/optimize-video-bitrate.mjs",
  "--dry-run",
  "--all",
  "--ffmpeg",
  "/usr/bin/ffmpeg",
  "--ffprobe",
  "/usr/bin/ffprobe",
  "--audit",
  "/tmp/audit.json",
]);

assert.deepEqual(command({ type: "sync-oss", scope: "course", course: "ENG3U", params: { applyOss: true } }), [
  "scripts/sync-courseware-oss.mjs",
  "--apply",
  "--course",
  "ENG3U",
  "--courseware-root",
  "/courseware",
  "--bucket",
  "oss://moodletool",
  "--cdn-base-url",
  "https://cdn.moodletool.work/courseware-active",
  "--registry",
  "/app/deployment/asset-registry.json",
  "--asset-scope",
  "playable",
  "--ossutil",
  "ossutil",
]);

assert.deepEqual(command({ type: "index-oss", scope: "course", course: "MHF4U", params: { applyOss: true } }), [
  "scripts/index-oss-courseware-assets.mjs",
  "--apply",
  "--course",
  "MHF4U",
  "--bucket",
  "oss://moodletool",
  "--cdn-base-url",
  "https://cdn.moodletool.work/courseware-active",
  "--registry",
  "/app/deployment/asset-registry.json",
  "--asset-scope",
  "playable",
  "--ossutil",
  "ossutil",
]);

assert.deepEqual(command({ type: "publish-upload", scope: "course", course: "ESLDO", params: { uploadId: "upl-1" } }), [
  "scripts/run-oss-upload-media-pipeline.mjs",
  "--upload",
  "upl-1",
  "--uploads-root",
  "/app/data/oss-uploads",
  "--courseware-root",
  "/courseware",
  "--bucket",
  "oss://moodletool",
  "--cdn-base-url",
  "https://cdn.moodletool.work/courseware-active",
  "--registry",
  "/app/deployment/asset-registry.json",
  "--asset-scope",
  "playable",
  "--ossutil",
  "ossutil",
]);

assert.deepEqual(command({ type: "check-readiness", scope: "all", course: "" }), [
  "scripts/check-media-delivery-readiness.mjs",
  "--bucket",
  "oss://moodletool",
  "--cdn-base-url",
  "https://cdn.moodletool.work/courseware-active",
  "--asset-mode",
  "hybrid",
  "--ffmpeg",
  "/usr/bin/ffmpeg",
  "--ffprobe",
  "/usr/bin/ffprobe",
  "--ossutil",
  "ossutil",
]);

const publishAll = command({ type: "publish-all", scope: "all", course: "", params: { skipPreheat: true } });
assert.equal(publishAll[0], "scripts/run-media-delivery-pipeline.mjs");
assert.ok(publishAll.includes("--all"));
assert.ok(publishAll.includes("--apply-optimize"));
assert.ok(publishAll.includes("--apply-oss"));
assert.ok(publishAll.includes("--skip-preheat"));
assert.ok(publishAll.includes("--asset-scope"));

console.log("smoke-media-job-command ok");
