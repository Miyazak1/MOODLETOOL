import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "AVI3M";
const title = "Visual Arts, Grade 11, University/College";
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
    for (const resource of Object.values(unit.unitResources || {})) Array.isArray(resource) ? resource.forEach(callback) : callback(resource);
    for (const lesson of unit.lessons || []) {
      callback(lesson.lessonPlan);
      for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) for (const item of lesson[key] || []) callback(item);
    }
  }
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

function sanitizeHtml(root) {
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

function scrubManifestSources(manifest) {
  let scrubbed = 0;
  if (/www\.esunnybrook\.com/i.test(manifest.sourceAudit?.coursePage || "")) {
    manifest.sourceAudit.coursePage = "Moodle course id 68";
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

function updateUnitSummaries(manifest) {
  for (const unit of manifest.units || []) {
    const resources = [];
    const add = (item) => {
      if (!item) return;
      resources.push(item);
      for (const attachment of item.attachments || []) resources.push(attachment);
    };
    add(unit.unitPlan);
    for (const resource of Object.values(unit.unitResources || {})) Array.isArray(resource) ? resource.forEach(add) : add(resource);
    for (const lesson of unit.lessons || []) {
      add(lesson.lessonPlan);
      for (const key of ["lessonText", "textExports", "downloads", "ispring"]) for (const item of lesson[key] || []) add(item);
      lesson.resourceCounts = { downloads: (lesson.downloads || []).length, lessonPlan: lesson.lessonPlan ? 1 : 0, ispring: (lesson.ispring || []).length };
    }
    const count = (pattern) => resources.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
    unit.summary = {
      downloads: resources.filter((item) => item.path || item.externalUrl).length,
      ispring: count(/ispring/i),
      docx: count(/docx?/i),
      pdf: count(/pdf/i),
      video: count(/video|mp4/i),
      h5p: count(/h5p/i),
    };
  }
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
    attachments: resources.reduce((sum, item) => sum + (item.attachments?.length || 0), 0),
    pdf: byType(/pdf/i),
    docx: byType(/docx?/i),
    images: byType(/png|jpe?g/i),
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
  };
}

function countYoutubeHtml(root) {
  let count = 0;
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html") && /youtube\.com|youtu\.be/i.test(readFileSync(path, "utf8"))) count++;
    }
  }
  visit(root);
  return count;
}

function writeSources(stats, removedTransientAttachments, youtubePages) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const content = `# AVI3M Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 68.
- Structure: Moodle lesson/quiz/assignment/resource course organized by the visible Moodle sections: Announcements, Unit 1 Elements and Principles of Art, Unit 2 Art Criticism, Unit 3 Art of Earliest Times and Ancient Art, Unit 4 Late Nineteenth Century and Post-Impressionism, and ISP/Final Exam.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} downloaded Moodle attachments.
- Course documents: AVI3M course outline, learning log, learning skills/work habits, and online attendance policy DOCX files were localized from Moodle.
- Lesson materials and assessments: Moodle lesson, quiz, assignment, and forum pages plus PDF, DOCX, JPG, and PNG attachments/images were localized from Moodle.
- Planning files: no separate unit-plan or lesson-plan files were exposed in the current Moodle shell.
- Video/audio/iSpring/H5P: no downloadable Moodle MP4, audio, iSpring, or H5P packages were visible in the current Moodle shell.
- External embeds: ${youtubePages} local HTML page(s) retain embedded external video references where Moodle did not expose downloadable source files.
- Cleanup: excluded ${removedTransientAttachments} transient preview/theme files and removed Moodle source URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSources(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "AVI3M Sources and Localization Notes",
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
    entry.title = title;
    entry.level = "Grade 11";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/AVI3M/course-manifest.json";
    entry.baseUrl = "/courseware/AVI3M/";
    entry.notes = `Moodle lesson package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = title;
    entry.level = "Grade 11";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = { coursePage: "Moodle course id 68", outlineStatus: "ready", outlineUrl: "", bookCount: 0, numberedLessonCount: stats.lessons };
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
    entry.localEvidence = { courseOutlines: 1, unitPlans: 0, lessonPlans: 0, ispringFiles: 0, outlineExamples: ["AVI3M Course Outline DOCX"] };
    entry.nextActions = [];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const removedTransientAttachments = removeTransientAttachments(manifest);
const htmlFilesChanged = sanitizeHtml(courseRoot);
const scrubbedSourceUrls = scrubManifestSources(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
const youtubePages = countYoutubeHtml(courseRoot);
writeSources(stats, removedTransientAttachments, youtubePages);
ensureSources(manifest);
stats = collectStats(manifest);
writeSources(stats, removedTransientAttachments, youtubePages);
ensureSources(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 68",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  downloadedAttachments: stats.attachments,
  youtubeEmbedPages: youtubePages,
  unitPlanStatus: "no separate unit-plan files exposed in current Moodle shell",
  lessonPlanStatus: "no separate lesson-plan files exposed in current Moodle shell",
  removedTransientAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  localImportStatus: "localized-package-ready",
  textbookStatus: "Moodle lesson/resource/assignment files localized; no separate textbook package exposed",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);
console.log(`AVI3M finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}.`);
