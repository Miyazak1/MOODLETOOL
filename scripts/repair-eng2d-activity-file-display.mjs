import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const courseRoot = path.resolve(repoRoot, "..", "courseware", "ENG2D");
const manifestPath = path.join(courseRoot, "course-manifest.json");
const cssPath = path.join(courseRoot, "_assets", "course-page-shell.css");
const cssFallbacks = [
  path.resolve(repoRoot, "..", "courseware", "ENG3U", "_assets", "course-page-shell.css"),
  path.resolve(repoRoot, "..", "courseware", "ENG4U", "_assets", "course-page-shell.css"),
  path.resolve(repoRoot, "..", "courseware", "MDM4U", "_assets", "course-page-shell.css"),
];

const officeExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf"]);
const browserViewExtensions = new Set([".html", ".htm", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".txt"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeRel(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function absFromCourse(relPath) {
  return path.join(courseRoot, ...normalizeRel(relPath).split("/"));
}

function posixDirname(relPath) {
  const dir = path.posix.dirname(normalizeRel(relPath));
  return dir === "." ? "" : dir;
}

function relativeHref(fromPageRel, targetRel) {
  const fromDir = posixDirname(fromPageRel);
  let rel = path.posix.relative(fromDir, normalizeRel(targetRel));
  if (!rel.startsWith(".")) rel = rel ? rel : ".";
  return encodeURI(rel).replace(/#/g, "%23");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function extractTitle(html, item) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]).trim() || item.label || item.title || "Course Content";
  return item.label || item.title || "Course Content";
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function extractActivityContent(html) {
  const article = html.match(/<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
  if (article) return article[1].trim();

  const moodleContent = html.match(
    /<div\b[^>]*class=["'][^"']*\bmoodle-content\b[^"']*["'][^>]*>([\s\S]*?)(?:<section\b[^>]*class=["'][^"']*\battachments\b|<\/div>\s*<\/section>)/i,
  );
  if (moodleContent) {
    return moodleContent[1].trim();
  }

  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return (body ? body[1] : html)
    .replace(/<main\b[^>]*>|<\/main>/gi, "")
    .replace(/<section\b[^>]*class=["'][^"']*\bfiles\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .trim();
}

function removeOldAttachmentSections(html) {
  return html
    .replace(/<section\b[^>]*class=["'][^"']*\bfiles\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .trim();
}

function normalizeActivityContent(html) {
  let removedWrapperDivs = 0;
  let next = html
    .replace(/<article\b[^>]*>|<\/article>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*(?:\bbox\b|\bpy-3\b|\bgeneralbox\b|\bcenter\b|\bclearfix\b|\bno-overflow\b)[^"']*["'][^>]*>/gi, () => {
      removedWrapperDivs += 1;
      return "";
    })
    .replace(/<span\b[^>]*style=["'][^"']*font-size:\s*1\.5rem[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, "$1")
    .replace(/<br\s*\/?>\s*<\/p>/gi, "</p>")
    .trim();

  while (removedWrapperDivs > 0 && /<\/div>/i.test(next)) {
    next = next.replace(/<\/div>/i, "");
    removedWrapperDivs -= 1;
  }

  return next.trim();
}

function findItems(node, results = [], seen = new Set()) {
  if (!node || typeof node !== "object") return results;
  if (Array.isArray(node)) {
    for (const entry of node) findItems(entry, results, seen);
    return results;
  }

  const relPath = normalizeRel(node.path);
  if (
    relPath.endsWith("/index.html") &&
    relPath.includes("localized-moodle-activities/") &&
    Array.isArray(node.attachments) &&
    node.attachments.length > 0 &&
    !seen.has(relPath)
  ) {
    seen.add(relPath);
    results.push(node);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") findItems(value, results, seen);
  }
  return results;
}

function attachmentTarget(item, attachment, mode) {
  const pageRel = normalizeRel(item.path);
  const previewRel = normalizeRel(attachment.previewPath);
  if (mode === "view" && previewRel && fs.existsSync(absFromCourse(previewRel))) {
    return relativeHref(pageRel, previewRel);
  }

  const rawRel = normalizeRel(attachment.downloadPath || attachment.path);
  if (!rawRel) return null;
  const ext = path.extname(rawRel).toLowerCase();
  if (mode === "view" && officeExtensions.has(ext)) return null;
  if (mode === "view" && !browserViewExtensions.has(ext)) return null;
  return relativeHref(pageRel, rawRel);
}

function rewriteInlineAttachmentLinks(content, item) {
  let next = content;
  for (const attachment of item.attachments || []) {
    const viewHref = attachmentTarget(item, attachment, "view");
    if (!viewHref) continue;
    const candidates = [
      normalizeRel(attachment.path),
      normalizeRel(attachment.downloadPath),
      relativeHref(item.path, attachment.path),
      relativeHref(item.path, attachment.downloadPath || attachment.path),
    ]
      .filter(Boolean)
      .flatMap((candidate) => [candidate, encodeURI(candidate)]);

    for (const candidate of new Set(candidates)) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(new RegExp(`href=(["'])${escaped}\\1`, "gi"), `href="${
        viewHref
      }"`);
    }
  }
  return next;
}

function renderAttachments(item) {
  const rows = [];
  for (const attachment of item.attachments || []) {
    const label = attachment.label || attachment.title || path.posix.basename(normalizeRel(attachment.path || ""));
    const viewHref = attachmentTarget(item, attachment, "view");
    const downloadHref = attachmentTarget(item, attachment, "download");
    const actions = [];
    if (viewHref) actions.push(`<a class="file-action" href="${escapeAttr(viewHref)}">查看</a>`);
    if (downloadHref) actions.push(`<a class="file-action" href="${escapeAttr(downloadHref)}" download>下载</a>`);
    if (actions.length === 0) continue;
    rows.push(
      `<li><span class="file-label">${escapeHtml(label)}</span><span class="file-actions">${actions.join("")}</span></li>`,
    );
  }
  if (rows.length === 0) return "";
  return `<section class="attachments"><h2>Files</h2><ul>${rows.join("")}</ul></section>`;
}

function renderPage(item, oldHtml) {
  const pageRel = normalizeRel(item.path);
  const title = extractTitle(oldHtml, item);
  let content = removeOldAttachmentSections(extractActivityContent(oldHtml));
  content = normalizeActivityContent(content);
  content = rewriteInlineAttachmentLinks(content, item);
  const attachments = renderAttachments(item);
  const cssHref = relativeHref(pageRel, "_assets/course-page-shell.css");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ENG2D - ${escapeHtml(title)} - Course Content</title>
  <link rel="stylesheet" href="${escapeAttr(cssHref)}" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>ENG2D</p><h1>${escapeHtml(title)}</h1></div>
    <section class="moodle-section">
      <header><p>Course Content</p><h2>${escapeHtml(title)}</h2></header>
      <div class="moodle-content"><div class="activity-body">${content}</div>${attachments}</div>
    </section>
  </main>
  <script>
    window.addEventListener("message", function (event) {
      if (!event.data || event.data.type !== "ossd:h5p-height") return;
      document.querySelectorAll(".embedded-h5p iframe, .embedded-h5p-frame iframe").forEach(function (iframe) {
        if (event.source === iframe.contentWindow) {
          iframe.style.height = Math.max(Number(event.data.height) || 0, 640) + "px";
        }
      });
    });
  </script>
</body>
</html>
`;
}

function ensureShellCss() {
  if (fs.existsSync(cssPath)) return false;
  fs.mkdirSync(path.dirname(cssPath), { recursive: true });
  const fallback = cssFallbacks.find((candidate) => fs.existsSync(candidate));
  if (!fallback) throw new Error("Could not find a course-page-shell.css fallback");
  fs.copyFileSync(fallback, cssPath);
  return true;
}

function main() {
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
  const copiedCss = ensureShellCss();
  const manifest = readJson(manifestPath);
  const items = findItems(manifest);

  const report = {
    course: "ENG2D",
    pagesScanned: items.length,
    pagesPatched: 0,
    attachmentRows: 0,
    skippedMissingFile: [],
    copiedCss,
    patched: [],
  };

  for (const item of items) {
    const pageRel = normalizeRel(item.path);
    const pagePath = absFromCourse(pageRel);
    if (!fs.existsSync(pagePath)) {
      report.skippedMissingFile.push(pageRel);
      continue;
    }
    const oldHtml = fs.readFileSync(pagePath, "utf8");
    const nextHtml = renderPage(item, oldHtml);
    if (nextHtml !== oldHtml) {
      fs.writeFileSync(pagePath, nextHtml, "utf8");
      item.bytes = Buffer.byteLength(nextHtml);
      item.textPreview = stripTags(nextHtml).slice(0, 240);
      report.pagesPatched += 1;
      report.attachmentRows += item.attachments.length;
      report.patched.push(pageRel);
    }
  }

  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    eng2dActivityFileDisplayRepair: {
      repairedAt: new Date().toISOString(),
      pagesPatched: report.pagesPatched,
      attachmentRows: report.attachmentRows,
      rule: "Localized activity file lists use the ENG3U/ENG4U shell, attachment actions, and preview-first view targets.",
    },
  };
  writeJson(manifestPath, manifest);

  const reportPath = path.join(repoRoot, "deployment", "ENG2D-activity-file-display-repair-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
}

main();
