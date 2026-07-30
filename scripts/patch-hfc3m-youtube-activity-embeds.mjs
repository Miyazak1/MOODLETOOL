import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "HFC3M");
const manifestPath = join(courseRoot, "course-manifest.json");

const embedsByActivity = {
  U02L02: [
    {
      title: "Food Trip Around the World | Are You Hungry? | World Song for Kids | Let's Eat Yummy Food | JunyTony",
      youtubeId: "XINl8YvzxMc",
    },
    {
      title: "World Food [Kids Vocab] Yummy Food Around the World",
      youtubeId: "4uuGYHfnVRE",
    },
  ],
  U02L03: [
    {
      title: "Street Food Around the World - HD Documentary International Food",
      youtubeId: "TMjObsW3d5Y",
    },
    {
      title: "Around The World Season 3 Marathon",
      youtubeId: "509uHebkNsI",
    },
  ],
  U02L05: [
    {
      title: "The Geography of Spices and Herbs",
      youtubeId: "E1mMgwp7iaE",
    },
  ],
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

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

function slug(value) {
  return String(value || "youtube-video")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "youtube-video";
}

function youtubeWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function youtubeEmbedUrl(id) {
  return `https://www.youtube.com/embed/${id}`;
}

function renderFigure(video) {
  return `<figure class="youtube-embed" data-hfc3m-youtube="${htmlEscape(video.youtubeId, true)}">
    <iframe src="${htmlEscape(youtubeEmbedUrl(video.youtubeId), true)}" title="${htmlEscape(video.title, true)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
    <figcaption><a href="${htmlEscape(youtubeWatchUrl(video.youtubeId), true)}" target="_blank" rel="noopener">${htmlEscape(video.title)}</a></figcaption>
  </figure>`;
}

function renderEmbedPage(activity, video) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(video.title)}</title>
  <style>
    :root { color-scheme: light; --ink:#142033; --muted:#637083; --line:#d9e2ef; --soft:#f6f8fb; --accent:#0f5fa8; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: var(--soft); color: var(--ink); line-height: 1.6; }
    main { max-width: 1040px; margin: 0 auto; padding: 34px 22px 64px; }
    article { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 26px 28px 30px; box-shadow: 0 1px 2px rgba(16,32,51,.04); }
    h1 { font-size: 30px; line-height: 1.2; margin: 0 0 18px; padding-bottom: 16px; border-bottom: 1px solid #edf1f6; letter-spacing: 0; }
    iframe { width: 100%; aspect-ratio: 16 / 9; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
    a { color: var(--accent); font-weight: 700; }
    .source { margin-top: 16px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(video.title)}</h1>
      ${renderFigure(video)}
      <div class="source">Source: Moodle ${htmlEscape(activity.id)} / ${htmlEscape(activity.title)}</div>
    </article>
  </main>
</body>
</html>
`;
}

function ensureYoutubeStyles(html) {
  if (/\.youtube-embed\b/.test(html)) return html;
  const css = `    .youtube-embed { width: min(100%, 820px); margin: 18px 0 24px; }
    .youtube-embed iframe { width: 100%; aspect-ratio: 16 / 9; min-height: 0; }
    .youtube-embed figcaption { color: var(--muted); font-size: 13px; margin-top: 8px; }
`;
  return html.replace(/(\s*iframe\s*\{[^\n]*\}\r?\n)/, `$1${css}`);
}

function keepSingleYoutubeSection(html, figures) {
  let kept = false;
  return html.replace(/<section class="youtube-activity-media"[\s\S]*?<\/section>/gi, () => {
    if (kept) return "";
    kept = true;
    return figures;
  });
}

function patchActivityHtml(path, videos) {
  const absolute = join(courseRoot, path);
  if (!existsSync(absolute)) return false;
  let html = readFileSync(absolute, "utf8");
  const original = html;

  html = ensureYoutubeStyles(html);
  const figures = `<section class="youtube-activity-media" data-hfc3m-youtube-group="true">
${videos.map(renderFigure).join("\n")}
      </section>`;

  const existingYoutubeBlock = /<section class="youtube-activity-media"[\s\S]*?<\/section>/gi;
  const moodlePlayerBlock = /<div class="mediaplugin[^"]*videojs[^"]*"[^>]*>\s*<div style="max-width:640px;">\s*(?:<aside class="video-placeholder">[\s\S]*?<\/aside>|<section class="youtube-activity-media"[\s\S]*?<\/section>)\s*<\/div>\s*<\/div>/i;

  if (moodlePlayerBlock.test(html)) {
    html = html.replace(moodlePlayerBlock, figures);
    html = keepSingleYoutubeSection(html, figures);
  } else if (/<aside class="video-placeholder">[\s\S]*?<\/aside>/i.test(html)) {
    html = html.replace(/<aside class="video-placeholder">[\s\S]*?<\/aside>/i, figures);
    html = keepSingleYoutubeSection(html, figures);
  } else if (existingYoutubeBlock.test(html)) {
    html = keepSingleYoutubeSection(html, figures);
  } else if (/<div class="moodle-content">[\s\S]*?<\/div>/i.test(html)) {
    html = html.replace(/(<div class="moodle-content">[\s\S]*?<\/div>)/i, `$1\n      ${figures}`);
  } else {
    html = html.replace(/(<h1>[\s\S]*?<\/h1>)/i, `$1\n      ${figures}`);
  }

  if (html === original) return false;
  writeFileSync(absolute, html, "utf8");
  return true;
}

function makeVideoResource(activity, video) {
  const watchUrl = youtubeWatchUrl(video.youtubeId);
  const rel = `localized-moodle-activities/youtube/${activity.id}-${hashText(watchUrl)}-${slug(video.title)}.html`;
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, renderEmbedPage(activity, video), "utf8");
  return {
    label: video.title,
    type: "html",
    category: "external_video",
    role: "video",
    path: rel,
    bytes: statSync(abs).size,
    source: watchUrl,
    sourceStatus: "youtube_embed",
  };
}

function fileCount(items, extension) {
  return items.filter((item) => item.type === extension || item.path?.toLowerCase().endsWith(`.${extension}`)).length;
}

function updateSummaries(manifest) {
  for (const unit of manifest.units || []) {
    const downloads = (unit.lessons || []).flatMap((activity) => activity.downloads || []);
    unit.summary = {
      downloads: downloads.length,
      ispring: 0,
      docx: fileCount(downloads, "docx") + fileCount(downloads, "doc"),
      pdf: fileCount(downloads, "pdf"),
      video: downloads.filter((item) => item.role === "video" || item.role === "video_placeholder" || item.type === "mp4").length,
      h5p: downloads.filter((item) => item.type === "h5p").length,
    };
    for (const activity of unit.lessons || []) {
      activity.resourceCounts = activity.resourceCounts || {};
      activity.resourceCounts.downloads = (activity.downloads || []).length;
      activity.resourceCounts.video = (activity.downloads || []).filter((item) => item.role === "video").length;
      activity.resourceCounts.videoPlaceholders = (activity.downloads || []).filter((item) => item.role === "video_placeholder").length;
      activity.resourceCounts.moodleActivities = (activity.downloads || []).filter((item) => /^moodle_/i.test(item.category || "")).length;
    }
  }
}

const manifest = readJson(manifestPath);
let pagesPatched = 0;
let resourcesAdded = 0;

for (const unit of manifest.units || []) {
  for (const activity of unit.lessons || []) {
    const videos = embedsByActivity[activity.id];
    if (!videos?.length) continue;
    activity.downloads = activity.downloads || [];
    const mainHtml = activity.downloads.find((item) => item.path?.endsWith("/index.html") && /^moodle_/i.test(item.category || ""));
    if (mainHtml?.path && patchActivityHtml(mainHtml.path, videos)) pagesPatched += 1;
    for (const video of videos) {
      const watchUrl = youtubeWatchUrl(video.youtubeId);
      const existing = activity.downloads.find((item) => item.source === watchUrl || item.path?.includes(`${activity.id}-${hashText(watchUrl)}`));
      const resource = makeVideoResource(activity, video);
      if (existing) Object.assign(existing, resource);
      else {
        activity.downloads.push(resource);
        resourcesAdded += 1;
      }
    }
  }
}

manifest.navigation = { ...(manifest.navigation || {}), primary: "unit", secondary: "activity" };
manifest.generatedAt = new Date().toISOString();
updateSummaries(manifest);
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ pagesPatched, resourcesAdded }, null, 2));
