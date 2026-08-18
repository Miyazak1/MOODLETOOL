import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = (readArg("--course") || "").toUpperCase();

if (!course) {
  console.error("Usage: node scripts/patch-book-section-attachments-from-downloads.mjs --course COURSE");
  process.exit(1);
}

const manifestPath = resolve(workspaceRoot, "courseware", course, "course-manifest.json");
if (!existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sectionKeyFromPath(path) {
  const match = /\/book_sections\/files\/([^/]+)\//i.exec(`/${toPosix(path)}`);
  return match?.[1] || "";
}

function sectionKeyFromBookSection(section) {
  const name = toPosix(section?.path || "").split("/").pop() || "";
  return name.replace(/\.html?$/i, "");
}

function cloneAttachment(item) {
  const copy = { ...item };
  copy.role = copy.role || "attachment";
  copy.category = copy.category || "moodle_file";
  return copy;
}

function sameAttachment(a, b) {
  return toPosix(a.path) === toPosix(b.path);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let sectionsWithAttachments = 0;
let attachmentsLinked = 0;
const examples = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const downloadsBySection = new Map();
    for (const item of lesson.downloads || []) {
      const key = sectionKeyFromPath(item.path);
      if (!key) continue;
      if (!downloadsBySection.has(key)) downloadsBySection.set(key, []);
      downloadsBySection.get(key).push(cloneAttachment(item));
    }

    for (const section of lesson.bookSections || []) {
      const key = sectionKeyFromBookSection(section);
      const attachments = downloadsBySection.get(key) || [];
      if (!attachments.length) {
        if (Array.isArray(section.attachments) && section.attachments.length === 0) delete section.attachments;
        continue;
      }

      const current = Array.isArray(section.attachments) ? section.attachments : [];
      const merged = [...current];
      for (const attachment of attachments) {
        if (!merged.some((item) => sameAttachment(item, attachment))) merged.push(attachment);
      }
      section.attachments = merged;
      sectionsWithAttachments += 1;
      attachmentsLinked += merged.length;
      if (examples.length < 12) {
        examples.push({
          lesson: lesson.id,
          section: section.sectionLabel || section.label,
          sectionPath: section.path,
          attachments: merged.map((item) => item.label),
        });
      }
    }
  }
}

manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ course, sectionsWithAttachments, attachmentsLinked, examples }, null, 2));
