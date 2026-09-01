import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BAT4M");
const manifestPath = join(courseRoot, "course-manifest.json");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlHref(fromRelPath, toRelPath) {
  return toPosix(relative(dirname(join(courseRoot, fromRelPath)), join(courseRoot, toRelPath)))
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function ensureRecommendedStyles(html) {
  let next = String(html || "");
  const legacyRule =
    /    \.localized-ispring \{ border: 0; display: block; height: min\(72vh, 760px\); margin: 16px 0; width: 100%; \}\n/;
  const recommended = [
    "    .localized-ispring, .embedded-h5p-frame, .embedded-video { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }",
    "    .localized-ispring iframe, .embedded-h5p-frame iframe { border: 0; display: block; min-height: 640px; width: 100%; }",
    "    .localized-ispring iframe { height: min(72vh, 760px); }",
  ].join("\n") + "\n";
  if (legacyRule.test(next)) return next.replace(legacyRule, recommended);
  if (!/\.localized-ispring iframe\b/.test(next)) {
    return next.replace(/(\s+\.content img, \.content video \{[^}]+\}\n)/, `$1${recommended}`);
  }
  return next;
}

function ispringEmbedHtml(href, title) {
  return `<div class="localized-ispring"><iframe src="${escapeHtml(href)}" width="1500" height="600" frameborder="0" scrolling="auto" allowfullscreen="allowfullscreen" loading="lazy" title="${title}"></iframe></div>`;
}

function ensureSingleLessonIspring(html, href, title) {
  let next = ensureRecommendedStyles(html);
  const beforeRemoval = next;
  const existingEmbedPattern =
    /<div class="localized-ispring">\s*(?:<div class="localized-ispring">\s*)?<iframe\b[^>]*ispring-localized\/[^>]*presentation\.html[^>]*>\s*<\/iframe>\s*<\/div>\s*(?:<\/div>)?|<iframe\b[^>]*ispring-localized\/[^>]*presentation\.html[^>]*>\s*<\/iframe>/gi;
  next = next.replace(existingEmbedPattern, "");

  const embed = ispringEmbedHtml(href, title);
  if (/<\/article>/.test(next)) {
    next = next.replace(/<\/article>/, `${embed}</article>`);
  } else if (/<section class="files">/.test(next)) {
    next = next.replace(/\s*<section class="files">/, `\n    ${embed}\n    <section class="files">`);
  } else {
    next = next.replace(/<\/main>/, `    ${embed}\n  </main>`);
  }

  return {
    html: next,
    changed: next !== html,
    normalized: beforeRemoval !== next && beforeRemoval !== html,
  };
}

function hasCorrectIspringEmbed(html, href) {
  return (
    html.includes(`<div class="localized-ispring"><iframe src="${href}"`) &&
    !/<div class="localized-ispring">\s*<div class="localized-ispring">/i.test(html)
  );
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const patched = [];
const skipped = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const ispring = (lesson.ispring || []).find((item) => item.path);
    const lessonSection = (lesson.bookSections || []).find(
      (section) => String(section.sectionLabel || "").trim().toLowerCase() === "lesson" && section.path,
    );

    if (!ispring || !lessonSection) {
      skipped.push({ lesson: lesson.id, reason: "missing lesson section or ispring" });
      continue;
    }

    const pagePath = join(courseRoot, lessonSection.path);
    if (!existsSync(pagePath)) {
      skipped.push({ lesson: lesson.id, reason: "missing lesson page", path: lessonSection.path });
      continue;
    }

    const href = htmlHref(lessonSection.path, ispring.path);
    const title = escapeHtml(`Lesson - BAT4M Unit ${unit.unit} Lesson ${lesson.lesson || lesson.id}`);
    let html = readFileSync(pagePath, "utf8");
    if (hasCorrectIspringEmbed(html, href)) {
      lessonSection.bytes = Buffer.byteLength(html, "utf8");
      continue;
    }

    const { html: next } = ensureSingleLessonIspring(html, href, title);

    if (next === html) {
      skipped.push({ lesson: lesson.id, reason: "no insertion point", path: lessonSection.path });
      continue;
    }

    writeFileSync(pagePath, next, "utf8");
    lessonSection.bytes = Buffer.byteLength(next, "utf8");
    patched.push({ lesson: lesson.id, path: lessonSection.path, ispring: ispring.path });
  }
}

manifest.sourceAudit = manifest.sourceAudit || {};
manifest.sourceAudit.ispringEmbeddedInLessonPages = (manifest.units || []).reduce(
  (sum, unit) =>
    sum +
    (unit.lessons || []).filter((lesson) => {
      const section = (lesson.bookSections || []).find(
        (item) => String(item.sectionLabel || "").trim().toLowerCase() === "lesson" && item.path,
      );
      if (!section) return false;
      const pagePath = join(courseRoot, section.path);
      if (!existsSync(pagePath)) return false;
      const html = readFileSync(pagePath, "utf8");
      return /class=["'][^"']*(?:localized-ispring|ispring-player|embedded-ispring)/i.test(html);
    }).length,
  0,
);
manifest.sourceAudit.ispringLessonPagesPatchedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ patched: patched.length, skipped, samples: patched.slice(0, 5) }, null, 2));
