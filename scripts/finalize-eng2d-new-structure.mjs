import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG2D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const htmlEscape = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const relHref = (fromHtmlPath, targetPath) => {
  const fromDir = dirname(fromHtmlPath).replaceAll("\\", "/");
  const target = targetPath.replaceAll("\\", "/");
  const fromParts = fromDir.split("/").filter(Boolean);
  const targetParts = target.split("/").filter(Boolean);
  while (fromParts.length && targetParts.length && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }
  return [...fromParts.map(() => ".."), ...targetParts].join("/") || ".";
};

const normalizeSlashes = (value) => String(value || "").replaceAll("\\", "/");

const isMoodleChromeLogo = (attachment) => {
  const label = normalizeSlashes(attachment?.label).toLowerCase();
  const source = normalizeSlashes(attachment?.source).toLowerCase();
  const path = normalizeSlashes(attachment?.path).toLowerCase();
  return (
    label === "20260514205240_755_110.png" ||
    source.includes("/theme_remui/logo/") ||
    path.endsWith("/580c955bb4-20260514205240_755_110.png")
  );
};

const existingPreviewFor = (resource) => {
  const path = normalizeSlashes(resource?.path);
  if (!path) return null;
  const previewPath = `previews-html/${path}.html`;
  return existsSync(join(courseRoot, previewPath)) ? previewPath : null;
};

const withPreview = (resource) => {
  if (!resource || typeof resource !== "object") return resource;
  if (!resource.previewPath) {
    const previewPath = existingPreviewFor(resource);
    if (previewPath) resource.previewPath = previewPath;
  }
  return resource;
};

let removedLogoAttachments = 0;
let deletedLogoFiles = 0;

const deleteChromeLogoAttachmentFile = (attachment) => {
  if (!attachment?.path) return;
  const absolute = resolve(courseRoot, attachment.path);
  const courseRootResolved = resolve(courseRoot);
  if (!absolute.startsWith(courseRootResolved) || !absolute.endsWith("580c955bb4-20260514205240_755_110.png")) return;
  rmSync(absolute, { force: true });
  deletedLogoFiles += 1;
};

const cleanAttachments = (resource) => {
  if (!resource || typeof resource !== "object") return resource;
  if (Array.isArray(resource.attachments)) {
    const kept = [];
    for (const attachment of resource.attachments) {
      if (isMoodleChromeLogo(attachment)) {
        removedLogoAttachments += 1;
        deleteChromeLogoAttachmentFile(attachment);
        continue;
      }
      kept.push(withPreview(attachment));
    }
    resource.attachments = kept;
  }
  return withPreview(resource);
};

const allManifestItems = [];

const collectItem = (item) => {
  if (!item || typeof item !== "object") return;
  allManifestItems.push(item);
  cleanAttachments(item);
};

for (const item of manifest.courseDownloads || []) collectItem(item);
for (const text of manifest.texts || []) {
  collectItem(text);
  for (const material of text.materials || []) collectItem(material);
}
for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    collectItem(lesson);
    for (const item of lesson.downloads || []) collectItem(item);
    for (const section of lesson.bookSections || []) collectItem(section);
    for (const item of lesson.ispring || []) collectItem(item);
    for (const item of lesson.videos || []) collectItem(item);
  }
}

const itemByLabel = new Map();
const itemByPath = new Map();
for (const item of allManifestItems) {
  if (item.label) itemByLabel.set(item.label, item);
  if (item.path) itemByPath.set(normalizeSlashes(item.path), item);
}

const cloneResource = (item, overrides = {}) => JSON.parse(JSON.stringify({ ...item, ...overrides }));

const itemsMatching = (items, predicate) => (items || []).filter((item) => item && predicate(item)).map((item) => cloneResource(item));

const isSummativeOrCoreAssessment = (item) => {
  const label = String(item.label || "");
  return (
    /\(A (?:as\/of|of) L\)/i.test(label) ||
    /^Assignment:/i.test(label) ||
    /^Culminating Assignment:/i.test(label) ||
    /Unit #?3 Test|Final Exam|FOR TEACHER USE ONLY/i.test(label)
  );
};

const isReflection = (item) => /Self-Assessment|Metacognitive|Reflection/i.test(item?.label || "");

const courseUrl = "https://www.esunnybrook.com/course/view.php?id=8";

const writeResourceIndexPage = (pagePath, title, items, source) => {
  const fullPath = join(courseRoot, pagePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const rows = items
    .map((item) => {
      const viewTarget = item.previewPath || item.path;
      const viewHref = viewTarget ? relHref(pagePath, viewTarget) : null;
      const downloadHref = item.path ? relHref(pagePath, item.path) : null;
      return `<li><span>${htmlEscape(item.label)}</span><span class="actions">${
        viewHref ? `<a href="${htmlEscape(viewHref)}">View</a>` : ""
      }${downloadHref ? `<a href="${htmlEscape(downloadHref)}" download>Download</a>` : ""}</span></li>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body{font-family:Arial,sans-serif;line-height:1.5;margin:32px;color:#17202a;background:#fff}
    main{max-width:920px;margin:0 auto}
    h1{font-size:26px;margin:0 0 20px}
    ul{list-style:none;padding:0;margin:0}
    li{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;border-top:1px solid #d8dee6;padding:12px 0}
    .actions{white-space:nowrap}
    a{color:#0b5cab;margin-left:12px}
    .source{color:#5f6b7a;font-size:13px;margin-top:24px}
  </style>
</head>
<body>
<main>
  <h1>${htmlEscape(title)}</h1>
  <ul>
${rows}
  </ul>
  <p class="source">Source: ${htmlEscape(source)}</p>
</main>
</body>
</html>
`;
  writeFileSync(fullPath, html);
  return statSync(fullPath).size;
};

const sanitizeFolderPage = (item) => {
  if (!item?.path || !Array.isArray(item.attachments)) return null;
  const realAttachments = item.attachments.filter((attachment) => !isMoodleChromeLogo(attachment));
  item.attachments = realAttachments.map(withPreview);
  return writeResourceIndexPage(item.path, item.label, realAttachments, item.source || "authenticated Moodle course page");
};

const stripChromeAttachmentSection = (relativePath) => {
  const fullPath = join(courseRoot, relativePath);
  if (!existsSync(fullPath)) return null;
  const before = readFileSync(fullPath, "utf8");
  const after = before
    .replace(
      /\s*<section class="attachments"><h2>Files<\/h2><ul><li><a href="files\/580c955bb4-20260514205240_755_110\.png" download>20260514205240_755_110\.png<\/a><\/li><\/ul><\/section>/g,
      "",
    )
    .replace(/\s*<section class="attachments"><h2>Files<\/h2><ul><\/ul><\/section>/g, "");
  if (after !== before) writeFileSync(fullPath, after);
  return statSync(fullPath).size;
};

const sanitizedFolderPages = [];
for (const item of allManifestItems) {
  if (item.category === "moodle_folder" && item.path?.endsWith("/index.html")) {
    const size = sanitizeFolderPage(item);
    if (size !== null) {
      item.bytes = size;
      sanitizedFolderPages.push(item.path);
    }
  }
}

const courseDownloads = (manifest.courseDownloads || []).filter(
  (item) => !/^Announcements$/i.test(item.label || "") && !/^VIP:/i.test(item.label || ""),
);
const normalizeCourseResource = (item) => {
  const normalized = cleanAttachments(item);
  normalized.category = normalized.role === "course_outline" ? "course_document" : "course_resource";
  if (normalized.role === "folder") normalized.role = "course_resource";
  return normalized;
};
manifest.courseDownloads = courseDownloads.map(normalizeCourseResource);

manifest.courseSections = [];
const staleCourseSectionsDir = resolve(courseRoot, "course-sections");
if (staleCourseSectionsDir.startsWith(resolve(courseRoot)) && existsSync(staleCourseSectionsDir)) {
  rmSync(staleCourseSectionsDir, { recursive: true, force: true });
}

const teacherResources = [];
const addTeacherResource = (item, role = "teacher_resource") => {
  if (!item) return;
  const cloned = cloneResource(cleanAttachments(item), { role });
  const key = normalizeSlashes(cloned.path || cloned.label);
  if (!teacherResources.some((existing) => normalizeSlashes(existing.path || existing.label) === key)) {
    teacherResources.push(cloned);
  }
};

for (const item of courseDownloads) {
  if (/Online Course Planning|Lesson Plans|Rubric|Assessment|Triangulation|Learning Goals/i.test(item.label || "")) {
    addTeacherResource(item, /Lesson Plans/i.test(item.label || "") ? "lesson_plan" : "teacher_resource");
  }
}

let unitEvaluationCount = 0;
let unitReflectionCount = 0;
for (const [unitIndex, unit] of (manifest.units || []).entries()) {
  const lessonDownloads = unit.lessons?.flatMap((lesson) => lesson.downloads || []) || [];
  const evaluations = itemsMatching(lessonDownloads, (item) => isSummativeOrCoreAssessment(item));
  const reflections = itemsMatching(lessonDownloads, (item) => isReflection(item));
  const lessonPlansFolder = itemByLabel.get("ENG2D Lesson Plans");
  const unitLessonPlan = lessonPlansFolder?.attachments?.find((attachment) =>
    attachment.label?.includes(`Unit-${unitIndex + 1}-Lesson-Plans`),
  );

  unit.unitResources = {
    ...(unit.unitResources || {}),
    evaluations: evaluations.map((item) => cleanAttachments(item)),
    reflectionAndLogs: reflections.map((item) => cleanAttachments(item)),
  };
  if (unitLessonPlan && unitIndex < 4) {
    unit.unitResources.lessonPlans = [
      cloneResource(unitLessonPlan, {
        category: "moodle_folder_attachment",
        role: "lesson_plan",
      }),
    ];
  }

  unitEvaluationCount += evaluations.length;
  unitReflectionCount += reflections.length;

  for (const item of evaluations) {
    if (/FOR TEACHER USE ONLY|Unit #?3 Test|Final Exam|Rubric|Assignment:|Culminating Assignment:/i.test(item.label || "")) {
      addTeacherResource(item, /FOR TEACHER USE ONLY/i.test(item.label || "") ? "answer_key" : "assessment");
    }
  }
}

manifest.teacherResources = teacherResources;

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  eng2dNewStructureFinalizedAt: new Date().toISOString(),
  moodleCourseId: 8,
  moodleLogoAttachmentsRemoved: Math.max(
    Number(manifest.sourceAudit?.moodleLogoAttachmentsRemoved || 0),
    removedLogoAttachments,
  ),
  moodleLogoFilesDeleted: Math.max(Number(manifest.sourceAudit?.moodleLogoFilesDeleted || 0), deletedLogoFiles),
  moodleFolderPagesSanitized: sanitizedFolderPages.length,
  courseSections: 0,
  courseDownloads: manifest.courseDownloads.length,
  teacherResources: manifest.teacherResources.length,
  unitEvaluations: unitEvaluationCount,
  unitReflectionAndLogs: unitReflectionCount,
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      course,
      removedLogoAttachments,
      deletedLogoFiles,
      sanitizedFolderPages,
      courseSections: manifest.courseSections.length,
      courseDownloads: manifest.courseDownloads.length,
      teacherResources: manifest.teacherResources.length,
      unitEvaluationCount,
      unitReflectionCount,
    },
    null,
    2,
  ),
);
