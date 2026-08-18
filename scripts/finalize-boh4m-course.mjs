import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = 'D:/工作文件/SUNNYBROOK';
const courseRoot = path.join(workspaceRoot, 'courseware', 'BOH4M');
const manifestPath = path.join(courseRoot, 'course-manifest.json');
const catalogPath = path.join(workspaceRoot, 'ossd-course-portal', 'public', 'course-catalog.json');

function bytes(relativePath) {
  return fs.statSync(path.join(courseRoot, relativePath)).size;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const courseOutline = {
  label: 'BOH4M Course Outline.docx',
  type: 'docx',
  category: 'course_document',
  role: 'course_outline',
  path: 'plans/course/BOH4M_Course_Outline.docx',
  bytes: bytes('plans/course/BOH4M_Course_Outline.docx'),
  source: 'https://www.esunnybrook.com/pluginfile.php/7576/mod_assign/introattachment/0/BOH4M-Course-Outline.docx?forcedownload=1',
  previewPath: 'previews-html/plans/course/BOH4M_Course_Outline.docx.html',
};

const curriculum = {
  label: 'The Ontario Curriculum, Grades 11 and 12: Business Studies, 2006 (Revised)',
  type: 'pdf',
  category: 'official_curriculum',
  role: 'curriculum_reference',
  path: 'texts/ontario-curriculum/business1112currb.pdf',
  bytes: bytes('texts/ontario-curriculum/business1112currb.pdf'),
  source: 'https://www.edu.gov.on.ca/eng/curriculum/secondary/business1112currb.pdf',
};

const sourceAuditDoc = {
  label: 'BOH4M Text And Source Audit',
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
    id: 'ontario-business-studies-curriculum-11-12',
    title: curriculum.label,
    publisher: 'Ontario Ministry of Education',
    type: 'curriculum',
    units: [1, 2, 3, 4, 5],
    copyrightStatus: 'official_public_document',
    sourceStatus: 'localized_from_public_official_source',
    notes: 'Official Ontario curriculum reference containing BOH4M Business Leadership: Management Fundamentals, Grade 12, University/College Preparation.',
    materials: [curriculum],
    path: curriculum.path,
    bytes: curriculum.bytes,
    category: curriculum.category,
    role: curriculum.role,
  },
  {
    id: 'boh4m-source-audit',
    title: sourceAuditDoc.label,
    type: 'source_audit',
    units: [1, 2, 3, 4, 5],
    copyrightStatus: 'local_audit_note',
    sourceStatus: 'created_from_local_source_review',
    notes: 'Records textbook availability and confirms local planning-file coverage for BOH4M.',
    materials: [sourceAuditDoc],
    path: sourceAuditDoc.path,
    bytes: sourceAuditDoc.bytes,
    category: sourceAuditDoc.category,
    role: sourceAuditDoc.role,
  },
];

manifest.sourceAudit = {
  ...manifest.sourceAudit,
  textbookAudit: {
    status: 'not_identified',
    evidence: 'No textbook file or specific textbook title was identified in Moodle book pages or local BOH4M source materials.',
    searchedLocations: [
      'D:/工作文件/SUNNYBROOK/docs',
      'D:/工作文件/SUNNYBROOK/courseware/BOH4M',
    ],
    decision: 'Do not add a textbook until a matching legal BOH4M textbook is provided or Moodle explicitly supplies one.',
  },
  curriculumPdfIncluded: true,
  textMaterials: manifest.texts.length,
  localizedDocumentCount: 48,
  localizedPdfCount: 37,
  localizedH5pCount: 0,
  localizedVideoCount: 1,
  videoExpected: 1,
  videoLocalized: 1,
  videoFailed: 0,
  documentExpected: 48,
  documentLocalized: 48,
  documentFailed: 0,
  pdfExpected: 37,
  pdfLocalized: 37,
  pdfFailed: 0,
};

let ispringPlayable = 0;
for (const unit of manifest.units ?? []) {
  for (const lesson of unit.lessons ?? []) {
    for (const item of lesson.ispring ?? []) {
      if (item.localizationStatus === 'localized' && item.path) {
        ispringPlayable += 1;
      }
      delete item.downloadPath;
      delete item.downloadUrl;
      delete item.downloadBytes;
    }
  }
}

manifest.sourceAudit.ispringDownloadPackages = 0;
manifest.sourceAudit.ispringPlayable = ispringPlayable;

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const row = catalog.courses.find((course) => course.code === 'BOH4M');
if (!row) {
  throw new Error('BOH4M not found in course catalog');
}
row.status = 'ready';
row.notes = 'Moodle book lessons, localized iSpring, documents, PDFs, one video, previews, course outline, official curriculum, and source audit are packaged; no matching textbook was identified.';
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

console.log('BOH4M manifest and catalog updated.');
