import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = 'D:/工作文件/SUNNYBROOK';
const projectRoot = path.join(workspaceRoot, 'ossd-course-portal');
const course = 'HFA4U';
const courseRoot = path.join(workspaceRoot, 'courseware', course);
const manifestPath = path.join(courseRoot, 'course-manifest.json');
const catalogPath = path.join(projectRoot, 'public', 'course-catalog.json');

function bytes(relativePath) {
  return fs.statSync(path.join(courseRoot, relativePath)).size;
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function countManifestDownloads(predicate) {
  return (manifest.units ?? [])
    .flatMap((unit) => unit.lessons ?? [])
    .flatMap((lesson) => lesson.downloads ?? [])
    .filter(predicate).length;
}

function compactFailure(item) {
  return {
    lesson: item.lesson,
    label: item.label,
    kind: item.kind,
    url: item.url,
    suggestedPath: item.suggestedPath,
    status: item.status,
    error: item.error,
  };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const draftDocReport = readJsonIfExists(path.join(projectRoot, 'deployment', 'moodle-media-download-report-HFA4U-document.json'), { failures: [] });
const draftPdfReport = readJsonIfExists(path.join(projectRoot, 'deployment', 'moodle-media-download-report-HFA4U-pdf.json'), { failures: [] });
const ispringReport = readJsonIfExists(path.join(projectRoot, 'deployment', 'HFA4U-ispring-localization-report.json'), { rows: [] });
const externalH5pReport = readJsonIfExists(path.join(projectRoot, 'deployment', 'HFA4U-external-h5p-download-report.json'), {
  downloaded: [],
  failures: [],
  skipped: [],
});

const curriculum = {
  label: 'The Ontario Curriculum: Social Sciences and Humanities, Grades 9 to 12, 2013 (Revised)',
  type: 'pdf',
  category: 'official_curriculum',
  role: 'curriculum_reference',
  path: 'texts/ontario-curriculum/ssciences9to122013.pdf',
  bytes: bytes('texts/ontario-curriculum/ssciences9to122013.pdf'),
  source: 'https://www.edu.gov.on.ca/eng/curriculum/secondary/ssciences9to122013.pdf',
};

const sourceAuditDoc = {
  label: 'HFA4U Text And Source Audit',
  type: 'md',
  category: 'source_audit',
  role: 'source_audit',
  path: 'texts/SOURCES.md',
  bytes: bytes('texts/SOURCES.md'),
  source: 'local source audit',
};

manifest.courseDownloads = [curriculum, sourceAuditDoc];
manifest.texts = [
  {
    id: 'ontario-social-sciences-humanities-9-12-2013',
    title: curriculum.label,
    publisher: 'Ontario Ministry of Education',
    type: 'curriculum',
    units: [1],
    copyrightStatus: 'official_public_document',
    sourceStatus: 'localized_from_public_official_source',
    notes: 'Official Ontario curriculum reference containing HFA4U Nutrition and Health, Grade 12, University Preparation.',
    materials: [curriculum],
    path: curriculum.path,
    bytes: curriculum.bytes,
    category: curriculum.category,
    role: curriculum.role,
  },
  {
    id: 'hfa4u-source-audit',
    title: sourceAuditDoc.label,
    type: 'source_audit',
    units: [1],
    copyrightStatus: 'local_audit_note',
    sourceStatus: 'created_from_local_source_review',
    notes: 'Records the current incomplete Moodle shell, excluded planning-only units, unavailable eclass draftfile links, and textbook status.',
    materials: [sourceAuditDoc],
    path: sourceAuditDoc.path,
    bytes: sourceAuditDoc.bytes,
    category: sourceAuditDoc.category,
    role: sourceAuditDoc.role,
  },
];

let ispringExpected = 0;
let ispringComplete = 0;
let ispringPartial = 0;
let ispringDownloadPackages = 0;
let ispringPlayable = 0;
for (const unit of manifest.units ?? []) {
  const unitNumber = String(unit.unit).padStart(2, '0');
  for (const lesson of unit.lessons ?? []) {
    const lessonNumber = String(lesson.lesson).padStart(2, '0');
    lesson.downloads = (lesson.downloads ?? []).filter((item) => item.path || item.previewPath || item.downloadPath || item.packagePath);
    for (const item of lesson.ispring ?? []) {
      ispringExpected += 1;
      if (!item.localizationStatus && item.path && fs.existsSync(path.join(courseRoot, item.path))) item.localizationStatus = 'localized';
      if (item.localizationStatus === 'localized') ispringComplete += 1;
      if (item.localizationStatus === 'partial') ispringPartial += 1;
      if (['localized', 'partial'].includes(item.localizationStatus) && item.path) ispringPlayable += 1;
      const zipPath = `ispring-localized/unit-${unitNumber}/U${unitNumber}L${lessonNumber}.zip`;
      const fullZipPath = path.join(courseRoot, zipPath);
      if (fs.existsSync(fullZipPath)) {
        item.downloadPath = zipPath;
        item.downloadBytes = fs.statSync(fullZipPath).size;
        ispringDownloadPackages += 1;
      }
    }
  }
}

const failedIspring = (ispringReport.rows ?? [])
  .filter((row) => row.status === 'partial' || row.status === 'failed')
  .map((row) => ({
    lesson: row.lessonId,
    label: row.lessonTitle,
    kind: 'ispring',
    url: row.url,
    status: row.status,
    failures: row.failures ?? [],
  }));

const failedMedia = [
  ...(draftDocReport.failures ?? []),
  ...(draftPdfReport.failures ?? []),
].filter((failure) => String(failure.url || '').includes('eclasssunnybrook.com/draftfile.php')).map(compactFailure);

manifest.sourceAudit = {
  ...manifest.sourceAudit,
  lessonCount: (manifest.units ?? []).reduce((sum, unit) => sum + (unit.lessons?.length ?? 0), 0),
  packagedMoodleUnits: 1,
  courseOutlineStatus: 'not_visible_in_current_moodle_shell',
  curriculumPdfIncluded: true,
  textMaterials: manifest.texts.length,
  ispringExpected,
  ispringFullyLocalized: ispringComplete,
  ispringComplete: ispringPlayable,
  ispringPartial,
  ispringFailed: Math.max(0, ispringExpected - ispringComplete - ispringPartial),
  ispringDownloadPackages,
  ispringPlayable,
  failedIspring,
  documentLocalized: countManifestDownloads((item) => ['doc', 'docx'].includes(String(item.type || '').toLowerCase())),
  pdfLocalized: countManifestDownloads((item) => String(item.type || '').toLowerCase() === 'pdf'),
  h5pLocalized: countManifestDownloads((item) => String(item.type || '').toLowerCase() === 'h5p'),
  videoLocalized: countManifestDownloads((item) => String(item.type || '').toLowerCase() === 'mp4'),
  externalH5pEmbeds: externalH5pReport.totalEmbeds ?? externalH5pReport.downloaded?.length ?? 0,
  externalH5pLocalized: externalH5pReport.downloaded?.length ?? 0,
  externalH5pSkipped: externalH5pReport.skipped?.length ?? 0,
  externalH5pFailed: externalH5pReport.failures?.length ?? 0,
  eclassDraftfileExpected: failedMedia.length,
  eclassDraftfileLocalized: 0,
  eclassDraftfileFailed: failedMedia.length,
  failedMedia,
  textbookAudit: {
    status: 'not_identified',
    evidence: 'The visible Moodle shell and local docs folder do not identify a specific legal HFA4U textbook file. Local planning files refer to textbook/homework pages but do not provide a confirmed source file.',
    searchedLocations: [
      'D:/工作文件/SUNNYBROOK/docs',
      'D:/工作文件/SUNNYBROOK/courseware/HFA4U',
      'https://www.esunnybrook.com/course/view.php?id=91',
    ],
    decision: 'Include the official Ontario curriculum and source audit only; do not add an unconfirmed textbook.',
  },
};
manifest.generatedAt = new Date().toISOString();

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const row = catalog.courses.find((courseRow) => courseRow.code === course);
if (!row) throw new Error(`${course} not found in course catalog`);
row.status = 'ready';
row.notes = 'Current Moodle-visible HFA4U Unit 1 is packaged with local iSpring, external H5P, DOCX/PDF resources, previews, official curriculum, and source audit; Moodle shell currently exposes no Unit 2-4 books or course outline, and eclass draftfile links are recorded as unavailable.';
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

console.log('HFA4U manifest and catalog updated.');
