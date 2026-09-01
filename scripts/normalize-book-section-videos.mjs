import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

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

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function flowFromLabel(value) {
  const label = String(value || "").toLowerCase();
  if (label.includes("hands")) return { role: "handsOn", parentSection: "Hands On" };
  if (label.includes("consolidation") || label.includes("consoldation")) return { role: "consolidation", parentSection: "Consolidation" };
  if (label.includes("homework")) return { role: "homework", parentSection: "Homework" };
  if (label.includes("expectation")) return { role: "expectations", parentSection: "Lesson Expectations" };
  if (label.includes("lesson")) return { role: "lesson", parentSection: "Lesson" };
  return null;
}

function isVideo(item) {
  const haystack = [item?.type, item?.category, item?.label, item?.path, item?.previewPath, item?.downloadPath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(?:mp4|webm|mov|m4v|video)\b/.test(haystack) || /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(haystack);
}

function sectionForFileFolder(lesson, itemPath) {
  const normalized = toPosix(itemPath).toLowerCase();
  const fileFolder = normalized.match(/\/book_sections\/files\/([^/]+)\//)?.[1] || "";
  if (!fileFolder) return null;
  return (
    (lesson.bookSections || []).find((section) => {
      const stem = basename(toPosix(section.path || "")).replace(/\.html$/i, "").toLowerCase();
      return stem && stem === fileFolder;
    }) || null
  );
}

function htmlReferencesVideo(html, itemPath) {
  const decoded = decodeHtml(html).replace(/\\/g, "/");
  const normalizedHtml = decoded.toLowerCase();
  const normalizedPath = toPosix(itemPath).toLowerCase();
  const fileName = basename(toPosix(itemPath)).toLowerCase();
  return Boolean(normalizedPath && normalizedHtml.includes(normalizedPath)) || Boolean(fileName && normalizedHtml.includes(fileName));
}

function sectionForHtmlReference(courseRoot, lesson, itemPath) {
  for (const section of lesson.bookSections || []) {
    if (!section.path) continue;
    const sectionPath = join(courseRoot, section.path);
    if (!existsSync(sectionPath)) continue;
    const html = readFileSync(sectionPath, "utf8");
    if (htmlReferencesVideo(html, itemPath)) return section;
  }
  return null;
}

function sectionInfo(courseRoot, lesson, item) {
  const itemPath = item.path || item.previewPath || item.downloadPath || "";
  const section = sectionForFileFolder(lesson, itemPath) || sectionForHtmlReference(courseRoot, lesson, itemPath);
  if (!section) return null;
  const flow = flowFromLabel(`${section.sectionLabel || ""} ${section.label || ""}`) || { role: "resources", parentSection: section.sectionLabel || "Resources" };
  return {
    ...flow,
    sectionPath: section.path,
  };
}

function keyFor(item) {
  return item.previewPath || item.path || item.downloadPath || item.source || item.label;
}

const courseArg = readArg("--course");
const coursesArg = readArg("--courses");
const courses = (coursesArg ? coursesArg.split(",") : [courseArg]).map(safeCourse).filter(Boolean);
const dryRun = hasFlag("--dry-run");

if (!courses.length) {
  console.error("Usage: node scripts/normalize-book-section-videos.mjs --course ENG1D [--dry-run]");
  process.exit(2);
}

const results = [];

for (const course of courses) {
  const courseRoot = join(workspaceRoot, "courseware", course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing manifest for ${course}: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const changes = [];
  let standaloneVideos = 0;

  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      const standalone = new Map((lesson.videos || []).map((item) => [keyFor(item), item]));
      for (const item of lesson.downloads || []) {
        if (!isVideo(item) || !item.path || !existsSync(join(courseRoot, item.path))) continue;
        const section = sectionInfo(courseRoot, lesson, item);
        if (!section) continue;
        const before = {
          role: item.role,
          category: item.category,
          previewPath: item.previewPath,
          sourceGroup: item.sourceGroup,
          parentSection: item.parentSection,
          sectionPath: item.sectionPath,
        };
        const after = {
          category: item.category === "moodle_file" || !item.category ? "localized_moodle_resource" : item.category,
          role: section.role,
          previewPath: item.previewPath || item.path,
          sourceGroup: "book_section_embed",
          parentSection: section.parentSection,
          sectionPath: section.sectionPath,
        };
        const changed = Object.entries(after).some(([key, value]) => item[key] !== value);
        if (!changed) {
          standalone.set(keyFor(item), item);
          continue;
        }
        changes.push({
          unit: unit.unit,
          lesson: lesson.lesson,
          title: lesson.title,
          label: item.label,
          path: item.path,
          before,
          after,
        });
        Object.assign(item, after);
        standalone.set(keyFor(item), item);
      }
      lesson.videos = [...standalone.values()];
      lesson.resourceCounts = lesson.resourceCounts || {};
      lesson.resourceCounts.videos = lesson.videos.length;
      standaloneVideos += lesson.videos.length;
    }
  }

  if (!dryRun && changes.length) {
    manifest.sourceAudit = manifest.sourceAudit || {};
    manifest.sourceAudit.bookSectionVideosNormalized = standaloneVideos;
    manifest.sourceAudit.bookSectionVideosNormalizedAt = new Date().toISOString();
    manifest.generatedAt = new Date().toISOString();
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  results.push({
    course,
    dryRun,
    changed: changes.length,
    standaloneVideos,
    samples: changes.slice(0, 12),
  });
}

console.log(JSON.stringify({ dryRun, courses: results }, null, 2));
