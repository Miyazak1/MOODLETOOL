import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(projectRoot);
const course = "ICS2O";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const roadmapPath = join(projectRoot, "public", "course-roadmap.json");

const curriculumRel = "texts/ontario-computer-studies-curriculum/computer10to12_2008.pdf";
const sourcesRel = "texts/SOURCES.md";
const curriculumSource = "https://www.edu.gov.on.ca/eng/curriculum/secondary/computer10to12_2008.pdf";
const curriculumTitle = "The Ontario Curriculum, Grades 10 to 12: Computer Studies, Revised 2008";
const textbookTitle = "No official textbook; teacher-provided notes, examples, PowerPoint presentations, and web resources";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function fileBytes(relPath) {
  return statSync(join(courseRoot, ...relPath.split("/"))).size;
}

function upsertByPath(items, item) {
  const normalized = toPosix(item.path).toLowerCase();
  const index = items.findIndex((existing) => toPosix(existing?.path).toLowerCase() === normalized);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

function upsertById(items, item) {
  const index = items.findIndex((existing) => existing?.id === item.id);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

function dedupeByPath(items) {
  const seen = new Set();
  const output = [];
  for (const item of items.filter(Boolean)) {
    const key = toPosix(item.path || item.id || item.label || item.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

const curriculumPath = join(courseRoot, ...curriculumRel.split("/"));
if (readFileSync(curriculumPath).subarray(0, 4).toString("latin1") !== "%PDF") {
  throw new Error(`Official curriculum file is not a PDF: ${curriculumPath}`);
}

const manifest = readJson(manifestPath);
const now = new Date().toISOString();
const units = [1, 2, 3];
const curriculumBytes = fileBytes(curriculumRel);

const curriculumMaterial = {
  label: curriculumTitle,
  title: curriculumTitle,
  type: "pdf",
  category: "official_curriculum",
  role: "curriculum_reference",
  path: curriculumRel,
  previewPath: curriculumRel,
  downloadPath: curriculumRel,
  bytes: curriculumBytes,
  source: curriculumSource,
  publisher: "Ontario Ministry of Education",
  author: "Ontario Ministry of Education",
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  textPreview:
    "Official Ontario Ministry of Education curriculum policy document for ICS2O and Grades 10 to 12 Computer Studies.",
};

const curriculumText = {
  id: "ics2o-ontario-computer-studies-curriculum-2008",
  title: `${course} · ${curriculumTitle}`,
  label: `${course} · ${curriculumTitle}`,
  author: "Ontario Ministry of Education",
  publisher: "Ontario Ministry of Education",
  type: "curriculum",
  units,
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  notes:
    "Official Ontario curriculum policy reference for Introduction to Computer Studies, Grade 10, Open (ICS2O).",
  materials: [curriculumMaterial],
  path: curriculumRel,
  previewPath: curriculumRel,
  downloadPath: curriculumRel,
  bytes: curriculumBytes,
  category: "official_curriculum",
  role: "curriculum_reference",
};

manifest.generatedAt = now;
manifest.texts = Array.isArray(manifest.texts) ? manifest.texts : [];
manifest.courseDownloads = Array.isArray(manifest.courseDownloads) ? manifest.courseDownloads : [];

upsertById(manifest.texts, curriculumText);
manifest.texts = dedupeByPath(manifest.texts);

upsertByPath(manifest.courseDownloads, {
  ...curriculumMaterial,
  category: "curriculum_guidance",
  parentSection: "Course info",
  sourceGroup: "original_moodle_section",
  sectionTitle: "Course info",
  sectionKey: "course-info",
  sectionOrder: 1,
  sortOrder: 3753.5,
});
manifest.courseDownloads = dedupeByPath(manifest.courseDownloads).sort((left, right) => {
  const leftOrder = Number(left.sortOrder ?? Number.MAX_SAFE_INTEGER);
  const rightOrder = Number(right.sortOrder ?? Number.MAX_SAFE_INTEGER);
  return leftOrder - rightOrder || String(left.label || "").localeCompare(String(right.label || ""));
});

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  textbookStatus: "no official textbook listed in current Moodle Course Outline",
  textbookAudit: {
    status: "no_official_textbook",
    title: textbookTitle,
    evidence:
      "The localized ICS2O Course Outline PDF states: 'Although there is no official textbook for this course, notes and examples are provided through ...' and lists teacher-provided PowerPoint presentations/web resources.",
    courseOutlinePath:
      "localized-moodle-activities/resource/course-3753-e1f0e70d48/e1f0e70d48-ICS2O-Course-Outline.pdf",
  },
  officialGuidanceFile: {
    status: "included",
    title: curriculumTitle,
    publisher: "Ontario Ministry of Education",
    source: curriculumSource,
    path: curriculumRel,
    bytes: curriculumBytes,
    addedAt: now,
  },
  textMaterialCount: manifest.texts.length,
};

const existingSources = readFileSync(join(courseRoot, ...sourcesRel.split("/")), "utf8");
const officialSection = `\n## Official Curriculum Guidance\n\nIncluded official public curriculum document:\n\n- ${curriculumTitle}\n- Publisher: Ontario Ministry of Education\n- Source: ${curriculumSource}\n- Local path: ${curriculumRel}\n\n## Textbook Status\n\nThe ICS2O Course Outline states that there is no official textbook for this course. The course uses teacher-provided notes, examples, PowerPoint presentations, and web resources.\n`;
const sourcesBody = existingSources.includes("## Official Curriculum Guidance")
  ? existingSources
  : `${existingSources.trimEnd()}\n${officialSection}`;
writeFileSync(join(courseRoot, ...sourcesRel.split("/")), sourcesBody, "utf8");

const notes = manifest.courseDownloads.find((item) => item.path === sourcesRel);
if (notes) notes.bytes = fileBytes(sourcesRel);

writeJson(manifestPath, manifest);

for (const jsonPath of [catalogPath, roadmapPath]) {
  const data = readJson(jsonPath);
  const entry = (data.courses || []).find((item) => item.code === course || item.course === course);
  if (entry) {
    entry.notes = `${entry.notes || ""} Official Ontario Computer Studies curriculum guidance is included; the course outline identifies no official textbook.`.trim();
  }
  writeJson(jsonPath, data);
}

console.log(JSON.stringify({
  course,
  officialGuidanceTitle: curriculumTitle,
  curriculumRel,
  curriculumBytes,
  textbookName: textbookTitle,
  texts: manifest.texts.length,
  courseDownloads: manifest.courseDownloads.length,
}, null, 2));
