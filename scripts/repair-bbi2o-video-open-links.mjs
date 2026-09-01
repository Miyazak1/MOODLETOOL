import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "BBI2O", "localized-moodle-activities");

function walkIndexPages(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkIndexPages(full));
    else if (entry.isFile() && entry.name === "index.html") files.push(full);
  }
  return files;
}

function walkDirs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;
    dirs.push(full, ...walkDirs(full));
  }
  return dirs;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileNameFromSrc(src) {
  const clean = String(src || "").split(/[?#]/)[0];
  try {
    return decodeURIComponent(path.posix.basename(clean));
  } catch {
    return path.posix.basename(clean);
  }
}

function titleFromBlock(block, src) {
  const titleMatch = block.match(/\btitle="([^"]+)"/i);
  if (titleMatch) return decodeHtml(titleMatch[1]).trim();
  const captionMatch = block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
  if (captionMatch) return captionMatch[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const anchorMatch = block.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  if (anchorMatch) return anchorMatch[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return fileNameFromSrc(src);
}

function srcFromBlock(block) {
  const sourceMatch = block.match(/<source\b[^>]*\bsrc="([^"]+)"/i);
  if (sourceMatch) return decodeHtml(sourceMatch[1]).trim();
  const videoMatch = block.match(/<video\b[^>]*\bsrc="([^"]+)"/i);
  if (videoMatch) return decodeHtml(videoMatch[1]).trim();
  const dataSrcMatch = block.match(/\bdata-src="([^"]+)"/i);
  if (dataSrcMatch) return decodeHtml(dataSrcMatch[1]).trim();
  return "";
}

function normalizePlayerHref(playerHref, activityDir) {
  const playerPath = path.join(activityDir, decodeHtml(playerHref).replace(/[?#].*$/, ""));
  if (!fs.existsSync(playerPath)) return "";
  const html = fs.readFileSync(playerPath, "utf8");
  const src = srcFromBlock(html);
  if (!src) return "";
  return path.posix.normalize(path.posix.join(path.posix.dirname(playerHref.replace(/\\/g, "/")), src)).replace(/^\.?\//, "");
}

function videoLinkCard(title, href) {
  return `<div class="video-open-list" data-bbi2o-video-link="true">
  <a class="video-open-card" href="${escapeHtml(href)}" target="_blank" rel="noopener">
    <span class="video-open-title">${escapeHtml(title)}</span>
    <span class="video-open-action">播放</span>
  </a>
</div>`;
}

function ensureVideoLinkStyles(html) {
  let nextHtml = html.replace(/\n\s*\.video-open-list \{[\s\S]*?\.video-open-action \{[^}]*\}\s*\n/g, "\n");
  const css = `
    .video-open-list { display: grid; gap: 10px; margin: 16px 0 18px; }
    .video-open-card { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; color: #00396f; display: flex; gap: 12px; justify-content: space-between; padding: 12px 14px; text-decoration: none; }
    .video-open-card:hover { background: #eef6ff; }
    .video-open-title { color: #102033; font-weight: 700; overflow-wrap: anywhere; }
    .video-open-action { border: 1px solid #8db0d7; border-radius: 6px; flex: 0 0 auto; padding: 7px 12px; }
`;
  if (!nextHtml.includes("</style>")) return nextHtml;
  return nextHtml.replace("</style>", `${css}\n  </style>`);
}

function replaceEmbeddedVideoBlocks(html) {
  const blocks = [];
  let nextHtml = html.replace(/<figure\b[^>]*class="[^"]*\bembedded-video\b[^"]*"[^>]*>[\s\S]*?<\/figure>/gi, (block) => {
    blocks.push(block);
    return `@@BBI2O_VIDEO_BLOCK_${blocks.length - 1}@@`;
  });
  nextHtml = nextHtml.replace(/<div\b[^>]*class="[^"]*\bembedded-video\b[^"]*"[^>]*>[\s\S]*?<video\b[\s\S]*?<\/video>[\s\S]*?<\/div>/gi, (block) => {
    blocks.push(block);
    return `@@BBI2O_VIDEO_BLOCK_${blocks.length - 1}@@`;
  });

  const replacements = blocks.map((block) => {
    const src = srcFromBlock(block);
    if (!src) return block;
    return videoLinkCard(titleFromBlock(block, src), src);
  });

  replacements.forEach((replacement, index) => {
    nextHtml = nextHtml.replace(`@@BBI2O_VIDEO_BLOCK_${index}@@`, replacement);
  });
  return { html: nextHtml, count: blocks.length };
}

function replaceTemporaryPlayerLinks(html, activityDir) {
  let count = 0;
  const nextHtml = html.replace(/<div class="video-open-list"[^>]*>\s*<a class="video-open-card" href="(video-players\/[^"]+)"[^>]*>\s*<span class="video-open-title">([\s\S]*?)<\/span>\s*<span class="video-open-action">[\s\S]*?<\/span>\s*<\/a>\s*<\/div>/gi, (block, href, rawTitle) => {
    const normalizedHref = normalizePlayerHref(href, activityDir);
    if (!normalizedHref) return block;
    count += 1;
    return videoLinkCard(decodeHtml(rawTitle.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()), normalizedHref);
  });
  return { html: nextHtml, count };
}

if (!fs.existsSync(courseRoot)) {
  throw new Error(`Missing BBI2O localized Moodle activities directory: ${courseRoot}`);
}

let changedFiles = 0;
let embeddedVideosRewritten = 0;
let temporaryLinksRewritten = 0;

for (const file of walkIndexPages(courseRoot)) {
  const before = fs.readFileSync(file, "utf8");
  const activityDir = path.dirname(file);
  const playerResult = replaceTemporaryPlayerLinks(before, activityDir);
  const videoResult = replaceEmbeddedVideoBlocks(playerResult.html);
  let after = videoResult.html;
  if (playerResult.count || videoResult.count) after = ensureVideoLinkStyles(after);
  if (after === before) continue;
  fs.writeFileSync(file, after, "utf8");
  changedFiles += 1;
  temporaryLinksRewritten += playerResult.count;
  embeddedVideosRewritten += videoResult.count;
}

let removedPlayerDirs = 0;
for (const dir of walkDirs(courseRoot).filter((item) => path.basename(item) === "video-players")) {
  fs.rmSync(dir, { recursive: true, force: true });
  removedPlayerDirs += 1;
}

console.log(JSON.stringify({
  course: "BBI2O",
  changedFiles,
  embeddedVideosRewritten,
  temporaryLinksRewritten,
  removedPlayerDirs,
}, null, 2));
