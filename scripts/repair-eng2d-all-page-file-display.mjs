import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "ENG2D");
const manifestPath = path.join(courseRoot, "course-manifest.json");

const viewableExtensions = new Set([".pdf", ".html", ".htm", ".txt"]);
const previewExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf"]);
const hiddenFileRowExtensions = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mp3",
  ".wav",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function decodeHtmlAttr(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function encodeHref(value) {
  return encodeURI(value).replace(/#/g, "%23");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

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
  let decoded = "";
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(toPosix(pageRel)), toPosix(decoded))).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = toPosix(path.relative(courseRoot, full));
    if (entry.isDirectory()) {
      if (
        rel.startsWith("ispring-localized/") ||
        rel.startsWith("localized-moodle/h5p-external/") ||
        rel.startsWith("previews-html/") ||
        rel.startsWith("texts/") ||
        rel.startsWith("plans/")
      ) {
        continue;
      }
      walk(full, out);
    } else if (/\.html?$/i.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

function collectManifestRefs(node, pageMap, fileMap, refs = []) {
  if (!node || typeof node !== "object") return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectManifestRefs(item, pageMap, fileMap, refs);
    return refs;
  }

  const rel = toPosix(node.path);
  if (rel) {
    refs.push(node);
    const ext = path.posix.extname(rel).toLowerCase();
    if (ext === ".html" || ext === ".htm") {
      pageMap.set(rel, node);
    } else {
      fileMap.set(rel, node);
      if (node.downloadPath) fileMap.set(toPosix(node.downloadPath), node);
    }
  }

  for (const value of Object.values(node)) collectManifestRefs(value, pageMap, fileMap, refs);
  return refs;
}

function parsedRowsFromOldFilesSection(sectionHtml, pageRel) {
  const rows = [];
  const rowRegex = /<div\b[^>]*class=["'][^"']*\bfile-row\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match;
  while ((match = rowRegex.exec(sectionHtml))) {
    const row = match[1];
    const labelMatch = row.match(/<div\b[^>]*class=["'][^"']*\bfile-label\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const hrefMatch = row.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    const href = hrefMatch ? decodeHtmlAttr(hrefMatch[1]) : "";
    const resolved = resolveHref(pageRel, href);
    rows.push({
      label: stripTags(labelMatch ? labelMatch[1] : path.posix.basename(resolved || href)),
      path: resolved,
      downloadPath: resolved,
      previewPath: "",
    });
  }
  return rows;
}

function visibleAttachments(pageRel, manifestPage, oldSectionHtml = "") {
  let attachments = Array.isArray(manifestPage?.attachments) ? [...manifestPage.attachments] : [];
  if (!attachments.length && oldSectionHtml) attachments = parsedRowsFromOldFilesSection(oldSectionHtml, pageRel);
  attachments = mergeLocalFileAttachments(pageRel, attachments);
  const visible = attachments.filter((attachment) => {
    const rel = toPosix(attachment.path || attachment.downloadPath);
    const ext = path.posix.extname(rel).toLowerCase();
    const pageUnit = toPosix(pageRel).match(/^Unit\s+(\d+)\//i)?.[1];
    const attachmentUnit = `${attachment.label || ""} ${rel}`.match(/ENG2D\s*-\s*Unit\s+(\d+)\s*-\s*End\s+of\s+Unit\s+Reflection/i)?.[1];
    if (pageUnit && attachmentUnit && pageUnit !== attachmentUnit) return false;
    return !hiddenFileRowExtensions.has(ext);
  });
  if (manifestPage) {
    const existing = new Set((manifestPage.attachments || []).map((attachment) => toPosix(attachment.path || attachment.downloadPath)));
    const inferred = visible.filter((attachment) => attachment.inferredFromLocalFiles && !existing.has(toPosix(attachment.path || attachment.downloadPath)));
    if (inferred.length) manifestPage.attachments = [...(manifestPage.attachments || []), ...inferred];
  }
  return visible;
}

function mergeLocalFileAttachments(pageRel, attachments) {
  const pageDir = path.posix.dirname(toPosix(pageRel));
  const filesRel = path.posix.join(pageDir, "files");
  const filesDir = abs(filesRel);
  if (!fs.existsSync(filesDir) || !fs.statSync(filesDir).isDirectory()) return attachments;

  const seen = new Set(attachments.map((attachment) => toPosix(attachment.path || attachment.downloadPath)));
  const merged = [...attachments];
  for (const entry of fs.readdirSync(filesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const rel = path.posix.join(filesRel, entry.name);
    if (seen.has(rel)) continue;
    const ext = path.posix.extname(entry.name).toLowerCase();
    const stat = fs.statSync(abs(rel));
    const preview = previewExtensions.has(ext) ? `previews-html/${rel}.html` : rel;
    merged.push({
      label: entry.name.replace(/^[a-f0-9]{10}-/i, ""),
      type: ext.replace(/^\./, "") || "file",
      category: "moodle_file",
      role: "attachment",
      path: rel,
      bytes: stat.size,
      previewPath: fs.existsSync(abs(preview)) ? preview : rel,
      downloadPath: rel,
      inferredFromLocalFiles: true,
    });
  }
  return merged;
}

function hasLocalDisplayableFiles(pageRel) {
  return mergeLocalFileAttachments(pageRel, []).some((attachment) => {
    const ext = path.posix.extname(toPosix(attachment.path || attachment.downloadPath)).toLowerCase();
    return !hiddenFileRowExtensions.has(ext);
  });
}

function viewHref(pageRel, attachment) {
  const raw = toPosix(attachment.path || attachment.downloadPath);
  const preview = toPosix(attachment.previewPath);
  const ext = path.posix.extname(raw).toLowerCase();
  if (preview && fs.existsSync(abs(preview))) return relativeHref(pageRel, preview);
  const inferredPreview = `previews-html/${raw}.html`;
  if (previewExtensions.has(ext) && fs.existsSync(abs(inferredPreview))) return relativeHref(pageRel, inferredPreview);
  if (viewableExtensions.has(ext) && raw && fs.existsSync(abs(raw))) return relativeHref(pageRel, raw);
  return "";
}

function downloadHref(pageRel, attachment) {
  const raw = toPosix(attachment.downloadPath || attachment.path);
  return raw ? relativeHref(pageRel, raw) : "";
}

function renderAttachments(pageRel, attachments) {
  const rows = [];
  for (const attachment of attachments) {
    const label = attachment.label || path.posix.basename(toPosix(attachment.path || ""));
    const actions = [];
    const view = viewHref(pageRel, attachment);
    const download = downloadHref(pageRel, attachment);
    if (view) actions.push(`<a class="file-action" href="${view}">查看</a>`);
    if (download) actions.push(`<a class="file-action" href="${download}" download>下载</a>`);
    if (!actions.length) continue;
    rows.push(`<li><span class="file-label">${escapeHtml(label)}</span><span class="file-actions">${actions.join("")}</span></li>`);
  }
  if (!rows.length) return "";
  return `<section class="attachments"><h2>Files</h2><ul>${rows.join("")}</ul></section>`;
}

function renderIspring(pageRel, manifestPage) {
  const entries = Array.isArray(manifestPage?.ispring) ? manifestPage.ispring : [];
  return entries
    .filter((entry) => entry.path && fs.existsSync(abs(entry.path)))
    .map((entry) => {
      const href = relativeHref(pageRel, entry.path);
      const title = escapeHtml(entry.label || "Course presentation");
      return `<section class="embedded-ispring overview-presentation"><iframe src="${href}" loading="lazy" allowfullscreen="allowfullscreen" title="${title}"></iframe></section>`;
    })
    .join("");
}

function extractTitle(html, manifestPage) {
  const pageTitle = html.match(/<div\b[^>]*class=["'][^"']*\bpage-title\b[^"']*["'][^>]*>[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (pageTitle) return stripTags(pageTitle[1]);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return stripTags(title[1]).replace(/^ENG2D\s*-\s*/i, "").replace(/\s*-\s*Course Content$/i, "");
  return manifestPage?.label || "Course Content";
}

function precleanMalformedMoodleHtml(value) {
  return String(value || "")
    .replace(/<div\s+data-canvas-width=["']?168\.779999999[\s\S]*?(?=<p\s+dir=["']\s*ltr=["'])/gi, "")
    .replace(/<p\s+dir=["']\s*ltr=["'][^>]*>(?:<span><br><\/span>|<p><\/p>)/gi, "");
}

function extractDivContentByClass(html, className) {
  const source = precleanMalformedMoodleHtml(html);
  const opener = new RegExp(`<div\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "i").exec(source);
  if (!opener) return null;

  const start = opener.index + opener[0].length;
  const divTag = /<\/?div\b[^>]*>/gi;
  divTag.lastIndex = start;
  let depth = 1;
  let match;
  while ((match = divTag.exec(html))) {
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) return source.slice(start, match.index);
    } else {
      depth += 1;
    }
  }
  return source.slice(start);
}

function cleanActivityContent(html) {
  const activity = extractDivContentByClass(html, "activity-body");
  if (activity !== null) {
    const cleaned = sanitizeContent(activity);
    if (/<main\b/i.test(cleaned)) return cleanActivityContent(cleaned);
    return cleaned;
  }
  const article = html.match(/<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
  if (article) return sanitizeContent(article[1]);
  const moodleContent = extractDivContentByClass(html, "moodle-content");
  if (moodleContent !== null) return sanitizeContent(moodleContent);
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return sanitizeContent(body ? body[1] : html);
}

function sanitizeContent(value) {
  let removedWrapperDivs = 0;
  let next = String(value || "")
    .replace(/<section\b[^>]*class=["'][^"']*\bfiles\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][\s\S]*$/i, "")
    .replace(/<div\b[^>]*id=["']assign_files_tree[^"']*["'][\s\S]*$/i, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bfileuploadsubmission\b[^"']*["'][\s\S]*$/i, "")
    .replace(/<div\b[^>]*class=["'][^"']*(?:\bbox\b|\bpy-3\b|\bgeneralbox\b|\bcenter\b|\bclearfix\b|\bno-overflow\b|\bsummary\b|\bbook_content\b)[^"']*["'][^>]*>/gi, () => {
      removedWrapperDivs += 1;
      return "";
    })
    .trim();
  while (removedWrapperDivs > 0 && /<\/div>\s*$/i.test(next)) {
    next = next.replace(/<\/div>\s*$/i, "").trimEnd();
    removedWrapperDivs -= 1;
  }
  return next;
}

function rewriteInlineAttachmentLinks(content, pageRel, attachments) {
  let next = content;
  for (const attachment of attachments) {
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

function removeMismatchedUnitReflectionLinks(content, pageRel) {
  const pageUnit = toPosix(pageRel).match(/^Unit\s+(\d+)\//i)?.[1];
  if (!pageUnit) return content;
  return content.replace(/<a\b[^>]*href=(["'])([^"']*ENG2D[^"']*Unit[^"']*End[^"']*Unit[^"']*Reflection[^"']*)\1[^>]*>[\s\S]*?<\/a>/gi, (match, _quote, href) => {
    const unit = decodeHtmlAttr(href).match(/ENG2D(?:%20|\s|-)*-?(?:%20|\s)*Unit(?:%20|\s)*(\d+)(?:%20|\s|-)*-?(?:%20|\s)*End/i)?.[1];
    return unit && unit !== pageUnit ? "" : match;
  });
}

function renderFullPage(pageRel, title, content, attachments, manifestPage) {
  const cssHref = relativeHref(pageRel, "_assets/course-page-shell.css");
  const cleanedContent = removeMismatchedUnitReflectionLinks(rewriteInlineAttachmentLinks(content, pageRel, attachments), pageRel);
  const ispringHtml = renderIspring(pageRel, manifestPage);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ENG2D - ${escapeHtml(title)} - Course Content</title>
  <link rel="stylesheet" href="${cssHref}" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>ENG2D</p><h1>${escapeHtml(title)}</h1></div>
    <section class="moodle-section">
      <header><p>Course Content</p><h2>${escapeHtml(title)}</h2></header>
      <div class="moodle-content"><div class="activity-body">${cleanedContent}</div>${ispringHtml}${renderAttachments(pageRel, attachments)}</div>
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

function normalizeFileSections(html, pageRel, manifestPage) {
  return html.replace(/<section\b[^>]*class=["'][^"']*\bfiles\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, (sectionHtml) => {
    const attachments = visibleAttachments(pageRel, manifestPage, sectionHtml);
    return renderAttachments(pageRel, attachments);
  });
}

function patchHtml(pageRel, html, manifestPage) {
  if (
    /assign_files_tree|fileuploadsubmission/i.test(html) ||
    /<section\b[^>]*class=["'][^"']*\bfiles\b/i.test(html) ||
    /<section\b[^>]*class=["'][^"']*\battachments\b/i.test(html) ||
    hasLocalDisplayableFiles(pageRel)
  ) {
    const title = extractTitle(html, manifestPage);
    const oldFiles = html.match(/<section\b[^>]*class=["'][^"']*\bfiles\b[^"']*["'][^>]*>[\s\S]*?<\/section>/i);
    const attachments = visibleAttachments(pageRel, manifestPage, oldFiles ? oldFiles[0] : "");
    return renderFullPage(pageRel, title, cleanActivityContent(html), attachments, manifestPage);
  }
  return normalizeFileSections(html, pageRel, manifestPage);
}

function updateManifestBytes(refs, patchedFiles) {
  for (const ref of refs) {
    const rel = toPosix(ref.path);
    if (!patchedFiles.has(rel)) continue;
    const filePath = abs(rel);
    if (!fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, "utf8");
    ref.bytes = Buffer.byteLength(html);
    ref.textPreview = stripTags(html).slice(0, 240);
  }
}

const manifest = readJson(manifestPath);
const pageMap = new Map();
const fileMap = new Map();
const refs = collectManifestRefs(manifest, pageMap, fileMap);
const htmlFiles = walk(courseRoot);
const patchedFiles = new Set();
const report = {
  course: "ENG2D",
  scannedHtml: htmlFiles.length,
  patched: [],
  skipped: [],
};

for (const pageRel of htmlFiles) {
  const filePath = abs(pageRel);
  const html = fs.readFileSync(filePath, "utf8");
  if (
    !/(<section\b[^>]*class=["'][^"']*\bfiles\b|assign_files_tree|fileuploadsubmission|class=["']button["']|>View<\/a>|>Download<\/a>)/i.test(html) &&
    !/<section\b[^>]*class=["'][^"']*\battachments\b/i.test(html) &&
    !hasLocalDisplayableFiles(pageRel)
  ) {
    continue;
  }
  const next = patchHtml(pageRel, html, pageMap.get(pageRel));
  if (next !== html) {
    fs.writeFileSync(filePath, next, "utf8");
    patchedFiles.add(pageRel);
    report.patched.push(pageRel);
  }
}

updateManifestBytes(refs, patchedFiles);
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  eng2dAllPageFileDisplayRepair: {
    repairedAt: new Date().toISOString(),
    patchedPages: report.patched.length,
    rule: "All ENG2D page-level file displays use the ENG3U/ENG4U attachments component; inline image/video media are not duplicated as ordinary file rows.",
  },
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

const reportPath = path.join(repoRoot, "deployment", "ENG2D-all-page-file-display-repair-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
writeJson(reportPath, report);
console.log(JSON.stringify(report, null, 2));
