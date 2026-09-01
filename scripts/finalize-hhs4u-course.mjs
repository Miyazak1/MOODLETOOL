import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "HHS4U";
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

function unavailableHtml(title, message) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #102033; }
    main { max-width: 920px; margin: 56px auto; padding: 28px; background: #fff; border: 1px solid #d8e1ed; border-radius: 6px; }
    h1 { margin: 0 0 14px; font-size: 26px; }
    p { line-height: 1.55; }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(title)}</h1>
    <p>${htmlEscape(message)}</p>
    <p>No replacement content was added because no verified current local or public source was available.</p>
  </main>
</body>
</html>
`;
}

function attachUnavailableResources(manifest) {
  let added = 0;
  eachResource(manifest, (item) => {
    if (!item || item.path || item.externalUrl) return;
    const id = item.moodleActivityId || "unknown";
    const rel = `localized-moodle-activities/unavailable/${id}/index.html`;
    const abs = join(courseRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(
      abs,
      unavailableHtml(item.label || "Unavailable Moodle Resource", "This resource was visible in the current HHS4U Moodle course shell, but the Moodle resource endpoint returned HTTP 404 during localization."),
      "utf8"
    );
    item.path = rel;
    item.bytes = statSync(abs).size;
    item.unavailable = true;
    item.unavailableReason = "Moodle resource endpoint returned HTTP 404 during localization.";
    delete item.url;
    added++;
  });
  return added;
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
    manifest.sourceAudit.coursePage = "Moodle course id 54";
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

function writeSources(stats, unavailableAdded, folderPagesRewritten, removedThemeAttachments) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const content = `# HHS4U Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 54.
- Structure: legacy Moodle activity course organized by the visible Moodle sections: Introduction, Resources, Unit 1 through Unit 5, Culminating Project, and Final Examination.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} downloaded Moodle attachments.
- Course documents and resources: course outline DOC, course planning DOC, Ontario curriculum PDF, glossary, plagiarism/citation resources, chapter PDFs, research-skill PDFs, assignment/forum pages, ISP materials, and final exam materials were localized from current Moodle.
- Lesson plans: the current Moodle "HHS4U Lesson Plans" folder downloaded one DOCX lesson-plan file and is included as the confirmed lesson-plan reference.
- Textbook/chapters: Moodle exposes chapter PDFs as lesson resources. Chapter 8 was visible but returned HTTP 404, so a local unavailable page was added and no replacement chapter was introduced.
- Final exam folder: the Moodle final exam folder downloaded one PDF and was rewritten as a local file-list page.
- iSpring/H5P/video: no iSpring, H5P, or playable video packages were visible in the current Moodle shell.
- Unavailable resources: ${unavailableAdded} current Moodle resource(s) returned HTTP 404 and are recorded with local unavailable pages.
- Cleanup: rewrote ${folderPagesRewritten} Moodle folder page(s), excluded ${removedThemeAttachments} Moodle theme/logo attachment files, and removed Moodle source URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "HHS4U Sources and Localization Notes",
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
    entry.title = "Families in Canada, Grade 12, University Preparation";
    entry.level = "Grade 12";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/HHS4U/course-manifest.json";
    entry.baseUrl = "/courseware/HHS4U/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; two current Moodle resources returned 404.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Families in Canada, Grade 12, University Preparation";
    entry.level = "Grade 12";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "Moodle course id 54",
      outlineStatus: "ready",
      outlineUrl: "",
      bookCount: 0,
      numberedLessonCount: stats.lessons,
    };
    entry.readiness = {
      units: stats.units,
      lessons: stats.lessons,
      unitPlans: 0,
      lessonPlans: 1,
      lessonPlanExpected: 1,
      missingCourseOutline: false,
      missingIntroduction: false,
      missingUnitPlans: 0,
      missingLessonPlans: 0,
      textsNeedingReview: 0,
      linkOnlyTexts: 0,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = {
      courseOutlines: 1,
      unitPlans: 0,
      lessonPlans: 1,
      ispringFiles: 0,
      outlineExamples: ["HHS4U Course Outline DOC", "HHS4U Lesson Plans DOCX"],
    };
    entry.nextActions = ["Restore HHS4U Learning Goals and Chapter 8 files in Moodle if those 404 resources should be usable."];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const unavailableAdded = attachUnavailableResources(manifest);
const folderPagesRewritten = rewriteFolderPages(manifest);
const removedThemeAttachments = removeThemeAttachments(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
const scrubbedSourceUrls = scrubSourceUrls(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
writeSources(stats, unavailableAdded, folderPagesRewritten, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(stats, unavailableAdded, folderPagesRewritten, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 54",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  downloadedAttachments: stats.attachments,
  lessonPlanStatus: "current Moodle lesson-plan folder localized with one DOCX",
  unavailableResourceCount: unavailableAdded,
  folderPagesRewritten,
  removedThemeAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  localImportStatus: "localized-package-ready",
  textbookStatus: "Moodle chapter PDFs localized; Chapter 8 endpoint returned 404",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);
console.log(`HHS4U finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}; unavailable ${stats.unavailable}.`);
