import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const workspaceRoot = path.resolve(repoRoot, '..');
const courseRoot = path.join(workspaceRoot, 'courseware', 'SCH4U');
const manifestPath = path.join(courseRoot, 'course-manifest.json');
const labPath = path.join(
  courseRoot,
  'localized-moodle-activities',
  'assign',
  'course-8893-4fd988a08d',
  'index.html',
);
const h5pPath = path.join(
  courseRoot,
  'localized-moodle',
  'h5p-external',
  'writing-formal-lab-reports-201.h5p',
);
const ispringDir = path.join(courseRoot, 'ispring-localized', 'unit-04', 'U04L03');

function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countFiles(fullPath);
    } else if (entry.isFile()) {
      total += 1;
    }
  }
  return total;
}

const h5pPreviewPath = 'localized-moodle/h5p-external/writing-formal-lab-reports-201/index.html';
const h5pPackagePath = 'localized-moodle/h5p-external/writing-formal-lab-reports-201.h5p';
const h5pBlock = `<section class="localized-h5p">
<h4>Interactive Lab Writing Review</h4>
<iframe src="../../../${h5pPreviewPath}" title="Writing formal lab reports H5P" allowfullscreen="allowfullscreen"></iframe>
<p><a class="button" href="../../../${h5pPackagePath}" download>Download H5P package</a></p>
</section>`;

let labHtml = fs.readFileSync(labPath, 'utf8');
labHtml = labHtml.replace(
  /<p><div class="notice">External H5P interaction was present in Moodle for this lab activity, but no downloadable H5P package was exposed\. The lab page and attached files are localized below\.<\/div><\/p>/,
  h5pBlock,
);
if (!labHtml.includes('.localized-h5p')) {
  labHtml = labHtml.replace(
    '    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }',
    [
      '    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }',
      '    .localized-image { max-width: 100%; height: auto; border: 1px solid #d9e2ef; border-radius: 4px; }',
      '    .localized-h5p { border-top: 1px solid #edf1f6; border-bottom: 1px solid #edf1f6; margin: 18px 0; padding: 14px 0 18px; }',
      '    .localized-h5p h4 { margin: 0 0 12px; }',
      '    .localized-h5p iframe { width: min(100%, 900px); min-height: 560px; }',
    ].join('\n'),
  );
}
if (!labHtml.includes('.localized-image')) {
  labHtml = labHtml.replace(
    '    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }',
    [
      '    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }',
      '    .localized-image { max-width: 100%; height: auto; border: 1px solid #d9e2ef; border-radius: 4px; }',
    ].join('\n'),
  );
}
labHtml = labHtml.replace(
  /<img class="img-fluid" role="presentation" data-localized-link="removed" alt="" width="1042" height="364"><img id="yui_3_17_2_1_1729561227679_1993" role="presentation" src="https:\/\/eclasssunnybrook\.com\/draftfile\.php\/7062\/user\/draft\/800153056\/image%20%285%29\.png" alt="">/,
  '<img class="localized-image" src="files/0df87d2130-WechatIMG3476.jpg" alt="Observation table for galvanic cell EMF calculations" width="1042" height="364">',
);
fs.writeFileSync(labPath, labHtml);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const labDownload = manifest.courseDownloads.find((item) => item.label === 'Unit 5 - Lab (AOL)');
if (!labDownload) {
  throw new Error('Could not find Unit 5 - Lab (AOL) course download');
}
labDownload.bytes = fs.statSync(labPath).size;
labDownload.attachments ??= [];
if (!labDownload.attachments.some((item) => item.path === h5pPackagePath)) {
  labDownload.attachments.push({
    label: 'Writing formal lab reports H5P',
    type: 'h5p',
    category: 'localized_external_h5p',
    role: 'lab_h5p',
    path: h5pPackagePath,
    href: `../../../${h5pPackagePath}`,
    bytes: fs.statSync(h5pPath).size,
    source: 'https://welcome.hexstruct.com/wp-content/uploads/h5p/exports/writing-formal-lab-reports-201.h5p',
    previewPath: h5pPreviewPath,
  });
}

let ispring = null;
for (const unit of manifest.units) {
  for (const lesson of unit.lessons ?? []) {
    ispring = lesson.ispring?.find((item) => item.packagePath === 'ispring-localized/unit-04/U04L03') ?? null;
    if (ispring) {
      break;
    }
  }
  if (ispring) {
    break;
  }
}
if (!ispring) {
  throw new Error('Could not find U04L03 iSpring manifest entry');
}
ispring.files = countFiles(ispringDir);
ispring.localizationStatus = 'localized';
delete ispring.failedAssets;

manifest.sourceAudit ??= {};
manifest.sourceAudit.ispringComplete = 44;
manifest.sourceAudit.ispringPartial = 0;
manifest.sourceAudit.ispringRecoveredAssets = (manifest.sourceAudit.ispringRecoveredAssets ?? 0) + 1;

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Patched ${path.relative(repoRoot, labPath)}`);
console.log(`Patched ${path.relative(repoRoot, manifestPath)}`);
console.log(`U04L03 iSpring files: ${ispring.files}`);
