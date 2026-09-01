import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const courseRoot = "D:/工作文件/SUNNYBROOK/courseware/MPM2D";
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function fileBytes(relPath) {
  const abs = join(courseRoot, relPath);
  return existsSync(abs) ? statSync(abs).size : undefined;
}

function upsertById(list, record) {
  const index = list.findIndex((item) => item.id === record.id);
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

function upsertDownload(list, record) {
  const index = list.findIndex((item) => item.path === record.path || item.role === record.role);
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

const manifest = readJson(manifestPath);
const textbookPath = "texts/nelson-principles-of-mathematics-10/Nelson-Principles-of-Mathematics-10.pdf";
const curriculumPath = "texts/ontario-curriculum/math910curr.pdf";
const sourcesPath = "texts/SOURCES.md";

const textbookTitle = "MPM2D · Principles of Mathematics · Nelson Principles of Mathematics 10";
const curriculumTitle = "MPM2D · Principles of Mathematics · The Ontario Curriculum, Grades 9 and 10: Mathematics, 2005 (Revised)";

manifest.texts ||= [];

upsertById(manifest.texts, {
  id: "nelson-principles-of-mathematics-10",
  title: textbookTitle,
  publisher: "Nelson Education",
  type: "textbook",
  units: [1, 2, 3, 4],
  copyrightStatus: "licensed_local_copy",
  sourceStatus: "provided_by_user",
  notes: "Legally obtained local textbook copy provided by the user; verified against the PDF title/copyright pages and MPM2D course topics.",
  materials: [
    {
      label: textbookTitle,
      type: "pdf",
      category: "textbook",
      role: "core_textbook",
      path: textbookPath,
      bytes: fileBytes(textbookPath),
      source: "user-provided legal local file",
      previewPath: "",
    },
  ],
});

upsertById(manifest.texts, {
  id: "ontario-mathematics-curriculum-9-10",
  title: curriculumTitle,
  type: "curriculum",
  units: [1, 2, 3, 4],
  copyrightStatus: "public_official_document",
  sourceStatus: "public_ministry_resource",
  notes: "Official Ontario Ministry of Education curriculum document for Grade 9 and 10 mathematics, included as the education ministry curriculum guidance reference for MPM2D.",
  materials: [
    {
      label: curriculumTitle,
      type: "pdf",
      role: "curriculum_reference",
      category: "official_curriculum",
      path: curriculumPath,
      bytes: fileBytes(curriculumPath),
      source: "https://www.edu.gov.on.ca/eng/curriculum/secondary/math910curr.pdf",
    },
  ],
});

upsertById(manifest.texts, {
  id: "mpm2d-source-audit",
  title: "MPM2D Text And Source Audit",
  type: "source_audit",
  units: [1, 2, 3, 4],
  materials: [
    {
      label: "MPM2D Text And Source Audit",
      type: "md",
      role: "source_audit",
      category: "source_audit",
      path: sourcesPath,
      bytes: fileBytes(sourcesPath),
      source: "local source audit",
    },
  ],
});

manifest.courseDownloads ||= [];
upsertDownload(manifest.courseDownloads, {
  title: curriculumTitle,
  label: curriculumTitle,
  type: "pdf",
  role: "curriculum_reference",
  category: "official_curriculum",
  path: curriculumPath,
  bytes: fileBytes(curriculumPath),
  source: "https://www.edu.gov.on.ca/eng/curriculum/secondary/math910curr.pdf",
  attachments: [],
});

manifest.sourceAudit ||= {};
manifest.sourceAudit.mpm2dTextAndCurriculumPatch = {
  patchedAt: new Date().toISOString(),
  textbookTitle,
  curriculumTitle,
  curriculumPath,
  note: "Added the official Ontario Ministry mathematics curriculum guidance document to texts[] and normalized MPM2D text labels to the course-qualified display style used by MDM4U/MCR3U/SNC2D.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify(manifest.sourceAudit.mpm2dTextAndCurriculumPatch, null, 2));
