import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const getArg = (name, fallback = undefined) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};

const course = getArg("--course");
if (!course) {
  console.error("Usage: node scripts/audit-ispring-slide-video-coverage.mjs --course COURSE");
  process.exit(1);
}

const workspaceRoot = resolve(getArg("--workspace-root", resolve(process.cwd(), "..")));
const courseRoot = resolve(getArg("--course-root", join(workspaceRoot, "courseware", course)));
const ispringRoot = join(courseRoot, "ispring-localized");

const numberFromName = (name) => Number((name.match(/\d+/) || ["0"])[0]);
const rows = [];

if (!existsSync(ispringRoot)) {
  console.error(`Missing iSpring root: ${ispringRoot}`);
  process.exit(1);
}

for (const unitName of readdirSync(ispringRoot).filter((name) => name.startsWith("unit-")).sort()) {
  const unitDir = join(ispringRoot, unitName);
  for (const lessonName of readdirSync(unitDir).sort()) {
    const dataDir = join(unitDir, lessonName, "data");
    if (!existsSync(dataDir)) continue;

    const files = readdirSync(dataDir);
    const slideFiles = files
      .filter((name) => /^slide\d+\.js$/i.test(name))
      .sort((a, b) => numberFromName(a) - numberFromName(b));
    const mp4Files = files
      .filter((name) => /^video\d+\.mp4$/i.test(name))
      .sort((a, b) => numberFromName(a) - numberFromName(b));

    const slidesWithVideoPlaceholder = [];
    const slidesWithoutVideoPlaceholder = [];
    for (const slideFile of slideFiles) {
      const slideNumber = numberFromName(slideFile);
      const slideJs = readFileSync(join(dataDir, slideFile), "utf8");
      if (slideJs.includes('id="vd')) slidesWithVideoPlaceholder.push(slideNumber);
      else slidesWithoutVideoPlaceholder.push(slideNumber);
    }

    const maxVideoNumber = mp4Files.reduce((max, file) => Math.max(max, numberFromName(file)), 0);
    const missingVideoSequence = [];
    for (let index = 1; index <= maxVideoNumber; index += 1) {
      if (!mp4Files.includes(`video${index}.mp4`)) missingVideoSequence.push(index);
    }

    rows.push({
      package: `${unitName}/${lessonName}`,
      slides: slideFiles.length,
      slidesWithVideoPlaceholder: slidesWithVideoPlaceholder.length,
      slidesWithoutVideoPlaceholder: slidesWithoutVideoPlaceholder.length,
      mp4Files: mp4Files.length,
      maxVideoNumber,
      missingVideoSequence,
      slidesWithoutVideoPlaceholderNumbers: slidesWithoutVideoPlaceholder,
    });
  }
}

const anomalies = rows.filter((row) => (
  row.mp4Files < row.slidesWithVideoPlaceholder
  || row.missingVideoSequence.length > 0
));

const summary = {
  course,
  packages: rows.length,
  totalSlides: rows.reduce((sum, row) => sum + row.slides, 0),
  slidesWithVideoPlaceholder: rows.reduce((sum, row) => sum + row.slidesWithVideoPlaceholder, 0),
  slidesWithoutVideoPlaceholder: rows.reduce((sum, row) => sum + row.slidesWithoutVideoPlaceholder, 0),
  mp4Files: rows.reduce((sum, row) => sum + row.mp4Files, 0),
  anomalies: anomalies.length,
};

console.log(JSON.stringify({ summary, anomalies, rows }, null, 2));
