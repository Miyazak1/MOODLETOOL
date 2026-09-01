import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SBI3U");
const manifestPath = join(courseRoot, "course-manifest.json");

const sch4uH5pPackage = join(workspaceRoot, "courseware", "SCH4U", "localized-moodle", "h5p-external", "writing-formal-lab-reports-201.h5p");
const sch4uH5pPreview = join(workspaceRoot, "courseware", "SCH4U", "localized-moodle", "h5p-external", "writing-formal-lab-reports-201");
const h5pPackageRel = "localized-moodle/h5p-external/writing-formal-lab-reports-201.h5p";
const h5pPreviewRel = "localized-moodle/h5p-external/writing-formal-lab-reports-201/index.html";
const writingLabRel = "localized-moodle-activities/page/course-9639-7077c9b711/index.html";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pageHtml(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 24px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; color: #002f5f; }
    h2 { font-size: 18px; margin: 20px 0 10px; color: #14395c; }
    a { color: #00396f; font-weight: 700; }
    iframe { display: block; width: min(100%, 900px); min-height: 560px; border: 1px solid #d9e2ef; border-radius: 6px; background: #fff; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .muted { color: #5d6b7a; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${body}
    </article>
  </main>
</body>
</html>
`;
}

function writePage(rel, title, body) {
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, pageHtml(title, body), "utf8");
  return {
    path: rel,
    bytes: statSync(abs).size,
    textPreview: stripTags(readFileSync(abs, "utf8")).slice(0, 500),
  };
}

if (!existsSync(sch4uH5pPackage) || !existsSync(sch4uH5pPreview)) {
  throw new Error("Missing SCH4U localized Writing Formal Lab Reports H5P source.");
}

const h5pPackageAbs = join(courseRoot, h5pPackageRel);
const h5pPreviewAbs = join(courseRoot, "localized-moodle", "h5p-external", "writing-formal-lab-reports-201");
mkdirSync(dirname(h5pPackageAbs), { recursive: true });
cpSync(sch4uH5pPackage, h5pPackageAbs);
cpSync(sch4uH5pPreview, h5pPreviewAbs, { recursive: true });

const h5pRecord = {
  label: "Writing Formal Lab Reports H5P",
  type: "h5p",
  category: "localized_external_h5p",
  role: "formal_lab_reports",
  path: h5pPackageRel,
  bytes: statSync(h5pPackageAbs).size,
  source: "https://welcome.hexstruct.com/wp-content/uploads/h5p/exports/writing-formal-lab-reports-201.h5p",
  previewPath: h5pPreviewRel,
};

const writingBody = `<p class="muted">Localized H5P activity from Moodle page activity 9639.</p>
<iframe src="${htmlEscape(courseRelative(writingLabRel, h5pPreviewRel), true)}" title="Writing Formal Lab Reports H5P" allowfullscreen="allowfullscreen"></iframe>
<section class="attachments">
  <h2>Files</h2>
  <ul>
    <li><a href="${htmlEscape(courseRelative(writingLabRel, h5pPackageRel), true)}" download>Writing Formal Lab Reports H5P package</a></li>
  </ul>
</section>`;
const writingPage = writePage(writingLabRel, "Writing Formal Lab Reports", writingBody);

const manifest = readJson(manifestPath);
manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.moodleActivityId !== "9638");
manifest.teacherResources = (manifest.teacherResources || []).filter((item) => item.moodleActivityId !== "9800");

const writing = (manifest.courseDownloads || []).find((item) => item.moodleActivityId === "9639");
if (!writing) throw new Error("Missing Writing Formal Lab Reports course download.");
Object.assign(writing, {
  label: "Writing Formal Lab Reports",
  type: "html",
  category: "moodle_page",
  role: "formal_lab_reports",
  path: writingLabRel,
  bytes: writingPage.bytes,
  source: "https://www.esunnybrook.com/mod/page/view.php?id=9639",
  textPreview: writingPage.textPreview,
  attachments: [{ ...h5pRecord, href: courseRelative(writingLabRel, h5pPackageRel) }],
});
delete writing.url;
delete writing.externalUrl;

const sections = new Map((manifest.courseSections || []).map((item) => [item.role, item]));
const courseResourcesPage = writePage(
  "course-sections/sbi3u-course-resources/index.html",
  "SBI3U Course Resources",
  `<ul>
    <li>Writing Formal Lab Reports</li>
  </ul>`,
);
const finalPage = writePage(
  "course-sections/final-exam-culminating/index.html",
  "Final Exam & Culminating",
  `<ul>
    <li>Culminating</li>
    <li>Final Exam Dropbox</li>
  </ul>`,
);
const teacherPage = writePage(
  "course-sections/teacher-packet/index.html",
  "Teacher Packet",
  `<p class="muted">Moodle lists an Answer Keys activity, but its attached files returned HTTP 404 during localization, so no teacher file is displayed.</p>`,
);

for (const [role, update] of [
  ["course_resources", courseResourcesPage],
  ["final_examination_culminating", finalPage],
  ["teacher_packet", teacherPage],
]) {
  const item = sections.get(role);
  if (!item) continue;
  item.bytes = update.bytes;
  item.textPreview = update.textPreview;
  item.attachments = [];
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.unavailableCourseResourceActivities = [
  {
    label: "Lab report template",
    moodleActivityId: "9638",
    source: "https://www.esunnybrook.com/mod/resource/view.php?id=9638",
    reason: "Moodle returned HTTP 404 during localization; no local file was available, so it is not displayed.",
  },
  {
    label: "Answer Keys",
    moodleActivityId: "9800",
    source: "https://www.esunnybrook.com/mod/assign/view.php?id=9800",
    reason:
      "Moodle activity localized, but all listed answer-key attachment pluginfile URLs returned HTTP 404; no answer file was available, so the card is not displayed.",
  },
];
manifest.sourceAudit.sbi3uCourseMaterialsCleanup = {
  patchedAt: new Date().toISOString(),
  copiedExternalH5pFrom: toPosix(relative(projectRoot, sch4uH5pPackage)),
  writingFormalLabReportsH5p: h5pPackageRel,
  removedUnavailableActivityIds: ["9638", "9800"],
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(
  JSON.stringify(
    {
      copiedH5p: h5pPackageRel,
      h5pBytes: h5pRecord.bytes,
      removedUnavailableActivityIds: ["9638", "9800"],
      courseDownloads: manifest.courseDownloads.length,
      teacherResources: manifest.teacherResources.length,
    },
    null,
    2,
  ),
);
