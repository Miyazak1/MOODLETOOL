export function mediaJobCommand(job, defaults = {}) {
  const p = job.params || {};
  const all = job.scope === "all";
  const course = job.course;
  const coursewareRootArg = p.coursewareRoot || defaults.coursewareRoot;
  const bucketArg = p.bucket || defaults.bucket;
  const cdnArg = p.cdnBaseUrl || defaults.cdnBaseUrl;
  const assetModeArg = p.assetMode || defaults.assetMode;
  const assetScopeArg = p.assetScope || defaults.assetScope;
  const registryArg = p.registry || defaults.registry;
  const ffmpegArg = p.ffmpeg || defaults.ffmpeg;
  const ffprobeArg = p.ffprobe || defaults.ffprobe;
  const ossutilArg = p.ossutil || defaults.ossutil;

  if (job.type === "audit-videos") {
    const args = ["scripts/audit-video-bitrate.mjs"];
    appendCourseArg(args, course, all);
    args.push("--courseware-root", coursewareRootArg, "--ffprobe", ffprobeArg);
    return args;
  }
  if (job.type === "optimize-videos") {
    const args = ["scripts/optimize-video-bitrate.mjs", p.applyOptimize === false ? "--dry-run" : "--apply"];
    appendCourseArg(args, course, all);
    args.push("--ffmpeg", ffmpegArg, "--ffprobe", ffprobeArg);
    if (p.audit) args.push("--audit", p.audit);
    return args;
  }
  if (job.type === "sync-oss") {
    const args = ["scripts/sync-courseware-oss.mjs", p.applyOss === false ? "--dry-run" : "--apply"];
    appendCourseArg(args, course, all);
    args.push("--courseware-root", coursewareRootArg, "--bucket", bucketArg, "--cdn-base-url", cdnArg, "--registry", registryArg, "--asset-scope", assetScopeArg, "--ossutil", ossutilArg);
    return args;
  }
  if (job.type === "index-oss") {
    const args = ["scripts/index-oss-courseware-assets.mjs", p.applyOss === false ? "--dry-run" : "--apply"];
    appendCourseArg(args, course, all);
    args.push("--bucket", bucketArg, "--cdn-base-url", cdnArg, "--registry", registryArg, "--asset-scope", assetScopeArg, "--ossutil", ossutilArg);
    return args;
  }
  if (job.type === "export-cdn-preheat") {
    const args = ["scripts/export-cdn-preheat-list.mjs", "--registry", registryArg, "--cdn-base-url", cdnArg];
    if (!all && course) args.push("--course", course);
    return args;
  }
  if (job.type === "check-readiness") {
    return [
      "scripts/check-media-delivery-readiness.mjs",
      "--bucket",
      bucketArg,
      "--cdn-base-url",
      cdnArg,
      "--asset-mode",
      assetModeArg,
      "--ffmpeg",
      ffmpegArg,
      "--ffprobe",
      ffprobeArg,
      "--ossutil",
      ossutilArg,
    ];
  }
  if (job.type === "publish-upload") {
    const args = ["scripts/run-oss-upload-media-pipeline.mjs", "--upload", p.uploadId || "", "--uploads-root", p.uploadsRoot || defaults.uploadsRoot];
    args.push("--courseware-root", coursewareRootArg, "--bucket", bucketArg, "--cdn-base-url", cdnArg, "--registry", registryArg, "--asset-scope", assetScopeArg, "--ossutil", ossutilArg);
    return args;
  }

  const args = ["scripts/run-media-delivery-pipeline.mjs"];
  appendCourseArg(args, course, job.type === "publish-all");
  args.push("--courseware-root", coursewareRootArg);
  if (p.applyOptimize !== false) args.push("--apply-optimize");
  if (p.applyOss !== false) args.push("--apply-oss");
  if (p.skipPreheat) args.push("--skip-preheat");
  if (p.skipReadiness) args.push("--skip-readiness");
  args.push(
    "--bucket",
    bucketArg,
    "--cdn-base-url",
    cdnArg,
    "--asset-mode",
    assetModeArg,
    "--asset-scope",
    assetScopeArg,
    "--ffmpeg",
    ffmpegArg,
    "--ffprobe",
    ffprobeArg,
    "--ossutil",
    ossutilArg,
  );
  return args;
}

function appendCourseArg(commandArgs, course, all) {
  if (all) commandArgs.push("--all");
  else commandArgs.push("--course", course);
}
