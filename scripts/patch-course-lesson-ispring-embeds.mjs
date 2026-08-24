import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course")?.toUpperCase();

if (!course) {
  console.error("Usage: node scripts/patch-course-lesson-ispring-embeds.mjs --course COURSE");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

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

function ensureStyles(html) {
  const css = [
    "    .localized-ispring { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }",
    "    .localized-ispring iframe { border: 0; display: block; height: min(72vh, 760px); min-height: 640px; width: 100%; }",
  ].join("\n") + "\n";

  let next = String(html || "");
  next = next.replace(
    /    \.localized-ispring \{ border: 0; display: block; height: min\(72vh, 760px\); margin: 16px 0; width: 100%; \}\n/g,
    "",
  );
  if (/\.localized-ispring iframe\b/.test(next)) return next;
  return next.replace(/(\s+\.content img, \.content video \{[^}]+\}\n)/, `$1${css}`);
}

function removeExistingIspring(html) {
  return String(html || "").replace(
    /<div class=["']localized-ispring["']>\s*<iframe\b[^>]*ispring-localized\/[^>]*presentation\.html[^>]*>\s*<\/iframe>\s*<\/div>/gi,
    "",
  );
}

function iframeHtml(href, title) {
  return `<div class="localized-ispring"><iframe src="${escapeHtml(href)}" width="1500" height="600" frameborder="0" scrolling="auto" allowfullscreen="allowfullscreen" loading="lazy" title="${escapeHtml(title)}"></iframe></div>`;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const patched = [];
const skipped = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const ispring = (lesson.ispring || []).find((item) => item.path && existsSync(join(courseRoot, item.path)));
    const lessonSection = (lesson.bookSections || []).find(
      (section) => section?.path && String(section.sectionLabel || "").trim().toLowerCase() === "lesson",
    );
    if (!ispring || !lessonSection) {
      skipped.push({ lesson: lesson.id, reason: !ispring ? "missing ispring" : "missing lesson section" });
      continue;
    }

    const pagePath = join(courseRoot, lessonSection.path);
    if (!existsSync(pagePath)) {
      skipped.push({ lesson: lesson.id, reason: "missing lesson html", path: lessonSection.path });
      continue;
    }

    const href = htmlHref(lessonSection.path, ispring.path);
    let html = readFileSync(pagePath, "utf8");
    if (html.includes(`src="${href}"`)) continue;

    const before = html;
    html = ensureStyles(removeExistingIspring(html));
    const embed = iframeHtml(href, ispring.label || `${course} ${lesson.id || ""} iSpring`);
    if (/<section class="files">/.test(html)) {
      html = html.replace(/\s*<section class="files">/, `\n    ${embed}\n    <section class="files">`);
    } else if (/<\/article>/.test(html)) {
      html = html.replace(/<\/article>/, `${embed}</article>`);
    } else {
      html = html.replace(/<\/main>/, `    ${embed}\n  </main>`);
    }

    if (html === before) {
      skipped.push({ lesson: lesson.id, reason: "no insertion point", path: lessonSection.path });
      continue;
    }
    writeFileSync(pagePath, html, "utf8");
    lessonSection.bytes = Buffer.byteLength(html, "utf8");
    patched.push({ lesson: lesson.id, path: lessonSection.path, ispring: ispring.path });
  }
}

manifest.sourceAudit = manifest.sourceAudit || {};
manifest.sourceAudit.ispringEmbeddedInLessonPages = patched.length + (manifest.sourceAudit.ispringEmbeddedInLessonPages || 0);
manifest.sourceAudit.ispringLessonPagesPatchedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ course, patched: patched.length, skipped, samples: patched.slice(0, 5) }, null, 2));
