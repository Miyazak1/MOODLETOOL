import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = 'D:/工作文件/SUNNYBROOK';
const course = 'MDM4U';
const courseRoot = path.join(workspaceRoot, 'courseware', course);
const manifestPath = path.join(courseRoot, 'course-manifest.json');
const catalogPath = path.join(workspaceRoot, 'ossd-course-portal', 'public', 'course-catalog.json');

function bytes(relativePath) {
  return fs.statSync(path.join(courseRoot, relativePath)).size;
}

function countFiles(relativeDir) {
  const dir = path.join(courseRoot, relativeDir);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const courseOutline = {
  label: 'MDM4U Course Outline.docx',
  type: 'docx',
  category: 'course_document',
  role: 'course_outline',
  path: 'plans/course/MDM4U_Course_Outline.docx',
  bytes: bytes('plans/course/MDM4U_Course_Outline.docx'),
  source: 'https://www.esunnybrook.com/pluginfile.php/8408/mod_assign/introattachment/0/MDM4U-Course-Outline-v1.0.docx?forcedownload=1',
  previewPath: 'previews-html/plans/course/MDM4U_Course_Outline.docx.html',
};

const curriculum = {
  label: 'The Ontario Curriculum, Grades 11 and 12: Mathematics, 2007 (Revised)',
  type: 'pdf',
  category: 'official_curriculum',
  role: 'curriculum_reference',
  path: 'texts/ontario-curriculum/math1112currb.pdf',
  bytes: bytes('texts/ontario-curriculum/math1112currb.pdf'),
  source: 'https://www.edu.gov.on.ca/eng/curriculum/secondary/math1112currb.pdf',
};

const sourceAuditDoc = {
  label: 'MDM4U Text And Source Audit',
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
    id: 'ontario-mathematics-curriculum-11-12',
    title: curriculum.label,
    publisher: 'Ontario Ministry of Education',
    type: 'curriculum',
    units: [1, 2, 3, 4, 5],
    copyrightStatus: 'official_public_document',
    sourceStatus: 'localized_from_public_official_source',
    notes: 'Official Ontario curriculum reference containing MDM4U Mathematics of Data Management, Grade 12, University Preparation.',
    materials: [curriculum],
    path: curriculum.path,
    bytes: curriculum.bytes,
    category: curriculum.category,
    role: curriculum.role,
  },
  {
    id: 'mdm4u-source-audit',
    title: sourceAuditDoc.label,
    type: 'source_audit',
    units: [1, 2, 3, 4, 5],
    copyrightStatus: 'local_audit_note',
    sourceStatus: 'created_from_local_source_review',
    notes: 'Records textbook availability and the Unit 5 local lesson-plan gap for MDM4U.',
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
let ispringPlayable = 0;
for (const unit of manifest.units ?? []) {
  for (const lesson of unit.lessons ?? []) {
    for (const item of lesson.ispring ?? []) {
      ispringExpected += 1;
      if (item.localizationStatus === 'localized') ispringComplete += 1;
      if (item.localizationStatus === 'partial') ispringPartial += 1;
      if (['localized', 'partial'].includes(item.localizationStatus) && item.path) ispringPlayable += 1;
      delete item.downloadPath;
      delete item.downloadUrl;
      delete item.downloadBytes;
    }
  }
}

const missingLessonPlans = (manifest.units ?? [])
  .flatMap((unit) => unit.lessons ?? [])
  .filter((lesson) => !lesson.lessonPlan)
  .map((lesson) => lesson.id);

manifest.sourceAudit = {
  ...manifest.sourceAudit,
  lessonCount: (manifest.units ?? []).reduce((sum, unit) => sum + (unit.lessons?.length ?? 0), 0),
  ispringExpected,
  ispringComplete,
  ispringPartial,
  ispringDownloadPackages: 0,
  ispringDownloadPolicy: 'playback-only-no-download',
  ispringPlayable,
  lessonPlansMatchedByUnitLesson: (manifest.units ?? []).reduce(
    (sum, unit) => sum + (unit.lessons ?? []).filter((lesson) => lesson.lessonPlan).length,
    0,
  ),
  unitPlansMatched: (manifest.units ?? []).filter((unit) => unit.unitPlan).length,
  missingLessonPlans,
  textbookAudit: {
    status: 'not_identified',
    evidence: 'No full textbook file or specific textbook title was identified in Moodle book pages, local MDM4U planning previews, or the local docs folder.',
    searchedLocations: [
      'D:/工作文件/SUNNYBROOK/docs',
      'D:/工作文件/SUNNYBROOK/courseware/MDM4U',
    ],
    decision: 'Do not add a textbook until a matching legal MDM4U/Data Management textbook is provided or Moodle explicitly supplies one.',
  },
  curriculumPdfIncluded: true,
  textMaterials: manifest.texts.length,
  localizedDocumentCount: countFiles('localized-moodle/document'),
  localizedPdfCount: countFiles('localized-moodle/pdf'),
  localizedH5pCount: countFiles('localized-moodle/h5p'),
  localizedVideoCount: countFiles('localized-moodle/video'),
  videoExpected: 30,
  videoLocalized: countFiles('localized-moodle/video'),
  videoFailed: Math.max(0, 30 - countFiles('localized-moodle/video')),
  documentExpected: 39,
  documentLocalized: countFiles('localized-moodle/document'),
  documentFailed: Math.max(0, 39 - countFiles('localized-moodle/document')),
  pdfExpected: 29,
  pdfLocalized: countFiles('localized-moodle/pdf'),
  pdfFailed: Math.max(0, 29 - countFiles('localized-moodle/pdf')),
  h5pExpected: 11,
  h5pLocalized: countFiles('localized-moodle/h5p'),
  h5pFailed: Math.max(0, 11 - countFiles('localized-moodle/h5p')),
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const row = catalog.courses.find((courseRow) => courseRow.code === course);
if (!row) throw new Error(`${course} not found in course catalog`);
row.status = 'ready';
row.notes = 'Moodle book lessons, localized iSpring, H5P, videos, documents, PDFs, previews, course outline, official curriculum, and source audit are packaged; Unit 5 Moodle project lessons have no matching local lesson plans.';
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

console.log('MDM4U manifest and catalog updated.');
