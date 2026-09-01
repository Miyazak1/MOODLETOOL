import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import unzipper from "unzipper";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = safeCourse(readArg("--course"));
const rawDirArg = readArg("--raw-dir");
const initialDirArg = readArg("--initial-dir");

if (!course) {
  console.error("Usage: node scripts/localize-stmary-wordpress-h5p-embeds.mjs --course COURSE [--raw-dir inbox/course-books-crawled] [--initial-dir inbox/course-books]");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const rawDir = rawDirArg ? resolve(projectRoot, rawDirArg) : join(projectRoot, "inbox", `${course.toLowerCase()}-stmary-books-crawled`);
const initialDir = initialDirArg ? resolve(projectRoot, initialDirArg) : join(projectRoot, "inbox", `${course.toLowerCase()}-stmary-books`);
const outDir = join(courseRoot, "localized-moodle", "h5p-external");
const reportPath = join(projectRoot, "deployment", `${course}-external-h5p-localization-report.json`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeCourse(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function slugify(value) {
  return String(value || "h5p").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "h5p";
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function htmlHref(fromRelPath, toRelPath) {
  return toPosix(posix.relative(posix.dirname(toPosix(fromRelPath)), toPosix(toRelPath))).split("/").map((part) => encodeURIComponent(part)).join("/");
}

function extractJsonString(html, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i").exec(html);
  if (!match) return "";
  return JSON.parse(`"${match[1]}"`);
}

function extractLessonNo(value) {
  return Number(String(value || "").match(/Lesson\s*(\d+)/i)?.[1] || 0);
}

function sectionLabel(page, indexInLesson) {
  let label = String(page.tocText || "").replace(/^Next:\s*/i, "").trim();
  if (/^Lesson\s+\d+/i.test(label)) label = "Lesson Expectations";
  if (!label || /^Lesson$/i.test(label)) label = indexInLesson === 0 ? "Lesson Expectations" : "Lesson";
  return label.replace(/^Consoldation$/i, "Consolidation").replace(/^Hands on$/i, "Hands On");
}

function h5pIds(html) {
  const normalized = String(html || "").replaceAll("&amp;", "&");
  return [
    ...normalized.matchAll(/welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed&id=(\d+)/gi),
    ...normalized.matchAll(/data-h5p-id=["'](\d+)["']/gi),
  ].map((match) => match[1]);
}

function titleFromEmbed(html, id) {
  return (
    extractJsonString(html, "title") ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
    `H5P ${id}`
  );
}

function stableH5pSource(id) {
  return `https://welcome.hexstruct.com/h5p-embed/${id}`;
}

function cleanTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  return title && !/^title$/i.test(title) ? title : "";
}

async function titleFromH5pPackage(buffer, fallback) {
  try {
    const directory = await unzipper.Open.buffer(buffer);
    const entry = directory.files.find((file) => file.path === "h5p.json");
    if (!entry) return fallback;
    const metadata = JSON.parse((await entry.buffer()).toString("utf8"));
    return cleanTitle(metadata.title) || fallback;
  } catch {
    return fallback;
  }
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { buffer, contentType: response.headers.get("content-type") || "", finalUrl: response.url || url };
}

function validateH5p(buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("downloaded H5P is not a ZIP package");
}

function collectRows(manifest) {
  const rows = [];
  for (let unit = 1; unit <= 20; unit += 1) {
    const rawPath = join(rawDir, `unit-${String(unit).padStart(2, "0")}-book.json`);
    const lessonSectionsRawPath = join(rawDir, `moodle-book-raw-${course}-U${String(unit).padStart(2, "0")}.json`);
    if (!existsSync(rawPath) && existsSync(lessonSectionsRawPath)) {
      const crawled = readJson(lessonSectionsRawPath);
      for (const lessonRow of crawled.lessons || []) {
        const lesson = Number(lessonRow.lesson || 0);
        if (!lesson) continue;
        for (const sectionRow of lessonRow.sections || []) {
          const section = sectionRow.normalizedLabel || sectionRow.label || "";
          for (const id of h5pIds(sectionRow.page?.html || "")) {
            rows.push({
              course,
              unit,
              lesson,
              lessonId: `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
              section,
              id,
              embedUrl: `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`,
            });
          }
        }
      }
      continue;
    }
    if (!existsSync(rawPath)) continue;
    const crawled = readJson(rawPath);
    const pages = [];
    const initialPath = join(initialDir, `unit-${String(unit).padStart(2, "0")}-book.json`);
    if (existsSync(initialPath)) {
      const initial = readJson(initialPath);
      if (initial.pages?.[0]) pages.push({ ...initial.pages[0], tocText: "Lesson Expectations" });
    }
    pages.push(...(crawled.pages || []));

    const grouped = new Map();
    for (const page of pages) {
      const lesson = extractLessonNo(page.title || page.tocText);
      if (!lesson) continue;
      if (!grouped.has(lesson)) grouped.set(lesson, []);
      grouped.get(lesson).push(page);
    }

    for (const [lesson, lessonPages] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
      for (const [index, page] of lessonPages.entries()) {
        const section = sectionLabel(page, index);
        for (const id of h5pIds(page.html)) {
          rows.push({
            course,
            unit,
            lesson,
            lessonId: `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
            section,
            id,
            embedUrl: `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`,
          });
        }
      }
    }
  }
  const courseLevelResources = [
    ...(manifest.courseSections || []),
    ...(manifest.courseDownloads || []),
  ];
  const seenCoursePaths = new Set();
  for (const resource of courseLevelResources) {
    if (!resource?.path || resource.type !== "html" || seenCoursePaths.has(resource.path)) continue;
    seenCoursePaths.add(resource.path);
    const htmlPath = join(courseRoot, resource.path);
    if (!existsSync(htmlPath)) continue;
    const html = readFileSync(htmlPath, "utf8");
    for (const id of h5pIds(html)) {
      rows.push({
        course,
        courseLevel: true,
        label: resource.label || resource.title || `Course H5P ${id}`,
        resourcePath: resource.path,
        id,
        embedUrl: `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`,
      });
    }
  }
  for (const unitRow of manifest.units || []) {
    const unit = Number(unitRow.unit || 0);
    if (!unit) continue;
    for (const lessonRow of unitRow.lessons || []) {
      const lesson = Number(lessonRow.lesson || extractLessonNo(lessonRow.title || lessonRow.label || lessonRow.id));
      const lessonDir = join(courseRoot, lessonRow.sourceDir || lessonRow.path || "");
      const resourceIndexPath = join(lessonDir, "resource_index.json");
      if (existsSync(resourceIndexPath)) {
        try {
          const resourceRows = readJson(resourceIndexPath);
          for (const resourceRow of resourceRows || []) {
            const section = String(resourceRow.section || "").toLowerCase();
            if (section !== "handson" && section !== "hands_on" && section !== "hands on") continue;
            for (const id of h5pIds(resourceRow.src || resourceRow.href || "")) {
              rows.push({
                course,
                unit,
                lesson,
                lessonId: lessonRow.id || `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
                section: "Hands On",
                id,
                embedUrl: `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`,
              });
            }
          }
        } catch {
          // Keep processing other lesson sources; malformed indexes are reported by separate audits.
        }
      }
      for (const sectionRow of lessonRow.bookSections || []) {
        if (!sectionRow?.path || sectionRow.type !== "html") continue;
        const htmlPath = join(courseRoot, sectionRow.path);
        if (!existsSync(htmlPath)) continue;
        const html = readFileSync(htmlPath, "utf8");
        for (const id of h5pIds(html)) {
          rows.push({
            course,
            unit,
            lesson,
            lessonId: lessonRow.id || `U${String(unit).padStart(2, "0")}L${String(lesson).padStart(2, "0")}`,
            section: sectionRow.sectionLabel || sectionRow.label || "",
            id,
            embedUrl: `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`,
          });
        }
      }
    }
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.id}|${row.courseLevel ? row.resourcePath : `${row.lessonId}|${row.section}`}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findBookSection(lesson, sectionLabelValue) {
  const exact = (lesson.bookSections || []).find((section) => section.sectionLabel === sectionLabelValue);
  if (exact) return exact;
  return (lesson.bookSections || []).find((section) => {
    if (!section?.path || section.type !== "html") return false;
    const html = readFileSync(join(courseRoot, section.path), "utf8");
    return html.includes("Interactive media pending local package");
  });
}

function injectH5pStyles(html) {
  const css =
    "    .embedded-h5p { display: block; margin: 16px 0 24px; max-width: 100%; width: 100%; }\n" +
    "    .embedded-h5p iframe { border: 0; display: block; min-height: 640px; width: 100%; }\n";
  if (/\.embedded-h5p\s*\{/.test(html) && /\.embedded-h5p\s+iframe\s*\{/.test(html)) {
    return html.replace(
      /\s*\.embedded-h5p\s*\{[^}]+\}\s*\.embedded-h5p\s+iframe\s*\{[^}]+\}\s*/m,
      `\n${css}`,
    );
  }
  if (/<\/style>/i.test(html)) {
    return html.replace(/\s*<\/style>/i, `\n${css}  </style>`);
  }
  return html.replace(/\s*<\/head>/i, `\n  <style>\n${css}  </style>\n</head>`);
}

function injectH5pResizeScript(html) {
  if (html.includes("ossd:h5p-height")) {
    return html.replace(/Math\.max\(Number\(event\.data\.height\) \|\| 0, \d+\)/g, "Math.max(Number(event.data.height) || 0, 640)");
  }
  return html.replace(
    /\s*<\/body>/i,
    `\n  <script>\n    window.addEventListener("message", function (event) {\n      if (!event.data || event.data.type !== "ossd:h5p-height") return;\n      document.querySelectorAll(".embedded-h5p iframe").forEach(function (iframe) {\n        if (event.source === iframe.contentWindow) {\n          iframe.style.height = Math.max(Number(event.data.height) || 0, 640) + "px";\n        }\n      });\n    });\n  </script>\n</body>`,
  );
}

function patchPage(section, record) {
  const pagePath = join(courseRoot, section.path);
  let html = readFileSync(pagePath, "utf8");
  if (html.includes(record.previewPath)) {
    const styled = injectH5pResizeScript(injectH5pStyles(html));
    if (styled === html) return false;
    writeFileSync(pagePath, styled, "utf8");
    section.bytes = Buffer.byteLength(styled, "utf8");
    return true;
  }
  const iframe = `<div class="embedded-h5p embedded-h5p-frame"><iframe src="${htmlHref(section.path, record.previewPath)}?embed=1" title="${escapeHtml(record.label)}" loading="lazy" allowfullscreen="allowfullscreen"></iframe></div>`;
  const before = html;
  html = injectH5pResizeScript(injectH5pStyles(html));
  const externalId = String(record.originalSource || record.source || "").match(/(?:id=|h5p-embed\/)(\d+)/i)?.[1] || "";
  let replacedExternal = false;
  if (externalId) {
    const embeddedFramePattern = new RegExp(
      String.raw`\s*(?:<p>\s*)?<div\b[^>]*class=["'][^"']*\bembedded-h5p-frame\b[^"']*["'][^>]*>\s*<iframe\b[^>]*welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed(?:&amp;|&)id=${externalId}[^>]*>\s*<\/iframe>\s*<\/div>(?:\s*<\/p>)?`,
      "gi",
    );
    html = html.replace(embeddedFramePattern, () => {
      replacedExternal = true;
      return `\n${iframe}\n`;
    });
    const bareFramePattern = new RegExp(
      String.raw`\s*(?:<p>\s*)?<iframe\b[^>]*welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed(?:&amp;|&)id=${externalId}[^>]*>\s*<\/iframe>(?:\s*<\/p>)?`,
      "gi",
    );
    html = html.replace(bareFramePattern, () => {
      replacedExternal = true;
      return `\n${iframe}\n`;
    });
  }
  if (!replacedExternal && /<div class="portal-note"[^>]*>Interactive media pending local package; external playback was not embedded\.<\/div>/.test(html)) {
    html = html.replace(/<div class="portal-note"[^>]*>Interactive media pending local package; external playback was not embedded\.<\/div>/, iframe);
  } else if (!replacedExternal && /Student submission activity omitted from the teacher resource view\./.test(html)) {
    html = html.replace(
      /(?:<p>\s*)?<div\b[^>]*class=["'][^"']*\blocalized-resource-note\b[^"']*["'][^>]*>\s*Student submission activity omitted from the teacher resource view\.\s*<\/div>(?:\s*<\/p>)?/i,
      iframe,
    );
  } else if (!replacedExternal && record.role === "hands_on" && /downloaded_resources\/hands_on\/h5p\//i.test(html)) {
    html = html.replace(
      /<div\b[^>]*class=["'][^"']*\bembedded-h5p\b[^"']*["'][^>]*>\s*<iframe\b[^>]*downloaded_resources\/hands_on\/h5p\/[^>]*>\s*<\/iframe>\s*<\/div>(?:\s*<div\b[^>]*class=["'][^"']*\bembedded-resource-card\b[^"']*["'][\s\S]*?<\/div>)?/i,
      iframe,
    );
  } else if (!replacedExternal) {
    html = html.replace(/\s*<\/article>/i, `\n${iframe}\n</article>`);
  }
  if (html === before) return false;
  writeFileSync(pagePath, html, "utf8");
  section.bytes = Buffer.byteLength(html, "utf8");
  section.textPreview = String(section.textPreview || "").replace(/\s*Interactive media pending local package; external playback was not embedded\./g, "");
  return true;
}

function attachRecord(lesson, section, row, record) {
  if (row.courseLevel) {
    section.attachments ||= [];
    const index = section.attachments.findIndex((item) => item.source === row.embedUrl && item.role === record.role);
    if (index >= 0) section.attachments[index] = { ...section.attachments[index], ...record };
    else section.attachments.push(record);
    return;
  }

  if (row.section === "Hands On") {
    const auditRecord = {
      label: record.label.replace(/^External H5P\s*-\s*/i, "Hands On - "),
      type: "h5p",
      category: "localized_external_h5p",
      role: "handsOn",
      mode: "local_embed",
      source: record.source,
      originalSource: row.embedUrl,
      parentSection: "Hands On",
      sourceGroup: "book_section_embed",
      unit: row.unit,
      lesson: row.lesson,
      textPreview: section.label || section.sectionLabel || `Hands On - Unit ${row.unit} Lesson ${row.lesson}`,
      path: record.path,
      bytes: record.bytes,
      previewPath: record.previewPath,
      localizedPackagePath: record.path,
      localizedPreviewPath: record.previewPath,
    };
    lesson.handsOn ||= [];
    lesson.downloads = (lesson.downloads || []).filter((item) => {
      const text = `${item.role || ""} ${item.category || ""} ${item.path || ""} ${item.previewPath || ""} ${item.source || ""}`;
      const isHandsOnH5p = (item.type === "h5p" || /\.h5p$/i.test(item.path || "")) && /hands[\s_-]*on/i.test(text);
      return !isHandsOnH5p;
    });
    const index = lesson.handsOn.findIndex((item) => item.originalSource === row.embedUrl || item.url === stableH5pSource(row.id));
    if (index >= 0) {
      lesson.handsOn[index] = { ...lesson.handsOn[index], ...auditRecord };
      delete lesson.handsOn[index].url;
      delete lesson.handsOn[index].previewUrl;
      delete lesson.handsOn[index].downloadUrl;
    } else {
      lesson.handsOn.push(auditRecord);
    }
    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = lesson.downloads.length;
    lesson.resourceCounts.handsOn = lesson.handsOn.length;
    lesson.resourceCounts.h5p = [
      ...(lesson.downloads || []),
      ...(lesson.handsOn || []),
    ].filter((item) => item.type === "h5p" || item.localizedPackagePath).length;
    return;
  }

  lesson.downloads ||= [];
  const index = lesson.downloads.findIndex((item) => item.source === row.embedUrl && item.role === record.role);
  if (index >= 0) lesson.downloads[index] = { ...lesson.downloads[index], ...record };
  else lesson.downloads.push(record);
  lesson.resourceCounts ||= {};
  lesson.resourceCounts.downloads = lesson.downloads.length;
  lesson.resourceCounts.h5p = lesson.downloads.filter((item) => item.type === "h5p").length;
}

function existingLocalizedRecord(row, lesson, section) {
  const idPrefix = `${String(row.id).padStart(4, "0")}-`;
  const candidates = [
    ...((lesson && lesson.handsOn) || []),
    ...((lesson && lesson.downloads) || []),
    ...((section && section.attachments) || []),
  ];
  for (const item of candidates) {
    const path = toPosix(item.path || item.localizedPackagePath || "");
    const previewPath = toPosix(item.previewPath || item.localizedPreviewPath || path.replace(/\.h5p$/i, "/index.html"));
    if (!path || !previewPath) continue;
    const matchesSource = item.originalSource === row.embedUrl || item.source === stableH5pSource(row.id);
    const matchesId = path.includes(`/h5p-external/${idPrefix}`);
    if (!matchesSource && !matchesId) continue;
    const packagePath = join(courseRoot, path);
    const previewFullPath = join(courseRoot, previewPath);
    if (!existsSync(packagePath) || !existsSync(previewFullPath)) continue;
    return {
      label: item.label || `External H5P - H5P ${row.id}`,
      type: "h5p",
      category: "localized_external_h5p",
      role: row.courseLevel ? "course_resource" : row.section === "Consolidation" ? "consolidation" : "hands_on",
      path,
      bytes: statSync(packagePath).size,
      source: stableH5pSource(row.id),
      originalSource: row.embedUrl,
      previewPath,
    };
  }
  return null;
}

const manifest = readJson(manifestPath);
const rows = collectRows(manifest);
const downloaded = [];
const failures = [];
const localizedById = new Map();
let pagesPatched = 0;
mkdirSync(outDir, { recursive: true });

for (const row of rows) {
  let lesson = null;
  let section = null;
  if (row.courseLevel) {
    section = [
      ...(manifest.courseSections || []),
      ...(manifest.courseDownloads || []),
    ].find((item) => item?.path === row.resourcePath);
    if (!section) {
      failures.push({ ...row, error: "manifest course resource not found" });
      continue;
    }
  } else {
    const unit = (manifest.units || []).find((item) => item.unit === row.unit);
    lesson = unit?.lessons?.find((item) => item.id === row.lessonId);
    if (!lesson) {
      failures.push({ ...row, error: "manifest lesson not found" });
      continue;
    }
    section = findBookSection(lesson, row.section);
    if (!section) {
      failures.push({ ...row, error: "manifest book section not found" });
      continue;
    }
  }
  try {
    const embed = await fetchBytes(row.embedUrl);
    const embedHtml = embed.buffer.toString("utf8");
    const exportUrl = extractJsonString(embedHtml, "exportUrl");
    if (!exportUrl) throw new Error("missing exportUrl");
    const embedTitle = cleanTitle(titleFromEmbed(embedHtml, row.id)) || `H5P ${row.id}`;
    const absoluteExportUrl = new URL(exportUrl, "https://welcome.hexstruct.com").toString();
    const h5p = await fetchBytes(absoluteExportUrl);
    validateH5p(h5p.buffer);
    const title = await titleFromH5pPackage(h5p.buffer, embedTitle);
    const name = `${String(row.id).padStart(4, "0")}-${slugify(title)}.h5p`;
    const targetPath = join(outDir, name);
    if (!existsSync(targetPath)) writeFileSync(targetPath, h5p.buffer);
    const relPath = toPosix(relative(courseRoot, targetPath));
    const record = {
      label: `External H5P - ${title}`,
      type: "h5p",
      category: "localized_external_h5p",
      role: row.courseLevel ? "course_resource" : row.section === "Consolidation" ? "consolidation" : "hands_on",
      path: relPath,
      bytes: statSync(targetPath).size,
      source: stableH5pSource(row.id),
      originalSource: row.embedUrl,
      previewPath: relPath.replace(/\.h5p$/i, "/index.html"),
    };
    localizedById.set(row.id, { title, exportUrl: absoluteExportUrl, record });
    attachRecord(lesson, section, row, record);
    if (patchPage(section, record)) pagesPatched += 1;
    downloaded.push({ ...row, title, path: relPath, bytes: record.bytes, exportUrl: absoluteExportUrl, pagePath: section.path, previewPath: record.previewPath });
  } catch (error) {
    const cached = localizedById.get(row.id);
    if (cached) {
      const record = {
        ...cached.record,
        source: stableH5pSource(row.id),
        originalSource: row.embedUrl,
        role: row.courseLevel ? "course_resource" : row.section === "Consolidation" ? "consolidation" : "hands_on",
      };
      attachRecord(lesson, section, row, record);
      if (patchPage(section, record)) pagesPatched += 1;
      downloaded.push({ ...row, title: cached.title, path: record.path, bytes: record.bytes, exportUrl: cached.exportUrl, pagePath: section.path, previewPath: record.previewPath, reused: true });
    } else {
      const existing = existingLocalizedRecord(row, lesson, section);
      if (existing) {
        attachRecord(lesson, section, row, existing);
        if (patchPage(section, existing)) pagesPatched += 1;
        downloaded.push({ ...row, title: existing.label, path: existing.path, bytes: existing.bytes, pagePath: section.path, previewPath: existing.previewPath, reusedLocalPackage: true });
      } else {
        failures.push({ ...row, error: String(error?.message || error) });
      }
    }
  }
}

for (const unit of manifest.units || []) {
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  unit.summary.h5p = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length, 0);
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.externalH5pEmbeds = rows.length;
manifest.sourceAudit.externalH5pLocalized = downloaded.length;
manifest.sourceAudit.externalH5pFailed = failures.length;
manifest.sourceAudit.h5pExternalEmbedsPending = failures.length;
manifest.sourceAudit.h5pExternalLocalizedAt = new Date().toISOString();
manifest.sourceAudit.note = failures.length
  ? "Some external WordPress H5P embeds could not be localized; failed embeds remain excluded from playback rather than using external links. iSpring embeds are represented by local mirrored packages only."
  : "Localized iSpring embeds and external WordPress H5P embeds are represented by local courseware resources only; no external playback links are used.";
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
writeJson(reportPath, {
  generatedAt: new Date().toISOString(),
  course,
  rows: rows.length,
  downloaded,
  failures,
  pagesPatched,
});

console.log(JSON.stringify({ course, rows: rows.length, downloaded: downloaded.length, failures: failures.length, pagesPatched, reportPath: toPosix(relative(projectRoot, reportPath)) }, null, 2));
if (failures.length) process.exitCode = 1;
