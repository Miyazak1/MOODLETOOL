import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SNC1D");
const manifestPath = join(courseRoot, "course-manifest.json");
const learningLogRel = "localized-moodle-activities/assign/assign-11085-Learning-Log/index.html";
const learningLogPath = join(courseRoot, learningLogRel);
const sourceFileRel = "localized-moodle-activities/assign/course-6370-f7b8da41ae/files/150c3b9f2a-Learning-Log-Form.pdf";
const targetFileRel = "localized-moodle-activities/assign/assign-11085-Learning-Log/files/150c3b9f2a-Learning-Log-Form.pdf";
const sourceFile = join(courseRoot, sourceFileRel);
const targetFile = join(courseRoot, targetFileRel);

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function href(fromRel, toRel) {
  return toPosix(posix.relative(posix.dirname(toPosix(fromRel)), toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

if (!existsSync(sourceFile)) throw new Error(`Missing source Learning Log PDF: ${sourceFileRel}`);
if (!existsSync(learningLogPath)) throw new Error(`Missing Learning Log page: ${learningLogRel}`);

mkdirSync(dirname(targetFile), { recursive: true });
copyFileSync(sourceFile, targetFile);

const attachment = {
  label: "Learning-Log-Form.pdf",
  type: "pdf",
  category: "moodle_file",
  role: "attachment",
  path: targetFileRel,
  bytes: statSync(targetFile).size,
  source: "http://34.30.231.58/pluginfile.php/12296/mod_assign/introattachment/0/Learning-Log-Form.pdf?forcedownload=1",
  previewPath: targetFileRel,
  downloadPath: targetFileRel,
};

const fileHref = href(learningLogRel, targetFileRel);
let html = readFileSync(learningLogPath, "utf8");
html = html.replace(/\s*<section class="files">[\s\S]*?<\/section>/g, "");
html = html.replace(
  /\s*<\/main>/,
  `
    <section class="files"><h2>Files</h2><div class="file-row"><div class="file-label">Learning-Log-Form.pdf</div><div class="actions"><a class="button" href="${fileHref}">View</a><a class="button" href="${fileHref}" download>Download</a></div></div></section>
  </main>`,
);
writeFileSync(learningLogPath, html, "utf8");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const learningLog = (manifest.courseDownloads || []).find((item) => item.role === "learning_log" && item.label === "Learning Log");
if (!learningLog) throw new Error("Missing courseDownloads Learning Log item in manifest.");
learningLog.attachments = [attachment];
learningLog.bytes = Buffer.byteLength(html, "utf8");
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ patched: learningLog.label, attachment: targetFileRel }, null, 2));
