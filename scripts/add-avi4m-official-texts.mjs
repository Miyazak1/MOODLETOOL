import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.basename(repoRoot).toLowerCase() === "ossd-course-portal"
  ? path.dirname(repoRoot)
  : repoRoot;
const courseRoot = path.join(workspaceRoot, "courseware", "AVI4M");
const manifestPath = path.join(courseRoot, "course-manifest.json");
const textsDir = path.join(courseRoot, "texts");
const curriculumDir = path.join(textsDir, "ontario-arts-curriculum-11-12");
const curriculumRelPath = "texts/ontario-arts-curriculum-11-12/arts1112curr2010.pdf";
const curriculumPath = path.join(courseRoot, ...curriculumRelPath.split("/"));
const sourceAuditRelPath = "texts/SOURCES.md";
const sourceAuditPath = path.join(courseRoot, ...sourceAuditRelPath.split("/"));

const curriculumTitle = "The Ontario Curriculum, Grades 11 and 12: The Arts, 2010 (Revised)";
const curriculumSource = "https://www.edu.gov.on.ca/eng/curriculum/secondary/arts1112curr2010.pdf";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileSize(relPath) {
  return fs.statSync(path.join(courseRoot, ...relPath.split("/"))).size;
}

function byPath(items, relPath) {
  return items.findIndex((item) => item?.path === relPath);
}

function upsertByPath(items, resource) {
  const index = byPath(items, resource.path);
  if (index >= 0) {
    items[index] = { ...items[index], ...resource };
  } else {
    items.push(resource);
  }
}

function upsertById(items, resource) {
  const index = items.findIndex((item) => item?.id === resource.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...resource };
  } else {
    items.push(resource);
  }
}

ensureDir(textsDir);
ensureDir(curriculumDir);

if (!fs.existsSync(curriculumPath)) {
  throw new Error(`Missing curriculum PDF: ${curriculumPath}`);
}

const sourceAuditBody = `# AVI4M Text And Source Audit

Course: AVI4M - Visual Arts, Grade 12, University/College

## Textbook

The localized AVI4M Course Outline lists: Textbook: None.

No commercial or unverified textbook file is included for this course.

## Official Curriculum Guidance

Included official public curriculum document:

- ${curriculumTitle}
- Source: ${curriculumSource}
- Local path: ${curriculumRelPath}

The document includes the Visual Arts, Grade 12, University/College Preparation (AVI4M) expectations.
`;

fs.writeFileSync(sourceAuditPath, sourceAuditBody, "utf8");

const curriculumBytes = fileSize(curriculumRelPath);
const sourceAuditBytes = fileSize(sourceAuditRelPath);

const curriculumMaterial = {
  label: curriculumTitle,
  type: "pdf",
  category: "official_curriculum",
  role: "curriculum_reference",
  path: curriculumRelPath,
  previewPath: curriculumRelPath,
  downloadPath: curriculumRelPath,
  bytes: curriculumBytes,
  source: curriculumSource,
};

const sourceAuditMaterial = {
  label: "AVI4M Text And Source Audit",
  type: "md",
  category: "source_audit",
  role: "source_audit",
  path: sourceAuditRelPath,
  downloadPath: sourceAuditRelPath,
  bytes: sourceAuditBytes,
  source: "local source audit",
};

const manifest = readJson(manifestPath);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = manifest.sourceAudit ?? {};
manifest.sourceAudit.textbookReference = {
  title: "None",
  status: "course_outline_lists_no_textbook",
  evidence: "The localized AVI4M Course Outline lists Textbook: None.",
};
manifest.sourceAudit.curriculumGuidance = [
  {
    title: curriculumTitle,
    status: "manifested",
    source: curriculumSource,
    path: curriculumRelPath,
    evidence: "The AVI4M Course Outline lists this Ontario Ministry curriculum document as its policy document.",
  },
];
manifest.sourceAudit.textMaterialCount = 2;

manifest.courseDownloads = Array.isArray(manifest.courseDownloads) ? manifest.courseDownloads : [];
upsertByPath(manifest.courseDownloads, {
  ...curriculumMaterial,
  category: "curriculum_guidance",
  textPreview:
    "Official Ontario Ministry curriculum guidance for Grades 11 and 12 The Arts, including Visual Arts, Grade 12, University/College Preparation (AVI4M).",
});

manifest.texts = Array.isArray(manifest.texts) ? manifest.texts : [];
upsertById(manifest.texts, {
  id: "ontario-arts-curriculum-11-12",
  title: curriculumTitle,
  author: "Ontario Ministry of Education",
  publisher: "Ontario Ministry of Education",
  type: "curriculum",
  units: [1, 2, 3, 4],
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  notes:
    "Official Ontario curriculum reference containing AVI4M Visual Arts, Grade 12, University/College Preparation expectations.",
  materials: [curriculumMaterial],
  path: curriculumRelPath,
  bytes: curriculumBytes,
  category: "official_curriculum",
  role: "curriculum_reference",
});
upsertById(manifest.texts, {
  id: "avi4m-source-audit",
  title: "AVI4M Text And Source Audit",
  author: "local audit",
  type: "source_audit",
  units: [1, 2, 3, 4],
  copyrightStatus: "local_audit_note",
  sourceStatus: "created_from_local_source_review",
  notes:
    "Records that the AVI4M Course Outline lists Textbook: None and that no commercial or unverified textbook has been added.",
  materials: [sourceAuditMaterial],
  path: sourceAuditRelPath,
  bytes: sourceAuditBytes,
  category: "source_audit",
  role: "source_audit",
});

for (const unit of manifest.units ?? []) {
  unit.coreTexts = Array.isArray(unit.coreTexts) ? unit.coreTexts : [];
  upsertByPath(unit.coreTexts, curriculumMaterial);
}

writeJson(manifestPath, manifest);

console.log(`Updated ${manifestPath}`);
console.log(`Added ${curriculumRelPath} (${curriculumBytes} bytes)`);
console.log(`Added ${sourceAuditRelPath} (${sourceAuditBytes} bytes)`);
