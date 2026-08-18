import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BAF3M");
const manifestPath = join(courseRoot, "course-manifest.json");
const pageRel = "course-sections/course-overview/index.html";
const pagePath = join(courseRoot, pageRel);
const overviewIspringPath = "ispring-localized/unit-00/course-overview/presentation.html";
const overviewIspringPackage = "ispring-localized/unit-00/course-overview";
const overviewIspringSource = "https://hexstruct.ispring.com/s/embed_player/38fb0d93-d44a-11ed-8863-3a9a83d567ea";

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function renderAttachmentRow(item) {
  const viewPath = item.previewPath || item.path;
  const downloadPath = item.downloadPath || item.path;
  return `<div class="file-row"><div class="file-label">${htmlEscape(item.label)}</div><div class="actions"><a class="button" href="${htmlEscape(relativeHref(pageRel, viewPath))}">View</a><a class="button" href="${htmlEscape(relativeHref(pageRel, downloadPath))}" download>Download</a></div></div>`;
}

if (!existsSync(join(courseRoot, overviewIspringPath))) {
  throw new Error(`Missing localized Course Overview iSpring entry: ${overviewIspringPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const overview = (manifest.courseSections || []).find((item) => item.role === "course_overview");
if (!overview) throw new Error("Missing Course Overview section in manifest.");

const gif = (overview.attachments || []).find((item) => item.type === "gif");
if (!gif) throw new Error("Missing Course Overview Moodle GIF attachment.");

const courseOutlineText =
  "In the course outline, you will find the specific and overall expectations, forms of assessments AAL, AFL and, and AOL. In the document, you will also come across the course breakdown and accommodations for students with learning needs. Students and educators should review the course outline to become familiar with the expectations and grading criteria.";
const learningLogText =
  "After each unit, the student must submit a learning log to track the hours spent on assignments. The learning log is to provide learning accountability from the student and to help the student develop a good study routine. Attached you will find a sample learning log filled out.";

const bodyHtml = `
      <figure class="overview-hero"><img src="${htmlEscape(relativeHref(pageRel, gif.previewPath || gif.path))}" alt="Hexstruct Consulting"></figure>
      <section class="overview-block">
        <h2>Course Overview Presentation</h2>
        <iframe class="localized-ispring" src="../../${htmlEscape(overviewIspringPath)}" loading="lazy" allowfullscreen></iframe>
      </section>
      <section class="overview-block">
        <h2>BAF3M Course Outline</h2>
        <p>${htmlEscape(courseOutlineText)}</p>
      </section>
      <section class="overview-block">
        <h2>Learning Log</h2>
        <p>${htmlEscape(learningLogText)}</p>
      </section>`;

const attachmentHtml = `<section class="files"><h2>Files</h2>${renderAttachmentRow(gif)}</section>`;
const pageHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Course Overview</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .overview-hero { margin: 0 0 26px; }
    .overview-hero img { display: block; height: auto; max-width: min(900px, 100%); }
    .overview-block { border-top: 1px solid #e0e8f2; padding-top: 14px; margin-top: 22px; }
    .localized-ispring { border: 0; display: block; height: min(72vh, 760px); margin: 14px 0; width: 100%; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>Course Overview</h1>
    <article class="content">${bodyHtml}</article>
    ${attachmentHtml}
  </main>
</body>
</html>
`;

writeFileSync(pagePath, pageHtml, "utf8");

overview.bytes = Buffer.byteLength(pageHtml, "utf8");
overview.textPreview = `${courseOutlineText} ${learningLogText}`;
overview.ispring = [
  {
    label: "BAF3M Course Overview iSpring",
    type: "ispring",
    category: "ispring",
    role: "course_overview_ispring",
    mode: "page",
    path: overviewIspringPath,
    packagePath: overviewIspringPackage,
    bytes: statSync(join(courseRoot, overviewIspringPath)).size,
    source: overviewIspringSource,
  },
];
overview.packagePath = overviewIspringPackage;

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewIspring = {
  source: overviewIspringSource,
  path: overviewIspringPath,
  packagePath: overviewIspringPackage,
  localized: true,
};
manifest.generatedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  page: pageRel,
  bytes: overview.bytes,
  ispringPath: overviewIspringPath,
  ispringPackage: overviewIspringPackage,
  textPreviewLength: overview.textPreview.length,
}, null, 2));
