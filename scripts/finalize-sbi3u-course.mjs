import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = 'D:/工作文件/SUNNYBROOK';
const projectRoot = path.join(workspaceRoot, 'ossd-course-portal');
const course = 'SBI3U';
const courseRoot = path.join(workspaceRoot, 'courseware', course);
const manifestPath = path.join(courseRoot, 'course-manifest.json');
const catalogPath = path.join(projectRoot, 'public', 'course-catalog.json');
const queuePath = path.join(projectRoot, 'deployment', 'SBI3U-moodle-media-queue.json');
const documentReportPath = path.join(projectRoot, 'deployment', 'moodle-media-download-report-SBI3U-document.json');
const h5pReportPath = path.join(projectRoot, 'deployment', 'moodle-media-download-report-SBI3U-h5p.json');
const pdfReportPath = path.join(projectRoot, 'deployment', 'moodle-media-download-report-SBI3U-pdf.json');
const videoReportPath = path.join(projectRoot, 'deployment', 'moodle-media-download-report-SBI3U-video.json');

function bytes(relativePath) {
  return fs.statSync(path.join(courseRoot, relativePath)).size;
}

function countFiles(relativeDir) {
  const dir = path.join(courseRoot, relativeDir);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compactFailure(failure) {
  return {
    lesson: failure.lesson,
    label: failure.label,
    kind: failure.kind,
    url: failure.url,
    suggestedPath: failure.suggestedPath,
    status: failure.status,
    error: failure.error,
  };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const queue = readJsonIfExists(queuePath, { rows: [] });
const documentReport = readJsonIfExists(documentReportPath, { failures: [] });
const h5pReport = readJsonIfExists(h5pReportPath, { failures: [] });
const pdfReport = readJsonIfExists(pdfReportPath, { failures: [] });
const videoReport = readJsonIfExists(videoReportPath, { failures: [] });
const queueItems = queue.items ?? queue.rows ?? [];

const courseOutline = {
  label: 'SBI3U Course Outline.docx',
  type: 'docx',
  category: 'course_document',
  role: 'course_outline',
  path: 'plans/course/SBI3U_Course_Outline.docx',
  bytes: bytes('plans/course/SBI3U_Course_Outline.docx'),
  source: 'https://www.esunnybrook.com/pluginfile.php/10065/mod_assign/introattachment/0/SBI3U-Course-Oultine-v3.0.docx?forcedownload=1',
  previewPath: 'previews-html/plans/course/SBI3U_Course_Outline.docx.html',
};

const curriculum = {
  label: 'The Ontario Curriculum, Grades 11 and 12: Science, 2008 (Revised)',
  type: 'pdf',
  category: 'official_curriculum',
  role: 'curriculum_reference',
  path: 'texts/ontario-curriculum/2009science11_12.pdf',
  bytes: bytes('texts/ontario-curriculum/2009science11_12.pdf'),
  source: 'https://www.edu.gov.on.ca/eng/curriculum/secondary/2009science11_12.pdf',
};

const sourceAuditDoc = {
  label: 'SBI3U Text And Source Audit',
  type: 'md',
  category: 'source_audit',
  role: 'source_audit',
  path: 'texts/SOURCES.md',
  bytes: bytes('texts/SOURCES.md'),
  source: 'local source audit',
};

manifest.courseDownloads = [courseOutline, curriculum, sourceAuditDoc];
manifest.texts = [
  {
    id: 'ontario-science-curriculum-11-12',
    title: curriculum.label,
    publisher: 'Ontario Ministry of Education',
    type: 'curriculum',
    units: [1, 2, 3, 4, 5],
    copyrightStatus: 'official_public_document',
    sourceStatus: 'localized_from_public_official_source',
    notes: 'Official Ontario curriculum reference containing SBI3U Biology, Grade 11, University Preparation.',
    materials: [curriculum],
    path: curriculum.path,
    bytes: curriculum.bytes,
    category: curriculum.category,
    role: curriculum.role,
  },
  {
    id: 'sbi3u-source-audit',
    title: sourceAuditDoc.label,
    type: 'source_audit',
    units: [1, 2, 3, 4, 5],
    copyrightStatus: 'local_audit_note',
    sourceStatus: 'created_from_local_source_review',
    notes: 'Records textbook availability and source decisions for SBI3U.',
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
    for (const item of lesson.ispring ?? []) {
      ispringExpected += 1;
      if (!item.localizationStatus && item.path && fs.existsSync(path.join(courseRoot, item.path))) {
        item.localizationStatus = 'localized';
      }
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

function queueExpected(kind, fallback) {
  const count = queueItems.filter((row) => row.kind === kind).length;
  return count || fallback;
}

function manifestResourceCount(predicate) {
  return (manifest.units ?? [])
    .flatMap((unit) => unit.lessons ?? [])
    .flatMap((lesson) => lesson.downloads ?? [])
    .filter(predicate).length;
}

const manifestDocumentCount = manifestResourceCount((item) => ['doc', 'docx'].includes(String(item.type || '').toLowerCase()));
const manifestPdfCount = manifestResourceCount((item) => String(item.type || '').toLowerCase() === 'pdf');
const manifestH5pCount = manifestResourceCount((item) => String(item.type || '').toLowerCase() === 'h5p');
const manifestVideoCount = manifestResourceCount((item) => String(item.type || '').toLowerCase() === 'mp4');

const missingLessonPlans = (manifest.units ?? [])
  .flatMap((unit) => unit.lessons ?? [])
  .filter((lesson) => !lesson.lessonPlan)
  .map((lesson) => lesson.id);

const failedMedia = [
  ...(documentReport.failures ?? []),
  ...(h5pReport.failures ?? []),
  ...(pdfReport.failures ?? []),
  ...(videoReport.failures ?? []),
].map(compactFailure);

manifest.sourceAudit = {
  ...manifest.sourceAudit,
  lessonCount: (manifest.units ?? []).reduce((sum, unit) => sum + (unit.lessons?.length ?? 0), 0),
  ispringExpected,
  ispringComplete,
  ispringPartial,
  ispringFailed: Math.max(0, ispringExpected - ispringComplete - ispringPartial),
  ispringDownloadPackages,
  ispringPlayable,
  lessonPlansMatchedByUnitLesson: (manifest.units ?? []).reduce(
    (sum, unit) => sum + (unit.lessons ?? []).filter((lesson) => lesson.lessonPlan).length,
    0,
  ),
  unitPlansMatched: (manifest.units ?? []).filter((unit) => unit.unitPlan).length,
  missingLessonPlans,
  textbookAudit: {
    status: 'not_identified',
    evidence: 'Local planning files cite page ranges from an unnamed Biology source, but Moodle book pages and local course files do not identify a specific textbook title or provide a confirmed legal textbook file.',
    searchedLocations: [
      'D:/工作文件/SUNNYBROOK/docs',
      'D:/工作文件/SUNNYBROOK/courseware/SBI3U',
    ],
    decision: 'Include the official Ontario Science curriculum and source audit only; do not add an unconfirmed textbook.',
  },
  curriculumPdfIncluded: true,
  textMaterials: manifest.texts.length,
  localizedDocumentCount: manifestDocumentCount,
  localizedPdfCount: manifestPdfCount,
  localizedH5pCount: manifestH5pCount,
  localizedVideoCount: manifestVideoCount,
  localizedDocumentPhysicalFileCount: countFiles('localized-moodle/document'),
  localizedPdfPhysicalFileCount: countFiles('localized-moodle/pdf'),
  localizedH5pPhysicalFileCount: countFiles('localized-moodle/h5p'),
  localizedVideoPhysicalFileCount: countFiles('localized-moodle/video'),
  documentExpected: queueExpected('document', manifestDocumentCount),
  documentLocalized: manifestDocumentCount,
  documentFailed: documentReport.failures?.length ?? 0,
  pdfExpected: queueExpected('pdf', manifestPdfCount),
  pdfLocalized: manifestPdfCount,
  pdfFailed: pdfReport.failures?.length ?? 0,
  h5pExpected: queueExpected('h5p', manifestH5pCount),
  h5pLocalized: manifestH5pCount,
  h5pFailed: h5pReport.failures?.length ?? 0,
  videoExpected: queueExpected('video', manifestVideoCount),
  videoLocalized: manifestVideoCount,
  videoFailed: videoReport.failures?.length ?? 0,
  failedMedia,
};
manifest.generatedAt = new Date().toISOString();

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const row = catalog.courses.find((courseRow) => courseRow.code === course);
if (!row) throw new Error(`${course} not found in course catalog`);
row.status = 'ready';
row.notes = 'Moodle book lessons, localized iSpring, H5P, videos, documents/PDFs, previews, course outline, official curriculum, and source audit are packaged; no confirmed legal textbook title/file was identified.';
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

console.log('SBI3U manifest and catalog updated.');
