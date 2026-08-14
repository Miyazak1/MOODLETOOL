import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const DEFAULT_COURSEWARE_ROOT = resolve(WORKSPACE_ROOT, "courseware");

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function readListArg(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) {
      values.push(...process.argv[i + 1].split(",").map((value) => value.trim()).filter(Boolean));
      i += 1;
    }
  }
  return values;
}

const apply = process.argv.includes("--apply");
const allCourses = process.argv.includes("--all");
const force = process.argv.includes("--force");
const requestedCourses = readListArg("--course").map((course) => course.toUpperCase());
const coursewareRoot = resolve(readArg("--courseware-root") || DEFAULT_COURSEWARE_ROOT);
const inboxRoot = resolve(readArg("--inbox-root") || join(REPO_ROOT, "inbox"));
const reportPath = readArg("--report");

if (!allCourses && !requestedCourses.length) {
  console.error("Usage: node scripts/repair-course-book-section-embeds.mjs --course MCR3U[,MDM4U] [--apply]");
  console.error("       node scripts/repair-course-book-section-embeds.mjs --all [--apply]");
  process.exit(1);
}

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
  return item.type === "h5p" && item.previewPath ? `${relativeHref(pageRel, item.previewPath)}?embed=1` : relativeHref(pageRel, item.downloadPath || item.path);
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
    if (!/(h5p_embed|hexstruct\.ispring\.com|ispring-localized|\/h5p\/|localized-moodle\/h5p|welcome\.hexstruct)/i.test(attrs)) return match;
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

function buildSectionBody(lesson, section, rawSection, pageRel) {
  let body = rawSectionBody(rawSection.page.html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  body = localizeKnownUrls(body, lesson, { ...section, path: pageRel });
  return normalizeEmbeddedMedia(body, section);
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
    .content img, .content video { display: block; height: auto; margin-left: auto; margin-right: auto; max-width: 100%; }
    .content .mediaplugin, .content .mediaplugin > div { margin-left: auto; margin-right: auto; }
    .localized-ispring, .embedded-h5p-frame, .embedded-video { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
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

function renderLessonPage(course, unit, lesson, sections) {
  const sectionHtml = sections.map((section) => `    <section class="moodle-section">
      <header><p>${escapeHtml(section.label)}</p><h2>${escapeHtml(section.heading)}</h2></header>
      <div class="moodle-content">${section.body || "<p>No page text was available from Moodle.</p>"}</div>
    </section>`).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(course)} Unit ${escapeHtml(unit.unit)} Lesson ${escapeHtml(lesson.lesson)} - ${escapeHtml(lesson.title || lesson.label || "")}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #102033; background: #f6f8fb; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    .page-title { border-bottom: 1px solid #d9e2ef; margin-bottom: 20px; padding-bottom: 16px; }
    .page-title p { color: #586b85; margin: 0 0 6px; }
    h1 { font-size: 28px; margin: 0; }
    .moodle-section { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; margin: 16px 0; padding: 20px; }
    .moodle-section header { border-bottom: 1px solid #edf1f6; margin-bottom: 16px; padding-bottom: 12px; }
    .moodle-section header p { color: #6b7c93; font-weight: 700; margin: 0 0 4px; text-transform: uppercase; }
    .moodle-section header h2 { font-size: 20px; margin: 0; }
    .moodle-content h3 { font-size: 18px; margin-top: 18px; }
    .moodle-content table { border-collapse: collapse; max-width: 100%; }
    .moodle-content td, .moodle-content th { border: 1px solid #d9e2ef; padding: 6px 8px; }
    .moodle-content img, .moodle-content video { display: block; height: auto; margin-left: auto; margin-right: auto; max-width: 100%; }
    .moodle-content .mediaplugin, .moodle-content .mediaplugin > div { margin-left: auto; margin-right: auto; }
    .localized-ispring, .embedded-h5p-frame, .embedded-video { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
    .localized-ispring iframe, .embedded-h5p-frame iframe { border: 0; display: block; min-height: 640px; width: 100%; }
    .localized-ispring iframe { height: min(72vh, 760px); }
    .embedded-video video { background: #000; width: 100%; }
    .localized-resource-note { border: 1px solid #b7cbe5; border-radius: 6px; background: #f2f7fc; color: #264461; margin: 12px 0; padding: 10px 12px; }
    a:not([href]) { color: inherit; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <div class="page-title"><p>${escapeHtml(course)} · Unit ${escapeHtml(unit.unit)} · Lesson ${escapeHtml(lesson.lesson)}</p><h1>${escapeHtml(lesson.title || lesson.label || `Lesson ${lesson.lesson}`)}</h1></div>
${sectionHtml}
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

function sectionRole(section) {
  const text = `${section.sectionLabel || ""} ${section.label || ""} ${section.path || ""}`.toLowerCase();
  if (/hands[\s_-]*on/.test(text)) return "hands_on";
  if (/consolidation/.test(text)) return "consolidation";
  if (/homework/.test(text)) return "homework";
  if (/lesson/.test(text)) return "lesson";
  return "";
}

function itemRole(item) {
  const text = `${item.role || ""} ${item.category || ""} ${item.path || ""} ${item.previewPath || ""}`.toLowerCase();
  if (/hands[\s_-]*on/.test(text)) return "hands_on";
  if (/consolidation/.test(text)) return "consolidation";
  if (/homework/.test(text)) return "homework";
  if (/lesson/.test(text)) return "lesson";
  return "";
}

function h5pItemsForSection(lesson, section) {
  const role = sectionRole(section);
  if (!role) return [];
  return (lesson.downloads || [])
    .filter((item) => item.previewPath && (item.type === "h5p" || /\.h5p$/i.test(item.path || "")))
    .filter((item) => itemRole(item) === role);
}

function h5pEmbedHtml(item, pageRel) {
  const src = `${relativeHref(pageRel, item.previewPath)}?embed=1`;
  const title = item.label || item.path || "H5P activity";
  return `<div class="embedded-h5p embedded-h5p-frame"><iframe src="${escapeHtml(src, true)}" loading="lazy" allowfullscreen="allowfullscreen" title="${escapeHtml(title, true)}"></iframe></div>`;
}

function replaceStudentSubmissionPlaceholders(html, lesson, section) {
  const items = h5pItemsForSection(lesson, section);
  if (!items.length || !/Student submission activity omitted/.test(html)) {
    return { html, replaced: 0, h5pIframes: 0 };
  }

  const replacement = items.map((item) => h5pEmbedHtml(item, section.path)).join("");
  let inserted = false;
  let replaced = 0;
  const nextHtml = String(html).replace(
    /<div\b[^>]*class=["'][^"']*\bh5p-placeholder\b[^"']*["'][^>]*>\s*<div\b[^>]*class=["'][^"']*\blocalized-resource-note\b[^"']*["'][^>]*>\s*Student submission activity omitted from the teacher resource view\.\s*<\/div>\s*<\/div>|<div\b[^>]*class=["'][^"']*\blocalized-resource-note\b[^"']*["'][^>]*>\s*Student submission activity omitted from the teacher resource view\.\s*<\/div>/gi,
    (match) => {
      replaced += 1;
      if (inserted) return "";
      inserted = true;
      return replacement || match;
    },
  );

  return { html: nextHtml, replaced, h5pIframes: inserted ? items.length : 0 };
}

function countTag(html, tagName, pattern = null) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const matches = String(html || "").match(tagPattern) || [];
  if (!pattern) return matches.length;
  return matches.filter((tag) => pattern.test(tag)).length;
}

function countPlaceholders(courseRoot) {
  const counts = {
    htmlFiles: 0,
    iframe: 0,
    videoTag: 0,
    omitted: 0,
    videoMissing: 0,
    embedNote: 0,
  };
  const stack = [courseRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (/\.html?$/i.test(entry.name)) {
        counts.htmlFiles += 1;
        const html = readFileSync(path, "utf8");
        counts.iframe += (html.match(/<iframe\b/gi) || []).length;
        counts.videoTag += (html.match(/<video\b/gi) || []).length;
        counts.omitted += (html.match(/Student submission activity omitted/g) || []).length;
        counts.videoMissing += (html.match(/Video source file was listed/g) || []).length;
        counts.embedNote += (html.match(/Embedded activity is listed as a local lesson resource/g) || []).length;
      }
    }
  }
  return counts;
}

function availableCourses() {
  return readdirSync(coursewareRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((course) => existsSync(join(coursewareRoot, course, "course-manifest.json")))
    .sort();
}

function aggregateIds(unit, lesson) {
  const unitNo = String(unit.unit).padStart(2, "0");
  const lessonNo = String(lesson.lesson).padStart(2, "0");
  return Array.from(new Set([
    lesson.id,
    String(lesson.id || "").replace(/^U(\d+)L(\d+)$/i, (_, u, l) => `U${String(u).padStart(2, "0")}L${String(l).padStart(2, "0")}`),
    `U${unitNo}L${lessonNo}`,
  ].filter(Boolean)));
}

function findAggregatePath(courseRoot, unit, lesson) {
  const unitDir = join(courseRoot, "moodle-html", `unit-${String(unit.unit).padStart(2, "0")}`);
  for (const id of aggregateIds(unit, lesson)) {
    const path = join(unitDir, `${id}.html`);
    if (existsSync(path)) return { path, rel: toPosix(posix.join("moodle-html", `unit-${String(unit.unit).padStart(2, "0")}`, `${id}.html`)), id };
  }
  return null;
}

function courseHasRaw(course) {
  if (!existsSync(inboxRoot)) return false;
  return readdirSync(inboxRoot).some((entry) => new RegExp(`^moodle-book-raw-${course}-U\\d+\\.json$`, "i").test(entry));
}

function repairCourse(course) {
  const courseRoot = join(coursewareRoot, course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  const report = {
    course,
    apply,
    force,
    skipped: false,
    reason: "",
    scanned: 0,
    wouldRewrite: 0,
    rewritten: 0,
    h5pIframes: 0,
    ispringIframes: 0,
    videos: 0,
    wouldRewriteAggregates: 0,
    rewrittenAggregates: 0,
    wouldRewriteAggregateSections: 0,
    rewrittenAggregateSections: 0,
    fallbackH5pPlaceholders: 0,
    fallbackH5pIframes: 0,
    before: countPlaceholders(courseRoot),
    missingPages: [],
    missingRawSections: [],
  };

  if (!existsSync(manifestPath)) {
    report.skipped = true;
    report.reason = "missing manifest";
    return report;
  }
  const hasRaw = courseHasRaw(course);
  if (!hasRaw && report.before.omitted === 0) {
    report.skipped = true;
    report.reason = "missing moodle book raw files";
    return report;
  }
  if (!force && report.before.omitted + report.before.videoMissing + report.before.embedNote === 0) {
    report.skipped = true;
    report.reason = "no placeholder notes; use --force to rebuild clean book sections";
    return report;
  }

  const manifest = readJson(manifestPath);
  let changedManifest = false;

  for (const unit of manifest.units || []) {
    const rawPath = join(inboxRoot, `moodle-book-raw-${course}-U${String(unit.unit).padStart(2, "0")}.json`);
    const raw = existsSync(rawPath) ? readJson(rawPath) : null;

    for (const lesson of unit.lessons || []) {
      const rawLesson = (raw?.lessons || []).find((item) => Number(item.lesson) === Number(lesson.lesson));
      const aggregateSections = [];
      const aggregate = findAggregatePath(courseRoot, unit, lesson);

      for (const section of lesson.bookSections || []) {
        report.scanned += 1;
        const pagePath = join(courseRoot, section.path);
        if (!existsSync(pagePath)) {
          report.missingPages.push(section.path);
          continue;
        }

        if (!rawLesson) {
          const existing = readFileSync(pagePath, "utf8");
          const fallback = replaceStudentSubmissionPlaceholders(existing, lesson, section);
          if (fallback.replaced) {
            report.wouldRewrite += 1;
            report.h5pIframes += fallback.h5pIframes;
            report.fallbackH5pPlaceholders += fallback.replaced;
            report.fallbackH5pIframes += fallback.h5pIframes;
            if (apply) {
              writeFileSync(pagePath, fallback.html, "utf8");
              section.bytes = statSync(pagePath).size;
              report.rewritten += 1;
              changedManifest = true;
            }
          }
          continue;
        }

        const rawSection = (rawLesson.sections || []).find((item) => Number(item.sectionIndex) === Number(section.sectionIndex));
        if (!rawSection?.page?.html) {
          report.missingRawSections.push(section.path);
          continue;
        }

        const body = buildSectionBody(lesson, section, rawSection, section.path);

        const title = `${course} Unit ${unit.unit} Lesson ${lesson.lesson} - ${section.sectionLabel || rawSection.normalizedLabel || rawSection.label}`;
        const html = renderPage(title, body);
        const h5pIframes = countTag(html, "iframe", /(?:h5p_embed|localized-moodle\/h5p|welcome\.hexstruct)/i);
        const ispringIframes = countTag(html, "iframe", /ispring-localized/i);
        const videos = countTag(html, "video");

        report.wouldRewrite += 1;
        report.h5pIframes += h5pIframes;
        report.ispringIframes += ispringIframes;
        report.videos += videos;
        if (aggregate) {
          const aggregateBody = buildSectionBody(lesson, section, rawSection, aggregate.rel);
          aggregateSections.push({
            label: section.sectionLabel || rawSection.normalizedLabel || rawSection.label || "Section",
            heading: rawSection.normalizedLabel || section.sectionLabel || rawSection.label || "Section",
            body: aggregateBody,
          });

          const sectionRel = toPosix(posix.join(posix.dirname(aggregate.rel), aggregate.id, `section-${String(section.sectionIndex).padStart(2, "0")}.html`));
          const aggregateSectionPath = join(courseRoot, sectionRel);
          if (existsSync(aggregateSectionPath)) {
            report.wouldRewriteAggregateSections += 1;
            if (apply) {
              const sectionBody = buildSectionBody(lesson, section, rawSection, sectionRel);
              writeFileSync(aggregateSectionPath, renderPage(title, sectionBody), "utf8");
              report.rewrittenAggregateSections += 1;
            }
          }
        }

        if (apply) {
          writeFileSync(pagePath, html, "utf8");
          section.bytes = statSync(pagePath).size;
          section.textPreview = stripTags(body).slice(0, 500);
          report.rewritten += 1;
          changedManifest = true;
        }
      }

      if (aggregateSections.length && aggregate) {
        report.wouldRewriteAggregates += 1;
        if (apply) {
          writeFileSync(aggregate.path, renderLessonPage(course, unit, lesson, aggregateSections), "utf8");
          report.rewrittenAggregates += 1;
        }
      }
    }
  }

  if (!hasRaw && report.wouldRewrite === 0) {
    report.skipped = true;
    report.reason = "missing moodle book raw files and no matching H5P placeholders";
  }

  if (apply && changedManifest) {
    manifest.sourceAudit = {
      ...(manifest.sourceAudit || {}),
      bookSectionEmbedRepair: {
        repairedAt: new Date().toISOString(),
        course,
        scanned: report.scanned,
        rewritten: report.rewritten,
        h5pIframes: report.h5pIframes,
        ispringIframes: report.ispringIframes,
        videos: report.videos,
      },
    };
    manifest.generatedAt = new Date().toISOString();
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  report.after = apply ? countPlaceholders(courseRoot) : null;
  return report;
}

const courses = allCourses ? availableCourses() : requestedCourses;
const reports = courses.map(repairCourse);
const activeReports = reports.filter((report) => !report.skipped);
const summary = {
  ok: true,
  apply,
  coursewareRoot,
  inboxRoot,
  scannedCourses: reports.length,
  repairedCourses: activeReports.length,
  courses: reports.map((report) => ({
    course: report.course,
    skipped: report.skipped,
    reason: report.reason || undefined,
    scanned: report.scanned,
    wouldRewrite: report.wouldRewrite,
    rewritten: report.rewritten,
    wouldRewriteAggregates: report.wouldRewriteAggregates,
    rewrittenAggregates: report.rewrittenAggregates,
    wouldRewriteAggregateSections: report.wouldRewriteAggregateSections,
    rewrittenAggregateSections: report.rewrittenAggregateSections,
    h5pIframes: report.h5pIframes,
    ispringIframes: report.ispringIframes,
    videos: report.videos,
    fallbackH5pPlaceholders: report.fallbackH5pPlaceholders,
    fallbackH5pIframes: report.fallbackH5pIframes,
    before: report.before,
    after: report.after,
    missingPages: report.missingPages.length,
    missingRawSections: report.missingRawSections.length,
  })),
};

if (reportPath) {
  writeFileSync(resolve(reportPath), `${JSON.stringify({ summary, reports }, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(summary, null, 2));
