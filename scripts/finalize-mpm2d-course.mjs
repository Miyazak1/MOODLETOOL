import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = 'D:/工作文件/SUNNYBROOK';
const projectRoot = path.join(workspaceRoot, 'ossd-course-portal');
const course = 'MPM2D';
const courseRoot = path.join(workspaceRoot, 'courseware', course);
const manifestPath = path.join(courseRoot, 'course-manifest.json');
const catalogPath = path.join(projectRoot, 'public', 'course-catalog.json');
const ispringQueuePath = path.join(projectRoot, 'deployment', 'MPM2D-moodle-ispring-embed-queue.json');

function bytes(relativePath) {
  return fs.statSync(path.join(courseRoot, relativePath)).size;
}

function countFiles(relativeDir) {
  const dir = path.join(courseRoot, relativeDir);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const ispringQueue = fs.existsSync(ispringQueuePath)
  ? JSON.parse(fs.readFileSync(ispringQueuePath, 'utf8'))
  : { rows: [] };

const courseOutline = {
  label: 'MPM2D Course Outline.docx',
  type: 'docx',
  category: 'course_document',
  role: 'course_outline',
  path: 'plans/course/MPM2D_Course_Outline.docx',
  bytes: bytes('plans/course/MPM2D_Course_Outline.docx'),
  source: 'https://www.esunnybrook.com/pluginfile.php/8688/mod_assign/introattachment/0/MPM2D-Course-Outline.docx?forcedownload=1',
  previewPath: 'previews-html/plans/course/MPM2D_Course_Outline.docx.html',
};

const curriculum = {
  label: 'The Ontario Curriculum, Grades 9 and 10: Mathematics, 2005 (Revised)',
  type: 'pdf',
  category: 'official_curriculum',
  role: 'curriculum_reference',
  path: 'texts/ontario-curriculum/math910curr.pdf',
  bytes: bytes('texts/ontario-curriculum/math910curr.pdf'),
  source: 'https://www.edu.gov.on.ca/eng/curriculum/secondary/math910curr.pdf',
};

const sourceAuditDoc = {
  label: 'MPM2D Text And Source Audit',
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
    id: 'ontario-mathematics-curriculum-9-10',
    title: curriculum.label,
    publisher: 'Ontario Ministry of Education',
    type: 'curriculum',
    units: [1, 2, 3, 4],
    copyrightStatus: 'official_public_document',
    sourceStatus: 'localized_from_public_official_source',
    notes: 'Official Ontario curriculum reference containing MPM2D Principles of Mathematics, Grade 10, Academic.',
    materials: [curriculum],
    path: curriculum.path,
    bytes: curriculum.bytes,
    category: curriculum.category,
    role: curriculum.role,
  },
  {
    id: 'mpm2d-source-audit',
    title: sourceAuditDoc.label,
    type: 'source_audit',
    units: [1, 2, 3, 4],
    copyrightStatus: 'local_audit_note',
    sourceStatus: 'created_from_local_source_review',
    notes: 'Records textbook availability and the Unit 3 Lesson 8 iSpring source gap for MPM2D.',
    materials: [sourceAuditDoc],
    path: sourceAuditDoc.path,
    bytes: sourceAuditDoc.bytes,
    category: sourceAuditDoc.category,
    role: sourceAuditDoc.role,
  },
];

let manifestIspringItems = 0;
let ispringComplete = 0;
let ispringPartial = 0;
let ispringDownloadPackages = 0;
let ispringPlayable = 0;
for (const unit of manifest.units ?? []) {
  const unitNumber = String(unit.unit).padStart(2, '0');
  for (const lesson of unit.lessons ?? []) {
    const lessonNumber = String(lesson.lesson).padStart(2, '0');
    for (const item of lesson.ispring ?? []) {
      manifestIspringItems += 1;
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

const failedIspring = (ispringQueue.rows ?? [])
  .filter((row) => row.lessonId === 'U03L08')
  .map((row) => ({
    lesson: row.lessonId,
    label: row.lessonTitle,
    kind: 'ispring',
    url: row.url,
    expectedFilename: row.expectedFilename,
    status: 'failed',
    error: 'iSpring preview HTTP 404 after retry',
  }));

const missingLessonPlans = (manifest.units ?? [])
  .flatMap((unit) => unit.lessons ?? [])
  .filter((lesson) => !lesson.lessonPlan)
  .map((lesson) => lesson.id);

const moodleIspringEmbedCount = Math.max(ispringQueue.rows?.length ?? 0, manifestIspringItems + failedIspring.length);
const ispringExpected = manifestIspringItems;

manifest.sourceAudit = {
  ...manifest.sourceAudit,
  lessonCount: (manifest.units ?? []).reduce((sum, unit) => sum + (unit.lessons?.length ?? 0), 0),
  ispringExpected,
  ispringComplete,
  ispringPartial,
  ispringFailed: failedIspring.length,
  moodleIspringEmbedCount,
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
    evidence: 'No full textbook file or specific textbook title was identified in Moodle book pages, local MPM2D planning previews, or the local docs folder.',
    searchedLocations: [
      'D:/工作文件/SUNNYBROOK/docs',
      'D:/工作文件/SUNNYBROOK/courseware/MPM2D',
    ],
    decision: 'Do not add a textbook until a matching legal MPM2D/Grade 10 Principles of Mathematics textbook is provided or Moodle explicitly supplies one.',
  },
  curriculumPdfIncluded: true,
  textMaterials: manifest.texts.length,
  localizedDocumentCount: countFiles('localized-moodle/document'),
  localizedPdfCount: countFiles('localized-moodle/pdf'),
  localizedH5pCount: countFiles('localized-moodle/h5p'),
  localizedVideoCount: countFiles('localized-moodle/video'),
  videoExpected: 29,
  videoLocalized: countFiles('localized-moodle/video'),
  videoFailed: Math.max(0, 29 - countFiles('localized-moodle/video')),
  documentExpected: 37,
  documentLocalized: countFiles('localized-moodle/document'),
  documentFailed: Math.max(0, 37 - countFiles('localized-moodle/document')),
  pdfExpected: 26,
  pdfLocalized: countFiles('localized-moodle/pdf'),
  pdfFailed: Math.max(0, 26 - countFiles('localized-moodle/pdf')),
  h5pExpected: 8,
  h5pLocalized: countFiles('localized-moodle/h5p'),
  h5pFailed: Math.max(0, 8 - countFiles('localized-moodle/h5p')),
  failedIspring,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const row = catalog.courses.find((courseRow) => courseRow.code === course);
if (!row) throw new Error(`${course} not found in course catalog`);
row.status = 'ready';
row.notes = 'Moodle book lessons, localized iSpring where available, H5P, videos, documents, PDFs, previews, course outline, official curriculum, and source audit are packaged; U03L08 iSpring source returns 404 and is recorded.';
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

console.log('MPM2D manifest and catalog updated.');
