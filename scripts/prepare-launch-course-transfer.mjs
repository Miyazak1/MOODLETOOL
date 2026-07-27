import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(process.env.COURSE_ACTIVE_ROOT || join(workspaceRoot, "courseware"));
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const outputJsonPath = join(projectRoot, "deployment", "launch-course-transfer-plan.json");
const outputMdPath = join(projectRoot, "deployment", "launch-course-transfer-plan.md");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function courseList() {
  return (readArg("--courses") || process.env.LAUNCH_COURSES || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function localCourseRoot(courseEntry) {
  if (!courseEntry.baseUrl?.startsWith("/courseware/")) return null;
  return resolve(coursewareRoot, courseEntry.baseUrl.replace(/^\/courseware\/?/i, ""));
}

function walk(root) {
  const stack = [root];
  const largest = [];
  let files = 0;
  let directories = 0;
  let bytes = 0;

  while (stack.length) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      directories += 1;
      for (const entry of readdirSync(current)) stack.push(join(current, entry));
      continue;
    }
    files += 1;
    bytes += stats.size;
    largest.push({
      path: relative(root, current).replaceAll("\\", "/"),
      bytes: stats.size,
    });
  }

  largest.sort((a, b) => b.bytes - a.bytes);
  return {
    files,
    directories,
    bytes,
    largestFiles: largest.slice(0, 20),
  };
}

function sizeGb(bytes) {
  return Number((bytes / 1024 / 1024 / 1024).toFixed(2));
}

function psQuote(value) {
  return `"${String(value).replaceAll('"', '`"')}"`;
}

function shQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function coursePlan(code, entry, targetRoot) {
  const sourceRoot = localCourseRoot(entry);
  const targetPath = `${targetRoot.replace(/\/+$/, "")}/${code}`;
  const blockers = [];
  if (!sourceRoot) blockers.push(`${code} catalog baseUrl is not a local /courseware/ URL.`);
  if (sourceRoot && !existsSync(sourceRoot)) blockers.push(`${code} local source folder is missing: ${sourceRoot}`);
  if (sourceRoot && !existsSync(join(sourceRoot, "course-manifest.json"))) blockers.push(`${code} is missing course-manifest.json in source folder.`);

  const stats = blockers.length ? { files: 0, directories: 0, bytes: 0, largestFiles: [] } : walk(sourceRoot);
  return {
    code,
    title: entry.title,
    sourceRoot,
    targetPath,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    stats: {
      ...stats,
      sizeGb: sizeGb(stats.bytes),
    },
    commands: sourceRoot
      ? {
          rcloneSftp: `rclone copy ${psQuote(sourceRoot)} ${psQuote(`<server-sftp-remote>:${targetPath}`)} --transfers 4 --checkers 8 --progress --log-file ${psQuote(`deployment/logs/${code}-course-transfer.log`)} --log-level INFO`,
          rsync: `rsync -avh --partial --progress ${shQuote(`${sourceRoot.replaceAll("\\", "/")}/`)} ${shQuote(`root@your-server:${targetPath}/`)}`,
          serverVerify: `test -f ${shQuote(`${targetPath}/course-manifest.json`)} && find ${shQuote(targetPath)} -type f | wc -l`,
        }
      : {},
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Launch Course Transfer Plan",
    "",
    `Generated: ${report.generatedAt}`,
    `Target root: ${report.targetRoot}`,
    `Courses: ${report.courses.join(", ")}`,
    `Status: ${report.status}`,
    "",
    "| Course | Status | Files | Dirs | Size GB | Local Source | Server Target |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
  ];
  for (const course of report.plans) {
    lines.push(`| ${course.code} | ${course.status} | ${course.stats.files} | ${course.stats.directories} | ${course.stats.sizeGb} | ${course.sourceRoot || ""} | ${course.targetPath} |`);
  }
  lines.push("");

  if (report.blockers.length) {
    lines.push("## Blockers", "");
    for (const item of report.blockers) lines.push(`- ${item.course}: ${item.message}`);
    lines.push("");
  }

  lines.push("## Upload Commands", "");
  lines.push("Use one command per course. `rclone` over SFTP is the most convenient from Windows after configuring a remote.");
  lines.push("");
  for (const course of report.plans.filter((item) => item.status === "ready")) {
    lines.push(`### ${course.code}`, "");
    lines.push("PowerShell / rclone:");
    lines.push("");
    lines.push("```powershell");
    lines.push(course.commands.rcloneSftp);
    lines.push("```");
    lines.push("");
    lines.push("Linux/macOS rsync alternative:");
    lines.push("");
    lines.push("```bash");
    lines.push(course.commands.rsync);
    lines.push("```");
    lines.push("");
    lines.push("Server verification:");
    lines.push("");
    lines.push("```bash");
    lines.push(course.commands.serverVerify);
    lines.push("```");
    lines.push("");
    if (course.stats.largestFiles.length) {
      lines.push("Largest files:");
      for (const file of course.stats.largestFiles.slice(0, 5)) {
        lines.push(`- ${file.path}: ${Math.round((file.bytes / 1024 / 1024) * 10) / 10} MB`);
      }
      lines.push("");
    }
  }

  lines.push("## After Upload", "");
  lines.push("```bash");
  lines.push(`cd /www/wwwroot/ossd-course-portal`);
  lines.push(`npm run check:launch-courses -- --courses ${report.courses.join(",")}`);
  lines.push(`npm run smoke:deployed-site -- --base-url https://your-domain --username teacher1 --password TEACHER_PASSWORD --course ${report.courses[0] || "ENG3U"}`);
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const courses = courseList();
if (!courses.length) {
  console.error("Usage: node scripts/prepare-launch-course-transfer.mjs --courses ENG3U,ESLEO");
  process.exit(2);
}

const targetRoot = readArg("--target-root") || process.env.COURSE_TRANSFER_TARGET_ROOT || "/www/wwwroot/ossd-portal/courseware-active";
const catalog = readJson(catalogPath);
const plans = courses.map((code) => {
  const entry = (catalog.courses || []).find((item) => String(item.code || "").toUpperCase() === code);
  if (!entry) {
    return {
      code,
      title: "",
      sourceRoot: null,
      targetPath: `${targetRoot.replace(/\/+$/, "")}/${code}`,
      status: "blocked",
      blockers: [`${code} is missing from public/course-catalog.json.`],
      stats: { files: 0, directories: 0, bytes: 0, sizeGb: 0, largestFiles: [] },
      commands: {},
    };
  }
  return coursePlan(code, entry, targetRoot);
});

const blockers = plans.flatMap((plan) => plan.blockers.map((message) => ({ course: plan.code, message })));
const report = {
  generatedAt: new Date().toISOString(),
  status: blockers.length ? "blocked" : "ready",
  targetRoot,
  courses,
  totals: {
    courses: plans.length,
    files: plans.reduce((sum, item) => sum + item.stats.files, 0),
    directories: plans.reduce((sum, item) => sum + item.stats.directories, 0),
    bytes: plans.reduce((sum, item) => sum + item.stats.bytes, 0),
    sizeGb: sizeGb(plans.reduce((sum, item) => sum + item.stats.bytes, 0)),
    blockers: blockers.length,
  },
  blockers,
  plans,
};

mkdirSync(dirname(outputJsonPath), { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(outputMdPath, renderMarkdown(report), "utf8");

for (const plan of plans) {
  console.log(`${plan.status.toUpperCase()}: ${plan.code} - ${plan.stats.files} file(s), ${plan.stats.sizeGb} GB.`);
}
for (const blocker of blockers) console.log(`BLOCK: ${blocker.course} - ${blocker.message}`);
console.log(`Launch course transfer plan: deployment/launch-course-transfer-plan.md`);
console.log(`Status: ${report.status}; total: ${report.totals.files} file(s), ${report.totals.sizeGb} GB; blockers: ${blockers.length}`);

if (blockers.length) process.exit(1);
