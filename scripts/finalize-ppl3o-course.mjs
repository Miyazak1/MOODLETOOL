import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "PPL3O";
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

function writeSources(manifest, stats, removedThemeAttachments) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const videoFailures = manifest.sourceAudit?.recordedVideoLocalizationFailures || [];
  const videoFailureText = videoFailures.length
    ? videoFailures.map((item) => `${item.label}: ${item.error}`).join("; ")
    : "none";
  const content = `# PPL3O Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, https://www.esunnybrook.com/course/view.php?id=58
- Structure: legacy Moodle activity course organized by the visible Moodle sections: course documents/recorded classes, four health and active living units, independent study project, and final exam.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records.
- Course documents and activities: Moodle course outline, lesson PDFs, assignment pages, rubrics, student handouts, ISP, and final exam files were localized where available.
- Recorded classes/videos: 5 Moodle URL activities were localized as local wrapper pages. The two direct OSS MP4 targets returned HTTP 403 when downloading the original video file, so no local MP4 copy was added. Zoom/OneDrive recordings did not expose a direct downloadable file during this crawl.
- Recorded video download failures: ${videoFailureText}.
- iSpring/H5P: no iSpring or H5P packages were visible in the current Moodle shell.
- Textbook: no course textbook was exposed in the current Moodle shell; none was added.
- External URL activities: valid recorded-class targets are kept as local wrapper pages with external references. Moodle dashboard/javascript placeholders were removed.
- Unavailable Moodle activities: none.
- Cleanup: excluded ${removedThemeAttachments} Moodle theme/logo attachment files from the manifest so they are not packaged as course content.
- Lesson plans: no separate lesson plan files were added because this legacy shell does not expose confirmed current lesson plans.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "PPL3O Sources and Localization Notes",
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
    entry.title = "Healthy Active Living Education, Grade 11, Open";
    entry.level = "Grade 11";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/PPL3O/course-manifest.json";
    entry.baseUrl = "/courseware/PPL3O/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} lessons; recorded classes retained as wrappers where direct video download was blocked.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Healthy Active Living Education, Grade 11, Open";
    entry.level = "Grade 11";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "https://www.esunnybrook.com/course/view.php?id=58",
      outlineStatus: "ready",
      outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=5747",
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
      outlineExamples: ["localized-moodle-activities/resource/course-5747-843191b166/843191b166-PPL3O-Course-Outline.doc"],
    };
    entry.nextActions = [
      "Replace recorded class wrappers with local MP4 files if downloadable source files are provided or restored.",
      "Add a textbook only if a confirmed current PPL3O Moodle/local source is provided.",
    ];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const removedThemeAttachments = removeThemeAttachments(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
writeSources(manifest, stats, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(manifest, stats, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  removedThemeAttachments,
  htmlFilesChanged,
  localImportStatus: "localized-package-ready",
  textbookStatus: "no textbook exposed in current Moodle shell",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);

console.log(JSON.stringify({ course, stats, removedThemeAttachments, htmlFilesChanged, sourcesPath }, null, 2));
