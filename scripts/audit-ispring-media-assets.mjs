import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course")?.toUpperCase();
if (!course) {
  console.error("Usage: node scripts/audit-ispring-media-assets.mjs --course COURSE");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const ispringRoot = join(courseRoot, "ispring-localized");
const reportPath = join(projectRoot, "deployment", `${course}-ispring-media-asset-audit.json`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

if (!existsSync(ispringRoot)) {
  console.error(`Missing iSpring root: ${ispringRoot}`);
  process.exit(1);
}

const packageDirs = [];
for (const unit of readdirSync(ispringRoot)) {
  const unitDir = join(ispringRoot, unit);
  if (!statSync(unitDir).isDirectory()) continue;
  for (const lesson of readdirSync(unitDir)) {
    const lessonDir = join(unitDir, lesson);
    if (existsSync(join(lessonDir, "presentation.html"))) packageDirs.push(lessonDir);
  }
}

const mediaExts = new Set([".mp4", ".webm", ".m4v", ".mov", ".avi", ".mp3", ".m4a", ".ogg", ".wav"]);
const textExts = new Set([".html", ".js", ".json", ".xml", ".css"]);
const rows = [];

for (const dir of packageDirs) {
  const files = walk(dir);
  let text = "";
  const mediaFiles = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (mediaExts.has(ext)) {
      mediaFiles.push({ path: toPosix(relative(dir, file)), bytes: statSync(file).size });
    }
    if (textExts.has(ext)) {
      try {
        text += `\n${readFileSync(file, "utf8")}`;
      } catch {
        // Ignore unreadable text-like files.
      }
    }
  }

  const mediaRefs = [
    ...new Set(
      [...text.matchAll(/["']([^"']+\.(?:mp4|webm|m4v|mov|avi|mp3|m4a|ogg|wav)(?:\?[^"']*)?)["']/gi)].map((match) =>
        match[1].replaceAll("\\/", "/"),
      ),
    ),
  ];
  const externalUrls = [
    ...new Set([...text.matchAll(/https?:\\?\/\\?\/[^"'\s<>]+/gi)].map((match) => match[0].replaceAll("\\/", "/"))),
  ].filter((url) => /mp4|webm|m4v|mov|youtube|vimeo|video|media|content|cdn|ispring/i.test(url));
  const videoPlaceholders = (text.match(/id=["']vd\d+_/g) || []).length;
  const audioObjects = (text.match(/id=["']ad\d+_/g) || []).length;

  rows.push({
    packagePath: toPosix(relative(ispringRoot, dir)),
    mediaFiles,
    mediaRefs,
    externalUrls,
    videoPlaceholders,
    audioObjects,
    likelyMissingMedia:
      (videoPlaceholders > 0 || audioObjects > 0 || mediaRefs.length > 0 || externalUrls.length > 0) && mediaFiles.length === 0,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  course,
  packages: packageDirs.length,
  packagesWithLocalMedia: rows.filter((row) => row.mediaFiles.length > 0).length,
  packagesWithVideoPlaceholders: rows.filter((row) => row.videoPlaceholders > 0).length,
  packagesWithAudioObjects: rows.filter((row) => row.audioObjects > 0).length,
  packagesWithExternalUrls: rows.filter((row) => row.externalUrls.length > 0).length,
  likelyMissingMedia: rows.filter((row) => row.likelyMissingMedia).length,
  rows: rows.filter(
    (row) =>
      row.mediaFiles.length ||
      row.mediaRefs.length ||
      row.externalUrls.length ||
      row.videoPlaceholders ||
      row.audioObjects ||
      row.likelyMissingMedia,
  ),
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      course,
      packages: report.packages,
      packagesWithLocalMedia: report.packagesWithLocalMedia,
      packagesWithVideoPlaceholders: report.packagesWithVideoPlaceholders,
      packagesWithAudioObjects: report.packagesWithAudioObjects,
      packagesWithExternalUrls: report.packagesWithExternalUrls,
      likelyMissingMedia: report.likelyMissingMedia,
      reportPath: toPosix(relative(projectRoot, reportPath)),
    },
    null,
    2,
  ),
);
