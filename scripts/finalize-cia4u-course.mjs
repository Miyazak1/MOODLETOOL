import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "CIA4U";
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
    .slice(0, 72) || "resource";
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

function unavailableHtml(item) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${htmlEscape(item.label)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f5f7fb; color: #102033; }
    main { max-width: 920px; margin: 56px auto; padding: 30px; background: #fff; border: 1px solid #d8e1ed; border-radius: 6px; }
    h1 { margin-top: 0; font-size: 26px; }
    p { line-height: 1.55; }
    code { background: #eef3f8; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(item.label)}</h1>
    <p>This Moodle resource was listed in the current CIA4U course shell, but the file endpoint returned HTTP 404 during localization.</p>
    <p>No replacement content was added because a verified current local file was not available.</p>
    <p>Moodle activity id: <code>${htmlEscape(item.moodleActivityId || "unknown")}</code></p>
  </main>
</body>
</html>
`;
}

function localizeUnavailableResources(manifest) {
  let count = 0;
  eachResource(manifest, (item) => {
    if (!item?.url || item.path || !/www\.esunnybrook\.com\/mod\//i.test(item.url)) return;
    const mod = /\/mod\/([^/]+)\//i.exec(item.url)?.[1]?.toLowerCase() || "resource";
    const id = item.moodleActivityId || /[?&]id=(\d+)/i.exec(item.url)?.[1] || "unknown";
    const rel = `localized-moodle-activities/unavailable/${id}-${sanitizeSegment(item.label)}/index.html`;
    const abs = join(courseRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, unavailableHtml(item), "utf8");
    item.path = rel;
    item.bytes = statSync(abs).size;
    item.type = "html";
    item.category = item.category || `moodle_${mod}`;
    item.unavailable = true;
    item.unavailableReason = "Moodle file endpoint returned HTTP 404 during localization.";
    item.source = `authenticated SunnyBrook Moodle ${mod} activity id ${id} (HTTP 404)`;
    delete item.url;
    count++;
  });
  return count;
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
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
    lessonPlan404: resources.filter((item) => item.role === "lesson_plan" && item.unavailable).length,
    chapter404: resources.filter((item) => item.role === "chapter_reading" && item.unavailable).length,
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
      video: typeCount(/video|mp4|youtube/i),
      h5p: typeCount(/h5p/i),
    };
  }
}

function writeSources(stats, unavailableCreated, removedThemeAttachments) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const content = `# CIA4U Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 40.
- Structure: legacy Moodle activity course organized by the visible Moodle sections: Introduction, Week 1 through Week 8, and Final Exam.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records.
- Course documents and activities: Moodle forum/page shells, assignments, discussion activities, URL wrappers, and final exam submission page were localized where available.
- External URL activities: ${stats.externalReferences} Moodle URL activities were localized as local wrapper pages. These mostly point to public YouTube videos, plus CBC and Natural Resources Canada article/reference pages; no direct downloadable video file was exposed by Moodle.
- Unavailable Moodle resources: ${stats.unavailable} resources returned HTTP 404 and were replaced with local unavailable-resource pages. This includes Course Outline, Learning Skills and Work Habits, Online Attendance Policy, Learning Log, ${stats.lessonPlan404} Lesson Plan files, ${stats.chapter404} chapter/notes files, and 2 Final Exam resource files.
- Lesson plans: lesson plan entries exposed by the current shell were not promoted as usable lesson plans because their file endpoints returned HTTP 404.
- Textbook: the visible Chapter 1-7 files appear to be the course reading/text package, but all chapter resource endpoints returned HTTP 404. No verified CIA4U textbook was found in the local docs folder, so no textbook was added.
- iSpring/H5P: no iSpring or H5P packages were visible in the current Moodle shell.
- Cleanup: created ${unavailableCreated} unavailable-resource pages, excluded ${removedThemeAttachments} Moodle theme/logo attachment files, and removed Moodle source URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "CIA4U Sources and Localization Notes",
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
    entry.title = "Analysing Current Economic Issues, Grade 12, University";
    entry.level = "Grade 12";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/CIA4U/course-manifest.json";
    entry.baseUrl = "/courseware/CIA4U/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} activity groups; ${stats.unavailable} current Moodle file resources returned 404.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Analysing Current Economic Issues, Grade 12, University";
    entry.level = "Grade 12";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "Moodle course id 40",
      outlineStatus: "moodle-404",
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
      missingCourseOutline: true,
      missingIntroduction: false,
      missingUnitPlans: 0,
      missingLessonPlans: stats.lessonPlan404,
      textsNeedingReview: 0,
      linkOnlyTexts: 0,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = {
      courseOutlines: 0,
      unitPlans: 0,
      lessonPlans: 0,
      ispringFiles: 0,
      outlineExamples: [],
    };
    entry.nextActions = [
      "Provide confirmed current CIA4U chapter/textbook files if the Moodle 404 resources are restored or supplied locally.",
      "Provide a confirmed current CIA4U course outline if one should replace the 404 Moodle outline entry.",
      "Spot-check external YouTube/CBC/NRCan wrappers in browser QA.",
    ];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const unavailableCreated = localizeUnavailableResources(manifest);
const removedThemeAttachments = removeThemeAttachments(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
const scrubbedMoodleUrls = scrubMoodleUrls(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
writeSources(stats, unavailableCreated, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(stats, unavailableCreated, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 40",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  lessonPlan404: stats.lessonPlan404,
  chapter404: stats.chapter404,
  unavailableCreated,
  removedThemeAttachments,
  htmlFilesChanged,
  scrubbedMoodleUrls,
  missingCourseOutline: true,
  localImportStatus: "localized-package-ready",
  textbookStatus: "chapter resources exposed by Moodle returned HTTP 404; no verified local textbook added",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);
console.log(`CIA4U finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; unavailable ${stats.unavailable}; external ${stats.externalReferences}.`);
