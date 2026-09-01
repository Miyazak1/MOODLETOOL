import fs from "node:fs";
import path from "node:path";

const workspaceRoot = "D:/工作文件/SUNNYBROOK";
const course = "SCH3U";
const courseRoot = path.join(workspaceRoot, "courseware", course);
const manifestPath = path.join(courseRoot, "course-manifest.json");
const curriculumUrl = "https://www.edu.gov.on.ca/eng/curriculum/secondary/2009science11_12.pdf";

const textbookId = "sch3u-nelson-chemistry-11";
const textbookTitle = "SCH3U · Chemistry, Grade 11, University Preparation · Nelson Chemistry 11 Textbook";
const textbookPath = "texts/nelson-chemistry-11/Nelson-Chemistry-11.pdf";
const curriculumId = "ontario-science-curriculum-11-12-2008";
const curriculumTitle = "The Ontario Curriculum, Grades 11 and 12: Science, 2008 (Revised)";
const curriculumPath = "texts/ontario-curriculum/2009science11_12.pdf";
const sourceAuditId = "sch3u-source-audit";
const sourceAuditPath = "texts/SOURCES.md";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fileBytes(relPath) {
  return fs.statSync(path.join(courseRoot, relPath)).size;
}

function ensureDir(relPath) {
  fs.mkdirSync(path.join(courseRoot, relPath), { recursive: true });
}

async function ensureCurriculumPdf() {
  const absolutePath = path.join(courseRoot, curriculumPath);
  if (fs.existsSync(absolutePath) && fs.readFileSync(absolutePath).subarray(0, 4).toString("latin1") === "%PDF") {
    return;
  }
  ensureDir("texts/ontario-curriculum");
  const response = await fetch(curriculumUrl);
  if (!response.ok) {
    throw new Error(`Failed to download curriculum PDF: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("Downloaded curriculum file is not a PDF.");
  }
  fs.writeFileSync(absolutePath, bytes);
}

function upsertByRole(items, entry) {
  const next = items.filter((item) => {
    const key = `${item.id || ""} ${item.textId || ""} ${item.role || ""} ${item.path || ""} ${item.label || ""}`;
    if (/nelson-chemistry-11|Nelson Chemistry 11\.pdf/i.test(key)) return false;
    if (/ontario-science-curriculum-11-12-2008|2009science11_12|Science, 2008/i.test(key)) return false;
    if (/sch3u-source-audit|texts\/SOURCES\.md|SCH3U Text And Source Audit/i.test(key)) return false;
    return true;
  });
  next.push(entry);
  return next;
}

function upsertCourseDownloads(downloads, entries) {
  const filtered = downloads.filter((item) => {
    const key = `${item.id || ""} ${item.textId || ""} ${item.role || ""} ${item.path || ""} ${item.label || ""}`;
    if (/nelson-chemistry-11|Nelson Chemistry 11\.pdf/i.test(key)) return false;
    if (/ontario-science-curriculum-11-12-2008|2009science11_12|Science, 2008/i.test(key)) return false;
    if (/sch3u-source-audit|texts\/SOURCES\.md|SCH3U Text And Source Audit/i.test(key)) return false;
    return true;
  });
  return [...entries, ...filtered];
}

function writeSourcesMd() {
  const textbookBytes = fileBytes(textbookPath);
  const curriculumBytes = fileBytes(curriculumPath);
  const content = `# SCH3U Text And Source Audit

Course: SCH3U - Chemistry, Grade 11, University Preparation

## Included Textbook

- Display title: ${textbookTitle}
- Original file name: Nelson-Chemistry-11.pdf
- Local course path: ${textbookPath}
- Size: ${textbookBytes} bytes
- Source status: user-provided legal copy in the local SunnyBrook docs/courseware set.
- Moodle evidence note: the localized Moodle lessons do not provide verified lesson-by-lesson textbook page references, so the textbook is included as a course-level core text instead of generated reading assignments.

## Official Curriculum Reference

- Display title: ${curriculumTitle}
- Publisher: Ontario Ministry of Education
- Local course path: ${curriculumPath}
- Size: ${curriculumBytes} bytes
- Public source: ${curriculumUrl}
- Course relevance: contains SCH3U Chemistry, Grade 11, University Preparation curriculum expectations.

## Exclusions

- Other Chemistry 11 PDFs in docs were not substituted for Moodle content unless separately verified as legal, course-appropriate sources.
- No lesson readings, answers, rubrics, or textbook page references were generated without Moodle or source evidence.
`;
  fs.writeFileSync(path.join(courseRoot, sourceAuditPath), content);
}

async function main() {
  const manifest = readJson(manifestPath);
  const textbookAbsolutePath = path.join(courseRoot, textbookPath);
  if (!fs.existsSync(textbookAbsolutePath)) {
    throw new Error(`Missing local textbook: ${textbookAbsolutePath}`);
  }
  if (fs.readFileSync(textbookAbsolutePath).subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("Local SCH3U textbook file is not a PDF.");
  }

  await ensureCurriculumPdf();
  writeSourcesMd();

  const units = (manifest.units || []).map((unit) => Number(unit.unit)).filter(Number.isFinite);
  const textbookBytes = fileBytes(textbookPath);
  const curriculumBytes = fileBytes(curriculumPath);
  const auditBytes = fileBytes(sourceAuditPath);

  const textbookEntry = {
    id: textbookId,
    title: textbookTitle,
    publisher: "Nelson",
    type: "textbook",
    units,
    copyrightStatus: "user_provided_legal_copy",
    sourceStatus: "localized_from_user_provided_source",
    notes: "Core SCH3U textbook for Chemistry, Grade 11, University Preparation. User confirmed the PDF was legally obtained; Moodle does not provide verified lesson-by-lesson textbook page references.",
    materials: [
      {
        label: textbookTitle,
        type: "pdf",
        category: "textbook",
        role: "core_textbook",
        path: textbookPath,
        previewPath: textbookPath,
        downloadPath: textbookPath,
        bytes: textbookBytes,
        source: "user provided legal copy",
        notes: "Course-level textbook reference; not mapped lesson-by-lesson because Moodle did not provide verified lesson reading assignments."
      }
    ],
    path: textbookPath,
    previewPath: textbookPath,
    downloadPath: textbookPath,
    bytes: textbookBytes,
    category: "textbook",
    role: "core_textbook"
  };

  const curriculumEntry = {
    id: curriculumId,
    title: curriculumTitle,
    publisher: "Ontario Ministry of Education",
    type: "curriculum",
    units,
    copyrightStatus: "official_public_document",
    sourceStatus: "localized_from_public_official_source",
    notes: "Official Ontario curriculum reference containing SCH3U Chemistry, Grade 11, University Preparation.",
    materials: [
      {
        label: curriculumTitle,
        type: "pdf",
        category: "official_curriculum",
        role: "curriculum_reference",
        path: curriculumPath,
        previewPath: curriculumPath,
        downloadPath: curriculumPath,
        bytes: curriculumBytes,
        source: curriculumUrl
      }
    ],
    path: curriculumPath,
    previewPath: curriculumPath,
    downloadPath: curriculumPath,
    bytes: curriculumBytes,
    category: "official_curriculum",
    role: "curriculum_reference"
  };

  const sourceAuditEntry = {
    id: sourceAuditId,
    title: "SCH3U Text And Source Audit",
    type: "source_audit",
    units,
    copyrightStatus: "local_audit_note",
    sourceStatus: "created_from_local_source_review",
    notes: "Records SCH3U textbook and official curriculum source decisions.",
    materials: [
      {
        label: "SCH3U Text And Source Audit",
        type: "md",
        category: "source_audit",
        role: "source_audit",
        path: sourceAuditPath,
        previewPath: sourceAuditPath,
        downloadPath: sourceAuditPath,
        bytes: auditBytes,
        source: "local source audit"
      }
    ],
    path: sourceAuditPath,
    previewPath: sourceAuditPath,
    downloadPath: sourceAuditPath,
    bytes: auditBytes,
    category: "source_audit",
    role: "source_audit"
  };

  manifest.texts = [
    textbookEntry,
    curriculumEntry,
    sourceAuditEntry,
    ...(manifest.texts || []).filter((item) => ![
      "nelson-chemistry-11",
      textbookId,
      curriculumId,
      sourceAuditId
    ].includes(item.id))
  ];

  const downloadEntries = [
    {
      label: textbookTitle,
      title: textbookTitle,
      type: "pdf",
      role: "core_textbook",
      category: "textbook",
      textId: textbookId,
      path: textbookPath,
      previewPath: textbookPath,
      downloadPath: textbookPath,
      bytes: textbookBytes,
      source: "user provided legal copy"
    },
    {
      label: curriculumTitle,
      title: curriculumTitle,
      type: "pdf",
      role: "curriculum_reference",
      category: "official_curriculum",
      textId: curriculumId,
      path: curriculumPath,
      previewPath: curriculumPath,
      downloadPath: curriculumPath,
      bytes: curriculumBytes,
      source: curriculumUrl
    },
    {
      label: "SCH3U Text And Source Audit",
      title: "SCH3U Text And Source Audit",
      type: "md",
      role: "source_audit",
      category: "source_audit",
      textId: sourceAuditId,
      path: sourceAuditPath,
      previewPath: sourceAuditPath,
      downloadPath: sourceAuditPath,
      bytes: auditBytes,
      source: "local source audit"
    }
  ];
  manifest.courseDownloads = upsertCourseDownloads(manifest.courseDownloads || [], downloadEntries);

  for (const unit of manifest.units || []) {
    unit.coreTexts = [textbookId];
  }

  manifest.sourceAudit ||= {};
  manifest.sourceAudit.textbookReference = {
    patchedAt: new Date().toISOString(),
    textbookId,
    textbookTitle,
    textbookPath,
    source: "User-provided legal local copy: docs/Nelson-Chemistry-11.pdf",
    sourceStatus: "localized_from_user_provided_source",
    evidence: "Local file exists in docs and courseware; Moodle lessons do not provide lesson-by-lesson page references.",
    officialCurriculum: {
      id: curriculumId,
      title: curriculumTitle,
      path: curriculumPath,
      source: curriculumUrl,
      sourceStatus: "localized_from_public_official_source"
    },
    sourceAuditPath,
    standard: "docs/MOODLE_COURSE_IMPORT_DISPLAY_RULES.md section 2.3; MDM4U textbook display baseline"
  };
  manifest.sourceAudit.sch3uTextbookCurriculumPatch = {
    patchedAt: new Date().toISOString(),
    textbookTitle,
    curriculumTitle,
    note: "Course-qualified textbook display names applied consistently to texts, materials, courseDownloads, unit coreTexts, and SOURCES.md. Official Ontario curriculum guidance added as a separate curriculum_reference."
  };
  manifest.generatedAt = new Date().toISOString();

  writeJson(manifestPath, manifest);
  console.log(JSON.stringify({
    course,
    textbookTitle,
    textbookBytes,
    curriculumTitle,
    curriculumBytes,
    sourceAuditBytes: auditBytes,
    courseDownloads: manifest.courseDownloads.slice(0, 4).map((item) => ({
      label: item.label,
      role: item.role,
      path: item.path
    })),
    unitCoreTexts: (manifest.units || []).map((unit) => ({ unit: unit.unit, coreTexts: unit.coreTexts }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
