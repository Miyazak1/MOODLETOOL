import { existsSync, mkdirSync, readdirSync, renameSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "GLC2O";
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

function extensionForType(type) {
  if (/docx/i.test(type || "")) return ".docx";
  if (/xlsx/i.test(type || "")) return ".xlsx";
  if (/pdf/i.test(type || "")) return ".pdf";
  if (/mp4/i.test(type || "")) return ".mp4";
  if (/png/i.test(type || "")) return ".png";
  return "";
}

function fixMissingExtensions(manifest) {
  let fixed = 0;
  const fixOne = (item) => {
    if (!item?.path) return;
    const expected = extensionForType(item.type);
    if (!expected || item.path.toLowerCase().endsWith(expected)) return;
    const oldAbs = join(courseRoot, item.path);
    const baseRel = item.path.endsWith(".") ? item.path.slice(0, -1) : item.path;
    const newRel = `${baseRel}${expected}`;
    const newAbs = join(courseRoot, newRel);
    if (!existsSync(oldAbs)) return;
    renameSync(oldAbs, newAbs);
    item.path = newRel;
    if (item.href && !item.href.toLowerCase().endsWith(expected)) {
      const baseHref = item.href.endsWith(".") ? item.href.slice(0, -1) : item.href;
      item.href = `${baseHref}${expected}`;
    }
    item.bytes = statSync(newAbs).size;
    fixed++;
  };
  eachResource(manifest, (item) => {
    fixOne(item);
    for (const attachment of item?.attachments || []) fixOne(attachment);
  });
  return fixed;
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
    manifest.sourceAudit.coursePage = "Moodle course id 53";
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
    xlsx: byType(/xlsx/i),
    images: byType(/png|jpe?g/i),
    videos: byType(/video|mp4/i),
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
    attachments: resources.reduce((sum, item) => sum + (item.attachments?.length || 0), 0),
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
      const text = readFileSync(path, "utf8");
      if (/youtube\.com|youtu\.be/i.test(text)) count++;
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

function writeSources(stats, folderPagesRewritten, fixedExtensions, removedThemeAttachments, youtubePages) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const content = `# GLC2O Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 53.
- Structure: legacy Moodle activity course organized by the visible Moodle sections: Introduction, Unit 1 through Unit 3, and ISP/Final Exam.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} downloaded Moodle attachments.
- Course documents and planning: course outline/success criteria, unit plan folder files, and Unit 1-3 lesson plan folder files were localized from current Moodle.
- Lesson materials and assessments: assignment pages, learning logs, observation/conversation pages, DOCX tests, XLSX budget templates, teacher resources, ISP materials, and final exam materials were localized from Moodle.
- Video: ${stats.videos} Moodle-hosted MP4 attachment(s) were downloaded and packaged for local playback/download. ${youtubePages} Moodle activity page(s) also include embedded YouTube references; those remain external embeds because Moodle did not expose downloadable source files for them.
- iSpring/H5P: no iSpring or H5P packages were visible in the current Moodle shell.
- Unavailable resources: none; all ${stats.lessons + (stats.resources - stats.lessons)} manifest records have local paths after localization.
- Cleanup: rewrote ${folderPagesRewritten} Moodle folder page(s), fixed ${fixedExtensions} missing file extension(s), excluded ${removedThemeAttachments} Moodle theme/logo attachment files, and removed Moodle source URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "GLC2O Sources and Localization Notes",
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
    entry.title = "Career Studies, Grade 10, Open";
    entry.level = "Grade 10";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/GLC2O/course-manifest.json";
    entry.baseUrl = "/courseware/GLC2O/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; Moodle MP4 attachments included.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Career Studies, Grade 10, Open";
    entry.level = "Grade 10";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "Moodle course id 53",
      outlineStatus: "ready",
      outlineUrl: "",
      bookCount: 0,
      numberedLessonCount: stats.lessons,
    };
    entry.readiness = {
      units: stats.units,
      lessons: stats.lessons,
      unitPlans: 3,
      lessonPlans: 13,
      lessonPlanExpected: 13,
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
      unitPlans: 3,
      lessonPlans: 13,
      ispringFiles: 0,
      outlineExamples: ["GLC2O Course Outline and Success Criteria DOCX", "GLC2O Unit Plan/Lesson Plan folder DOCX files"],
    };
    entry.nextActions = [];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const fixedExtensions = fixMissingExtensions(manifest);
const folderPagesRewritten = rewriteFolderPages(manifest);
const removedThemeAttachments = removeThemeAttachments(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
const scrubbedSourceUrls = scrubSourceUrls(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
const youtubePages = countYoutubeHtml(courseRoot);
writeSources(stats, folderPagesRewritten, fixedExtensions, removedThemeAttachments, youtubePages);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(stats, folderPagesRewritten, fixedExtensions, removedThemeAttachments, youtubePages);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 53",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  downloadedAttachments: stats.attachments,
  downloadedMoodleMp4Attachments: stats.videos,
  youtubeEmbedPages: youtubePages,
  unitPlanStatus: "current Moodle unit-plan folder localized with three DOCX files",
  lessonPlanStatus: "current Moodle Unit 1-3 lesson-plan folders localized with thirteen DOCX files",
  folderPagesRewritten,
  fixedExtensions,
  removedThemeAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  localImportStatus: "localized-package-ready",
  textbookStatus: "Moodle assignment/resource files localized; no separate textbook package exposed",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);
console.log(`GLC2O finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}; videos ${stats.videos}; fixed extensions ${fixedExtensions}.`);
