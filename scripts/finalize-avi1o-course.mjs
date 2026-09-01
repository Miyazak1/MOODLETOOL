import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "AVI1O";
const title = "Visual Arts, Grade 9, Open";
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

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function esc(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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
    for (const resource of Object.values(unit.unitResources || {})) Array.isArray(resource) ? resource.forEach(callback) : callback(resource);
    for (const lesson of unit.lessons || []) {
      callback(lesson.lessonPlan);
      for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) for (const item of lesson[key] || []) callback(item);
    }
  }
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #102033; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 6px; padding: 22px; }
    h1 { margin-top: 0; font-size: 28px; }
    h2 { margin-top: 28px; font-size: 20px; }
    p { line-height: 1.55; }
    a { color: #00396f; font-weight: 700; overflow-wrap: anywhere; }
    .muted { color: #526173; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #d9e2ef; padding: 9px 10px; text-align: left; vertical-align: top; }
    th { background: #eef3f8; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${esc(title)}</h1>
      ${body}
    </article>
  </main>
</body>
</html>
`;
}

function rewriteUrlPages(manifest) {
  let rewritten = 0;
  eachResource(manifest, (item) => {
    if (!item?.path || item.category !== "moodle_url") return;
    let body = "";
    if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(item.externalUrl || "")) {
      item.unavailable = true;
      item.unavailableReason = "External video target returned HTTP 403 during localization.";
      item.unavailableTarget = "external object storage host";
      delete item.externalUrl;
      body = `<p>This Moodle URL video target was not downloadable during localization.</p><p class="muted">${esc(item.unavailableReason)}</p>`;
    } else if (/moodle\.com\/help/i.test(item.externalUrl || "")) {
      item.unavailable = true;
      item.unavailableReason = "Moodle URL target resolves to Moodle help fallback instead of course content.";
      item.unavailableTarget = "Moodle help fallback";
      delete item.externalUrl;
      body = `<p>This Moodle URL target was not usable course content during localization.</p><p class="muted">${esc(item.unavailableReason)}</p>`;
    } else if (item.externalUrl) {
      body = `<p>This Moodle URL points to an external public reference that did not expose a downloadable source file.</p><p><a href="${esc(item.externalUrl, true)}" target="_blank" rel="noreferrer">Open external reference</a></p>`;
    } else if (item.unavailable) {
      body = `<p>This Moodle URL target was not downloadable during localization.</p><p class="muted">${esc(item.unavailableReason || "Unavailable external target.")}</p>`;
    } else {
      body = `<p>No downloadable file was exposed by this Moodle URL activity during localization.</p>`;
    }
    const abs = join(courseRoot, item.path);
    writeFileSync(abs, pageShell(item.label, body), "utf8");
    item.bytes = statSync(abs).size;
    rewritten++;
  });
  return rewritten;
}

function dedupeAttachments(manifest) {
  let removed = 0;
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const seen = new Set();
    const kept = [];
    for (const attachment of item.attachments) {
      const key = `${attachment.label || basename(attachment.path || "")}|${attachment.bytes || 0}`;
      if (seen.has(key)) {
        removed++;
        continue;
      }
      seen.add(key);
      kept.push(attachment);
    }
    item.attachments = kept;
    if (!item.attachments.length) delete item.attachments;
  });
  return removed;
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

function fixImageExtensions(manifest) {
  let fixed = 0;
  eachResource(manifest, (item) => {
    for (const attachment of item?.attachments || []) {
      if (!attachment.path || !/\.png$/i.test(attachment.path)) continue;
      const abs = join(courseRoot, attachment.path);
      if (!existsSync(abs)) continue;
      const bytes = readFileSync(abs);
      if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) continue;
      const nextPath = attachment.path.replace(/\.png$/i, ".jpg");
      const nextAbs = join(courseRoot, nextPath);
      if (!existsSync(nextAbs)) renameSync(abs, nextAbs);
      attachment.path = nextPath;
      attachment.href = toPosix(join(dirname(attachment.href || "files/image.png"), basename(nextPath)));
      attachment.type = "jpg";
      attachment.label = String(attachment.label || basename(nextPath)).replace(/\.png$/i, ".jpg");
      fixed++;
    }
  });
  return fixed;
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
    manifest.sourceAudit.coursePage = "Moodle course id 5";
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
    if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(item.externalUrl || "")) {
      item.unavailable = true;
      item.unavailableReason ||= "External video target returned HTTP 403 during localization.";
      item.unavailableTarget = "external object storage host";
      delete item.externalUrl;
      scrubbed++;
    }
    if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(item.unavailableTarget || "")) {
      item.unavailableTarget = "external object storage host";
      scrubbed++;
    }
    for (const attachment of item.attachments || []) {
      if (/www\.esunnybrook\.com|pluginfile\.php|sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(attachment.source || "")) {
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
      presentation: count(/pptx?/i),
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
    docx: byType(/docx/i),
    doc: byType(/\bdoc\b|\.doc$/i),
    pptx: byType(/pptx/i),
    images: byType(/png|jpe?g/i),
    video: byType(/mp4|video/i),
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
  };
}

function collectUnavailableItems(manifest) {
  const items = [];
  eachResource(manifest, (item) => {
    if (item?.unavailable) items.push({ label: item.label, reason: item.unavailableReason || "Unavailable during localization." });
  });
  return items;
}

function writeSources(stats, unavailableItems, urlPagesRewritten, dedupedAttachments, removedTransientAttachments, fixedImageExtensions) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const unavailableLines = unavailableItems.length
    ? unavailableItems.map((item) => `  - ${item.label}: ${item.reason}`).join("\n")
    : "  - None.";
  const content = `# AVI1O Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 5.
- Structure: legacy Moodle activity/resource course organized by Introduction, Unit 1 Elements and Principles of Design, Unit 2 Shading and Details of Portraiture, Unit 3 Color Theory, Unit 4 Printmaking, Unit 5 Sculpting, and Final Evaluation.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} retained downloaded attachments.
- Course documents: AVI1O course outline PDF, art supplies DOCX, everyday sketch assignment, blank teacher learning-skills rubric, and blank teacher-comments template were localized from Moodle.
- Lesson materials and assessments: Moodle assignment, forum, page, URL, and resource pages plus PDF, DOC/DOCX, PPTX, JPG, and PNG files were localized from Moodle.
- Planning files: no separate unit-plan or lesson-plan files were exposed in the current Moodle shell.
- Teacher resources: teacher learning-skills PDF and teacher-comments DOCX were retained as blank templates; no named student feedback files were found in the retained package.
- External URL localization: direct Moodle URL video files hosted on external object storage returned HTTP 403 and could not be downloaded. Public YouTube references remain external where Moodle did not expose downloadable source files.
- Unavailable URL targets: ${stats.unavailable} URL activity target(s) were unavailable during localization.
${unavailableLines}
- Video/audio/iSpring/H5P: no Moodle audio, iSpring, or H5P packages were visible; ${stats.unavailable} external MP4 URL target(s) could not be downloaded because the host returned HTTP 403.
- Cleanup: rewrote ${urlPagesRewritten} URL page(s), removed ${dedupedAttachments} duplicate attachment reference(s), corrected ${fixedImageExtensions} image extension(s), excluded ${removedTransientAttachments} transient preview/theme files, and removed Moodle source URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSources(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "AVI1O Sources and Localization Notes",
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
    entry.level = "Grade 9";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/AVI1O/course-manifest.json";
    entry.baseUrl = "/courseware/AVI1O/";
    entry.notes = `Legacy Moodle visual-arts package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; ${stats.unavailable} external video target(s) marked unavailable.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = title;
    entry.level = "Grade 9";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = { coursePage: "Moodle course id 5", outlineStatus: "ready", outlineUrl: "", bookCount: 0, numberedLessonCount: stats.lessons };
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
      textsNeedingReview: stats.unavailable,
      linkOnlyTexts: stats.externalReferences,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = { courseOutlines: 1, unitPlans: 0, lessonPlans: 0, ispringFiles: 0, outlineExamples: ["AVI1O Course Outline PDF"] };
    entry.nextActions = stats.unavailable ? ["Review AVI1O external MP4 URL targets if object-storage access becomes available."] : [];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const urlPagesRewritten = rewriteUrlPages(manifest);
const dedupedAttachments = dedupeAttachments(manifest);
const removedTransientAttachments = removeTransientAttachments(manifest);
const fixedImageExtensions = fixImageExtensions(manifest);
const htmlFilesChanged = sanitizeHtml(courseRoot);
const scrubbedSourceUrls = scrubManifestSources(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
let unavailableItems = collectUnavailableItems(manifest);
writeSources(stats, unavailableItems, urlPagesRewritten, dedupedAttachments, removedTransientAttachments, fixedImageExtensions);
ensureSources(manifest);
stats = collectStats(manifest);
unavailableItems = collectUnavailableItems(manifest);
writeSources(stats, unavailableItems, urlPagesRewritten, dedupedAttachments, removedTransientAttachments, fixedImageExtensions);
ensureSources(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 5",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  downloadedAttachments: stats.attachments,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  unitPlanStatus: "no separate unit-plan files exposed in current Moodle shell",
  lessonPlanStatus: "no separate lesson-plan files exposed in current Moodle shell",
  teacherResourceStatus: "blank teacher learning-skills rubric and teacher-comments template retained; no named student feedback found",
  urlPagesRewritten,
  dedupedAttachments,
  fixedImageExtensions,
  removedTransientAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  localImportStatus: "localized-package-ready",
  textbookStatus: "Moodle visual arts activity/resource files localized; no separate textbook package exposed",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);
console.log(`AVI1O finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}; unavailable ${stats.unavailable}.`);
