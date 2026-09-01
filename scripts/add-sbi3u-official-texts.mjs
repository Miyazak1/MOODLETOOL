import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const COURSE = "SBI3U";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const manifestPath = join(COURSE_ROOT, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function fileSize(relPath) {
  const absPath = join(COURSE_ROOT, relPath);
  return existsSync(absPath) ? statSync(absPath).size : 0;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

function upsertByPath(items, item) {
  const index = items.findIndex((candidate) => candidate.path === item.path);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

const curriculumRelPath = "texts/ontario-curriculum/2009science11_12.pdf";
const curriculumTitle = "The Ontario Curriculum, Grades 11 and 12: Science, 2008 (Revised)";
const curriculumSource = "https://www.edu.gov.on.ca/eng/curriculum/secondary/2009science11_12.pdf";
const textbookSourcePath = join(WORKSPACE_ROOT, "docs", "McGraw-Hill-Ryerson-Biology-11.pdf");
const textbookRelPath = "texts/mcgraw-hill-ryerson-biology-11/McGraw-Hill-Ryerson-Biology-11.pdf";
const textbookIndexRelPath = "texts/biology-11-textbook-reference/index.html";
const sourcesRelPath = "texts/SOURCES.md";

ensureDir(dirname(join(COURSE_ROOT, textbookRelPath)));
ensureDir(dirname(join(COURSE_ROOT, textbookIndexRelPath)));
ensureDir(dirname(join(COURSE_ROOT, sourcesRelPath)));

const hasLegalTextbook = existsSync(textbookSourcePath);
if (hasLegalTextbook) copyFileSync(textbookSourcePath, join(COURSE_ROOT, textbookRelPath));

const textbookIndexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SBI3U Biology 11 Textbook Reference</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f4f7fb; color: #001f3f; }
    main { max-width: 920px; margin: 48px auto; background: #fff; border: 1px solid #d8e4f2; border-radius: 8px; padding: 28px; }
    h1 { margin-top: 0; font-size: 30px; }
    h2 { margin-top: 28px; font-size: 20px; }
    p, li { line-height: 1.55; }
    .notice { border: 1px solid #f4c36a; background: #fff8e8; color: #6d4600; border-radius: 6px; padding: 12px 14px; }
    dl { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; }
    dt { font-weight: 700; }
    dd { margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>SBI3U Biology 11 Textbook Reference</h1>
    <p class="notice">${hasLegalTextbook ? "A legally obtained local textbook copy has been provided by the user and included in this SBI3U course package." : "This page records the textbook name/source evidence only. A full commercial textbook PDF is not included because no legal local Biology 11 textbook copy was found in <code>D:\\工作文件\\SUNNYBROOK\\docs</code>."}</p>
    <h2>Textbook Name</h2>
    <dl>
      <dt>Primary title</dt>
      <dd>McGraw-Hill Ryerson Biology 11</dd>
      <dt>Common title</dt>
      <dd>Biology 11</dd>
      <dt>Publisher</dt>
      <dd>McGraw-Hill Ryerson</dd>
      <dt>Student text ISBN</dt>
      <dd>0-07-088708-X</dd>
      <dt>Course match</dt>
      <dd>SBI3U Biology, Grade 11, University Preparation</dd>
    </dl>
    <h2>Evidence</h2>
    <ul>
      <li>Public course outline references for SBI3U list the textbook as McGraw-Hill Ryerson, Biology 11.</li>
      <li>Public bibliographic records identify <em>McGraw-Hill Ryerson Biology 11</em> as a Biology 11 student text.</li>
      <li>${hasLegalTextbook ? `The local course package includes the user-provided textbook file at <code>${textbookRelPath}</code>.` : "The local course package currently includes Moodle lesson resources and official Ontario curriculum guidance, not the full commercial textbook."}</li>
    </ul>
    <h2>Included Official Guidance</h2>
    <p>The official Ontario Ministry curriculum document for Grades 11 and 12 Science is included separately in this course package.</p>
  </main>
</body>
</html>
`;

const sourcesMd = `# SBI3U Text And Source Audit

This SBI3U package uses resources localized from the St. Mary Moodle course shell, local files extracted from Moodle activities/books, local iSpring/H5P packages, and the official Ontario curriculum reference listed below.

## Textbook Name

- Primary textbook/reference name: McGraw-Hill Ryerson Biology 11.
- Common title: Biology 11.
- Publisher: McGraw-Hill Ryerson.
- Student text ISBN: 0-07-088708-X.
- Course match: Biology, Grade 11, University Preparation (SBI3U).

## Textbook Status

${hasLegalTextbook ? `A legally obtained Biology 11 textbook PDF was provided by the user and has been included in the course package.

- Source file: \`docs/McGraw-Hill-Ryerson-Biology-11.pdf\`
- Local courseware path: \`${textbookRelPath}\`

Biology 12 files remain excluded because they do not match SBI3U.` : "No full Biology 11 textbook PDF has been included. The local docs folder was checked and contains Biology 12 textbooks, but no legal Biology 11 textbook copy. Biology 12 files remain excluded because they do not match SBI3U."}

## Included

- St. Mary Moodle course page: http://34.30.231.58/course/view.php?id=35
- Moodle section/activity resources, including Course Introduction, Course Outline, Learning Log, Lab report template, Writing Formal Lab Reports, final/culminating resources, unit lessons, iSpring packages, H5P packages, assignments, homework, and teacher answer resources where available.
- The Ontario Curriculum, Grades 11 and 12: Science, 2008 (Revised), from the Ontario Ministry of Education.

## Official Curriculum

- Local path: \`${curriculumRelPath}\`
- Public source: ${curriculumSource}
- Notes: This official document includes Biology, Grade 11, University Preparation (SBI3U) curriculum expectations.
`;

writeFileSync(join(COURSE_ROOT, textbookIndexRelPath), textbookIndexHtml, "utf8");
writeFileSync(join(COURSE_ROOT, sourcesRelPath), sourcesMd, "utf8");

const curriculumBytes = fileSize(curriculumRelPath);
const textbookBytes = fileSize(textbookRelPath);
const textbookIndexBytes = fileSize(textbookIndexRelPath);
const sourcesBytes = fileSize(sourcesRelPath);

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
  textPreview: "Official Ontario Ministry curriculum guidance for Grades 11 and 12 Science, including SBI3U Biology, Grade 11, University Preparation.",
};

const textbookMaterial = hasLegalTextbook ? {
  label: "McGraw-Hill Ryerson Biology 11",
  type: "pdf",
  category: "textbook",
  role: "core_text",
  path: textbookRelPath,
  previewPath: textbookRelPath,
  downloadPath: textbookRelPath,
  bytes: textbookBytes,
  source: "local legally obtained file provided by user: docs/McGraw-Hill-Ryerson-Biology-11.pdf",
  textPreview: "Legally obtained local copy of the SBI3U Biology 11 textbook.",
} : null;

const textbookIndexMaterial = {
  label: "SBI3U Biology 11 Textbook Reference",
  type: "html",
  category: "textbook_reference",
  role: "textbook_reference",
  path: textbookIndexRelPath,
  previewPath: textbookIndexRelPath,
  bytes: textbookIndexBytes,
  source: "local source audit based on Moodle review and public bibliographic references",
  textPreview: "Records the likely SBI3U textbook name as McGraw-Hill Ryerson Biology 11 and notes that no legal full textbook PDF is included.",
};

const sourcesMaterial = {
  label: "SBI3U Text And Source Audit",
  type: "md",
  category: "source_audit",
  role: "source_audit",
  path: sourcesRelPath,
  downloadPath: sourcesRelPath,
  bytes: sourcesBytes,
  source: "local source audit",
};

const manifest = readJson(manifestPath);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit ||= {};
manifest.sourceAudit.textbookReference = {
  title: "McGraw-Hill Ryerson Biology 11",
  status: hasLegalTextbook ? "included_from_user_provided_legal_copy" : "referenced_only",
  publisher: "McGraw-Hill Ryerson",
  isbn: "0-07-088708-X",
  evidence: hasLegalTextbook
    ? "Public SBI3U course outline and bibliographic references identify the course text as McGraw-Hill Ryerson Biology 11. The user provided a legally obtained local Biology 11 PDF in docs."
    : "Public SBI3U course outline and bibliographic references identify the course text as McGraw-Hill Ryerson Biology 11. No legal local full-text PDF was found in docs.",
  localPath: hasLegalTextbook ? textbookRelPath : undefined,
  localReferencePath: textbookIndexRelPath,
};
manifest.sourceAudit.curriculumGuidance = [
  {
    title: curriculumTitle,
    status: "manifested",
    source: curriculumSource,
    path: curriculumRelPath,
    evidence: "Official Ontario Ministry Science curriculum document includes SBI3U expectations.",
  },
];
manifest.sourceAudit.textMaterialCount = 3;

manifest.courseDownloads = Array.isArray(manifest.courseDownloads) ? manifest.courseDownloads : [];
if (textbookMaterial) upsertByPath(manifest.courseDownloads, textbookMaterial);
upsertByPath(manifest.courseDownloads, textbookIndexMaterial);
upsertByPath(manifest.courseDownloads, curriculumMaterial);
upsertByPath(manifest.courseDownloads, sourcesMaterial);

manifest.texts = Array.isArray(manifest.texts) ? manifest.texts : [];
upsertById(manifest.texts, {
  id: "mcgraw-hill-ryerson-biology-11",
  title: "McGraw-Hill Ryerson Biology 11",
  publisher: "McGraw-Hill Ryerson",
  type: hasLegalTextbook ? "textbook" : "textbook_reference",
  units: [1, 2, 3, 4, 5],
  copyrightStatus: hasLegalTextbook ? "licensed_local_copy" : "referenced_only_no_full_text",
  sourceStatus: hasLegalTextbook ? "provided_by_user" : "identified_from_public_references_and_course_review",
  notes: hasLegalTextbook
    ? "Legally obtained local Biology 11 textbook copy provided by the user and included for SBI3U."
    : "Reference entry only. No legal local Biology 11 textbook PDF was found in docs, so the full commercial textbook is not included.",
  materials: [textbookMaterial, textbookIndexMaterial].filter(Boolean),
  path: hasLegalTextbook ? textbookRelPath : textbookIndexRelPath,
  bytes: hasLegalTextbook ? textbookBytes : textbookIndexBytes,
  category: hasLegalTextbook ? "textbook" : "textbook_reference",
  role: hasLegalTextbook ? "core_text" : "textbook_reference",
  previewPath: hasLegalTextbook ? textbookRelPath : textbookIndexRelPath,
  downloadPath: hasLegalTextbook ? textbookRelPath : undefined,
});
manifest.texts = manifest.texts.filter((item) => item.id !== "mcgraw-hill-ryerson-biology-11-reference");
upsertById(manifest.texts, {
  id: "ontario-science-curriculum-11-12",
  title: curriculumTitle,
  publisher: "Ontario Ministry of Education",
  type: "curriculum",
  units: [1, 2, 3, 4, 5],
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  notes: "Official Ontario curriculum reference containing SBI3U Biology, Grade 11, University Preparation expectations.",
  materials: [curriculumMaterial],
  path: curriculumRelPath,
  bytes: curriculumBytes,
  category: "official_curriculum",
  role: "curriculum_reference",
  previewPath: curriculumRelPath,
  downloadPath: curriculumRelPath,
});
upsertById(manifest.texts, {
  id: "sbi3u-source-audit",
  title: "SBI3U Text And Source Audit",
  type: "source_audit",
  units: [1, 2, 3, 4, 5],
  copyrightStatus: "local_audit_note",
  sourceStatus: "created_from_local_source_review",
  notes: "Records Moodle source, textbook reference status, official curriculum inclusion, and exclusion of unmatched Biology 12 textbooks.",
  materials: [sourcesMaterial],
  path: sourcesRelPath,
  bytes: sourcesBytes,
  category: "source_audit",
  role: "source_audit",
  downloadPath: sourcesRelPath,
});

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course: COURSE,
  textbook: manifest.sourceAudit.textbookReference.title,
  textbookIncluded: hasLegalTextbook,
  textbookPath: hasLegalTextbook ? textbookRelPath : null,
  curriculum: curriculumRelPath,
  texts: manifest.texts.length,
  courseDownloads: manifest.courseDownloads.length,
}, null, 2));
