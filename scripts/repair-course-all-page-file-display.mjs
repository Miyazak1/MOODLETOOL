import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

const COURSE = safeCourse(readArg("--course"));
if (!COURSE) {
  console.error("Usage: node scripts/repair-course-all-page-file-display.mjs --course COURSE");
  process.exit(1);
}
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", COURSE);
const manifestPath = path.join(courseRoot, "course-manifest.json");

const viewableExtensions = new Set([".pdf", ".html", ".htm", ".txt", ".gif", ".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const previewExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf"]);
const hiddenFileRowExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mp3", ".wav"]);

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
        rel.startsWith("_backups/") ||
        rel.startsWith("ispring-localized/") ||
        rel.startsWith("localized-moodle/h5p-external/") ||
        rel.startsWith("previews-html/") ||
        rel.startsWith("texts/")
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

function collectManifestRefs(node, pageMap, refs = []) {
  if (!node || typeof node !== "object") return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectManifestRefs(item, pageMap, refs);
    return refs;
  }
  const rel = toPosix(node.path);
  if (rel) {
    refs.push(node);
    if (/\.html?$/i.test(rel)) pageMap.set(rel, node);
  }
  for (const value of Object.values(node)) collectManifestRefs(value, pageMap, refs);
  return refs;
}

function collectPageLessonContexts(manifest) {
  const contexts = new Map();
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const section of lesson.bookSections || []) {
        if (!section?.path) continue;
        contexts.set(toPosix(section.path), { unit, lesson, section });
      }
    }
  }
  return contexts;
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
    const inferredPreview = previewExtensions.has(ext) ? `previews-html/${rel}.html` : rel;
    merged.push({
      label: entry.name.replace(/^[a-f0-9]{10}-/i, ""),
      type: ext.replace(/^\./, "") || "file",
      category: "moodle_file",
      role: "attachment",
      path: rel,
      bytes: stat.size,
      previewPath: fs.existsSync(abs(inferredPreview)) ? inferredPreview : rel,
      downloadPath: rel,
      inferredFromLocalFiles: true,
    });
  }
  return merged;
}

function visibleAttachments(pageRel, manifestPage, oldSectionHtml = "") {
  let attachments = Array.isArray(manifestPage?.attachments) ? [...manifestPage.attachments] : [];
  if (!attachments.length && oldSectionHtml) attachments = parsedRowsFromOldFilesSection(oldSectionHtml, pageRel);
  attachments = mergeLocalFileAttachments(pageRel, attachments);
  const visible = attachments.filter((attachment) => {
    const rel = toPosix(attachment.path || attachment.downloadPath);
    const ext = path.posix.extname(rel).toLowerCase();
    return !hiddenFileRowExtensions.has(ext);
  });
  if (manifestPage) {
    const existing = new Set((manifestPage.attachments || []).map((attachment) => toPosix(attachment.path || attachment.downloadPath)));
    const inferred = visible.filter((attachment) => attachment.inferredFromLocalFiles && !existing.has(toPosix(attachment.path || attachment.downloadPath)));
    if (inferred.length) manifestPage.attachments = [...(manifestPage.attachments || []), ...inferred];
  }
  return visible;
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
  if (raw && fs.existsSync(abs(raw))) return relativeHref(pageRel, raw);
  return "";
}

function downloadHref(pageRel, attachment) {
  const raw = toPosix(attachment.downloadPath || attachment.path);
  return raw ? relativeHref(pageRel, raw) : "";
}

function comparablePreviewPath(value) {
  let decoded = toPosix(value);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original value if it is already decoded or malformed.
  }
  return decoded
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function linkTargetsAttachmentPreview(resolvedHref, attachment) {
  const resolved = toPosix(resolvedHref);
  const raw = toPosix(attachment.path || attachment.downloadPath);
  const preview = toPosix(attachment.previewPath);
  if (!resolved || !raw) return false;
  if (resolved === raw || (preview && resolved === preview)) return true;

  const ext = path.posix.extname(raw).toLowerCase();
  if (!previewExtensions.has(ext) || !resolved.startsWith("previews-html/")) return false;

  const expectedPreview = preview || `previews-html/${raw}.html`;
  if (comparablePreviewPath(resolved) === comparablePreviewPath(expectedPreview)) return true;

  const rawPreviewSuffix = comparablePreviewPath(`${path.posix.basename(raw)}.html`);
  return Boolean(rawPreviewSuffix && comparablePreviewPath(resolved).endsWith(rawPreviewSuffix));
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
  return `<section class="attachments files"><h2>Files</h2><ul>${rows.join("")}</ul></section>`;
}

function sectionFlow(lessonContext) {
  const scope = `${lessonContext?.section?.sectionLabel || ""} ${lessonContext?.section?.label || ""} ${lessonContext?.section?.role || ""} ${lessonContext?.section?.path || ""}`.toLowerCase();
  if (scope.includes("learning goal") || scope.includes("success criteria")) return "expectations";
  if (scope.includes("hands")) return "hands_on";
  if (scope.includes("consolidation") || scope.includes("consoldation")) return "consolidation";
  if (scope.includes("homework")) return "homework";
  if (scope.includes("expectation")) return "expectations";
  if (scope.includes("lesson")) return "lesson";
  return "";
}

function isIspring(item) {
  const scope = `${item?.label || ""} ${item?.role || ""} ${item?.category || ""} ${item?.path || ""} ${item?.packagePath || ""}`.toLowerCase();
  return scope.includes("ispring") || scope.includes("presentation.html") || scope.includes("lesson_ispring");
}

function isIspringForFlow(item, flow) {
  if (!isIspring(item)) return false;
  const scope = `${item?.label || ""} ${item?.role || ""} ${item?.category || ""} ${item?.path || ""} ${item?.packagePath || ""}`.toLowerCase();
  if (flow === "hands_on") return scope.includes("hands");
  if (flow === "consolidation") return scope.includes("consolidation") || scope.includes("consoldation");
  if (flow === "homework") return scope.includes("homework");
  if (flow === "lesson") return !(scope.includes("hands") || scope.includes("consolidation") || scope.includes("consoldation") || scope.includes("homework"));
  return false;
}

function collectIspringEntries(manifestPage, lessonContext) {
  const flow = sectionFlow(lessonContext);
  const sectionEntries = Array.isArray(manifestPage?.ispring) ? manifestPage.ispring : [];
  const lessonEntries = Array.isArray(lessonContext?.lesson?.ispring)
    ? lessonContext.lesson.ispring.filter((entry) => isIspringForFlow(entry, flow))
    : [];
  const seen = new Set();
  return [...sectionEntries, ...lessonEntries].filter((entry) => {
    const key = toPosix(entry?.path || entry?.previewPath || entry?.url || entry?.label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderIspringEntry(pageRel, entry) {
  const href = relativeHref(pageRel, entry.path);
  const title = escapeHtml(entry.label || "Course presentation");
  return `<section class="embedded-ispring overview-presentation"><iframe src="${href}" loading="lazy" allowfullscreen="allowfullscreen" title="${title}"></iframe></section>`;
}

function renderIspring(pageRel, entries, content) {
  return entries
    .filter((entry) => entry.path && fs.existsSync(abs(entry.path)) && !content.includes(toPosix(entry.path)) && !content.includes(relativeHref(pageRel, entry.path)))
    .map((entry) => renderIspringEntry(pageRel, entry))
    .join("");
}

function pruneUnexpectedIspringEmbeds(content, pageRel, entries) {
  const allowed = new Set();
  for (const entry of entries) {
    if (!entry.path) continue;
    const rel = toPosix(entry.path);
    allowed.add(rel);
    allowed.add(relativeHref(pageRel, rel));
  }
  const shouldKeep = (src) => {
    if (!src) return entries.length;
    const resolved = resolveHref(pageRel, decodeHtmlAttr(src));
    return allowed.has(src) || allowed.has(resolved);
  };
  let next = String(content || "").replace(
    /<(section|div)\b(?=[^>]*class=["'][^"']*(?:\bembedded-ispring\b|\blocalized-ispring\b|\boverview-presentation\b))[^>]*>[\s\S]*?<iframe\b[^>]*(?:\bsrc|\bdata-src)=["']([^"']+)["'][\s\S]*?<\/iframe>\s*(?:<\/(?:section|div)>){0,2}/gi,
    (block, _tag, src) => (shouldKeep(src) ? block : ""),
  );
  return next.replace(
    /<(section|div)\b(?=[^>]*class=["'][^"']*(?:\bembedded-ispring\b|\blocalized-ispring\b|\boverview-presentation\b))[^>]*>[\s\S]*?<\/\1>/gi,
    (block) => {
      const src = block.match(/<iframe\b[^>]*(?:\bsrc|\bdata-src)=["']([^"']+)["']/i)?.[1] || "";
      return shouldKeep(src) ? block : "";
    },
  );
}

function hasEmptyIframeWithoutSrc(html) {
  return /<iframe\b(?:(?!\bsrc=|\bdata-src=)[^>])*>\s*<\/iframe>/i.test(String(html || ""));
}

function hasEmbeddedIspring(html) {
  return /class=["'][^"']*(?:\bembedded-ispring\b|\blocalized-ispring\b|\boverview-presentation\b)/i.test(String(html || ""));
}

function hasOverclosedMoodleContent(html) {
  return /class=["'][^"']*\bactivity-body\b[^"']*["'][\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/i.test(String(html || ""));
}

function hasRenderableIspringForPage(manifestPage, lessonContext, pageRel, html) {
  return collectIspringEntries(manifestPage, lessonContext).some((entry) => {
    if (!entry.path || !fs.existsSync(abs(entry.path))) return false;
    const rel = toPosix(entry.path);
    return hasEmptyIframeWithoutSrc(html) || (!String(html || "").includes(rel) && !String(html || "").includes(relativeHref(pageRel, rel)));
  });
}

function extractTitle(html, manifestPage) {
  const pageTitle = html.match(/<div\b[^>]*class=["'][^"']*\bpage-title\b[^"']*["'][^>]*>[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (pageTitle) return stripTags(pageTitle[1]).replace(/^-\s*/, "") || stripTags(pageTitle[1]);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]).replace(/^-\s*/, "");
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const coursePrefix = new RegExp(`^${COURSE}\\s*-\\s*`, "i");
    return stripTags(title[1]).replace(coursePrefix, "").replace(/\s*-\s*Course Content$/i, "").replace(/^-\s*/, "");
  }
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
  while ((match = divTag.exec(source))) {
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) return source.slice(start, match.index);
    } else {
      depth += 1;
    }
  }
  return source.slice(start);
}

function extractDivContentById(html, id) {
  const source = precleanMalformedMoodleHtml(html);
  const opener = new RegExp(`<div\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>`, "i").exec(source);
  if (!opener) return null;
  const start = opener.index + opener[0].length;
  const divTag = /<\/?div\b[^>]*>/gi;
  divTag.lastIndex = start;
  let depth = 1;
  let match;
  while ((match = divTag.exec(source))) {
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) return source.slice(start, match.index);
    } else {
      depth += 1;
    }
  }
  return source.slice(start);
}

function extractLooseActivityBody(html) {
  const source = String(html || "").replace(/<\/html>[\s\S]*$/i, "</html>");
  const opener = /<div\b[^>]*class=["'][^"']*\bactivity-body\b[^"']*["'][^>]*>/i.exec(source);
  if (!opener) return null;
  const start = opener.index + opener[0].length;
  const endMatch = /<\/section\s*>\s*<\/main\s*>/i.exec(source.slice(start));
  if (endMatch) return source.slice(start, start + endMatch.index);
  return source.slice(start);
}

function cleanActivityContent(html) {
  if (/\bid=["']topofscroll["']|class=["'][^"']*\bbreadcrumb\b/i.test(html) && /\bid=["']intro["']/i.test(html)) {
    const intro = extractDivContentById(html, "intro");
    if (intro) return sanitizeContent(intro);
  }
  const looseActivityBody = extractLooseActivityBody(html);
  if (looseActivityBody !== null) return sanitizeContent(looseActivityBody);

  const activity = extractDivContentByClass(html, "activity-body");
  if (activity !== null) {
    const cleaned = sanitizeContent(activity);
    if (/<main\b/i.test(cleaned)) return cleanActivityContent(cleaned);
    return cleaned;
  }
  const moodleContent = extractDivContentByClass(html, "moodle-content");
  if (moodleContent !== null) return sanitizeContent(moodleContent);
  const article = html.match(/<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
  if (article) return sanitizeContent(article[1]);
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return sanitizeContent(body ? body[1] : html);
}

function removeEmptyHeadings(value) {
  let next = String(value || "");
  let previous = "";
  const emptyHeading =
    /<h([1-6])\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>|<span\b[^>]*>\s*<\/span>|<strong\b[^>]*>\s*<\/strong>|<u\b[^>]*>\s*<\/u>|<em\b[^>]*>\s*<\/em>)*<\/h\1>/gi;
  while (next !== previous) {
    previous = next;
    next = next.replace(emptyHeading, "");
  }
  return next;
}

function trimDanglingContainerClosers(value) {
  let next = String(value || "");
  for (let i = 0; i < 8; i += 1) {
    const before = next;
    next = next.replace(/\s*<\/(?:div|section|main|body|html)>\s*$/i, "").trimEnd();
    if (next === before) break;
  }
  return next;
}

function sanitizeContent(value) {
  let removedWrapperDivs = 0;
  let next = String(value || "")
    .replace(/<\/html>[\s\S]*$/i, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
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
  return removeEmptyHeadings(trimDanglingContainerClosers(next));
}

function rewriteInlineAttachmentLinks(content, pageRel, attachments) {
  let next = content;
  for (const attachment of attachments) {
    const raw = toPosix(attachment.path || attachment.downloadPath);
    const view = viewHref(pageRel, attachment);
    if (!raw || !view) continue;
    next = next.replace(/\bhref=(["'])([^"']+)\1/gi, (match, quote, href) => {
      const resolved = resolveHref(pageRel, href);
      return linkTargetsAttachmentPreview(resolved, attachment) ? `href=${quote}${view}${quote}` : match;
    });
  }
  return next;
}

function inferExternalSimulationUrl(title, content) {
  const text = stripTags(`${title || ""} ${content || ""}`).toLowerCase();
  if (
    text.includes("gene regulation lab") &&
    text.includes("generate and collect three types of protein") &&
    text.includes("protein synthesis")
  ) {
    return "https://phet.colorado.edu/sims/html/gene-expression-essentials/latest/gene-expression-essentials_en.html";
  }
  if (text.includes("action potential simulation") && (text.includes("stimulate neuron") || text.includes("neuron"))) {
    return "https://phet.colorado.edu/sims/html/neuron/latest/neuron_en.html";
  }
  if (text.includes("natural selection simulation") && (text.includes("bunnies") || text.includes("brown fur"))) {
    return "https://phet.colorado.edu/sims/html/natural-selection/latest/natural-selection_en.html";
  }
  return "";
}

function restoreMissingSimulationIframes(content, title) {
  const src = inferExternalSimulationUrl(title, content);
  if (!src) return content;
  return String(content || "").replace(/<iframe\b(?![^>]*(?:\bsrc=|\bdata-src=))([^>]*)>\s*<\/iframe>/i, (match, attrs) => {
    return `<iframe src="${src}"${attrs} loading="lazy"></iframe>`;
  });
}

function replaceEmptyIframesWithIspring(content, pageRel, entries) {
  if (!/<iframe\b(?:(?!\bsrc=|\bdata-src=)[^>])*>\s*<\/iframe>/i.test(content)) return content;
  if (!entries.length) {
    return String(content || "").replace(/<iframe\b(?:(?!\bsrc=|\bdata-src=)[^>])*>\s*<\/iframe>/gi, "");
  }
  let remaining = entries.filter((entry) => {
    if (!entry.path || !fs.existsSync(abs(entry.path))) return false;
    const rel = toPosix(entry.path);
    return !content.includes(rel) && !content.includes(relativeHref(pageRel, rel));
  });
  return String(content || "").replace(/<iframe\b(?:(?!\bsrc=|\bdata-src=)[^>])*>\s*<\/iframe>/gi, (match) => {
    const entry = remaining.shift();
    return entry ? renderIspringEntry(pageRel, entry) : "";
  });
}

function pageTitleContext(lessonContext) {
  const unit = lessonContext?.unit?.unit;
  const lesson = lessonContext?.lesson?.lesson;
  const section = lessonContext?.section?.sectionIndex;
  const parts = [COURSE];
  if (unit) parts.push(`Unit ${unit}`);
  if (lesson) parts.push(`Lesson ${lesson}`);
  if (section) parts.push(`Section ${section}`);
  return parts.join(" · ");
}

function renderFullPage(pageRel, title, content, attachments, manifestPage, lessonContext) {
  const cssHref = relativeHref(pageRel, "_assets/course-page-shell.css");
  const ispringEntries = collectIspringEntries(manifestPage, lessonContext);
  const restoredSimulationContent = restoreMissingSimulationIframes(content, title);
  const restoredContent = replaceEmptyIframesWithIspring(restoredSimulationContent, pageRel, ispringEntries);
  const cleanedContent = rewriteInlineAttachmentLinks(trimDanglingContainerClosers(pruneUnexpectedIspringEmbeds(restoredContent, pageRel, ispringEntries)), pageRel, attachments);
  const ispringHtml = renderIspring(pageRel, ispringEntries, cleanedContent);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${COURSE} - ${escapeHtml(title)} - Course Content</title>
  <link rel="stylesheet" href="${cssHref}" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>${escapeHtml(pageTitleContext(lessonContext))}</p><h1>${escapeHtml(title)}</h1></div>
    <section class="moodle-section">
      <header><p>${escapeHtml(lessonContext?.section?.sectionLabel || "Course Content")}</p><h2>${escapeHtml(lessonContext?.section?.sectionLabel || title)}</h2></header>
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

function patchHtml(pageRel, html, manifestPage, lessonContext) {
  if (
    /assign_files_tree|fileuploadsubmission/i.test(html) ||
    /<section\b[^>]*class=["'][^"']*\bfiles\b/i.test(html) ||
    /<section\b[^>]*class=["'][^"']*\battachments\b/i.test(html) ||
    hasLocalDisplayableFiles(pageRel) ||
    hasEmptyIframeWithoutSrc(html) ||
    hasEmbeddedIspring(html) ||
    hasOverclosedMoodleContent(html) ||
    hasRenderableIspringForPage(manifestPage, lessonContext, pageRel, html)
  ) {
    const title = extractTitle(html, manifestPage);
    const oldFiles = html.match(/<section\b[^>]*class=["'][^"']*\b(?:files|attachments)\b[^"']*["'][^>]*>[\s\S]*?<\/section>/i);
    const attachments = visibleAttachments(pageRel, manifestPage, oldFiles ? oldFiles[0] : "");
    return renderFullPage(pageRel, title, cleanActivityContent(html), attachments, manifestPage, lessonContext);
  }
  return html;
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
const refs = collectManifestRefs(manifest, pageMap);
const pageLessonContexts = collectPageLessonContexts(manifest);
const htmlFiles = walk(courseRoot);
const patchedFiles = new Set();
const report = {
  course: COURSE,
  scannedHtml: htmlFiles.length,
  patched: [],
  skipped: [],
};

for (const pageRel of htmlFiles) {
  const filePath = abs(pageRel);
  const html = fs.readFileSync(filePath, "utf8");
  const manifestPage = pageMap.get(pageRel);
  const lessonContext = pageLessonContexts.get(pageRel);
  if (
    !/(<section\b[^>]*class=["'][^"']*\bfiles\b|assign_files_tree|fileuploadsubmission|class=["']button["']|>View<\/a>|>Download<\/a>)/i.test(html) &&
    !/<section\b[^>]*class=["'][^"']*\battachments\b/i.test(html) &&
    !hasLocalDisplayableFiles(pageRel) &&
    !hasEmptyIframeWithoutSrc(html) &&
    !hasEmbeddedIspring(html) &&
    !hasOverclosedMoodleContent(html) &&
    !hasRenderableIspringForPage(manifestPage, lessonContext, pageRel, html)
  ) {
    continue;
  }
  const next = patchHtml(pageRel, html, manifestPage, lessonContext);
  if (next !== html) {
    fs.writeFileSync(filePath, next, "utf8");
    patchedFiles.add(pageRel);
    report.patched.push(pageRel);
  }
}

updateManifestBytes(refs, patchedFiles);
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  [`${COURSE.toLowerCase()}AllPageFileDisplayRepair20260825`]: {
    repairedAt: new Date().toISOString(),
    patchedPages: report.patched.length,
    rule: `All ${COURSE} page-level file displays use the ENG3U/ENG4U attachments component; video/audio media are not duplicated as ordinary file rows.`,
  },
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

const reportPath = path.join(repoRoot, "deployment", `${COURSE}-all-page-file-display-repair-report.json`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
writeJson(reportPath, report);
console.log(JSON.stringify(report, null, 2));
