import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BAF3M";
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

function rewriteRecordedVideosPage(manifest) {
  const item = findResource(manifest, (resource) => resource.moodleActivityId === "3374" || /recorded videos/i.test(resource.label || ""));
  if (!item?.path) return { videoCount: 0, rewritten: false };
  const abs = join(courseRoot, item.path);
  const before = readFileSync(abs, "utf8");
  const urls = [...new Set([...before.matchAll(/https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com\/[^"' <]+\.mp4/gi)].map((match) => match[0].replaceAll("&amp;", "&")))];
  const filenames = urls.map((url) => {
    try {
      return decodeURIComponent(new URL(url).pathname.split("/").pop() || "recorded-video.mp4");
    } catch {
      return "recorded-video.mp4";
    }
  });
  if (!urls.length) return { videoCount: 0, rewritten: false };
  const rows = filenames
    .map((name, index) => `<tr><td>${index + 1}</td><td>${htmlEscape(name)}</td><td>External MP4 returned HTTP 403 during localization; no verified local copy was available.</td></tr>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>recorded videos</title>
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
      <h1>recorded videos</h1>
      <p>The current Moodle lesson exposed ${urls.length} recorded MP4 file references. Each MP4 endpoint returned HTTP 403 during localization, so no unverified or broken video file was added to the package.</p>
      <table>
        <thead><tr><th>#</th><th>Moodle video filename</th><th>Localization status</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </article>
  </main>
</body>
</html>
`;
  writeFileSync(abs, html, "utf8");
  item.bytes = statSync(abs).size;
  item.videoDownloadStatus = "blocked-http-403";
  item.videoFileCount = urls.length;
  item.videoFilenames = filenames;
  return { videoCount: urls.length, rewritten: true };
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

function writeSources(stats, videoResult, removedThemeAttachments) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const content = `# BAF3M Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 32.
- Structure: legacy Moodle activity course organized by the visible Moodle sections: Introduction, Week 1 and 2 through Week 6, Culminating Project, and Final Exam.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} downloaded Moodle attachments.
- Course documents and activities: BAF3M Course Outline PDF, Board Notes page with image attachment, chapter/class-note PDFs, DOCX worksheets/tests, PPTX teaching materials, assignment pages, forums, culminating project, and final exam materials were localized from the current Moodle shell.
- Recorded videos: the Moodle lesson exposed ${videoResult.videoCount} external MP4 filenames. Direct download attempts returned HTTP 403 even with Moodle referer headers, so the recorded-videos page was converted to a local status page instead of packaging broken media links.
- iSpring/H5P: no iSpring or H5P packages were visible in the current Moodle shell.
- Textbook: no separate textbook package was exposed. The accounting chapter resources visible in Moodle were downloaded as lesson materials.
- Lesson plans: no separate confirmed current lesson plan files were exposed in this legacy shell.
- Cleanup: excluded ${removedThemeAttachments} Moodle theme/logo attachment files and removed Moodle/external OSS source URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourceNotes(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "BAF3M Sources and Localization Notes",
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
    entry.title = "Financial Accounting Fundamentals, Grade 11, University/College";
    entry.level = "Grade 11";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/BAF3M/course-manifest.json";
    entry.baseUrl = "/courseware/BAF3M/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; recorded MP4 endpoints returned 403.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats, videoResult) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Financial Accounting Fundamentals, Grade 11, University/College";
    entry.level = "Grade 11";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "Moodle course id 32",
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
      outlineExamples: ["BAF3M Course Outline PDF"],
    };
    entry.nextActions = videoResult.videoCount
      ? ["Restore or provide downloadable BAF3M recorded MP4 files if video playback/download is required."]
      : [];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const videoResult = rewriteRecordedVideosPage(manifest);
const removedThemeAttachments = removeThemeAttachments(manifest);
const htmlFilesChanged = sanitizeHtmlFiles(courseRoot);
const scrubbedSourceUrls = scrubSourceUrls(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
writeSources(stats, videoResult, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
writeSources(stats, videoResult, removedThemeAttachments);
ensureSourceNotes(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 32",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  downloadedAttachments: stats.attachments,
  recordedVideoCount: videoResult.videoCount,
  recordedVideoStatus: videoResult.videoCount ? "external MP4 endpoints returned HTTP 403; not packaged" : "none exposed",
  removedThemeAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  localImportStatus: "localized-package-ready",
  textbookStatus: "Moodle chapter resources localized; no separate textbook package exposed",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats, videoResult);
console.log(`BAF3M finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}; recorded videos ${videoResult.videoCount}.`);
