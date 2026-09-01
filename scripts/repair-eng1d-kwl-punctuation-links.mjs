import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());
const courseRoot = path.resolve(repoRoot, "..", "courseware", "ENG1D");
const manifestPath = path.join(courseRoot, "course-manifest.json");

const mistakenByUnit = new Map([
  [1, "545ea41e75-Unit 1.docx"],
  [2, "5387f7fe9c-Unit 2.docx"],
  [3, "927baa9b11-Unit 3.docx"],
  [4, "9b7bb52bc4-Unit 3.docx"],
]);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const report = [];

function removeMistakenDownloads(items, fileName) {
  if (!Array.isArray(items)) return 0;
  const before = items.length;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (typeof item?.path === "string" && item.path.endsWith(fileName)) {
      items.splice(i, 1);
    }
  }
  return before - items.length;
}

function patchHtml(htmlPath, fileName) {
  let html = fs.readFileSync(htmlPath, "utf8");
  const before = html;
  const escapedHrefName = encodeURIComponent(fileName.replace(/^[^-]+-/, "")).replace(/%20/g, "%20");
  const hrefPattern = `files/02-lesson/${fileName.replace(/ /g, "%20")}`;
  const bareNamePattern = `files/02-lesson/${escapedHrefName}`;

  html = html.replace(
    new RegExp(`<a\\s+href="${hrefPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>\\s*\\.\\s*</a>`, "g"),
    ".",
  );
  html = html.replace(
    new RegExp(`<a\\s+href="${bareNamePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>\\s*\\.\\s*</a>`, "g"),
    ".",
  );
  html = html.replace(
    new RegExp(
      `<div class="file-row"><div class="file-label">${fileName
        .replace(/^[^-]+-/, "")
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</div><div class="actions"><a class="button" href="${hrefPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">View</a><a class="button" href="${hrefPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" download>Download</a></div></div>`,
      "g",
    ),
    "",
  );

  if (html !== before) {
    fs.writeFileSync(htmlPath, html);
    return true;
  }
  return false;
}

for (const unit of manifest.units || []) {
  const fileName = mistakenByUnit.get(Number(unit.unit));
  if (!fileName) continue;
  const lesson = (unit.lessons || []).find((entry) => Number(entry.lesson) === 1);
  if (!lesson) continue;

  const htmlPath = path.join(courseRoot, lesson.path, "book_sections", "02-lesson.html");
  const removedDownloads = removeMistakenDownloads(lesson.downloads, fileName);
  let removedSectionAttachments = 0;
  for (const section of lesson.bookSections || []) {
    removedSectionAttachments += removeMistakenDownloads(section.attachments, fileName);
  }
  const patchedHtml = fs.existsSync(htmlPath) ? patchHtml(htmlPath, fileName) : false;

  report.push({
    unit: unit.unit,
    lesson: lesson.lesson,
    fileName,
    removedDownloads,
    removedSectionAttachments,
    patchedHtml,
  });
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  eng1dKwlPunctuationLinks: {
    repairedAt: new Date().toISOString(),
    note:
      "Removed Moodle editor residue where the period after the visible KWL link pointed to another unit document.",
    report,
  },
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
