import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const queuePath = join(projectRoot, "inbox", "moodle-course-document-queue.csv");
const reportPath = join(projectRoot, "deployment", "moodle-document-download-report.json");
const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const courseArg = readArg("--course");
const selectedCourses = new Set(
  String(courseArg || "")
    .split(",")
    .map((course) => course.trim().toUpperCase())
    .filter(Boolean),
);
const moodleCookie = process.env.MOODLE_COOKIE || "";

if (process.argv.includes("--help")) {
  console.log(`Usage: node scripts/download-moodle-document-queue.mjs [--dry-run] [--force] [--course COURSE[,COURSE]]

Downloads ready Moodle document queue rows into courseware/<COURSE>/plans/course/.

Options:
  --dry-run  Plan actions without fetching Moodle URLs or writing course files.
  --force    Do not skip courses that already have local course outlines.
  --course   Limit processing to one course code or a comma-separated list.

Environment:
  MOODLE_COOKIE  Optional Moodle session Cookie header for authenticated downloads.
`);
  process.exit(0);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function readCsv(path) {
  if (!existsSync(path)) fail(`Missing queue: ${path}`);
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileType(path) {
  return extname(path).replace(".", "").toLowerCase() || "file";
}

function cleanLabel(filename) {
  return filename.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasLocalCourseOutline(manifest) {
  return (manifest.courseDownloads || []).some((item) => item.role === "course_outline" && item.path);
}

function manifestOutlineMode(manifest) {
  const outline = (manifest.courseDownloads || []).find((item) => item.role === "course_outline");
  if (!outline) return "missing";
  if (outline.path) return "local";
  if (outline.url) return "remote";
  return "unknown";
}

function updateManifestCourseOutline(course, targetPath, row) {
  const manifestPath = join(coursewareRoot, course, "course-manifest.json");
  if (!existsSync(manifestPath)) return { updated: false, reason: "manifest-missing" };
  const manifest = readJson(manifestPath);
  const relativePath = targetPath.replace(`${join(coursewareRoot, course)}\\`, "").replaceAll("\\", "/");
  const record = {
    label: cleanLabel(row.targetFilename),
    type: fileType(targetPath),
    category: "course_document",
    role: "course_outline",
    path: relativePath,
    bytes: statSync(targetPath).size,
    source: row.url,
  };
  const downloads = manifest.courseDownloads || [];
  const index = downloads.findIndex((item) => item.role === "course_outline");
  if (index >= 0) {
    downloads[index] = { ...downloads[index], ...record };
  } else {
    downloads.push(record);
  }
  manifest.courseDownloads = downloads;
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { updated: true, reason: "manifest-patched" };
}

function rebuildPlanManifest(course, hadPlansRootBeforeDownload) {
  if (!hadPlansRootBeforeDownload) return { rebuilt: false, reason: "plans-missing-before-download" };
  const plansRoot = join(coursewareRoot, course, "plans");
  if (!existsSync(plansRoot)) return { rebuilt: false, reason: "plans-missing" };
  const result = spawnSync("python", ["tools/build_plan_course_manifest.py", "--course", course], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    return {
      rebuilt: false,
      reason: "rebuild-failed",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  return { rebuilt: true, reason: "rebuilt" };
}

async function downloadFile(row, targetPath) {
  const headers = {
    "User-Agent": "ossd-course-portal-document-import/1.0",
  };
  if (moodleCookie) headers.Cookie = moodleCookie;
  const response = await fetch(row.url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const textProbe = Buffer.from(bytes.slice(0, Math.min(bytes.length, 512))).toString("utf8");
  if (/text\/html/i.test(contentType)) {
    throw new Error("download returned HTML instead of a document");
  }
  if (/login|password|username|用户名|密码|登录/i.test(textProbe)) {
    throw new Error("download returned a login page instead of a document");
  }
  const suffix = fileType(targetPath);
  const startsWithPk = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const startsWithPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const startsWithOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (suffix === "docx" && !startsWithPk) {
    throw new Error("downloaded file is not a DOCX package");
  }
  if (suffix === "pdf" && !startsWithPdf) {
    throw new Error("downloaded file is not a PDF");
  }
  if (suffix === "doc" && !startsWithOle) {
    throw new Error("downloaded file is not a legacy DOC file");
  }
  if (!dryRun) {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, bytes);
  }
  return { bytes: bytes.length, contentType };
}

const rows = readCsv(queuePath).filter((row) => {
  const course = row.course?.toUpperCase();
  return row.status === "ready" && row.url && (!selectedCourses.size || selectedCourses.has(course));
});
const report = {
  generatedAt: new Date().toISOString(),
  queue: queuePath,
  dryRun,
  force,
  courses: [...selectedCourses],
  moodleCookieConfigured: Boolean(moodleCookie),
  rows: [],
};

for (const row of rows) {
  const course = row.course?.toUpperCase();
  const courseRoot = join(coursewareRoot, course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  const hadPlansRootBeforeDownload = existsSync(join(courseRoot, "plans"));
  const targetPath = join(courseRoot, "plans", "course", row.targetFilename);
  const item = {
    course,
    role: row.role,
    targetPath,
    url: row.url,
    status: "pending",
    notes: [],
  };

  try {
    if (!existsSync(manifestPath)) {
      item.status = "skipped";
      item.notes.push("manifest missing");
      report.rows.push(item);
      continue;
    }
    const manifest = readJson(manifestPath);
    item.manifestOutlineMode = manifestOutlineMode(manifest);
    if (!force && hasLocalCourseOutline(manifest)) {
      item.status = "skipped";
      item.notes.push("local course outline already linked in manifest");
      report.rows.push(item);
      continue;
    }
    if (!force && existsSync(targetPath)) {
      item.status = "skipped";
      item.notes.push("target file already exists");
      report.rows.push(item);
      continue;
    }

    if (dryRun) {
      item.status = "would-download";
      item.notes.push("dry run; Moodle URL was not fetched");
      item.rebuild = hadPlansRootBeforeDownload
        ? { rebuilt: false, reason: "would-rebuild-plan-manifest" }
        : { rebuilt: false, reason: "would-patch-existing-manifest" };
      report.rows.push(item);
      continue;
    }

    const download = await downloadFile(row, targetPath);
    item.download = download;
    const rebuild = rebuildPlanManifest(course, hadPlansRootBeforeDownload);
    item.rebuild = rebuild;
    if (!rebuild.rebuilt && ["plans-missing", "plans-missing-before-download"].includes(rebuild.reason) && !dryRun) {
      item.manifestPatch = updateManifestCourseOutline(course, targetPath, row);
    }
    item.status = "downloaded";
  } catch (error) {
    item.status = "failed";
    item.notes.push(error instanceof Error ? error.message : String(error));
  }
  report.rows.push(item);
}

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const counts = report.rows.reduce((totals, item) => {
  totals[item.status] = (totals[item.status] || 0) + 1;
  return totals;
}, {});

console.log(`Moodle document download queue: ${report.rows.length} ready URL row(s).`);
console.log(`Would download: ${counts["would-download"] || 0}; downloaded: ${counts.downloaded || 0}; skipped: ${counts.skipped || 0}; failed: ${counts.failed || 0}.`);
console.log(`Report: ${reportPath}`);
if (counts.failed) process.exit(1);
