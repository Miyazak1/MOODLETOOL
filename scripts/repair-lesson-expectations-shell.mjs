import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");

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

function resolveCourseRoot(course) {
  const candidates = [
    resolve(workspaceRoot, "courseware", course),
    resolve(projectRoot, "courseware", course),
  ];
  for (const root of candidates) {
    if (existsSync(join(root, "course-manifest.json"))) return root;
  }
  throw new Error(`Cannot find courseware for ${course}`);
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isExpectationSection(section) {
  const value = `${section.sectionLabel || ""} ${section.label || ""} ${section.path || ""}`.toLowerCase();
  return value.includes("expectation") || value.includes("01-lesson-expectations");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractArticleContent(html) {
  const articleMatch = /<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (articleMatch) return articleMatch[1].trim();

  const moodleMatch = /<div\b[^>]*class=["'][^"']*\bmoodle-content\b[^"']*["'][^>]*>/i.exec(html);
  if (moodleMatch) {
    const openEnd = divTagEnd(html, moodleMatch.index);
    const close = findMatchingDivClose(html, moodleMatch.index);
    if (openEnd >= 0 && close) return html.slice(openEnd, close.start).trim();
  }

  return "";
}

function divTagEnd(html, start) {
  const end = html.indexOf(">", start);
  return end >= 0 ? end + 1 : -1;
}

function findMatchingDivClose(html, openStart) {
  const divPattern = /<\/?div\b[^>]*>/gi;
  divPattern.lastIndex = openStart;
  let depth = 0;
  for (let match = divPattern.exec(html); match; match = divPattern.exec(html)) {
    const tag = match[0];
    if (/^<div\b/i.test(tag) && !/\/>$/.test(tag)) {
      depth += 1;
      continue;
    }
    if (/^<\/div/i.test(tag)) {
      depth -= 1;
      if (depth === 0) return { start: match.index, end: match.index + tag.length };
    }
  }
  return null;
}

function unwrapLegacyBookContent(html) {
  const wrapperPattern = /<div\b[^>]*class=["'][^"']*\b(?:generalbox|book_content)\b[^"']*["'][^>]*>/i;
  const match = wrapperPattern.exec(html);
  if (!match) return { html, changed: false };

  const openStart = match.index;
  const openEnd = divTagEnd(html, openStart);
  const close = findMatchingDivClose(html, openStart);
  if (openEnd < 0 || !close) return { html, changed: false };

  return {
    html: html.slice(0, openStart) + html.slice(openEnd, close.start) + html.slice(close.end),
    changed: true,
  };
}

function unwrapAllLegacyBookContent(html) {
  let current = html;
  let changed = false;
  for (let index = 0; index < 20; index += 1) {
    const result = unwrapLegacyBookContent(current);
    if (!result.changed) break;
    current = result.html;
    changed = true;
  }
  return { html: current, changed };
}

function hasEng3uPageShell(html) {
  return /data-course-shell=["']eng3u-course-shell-v2["']/i.test(html)
    && /class=["']page-title["']/i.test(html)
    && /class=["']moodle-section["']/i.test(html)
    && /class=["']moodle-content["']/i.test(html);
}

function hasLegacyShellOrWrapper(html) {
  return /class=["'][^"']*\b(?:generalbox|book_content)\b[^"']*["']/i.test(html)
    || /<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["']/i.test(html)
    || /<style\b[\s\S]*?\b\.content\b[\s\S]*?<\/style>/i.test(html);
}

function h5pHeightScript() {
  return `  <script>
    window.addEventListener("message", function (event) {
      if (!event.data || event.data.type !== "ossd:h5p-height") return;
      document.querySelectorAll(".embedded-h5p iframe, .embedded-h5p-frame iframe").forEach(function (iframe) {
        if (event.source === iframe.contentWindow) {
          iframe.style.height = Math.max(Number(event.data.height) || 0, 640) + "px";
        }
      });
    });
  </script>`;
}

function sectionNumber(section, fallback) {
  const pathValue = String(section.path || "");
  const match = /book_sections[\\/](\d+)/i.exec(pathValue);
  return match ? String(Number(match[1])) : String(fallback);
}

function buildEng3uShell({ course, courseRoot, pagePath, unit, lesson, section, sectionIndex, content }) {
  const cssHref = toPosix(relative(dirname(pagePath), join(courseRoot, "_assets", "course-page-shell.css")));
  const sectionLabel = section.sectionLabel || "Lesson Expectations";
  const lessonTitle = lesson.title || section.title || section.label || `Lesson ${lesson.lesson}`;
  const sectionNo = sectionNumber(section, sectionIndex + 1);
  const title = `${course} Unit ${unit.unit} Lesson ${lesson.lesson} Section ${sectionNo} - ${lessonTitle} - ${sectionLabel}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="${cssHref}" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>${escapeHtml(course)} · Unit ${escapeHtml(unit.unit)} · Lesson ${escapeHtml(lesson.lesson)} · Section ${escapeHtml(sectionNo)}</p><h1>${escapeHtml(lessonTitle)}</h1></div>
    <section class="moodle-section">
      <header><p>${escapeHtml(sectionLabel)}</p><h2>${escapeHtml(sectionLabel)}</h2></header>
      <div class="moodle-content">${content}</div>
    </section>
  </main>
${h5pHeightScript()}
</body>
</html>
`;
}

const course = safeCourse(readArg("--course"));
const allBookSections = process.argv.includes("--all-book-sections");
const dryRun = process.argv.includes("--dry-run");
if (!course) {
  console.error("Usage: node scripts/repair-lesson-expectations-shell.mjs --course SBI3U [--all-book-sections] [--dry-run]");
  process.exit(1);
}

const courseRoot = resolveCourseRoot(course);
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const repaired = [];
const skipped = [];
const backupRoot = join(courseRoot, "_backups", `${new Date().toISOString().replace(/[:.]/g, "-")}-before-lesson-flow-shell-repair`);

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const [sectionIndex, section] of (lesson.bookSections || []).entries()) {
      const included = allBookSections ? Boolean(section.path) : isExpectationSection(section);
      if (!included || !section.path) continue;
      const pagePath = join(courseRoot, section.path);
      if (!existsSync(pagePath)) continue;
      const before = readFileSync(pagePath, "utf8");
      if (hasEng3uPageShell(before) && !hasLegacyShellOrWrapper(before)) continue;
      const extractedContent = extractArticleContent(before) || extractArticleContent(unwrapAllLegacyBookContent(before).html);
      if (!extractedContent) {
        skipped.push({ unit: unit.unit, lesson: lesson.lesson, path: section.path, reason: "could not extract content" });
        continue;
      }
      const unwrapped = unwrapAllLegacyBookContent(extractedContent);
      const content = unwrapped.html.trim();
      const normalized = buildEng3uShell({ course, courseRoot, pagePath, unit, lesson, section, sectionIndex, content });
      if (normalized === before) continue;
      if (/class=["'][^"']*\b(?:generalbox|book_content)\b[^"']*["']/i.test(normalized)) {
        skipped.push({ unit: unit.unit, lesson: lesson.lesson, path: section.path, reason: "legacy wrapper remains after unwrap" });
        continue;
      }
      if (!dryRun) {
        const backupPath = join(backupRoot, section.path);
        mkdirSync(dirname(backupPath), { recursive: true });
        copyFileSync(pagePath, backupPath);
        writeFileSync(pagePath, normalized);
      }
      repaired.push({ unit: unit.unit, lesson: lesson.lesson, path: section.path });
    }
  }
}

console.log(JSON.stringify({ course, dryRun, backupRoot: dryRun ? null : backupRoot, repaired: repaired.length, skipped: skipped.length, skipped, samples: repaired.slice(0, 5) }, null, 2));
if (skipped.length) process.exitCode = 1;
