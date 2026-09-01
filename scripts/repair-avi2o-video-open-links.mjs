import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "AVI2O");
const manifestPath = path.join(courseRoot, "course-manifest.json");

const pageTargets = new Map([
  [
    "localized-moodle-activities/url/U01L07-12-12-ceb396aca0/index.html",
    {
      title: "Perspective Drawing",
      fallbackHref: "files/How-to-Draw-in-Perspective-for-Beginners.mp4",
      blockedDirectMp4: [],
      localizedVideo: true,
      removeUrlWorkaround: true,
    },
  ],
  [
    "localized-moodle-activities/url/U01L08-13-13-c87cb5d0f2/index.html",
    {
      title: "Shadow Study.mp4",
      fallbackHref: "files/Shadow-Study.mp4",
      blockedDirectMp4: [],
      localizedVideo: true,
      localVideoCards: [
        {
          title: "How-to-Draw-in-Perspective-for-Beginners.mp4",
          href: "files/How-to-Draw-in-Perspective-for-Beginners.mp4",
        },
        {
          title: "Shadow-Study.mp4",
          href: "files/Shadow-Study.mp4",
        },
      ],
      removeUrlWorkaround: true,
    },
  ],
  [
    "localized-moodle-activities/assign/U01L13-18-18-387e99244f/index.html",
    {
      title: "Grid Method Tutorial",
      fallbackHref: "https://www.youtube.com/watch?v=QxmIogspVY0",
      blockedDirectMp4: [
        "https://sisonline.oss-cn-hongkong.aliyuncs.com/MoodleCloud/youtube%20videos/AVI2O/How%20To%20Draw%20Outlines%20Using%20Grid%20Method_%20Tutorial.mp4",
      ],
    },
  ],
]);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return decodeHtml(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function readableTitle(value) {
  const text = String(value || "").trim();
  try {
    return decodeURIComponent(text).replace(/\s+/g, " ").trim();
  } catch {
    return text.replace(/%20/g, " ").replace(/\s+/g, " ").trim();
  }
}

function sourceFromBlock(block) {
  return decodeHtml(/<source\b[^>]*\bsrc=["']([^"']+)["']/i.exec(block)?.[1] || "");
}

function youtubeHrefFromBlock(block) {
  return decodeHtml(/<a\b[^>]*\bhref=["']([^"']*youtube\.com\/watch[^"']+)["']/i.exec(block)?.[1] || "");
}

function titleFromBlock(block, fallbackTitle) {
  const title = decodeHtml(/\btitle=["']([^"']+)["']/i.exec(block)?.[1] || "").trim();
  if (title && title.toLowerCase() !== "watch") return readableTitle(title);
  const anchorText = stripTags(/<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1] || "");
  return anchorText && anchorText.toLowerCase() !== "watch" ? readableTitle(anchorText) : fallbackTitle;
}

function videoLinkCard(title, href) {
  return `<div class="video-open-list" data-avi2o-video-link="true">
  <a class="video-open-card" href="${escapeHtml(href)}" target="_blank" rel="noopener">
    <span class="video-open-title">${escapeHtml(title)}</span>
    <span class="video-open-action">播放</span>
  </a>
</div>`;
}

function videoLinkCardList(cards) {
  return `<div class="video-open-list" data-avi2o-video-link="true">
${cards
  .map(
    (card) => `  <a class="video-open-card" href="${escapeHtml(card.href)}" target="_blank" rel="noopener">
    <span class="video-open-title">${escapeHtml(card.title)}</span>
    <span class="video-open-action">播放</span>
  </a>`,
  )
  .join("\n")}
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
  return nextHtml.includes("</style>") ? nextHtml.replace("</style>", `${css}\n  </style>`) : nextHtml;
}

function dedupeVideoCards(html) {
  const seen = new Set();
  return html.replace(/<div class="video-open-list"[^>]*>\s*<a class="video-open-card" href="([^"]+)"[\s\S]*?<\/a>\s*<\/div>/gi, (block, href) => {
    const key = decodeHtml(href);
    if (seen.has(key)) return "";
    seen.add(key);
    return block;
  });
}

function normalizeExistingCardTitles(html) {
  return html.replace(/<span class="video-open-title">([\s\S]*?)<\/span>/gi, (match, rawTitle) => {
    return `<span class="video-open-title">${escapeHtml(readableTitle(stripTags(rawTitle)))}</span>`;
  });
}

function removeUrlWorkaround(html, target) {
  if (!target.removeUrlWorkaround) return html;
  return html.replace(/\s*<div class="urlworkaround">[\s\S]*?<\/div>\s*/i, "\n");
}

function ensureLocalVideoCards(html, target) {
  if (!target.localVideoCards?.length) return html;
  const nextHtml = ensureVideoLinkStyles(html);
  const list = videoLinkCardList(target.localVideoCards);
  if (/<div class="video-open-list"[^>]*>[\s\S]*?<\/div>/i.test(nextHtml)) {
    return nextHtml.replace(/<div class="video-open-list"[^>]*>[\s\S]*?<\/div>/i, list);
  }
  return nextHtml.replace(/\s*<\/div>\s*<\/div>\s*<\/article>/i, `\n${list}\n</div>\n                        </div>\n    </article>`);
}

function replaceVideoBlocks(html, target) {
  const blockedDirectMp4 = [...(target.blockedDirectMp4 || [])];
  let count = 0;
  let nextHtml = html.replace(/<p[^>]*>\s*(?:<span[^>]*>)?\s*(<div\b[^>]*class=["'][^"']*\bmediaplugin_videojs\b[^"']*["'][\s\S]*?<\/video>\s*<\/div>\s*<\/div>)\s*(?:<br\s*\/?>\s*)?(?:<\/span>)?\s*<\/p>/gi, (outer, block) => {
    const src = sourceFromBlock(block);
    const href = youtubeHrefFromBlock(block) || target.fallbackHref;
    if (!target.localizedVideo && src && /^https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(src)) {
      blockedDirectMp4.push(src);
    }
    count += 1;
    return videoLinkCard(titleFromBlock(block, target.title), href);
  });

  nextHtml = nextHtml.replace(/<div\b[^>]*class=["'][^"']*\bmediaplugin_videojs\b[^"']*["'][\s\S]*?<\/video>\s*<\/div>\s*<\/div>/gi, (block) => {
    const src = sourceFromBlock(block);
    const href = youtubeHrefFromBlock(block) || target.fallbackHref;
    if (!target.localizedVideo && src && /^https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(src)) {
      blockedDirectMp4.push(src);
    }
    count += 1;
    return videoLinkCard(titleFromBlock(block, target.title), href);
  });

  if (count) nextHtml = dedupeVideoCards(ensureVideoLinkStyles(nextHtml));
  nextHtml = normalizeExistingCardTitles(nextHtml);
  nextHtml = removeUrlWorkaround(nextHtml, target);
  nextHtml = ensureLocalVideoCards(nextHtml, target);
  return { html: nextHtml, count, blockedDirectMp4: [...new Set(blockedDirectMp4)] };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fixedAt = new Date().toISOString();
const pageReports = [];

for (const [relPath, target] of pageTargets) {
  const abs = path.join(courseRoot, relPath);
  const before = fs.readFileSync(abs, "utf8");
  const result = replaceVideoBlocks(before, target);
  if (result.html !== before) {
    fs.writeFileSync(abs, result.html, "utf8");
  }
  pageReports.push({
    path: relPath,
    videoBlocksRewritten: result.count,
    blockedDirectMp4: result.blockedDirectMp4,
    localizedVideo: Boolean(target.localizedVideo),
    bytes: fs.statSync(abs).size,
  });
}

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.downloads || []) {
      const report = pageReports.find((entry) => entry.path === item.path);
      if (!report) continue;
      item.bytes = report.bytes;
      if (report.blockedDirectMp4.length) {
        item.unavailableMedia = report.blockedDirectMp4.map((url) => ({
          url,
          status: 403,
          reason: "External OSS MP4 returned HTTP 403 during AVI2O video localization; page now uses the Moodle YouTube fallback link instead of a broken embedded player.",
        }));
      } else if (report.localizedVideo) {
        delete item.unavailableMedia;
      }
    }
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  avi2oVideoOpenLinkRepair: {
    fixedAt,
    basis: "Matched BBI2O legacy video activity presentation: replace broken Moodle video players with video-open cards, and do not mark 403 external MP4s as localized video files.",
    pages: pageReports,
  },
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ course: "AVI2O", pages: pageReports }, null, 2));
