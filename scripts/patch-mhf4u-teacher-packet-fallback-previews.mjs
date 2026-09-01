import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "MHF4U");
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sanitize(value) {
  return toPosix(value).replace(/[^A-Za-z0-9._/ -]+/g, "_");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function relHref(fromRel, toRel) {
  return toPosix(posix.relative(posix.dirname(toPosix(fromRel)), toPosix(toRel)));
}

function renderPreview(label, sourceRel, previewRel) {
  const href = relHref(previewRel, sourceRel);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(label)}</title>
  <style>
    body { background: #f5f7fb; color: #102033; font-family: Arial, Helvetica, sans-serif; line-height: 1.6; margin: 0; }
    main { margin: 0 auto; max-width: 860px; padding: 40px 20px 64px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; }
    h1 { color: #002f5f; font-size: 26px; margin: 0 0 14px; }
    .action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-weight: 700; padding: 9px 14px; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(label)}</h1>
      <p>This protected Word document is available for download. A text preview could not be extracted from the source file.</p>
      <a class="action" href="${htmlEscape(href, true)}" download>Download original file</a>
    </article>
  </main>
</body>
</html>
`;
}

function renderTeacherPacketPage(resource) {
  const attachments = resource.attachments || [];
  const rows = attachments.map((attachment) => {
    const downloadHref = relHref(resource.path, attachment.downloadPath || attachment.path);
    const previewHref = attachment.previewPath ? relHref(resource.path, attachment.previewPath) : "";
    const actions = [
      previewHref ? `<a href="${htmlEscape(previewHref, true)}">View</a>` : "",
      `<a href="${htmlEscape(downloadHref, true)}" download>Download</a>`,
    ].filter(Boolean).join("");
    return `<li><span>${htmlEscape(attachment.label || attachment.path)}</span><span class="actions">${actions}</span></li>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(resource.title || resource.label || "Teacher Packet")}</title>
  <style>
    body { background: #f5f7fb; color: #102033; font-family: Arial, Helvetica, sans-serif; line-height: 1.6; margin: 0; }
    main { margin: 0 auto; max-width: 980px; padding: 40px 20px 64px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; }
    h1 { border-bottom: 1px solid #edf1f6; color: #002f5f; font-size: 28px; margin: 0 0 18px; padding-bottom: 14px; }
    p { margin: 0 0 18px; }
    a { color: #00396f; font-weight: 700; }
    .attachments { display: grid; gap: 8px; list-style: none; margin: 0; padding: 0; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; justify-content: space-between; padding: 10px 12px; }
    .actions { display: inline-flex; flex: 0 0 auto; gap: 10px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(resource.label || resource.title || "Answer Keys")}</h1>
      <p>Teacher Packet answer key files from the St.Mary Moodle source.</p>
      <ul class="attachments">${rows}</ul>
    </article>
  </main>
</body>
</html>
`;
}

const manifest = readJson(manifestPath);
let generated = 0;
let updated = 0;
let pagesRebuilt = 0;

for (const resource of manifest.teacherResources || []) {
  resource.title ||= resource.label || "Answer Keys";
  for (const attachment of resource.attachments || []) {
    if (!/\.docx?$/i.test(attachment.path || "") || attachment.previewPath) continue;
    const abs = join(courseRoot, attachment.path);
    if (!existsSync(abs)) continue;
    const previewRel = `previews-html/${sanitize(attachment.path)}.html`;
    const previewAbs = join(courseRoot, previewRel);
    mkdirSync(dirname(previewAbs), { recursive: true });
    writeFileSync(previewAbs, renderPreview(attachment.label || attachment.path, attachment.path, previewRel), "utf8");
    attachment.previewPath = previewRel;
    attachment.bytes = statSync(abs).size;
    generated += 1;
    updated += 1;
  }
  if (resource.role === "teacher_packet" && resource.path && (resource.attachments || []).length) {
    const pageAbs = join(courseRoot, resource.path);
    mkdirSync(dirname(pageAbs), { recursive: true });
    writeFileSync(pageAbs, renderTeacherPacketPage(resource), "utf8");
    resource.bytes = statSync(pageAbs).size;
    resource.textPreview = `Teacher Packet answer key files from the St.Mary Moodle source. ${(resource.attachments || []).map((item) => item.label).join(" ")}`.slice(0, 800);
    pagesRebuilt += 1;
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.mhf4uTeacherPacketFallbackPreviews = {
  generatedAt: new Date().toISOString(),
  generated,
  pagesRebuilt,
  note: "Generated download-only HTML previews for protected/unsupported Teacher Packet Word documents so portal View actions resolve to local HTML.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course: "MHF4U", generated, updated, pagesRebuilt }, null, 2));
