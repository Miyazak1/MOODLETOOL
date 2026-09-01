import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLAO";
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

function findResource(manifest, predicate) {
  let found = null;
  eachResource(manifest, (item) => {
    if (!found && item && predicate(item)) found = item;
  });
  return found;
}

function unavailableHtml(title, message, detail = "") {
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
    ${detail ? `<p>${htmlEscape(detail)}</p>` : ""}
  </main>
</body>
</html>
`;
}

function attachUnavailableLearningLog(manifest) {
  const item = findResource(manifest, (resource) => resource.moodleActivityId === "4857" || resource.label === "Learning Log");
  if (!item) return false;
  const rel = "localized-moodle-activities/url/course-4857-learning-log-unavailable/index.html";
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    unavailableHtml(
      "Learning Log",
      "This Moodle URL activity was visible in the current ESLAO course shell, but the URL activity endpoint returned HTTP 403 during localization.",
      "No replacement learning-log document was added because no verified current local or public source was available."
    ),
    "utf8"
  );
  item.path = rel;
  item.bytes = statSync(abs).size;
  item.unavailable = true;
  item.unavailableReason = "Moodle URL activity endpoint returned HTTP 403 during localization.";
  delete item.url;
  return true;
}

function rewriteBlockedConjunctionsVideo(manifest) {
  const item = findResource(manifest, (resource) => resource.moodleActivityId === "4910" || /conjunctions/i.test(resource.label || ""));
  if (!item?.path) return { videoCount: 0, rewritten: false, filenames: [] };
  const abs = join(courseRoot, item.path);
  const before = readFileSync(abs, "utf8");
  const urls = [
    ...new Set(
      [...before.matchAll(/https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com\/[^"' <]+\.mp4/gi)].map((match) =>
        match[0].replaceAll("&amp;", "&")
      )
    ),
  ];
  if (!urls.length) return { videoCount: 0, rewritten: false, filenames: [] };
  const filenames = urls.map((url) => {
    try {
      return decodeURIComponent(new URL(url).pathname.split("/").pop() || "video.mp4");
    } catch {
      return "video.mp4";
    }
  });
  const existingAttachments = item.attachments || [];
  const rows = existingAttachments
    .map((attachment) => `<li><a href="${htmlEscape(attachment.path.replace(/^.*\/files\//, "files/"), true)}" download>${htmlEscape(attachment.label || attachment.path)}</a></li>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(item.label || "Grammar: Conjunctions")}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    a { color: #00396f; font-weight: 700; }
    .notice { border: 1px solid #e0b45c; border-radius: 6px; background: #fff8e8; color: #674000; padding: 10px 12px; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(item.label || "Grammar: Conjunctions")}</h1>
      <p>Watch the tutorial.</p>
      <div class="notice">The current Moodle page exposed ${filenames.length} external MP4 reference, but the MP4 endpoint returned HTTP 403 during localization. No broken remote video link was retained in this package.</div>
      <section class="attachments">
        <h2>Files</h2>
        <ul>
${rows}
        </ul>
      </section>
    </article>
  </main>
</body>
</html>
`;
  writeFileSync(abs, html, "utf8");
  item.bytes = statSync(abs).size;
  item.videoDownloadStatus = "blocked-http-403";
  item.videoFileCount = filenames.length;
  item.videoFilenames = filenames;
  return { videoCount: filenames.length, rewritten: true, filenames };
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
    manifest.sourceAudit.coursePage = "Moodle course id 48";
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
    if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(item.source || "")) {
      item.source = "external OSS media reference exposed by Moodle";
      scrubbed++;
    }
    for (const attachment of item.attachments || []) {
      if (/www\.esunnybrook\.com/i.test(attachment.source || "")) {
        attachment.source = "authenticated SunnyBrook Moodle attachment";
        scrubbed++;
      }
      if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(attachment.source || "")) {
        attachment.source = "external OSS media reference exposed by Moodle";
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
    ppt: byType(/pptx?/i),
    images: byType(/png|jpe?g/i),
    video: byType(/video|mp4/i),
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

function writeSources(stats, learningLogAdded, videoResult, removedThemeAttachments) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const videoNote = videoResult.videoCount
    ? `The Unit 3 conjunctions activity exposed ${videoResult.videoCount} external MP4 reference (${videoResult.filenames.join(", ")}), but direct download returned HTTP 403 even with a Moodle referer header; the remote video link was removed and the status is recorded locally.`
    : "No direct downloadable MP4 files were exposed after localization.";
  const content = `# ESLAO Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 48.
- Structure: legacy Moodle activity course organized by the visible Moodle sections: Introduction, Course Outline, Student Syllabus, Lesson Plans, Unit 1 Writing, Unit 2 Canada and Me, Unit 3 Short Stories, Unit 4 Media, ISP, and Final Exam.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} downloaded Moodle attachments.
- Course documents and activities: course outline PDF, success criteria PDF, student syllabus wrapper, attendance/skills/course-document files, unit overview and lesson plans PDF, assignment pages, forums, tests, ISP guidebook, and final exam materials were localized from the current Moodle shell.
- Lesson plans: the current Moodle "Unit Overview and Lesson Plans" PDF is included as the confirmed lesson-plan reference. No separate per-lesson plans were added from unverified sources.
- External URL activities: Moodle URL activities that point to Google Docs/Drive or YouTube are kept as local wrapper pages with their external target recorded, because Moodle did not expose downloadable file packages for those public/external activities.
- Learning Log: ${learningLogAdded ? "the Moodle URL endpoint returned HTTP 403, so a local unavailable-resource page was added." : "no unavailable Learning Log record was found during finalization."}
- Video: ${videoNote}
- iSpring/H5P: no iSpring or H5P packages were visible in the current Moodle shell.
- Textbook/literature: ESLAO exposes short-story/reading resources as Moodle PDFs/DOCX/activities; no separate textbook package was visible in Moodle.
- Cleanup: excluded ${removedThemeAttachments} Moodle theme/logo attachment files and removed Moodle/source-domain URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "ESLAO Sources and Localization Notes",
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
    entry.title = "English as a Second Language, ESL Level 1, Open";
    entry.level = "ESL";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/ESLAO/course-manifest.json";
    entry.baseUrl = "/courseware/ESLAO/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; one Learning Log URL and one external MP4 were unavailable.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats, videoResult) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "English as a Second Language, ESL Level 1, Open";
    entry.level = "ESL";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "Moodle course id 48",
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
      linkOnlyTexts: stats.externalReferences,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = {
      courseOutlines: 1,
      unitPlans: 0,
      lessonPlans: 1,
      ispringFiles: 0,
      outlineExamples: ["ESLAO Course Outline PDF", "ESLAO Level 1 Course Lesson Plans PDF"],
    };
    entry.nextActions = videoResult.videoCount
      ? ["Restore or provide a downloadable copy of the Unit 3 conjunctions MP4 if video playback/download is required."]
      : [];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const learningLogAdded = attachUnavailableLearningLog(manifest);
const videoResult = rewriteBlockedConjunctionsVideo(manifest);
const removedThemeAttachments = removeThemeAttachments(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
const scrubbedSourceUrls = scrubSourceUrls(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
writeSources(stats, learningLogAdded, videoResult, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(stats, learningLogAdded, videoResult, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 48",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  downloadedAttachments: stats.attachments,
  lessonPlanStatus: "current Moodle Unit Overview and Lesson Plans PDF localized",
  blockedLearningLog: learningLogAdded,
  blockedExternalMp4Count: videoResult.videoCount,
  blockedExternalMp4Status: videoResult.videoCount ? "external MP4 endpoint returned HTTP 403; not packaged" : "none exposed",
  removedThemeAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  localImportStatus: "localized-package-ready",
  textbookStatus: "Moodle reading resources localized; no separate textbook package exposed",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats, videoResult);
console.log(`ESLAO finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; unavailable ${stats.unavailable}; external refs ${stats.externalReferences}; blocked mp4 ${videoResult.videoCount}.`);
