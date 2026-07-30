import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "HFC3M");
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relativeHref(fromRel, targetRel) {
  return toPosix(relative(dirname(join(courseRoot, fromRel)), join(courseRoot, targetRel)));
}

function resourceLabel(item) {
  return item.label || item.path?.split(/[\\/]/).pop() || "Resource";
}

function fileKind(item) {
  const type = String(item.type || "").toUpperCase();
  if (type === "DOCX" || type === "DOC") return "DOC";
  if (type === "PPTX" || type === "PPT") return "PPT";
  if (type === "PDF") return "PDF";
  if (type === "TIF" || type === "TIFF") return "IMG";
  return type || "FILE";
}

function collectRows(manifest) {
  const rows = [];
  for (const item of manifest.courseDownloads || []) rows.push({ item, owner: "Course" });
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) rows.push({ item, unit, lesson, owner: `${lesson.id} ${lesson.title}` });
    }
  }
  return rows;
}

function placeholderMapForLesson(lesson) {
  const map = new Map();
  for (const item of lesson?.downloads || []) {
    if (item.role !== "video_placeholder" || !item.source) continue;
    map.set(item.source, item);
  }
  return map;
}

function extractMoodleContent(html) {
  return /<div class="moodle-content">([\s\S]*?)(?:<section class="attachments">|<\/article>)/i.exec(html)?.[1]
    || /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1]
    || html;
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function firstMediaUrl(html, pattern) {
  for (const match of html.matchAll(/\b(?:src|href|data-[a-z0-9_-]+)=["']([^"']+)["']/gi)) {
    const url = decodeHtmlAttribute(match[1]);
    if (pattern.test(url)) return url;
  }
  return "";
}

function youtubeEmbedUrl(url) {
  const raw = decodeHtmlAttribute(url);
  try {
    const parsed = new URL(raw);
    if (/youtube\.com$/i.test(parsed.hostname) || /(^|\.)youtube-nocookie\.com$/i.test(parsed.hostname)) {
      if (parsed.pathname.startsWith("/embed/")) return parsed.toString();
      const id = parsed.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
    if (/youtu\.be$/i.test(parsed.hostname)) {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
  } catch {
    // Keep as non-YouTube.
  }
  return "";
}

function renderYoutubeEmbed(url, label = "YouTube video") {
  const embedUrl = youtubeEmbedUrl(url);
  if (!embedUrl) return "";
  return `<figure class="youtube-embed">
    <iframe src="${htmlEscape(embedUrl, true)}" title="${htmlEscape(label, true)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
    <figcaption><a href="${htmlEscape(url, true)}" target="_blank" rel="noopener">${htmlEscape(label)}</a></figcaption>
  </figure>`;
}

function sanitizeMoodleContent(rawContent, pageRel, placeholders) {
  let content = rawContent
    .replace(/<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][\s\S]*?<\/section>/gi, "")
    .replace(/<img\b[^>]*(?:theme_remui\/logo|20260514205240_755_110)[^>]*>/gi, "")
    .replace(/<a\b[^>]*(?:theme_remui\/logo|20260514205240_755_110)[^>]*>[\s\S]*?<\/a>/gi, "");

  content = content.replace(/<video\b[\s\S]*?<\/video>/gi, (match) => {
    const src = /<source\b[^>]*\bsrc=["']([^"']+)["']/i.exec(match)?.[1]
      || /\bsrc=["']([^"']+\.mp4[^"']*)["']/i.exec(match)?.[1]
      || "";
    const title = /title=["']([^"']+)["']/i.exec(match)?.[1] || "Unavailable video";
    const youtubeUrl = firstMediaUrl(match, /(?:youtube\.com|youtube-nocookie\.com|youtu\.be)/i);
    if (youtubeUrl) return renderYoutubeEmbed(youtubeUrl, title) || match;
    if (!/\.mp4(?:[?#]|$)/i.test(src)) return match;
    const placeholder = placeholders.get(src);
    const href = placeholder?.path ? relativeHref(pageRel, placeholder.path) : "";
    const sourceText = decodeURIComponent(src.split("/").pop() || title).replace(/\+/g, " ");
    return `<aside class="video-placeholder">
      <span class="kind">Video待补</span>
      <strong>${htmlEscape(sourceText || title)}</strong>
      <p>原 Moodle 这里放的是旧外部 MP4，目前不作为可播放资源导入。位置已保留，后续可替换为 YouTube 链接或嵌入视频。</p>
      ${href ? `<a href="${htmlEscape(href, true)}">查看占位页</a>` : ""}
    </aside>`;
  });

  content = content
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, (match) => {
      const src = /\bsrc=["']([^"']+)["']/i.exec(match)?.[1] || "";
      return youtubeEmbedUrl(src) ? renderYoutubeEmbed(src, "YouTube video") || match : match;
    })
    .replace(/<div\b[^>]*class=["'][^"']*\bmediaplugin\b[^"']*["'][^>]*>\s*<div[^>]*>\s*<\/div>\s*<\/div>/gi, "")
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/\sdata-[a-z0-9_-]+=["'][^"']*["']/gi, "")
    .replace(/\sid=["']id_videojs_[^"']*["']/gi, "")
    .replace(/\sclass=["']video-js["']/gi, "")
    .trim();

  if (!stripTags(content) && !/<iframe\b/i.test(content) && !/video-placeholder/i.test(content)) {
    return "";
  }
  return content;
}

function renderAttachmentCard(pageRel, attachment) {
  const label = resourceLabel(attachment);
  const downloadHref = attachment.path ? relativeHref(pageRel, attachment.path) : "";
  const previewHref = attachment.previewPath ? relativeHref(pageRel, attachment.previewPath) : "";
  const primaryHref = previewHref || downloadHref;
  const bytes = typeof attachment.bytes === "number" && attachment.bytes > 0
    ? `${Math.round((attachment.bytes / 1024) * 10) / 10} KB`
    : "";
  return `<li class="file-card">
    <div class="file-badge">${htmlEscape(fileKind(attachment))}</div>
    <div class="file-main">
      <strong>${htmlEscape(label)}</strong>
      <span>${[attachment.type?.toUpperCase(), bytes].filter(Boolean).join(" · ")}</span>
    </div>
    <div class="file-actions">
      ${primaryHref ? `<a class="view" href="${htmlEscape(primaryHref, true)}">${previewHref ? "在线查看" : "打开"}</a>` : ""}
      ${downloadHref ? `<a href="${htmlEscape(downloadHref, true)}" download>下载</a>` : ""}
    </div>
  </li>`;
}

function renderPage({ title, body, attachments, pageRel, source }) {
  const attachmentHtml = attachments.length
    ? `<section class="attachments" aria-label="Files">
        <h2>Files</h2>
        <ul>${attachments.map((attachment) => renderAttachmentCard(pageRel, attachment)).join("\n")}</ul>
      </section>`
    : "";
  const emptyHtml = !body && !attachmentHtml
    ? `<p class="empty">Moodle activity shell localized. No readable body text or attachment was exposed during the authenticated crawl.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: light; --ink:#142033; --muted:#637083; --line:#d9e2ef; --soft:#f6f8fb; --accent:#0f5fa8; --warn:#805300; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: var(--soft); color: var(--ink); line-height: 1.62; }
    main { max-width: 1040px; margin: 0 auto; padding: 34px 22px 64px; }
    article { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 26px 28px 30px; box-shadow: 0 1px 2px rgba(16,32,51,.04); }
    h1 { font-size: 30px; line-height: 1.2; margin: 0 0 18px; padding-bottom: 16px; border-bottom: 1px solid #edf1f6; letter-spacing: 0; }
    h2 { font-size: 22px; margin: 24px 0 12px; letter-spacing: 0; }
    p { margin: 0 0 14px; max-width: 74ch; }
    a { color: var(--accent); font-weight: 700; }
    iframe { display: block; width: min(100%, 820px); min-height: 420px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
    .youtube-embed { width: min(100%, 820px); margin: 18px 0 24px; }
    .youtube-embed iframe { width: 100%; aspect-ratio: 16 / 9; min-height: 0; }
    .youtube-embed figcaption { color: var(--muted); font-size: 13px; margin-top: 8px; }
    .moodle-content { font-size: 16px; }
    .moodle-content > *:first-child { margin-top: 0; }
    .box, .generalbox, .no-overflow { max-width: 100%; }
    .video-placeholder { max-width: 760px; border: 1px solid #e2c06a; background: #fff8e8; border-radius: 8px; padding: 14px 16px; margin: 18px 0; color: var(--warn); }
    .video-placeholder .kind { display: inline-block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; color: #6b4a00; }
    .video-placeholder strong { display: block; color: #3b2a00; margin-bottom: 6px; overflow-wrap: anywhere; }
    .video-placeholder p { margin-bottom: 8px; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 26px; padding-top: 18px; }
    .attachments ul { display: grid; gap: 10px; list-style: none; margin: 0; padding: 0; }
    .file-card { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 12px; align-items: center; border: 1px solid #dfe7f2; border-radius: 8px; padding: 10px 12px; background: #fbfdff; }
    .file-badge { width: 44px; min-height: 34px; display: grid; place-items: center; border-radius: 6px; background: #e9f2fb; color: #0e4f8a; font-size: 12px; font-weight: 800; }
    .file-main { min-width: 0; }
    .file-main strong { display: block; overflow-wrap: anywhere; }
    .file-main span { display: block; color: var(--muted); font-size: 13px; }
    .file-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .file-actions a { border: 1px solid #b7c9dc; border-radius: 6px; padding: 6px 9px; text-decoration: none; font-size: 14px; background: #fff; }
    .file-actions .view { background: #0f5fa8; border-color: #0f5fa8; color: #fff; }
    .empty { border: 1px dashed #c7d3e2; border-radius: 8px; padding: 12px; color: var(--muted); }
    .source { margin-top: 22px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    @media (max-width: 720px) {
      main { padding: 18px 12px 42px; }
      article { padding: 18px 16px 22px; }
      h1 { font-size: 24px; }
      iframe { min-height: 280px; }
      .file-card { grid-template-columns: 42px minmax(0, 1fr); }
      .file-actions { grid-column: 1 / -1; justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${body ? `<div class="moodle-content">${body}</div>` : ""}
      ${emptyHtml}
      ${attachmentHtml}
      ${source ? `<div class="source">Source: ${htmlEscape(source)}</div>` : ""}
    </article>
  </main>
</body>
</html>
`;
}

const manifest = readJson(manifestPath);
let pages = 0;
let withAttachments = 0;

for (const { item, lesson } of collectRows(manifest)) {
  if (!item.path || !item.path.endsWith("/index.html")) continue;
  if (!/^moodle_/i.test(item.category || "")) continue;
  const abs = join(courseRoot, item.path);
  if (!existsSync(abs)) continue;
  const original = readFileSync(abs, "utf8");
  const placeholders = placeholderMapForLesson(lesson);
  const body = sanitizeMoodleContent(extractMoodleContent(original), item.path, placeholders);
  const attachments = (item.attachments || []).filter((attachment) => attachment.path && !/theme_/i.test(attachment.source || ""));
  const polished = renderPage({
    title: resourceLabel(item),
    body,
    attachments,
    pageRel: item.path,
    source: item.source || "",
  });
  writeFileSync(abs, polished, "utf8");
  item.bytes = statSync(abs).size;
  pages += 1;
  if (attachments.length) withAttachments += 1;
}

manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);
console.log(JSON.stringify({ pages, withAttachments }, null, 2));
