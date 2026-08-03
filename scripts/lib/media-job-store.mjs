import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function safeSegment(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\\/]+/g, "-")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+$/, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
}

function readJsonFile(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJsonFile(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function mediaJobIndexItem(job) {
  return {
    id: job.id,
    type: job.type,
    scope: job.scope,
    course: job.course || "",
    status: job.status,
    requestedBy: job.requestedBy,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    pid: job.pid || null,
    exitCode: job.exitCode ?? null,
    summary: job.summary || null,
    error: job.error || null,
  };
}

export function interruptedMediaJob(job, now = new Date().toISOString()) {
  if (!["running", "cancelling"].includes(job?.status)) return job;
  return {
    ...job,
    status: "interrupted",
    finishedAt: now,
    error: "The server restarted while this media job was running. Check OSS/CDN manually before retrying.",
    pid: null,
  };
}

export function createMediaJobStore({ dataRoot, indexPath, indexLimit = 200 } = {}) {
  if (!dataRoot) throw new Error("dataRoot is required.");
  if (!indexPath) throw new Error("indexPath is required.");

  function jobDir(id) {
    return join(dataRoot, safeSegment(id));
  }

  function jobPath(id, name) {
    return join(jobDir(id), name);
  }

  function readIndex() {
    return readJsonFile(indexPath, { schemaVersion: 1, updatedAt: "", jobs: [] });
  }

  function writeIndex(jobs) {
    const items = [...jobs]
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))
      .map(mediaJobIndexItem)
      .slice(0, Math.max(1, indexLimit));
    writeJsonFile(indexPath, { schemaVersion: 1, updatedAt: new Date().toISOString(), jobs: items });
    return items;
  }

  function writeJob(job) {
    if (!job?.id) throw new Error("Media job id is required.");
    mkdirSync(jobDir(job.id), { recursive: true });
    writeJsonFile(jobPath(job.id, "job.json"), job);
    return job;
  }

  function writeJobAndIndex(job, jobs) {
    writeJob(job);
    writeIndex(jobs);
    return job;
  }

  function writeReport(job, publicJob) {
    writeJsonFile(jobPath(job.id, "report.json"), publicJob);
    return publicJob;
  }

  function readJob(id, fallback = null) {
    return readJsonFile(jobPath(id, "job.json"), fallback);
  }

  function loadJobs({ now = new Date().toISOString() } = {}) {
    mkdirSync(dataRoot, { recursive: true });
    const index = readIndex();
    const jobs = [];
    for (const item of index.jobs || []) {
      const loaded = readJob(item.id, item);
      if (!loaded?.id) continue;
      jobs.push(interruptedMediaJob(loaded, now));
    }
    return jobs;
  }

  return {
    dataRoot,
    indexPath,
    jobDir,
    jobPath,
    readIndex,
    writeIndex,
    writeJob,
    writeJobAndIndex,
    writeReport,
    readJob,
    loadJobs,
  };
}
