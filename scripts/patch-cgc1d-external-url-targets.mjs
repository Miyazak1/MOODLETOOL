import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "CGC1D");
const manifestPath = join(courseRoot, "course-manifest.json");

const TARGETS = {
  4389: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/CGC1D%20Achievement%20Chart.pdf",
  4396: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Week%201%20unit%201/About%20Canada_Unit%201.pdf",
  4397: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Week%201%20unit%201/Ecozones%20and%20maps--Unit%201.pdf",
  4398: "https://drive.google.com/file/d/1I2szv2Ic0Mv-HFfnKTLFoE5qCYNGaVZK/view?usp=drive_link",
  4399: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Week%201%20unit%201/LatitudeLongitude-Unit%201.pdf",
  4400: "https://www.britannica.com/video/land-Earth-continents-positions-landmass-Pangea/-182539",
  4401: "https://www.youtube.com/watch?v=rokWdaGc3u4",
  4402: "https://www.youtube.com/watch?v=R-Iak3Wvh9c",
  4403: "https://www.youtube.com/watch?v=FqJrmnQ9sBs",
  4420: "https://www.youtube.com/watch?v=rWp5ZpJAIAE",
  4430: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/unit%202%20week3/CULTURAL%20CONNECTIONS.pdf",
  4431: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/unit%202%20week3/Rural%20Settlements-Unit%202.pdf",
  4432: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/unit%202%20week3/Study%20Of%20population-unit2.pdf",
  4447: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Location%20Factors.pdf",
  4448: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Canadian%20Industries%20.pdf",
  4449: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Urbanization.pdf",
  4450: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Energy.pdf",
  4451: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Canadian%20Industries%20.pdf",
  4452: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Urban%20Land%20Use.pdf",
  4454: "https://www.youtube.com/watch?v=fKnAJCSGSdk&t=147s",
  4473: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Unit%204/Canada%20and%20the%20World%20Community.pdf",
  4474: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Unit%204/Canada%27s%20International%20Relationships.pdf",
  4480: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Unit%204/Canada%27s%20Trade.pdf",
  4481: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Lessons/Unit%204/Our%20Cultural%20Connections.pdf",
  4492: "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/Soha%20Sadegi/CGC1D/Infographic%20Template.pdf",
};

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "resource";
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function activityId(item) {
  return String(item.url || item.source || item.path || "").match(/(?:id=|\/[^/-]+-)(\d+)-/)?.[1]
    || String(item.url || item.source || "").match(/id=(\d+)/)?.[1]
    || String(item.path || "").match(/-(\d+)-[0-9a-f]{10}\//)?.[1]
    || "";
}

function collectItems(manifest) {
  const rows = [];
  for (const item of manifest.courseDownloads || []) rows.push(item);
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) rows.push(item);
    }
  }
  return rows.filter((item) => item?.category === "moodle_url");
}

function standaloneHtml(title, externalUrl) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    a { color: #00396f; font-weight: 700; }
    .button { display: inline-block; border: 1px solid #8db0d7; border-radius: 6px; padding: 8px 12px; background: #f4f9ff; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <p><a class="button" href="${htmlEscape(externalUrl, true)}" target="_blank" rel="noopener">Open external resource</a></p>
    </article>
  </main>
</body>
</html>
`;
}

function filenameFromUrl(url, fallback) {
  try {
    const decoded = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    return decoded || fallback;
  } catch {
    return fallback;
  }
}

function isDownloadableFileUrl(url) {
  return [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png"].includes(extname(new URL(url).pathname).toLowerCase());
}

async function downloadExternalFile(item, id, externalUrl) {
  const response = await fetch(externalUrl, { headers: { "user-agent": "ossd-course-portal-external-localizer/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = filenameFromUrl(externalUrl, `${sanitizeSegment(item.label)}.bin`);
  const ext = extname(filename).replace(".", "").toLowerCase() || "bin";
  if (ext === "pdf" && !(buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46)) {
    throw new Error("downloaded file is not a PDF");
  }
  const rel = toPosix(join("localized-external-resources", "url", `${id}-${hashText(externalUrl)}`, `${hashText(externalUrl)}-${sanitizeSegment(filename)}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
  item.path = rel;
  item.type = ext;
  item.bytes = buffer.length;
  item.externalUrl = externalUrl;
  item.source = item.source || item.url || `Moodle URL activity ${id}`;
  delete item.url;
  return { mode: "downloaded-file", id, label: item.label, path: rel, type: ext, bytes: buffer.length };
}

function patchExternalPage(item, id, externalUrl) {
  item.externalUrl = externalUrl;
  item.source = item.source || item.url || `Moodle URL activity ${id}`;
  if (!item.path) {
    item.path = toPosix(join("localized-moodle-activities", "url", `course-${id}-${hashText(item.source)}`, "index.html"));
    item.type = "html";
    delete item.url;
  }
  const abs = join(courseRoot, item.path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, standaloneHtml(item.label || "External Resource", externalUrl), "utf8");
  item.type = "html";
  item.bytes = statSync(abs).size;
  delete item.url;
  return { mode: "external-page", id, label: item.label, path: item.path, type: "html", bytes: item.bytes };
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const patched = [];
const failures = [];

for (const item of collectItems(manifest)) {
  const id = activityId(item);
  const externalUrl = TARGETS[id];
  if (!externalUrl) continue;
  try {
    patched.push(isDownloadableFileUrl(externalUrl)
      ? await downloadExternalFile(item, id, externalUrl)
      : patchExternalPage(item, id, externalUrl));
  } catch (error) {
    failures.push({ id, label: item.label, externalUrl, error: error?.message || String(error) });
    patched.push(patchExternalPage(item, id, externalUrl));
  }
}

manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ patched: patched.length, downloadedFiles: patched.filter((x) => x.mode === "downloaded-file").length, externalPages: patched.filter((x) => x.mode === "external-page").length, failures }, null, 2));
