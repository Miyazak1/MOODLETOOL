import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultWorkspaceRoot = resolve(projectRoot, "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureShellAsset(courseRoot) {
  const target = join(courseRoot, "_assets", "course-page-shell.css");
  if (existsSync(target)) return { copied: false, target };
  const sourceCandidates = [
    join(defaultWorkspaceRoot, "courseware", "ENG3U", "_assets", "course-page-shell.css"),
    join(defaultWorkspaceRoot, "courseware", "ENG1D", "_assets", "course-page-shell.css"),
  ];
  const source = sourceCandidates.find((candidate) => existsSync(candidate));
  if (!source) throw new Error("Cannot find course-page-shell.css source asset.");
  mkdirSync(join(courseRoot, "_assets"), { recursive: true });
  copyFileSync(source, target);
  return { copied: true, source, target };
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
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

function normalizeRelPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function relativeFromPage(pageRel, targetRel) {
  return posix.relative(posix.dirname(normalizeRelPath(pageRel)), normalizeRelPath(targetRel)) || ".";
}

function removeFileSections(body) {
  return String(body || "")
    .replace(/<section\b[^>]*\bclass=["'][^"']*\b(?:attachments|files)\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, "")
    .trim();
}

function cleanActivityBody(body) {
  let cleaned = removeFileSections(body);
  cleaned = cleaned.replace(/<center\b[^>]*>\s*<div\b[^>]*\bclass=["'][^"']*\bsubmissionlinks\b[^"']*["'][\s\S]*?<\/center>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bclass=["'][^"']*\bsubmissionlinks\b[^"']*["'][\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/<div\b[^>]*\bclass=["'][^"']*\b(?:quizinfo|quizattemptcounts|quizattempt)\b[^"']*["'][\s\S]*?<\/div>/gi, "");
  cleaned = cleaned.replace(/<h([1-6])([^>]*)>\s*<strong([^>]*)>\s*<h\1\b[^>]*>([\s\S]*?)<\/h\1>\s*<\/strong>\s*<\/h\1>/gi, "<h$1$2><strong$3>$4</strong></h$1>");
  cleaned = cleaned.replace(
    /<h([1-6])\b[^>]*>\s*<strong>\s*<h([1-6])\b([^>]*)>\s*<strong>([\s\S]*?)<\/strong>\s*<\/h\2>\s*<\/strong>\s*<\/h\1>/gi,
    "<h$2$3><strong>$4</strong></h$2>",
  );
  cleaned = cleaned.replace(/<h([1-6])\b[^>]*>\s*(?:<strong>\s*)?(?:<br\s*\/?>|&nbsp;|\s)*(?:<\/strong>\s*)?<\/h\1>/gi, "");
  cleaned = cleaned.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, "");
  cleaned = cleaned.replace(
    /^\s*<div\b[^>]*\bclass=["'][^"']*\bbox\b[^"']*\bgeneralbox\b[^"']*["'][^>]*>\s*<div\b[^>]*\bclass=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>/i,
    "",
  );
  cleaned = cleaned.replace(
    /^\s*<div\b[^>]*\bclass=["'][^"']*\bbox\b[^"']*\bgeneralbox\b[^"']*\bcenter\b[^"']*\bclearfix\b[^"']*["'][^>]*>\s*<div\b[^>]*\bclass=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>/i,
    "",
  );
  cleaned = cleaned.replace(/\s*<\/div>\s*<\/div>\s*$/i, "");
  cleaned = cleaned.replace(/\s*<\/div>\s*$/i, "");
  cleaned = cleaned.replace(/<p\b[^>]*>\s*(?:<strong>\s*<\/strong>|<br\s*\/?>|\s|&nbsp;)*<\/p>/gi, "");
  return cleaned.trim();
}

function extractBody(html) {
  const activityBody = html.match(/<div\b[^>]*\bclass=["'][^"']*\bactivity-body\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<section\b|<\/article>|<\/div>\s*<\/section>)/i);
  if (activityBody) return activityBody[1];

  const moodleIntro = html.match(
    /<div\b(?=[^>]*\bid=["']intro["'])(?=[^>]*\bclass=["'][^"']*\bgeneralbox\b)[^>]*>\s*<div\b[^>]*\bclass=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  if (moodleIntro) return moodleIntro[1].trim();

  const article = html.match(/<article\b[^>]*\bclass=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)(?:<section\b[^>]*\bclass=["'][^"']*\bfiles\b|<\/article>)/i);
  if (article) {
    return article[1]
      .replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, "")
      .trim();
  }

  const plainArticle = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (plainArticle) {
    return plainArticle[1]
      .replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, "")
      .trim();
  }

  const plainMain = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (plainMain) {
    return plainMain[1]
      .replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, "")
      .trim();
  }

  const moodleContent = html.match(/<div\b[^>]*\bclass=["'][^"']*\bmoodle-content\b[^"']*["'][^>]*>([\s\S]*?)(?:<section\b[^>]*\bclass=["'][^"']*\battachments\b|<\/div>\s*<\/section>)/i);
  if (moodleContent) return moodleContent[1].trim();

  return "";
}

function isDownloadableAttachment(attachment) {
  const type = String(attachment?.type || "").toLowerCase();
  const path = String(attachment?.path || attachment?.href || "").toLowerCase();
  return !["mp4", "webm", "mov", "m4v"].includes(type) && !/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(path);
}

function renderAttachments(pageRel, item) {
  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
  const rows = attachments
    .filter((attachment) => attachment?.path || attachment?.href)
    .map((attachment) => {
      const downloadHref = attachment.href || relativeFromPage(pageRel, attachment.downloadPath || attachment.path);
      const viewHref = attachment.previewPath ? relativeFromPage(pageRel, attachment.previewPath) : downloadHref;
      const downloadAction = isDownloadableAttachment(attachment)
        ? `<a class="file-action" href="${htmlEscape(downloadHref, true)}" download>下载</a>`
        : "";
      return `<li><span class="file-label">${htmlEscape(attachment.label || attachment.path || "Attachment")}</span><span class="file-actions"><a class="file-action" href="${htmlEscape(viewHref, true)}">查看</a>${downloadAction}</span></li>`;
    })
    .join("");
  if (!rows) return "";
  return `<section class="attachments"><h2>Files</h2><ul>${rows}</ul></section>`;
}

function pageTitle(course, item) {
  return String(item.label || item.title || "Course Content").trim();
}

function renderPage({ course, title, pageRel, body, attachmentsHtml }) {
  const cleaned = cleanActivityBody(body);
  const shellCss = relativeFromPage(pageRel, "_assets/course-page-shell.css");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(`${course} - ${title} - Course Content`)}</title>
  <link rel="stylesheet" href="${htmlEscape(shellCss, true)}" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>${htmlEscape(course)}</p><h1>${htmlEscape(title)}</h1></div>
    <section class="moodle-section">
      <header><p>Course Content</p><h2>${htmlEscape(title)}</h2></header>
      <div class="moodle-content"><h1>${htmlEscape(title)}</h1>
      <div class="activity-body">${cleaned}</div>
      ${attachmentsHtml}</div>
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

function collectShellPageItems(manifest) {
  const items = [];
  const seen = new Set();
  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const rel = normalizeRelPath(value.path || "");
    const shouldRepair = /^localized-moodle-activities\/[^/]+\/[^/]+\/index\.html$/i.test(rel)
      || /^course-sections\/[^/]+\/index\.html$/i.test(rel);
    if (shouldRepair && !seen.has(rel)) {
      seen.add(rel);
      items.push(value);
    }
    for (const nested of Object.values(value)) visit(nested);
  }
  visit(manifest);
  return items;
}

const course = safeCourse(readArg("--course"));
if (!course) {
  console.error("Usage: node scripts/repair-localized-page-activity-shell.mjs --course COURSE");
  process.exit(2);
}

const workspaceRoot = resolve(readArg("--workspace-root") || defaultWorkspaceRoot);
const courseRoot = resolve(readArg("--course-root") || join(workspaceRoot, "courseware", course));
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = readJson(manifestPath);
const shellAsset = ensureShellAsset(courseRoot);
const report = { course, shellAsset, scanned: 0, patched: 0, skipped: [] };

for (const item of collectShellPageItems(manifest)) {
  const rel = normalizeRelPath(item.path);
  const abs = join(courseRoot, rel);
  report.scanned += 1;
  if (!existsSync(abs)) {
    report.skipped.push({ path: rel, reason: "missing-html" });
    continue;
  }
  const html = readFileSync(abs, "utf8");
  const body = extractBody(html);
  const attachmentsHtml = renderAttachments(rel, item);
  if (!body && !attachmentsHtml) {
    report.skipped.push({ path: rel, reason: "empty-body-and-no-attachments" });
    continue;
  }
  const title = pageTitle(course, item);
  writeFileSync(abs, renderPage({ course, title, pageRel: rel, body, attachmentsHtml }), "utf8");
  item.bytes = statSync(abs).size;
  item.textPreview = stripTags(readFileSync(abs, "utf8")).slice(0, 800);
  report.patched += 1;
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.localizedPageActivityShellRepair = {
  patchedAt: new Date().toISOString(),
  ...report,
  note: "Normalized course section, localized Moodle page, and assignment/dropbox pages to the ENG3U course page shell and ENG3U file action markup.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify(report, null, 2));
