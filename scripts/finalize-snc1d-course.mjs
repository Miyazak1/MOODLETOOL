import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SNC1D";
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

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function sanitizeHtmlFiles(root) {
  const changed = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
        const before = readFileSync(path, "utf8");
        const after = before
          .replace(/https:\/\/www\.esunnybrook\.com\/[^"'<> )]+/gi, "#")
          .replace(/href=["']javascript:void\(0\)["']/gi, 'href="#"')
          .replace(/data-pageurl=["'][^"']*["']/gi, 'data-pageurl="#"')
          .replace(/name=["']pageurl["']\s+value=["'][^"']*["']/gi, 'name="pageurl" value="#"');
        if (after !== before) {
          writeFileSync(path, after, "utf8");
          changed.push(toPosix(path.slice(courseRoot.length + 1)));
        }
      }
    }
  }
  visit(root);
  return changed;
}

function unavailableHtml(label, sourceUrl, reason) {
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
      <p>This placeholder was generated during localization so the course package does not retain a broken Moodle URL as primary content.</p>
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
      if (Array.isArray(resource)) {
        for (const item of resource) callback(item);
      } else {
        callback(resource);
      }
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
    pptx: byType(/pptx/i),
    zip: byType(/zip/i),
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

function fillUnavailable(manifest) {
  const filled = [];
  eachResource(manifest, (item) => {
    if (!item || item.path || item.label !== "Summary: Common Lab Equipment") return;
    const rel = "localized-moodle-activities/unavailable/6384-summary-common-lab-equipment/index.html";
    const abs = join(courseRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, unavailableHtml(item.label, item.url || item.source, "The current Moodle URL activity returns HTTP 404."), "utf8");
    item.path = rel;
    item.type = "html";
    item.bytes = statSync(abs).size;
    item.source = item.url || item.source;
    item.unavailable = true;
    item.unavailableReason = "Moodle URL activity returned HTTP 404 during localization.";
    delete item.url;
    delete item.externalUrl;
    filled.push(item.label);
  });
  return filled;
}

function writeSources(stats, filledUnavailable) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const content = `# SNC1D Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, https://www.esunnybrook.com/course/view.php?id=62
- Structure: legacy Moodle activity course, organized by the visible Moodle sections rather than the newer ENG3U-style Moodle Book lesson format.
- Localized structure: ${stats.units} units, ${stats.lessons} lessons/activity entries, ${stats.resources} local resource records.
- iSpring: no iSpring packages were visible in the current Moodle shell.
- Textbook: Moodle lists "Grade 9 ON Science Textbook (McGraw-Hill Ryerson)" as Book 6351. The Moodle Book IMS Common Cartridge package was downloaded locally. The visible chapter PDF links on the external OSS host returned AccessDenied, so chapter PDFs were not downloaded.
- External URL activities: Moodle URL activities were localized as local wrapper pages. Valid public/external targets are kept as external references; Moodle dashboard and javascript placeholders were removed.
- Unavailable Moodle activity: ${filledUnavailable.length ? filledUnavailable.join(", ") : "none"}.
- Lesson plans: no separate lesson plan files were added because this legacy shell does not expose confirmed current lesson plans.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSourcesMaterial(manifest) {
  const text = manifest.texts?.find((item) => item.id === "grade-9-on-science-textbook");
  if (!text) return;
  text.materials = (text.materials || []).filter((item) => item.path !== "texts/SOURCES.md");
  text.materials.push({
    label: "SNC1D Sources and Localization Notes",
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
    entry.title = "Science, Grade 9, Academic";
    entry.level = "Grade 9";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/SNC1D/course-manifest.json";
    entry.baseUrl = "/courseware/SNC1D/";
    entry.notes = `Legacy Moodle activity package localized: ${stats.units} units, ${stats.lessons} lessons/activity entries; textbook IMS included, chapter PDF links blocked by external OSS.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = "Science, Grade 9, Academic";
    entry.level = "Grade 9";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = {
      coursePage: "https://www.esunnybrook.com/course/view.php?id=62",
      outlineStatus: "ready",
      outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=6350",
      bookCount: 1,
      numberedLessonCount: 0,
    };
    entry.readiness = {
      units: stats.units,
      lessons: stats.lessons,
      unitPlans: 1,
      lessonPlans: 0,
      lessonPlanExpected: 0,
      missingCourseOutline: false,
      missingIntroduction: false,
      missingUnitPlans: 0,
      missingLessonPlans: 0,
      textsNeedingReview: 1,
      linkOnlyTexts: 0,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = {
      courseOutlines: 1,
      unitPlans: 1,
      lessonPlans: 0,
      ispringFiles: 0,
      outlineExamples: ["localized-moodle-activities/resource/course-6350-1e28e34103/1e28e34103-SNC1D-Course-Outline.pdf"],
    };
    entry.nextActions = [
      "Review external URL wrappers during site QA; valid public targets are retained as external references.",
      "Replace blocked textbook chapter PDFs if a downloadable legal source is provided.",
    ];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const filledUnavailable = fillUnavailable(manifest);
sanitizeHtmlFiles(courseRoot);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
writeSources(stats, filledUnavailable);
ensureSourcesMaterial(manifest);
stats = collectStats(manifest);
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  textbookStatus: "IMS package localized; chapter PDF links AccessDenied on external OSS host",
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);

console.log(JSON.stringify({ course, stats, filledUnavailable, sourcesPath }, null, 2));
