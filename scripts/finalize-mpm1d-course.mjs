import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MPM1D";
const title = "Principles of Mathematics, Grade 9, Academic";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const roadmapPath = join(projectRoot, "public", "course-roadmap.json");
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");

const externalDownloadDir = "texts/external-url-targets";
const namedStudentChecklist = /(?:Observation|Conversation)-Checklist-Unit-?\d+-Tan\.pdf|Conversation-Checklist-Unit2-Tan\.pdf/i;
const scrubPatterns = /www\.esunnybrook\.com|pluginfile\.php|sisonline\.oss-cn-hongkong\.aliyuncs\.com|javascript:void\(0\)/i;

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
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function hash(value) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 10);
}

function eachResource(manifest, callback) {
  for (const item of manifest.courseDownloads || []) callback(item, { area: "courseDownloads" });
  for (const text of manifest.texts || []) {
    callback(text, { area: "texts" });
    for (const material of text.materials || []) callback(material, { area: "text.materials" });
  }
  for (const unit of manifest.units || []) {
    callback(unit.unitPlan, { area: "unitPlan", unit });
    for (const resource of Object.values(unit.unitResources || {})) {
      if (Array.isArray(resource)) resource.forEach((item) => callback(item, { area: "unitResources", unit }));
      else callback(resource, { area: "unitResources", unit });
    }
    for (const lesson of unit.lessons || []) {
      callback(lesson.lessonPlan, { area: "lessonPlan", unit, lesson });
      for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) {
        for (const item of lesson[key] || []) callback(item, { area: key, unit, lesson });
      }
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
    p { line-height: 1.55; }
    a { color: #00396f; font-weight: 700; overflow-wrap: anywhere; }
    .muted { color: #526173; }
    .notice { border-left: 4px solid #c27c00; background: #fff7e6; padding: 12px 14px; }
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

function ensureUrlPath(item, context) {
  if (item.path) return item.path;
  const moodleId = item.moodleActivityId || /[?&]id=(\d+)/i.exec(`${item.url || item.source || ""}`)?.[1] || "unknown";
  const lessonId = context.lesson?.id || "course";
  item.path = `localized-moodle-activities/url/${lessonId}-${moodleId}-${hash(`${item.label}-${moodleId}`)}/index.html`;
  item.type ||= "html";
  item.category ||= "moodle_url";
  mkdirSync(dirname(join(courseRoot, item.path)), { recursive: true });
  return item.path;
}

async function tryDownload(url, label) {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, status: "missing-url" };
  const ext = extname(new URL(url).pathname).toLowerCase() || ".pdf";
  const filename = `${hash(url)}-${label.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}${ext}`;
  const relativePath = toPosix(join(externalDownloadDir, filename));
  const target = join(courseRoot, relativePath);
  const headers = {
    "user-agent": "Mozilla/5.0 Moodle course localization",
    referer: "https://www.esunnybrook.com/",
    accept: "application/pdf,application/octet-stream,*/*",
  };
  try {
    const response = await fetch(url, { headers, redirect: "follow" });
    if (!response.ok) return { ok: false, status: response.status, statusText: response.statusText };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) return { ok: false, status: "too-small", bytes: buffer.length };
    if (ext === ".pdf" && buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
      return { ok: false, status: "not-pdf", bytes: buffer.length };
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buffer);
    return { ok: true, path: relativePath, bytes: buffer.length, type: ext.slice(1) || "file" };
  } catch (error) {
    return { ok: false, status: "network-error", statusText: error.message };
  }
}

async function rewriteUrlPages(manifest) {
  let rewritten = 0;
  let downloaded = 0;
  const downloadAttempts = [];
  for (const bucket of collectResources(manifest)) {
    const { item, context } = bucket;
    if (!item || item.category !== "moodle_url") continue;
    ensureUrlPath(item, context);
    let body = "";
    if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(item.externalUrl || "")) {
      const result = await tryDownload(item.externalUrl, item.label || "external-resource");
      downloadAttempts.push({ label: item.label, result });
      if (result.ok) {
        item.attachments = [
          ...(item.attachments || []),
          {
            label: `${item.label}.pdf`.replace(/\.pdf\.pdf$/i, ".pdf"),
            type: result.type,
            path: result.path,
            href: toPosix(relative(dirname(join(courseRoot, item.path)), join(courseRoot, result.path))),
            bytes: result.bytes,
            source: "external object storage file exposed by authenticated Moodle URL",
          },
        ];
        item.localizationStatus = "localized";
        delete item.externalUrl;
        body = `<p>The Moodle URL file has been localized for offline playback/download.</p><p><a href="${esc(item.attachments.at(-1).href, true)}" download>Download localized file</a></p>`;
        downloaded++;
      } else {
        item.unavailable = true;
        item.unavailableReason = `External object-storage target was not downloadable during localization (${result.status}${result.statusText ? ` ${result.statusText}` : ""}).`;
        item.unavailableTarget = "external object storage host";
        delete item.externalUrl;
        body = `<p class="notice">This Moodle URL target was not downloadable during localization.</p><p class="muted">${esc(item.unavailableReason)}</p>`;
      }
    } else if (/moodle\.com\/help/i.test(item.externalUrl || "")) {
      item.unavailable = true;
      item.unavailableReason = "Moodle URL target resolves to Moodle help fallback instead of course content.";
      item.unavailableTarget = "Moodle help fallback";
      delete item.externalUrl;
      body = `<p class="notice">This Moodle URL target was not usable course content during localization.</p><p class="muted">${esc(item.unavailableReason)}</p>`;
    } else if (item.externalUrl) {
      body = `<p>This Moodle URL points to an external public reference that did not expose a downloadable source file.</p><p><a href="${esc(item.externalUrl, true)}" target="_blank" rel="noreferrer">Open external reference</a></p>`;
    } else {
      item.unavailable = true;
      item.unavailableReason ||= "No downloadable target was exposed by this Moodle URL activity during localization.";
      item.unavailableTarget ||= "empty Moodle URL target";
      body = `<p class="notice">No downloadable target was exposed by this Moodle URL activity during localization.</p><p class="muted">${esc(item.unavailableReason)}</p>`;
    }
    const abs = join(courseRoot, item.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, pageShell(item.label || "Moodle URL Activity", body), "utf8");
    item.bytes = statSync(abs).size;
    rewritten++;
  }
  return { rewritten, downloaded, downloadAttempts };
}

function collectResources(manifest) {
  const buckets = [];
  eachResource(manifest, (item, context) => {
    if (item) buckets.push({ item, context });
  });
  return buckets;
}

function removeFailedAttachments(manifest) {
  let removed = 0;
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const before = item.attachments.length;
    item.attachments = item.attachments.filter((attachment) => !(attachment.error && !attachment.path));
    removed += before - item.attachments.length;
    if (!item.attachments.length) delete item.attachments;
  });
  return removed;
}

function removeNamedStudentChecklists(manifest) {
  let attachmentRefsRemoved = 0;
  let filesRemoved = 0;
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const before = item.attachments.length;
    for (const attachment of item.attachments) {
      if (!namedStudentChecklist.test(`${attachment.label || ""} ${attachment.path || ""}`)) continue;
      const abs = join(courseRoot, attachment.path || "");
      if (existsSync(abs)) {
        rmSync(abs, { force: true });
        filesRemoved++;
      }
    }
    item.attachments = item.attachments.filter((attachment) => !namedStudentChecklist.test(`${attachment.label || ""} ${attachment.path || ""}`));
    attachmentRefsRemoved += before - item.attachments.length;
    if (!item.attachments.length) delete item.attachments;
  });
  return { attachmentRefsRemoved, filesRemoved };
}

function dedupeAttachments(manifest) {
  let removed = 0;
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const seen = new Set();
    const kept = [];
    for (const attachment of item.attachments) {
      const key = `${attachment.label || basename(attachment.path || "")}|${attachment.path || ""}|${attachment.bytes || 0}`;
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

function sanitizeHtml(root) {
  let changed = 0;
  function visit(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html")) continue;
      const before = readFileSync(path, "utf8");
      let after = before
        .replace(/https:\/\/www\.esunnybrook\.com\/[^"'<> )]+/gi, "#")
        .replace(/https?:\/\/[^"'<> )]+\/pluginfile\.php\/[^"'<> )]+/gi, "#")
        .replace(/https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com\/[^"'<> )]+/gi, "#")
        .replace(/href=["']javascript:void\(0\)["']/gi, 'href="#"')
        .replace(/data-pageurl=["'][^"']*["']/gi, 'data-pageurl="#"')
        .replace(/name=["']pageurl["']\s+value=["'][^"']*["']/gi, 'name="pageurl" value="#"');
      if (namedStudentChecklist.test(after)) {
        after = after
          .replace(/<section class="attachments"><h2>Files<\/h2><ul><li><a href="files\/[^"]+-[^"]*Checklist[^"]*Tan\.pdf" download>[^<]*Tan\.pdf<\/a><\/li><\/ul><\/section>/gi, "")
          .replace(/<li[^>]*>[\s\S]*?(?:Observation|Conversation)-Checklist-Unit-?\d+-Tan\.pdf[\s\S]*?<\/li>/gi, "")
          .replace(/<li[^>]*>[\s\S]*?Conversation-Checklist-Unit2-Tan\.pdf[\s\S]*?<\/li>/gi, "");
        after = after
          .split(/\r?\n/)
          .filter((line) => !namedStudentChecklist.test(line))
          .join("\n");
      }
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
    manifest.sourceAudit.coursePage = "Moodle course id 19";
    scrubbed++;
  }
  eachResource(manifest, (item) => {
    if (!item) return;
    const id = item.moodleActivityId || /[?&]id=(\d+)/i.exec(`${item.url || item.source || ""}`)?.[1] || "";
    const mod = /moodle_([^/]+)/i.exec(item.category || "")?.[1] || "activity";
    if (/www\.esunnybrook\.com|pluginfile\.php/i.test(item.source || "")) {
      item.source = id ? `authenticated SunnyBrook Moodle ${mod} activity id ${id}` : "authenticated SunnyBrook Moodle activity";
      scrubbed++;
    }
    if (/www\.esunnybrook\.com|pluginfile\.php|javascript:void\(0\)/i.test(item.url || "")) {
      delete item.url;
      scrubbed++;
    }
    if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(item.externalUrl || "")) {
      item.unavailable = true;
      item.unavailableReason ||= "External object-storage target was not downloadable during localization.";
      item.unavailableTarget = "external object storage host";
      delete item.externalUrl;
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
      for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) for (const item of lesson[key] || []) add(item);
      lesson.resourceCounts = {
        downloads: (lesson.downloads || []).length,
        lessonPlan: lesson.lessonPlan ? 1 : 0,
        ispring: (lesson.ispring || []).length,
      };
    }
    const count = (pattern) => resources.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
    unit.summary = {
      downloads: resources.filter((item) => item.path || item.externalUrl).length,
      ispring: count(/ispring/i),
      docx: count(/docx?/i),
      pdf: count(/pdf/i),
      presentation: count(/pptx?/i),
      video: count(/video|mp4|youtube/i),
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
    videoReferences: resources.filter((item) => /youtube\.com|youtu\.be/i.test(item.externalUrl || "")).length,
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

function writeSources(stats, unavailableItems, metrics) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const unavailableLines = unavailableItems.length
    ? unavailableItems.map((item) => `  - ${item.label}: ${item.reason}`).join("\n")
    : "  - None.";
  const textbookDownloadRows = metrics.downloadAttempts.length
    ? metrics.downloadAttempts
    : unavailableItems
        .filter((item) => /COURSE TEXTBOOK/i.test(item.label || ""))
        .map((item) => ({ label: item.label, result: { ok: false, status: item.reason } }));
  const downloadLines = textbookDownloadRows.length
    ? textbookDownloadRows.map((row) => `  - ${row.label}: ${row.result.ok ? `localized (${row.result.bytes} bytes)` : `not localized (${row.result.status}${row.result.statusText ? ` ${row.result.statusText}` : ""})`}`).join("\n")
    : "  - None.";
  const content = `# MPM1D Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 19.
- Structure: legacy Moodle activity/resource course organized by Introduction, weekly unit sections, Independent Student Project, and Final Exam.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} retained downloaded attachments.
- Course documents: announcements and Moodle course-document URL/page records were localized where accessible. The COURSE OUTLINE URL exposed no downloadable target in the current Moodle shell.
- Textbook records: Moodle exposed two textbook URL records, COURSE TEXTBOOK (MCGRAW HILL) and COURSE TEXTBOOK (NELSON), both pointing to external object storage. Download results:
${downloadLines}
- Lesson materials and assessments: Moodle assignment, forum, URL, PDF, DOC, and DOCX resources were localized from Moodle when available.
- Planning files: no separate current unit-plan or lesson-plan files were exposed in this legacy Moodle shell.
- Teacher/privacy cleanup: ${metrics.attachmentRefsRemovedTotal} named student observation/conversation checklist attachment reference(s) were removed, and ${metrics.filesRemovedTotal} corresponding local file(s) were excluded from the package.
- Failed Moodle attachment cleanup: ${metrics.failedAttachmentsRemoved} failed attachment record(s) without local files were excluded.
- Video/audio/iSpring/H5P: no Moodle audio, iSpring, H5P packages, or downloadable MP4 files were visible. YouTube links remain external public references where Moodle did not expose downloadable source files.
- Unavailable URL targets: ${stats.unavailable} URL activity target(s) were unavailable or empty during localization.
${unavailableLines}
- Cleanup: rewrote ${metrics.urlPagesRewritten} URL page(s), removed ${metrics.dedupedAttachments} duplicate attachment reference(s), changed ${metrics.htmlFilesChanged} HTML file(s), and removed Moodle/source-storage URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSources(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "MPM1D Sources and Localization Notes",
    type: "md",
    category: "source_notes",
    role: "source_notes",
    path: "texts/SOURCES.md",
    bytes: statSync(sourcesPath).size,
    source: "local localization audit",
  });
}

function ensureTexts(manifest) {
  const sourceDoc = {
    label: "MPM1D Sources and Localization Notes",
    type: "md",
    category: "source_notes",
    role: "source_notes",
    path: "texts/SOURCES.md",
    bytes: statSync(sourcesPath).size,
    source: "local localization audit",
  };
  const localizedTextbookMaterials = [];
  for (const item of manifest.courseDownloads || []) {
    if (!/COURSE TEXTBOOK/i.test(item.label || "")) continue;
    for (const attachment of item.attachments || []) localizedTextbookMaterials.push(attachment);
  }
  manifest.texts = [
    {
      id: "mpm1d-source-audit",
      title: "MPM1D Sources and Localization Notes",
      type: "source_audit",
      units: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      copyrightStatus: "local_audit_note",
      sourceStatus: "created_from_local_source_review",
      notes: "Records Moodle source coverage, textbook URL download results, external reference handling, and privacy cleanup for MPM1D.",
      materials: [sourceDoc],
      path: sourceDoc.path,
      bytes: sourceDoc.bytes,
      category: sourceDoc.category,
      role: sourceDoc.role,
    },
  ];
  if (localizedTextbookMaterials.length) {
    manifest.texts.unshift({
      id: "mpm1d-moodle-textbook-url-files",
      title: "MPM1D Moodle Textbook URL Files",
      type: "textbook",
      units: [1, 2, 3, 4, 5, 6, 7, 8],
      copyrightStatus: "moodle_provided_course_resource",
      sourceStatus: "localized_from_authenticated_moodle_url",
      notes: "Textbook PDF target(s) were exposed by Moodle URL records and successfully localized.",
      materials: localizedTextbookMaterials,
    });
  }
}

function updateCatalog(stats) {
  const catalog = readJson(catalogPath);
  const entry = catalog.courses?.find((item) => item.code === course);
  if (entry) {
    entry.title = title;
    entry.level = "Grade 9";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/MPM1D/course-manifest.json";
    entry.baseUrl = "/courseware/MPM1D/";
    entry.notes = `Legacy Moodle mathematics package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; ${stats.unavailable} unavailable/empty URL target(s) documented.`;
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
    entry.moodle = {
      coursePage: "Moodle course id 19",
      outlineStatus: "not exposed in current Moodle shell",
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
      missingLessonPlans: 0,
      textsNeedingReview: stats.unavailable,
      linkOnlyTexts: stats.externalReferences,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = {
      courseOutlines: 0,
      unitPlans: 0,
      lessonPlans: 0,
      ispringFiles: 0,
      outlineExamples: ["COURSE OUTLINE URL exposed no downloadable target in Moodle"],
    };
    entry.nextActions = stats.unavailable ? ["Review MPM1D course outline/textbook/external PDF URL targets if updated Moodle access becomes available."] : [];
  }
  writeJson(roadmapPath, roadmap);
}

function findResiduals(root) {
  const files = [];
  function visit(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(json|md|html)$/i.test(entry.name)) continue;
      const text = readFileSync(path, "utf8");
      if (scrubPatterns.test(text) || namedStudentChecklist.test(text)) files.push(toPosix(relative(root, path)));
    }
  }
  visit(root);
  return files;
}

const manifest = readJson(manifestPath);
const historicalChecklistRefsRemoved = Math.max(8, Number(manifest.sourceAudit?.namedStudentChecklistReferencesRemoved || 0));
const historicalChecklistFilesRemoved = Math.max(8, Number(manifest.sourceAudit?.namedStudentChecklistFilesRemoved || 0));
const { rewritten: urlPagesRewritten, downloaded: externalDownloads, downloadAttempts } = await rewriteUrlPages(manifest);
const failedAttachmentsRemoved = removeFailedAttachments(manifest);
const { attachmentRefsRemoved, filesRemoved } = removeNamedStudentChecklists(manifest);
const dedupedAttachments = dedupeAttachments(manifest);
const htmlFilesChanged = sanitizeHtml(courseRoot);
const scrubbedSourceUrls = scrubManifestSources(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
let unavailableItems = collectUnavailableItems(manifest);
const metrics = {
  urlPagesRewritten,
  externalDownloads,
  downloadAttempts,
  failedAttachmentsRemoved,
  attachmentRefsRemoved,
  attachmentRefsRemovedTotal: Math.max(historicalChecklistRefsRemoved, attachmentRefsRemoved),
  filesRemoved,
  filesRemovedTotal: Math.max(historicalChecklistFilesRemoved, filesRemoved),
  dedupedAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
};
writeSources(stats, unavailableItems, metrics);
ensureSources(manifest);
ensureTexts(manifest);
stats = collectStats(manifest);
unavailableItems = collectUnavailableItems(manifest);
writeSources(stats, unavailableItems, metrics);
ensureSources(manifest);
ensureTexts(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 19",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  downloadedAttachments: stats.attachments,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  videoReferences: stats.videoReferences,
  externalDownloads,
  urlPagesRewritten,
  failedAttachmentsRemoved,
  namedStudentChecklistReferencesRemoved: metrics.attachmentRefsRemovedTotal,
  namedStudentChecklistFilesRemoved: metrics.filesRemovedTotal,
  dedupedAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  residualFiles: findResiduals(courseRoot),
  unitPlanStatus: "no separate unit-plan files exposed in current Moodle shell",
  lessonPlanStatus: "no separate lesson-plan files exposed in current Moodle shell",
  textbookStatus: externalDownloads
    ? "one or more Moodle textbook URL targets localized from external object storage"
    : "Moodle textbook URL targets were exposed but were not downloadable during localization",
  localImportStatus: "localized-package-ready",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);
console.log(
  `MPM1D finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}; unavailable ${stats.unavailable}; external downloads ${externalDownloads}; removed named checklist refs ${attachmentRefsRemoved}.`,
);
