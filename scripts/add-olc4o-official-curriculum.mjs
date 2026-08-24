import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.basename(repoRoot).toLowerCase() === "ossd-course-portal"
  ? path.dirname(repoRoot)
  : repoRoot;
const course = "OLC4O";
const courseRoot = path.join(workspaceRoot, "courseware", course);
const manifestPath = path.join(courseRoot, "course-manifest.json");
const catalogPath = path.join(repoRoot, "public", "course-catalog.json");

const curriculumRelPath = "texts/ontario-curriculum-osslc/english12curr.pdf";
const sourcesRelPath = "texts/SOURCES.md";
const curriculumSource = "https://www.edu.gov.on.ca/eng/curriculum/secondary/english12curr.pdf";
const curriculumTitle = "The Ontario Curriculum: English - The Ontario Secondary School Literacy Course (OSSLC), Grade 12, 2003";
const courseTitle = "Ontario Secondary School Literacy Course";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function fileBytes(relPath) {
  return fs.statSync(path.join(courseRoot, ...relPath.split("/"))).size;
}

function upsertByPath(items, resource) {
  const index = items.findIndex((item) => item?.path === resource.path);
  if (index >= 0) items[index] = { ...items[index], ...resource };
  else items.push(resource);
}

function upsertById(items, resource) {
  const index = items.findIndex((item) => item?.id === resource.id);
  if (index >= 0) items[index] = { ...items[index], ...resource };
  else items.push(resource);
}

function removeByPath(items, relPath) {
  return (items || []).filter((item) => item?.path !== relPath);
}

const curriculumPath = path.join(courseRoot, ...curriculumRelPath.split("/"));
if (!fs.existsSync(curriculumPath)) {
  throw new Error(`Missing official curriculum PDF: ${curriculumPath}`);
}
if (fs.readFileSync(curriculumPath).subarray(0, 4).toString("latin1") !== "%PDF") {
  throw new Error(`Official curriculum file is not a PDF: ${curriculumPath}`);
}

const manifest = readJson(manifestPath);
const curriculumBytes = fileBytes(curriculumRelPath);

const curriculumMaterial = {
  label: curriculumTitle,
  title: curriculumTitle,
  type: "pdf",
  category: "official_curriculum",
  role: "curriculum_reference",
  path: curriculumRelPath,
  previewPath: curriculumRelPath,
  downloadPath: curriculumRelPath,
  bytes: curriculumBytes,
  source: curriculumSource,
  publisher: "Ontario Ministry of Education",
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  textPreview:
    "Official Ontario Ministry of Education curriculum policy document for the Ontario Secondary School Literacy Course (OSSLC), Grade 12.",
};

const sourcesBody = `# OLC4O Sources and Textbook Notes

Course: OLC4O - ${courseTitle}, Grade 12, Open

## Moodle Source

- Current course source: St. Mary Moodle new site, course id 69.
- Source URL: http://34.30.231.58/course/view.php?id=69
- Localized course structure: Introduction, Course Overview, Unit 1-3 Moodle book lessons, Culminating, Final Examination & Culminating, Teacher Packet shell, and Exit Cards/Homework-related Moodle activity records.
- Localized teaching content: 3 teaching units, 19 Moodle book lessons, local iSpring/H5P records where available, Moodle course/culminating/teacher/unit activity pages, DOCX/PDF resources, generated teacher unit/lesson plans, and lightweight previews.

## Textbook

No separate commercial textbook package was exposed in the current Moodle source, and no user-provided legal commercial textbook file has been added for this course.

Textbook/course title to display:

- ${courseTitle} (${course})

## Official Curriculum Guidance

Included official public curriculum document:

- ${curriculumTitle}
- Publisher: Ontario Ministry of Education
- Source: ${curriculumSource}
- Local path: ${curriculumRelPath}

This document is the official curriculum policy reference for OSSLC/OLC4O expectations, including Building Reading Skills, Building Writing Skills, and Understanding and Assessing Growth in Literacy.
`;

fs.writeFileSync(path.join(courseRoot, ...sourcesRelPath.split("/")), sourcesBody, "utf8");
const sourcesBytes = fileBytes(sourcesRelPath);

const sourcesMaterial = {
  label: "OLC4O Sources and Textbook Notes",
  title: "OLC4O Sources and Textbook Notes",
  type: "md",
  category: "source_audit",
  role: "source_audit",
  path: sourcesRelPath,
  downloadPath: sourcesRelPath,
  bytes: sourcesBytes,
  source: "local source audit",
  textPreview:
    "Records the current St. Mary Moodle source, official Ontario curriculum guidance file, and textbook status for OLC4O.",
};

manifest.generatedAt = new Date().toISOString();
manifest.texts = Array.isArray(manifest.texts) ? manifest.texts : [];
manifest.courseDownloads = Array.isArray(manifest.courseDownloads) ? manifest.courseDownloads : [];

upsertById(manifest.texts, {
  id: "olc4o-osslc-ontario-curriculum-2003",
  title: `${course} · ${curriculumTitle}`,
  label: `${course} · ${curriculumTitle}`,
  author: "Ontario Ministry of Education",
  publisher: "Ontario Ministry of Education",
  type: "curriculum",
  units: [1, 2, 3, 4],
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  notes:
    "Official Ontario curriculum policy reference for OLC4O/OSSLC, Grade 12.",
  materials: [curriculumMaterial],
  path: curriculumRelPath,
  previewPath: curriculumRelPath,
  downloadPath: curriculumRelPath,
  bytes: curriculumBytes,
  category: "official_curriculum",
  role: "curriculum_reference",
});

upsertById(manifest.texts, {
  id: "olc4o-source-audit",
  title: "OLC4O Sources and Textbook Notes",
  label: "OLC4O Sources and Textbook Notes",
  author: "local audit",
  type: "source_audit",
  units: [1, 2, 3, 4],
  copyrightStatus: "local_audit_note",
  sourceStatus: "created_from_local_source_review",
  notes:
    "Records that no separate commercial textbook package was exposed and that the Ontario Ministry OSSLC curriculum policy document is included as the official guidance file.",
  materials: [sourcesMaterial],
  path: sourcesRelPath,
  bytes: sourcesBytes,
  category: "source_audit",
  role: "source_audit",
});

manifest.courseDownloads = removeByPath(manifest.courseDownloads, curriculumRelPath);
manifest.courseDownloads.splice(1, 0, {
  ...curriculumMaterial,
  category: "curriculum_guidance",
  role: "curriculum_reference",
});

for (const unit of manifest.units ?? []) {
  unit.coreTexts = Array.isArray(unit.coreTexts) ? removeByPath(unit.coreTexts, curriculumRelPath) : [];
  unit.coreTexts.unshift(curriculumMaterial);
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  textbookReference: {
    title: courseTitle,
    courseCode: course,
    status: "no_separate_commercial_textbook_identified",
    evidence:
      "The current St. Mary Moodle course id 69 did not expose a separate commercial textbook package; OLC4O is organized around the official OSSLC curriculum expectations and local Moodle lesson resources.",
    officialGuidanceTitle: curriculumTitle,
    officialGuidancePath: curriculumRelPath,
  },
  officialGuidanceFile: {
    title: curriculumTitle,
    publisher: "Ontario Ministry of Education",
    status: "manifested",
    source: curriculumSource,
    path: curriculumRelPath,
    bytes: curriculumBytes,
    evidence:
      "Ontario policy references and course catalogues identify this document as the curriculum policy document for OSSLC/OLC4O.",
  },
  textMaterialCount: manifest.texts.length,
};

writeJson(manifestPath, manifest);

if (fs.existsSync(catalogPath)) {
  const catalog = readJson(catalogPath);
  const entry = (catalog.courses || []).find((item) => item.code === course);
  if (entry) {
    entry.notes =
      "St. Mary Moodle V2.0 course localized from course id 69: course overview, 3 units, 19 Moodle book lessons, local H5P, Moodle course/culminating/teacher/unit activities, DOCX/PDF resources, generated teacher plans with previews, official Ontario OSSLC curriculum guidance, source audit, and answer keys; no separate commercial textbook package was identified.";
    writeJson(catalogPath, catalog);
  }
}

console.log(JSON.stringify({
  course,
  textbookName: courseTitle,
  officialGuidanceTitle: curriculumTitle,
  curriculumRelPath,
  curriculumBytes,
  sourcesRelPath,
  sourcesBytes,
}, null, 2));
