import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const COURSE = "MCR3U";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const MANIFEST_PATH = join(COURSE_ROOT, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function escapeHtml(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function relativeHref(fromRel, targetRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(targetRel)))
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function chapterIdFromBookUrl(url) {
  return String(url || "").match(/[?&]chapterid=(\d+)/i)?.[1] || "";
}

function normalizedUrl(url, baseUrl) {
  try {
    const parsed = new URL(decodeHtmlAttribute(url), baseUrl || "https://www.esunnybrook.com/");
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function rawSectionBody(rawHtml) {
  return (
    /<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*$/i.exec(String(rawHtml || ""))?.[1] ||
    /<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(String(rawHtml || ""))?.[1] ||
    rawHtml ||
    ""
  );
}

function attachmentsForSection(lesson, section) {
  const chapterId = chapterIdFromBookUrl(section.source);
  if (!chapterId) return [];
  return (lesson.downloads || []).filter((item) => String(item.source || "").includes(`/chapter/${chapterId}/`) || String(item.source || "").includes(`chapter%2F${chapterId}%2F`));
}

function attachmentUrl(item, pageRel) {
  const target = item.type === "h5p" && item.previewPath ? `${relativeHref(pageRel, item.previewPath)}?embed=1` : relativeHref(pageRel, item.downloadPath || item.path);
  return target;
}

function localizeKnownUrls(html, lesson, section) {
  const pageRel = section.path;
  const sourceBase = section.source || "https://www.esunnybrook.com/";
  const attachments = attachmentsForSection(lesson, section);
  const localByUrl = new Map();

  for (const item of attachments) {
    if (!item.source || !(item.path || item.downloadPath || item.previewPath)) continue;
    const url = normalizedUrl(item.source, sourceBase);
    if (url) localByUrl.set(url, attachmentUrl(item, pageRel));
  }

  for (const item of lesson.ispring || []) {
    if (!item.source || !(item.path || item.url)) continue;
    const url = normalizedUrl(item.source, sourceBase);
    const target = item.path ? relativeHref(pageRel, item.path) : item.url;
    if (url) localByUrl.set(url, target);
  }

  return String(html || "").replace(/\b(href|src|poster)\s*=\s*(["'])([^"']+)\2/gi, (match, attr, quote, rawValue) => {
    const url = normalizedUrl(rawValue, sourceBase);
    const replacement = localByUrl.get(url);
    if (!replacement) return match;
    return `${attr}=${quote}${escapeHtml(replacement, true)}${quote}`;
  });
}

function normalizeEmbeddedMedia(html, section) {
  let out = String(html || "");

  out = out.replace(/<iframe\b([^>]*)>\s*<\/iframe>/gi, (match, attrs) => {
    if (!/(h5p_embed|hexstruct\.ispring\.com|ispring-localized|\/h5p\/|localized-moodle\/h5p)/i.test(attrs)) return match;
    let nextAttrs = attrs;
    if (!/\bloading\s*=/i.test(nextAttrs)) nextAttrs += ' loading="lazy"';
    if (!/\ballowfullscreen\b/i.test(nextAttrs)) nextAttrs += ' allowfullscreen="allowfullscreen"';
    if (!/\btitle\s*=/i.test(nextAttrs)) nextAttrs += ` title="${escapeHtml(section.label || section.sectionLabel || "Embedded activity", true)}"`;
    const klass = /ispring|embed_player/i.test(nextAttrs) ? "localized-ispring" : "embedded-h5p-frame";
    return `<div class="${klass}"><iframe${nextAttrs}></iframe></div>`;
  });

  out = out.replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (match, attrs, inner) => {
    let nextAttrs = attrs;
    if (!/\bcontrols\b/i.test(nextAttrs)) nextAttrs += " controls";
    return `<div class="embedded-video"><video${nextAttrs}>${inner}</video></div>`;
  });

  return out
    .replace(/<script\b[^>]*h5p-resizer\.js[^>]*>\s*<\/script>/gi, "")
    .replace(/\s(?:data-localized-link)=["']removed["']/gi, "");
}

function renderPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    h3 { font-size: 18px; margin: 22px 0 10px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; max-width: 100%; }
    .localized-ispring, .embedded-h5p-frame, .embedded-video { display: block; margin: 16px 0 24px; max-width: 100%; width: 100%; }
    .localized-ispring iframe, .embedded-h5p-frame iframe { border: 0; display: block; min-height: 640px; width: 100%; }
    .localized-ispring iframe { height: min(72vh, 760px); }
    .embedded-video video { background: #000; width: 100%; }
    .content table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
    .content td, .content th { border: 1px solid #d6e2f0; padding: 8px 10px; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <article class="content">${bodyHtml || "<p>No page text was available from Moodle.</p>"}</article>
  </main>
  <script>
    window.addEventListener("message", function (event) {
      var data = event.data || {};
      if (data.type !== "resize" && data.type !== "ossd:h5p-height") return;
      document.querySelectorAll(".embedded-h5p-frame iframe").forEach(function (iframe) {
        if (event.source === iframe.contentWindow) {
          iframe.style.height = Math.max(Number(data.height) || 0, 640) + "px";
        }
      });
    });
  </script>
</body>
</html>
`;
}

function countTag(html, tagName, pattern = null) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const matches = String(html || "").match(tagPattern) || [];
  if (!pattern) return matches.length;
  return matches.filter((tag) => pattern.test(tag)).length;
}

const manifest = readJson(MANIFEST_PATH);
const report = {
  course: COURSE,
  scanned: 0,
  rewritten: 0,
  h5pIframes: 0,
  ispringIframes: 0,
  videos: 0,
  missingPages: [],
  missingRawSections: [],
};

for (const unit of manifest.units || []) {
  const rawPath = join(REPO_ROOT, "inbox", `moodle-book-raw-${COURSE}-U${String(unit.unit).padStart(2, "0")}.json`);
  if (!existsSync(rawPath)) continue;
  const raw = readJson(rawPath);

  for (const lesson of unit.lessons || []) {
    const rawLesson = (raw.lessons || []).find((item) => Number(item.lesson) === Number(lesson.lesson));
    if (!rawLesson) continue;

    for (const section of lesson.bookSections || []) {
      report.scanned += 1;
      const pagePath = join(COURSE_ROOT, section.path);
      if (!existsSync(pagePath)) {
        report.missingPages.push(section.path);
        continue;
      }

      const rawSection = (rawLesson.sections || []).find((item) => Number(item.sectionIndex) === Number(section.sectionIndex));
      if (!rawSection?.page?.html) {
        report.missingRawSections.push(section.path);
        continue;
      }

      let body = rawSectionBody(rawSection.page.html)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
      body = localizeKnownUrls(body, lesson, section);
      body = normalizeEmbeddedMedia(body, section);

      const title = `${COURSE} Unit ${unit.unit} Lesson ${lesson.lesson} - ${section.sectionLabel || rawSection.normalizedLabel || rawSection.label}`;
      const html = renderPage(title, body);
      writeFileSync(pagePath, html, "utf8");
      section.bytes = statSync(pagePath).size;
      section.textPreview = stripTags(body).slice(0, 500);
      report.rewritten += 1;
      report.h5pIframes += countTag(html, "iframe", /(?:h5p_embed|localized-moodle\/h5p|welcome\.hexstruct)/i);
      report.ispringIframes += countTag(html, "iframe", /ispring-localized/i);
      report.videos += countTag(html, "video");
    }
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  mcr3uBookSectionEmbedRepair: {
    repairedAt: new Date().toISOString(),
    scanned: report.scanned,
    rewritten: report.rewritten,
    h5pIframes: report.h5pIframes,
    ispringIframes: report.ispringIframes,
    videos: report.videos,
  },
};
manifest.generatedAt = new Date().toISOString();

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
