import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(projectRoot);
const courseRoot = join(workspaceRoot, "courseware", "BBB4M");
const docsRoot = join(workspaceRoot, "docs");
const manifestPath = join(courseRoot, "course-manifest.json");
const sourceTextbookPath = join(docsRoot, "Grade 12-BBB4M-International Business Fundamentals.pdf");
const textbookRel = "texts/fundamentals-of-international-business-a-canadian-perspective.pdf";
const textbookPath = join(courseRoot, textbookRel);
const sourcesRel = "texts/SOURCES.md";
const sourcesPath = join(courseRoot, sourcesRel);

const curriculumRel = "texts/ontario-curriculum/business1112currb.pdf";
const curriculumSource = "https://www.edu.gov.on.ca/eng/curriculum/secondary/business1112currb.pdf";

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function fileBytes(rel) {
  return statSync(join(courseRoot, rel)).size;
}

function dedupeByPath(items) {
  const seen = new Set();
  const out = [];
  for (const item of items.filter(Boolean)) {
    const key = toPosix(item.path || item.previewPath || item.downloadPath || item.label || item.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function upsertText(texts, record) {
  const index = texts.findIndex((item) => item.id === record.id || toPosix(item.path).toLowerCase() === toPosix(record.path).toLowerCase());
  if (index >= 0) texts[index] = { ...texts[index], ...record };
  else texts.unshift(record);
}

function removeOldNoTextbookAudit(texts) {
  return texts.filter((item) => item.id !== "bbb4m-source-audit");
}

mkdirSync(dirname(textbookPath), { recursive: true });
copyFileSync(sourceTextbookPath, textbookPath);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const units = [1, 2, 3, 4];
const textbookMaterial = {
  label: "Fundamentals of International Business: A Canadian Perspective",
  type: "pdf",
  category: "textbook",
  role: "core_textbook",
  path: textbookRel,
  previewPath: textbookRel,
  bytes: fileBytes(textbookRel),
  source: "user provided legal copy",
};

const textbookText = {
  id: "fundamentals-of-international-business-a-canadian-perspective",
  title: "BBB4M · Fundamentals of International Business: A Canadian Perspective",
  publisher: "Alpha Textbooks",
  authors: ["Lorie Guest", "David Notman"],
  type: "textbook",
  units,
  copyrightStatus: "user_provided_legal_copy",
  sourceStatus: "localized_from_user_provided_source",
  notes: "Core BBB4M textbook for International Business Fundamentals. The user provided a legal local PDF copy in D:\\工作文件\\SUNNYBROOK\\docs.",
  materials: [textbookMaterial],
  path: textbookMaterial.path,
  previewPath: textbookMaterial.previewPath,
  bytes: textbookMaterial.bytes,
  category: textbookMaterial.category,
  role: textbookMaterial.role,
};

const curriculumMaterial = {
  label: "The Ontario Curriculum, Grades 11 and 12: Business Studies, 2006 (Revised)",
  type: "pdf",
  category: "official_curriculum",
  role: "curriculum_reference",
  path: curriculumRel,
  previewPath: curriculumRel,
  bytes: fileBytes(curriculumRel),
  source: curriculumSource,
};

const curriculumText = {
  id: "ontario-business-studies-curriculum-11-12",
  title: curriculumMaterial.label,
  publisher: "Ontario Ministry of Education",
  type: "curriculum",
  units,
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  notes: "Official Ontario curriculum guidance file for BBB4M International Business Fundamentals, Grade 12, University/College Preparation.",
  materials: [curriculumMaterial],
  path: curriculumMaterial.path,
  previewPath: curriculumMaterial.previewPath,
  bytes: curriculumMaterial.bytes,
  category: curriculumMaterial.category,
  role: curriculumMaterial.role,
};

const sourceAuditMaterial = {
  label: "BBB4M Text And Source Audit",
  type: "md",
  category: "source_audit",
  role: "source_audit",
  path: sourcesRel,
  bytes: 0,
  source: "local source audit",
};

const sourceAuditText = {
  id: "bbb4m-source-audit",
  title: "BBB4M Text And Source Audit",
  type: "source_audit",
  units,
  copyrightStatus: "local_audit_note",
  sourceStatus: "created_from_local_source_review",
  notes: "Records BBB4M textbook and official curriculum guidance sources.",
  materials: [sourceAuditMaterial],
  path: sourceAuditMaterial.path,
  bytes: 0,
  category: sourceAuditMaterial.category,
  role: sourceAuditMaterial.role,
};

manifest.texts = removeOldNoTextbookAudit(manifest.texts || []);
upsertText(manifest.texts, curriculumText);
upsertText(manifest.texts, textbookText);
manifest.texts = dedupeByPath([
  textbookText,
  curriculumText,
  ...manifest.texts.filter((item) => ![textbookText.id, curriculumText.id].includes(item.id)),
]);

manifest.sourceAudit ||= {};
manifest.sourceAudit.textbookAudit = {
  status: "included",
  title: textbookText.title,
  evidence: "User provided a legal local PDF copy in D:\\工作文件\\SUNNYBROOK\\docs\\Grade 12-BBB4M-International Business Fundamentals.pdf. PDF metadata title: Fundamentals of International Business: A Canadian Perspective; authors: Lorie Guest, David Notman.",
  localPath: textbookRel,
  decision: "Include as the BBB4M core textbook.",
};
manifest.sourceAudit.officialGuidanceFile = {
  status: "included",
  title: curriculumText.title,
  localPath: curriculumRel,
  source: curriculumSource,
  note: "Official Ontario curriculum guidance file for BBB4M course expectations and planning alignment.",
};
manifest.sourceAudit.curriculumPdfIncluded = true;
manifest.sourceAudit.textMaterials = manifest.texts.length;

const nonTextDownloads = (manifest.courseDownloads || []).filter((item) => {
  const role = String(item.role || "").toLowerCase();
  const category = String(item.category || "").toLowerCase();
  return !["core_textbook", "curriculum_reference", "source_audit"].includes(role) && !["textbook", "official_curriculum", "source_audit"].includes(category);
});
manifest.courseDownloads = dedupeByPath([
  textbookMaterial,
  curriculumMaterial,
  ...nonTextDownloads,
]);

const sourceAuditMarkdown = `# BBB4M Text And Source Audit

This BBB4M package uses Moodle-localized lesson resources, locally stored planning files, the Moodle Course Outline, the core textbook listed below, and the official Ontario curriculum guidance file.

## Included

- Core textbook: *Fundamentals of International Business: A Canadian Perspective* by Lorie Guest and David Notman. The local PDF was provided by the user as a legal copy.
- Official guidance file: *The Ontario Curriculum, Grades 11 and 12: Business Studies, 2006 (Revised)* from the Ontario Ministry of Education.
- BBB4M Course Outline, downloaded from the authenticated SunnyBrook Moodle course shell.

## Textbook Status

The previous audit recorded no identified textbook. This has been superseded by the user-provided legal textbook file in \`D:\\工作文件\\SUNNYBROOK\\docs\\Grade 12-BBB4M-International Business Fundamentals.pdf\`.

## Known Planning Source Gap

The current Moodle course contains 30 numbered lessons. Local planning files contain 29 lesson plans; Unit 1 Lesson 7 has no matching local lesson plan and is recorded in \`course-manifest.json\` under \`sourceAudit.missingLessonPlans\`.
`;

writeFileSync(sourcesPath, sourceAuditMarkdown, "utf8");
const sourcesBytes = fileBytes(sourcesRel);
sourceAuditMaterial.bytes = sourcesBytes;
sourceAuditText.bytes = sourcesBytes;
const sourceAuditInTexts = manifest.texts.find((item) => item.id === sourceAuditText.id);
if (sourceAuditInTexts) Object.assign(sourceAuditInTexts, sourceAuditText);
else manifest.texts.push(sourceAuditText);
manifest.texts = dedupeByPath(manifest.texts);
manifest.textMaterials = manifest.texts;
manifest.courseDownloads = dedupeByPath([...manifest.courseDownloads, sourceAuditMaterial]);
manifest.sourceAudit.textMaterials = manifest.texts.length;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course: "BBB4M",
  textbook: textbookMaterial,
  officialGuidance: curriculumMaterial,
  texts: manifest.texts.length,
  courseDownloads: manifest.courseDownloads.length,
}, null, 2));
