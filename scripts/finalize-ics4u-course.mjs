import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ICS4U";
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

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function unavailableHtml(label, reason) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(label)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 880px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 16px; border-bottom: 1px solid #edf1f6; padding-bottom: 12px; }
    .notice { border: 1px solid #e0b45c; border-radius: 6px; background: #fff8e8; color: #674000; padding: 10px 12px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(label)}</h1>
      <p class="notice">${htmlEscape(reason)}</p>
      <p>This local page records the unavailable Moodle resource so the course package does not keep a broken Moodle link as primary content.</p>
    </article>
  </main>
</body>
</html>
`;
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

function fillUnavailableResources(manifest) {
  const filled = [];
  eachResource(manifest, (item) => {
    if (!item || item.path || !item.url || item.category !== "moodle_resource") return;
    const activityId = item.moodleActivityId || /id=(\d+)/.exec(item.url || "")?.[1] || item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const slug = item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const rel = `localized-moodle-activities/unavailable/${activityId}-${slug}/index.html`;
    const abs = join(courseRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const reason = "The current Moodle resource activity returned HTTP 404 during localization.";
    writeFileSync(abs, unavailableHtml(item.label, reason), "utf8");
    item.path = rel;
    item.type = "html";
    item.bytes = statSync(abs).size;
    item.source = item.url || item.source || "authenticated SunnyBrook Moodle crawl";
    item.unavailable = true;
    item.unavailableReason = reason;
    delete item.url;
    delete item.externalUrl;
    filled.push(item.label);
  });
  return filled;
}

function removeFailedAttachments(manifest) {
  const removed = [];
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const keep = [];
    for (const attachment of item.attachments) {
      if (attachment.path) {
        keep.push(attachment);
        continue;
      }
      removed.push({
        parent: item.label,
        label: attachment.label || attachment.source || "unnamed attachment",
        error: attachment.error || "download failed",
      });
    }
    if (keep.length) item.attachments = keep;
    else delete item.attachments;
  });
  return removed;
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
    docx: byType(/docx/i),
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
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

function writeSources(stats, unavailableItems, failedAttachments) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const failedAttachmentText = failedAttachments.length
    ? failedAttachments.map((item) => `${item.parent}: ${item.error}`).join("; ")
    : "none";
  const content = `# ICS4U Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, https://www.esunnybrook.com/course/view.php?id=37
- Structure: legacy Moodle activity course organized by the visible Moodle sections: course documents, Java programming units, UML/object-oriented programming, algorithms, software development, and final evaluation.
- Localized structure: ${stats.units} units, ${stats.lessons} numbered lesson/activity groups, ${stats.resources} local resource records.
- Course documents and activities: Moodle course outline, available lesson DOCX files, assignments, forums, quizzes, final culminating activity page, and final exam page were localized where available.
- Unavailable Moodle lesson resources: ${unavailableItems.length ? unavailableItems.join(", ") : "none"}.
- Failed Moodle attachments: ${failedAttachmentText}.
- iSpring/H5P: no iSpring or H5P packages were visible in the current Moodle shell.
- Textbook: no course textbook was exposed in the current Moodle shell; none was added.
- External URL activities: none exposed by the current Moodle shell.
- Lesson plans: no separate lesson plan files were added because this legacy shell does not expose confirmed current lesson plans.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "ICS4U Sources and Localization Notes",
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
    entry.title = "Computer Science, Grade 12, University";
    entry.level = "Grade 12";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/ICS4U/course-manifest.json";
    entry.baseUrl = "/courseware/ICS4U/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} numbered lessons; ${stats.unavailable} Moodle resources currently 404.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Computer Science, Grade 12, University";
    entry.level = "Grade 12";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "https://www.esunnybrook.com/course/view.php?id=37",
      outlineStatus: "ready",
      outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=3829",
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
      lessonPlans: 0,
      ispringFiles: 0,
      outlineExamples: ["localized-moodle-activities/resource/course-3829-42dd790850/42dd790850-ICS4U-Course-outline.docx"],
    };
    entry.nextActions = [
      "Replace unavailable Moodle lesson resources if the current source files are restored.",
      "Add a textbook only if a confirmed current ICS4U Moodle/local source is provided.",
    ];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const unavailableItems = fillUnavailableResources(manifest);
const failedAttachments = removeFailedAttachments(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
writeSources(stats, unavailableItems, failedAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(stats, unavailableItems, failedAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  failedAttachmentCount: failedAttachments.length,
  htmlFilesChanged,
  localImportStatus: "localized-package-ready",
  textbookStatus: "no textbook exposed in current Moodle shell",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);

console.log(JSON.stringify({ course, stats, unavailableItems, failedAttachments, htmlFilesChanged, sourcesPath }, null, 2));
