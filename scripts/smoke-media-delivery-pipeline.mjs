import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(projectRoot, "deployment", ".media-delivery-pipeline-smoke");
const coursewareRoot = join(smokeRoot, "courseware");
const courseRoot = join(coursewareRoot, "PIPE");
const dataRoot = join(courseRoot, "Unit 1", "Lesson 1", "html5-package", "data");
const auditPath = join(smokeRoot, "audit.json");
const registryPath = join(smokeRoot, "asset-registry.json");

function assertInside(parent, child, label) {
  const rel = relative(parent, child);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error(`${label} is outside expected root: ${child}`);
}

function run(args) {
  const result = spawnSync(process.execPath, ["scripts/run-media-delivery-pipeline.mjs", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Pipeline smoke failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

assertInside(projectRoot, smokeRoot, "smoke output");
if (existsSync(smokeRoot)) rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(dataRoot, { recursive: true });

try {
  const videoPath = join(dataRoot, "tiny.mp4");
  writeFileSync(join(courseRoot, "course-manifest.json"), JSON.stringify({ units: [] }, null, 2), "utf8");
  writeFileSync(join(courseRoot, "index.html"), "<!doctype html><title>PIPE</title>", "utf8");
  writeFileSync(videoPath, "not a real video; pipeline smoke uses a prepared audit", "utf8");
  writeFileSync(
    auditPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        coursewareRoot,
        ffprobe: "smoke",
        thresholds: {},
        summary: { courses: 1, files: 1, byStatus: { ok: 1 } },
        courses: [
          {
            course: "PIPE",
            videos: [
              {
                course: "PIPE",
                path: "Unit 1/Lesson 1/html5-package/data/tiny.mp4",
                absolutePath: videoPath,
                filename: "tiny.mp4",
                extension: ".mp4",
                sizeBytes: 48,
                sizeMb: 0.01,
                status: "ok",
                durationSeconds: 1,
                bitrateMbps: 0.4,
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const stdout = run([
    "--course",
    "PIPE",
    "--courseware-root",
    coursewareRoot,
    "--skip-audit",
    "--audit",
    auditPath,
    "--registry",
    registryPath,
    "--bucket",
    "oss://pipeline-smoke",
    "--cdn-base-url",
    "https://cdn.example.com/courseware-active",
    "--asset-mode",
    "hybrid",
    "--ffprobe",
    process.execPath,
    "--ffmpeg",
    process.execPath,
    "--ossutil",
    process.execPath,
  ]);
  if (!stdout.includes('"status": "ready"') && !stdout.includes('"status": "ready-with-warnings"')) {
    throw new Error(`Unexpected pipeline smoke output:\n${stdout}`);
  }
  console.log("Media delivery pipeline smoke passed.");
} finally {
  if (!process.argv.includes("--keep-output") && existsSync(smokeRoot)) {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}
