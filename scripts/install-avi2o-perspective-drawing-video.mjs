import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "AVI2O");
const manifestPath = path.join(courseRoot, "course-manifest.json");
const htmlRel = "localized-moodle-activities/url/U01L07-12-12-ceb396aca0/index.html";
const videoRel = "localized-moodle-activities/url/U01L07-12-12-ceb396aca0/files/How-to-Draw-in-Perspective-for-Beginners.mp4";
const videoHref = "files/How-to-Draw-in-Perspective-for-Beginners.mp4";
const sourceUrl =
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/AVI2O/How%20to%20Draw%20in%20Perspective%20for%20Beginners.mp4";

const videoPath = path.join(courseRoot, videoRel);
if (!fs.existsSync(videoPath)) {
  throw new Error(`Missing installed video: ${videoPath}`);
}

const htmlPath = path.join(courseRoot, htmlRel);
let html = fs.readFileSync(htmlPath, "utf8");
html = html.replace(
  /(<a class="video-open-card" href=")[^"]+("[^>]*>\s*<span class="video-open-title">How to Draw in Perspective for Beginners\.mp4<\/span>)/,
  `$1${videoHref}$2`,
);
html = html.replace(
  /\s*<div class="urlworkaround">Click on <a href="https:\/\/www\.youtube\.com\/watch\?v=Xn_0wEwZNEU"[^>]*>Perspective Drawing<\/a> to open the resource\.<\/div>\s*/i,
  "\n",
);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
let updated = false;
const bytes = fs.statSync(videoPath).size;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    if (lesson.title !== "Perspective Drawing") continue;
    for (const item of lesson.downloads || []) {
      if (item.path !== htmlRel) continue;
      const attachments = (item.attachments || []).filter((attachment) => attachment.path !== videoRel);
      attachments.push({
        label: "How-to-Draw-in-Perspective-for-Beginners.mp4",
        type: "mp4",
        path: videoRel,
        href: videoHref,
        bytes,
        source: "manual Moodle video recovery from docs/videoplayback.mp4 for AVI2O activity id 12",
        sourceUrl,
      });
      item.attachments = attachments;
      delete item.unavailableMedia;
      item.bytes = Buffer.byteLength(html);
      updated = true;
    }
  }
}

if (!updated) {
  throw new Error("Could not find AVI2O Perspective Drawing manifest entry.");
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  avi2oPerspectiveDrawingVideoInstall: {
    fixedAt: new Date().toISOString(),
    source: "docs/videoplayback.mp4",
    target: videoRel,
    bytes,
    note: "Moved user-provided Perspective Drawing video into the AVI2O Moodle activity files directory and mounted it as an attachment on the owning HTML activity page.",
  },
};

fs.writeFileSync(htmlPath, html, "utf8");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ videoRel, videoHref, bytes }, null, 2));
