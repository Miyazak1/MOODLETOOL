import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const COURSE = "BAF3M";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const COURSE_ROOT = resolve(REPO_ROOT, "..", "courseware", COURSE);
const MANIFEST_PATH = join(COURSE_ROOT, "course-manifest.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function keyForAttachment(item) {
  return String(item?.path || item?.downloadPath || item?.label || "");
}

function attachHomeworkFiles(unit, lesson) {
  const homeworkFiles = (lesson.downloads || []).filter((item) => {
    const itemPath = String(item.path || "");
    return itemPath.includes("/book_sections/files/05-homework/") && existsSync(join(COURSE_ROOT, itemPath));
  });
  if (!homeworkFiles.length) return { attached: 0, sectionAttached: 0, missing: "homework-files" };

  let sectionAttached = 0;
  const homeworkSection = (lesson.bookSections || []).find((item) => String(item.sectionLabel || "").toLowerCase() === "homework");
  if (homeworkSection) {
    const sectionExisting = new Set((homeworkSection.attachments || []).map(keyForAttachment));
    const sectionAdditions = homeworkFiles.filter((item) => !sectionExisting.has(keyForAttachment(item))).map(clone);
    if (sectionAdditions.length) {
      homeworkSection.attachments = [...(homeworkSection.attachments || []), ...sectionAdditions];
      sectionAttached = sectionAdditions.length;
    }
  }

  const dropbox = (unit.unitResources?.lessonDropboxes || []).find((item) => {
    return new RegExp(`\\bUnit\\s+${unit.unit}\\s+-\\s+Lesson\\s+${lesson.lesson}\\b`, "i").test(item.label || "");
  });
  if (!dropbox) return { attached: 0, sectionAttached, missing: "dropbox" };

  const existing = new Set((dropbox.attachments || []).map(keyForAttachment));
  const additions = homeworkFiles.filter((item) => !existing.has(keyForAttachment(item))).map(clone);
  if (!additions.length) return { attached: 0, sectionAttached };

  dropbox.attachments = [...(dropbox.attachments || []), ...additions];
  return { attached: additions.length, sectionAttached };
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const report = [];
let attached = 0;
let sectionAttached = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const result = attachHomeworkFiles(unit, lesson);
    attached += result.attached;
    sectionAttached += result.sectionAttached;
    report.push({
      unit: unit.unit,
      lesson: lesson.lesson,
      lessonId: lesson.id,
      attached: result.attached,
      sectionAttached: result.sectionAttached,
      missing: result.missing || "",
    });
  }
}

manifest.sourceAudit = manifest.sourceAudit || {};
manifest.sourceAudit.homeworkDropboxAttachmentsPatchedAt = new Date().toISOString();
manifest.sourceAudit.homeworkDropboxAttachmentsPatched = attached;
manifest.sourceAudit.homeworkBookSectionAttachmentsPatched = sectionAttached;

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ course: COURSE, attached, sectionAttached, report }, null, 2));
