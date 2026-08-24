import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG1D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function sectionInfoForPath(lesson, path) {
  const normalized = String(path || "").replaceAll("\\", "/").toLowerCase();
  const fileFolder = normalized.match(/\/book_sections\/files\/([^/]+)\//)?.[1] || "";
  const section = (lesson.bookSections || []).find((item) => {
    const sectionFile = String(item.path || "").replaceAll("\\", "/").split("/").pop()?.replace(/\.html$/i, "").toLowerCase();
    return sectionFile && fileFolder && sectionFile === fileFolder;
  }) || (lesson.bookSections || []).find((item) => {
    const stem = String(item.path || "").replaceAll("\\", "/").replace(/\/[^/]+$/, "").toLowerCase();
    return stem && normalized.startsWith(`${stem}/files/`);
  });
  const label = String(section?.sectionLabel || section?.label || "");
  if (/hands/i.test(label) || /\/03-hands-on\//i.test(normalized)) return { role: "handsOn", parentSection: "Hands On", sectionPath: section?.path };
  if (/consolidation/i.test(label) || /\/04-consolidation\//i.test(normalized)) return { role: "consolidation", parentSection: "Consolidation", sectionPath: section?.path };
  if (/homework/i.test(label) || /\/05-homework\//i.test(normalized)) return { role: "homework", parentSection: "Homework", sectionPath: section?.path };
  if (/lesson/i.test(label) || /\/02-lesson\//i.test(normalized)) return { role: "lesson", parentSection: "Lesson", sectionPath: section?.path };
  return { role: "resources", parentSection: label || "resources", sectionPath: section?.path };
}

function isVideo(item) {
  const hay = [item?.type, item?.category, item?.label, item?.path].filter(Boolean).join(" ").toLowerCase();
  return /\b(?:mp4|webm|mov|m4v|video)\b/.test(hay) || /\.(?:mp4|webm|mov|m4v)(?:$|\?)/i.test(String(item?.path || ""));
}

function keyFor(item) {
  return item.previewPath || item.path || item.source || item.label;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let changed = 0;
let videos = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const standalone = new Map((lesson.videos || []).map((item) => [keyFor(item), item]));
    for (const item of lesson.downloads || []) {
      if (!isVideo(item) || !item.path || !existsSync(join(courseRoot, item.path))) continue;
      const section = sectionInfoForPath(lesson, item.path);
      const patched = {
        ...item,
        category: item.category === "moodle_file" ? "localized_moodle_resource" : item.category || "localized_moodle_resource",
        role: section.role,
        sourceGroup: "book_section_embed",
        parentSection: section.parentSection,
        sectionPath: section.sectionPath,
        previewPath: item.previewPath || item.path,
      };
      delete patched.downloadPath;
      Object.assign(item, patched);
      standalone.set(keyFor(patched), patched);
      changed += 1;
    }
    lesson.videos = [...standalone.values()];
    lesson.resourceCounts = lesson.resourceCounts || {};
    lesson.resourceCounts.videos = lesson.videos.length;
    videos += lesson.videos.length;
  }
}

manifest.sourceAudit = manifest.sourceAudit || {};
manifest.sourceAudit.bookSectionVideosNormalized = videos;
manifest.sourceAudit.bookSectionVideosNormalizedAt = new Date().toISOString();
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ course, patchedDownloadRefs: changed, standaloneVideos: videos }, null, 2));
