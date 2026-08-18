import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "OLC4O";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const roadmapPath = join(projectRoot, "public", "course-roadmap.json");
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 92) || "resource";
}

function eachResource(manifest, callback) {
  for (const item of manifest.courseDownloads || []) callback(item);
  for (const text of manifest.texts || []) {
    callback(text);
    for (const material of text.materials || []) callback(material);
  }
  for (const unit of manifest.units || []) {
    callback(unit.unitPlan);
    for (const resource of Object.values(unit.unitResources || {})) {
      if (Array.isArray(resource)) resource.forEach(callback);
      else callback(resource);
    }
    for (const lesson of unit.lessons || []) {
      callback(lesson.lessonPlan);
      for (const item of lesson.lessonText || []) callback(item);
      for (const item of lesson.textExports || []) callback(item);
      for (const item of lesson.downloads || []) callback(item);
      for (const item of lesson.ispring || []) callback(item);
      for (const item of lesson.bookSections || []) callback(item);
    }
  }
}

function fixTruncatedPdfExtension(manifest) {
  let fixed = 0;
  eachResource(manifest, (item) => {
    if (!item?.path || item.type !== "pdf" || !item.path.endsWith(".pd")) return;
    const oldAbs = join(courseRoot, item.path);
    const newRel = `${item.path}f`;
    const newAbs = join(courseRoot, newRel);
    renameSync(oldAbs, newAbs);
    item.path = newRel;
    item.bytes = statSync(newAbs).size;
    fixed++;
  });
  return fixed;
}

function unavailableHtml(title, moodleUrl) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f5f7fb; color: #102033; }
    main { max-width: 920px; margin: 56px auto; padding: 30px; background: #fff; border: 1px solid #d8e1ed; border-radius: 6px; }
    h1 { margin-top: 0; font-size: 26px; }
    p { line-height: 1.55; }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(title)}</h1>
    <p>This lesson plan file was listed in the current OLC4O Moodle folder, but its file endpoint returned HTTP 404 during localization.</p>
    <p>No replacement content was added because a verified current local file was not available.</p>
  </main>
</body>
</html>
`;
}

function attachUnavailableFolderLessonPlans(manifest) {
  const folderItem = (manifest.courseDownloads || []).find((item) => item.moodleActivityId === "495" || /OLC4O Lesson Plans/i.test(item.label || ""));
  if (!folderItem) return { count: 0, names: [] };
  const names = Array.from({ length: 9 }, (_, index) => `Lesson Plan ${index + 1}.doc`);
  const baseRel = "localized-moodle-activities/folder/course-495-045d59faf3/unavailable";
  folderItem.attachments = names.map((name) => {
    const rel = `${baseRel}/${sanitizeSegment(name)}.html`;
    const abs = join(courseRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, unavailableHtml(name), "utf8");
    return {
      label: name,
      type: "html",
      category: "moodle_folder_file",
      role: "lesson_plan",
      path: rel,
      bytes: statSync(abs).size,
      unavailable: true,
      unavailableReason: "Moodle folder file endpoint returned HTTP 404 during localization.",
      source: "authenticated SunnyBrook Moodle folder file id 530 (HTTP 404)",
    };
  });
  folderItem.folderFileCount = names.length;
  folderItem.unavailableFolderFiles = names.length;
  folderItem.source = "authenticated SunnyBrook Moodle folder activity id 495";
  rewriteFolderPage(folderItem, names);
  return { count: names.length, names };
}

function rewriteFolderPage(folderItem, names) {
  if (!folderItem.path) return;
  const rows = names
    .map((name, index) => `<tr><td>${index + 1}</td><td>${htmlEscape(name)}</td><td>Moodle file endpoint returned HTTP 404 during localization.</td></tr>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OLC4O Lesson Plans</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #102033; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 6px; padding: 22px; }
    h1 { margin-top: 0; font-size: 28px; }
    p { line-height: 1.55; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #d9e2ef; padding: 9px 10px; text-align: left; vertical-align: top; }
    th { background: #eef3f8; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>OLC4O Lesson Plans</h1>
      <p>The current Moodle folder lists ${names.length} lesson plan files, but each file endpoint returned HTTP 404. They are recorded here as unavailable current-Moodle resources rather than replaced with unverified lesson plans.</p>
      <table>
        <thead><tr><th>#</th><th>Moodle filename</th><th>Localization status</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </article>
  </main>
</body>
</html>
`;
  const abs = join(courseRoot, folderItem.path);
  writeFileSync(abs, html, "utf8");
  folderItem.bytes = statSync(abs).size;
}

function sanitizeHtmlFiles(root) {
  let changed = 0;
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html")) continue;
      const before = readFileSync(path, "utf8");
      const after = before
        .replace(/https:\/\/www\.esunnybrook\.com\/[^"'<> )]+/gi, "#")
        .replace(/https?:\/\/[^"'<> )]+\/pluginfile\.php\/[^"'<> )]+/gi, "#")
        .replace(/href=["']javascript:void\(0\)["']/gi, 'href="#"')
        .replace(/data-pageurl=["'][^"']*["']/gi, 'data-pageurl="#"')
        .replace(/name=["']pageurl["']\s+value=["'][^"']*["']/gi, 'name="pageurl" value="#"');
      if (after !== before) {
        writeFileSync(path, after, "utf8");
        changed++;
      }
    }
  }
  visit(root);
  return changed;
}

function scrubMoodleUrls(manifest) {
  let scrubbed = 0;
  eachResource(manifest, (item) => {
    if (!item) return;
    const id = item.moodleActivityId || /[?&]id=(\d+)/i.exec(`${item.url || item.source || ""}`)?.[1] || "";
    const mod = /moodle_([^/]+)/i.exec(item.category || "")?.[1] || "activity";
    if (/www\.esunnybrook\.com/i.test(item.source || "")) {
      item.source = id ? `authenticated SunnyBrook Moodle ${mod} activity id ${id}` : "authenticated SunnyBrook Moodle activity";
      scrubbed++;
    }
    if (/www\.esunnybrook\.com/i.test(item.url || "")) {
      delete item.url;
      scrubbed++;
    }
    for (const attachment of item.attachments || []) {
      if (/www\.esunnybrook\.com/i.test(attachment.source || "")) {
        attachment.source = "authenticated SunnyBrook Moodle attachment";
        scrubbed++;
      }
    }
  });
  return scrubbed;
}

function removeThemeAttachments(manifest) {
  let removed = 0;
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const before = item.attachments.length;
    item.attachments = item.attachments.filter((attachment) => {
      const haystack = `${attachment.label || ""} ${attachment.path || ""} ${attachment.source || ""}`;
      return !/20260514205240_755_110\.png|theme_remui|monologo/i.test(haystack);
    });
    removed += before - item.attachments.length;
    if (!item.attachments.length) delete item.attachments;
  });
  return removed;
}

function collectStats(manifest) {
  const resources = [];
  eachResource(manifest, (item) => {
    if (!item) return;
    resources.push(item);
    for (const attachment of item.attachments || []) resources.push(attachment);
  });
  const byType = (pattern) => resources.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
  return {
    units: manifest.units?.length || 0,
    lessons: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
    resources: resources.filter((item) => item.path).length,
    html: byType(/html/i),
    pdf: byType(/pdf/i),
    doc: byType(/docx?$/i),
    images: byType(/png|jpe?g/i),
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
    attachments: resources.reduce((sum, item) => sum + (item.attachments?.length || 0), 0),
  };
}

function updateUnitSummaries(manifest) {
  for (const unit of manifest.units || []) {
    const resources = [];
    const add = (item) => {
      if (!item) return;
      resources.push(item);
      for (const attachment of item.attachments || []) resources.push(attachment);
    };
    add(unit.unitPlan);
    for (const resource of Object.values(unit.unitResources || {})) {
      if (Array.isArray(resource)) resource.forEach(add);
      else add(resource);
    }
    for (const lesson of unit.lessons || []) {
      add(lesson.lessonPlan);
      for (const item of lesson.lessonText || []) add(item);
      for (const item of lesson.textExports || []) add(item);
      for (const item of lesson.downloads || []) add(item);
      for (const item of lesson.ispring || []) add(item);
      lesson.resourceCounts = {
        downloads: (lesson.downloads || []).length,
        lessonPlan: lesson.lessonPlan ? 1 : 0,
        ispring: (lesson.ispring || []).length,
      };
    }
    const typeCount = (pattern) => resources.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
    unit.summary = {
      downloads: resources.filter((item) => item.path || item.externalUrl).length,
      ispring: typeCount(/ispring/i),
      docx: typeCount(/docx?/i),
      pdf: typeCount(/pdf/i),
      video: typeCount(/video|mp4/i),
      h5p: typeCount(/h5p/i),
    };
  }
}

function writeSources(stats, folderResult, fixedPdfExtensions, removedThemeAttachments) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const content = `# OLC4O Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 9.
- Structure: legacy Moodle activity course organized by the visible Moodle sections: Introduction, Course Documents, Resources, Unit 1 through Unit 4, and Final Exam.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records.
- Course documents/resources: Course Outline, Online Course Planning, Learning Goals and Success Criteria, discussion rubric, MLA/sample/reference files, grammar worksheets, lesson PDFs/DOCX, assignment/forum pages, culminating project pages, and final exam pages were localized from current Moodle.
- Lesson plan folder: Moodle folder "OLC4O Lesson Plans" exposed ${folderResult.count} lesson plan filenames, but every file endpoint returned HTTP 404. Local unavailable-resource pages were added and no unverified replacement lesson plans were used.
- Text/literature materials: short stories, articles, poems, and speech texts are included only where Moodle lesson/resource files exposed them. No separate textbook package was visible in Moodle.
- iSpring/H5P/video: no iSpring, H5P, or playable video packages were visible in the current Moodle shell.
- Cleanup: fixed ${fixedPdfExtensions} truncated PDF extension, excluded ${removedThemeAttachments} Moodle theme/logo attachment files, and removed Moodle source URLs from local HTML/manifest fields so local files are the primary course content. A stale external Moodle-domain image reference in the Unit 2 advertisement discussion could not be fetched; the available SunnyBrook attachment was retained locally and the stale remote reference was removed.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "OLC4O Sources and Localization Notes",
    type: "md",
    category: "source_notes",
    role: "source_notes",
    path: "texts/SOURCES.md",
    bytes: statSync(sourcesPath).size,
    source: "local localization audit",
  });
}

function updateCatalog(stats) {
  const catalog = readJson(catalogPath);
  const entry = catalog.courses?.find((item) => item.code === course);
  if (entry) {
    entry.title = "Ontario Secondary School Literacy Course, Grade 12, Open";
    entry.level = "Grade 12";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/OLC4O/course-manifest.json";
    entry.baseUrl = "/courseware/OLC4O/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; lesson plan folder files returned 404.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats, folderResult) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Ontario Secondary School Literacy Course, Grade 12, Open";
    entry.level = "Grade 12";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "Moodle course id 9",
      outlineStatus: "ready",
      outlineUrl: "",
      bookCount: 0,
      numberedLessonCount: stats.lessons,
    };
    entry.readiness = {
      units: stats.units,
      lessons: stats.lessons,
      unitPlans: 0,
      lessonPlans: 0,
      lessonPlanExpected: 0,
      missingCourseOutline: false,
      missingIntroduction: false,
      missingUnitPlans: 0,
      missingLessonPlans: folderResult.count,
      textsNeedingReview: 0,
      linkOnlyTexts: 0,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = {
      courseOutlines: 1,
      unitPlans: 0,
      lessonPlans: 0,
      ispringFiles: 0,
      outlineExamples: ["OLC4O Course Outline DOCX"],
    };
    entry.nextActions = folderResult.count
      ? ["Restore or provide confirmed OLC4O lesson plan folder files if these lesson plans should be usable."]
      : [];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const fixedPdfExtensions = fixTruncatedPdfExtension(manifest);
const folderResult = attachUnavailableFolderLessonPlans(manifest);
const removedThemeAttachments = removeThemeAttachments(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
const scrubbedMoodleUrls = scrubMoodleUrls(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
writeSources(stats, folderResult, fixedPdfExtensions, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(stats, folderResult, fixedPdfExtensions, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 9",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  lessonPlanFolderFiles: folderResult.count,
  lessonPlanFolderStatus: folderResult.count ? "folder filenames exposed by Moodle, file endpoints returned HTTP 404" : "no folder files found",
  fixedPdfExtensions,
  removedThemeAttachments,
  htmlFilesChanged,
  scrubbedMoodleUrls,
  localImportStatus: "localized-package-ready",
  textbookStatus: "Moodle lesson/resource files localized; no separate textbook package exposed",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats, folderResult);
console.log(`OLC4O finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; unavailable ${stats.unavailable}.`);
