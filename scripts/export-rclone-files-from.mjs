import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const requestedCourse = readArg("--course") || "ENG3U";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const uploadListPath = join(projectRoot, "deployment", `${requestedCourse}-courseware-upload-list.json`);
if (!existsSync(uploadListPath)) {
  console.error(`Missing upload list: ${uploadListPath}`);
  console.error("Run npm.cmd run export:courseware-list first.");
  process.exit(1);
}

const uploadList = JSON.parse(readFileSync(uploadListPath, "utf8"));
const files = (uploadList.files || [])
  .map((item) => item.relativePath)
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b));

const outputPath = join(projectRoot, "deployment", `${requestedCourse}-rclone-files-from.txt`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${files.join("\n")}\n`, "utf8");

console.log(`Wrote ${outputPath}`);
console.log(`${requestedCourse}: ${files.length} files`);
