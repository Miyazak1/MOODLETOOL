import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ESLBO");
const manifestPath = join(courseRoot, "course-manifest.json");

const unavailableExternalStatus = {
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Mariia%20Shuma/ESLBO/Singular%20And%20Plural%20Nouns%20_%20The%20Paper%20Cut-outs%20Activity%20_%20Grammar%20_%207%20to%208%20years%20_%20Roving%20Genius.mp4": 403,
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Mariia%20Shuma/ESLBO/Compound%20Nouns%20American%20English%20Lesson.mp4": 403,
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Mariia%20Shuma/ESLBO/Lesson%207%20-%20Count%20and%20noncount%20nouns.mp4": 403,
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Mariia%20Shuma/ESLBO/Synonyms%20for%20Kids%20_%20Classroom%20Edition.mp4": 403,
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/PARUL/ESLBO/News-Article-Analysis_Worksheet.pdf": 403,
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Mariia%20Shuma/ESLBO/All%20Conjunctions%20in%20English%20with%20Examples.mp4": 403,
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Mariia%20Shuma/ESLBO/Lesson%202%20-%20Comparatives%20and%20Superlatives..mp4": 403,
  "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Mariia%20Shuma/ESLBO/Listening%20podcast%20%20Canada%20Government.mp3": 403,
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#160;", " ");
}

function extensionFor(url) {
  const lower = String(url).toLowerCase();
  if (lower.includes(".mp4")) return "mp4";
  if (lower.includes(".mp3")) return "mp3";
  if (lower.includes(".pdf")) return "pdf";
  return "file";
}

function labelForExternal(url) {
  try {
    return decodeURIComponent(basename(new URL(url).pathname));
  } catch {
    return url;
  }
}

function extractExternalRefs(html) {
  const refs = new Map();
  const pattern = /(?:src|href)=["']([^"']*sisonline\.oss-cn-hongkong\.aliyuncs\.com[^"']*)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const source = match[1].replaceAll("&amp;", "&");
    refs.set(source, {
      label: labelForExternal(source),
      type: extensionFor(source),
      source,
      status: unavailableExternalStatus[source] || "unverified",
      availability: unavailableExternalStatus[source] ? "unavailable" : "unverified",
    });
  }
  return [...refs.values()];
}

function extractMoodleContent(html) {
  const match = /<div class=["']moodle-content["'][^>]*>([\s\S]*?)(?:<section class=["']attachments["']|<\/article>)/i.exec(html);
  if (!match) return "";
  return match[1];
}

function textFromMoodleContent(html) {
  let content = extractMoodleContent(html);
  content = content
    .replace(/<video\b[\s\S]*?<\/video>/gi, " ")
    .replace(/<audio\b[\s\S]*?<\/audio>/gi, " ")
    .replace(/<a\b[^>]*sisonline\.oss-cn-hongkong\.aliyuncs\.com[\s\S]*?<\/a>/gi, " ")
    .replace(/<div\b[^>]*id=["']assign_files_tree[\s\S]*?<\/div>\s*<\/div>\s*<\/li>\s*<\/ul>\s*<\/div>/gi, " ")
    .replace(/<img\b[^>]*data-localized-link=["']removed["'][^>]*>/gi, " ")
    .replace(/<a\b[^>]*data-localized-link=["']removed["'][^>]*>([\s\S]*?)<\/a>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(content)
    .replace(/\s+/g, " ")
    .replace(/\(\s*$/, "")
    .replace(/^Watch the tutorials?\s*\(?$/i, "Watch the tutorial.")
    .trim();
}

function relativeAttachmentPath(htmlPath, attachmentPath) {
  const htmlParts = htmlPath.split("/").slice(0, -1);
  const attachmentParts = attachmentPath.split("/");
  while (htmlParts.length && attachmentParts.length && htmlParts[0] === attachmentParts[0]) {
    htmlParts.shift();
    attachmentParts.shift();
  }
  return `${"../".repeat(htmlParts.length)}${attachmentParts.join("/")}`;
}

function renderOldCourseActivity(item, directionText) {
  const files = (item.attachments || [])
    .filter((file) => file.path)
    .map((file) => {
      const href = file.href || relativeAttachmentPath(item.path, file.path);
      return `<li><a href="${htmlEscape(href, true)}" download>${htmlEscape(file.label || basename(file.path))}</a></li>`;
    })
    .join("\n");
  const unavailable = (item.unavailableMedia || [])
    .map((media) => `<li>${htmlEscape(media.label)} <span>(original external ${htmlEscape(media.type)} returned HTTP ${htmlEscape(media.status)})</span></li>`)
    .join("\n");
  const activityText = directionText
    ? `<section class="activity"><h2>Activity</h2><p>${htmlEscape(directionText)}</p></section>`
    : "";
  const unavailableHtml = unavailable
    ? `<section class="notice"><h2>Unavailable Media</h2><ul>${unavailable}</ul></section>`
    : "";
  const filesHtml = files
    ? `<section class="attachments"><h2>Files</h2><ul>${files}</ul></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(item.label)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 900px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    h2 { font-size: 20px; margin: 0 0 10px; }
    section + section { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 16px; }
    a { color: #00396f; font-weight: 700; }
    .notice { border: 1px solid #e0b45c; border-radius: 6px; background: #fff8e8; color: #674000; padding: 12px 14px; }
    .notice span { color: #765100; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(item.label)}</h1>
      ${activityText}
      ${unavailableHtml}
      ${filesHtml}
    </article>
  </main>
</body>
</html>
`;
}

const manifest = readJson(manifestPath);
const unavailable = [];
let rewritten = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    lesson.sections = lesson.sections || [
      { id: "activity", title: "Activity", type: "moodle_activity" },
      { id: "files", title: "Files", type: "downloads" },
    ];
    for (const item of lesson.downloads || []) {
      if (!item.path || item.type !== "html") continue;
      const abs = join(courseRoot, item.path);
      if (!existsSync(abs)) continue;
      const html = readFileSync(abs, "utf8");
      const externalRefs = extractExternalRefs(html);
      if (externalRefs.length) {
        item.unavailableMedia = externalRefs;
        unavailable.push(...externalRefs.map((media) => ({ lesson: lesson.id, activity: item.label, ...media })));
      }
      const directionText = textFromMoodleContent(html);
      writeFileSync(abs, renderOldCourseActivity(item, directionText), "utf8");
      item.bytes = statSync(abs).size;
      rewritten += 1;
    }
  }
}

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  oldCourseStructure: "activity-based Moodle course; lessons group sequential Moodle activities rather than Moodle Books/iSpring lessons",
  externalMediaAuditAt: new Date().toISOString(),
  externalMediaChecked: Object.keys(unavailableExternalStatus).length,
  externalMediaUnavailable: unavailable.length,
  localImportStatus: "activity-based Moodle resources localized; unavailable external OSS media removed from players and recorded in manifest",
};

writeJson(manifestPath, manifest);
writeJson(join(projectRoot, "deployment", "ESLBO-external-media-audit.json"), {
  generatedAt: new Date().toISOString(),
  course: "ESLBO",
  unavailable,
});

console.log(JSON.stringify({ rewritten, unavailable: unavailable.length }, null, 2));
