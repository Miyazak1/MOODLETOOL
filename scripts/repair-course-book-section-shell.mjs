import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeHtmlAttr(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeHref(value) {
  return encodeURI(value).replace(/#/g, "%23");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const COURSE = safeCourse(readArg("--course"));
const dryRun = hasFlag("--dry-run");

if (!COURSE) {
  console.error("Usage: node scripts/repair-course-book-section-shell.mjs --course COURSE [--dry-run]");
  process.exit(1);
}

const courseRoot = path.join(workspaceRoot, "courseware", COURSE);
const manifestPath = path.join(courseRoot, "course-manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);

const previewExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf"]);
const viewableExtensions = new Set([".pdf", ".html", ".htm", ".txt", ".gif", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const hiddenFileRowExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mp3", ".wav"]);

function abs(relPath) {
  return path.join(courseRoot, ...toPosix(relPath).split("/"));
}

function relativeHref(pageRel, targetRel) {
  const fromDir = path.posix.dirname(toPosix(pageRel));
  let rel = path.posix.relative(fromDir, toPosix(targetRel));
  if (!rel.startsWith(".")) rel = rel || ".";
  return encodeHref(rel);
}

function resolveHref(pageRel, href) {
  const value = decodeHtmlAttr(href).trim().replace(/[?#].*$/, "");
  if (!value || value.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(value)) return "";
  if (value.startsWith("/")) return "";
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const normalized = path.posix
    .normalize(path.posix.join(path.posix.dirname(toPosix(pageRel)), toPosix(decoded)))
    .replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

function ensureShellCss() {
  const target = path.join(courseRoot, "_assets", "course-page-shell.css");
  if (fs.existsSync(target)) return false;
  const fallbacks = [
    path.join(workspaceRoot, "courseware", "ENG3U", "_assets", "course-page-shell.css"),
    path.join(workspaceRoot, "courseware", "ENG4U", "_assets", "course-page-shell.css"),
    path.join(workspaceRoot, "courseware", "MDM4U", "_assets", "course-page-shell.css"),
  ];
  const source = fallbacks.find((candidate) => fs.existsSync(candidate));
  if (!source) throw new Error("Cannot find course-page-shell.css fallback.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function sectionNumber(section) {
  const fromPath = String(section.path || "").match(/book_sections\/(\d+)/i)?.[1];
  if (fromPath) return Number(fromPath);
  return Number(section.sectionIndex || section.index || 0) || 0;
}

function sectionTitle(section) {
  const label = String(section.sectionLabel || section.label || "Course Content").trim();
  if (section.sectionLabel) return section.sectionLabel;
  return label.replace(/^\s*(?:Lesson Expectations|Lesson|Hands On|Consolidation|Homework)\s*-\s*/i, "").trim() || label;
}

function visibleAttachments(attachments) {
  return (attachments || []).filter((attachment) => {
    const rel = toPosix(attachment.path || attachment.downloadPath || "");
    const ext = path.posix.extname(rel).toLowerCase();
    return rel && !hiddenFileRowExtensions.has(ext) && fs.existsSync(abs(rel));
  });
}

function viewHref(pageRel, attachment) {
  const raw = toPosix(attachment.path || attachment.downloadPath);
  const preview = toPosix(attachment.previewPath);
  const ext = path.posix.extname(raw).toLowerCase();
  if (preview && fs.existsSync(abs(preview))) return relativeHref(pageRel, preview);
  const inferredPreview = `previews-html/${raw}.html`;
  if (previewExtensions.has(ext) && fs.existsSync(abs(inferredPreview))) return relativeHref(pageRel, inferredPreview);
  if (viewableExtensions.has(ext) && fs.existsSync(abs(raw))) return relativeHref(pageRel, raw);
  if (raw && fs.existsSync(abs(raw))) return relativeHref(pageRel, raw);
  return "";
}

function downloadHref(pageRel, attachment) {
  const raw = toPosix(attachment.downloadPath || attachment.path);
  return raw && fs.existsSync(abs(raw)) ? relativeHref(pageRel, raw) : "";
}

function renderAttachments(pageRel, attachments) {
  const rows = [];
  for (const attachment of visibleAttachments(attachments)) {
    const label = attachment.label || path.posix.basename(toPosix(attachment.path || ""));
    const view = viewHref(pageRel, attachment);
    const download = downloadHref(pageRel, attachment);
    const actions = [
      view ? `<a class="file-action" href="${view}">查看</a>` : "",
      download ? `<a class="file-action" href="${download}" download>下载</a>` : "",
    ].filter(Boolean).join("");
    if (!actions) continue;
    rows.push(`<li><span class="file-label">${escapeHtml(label)}</span><span class="file-actions">${actions}</span></li>`);
  }
  return rows.length ? `<section class="attachments"><h2>Files</h2><ul>${rows.join("")}</ul></section>` : "";
}

function extractDivContentByClass(html, className) {
  const opener = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "i").exec(html);
  if (!opener) return null;
  const start = opener.index + opener[0].length;
  const divTag = /<\/?div\b[^>]*>/gi;
  divTag.lastIndex = start;
  let depth = 1;
  let match;
  while ((match = divTag.exec(html))) {
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) return html.slice(start, match.index);
    } else {
      depth += 1;
    }
  }
  return html.slice(start);
}

function stripOneWrapperDiv(html, classPattern) {
  const source = String(html || "").trim();
  const opener = new RegExp(`^<div\\b[^>]*class=["'][^"']*${classPattern}[^"']*["'][^>]*>`, "i").exec(source);
  if (!opener) return source;
  const inner = extractDivContentByClass(source, opener[0].match(/class=["']([^"']+)["']/i)?.[1]?.split(/\s+/)[0] || "");
  return inner === null ? source : inner.trim();
}

function cleanBody(html) {
  let body = extractDivContentByClass(html, "activity-body");
  if (body === null) body = extractDivContentByClass(html, "moodle-content");
  if (body === null) {
    const article = html.match(/<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
    body = article ? article[1] : (html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html);
  }
  let next = String(body || "")
    .replace(/\s*<section\b[^>]*class=["'][^"']*\bfiles\b[^"']*["'][^>]*>[\s\S]*?<\/section>\s*/gi, "\n")
    .replace(/\s*<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][^>]*>[\s\S]*?<\/section>\s*/gi, "\n")
    .replace(/<div\b[^>]*id=["']assign_files_tree[^"']*["'][\s\S]*$/i, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bsubmissionlinks\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<center>\s*<div\b[^>]*class=["'][^"']*\bsubmissionlinks\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/center>/gi, "")
    .replace(/<h([1-6])([^>]*)>\s*<strong([^>]*)>\s*<h\1\b[^>]*>([\s\S]*?)<\/h\1>\s*<\/strong>\s*<\/h\1>/gi, "<h$1$2><strong$3>$4</strong></h$1>")
    .replace(/<h([1-6])\b[^>]*>\s*(?:<strong>\s*)?(?:<br\s*\/?>|&nbsp;|\s)*(?:<\/strong>\s*)?<\/h\1>/gi, "")
    .replace(/<p\b[^>]*>\s*(?:<strong>\s*)?(?:<br\s*\/?>|&nbsp;|\s)*(?:<\/strong>\s*)?<\/p>/gi, "")
    .trim();
  for (let i = 0; i < 4; i += 1) {
    const stripped = stripOneWrapperDiv(next, "(?:box|py-3|generalbox|book_content|no-overflow)");
    if (stripped === next) break;
    next = stripped;
  }
  return next || "<p>No page text was available from Moodle.</p>";
}

function rewriteInlineAttachmentLinks(content, pageRel, attachments) {
  let next = content;
  for (const attachment of visibleAttachments(attachments)) {
    const raw = toPosix(attachment.path || attachment.downloadPath);
    const view = viewHref(pageRel, attachment);
    if (!raw || !view) continue;
    next = next.replace(/\bhref=(["'])([^"']+)\1/gi, (match, quote, href) => {
      const resolved = resolveHref(pageRel, href);
      return resolved === raw ? `href=${quote}${view}${quote}` : match;
    });
  }
  return next;
}

function renderPage({ unit, lesson, section, html }) {
  const pageRel = toPosix(section.path);
  const cssHref = relativeHref(pageRel, "_assets/course-page-shell.css");
  const sectionNo = sectionNumber(section);
  const title = lesson.title || lesson.label || `Lesson ${lesson.lesson}`;
  const label = section.sectionLabel || sectionTitle(section);
  const content = rewriteInlineAttachmentLinks(cleanBody(html), pageRel, section.attachments || []);
  const attachments = renderAttachments(pageRel, section.attachments || []);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${COURSE} Unit ${escapeHtml(unit.unit)} Lesson ${escapeHtml(lesson.lesson)} - ${escapeHtml(label)}</title>
  <link rel="stylesheet" href="${cssHref}" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>${COURSE} · Unit ${escapeHtml(unit.unit)} · Lesson ${escapeHtml(lesson.lesson)}${sectionNo ? ` · Section ${sectionNo}` : ""}</p><h1>${escapeHtml(title)}</h1></div>
    <section class="moodle-section">
      <header><p>${escapeHtml(label).toUpperCase()}</p><h2>${escapeHtml(label)}</h2></header>
      <div class="moodle-content"><div class="activity-body">${content}</div>${attachments}</div>
    </section>
  </main>
  <script>
    window.addEventListener("message", function (event) {
      var data = event.data || {};
      if (data.type !== "resize" && data.type !== "ossd:h5p-height") return;
      document.querySelectorAll(".embedded-h5p iframe, .embedded-h5p-frame iframe").forEach(function (iframe) {
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

function refreshTextPreview(section, html) {
  section.bytes = Buffer.byteLength(html);
  section.textPreview = stripTags(html).slice(0, 720);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const changed = [];
let cssAdded = false;

if (!dryRun) cssAdded = ensureShellCss();

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const section of lesson.bookSections || []) {
      if (!section.path) continue;
      const pagePath = abs(section.path);
      if (!fs.existsSync(pagePath)) continue;
      const before = fs.readFileSync(pagePath, "utf8");
      const after = renderPage({ unit, lesson, section, html: before });
      if (after === before) continue;
      changed.push({
        unit: unit.unit,
        lesson: lesson.lesson,
        section: section.sectionLabel || section.label || "",
        path: section.path,
      });
      refreshTextPreview(section, after);
      if (!dryRun) fs.writeFileSync(pagePath, after, "utf8");
    }
  }
}

if (!dryRun && changed.length) {
  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    [`${COURSE.toLowerCase()}BookSectionShellRepair20260825`]: {
      repairedAt: new Date().toISOString(),
      patchedPages: changed.length,
      rule: "All Moodle book section pages use the ENG3U shared page shell and Files component.",
    },
  };
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

const report = { course: COURSE, dryRun, cssAdded, patchedPages: changed.length, samples: changed.slice(0, 20) };
const reportPath = path.join(repoRoot, "deployment", `${COURSE}-book-section-shell-repair-report.json`);
if (!dryRun) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(report, null, 2));
