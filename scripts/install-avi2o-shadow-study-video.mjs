import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "AVI2O");
const manifestPath = path.join(courseRoot, "course-manifest.json");
const htmlRel = "localized-moodle-activities/url/U01L08-13-13-c87cb5d0f2/index.html";
const videos = [
  {
    label: "How-to-Draw-in-Perspective-for-Beginners.mp4",
    href: "files/How-to-Draw-in-Perspective-for-Beginners.mp4",
    path: "localized-moodle-activities/url/U01L08-13-13-c87cb5d0f2/files/How-to-Draw-in-Perspective-for-Beginners.mp4",
    source: "copied from AVI2O Perspective Drawing local video for Shadow Study activity id 13",
    sourceUrl: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/AVI2O/How%20to%20Draw%20in%20Perspective%20for%20Beginners.mp4",
  },
  {
    label: "Shadow-Study.mp4",
    href: "files/Shadow-Study.mp4",
    path: "localized-moodle-activities/url/U01L08-13-13-c87cb5d0f2/files/Shadow-Study.mp4",
    source: "manual Moodle video recovery from docs/videoplayback.mp4 for AVI2O activity id 13",
    sourceUrl: "https://www.youtube.com/watch?v=V3WmrWUEIJo&list=PL0SzeXEfIstUI3ROWpFxWfM97mrLiv1aw",
  },
];

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attachmentsSection() {
  const rows = videos
    .map(
      (video) =>
        `<li><span class="file-label">${escapeHtml(video.label)}</span><span class="file-actions"><a class="file-button" href="${escapeHtml(video.href)}">查看</a><a class="file-button" href="${escapeHtml(video.href)}" download>下载</a></span></li>`,
    )
    .join("\n");
  return `<section class="attachments"><h2>附件</h2>
<ul>
${rows}
</ul>
</section>`;
}

function ensureAttachmentStyles(html) {
  if (html.includes(".attachments {")) return html;
  const css = `
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments h2 { font-size: 14px; color: #32445a; margin: 0 0 8px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .file-label { color: #102033; font-weight: 700; overflow-wrap: anywhere; }
    .file-actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .file-button { border: 1px solid #8db0d7; border-radius: 6px; color: #00396f; padding: 6px 9px; text-decoration: none; }
    .file-button:hover { background: #eef6ff; }
`;
  return html.includes("</style>") ? html.replace("</style>", `${css}\n  </style>`) : html;
}

function upsertAttachmentsSection(html) {
  const section = attachmentsSection();
  if (/<section class="attachments">[\s\S]*?<\/section>/i.test(html)) {
    return html.replace(/<section class="attachments">[\s\S]*?<\/section>/i, section);
  }
  return html.replace(/\s*<\/article>/i, `\n          ${section}\n    </article>`);
}

for (const video of videos) {
  const videoPath = path.join(courseRoot, video.path);
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Missing installed video: ${videoPath}`);
  }
}

const htmlPath = path.join(courseRoot, htmlRel);
let html = fs.readFileSync(htmlPath, "utf8");
const videoCards = `<div class="video-open-list" data-avi2o-video-link="true">
${videos
  .map(
    (video) => `  <a class="video-open-card" href="${escapeHtml(video.href)}" target="_blank" rel="noopener">
    <span class="video-open-title">${escapeHtml(video.label)}</span>
    <span class="video-open-action">播放</span>
  </a>`,
  )
  .join("\n")}
</div>`;
html = html.replace(/<div class="video-open-list"[^>]*>[\s\S]*?<\/div>/i, videoCards);
html = html.replace(/\s*<div class="urlworkaround">[\s\S]*?<\/div>\s*/i, "\n");
html = ensureAttachmentStyles(upsertAttachmentsSection(html));

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
let updated = false;
const videoBytesByPath = new Map(videos.map((video) => [video.path, fs.statSync(path.join(courseRoot, video.path)).size]));

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    if (lesson.title !== "Shadow Study") continue;
    for (const item of lesson.downloads || []) {
      if (item.path !== htmlRel) continue;
      const videoPaths = new Set(videos.map((video) => video.path));
      const attachments = (item.attachments || []).filter((attachment) => !videoPaths.has(attachment.path));
      for (const video of videos) {
        attachments.push({
        label: video.label,
        type: "mp4",
        path: video.path,
        href: video.href,
        bytes: videoBytesByPath.get(video.path),
        source: video.source,
        sourceUrl: video.sourceUrl,
        });
      }
      item.attachments = attachments;
      delete item.unavailableMedia;
      item.bytes = Buffer.byteLength(html);
      item.textPreview = item.textPreview
        ?.replace("How%20to%20Draw%20in%20Perspective%20for%20Beginners.mp4 watch ", "How-to-Draw-in-Perspective-for-Beginners.mp4 Shadow Study.mp4 ")
        ?.replace(" Click on Shadow Study to open the resource.", "");
      updated = true;
    }
  }
}

if (!updated) {
  throw new Error("Could not find AVI2O Shadow Study manifest entry.");
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  avi2oShadowStudyVideoInstall: {
    fixedAt: new Date().toISOString(),
    videos: videos.map((video) => ({
      source: video.source,
      target: video.path,
      bytes: videoBytesByPath.get(video.path),
    })),
    note: "Mounted both local videos required by the AVI2O Shadow Study Moodle activity page.",
  },
};

fs.writeFileSync(htmlPath, html, "utf8");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ videos: videos.map((video) => ({ path: video.path, href: video.href, bytes: videoBytesByPath.get(video.path) })) }, null, 2));
