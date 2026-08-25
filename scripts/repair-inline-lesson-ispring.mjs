import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
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

function isLessonSection(section) {
  const label = String(section?.sectionLabel || section?.label || "").toLowerCase();
  return label.includes("lesson") && !label.includes("expectation");
}

function isLessonIspring(item) {
  const scope = `${item?.label || ""} ${item?.role || ""} ${item?.path || ""} ${item?.packagePath || ""}`.toLowerCase();
  if (!(scope.includes("ispring") || scope.includes("presentation.html") || scope.includes("lesson_ispring"))) return false;
  if (scope.includes("hands") || scope.includes("consolidation") || scope.includes("homework")) return false;
  return true;
}

function hasInlineIspring(html) {
  return /<(?:iframe|object|embed)\b[^>]*(?:src|data|data-src)=["'][^"']*(?:localized-ispring|ispring|presentation\.html|html5-package)[^"']*["'][^>]*>/i.test(html);
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeAttr(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function iframeHtml({ courseRoot, pagePath, item, title }) {
  const src = toPosix(relative(dirname(pagePath), join(courseRoot, item.path || "")));
  return `<div class="localized-ispring"><iframe src="${escapeAttr(src)}" width="1500" height="750" frameborder="0" border="0" scrolling="auto" allowtransparency="true" allowfullscreen="1" loading="lazy" title="${escapeAttr(title)}" style="border: none; background-color: transparent;"></iframe></div>`;
}

function insertAfterLessonHeading(html, embedHtml) {
  const contentStart = html.search(/<div\b[^>]*class=["'][^"']*\bmoodle-content\b[^"']*["'][^>]*>/i);
  const attachmentsStart = html.search(/<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][^>]*>/i);
  const minIndex = contentStart >= 0 ? contentStart : 0;
  const maxIndex = attachmentsStart >= 0 ? attachmentsStart : html.length;
  const headingPattern = /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi;
  let fallbackHeading = null;
  for (const match of html.matchAll(headingPattern)) {
    const index = match.index || 0;
    if (index < minIndex || index > maxIndex) continue;
    const headingText = stripTags(match[0]);
    if (headingText === "LESSON") {
      const end = index + match[0].length;
      return `${html.slice(0, end)}\n${embedHtml}${html.slice(end)}`;
    }
    if (headingText.toLowerCase() === "lesson") fallbackHeading = match;
  }
  if (fallbackHeading) {
    const end = (fallbackHeading.index || 0) + fallbackHeading[0].length;
    return `${html.slice(0, end)}\n${embedHtml}${html.slice(end)}`;
  }
  if (attachmentsStart >= 0) {
    return `${html.slice(0, attachmentsStart)}${embedHtml}\n${html.slice(attachmentsStart)}`;
  }
  const contentClose = /<\/div>\s*<\/section>/i;
  if (contentClose.test(html)) {
    return html.replace(contentClose, `${embedHtml}\n$&`);
  }
  return `${html}\n${embedHtml}\n`;
}

function hasIspringAfterLessonHeading(html, expectedCount) {
  const contentStart = html.search(/<div\b[^>]*class=["'][^"']*\bmoodle-content\b[^"']*["'][^>]*>/i);
  const attachmentsStart = html.search(/<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][^>]*>/i);
  const minIndex = contentStart >= 0 ? contentStart : 0;
  const maxIndex = attachmentsStart >= 0 ? attachmentsStart : html.length;
  const headingPattern = /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi;
  let fallbackHeading = null;
  for (const match of html.matchAll(headingPattern)) {
    const index = match.index || 0;
    if (index < minIndex || index > maxIndex) continue;
    const headingText = stripTags(match[0]);
    if (headingText === "LESSON") {
      const afterHeading = html.slice(index + match[0].length).trimStart();
      const inlineCount = (afterHeading.match(/\blocalized-ispring\b/gi) || []).length;
      return /^<(?:div|iframe)\b[^>]*class=["'][^"']*\blocalized-ispring\b/i.test(afterHeading) && inlineCount === expectedCount;
    }
    if (headingText.toLowerCase() === "lesson") fallbackHeading = match;
  }
  if (fallbackHeading) {
    const afterHeading = html.slice((fallbackHeading.index || 0) + fallbackHeading[0].length).trimStart();
    const inlineCount = (afterHeading.match(/\blocalized-ispring\b/gi) || []).length;
    return /^<(?:div|iframe)\b[^>]*class=["'][^"']*\blocalized-ispring\b/i.test(afterHeading) && inlineCount === expectedCount;
  }
  return false;
}

function removeLocalizedIspringEmbeds(html) {
  return html
    .replace(/<div\b[^>]*class=["'][^"']*\blocalized-ispring\b[^"']*["'][^>]*>\s*<(?:iframe|object|embed)\b[\s\S]*?<\/(?:iframe|object|embed)>\s*<\/div>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*class=["'][^"']*\blocalized-ispring\b[^"']*["'][\s\S]*?<\/(?:iframe|object|embed)>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

const course = safeCourse(readArg("--course"));
const dryRun = hasFlag("--dry-run");

if (!course) {
  console.error("Usage: node scripts/repair-inline-lesson-ispring.mjs --course ENG2D [--dry-run]");
  process.exit(2);
}

const courseRoot = resolveCourseRoot(course);
const manifestPath = join(courseRoot, "course-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const backupRoot = join(courseRoot, "_backups", `${new Date().toISOString().replace(/[:.]/g, "-")}-before-inline-lesson-ispring-repair`);
const repaired = [];
const skipped = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const lessonSection = (lesson.bookSections || []).find(isLessonSection);
    const ispringItems = (lesson.ispring || []).filter((item) => item?.path && isLessonIspring(item));
    if (!lessonSection?.path || !ispringItems.length) continue;

    const pagePath = join(courseRoot, lessonSection.path);
    if (!existsSync(pagePath)) {
      skipped.push({ unit: unit.unit, lesson: lesson.lesson, path: lessonSection.path, reason: "missing lesson page" });
      continue;
    }
    const before = readFileSync(pagePath, "utf8");

    const embeds = ispringItems
      .filter((item) => existsSync(join(courseRoot, item.path)))
      .map((item) => iframeHtml({ courseRoot, pagePath, item, title: item.label || `${course} U${unit.unit}L${lesson.lesson} iSpring` }));
    if (!embeds.length) {
      skipped.push({ unit: unit.unit, lesson: lesson.lesson, path: lessonSection.path, reason: "iSpring path missing on disk" });
      continue;
    }
    if (hasIspringAfterLessonHeading(before, embeds.length)) continue;

    const baseHtml = hasInlineIspring(before) ? removeLocalizedIspringEmbeds(before) : before;
    const after = insertAfterLessonHeading(baseHtml, embeds.join("\n"));
    if (after === before) continue;
    if (!dryRun) {
      const backupPath = join(backupRoot, lessonSection.path);
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(pagePath, backupPath);
      writeFileSync(pagePath, after, "utf8");
    }
    repaired.push({
      unit: unit.unit,
      lesson: lesson.lesson,
      path: lessonSection.path,
      ispring: ispringItems.map((item) => item.path),
    });
  }
}

console.log(JSON.stringify({
  course,
  dryRun,
  backupRoot: dryRun ? null : backupRoot,
  repaired: repaired.length,
  skipped,
  samples: repaired.slice(0, 12),
}, null, 2));
