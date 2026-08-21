import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

const localResource = (label, resourcePath, overrides = {}) =>
  cleanAttachments({
    label,
    type: typeFromPath(resourcePath),
    category: overrides.category || "course_resource",
    role: overrides.role || "course_resource",
    path: resourcePath,
    source: "authenticated Moodle course page",
    ...overrides,
  });

const itemsMatching = (items, predicate) => (items || []).filter((item) => item && predicate(item)).map((item) => cloneResource(item));

const isTeacherOnly = (item) => /FOR TEACHER USE ONLY|Answer Keys?|Teacher Packet/i.test(item?.label || "");

const isSummativeOrCoreAssessment = (item) => {
  const label = String(item.label || "");
  return (
    /\(A (?:as\/of|of) L\)/i.test(label) ||
    /^Assignment:/i.test(label) ||
    /^Culminating Assignment:/i.test(label) ||
    /Unit #?3 Test|Final Exam|FOR TEACHER USE ONLY/i.test(label)
  );
};

const isStudentEvaluation = (item) => !isTeacherOnly(item) && isSummativeOrCoreAssessment(item);

const isReflection = (item) => /Self-Assessment|Metacognitive|Reflection/i.test(item?.label || "");

const typeFromPath = (filePath) => {
  const extension = normalizeSlashes(filePath).split(".").pop()?.toLowerCase() || "file";
  return extension;
};

const dedupeResources = (items) => {
  const seen = new Set();
  const deduped = [];
  for (const item of items || []) {
    if (!item) continue;
    const key = normalizeSlashes(item.path || item.previewPath || item.downloadPath || item.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
};

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

const writeLessonIndexPage = (unit, lesson) => {
  const pagePath = `lessons/${lesson.id}/index.html`;
  const visibleResources = lesson.downloads || [];
  const bytes = writeResourceIndexPage(
    pagePath,
    `${unit.title || unit.name || unit.id}: ${lesson.title || lesson.name || lesson.id}`,
    visibleResources,
    courseUrl,
  );
  lesson.path = dirname(pagePath).replaceAll("\\", "/");
  lesson.resourceCounts = {
    ...(lesson.resourceCounts || {}),
    downloads: visibleResources.length,
  };
  return { path: pagePath, bytes };
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

const originalMoodleSections = [
  {
    sectionKey: "introduction",
    sectionTitle: "Introduction",
    sectionOrder: 1,
    items: [
      {
        label: "Announcements",
        path: "localized-moodle-activities/forum/course-374-e606815f46/index.html",
        role: "introduction",
        category: "moodle_forum",
      },
      {
        label: "VIP: Please Read and Respond BEFORE beginning the course!",
        path: "localized-moodle-activities/forum/course-375-3b73df3e9d/index.html",
        role: "introduction",
        category: "moodle_forum",
      },
    ],
  },
  {
    sectionKey: "eng2d-course-documents",
    sectionTitle: "ENG2D Course Documents",
    sectionOrder: 2,
    items: [
      {
        label: "ENG2D Course Outline",
        path: "localized-moodle-activities/resource/course-376-9978758c6a/9978758c6a-ENG2D-Course-Outline.docx",
        role: "course_outline",
        category: "course_document",
      },
      {
        label: "ENG2D Online Course Planning",
        path: "localized-moodle-activities/resource/course-377-df59a960d3/df59a960d3-ENG2D-Online-Course-Planning.doc",
        role: "course_planning",
      },
      {
        label: "ENG2D- Learning Goals and Success Criteria",
        path: "localized-moodle-activities/resource/course-378-1e935a6c68/1e935a6c68-ENG2D-Learning-Goals-and-Success-Criteria.docx",
        role: "learning_goals_success_criteria",
      },
      {
        label: "English 9 and 10, Ontario Curriculum",
        path: "localized-moodle-activities/resource/course-379-4cdcceef6c/4cdcceef6c-English-9-and-10-Ontario-Curriculum.pdf",
        role: "curriculum",
      },
      {
        label: "ENG2D Lesson Plans",
        path: "localized-moodle-activities/folder/course-380-5c6c166a4b/index.html",
        role: "lesson_plan",
        category: "moodle_folder",
      },
    ],
  },
  {
    sectionKey: "resources",
    sectionTitle: "Resources",
    sectionOrder: 3,
    items: [
      {
        label: "Essay Writing Resources",
        path: "localized-moodle-activities/folder/course-381-852361d50b/index.html",
        role: "course_resource",
        category: "moodle_folder",
      },
      {
        label: "Distinguishing Between Assessments As, For, and Of",
        path: "localized-moodle-activities/resource/course-382-abc1abdc9c/abc1abdc9c-Distinguishing-Between-Assessments-As-For-and-Of.docx",
        role: "course_resource",
      },
      {
        label: "Triangulation Diagram",
        path: "localized-moodle-activities/resource/course-383-79d718582e/79d718582e-Triangulation-Diagram.pdf",
        role: "course_resource",
      },
      {
        label: "Rubric: Unit Discussions",
        path: "localized-moodle-activities/resource/course-384-0331272e5f/0331272e5f-Group-Discussion-Assessment-Rubric.pdf",
        role: "course_resource",
      },
    ],
  },
];

const originalSectionPaths = new Set(originalMoodleSections.flatMap((section) => section.items.map((item) => normalizeSlashes(item.path))));
const courseSection0Resources = originalMoodleSections.flatMap((section) =>
  section.items.map((definition, itemIndex) => {
    const existing = itemByPath.get(normalizeSlashes(definition.path)) || itemByLabel.get(definition.label);
    return cloneResource(existing || localResource(definition.label, definition.path, definition), {
      label: definition.label,
      role: definition.role,
      category: definition.category || (definition.role === "course_outline" ? "course_document" : "course_resource"),
      parentSection: section.sectionTitle,
      sectionKey: section.sectionKey,
      sectionTitle: section.sectionTitle,
      sectionOrder: section.sectionOrder,
      sourceGroup: "original_moodle_section",
      sortOrder: section.sectionOrder * 100 + itemIndex + 1,
      teacherOnly: false,
    });
  }),
);
manifest.courseDownloads = manifest.courseDownloads.filter((item) => !originalSectionPaths.has(normalizeSlashes(item.path)));
manifest.courseSections = courseSection0Resources;
const staleCourseSectionsDir = resolve(courseRoot, "course-sections");
if (staleCourseSectionsDir.startsWith(resolve(courseRoot)) && existsSync(staleCourseSectionsDir)) {
  rmSync(staleCourseSectionsDir, { recursive: true, force: true });
}

const teacherResources = [];
const addTeacherResource = (item, role = "teacher_resource", overrides = {}) => {
  if (!item) return;
  const cloned = cloneResource(cleanAttachments(item), {
    role,
    sourceGroup: "teacher_resources",
    parentSection: "Teacher Resources",
    teacherOnly: overrides.teacherOnly ?? true,
    ...overrides,
  });
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

const teacherOnlyFolderResource = (label, resourcePath, overrides = {}) => {
  const fullPath = join(courseRoot, resourcePath);
  if (!existsSync(fullPath)) return null;
  const filesDir = join(dirname(fullPath), "files");
  const attachments = existsSync(filesDir)
    ? readdirSync(filesDir)
        .map((fileName) => {
          const attachmentPath = `${dirname(resourcePath).replaceAll("\\", "/")}/files/${fileName}`;
          const absolute = join(courseRoot, attachmentPath);
          const labelFromFile = fileName.replace(/^[0-9a-f]{10}-/i, "");
          const resource = {
            label: labelFromFile,
            type: typeFromPath(fileName),
            path: attachmentPath,
            bytes: statSync(absolute).size,
            source: "authenticated Moodle course page",
          };
          return withPreview(resource);
        })
        .filter(Boolean)
    : [];
  return cleanAttachments({
    label,
    type: "html",
    category: "moodle_folder",
    role: "answer_key",
    path: resourcePath,
    bytes: statSync(fullPath).size,
    source: "authenticated Moodle course page",
    attachments,
    ...overrides,
  });
};

const addUnitScopedMoodleActivityLesson = (unitNumber, lessonNumber, activityId, item) => {
  if (!item) return false;
  const unit = (manifest.units || []).find((candidate) => Number(candidate.unit) === unitNumber);
  if (!unit) return false;
  const activity = cleanAttachments(
    cloneResource(item, {
      unit: unitNumber,
      lesson: lessonNumber,
      sourceGroup: `unit_${unitNumber}_moodle_section`,
      parentSection: unit.title || unit.name || `Unit ${unitNumber}`,
      teacherOnly: true,
    }),
  );
  unit.lessons = (unit.lessons || []).filter((lesson) => normalizeSlashes(lesson.path) !== normalizeSlashes(activity.path));
  unit.lessons.push({
    id: `U${String(unitNumber).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}-${activityId}`,
    unit: unitNumber,
    lesson: lessonNumber,
    title: activity.label,
    path: activity.path,
    lessonText: [],
    textExports: [],
    lessonPlan: null,
    ispring: [],
    downloads: [activity],
    resourceCounts: {
      downloads: 1,
      lessonPlan: 0,
      ispring: 0,
    },
    teacherOnly: true,
  });
  unit.lessons.sort((left, right) => Number(left.lesson || 0) - Number(right.lesson || 0));
  return true;
};

addUnitScopedMoodleActivityLesson(
  3,
  33,
  "463",
  teacherOnlyFolderResource(
    "ENG2D Unit #3 Test (FOR TEACHER USE ONLY)",
    "localized-moodle-activities/folder/U03L01-463-afcc0fbee9/index.html",
  ),
);
addUnitScopedMoodleActivityLesson(
  6,
  2,
  "491",
  teacherOnlyFolderResource(
    "ENG2D Final Exam (FOR TEACHER USE ONLY)",
    "localized-moodle-activities/folder/U06L01-491-adf3de6912/index.html",
  ),
);

let unitEvaluationCount = 0;
let unitReflectionCount = 0;
const evaluationIndex = [];
const lessonIndexPages = [];
for (const [unitIndex, unit] of (manifest.units || []).entries()) {
  const lessonDownloads = [];
  for (const [lessonIndex, lesson] of (unit.lessons || []).entries()) {
    const originalDownloads = lesson.downloads || [];
    const keepTeacherOnlyInMoodleUnit = lesson.teacherOnly === true || /FOR TEACHER USE ONLY/i.test(lesson.title || "");
    if (!keepTeacherOnlyInMoodleUnit) {
      for (const item of originalDownloads.filter((download) => isTeacherOnly(download))) {
        addTeacherResource(item, "answer_key", {
          unit: unit.id || `U${String(unitIndex + 1).padStart(2, "0")}`,
          unitTitle: unit.title || unit.name,
          lesson: lesson.id || `L${String(lessonIndex + 1).padStart(2, "0")}`,
          lessonTitle: lesson.title || lesson.name,
          sourceGroup: "answer_keys",
          parentSection: "Teacher Resources",
          teacherOnly: true,
        });
      }
    }
    lesson.downloads = originalDownloads
      .filter((download) => keepTeacherOnlyInMoodleUnit || !isTeacherOnly(download))
      .map((item) => cleanAttachments(item));
    lessonDownloads.push(...lesson.downloads);
    lessonIndexPages.push(writeLessonIndexPage(unit, lesson));
  }

  const evaluations = itemsMatching(lessonDownloads, (item) => isStudentEvaluation(item));
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
    evaluationIndex.push(
      cloneResource(item, {
        unit: unit.id || `U${String(unitIndex + 1).padStart(2, "0")}`,
        unitTitle: unit.title || unit.name,
        parentSection: "Evaluation",
        sourceGroup: "unit_evaluation",
      }),
    );
  }
}

manifest.teacherResources = teacherResources.filter((item) => !originalSectionPaths.has(normalizeSlashes(item.path)));
manifest.evaluations = dedupeResources(evaluationIndex).map((item) => cleanAttachments(item));

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
  courseSections: manifest.courseSections.length,
  courseDownloads: manifest.courseDownloads.length,
  teacherResources: manifest.teacherResources.length,
  evaluations: manifest.evaluations.length,
  unitEvaluations: unitEvaluationCount,
  unitReflectionAndLogs: unitReflectionCount,
  lessonIndexPages: lessonIndexPages.length,
  legacyResourceSequenceLessons: true,
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
      evaluations: manifest.evaluations.length,
      unitEvaluationCount,
      unitReflectionCount,
      lessonIndexPages,
    },
    null,
    2,
  ),
);
