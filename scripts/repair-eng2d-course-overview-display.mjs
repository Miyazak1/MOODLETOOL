import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const COURSE = "ENG2D";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const pageRel = "course-sections/course-overview/index.html";
const pagePath = join(COURSE_ROOT, pageRel);
const manifestPath = join(COURSE_ROOT, "course-manifest.json");
const shellRel = "_assets/course-page-shell.css";

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function relativeHref(fromRel, toRel) {
  return posix.relative(posix.dirname(toPosix(fromRel)), toPosix(toRel)).split("/").map(encodeURIComponent).join("/");
}

function htmlReferenceToCoursePath(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || value.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(value) || value.startsWith("/")) return "";
  let decoded = "";
  try {
    decoded = decodeURIComponent(value.replace(/[?#].*$/, ""));
  } catch {
    return "";
  }
  const normalized = posix.normalize(posix.join(posix.dirname(pageRel), toPosix(decoded))).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

function extractArticleContent(html) {
  const article = /<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] || "";
  return article
    .replace(/\s*<section class="overview-block">[\s\S]*?<\/section>/gi, "")
    .replace(/\s*<section class="embedded-ispring overview-presentation">[\s\S]*?<\/section>/gi, "")
    .trim();
}

function ensureShellAsset() {
  const target = join(COURSE_ROOT, shellRel);
  if (existsSync(target)) return;
  const candidates = [
    join(WORKSPACE_ROOT, "courseware", "ENG3U", shellRel),
    join(WORKSPACE_ROOT, "courseware", "MDM4U", shellRel),
  ];
  const source = candidates.find((item) => existsSync(item));
  if (!source) throw new Error("Missing reusable course page shell CSS.");
  ensureDir(dirname(target));
  copyFileSync(source, target);
}

function renderPage(content, ispring) {
  const ispringHtml = ispring?.path
    ? `
        <section class="embedded-ispring overview-presentation">
          <iframe src="${escapeHtml(relativeHref(pageRel, ispring.path))}" loading="lazy" allowfullscreen="allowfullscreen" title="${escapeHtml(ispring.label || "ENG2D Course Overview")}"></iframe>
        </section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ENG2D - Course Overview - Course Content</title>
  <link rel="stylesheet" href="../../_assets/course-page-shell.css" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>ENG2D</p><h1>Course Overview</h1></div>
    <section class="moodle-section">
      <header><p>Course Content</p><h2>Course Overview</h2></header>
      <div class="moodle-content">${content || "<p>No page text was available from Moodle.</p>"}${ispringHtml}
      </div>
    </section>
  </main>
</body>
</html>
`;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const overview = (manifest.courseSections || []).find((item) => item.role === "course_overview" || item.path === pageRel);
if (!overview) throw new Error("Missing ENG2D Course Overview manifest item.");

ensureShellAsset();
const oldHtml = readFileSync(pagePath, "utf8");
const content = extractArticleContent(oldHtml);
const inlineImagePaths = new Set([...content.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => htmlReferenceToCoursePath(match[1])).filter(Boolean));
overview.attachments = (overview.attachments || []).filter((item) => {
  const type = String(item.type || "").toLowerCase();
  return !(["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(type) && inlineImagePaths.has(toPosix(item.path || "")));
});

const html = renderPage(content, overview.ispring?.[0]);
writeFileSync(pagePath, html, "utf8");
overview.bytes = statSync(pagePath).size;
overview.textPreview = stripTags(html).slice(0, 800);
overview.category = "moodle_course_section";
manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewInlineImageDisplayRepair = {
  repairedAt: new Date().toISOString(),
  removedFileRowsForInlineImages: [...inlineImagePaths],
  note: "Inline course overview images remain in the page body and are not duplicated as ordinary Files rows; real document attachments remain under their owning pages.",
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course: COURSE,
  page: pageRel,
  inlineImages: [...inlineImagePaths],
  overviewAttachments: overview.attachments.length,
  shell: shellRel,
}, null, 2));
