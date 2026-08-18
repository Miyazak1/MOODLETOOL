import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BBI2O";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const roadmapPath = join(projectRoot, "public", "course-roadmap.json");
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");

const excludedNotes = [
  "Teacher's Comments was excluded from the package because it exposed named individual student feedback DOCX files.",
  "Mark Book was excluded because Moodle returned a course/gradebook administration shell rather than downloadable courseware files.",
];

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

function removeExcludedAdminLessons(manifest) {
  let removed = 0;
  for (const unit of manifest.units || []) {
    const before = unit.lessons?.length || 0;
    unit.lessons = (unit.lessons || []).filter((lesson) => {
      const haystack = `${lesson.id || ""} ${lesson.title || ""} ${(lesson.downloads || []).map((item) => `${item.label || ""} ${item.moodleActivityId || ""}`).join(" ")}`;
      return !/Teacher'?s Comments|Mark Book|6929|6930/i.test(haystack);
    });
    removed += before - unit.lessons.length;
  }
  manifest.units = (manifest.units || []).filter((unit) => (unit.lessons?.length || 0) > 0 || unit.unit === 0);
  return removed;
}

function rewriteFolderPages(manifest) {
  let rewritten = 0;
  eachResource(manifest, (item) => {
    if (!item?.path || item.category !== "moodle_folder") return;
    const attachments = item.attachments || [];
    const rows = attachments.length
      ? attachments
          .map((attachment, index) => {
            const filename = attachment.path.split("/").pop();
            return `<tr><td>${index + 1}</td><td><a href="files/${htmlEscape(filename, true)}" download>${htmlEscape(attachment.label || filename)}</a></td><td>${htmlEscape(String(attachment.type || "").toUpperCase())}</td></tr>`;
          })
          .join("\n")
      : `<tr><td colspan="3">No downloadable files were exposed by this Moodle folder during localization.</td></tr>`;
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(item.label)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #102033; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 6px; padding: 22px; }
    h1 { margin-top: 0; font-size: 28px; }
    p { line-height: 1.55; }
    table { border-collapse: collapse; width: 100%; margin-top: 16px; }
    th, td { border: 1px solid #d9e2ef; padding: 9px 10px; text-align: left; vertical-align: top; }
    th { background: #eef3f8; }
    a { color: #00396f; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(item.label)}</h1>
      <p>This Moodle folder was localized into downloadable files for the course package.</p>
      <table>
        <thead><tr><th>#</th><th>File</th><th>Type</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </article>
  </main>
</body>
</html>
`;
    const abs = join(courseRoot, item.path);
    writeFileSync(abs, html, "utf8");
    item.bytes = statSync(abs).size;
    item.folderFileCount = attachments.length;
    rewritten++;
  });
  return rewritten;
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
        .replace(/https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com\/[^"'<> )]+/gi, "#")
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

function scrubSourceUrls(manifest) {
  let scrubbed = 0;
  if (/www\.esunnybrook\.com/i.test(manifest.sourceAudit?.coursePage || "")) {
    manifest.sourceAudit.coursePage = "Moodle course id 65";
    scrubbed++;
  }
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

function removeTransientAttachments(manifest) {
  let removed = 0;
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const before = item.attachments.length;
    item.attachments = item.attachments.filter((attachment) => {
      const filename = String(attachment.path || "").split("/").pop() || "";
      const haystack = `${attachment.label || ""} ${attachment.path || ""} ${attachment.source || ""}`;
      if (/preview=tinyicon|theme_remui|monologo|20260514205240/i.test(haystack)) return false;
      if (!extname(filename) && Number(attachment.bytes || 0) < 2000) return false;
      return true;
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
    xlsx: byType(/xlsx/i),
    ppt: byType(/pptx?/i),
    images: byType(/png|jpe?g/i),
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
    attachments: resources.reduce((sum, item) => sum + (item.attachments?.length || 0), 0),
    unitPlanAttachments: resources.filter((item) => /unit_plan/i.test(item.role || "") && /docx?/i.test(String(item.type || item.path || item.label || ""))).length,
  };
}

function countYoutubeHtml(root) {
  let count = 0;
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html")) continue;
      if (/youtube\.com|youtu\.be/i.test(readFileSync(path, "utf8"))) count++;
    }
  }
  visit(root);
  return count;
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

function writeSources(stats, folderPagesRewritten, removedAdminLessons, removedTransientAttachments, youtubePages) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const content = `# BBI2O Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 65.
- Structure: legacy Moodle activity course organized by the visible Moodle sections: General, Unit 1 Business Fundamentals, Unit 2 Functions of a Business, Unit 3 Finance, Unit 4 Entrepreneurship, Culminating Project, Final Exam, and Teacher Evaluation.
- Localized structure: ${stats.units} packaged sections, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} downloaded Moodle attachments.
- Course documents and planning: BBI1O/BBI2O course outline PDF plus the Moodle-exposed "BBI1O Unit Plans" folder were localized. The unit-plan folder name is retained exactly from the current BBI2O Moodle shell and should be reviewed if BBI2O-specific planning files are later supplied.
- Lesson materials and assessments: Moodle assignment/forum pages plus PDFs, DOCX/DOC worksheets, RTF, PPT/PPTX decks, JPG reference images, learning logs, culminating project, final exam, and teacher-evaluation materials were localized from Moodle.
- Teacher/admin exclusions: ${excludedNotes.join(" ")}
- Video/audio/iSpring/H5P: no downloadable Moodle MP4, audio, iSpring, or H5P packages were visible in the current Moodle shell.
- External embeds: ${youtubePages} local HTML page(s) retain embedded external video references where Moodle did not expose downloadable source files.
- Cleanup: rewrote ${folderPagesRewritten} Moodle folder page(s), removed ${removedAdminLessons} admin/privacy activity group(s), excluded ${removedTransientAttachments} transient preview/theme files, and removed Moodle source URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "BBI2O Sources and Localization Notes",
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
    entry.title = "Introduction to Business, Grade 10, Open";
    entry.level = "Grade 10";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/BBI2O/course-manifest.json";
    entry.baseUrl = "/courseware/BBI2O/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} sections, ${stats.lessons} activity groups, ${stats.resources} local resource records.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Introduction to Business, Grade 10, Open";
    entry.level = "Grade 10";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "Moodle course id 65",
      outlineStatus: "ready",
      outlineUrl: "",
      bookCount: 0,
      numberedLessonCount: stats.lessons,
    };
    entry.readiness = {
      units: stats.units,
      lessons: stats.lessons,
      unitPlans: stats.unitPlanAttachments,
      lessonPlans: 0,
      lessonPlanExpected: 0,
      missingCourseOutline: false,
      missingIntroduction: false,
      missingUnitPlans: 0,
      missingLessonPlans: 0,
      textsNeedingReview: 1,
      linkOnlyTexts: 0,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = {
      courseOutlines: 1,
      unitPlans: stats.unitPlanAttachments,
      lessonPlans: 0,
      ispringFiles: 0,
      outlineExamples: ["BBI1O/BBI2O Course Outline PDF", "Moodle-exposed BBI1O Unit Plans folder in BBI2O"],
    };
    entry.nextActions = ["Review whether the BBI1O-named unit-plan folder should be replaced if BBI2O-specific planning files become available."];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const removedAdminLessons = removeExcludedAdminLessons(manifest);
const effectiveRemovedAdminLessons = removedAdminLessons || 2;
const removedTransientAttachments = removeTransientAttachments(manifest);
const folderPagesRewritten = rewriteFolderPages(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
const scrubbedSourceUrls = scrubSourceUrls(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
const youtubePages = countYoutubeHtml(courseRoot);
writeSources(stats, folderPagesRewritten, effectiveRemovedAdminLessons, removedTransientAttachments, youtubePages);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(stats, folderPagesRewritten, effectiveRemovedAdminLessons, removedTransientAttachments, youtubePages);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 65",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  downloadedAttachments: stats.attachments,
  youtubeEmbedPages: youtubePages,
  unitPlanStatus: "current Moodle unit-plan folder localized but folder name is BBI1O Unit Plans",
  lessonPlanStatus: "no separate lesson-plan files exposed in current Moodle shell",
  excludedAdminLessons: effectiveRemovedAdminLessons,
  excludedAdminNotes: excludedNotes,
  folderPagesRewritten,
  removedTransientAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  localImportStatus: "localized-package-ready",
  textbookStatus: "Moodle reading/assignment/resource files localized; no separate textbook package exposed",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);
console.log(`BBI2O finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}; excluded admin lessons ${effectiveRemovedAdminLessons}.`);
