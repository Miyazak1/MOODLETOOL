import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(projectRoot);
const courseRoot = join(workspaceRoot, "courseware", "BBB4M");
const manifestPath = join(courseRoot, "course-manifest.json");
const sectionRel = "course-sections/course-starter-resources/index.html";
const sectionPath = join(courseRoot, sectionRel);

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function htmlEscape(value, attr = false) {
  const escaped = String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return attr ? escaped.replace(/"/g, "&quot;") : escaped;
}

function href(fromRel, toRel) {
  return toPosix(relative(dirname(fromRel), toRel)) || ".";
}

function renderFiles(attachments) {
  if (!attachments.length) return "";
  const rows = attachments.map((item) => {
    const viewHref = href(sectionRel, item.previewPath || item.path);
    const downloadHref = href(sectionRel, item.downloadPath || item.path);
    return `<div class="file-row"><div class="file-label">${htmlEscape(item.label)}</div><div class="actions"><a class="button" href="${htmlEscape(viewHref, true)}">View</a><a class="button" href="${htmlEscape(downloadHref, true)}" download>Download</a></div></div>`;
  }).join("\n");
  return `<section class="files"><h2>Files</h2>${rows}</section>`;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const section = (manifest.courseSections || []).find((item) => item.path === sectionRel);
if (!section) throw new Error(`Missing BBB4M section 0 record: ${sectionRel}`);
const attachments = section.attachments || [];
const banner = attachments.find((item) => /course banner/i.test(item.label || "") && item.path);
const bannerHref = banner ? href(sectionRel, banner.path) : "";

const introText = "BBB4M Grade 12 International Business examines the importance of international business and trade for our global economy and explores factors influencing success in international markets. Throughout this course, students will discover the techniques and strategies associated with effective marketing, distribution, and managing of international business. This course prepares students for post secondary programs in business, including international business, marketing and management.";

const body = `
      ${bannerHref ? `<figure class="course-banner"><img src="${htmlEscape(bannerHref, true)}" alt="" role="presentation"></figure>` : ""}
      <p><strong>BBB4M</strong> Grade 12 International Business examines the importance of international business and trade for our global economy and explores factors influencing success in international markets. Throughout this course, students will discover the techniques and strategies associated with effective marketing, distribution, and managing of international business. This course prepares students for post secondary programs in business, including international business, marketing and management.</p>
      <p class="prerequisite"><strong>Prerequisite:</strong> None</p>
`.trim();

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Course Introduction</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .course-banner { margin: 20px 0 26px; text-align: center; }
    .course-banner img { display: block; height: auto; max-width: 100%; margin: 0 auto; }
    .prerequisite { margin-top: 34px; text-align: center; }
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
    <h1>Course Introduction</h1>
    <article class="content">${body}</article>
    ${renderFiles(attachments)}
  </main>
</body>
</html>
`;

writeFileSync(sectionPath, html, "utf8");

section.bytes = statSync(sectionPath).size;
section.textPreview = `${introText} Prerequisite: None`;
manifest.sourceAudit ||= {};
manifest.sourceAudit.section0Trim = {
  status: "trimmed",
  note: "Removed Moodle course navigation, hidden/restricted section tiles, announcements, and teacher-packet links from the BBB4M section 0 introduction page. Kept only the banner, course introduction text, prerequisite, and local banner attachment.",
  path: sectionRel,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course: "BBB4M",
  path: sectionRel,
  bytes: section.bytes,
  attachments: attachments.length,
}, null, 2));
