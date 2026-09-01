import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG2D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function roleForBookSection(label) {
  const value = String(label || "").toLowerCase();
  if (value.includes("expectation") || value.includes("overview") || value.includes("introduction")) return "expectations";
  if (value.includes("hands")) return "hands_on";
  if (value.includes("consolidation")) return "consolidation";
  if (value.includes("homework")) return "homework";
  return "lesson";
}

function sectionIndexFromPath(path) {
  return Number(String(path || "").match(/\/book_sections\/files\/(\d{2})-/i)?.[1] || 0);
}

function resourceKey(item) {
  return item?.path || item?.previewPath || item?.downloadPath || item?.source || item?.label || "";
}

function enrichAttachment(item, section) {
  const sectionLabel = section.sectionLabel || section.label || "";
  return {
    ...item,
    role: roleForBookSection(sectionLabel),
    sourceGroup: "book_section_embed",
    parentSection: sectionLabel,
    sectionLabel,
    sectionPath: section.path,
  };
}

function addUnique(items, item) {
  const key = resourceKey(item);
  if (!key || items.some((current) => resourceKey(current) === key)) return false;
  items.push(item);
  return true;
}

function upsertEnrichedAttachment(items, item) {
  const key = resourceKey(item);
  const index = items.findIndex((current) => resourceKey(current) === key);
  if (index >= 0) {
    const before = JSON.stringify(items[index]);
    items[index] = { ...items[index], ...item };
    return JSON.stringify(items[index]) !== before ? "updated" : "unchanged";
  }
  items.push(item);
  return "added";
}

if (!existsSync(manifestPath)) {
  throw new Error(`Missing ENG2D manifest: ${manifestPath}`);
}

const manifest = readJson(manifestPath);
let downloadsRetagged = 0;
let sectionAttachmentsAdded = 0;
let sectionAttachmentsUpdated = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.downloads || []) {
      const sectionIndex = sectionIndexFromPath(item.path || item.downloadPath || item.previewPath);
      if (!sectionIndex) continue;
      const section = (lesson.bookSections || []).find((candidate) => Number(candidate.sectionIndex) === sectionIndex);
      if (!section) continue;
      const enriched = enrichAttachment(item, section);
      const before = JSON.stringify(item);
      Object.assign(item, enriched);
      if (JSON.stringify(item) !== before) downloadsRetagged += 1;
      section.attachments ||= [];
      const attachmentStatus = upsertEnrichedAttachment(section.attachments, enriched);
      if (attachmentStatus === "added") sectionAttachmentsAdded += 1;
      if (attachmentStatus === "updated") sectionAttachmentsUpdated += 1;
    }
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.lessonFlowResourceRepair = {
  repairedAt: new Date().toISOString(),
  downloadsRetagged,
  sectionAttachmentsAdded,
  sectionAttachmentsUpdated,
  note: "Book-section attachments were tagged with their Moodle book section so lesson videos/H5P/documents flow under Lesson, Hands On, Consolidation, or Homework instead of the generic resources group.",
};

writeJson(manifestPath, manifest);
console.log(JSON.stringify({ course, downloadsRetagged, sectionAttachmentsAdded, sectionAttachmentsUpdated }, null, 2));
