import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MPM2D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

const consolidationH5p = [
  { unit: 1, lesson: 1, chapter: 1719, packagePath: "localized-moodle/h5p/49cbfef165-embed.h5p", previewPath: "localized-moodle/h5p/49cbfef165-embed/index.html" },
  { unit: 1, lesson: 7, chapter: 1749, packagePath: "localized-moodle/h5p/bfdfdca482-embed.h5p", previewPath: "localized-moodle/h5p/bfdfdca482-embed/index.html" },
  { unit: 2, lesson: 1, chapter: 1754, packagePath: "localized-moodle/h5p/e53546b6a1-embed.h5p", previewPath: "localized-moodle/h5p/e53546b6a1-embed/index.html" },
  { unit: 2, lesson: 7, chapter: 1784, packagePath: "localized-moodle/h5p/456622aa0b-embed.h5p", previewPath: "localized-moodle/h5p/456622aa0b-embed/index.html" },
  { unit: 3, lesson: 1, chapter: 1789, packagePath: "localized-moodle/h5p/687a0c22f5-embed.h5p", previewPath: "localized-moodle/h5p/687a0c22f5-embed/index.html" },
  { unit: 3, lesson: 8, chapter: 1824, packagePath: "localized-moodle/h5p/b2c2352882-embed.h5p", previewPath: "localized-moodle/h5p/b2c2352882-embed/index.html" },
  { unit: 4, lesson: 1, chapter: 1829, packagePath: "localized-moodle/h5p/724e32271c-embed.h5p", previewPath: "localized-moodle/h5p/724e32271c-embed/index.html" },
  { unit: 4, lesson: 7, chapter: 1859, packagePath: "localized-moodle/h5p/70483afb29-embed.h5p", previewPath: "localized-moodle/h5p/70483afb29-embed/index.html" },
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function courseFileStat(relativePath) {
  const filePath = join(courseRoot, relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`Missing localized file: ${relativePath}`);
  }
  return statSync(filePath);
}

function h5pLike(item) {
  return item?.type === "h5p" || /\.h5p$/i.test(item?.path || "") || /\.h5p$/i.test(item?.localizedPackagePath || "");
}

function h5pIdentity(item) {
  return String(item?.path || item?.localizedPackagePath || item?.previewPath || item?.localizedPreviewPath || item?.source || "").toLowerCase();
}

function sameH5p(a, b) {
  const left = h5pIdentity(a);
  const right = h5pIdentity(b);
  return left && right && left === right;
}

function normalizeHandsOnCard(item, unit, lesson) {
  const packagePath = item.localizedPackagePath || item.path;
  const previewPath = item.localizedPreviewPath || item.previewPath;
  if (!packagePath || !previewPath) {
    throw new Error(`Hands On H5P is missing local paths: U${unit.unit}L${lesson.lesson}`);
  }
  const stat = courseFileStat(packagePath);
  const card = {
    ...item,
    label: /^External H5P\s*-\s*Title$/i.test(item.label || "")
      ? `Hands On - MPM2D: Unit ${unit.unit} Lesson ${lesson.lesson} - Hands On Activity`
      : item.label || `Hands On - MPM2D: Unit ${unit.unit} Lesson ${lesson.lesson} - Hands On Activity`,
    type: "h5p",
    category: "localized_external_h5p",
    role: "hands_on",
    mode: "local_embed",
    parentSection: "Hands On",
    sourceGroup: "book_section_embed",
    unit: Number(unit.unit),
    lesson: Number(lesson.lesson),
    path: packagePath,
    previewPath,
    localizedPackagePath: packagePath,
    localizedPreviewPath: previewPath,
    bytes: stat.size,
  };
  delete card.url;
  delete card.previewUrl;
  delete card.downloadUrl;
  return card;
}

function consolidationCard(entry, section) {
  const stat = courseFileStat(entry.packagePath);
  return {
    label: "Consolidation - Exit Slip H5P",
    type: "h5p",
    category: "localized_moodle_resource",
    role: "consolidation",
    mode: "local_embed",
    parentSection: "Consolidation",
    sourceGroup: "book_section_embed",
    sectionPath: section?.path,
    unit: entry.unit,
    lesson: entry.lesson,
    source: `https://www.esunnybrook.com/h5p/embed.php?url=https%3A%2F%2Fwww.esunnybrook.com%2Fpluginfile.php%2F8691%2Fmod_book%2Fchapter%2F${entry.chapter}%2Fquestion-set-2.h5p`,
    path: entry.packagePath,
    previewPath: entry.previewPath,
    localizedPackagePath: entry.packagePath,
    localizedPreviewPath: entry.previewPath,
    bytes: stat.size,
  };
}

function asHtmlPath(relativePath) {
  return relativePath.split(posix.sep).map(encodeURIComponent).join(posix.sep);
}

function localIframeFor(sectionPath, entry) {
  const relativePreview = posix.relative(posix.dirname(sectionPath), entry.previewPath);
  return [
    '<div class="embedded-h5p-frame" data-localized-role="consolidation-h5p">',
    `<iframe src="${asHtmlPath(relativePreview)}?embed=1" title="Consolidation - Exit Slip H5P" loading="lazy" allowfullscreen="allowfullscreen"></iframe>`,
    "</div>",
  ].join("");
}

function ensureConsolidationEmbed(section, entry) {
  if (!section?.path) return false;
  const pagePath = join(courseRoot, section.path);
  if (!existsSync(pagePath)) return false;
  const original = readFileSync(pagePath, "utf8");
  if (original.includes(entry.previewPath) || original.includes(posix.basename(dirname(entry.previewPath)))) {
    return false;
  }
  const iframe = localIframeFor(section.path, entry);
  const exitSlipHeading = /(<h[1-6]\b[^>]*>\s*Exit\s+Slip\b[\s\S]*?<\/h[1-6]>)/i;
  let patched = original;
  if (exitSlipHeading.test(patched)) {
    patched = patched.replace(exitSlipHeading, `${iframe}\n$1`);
  } else if (/<\/article>/i.test(patched)) {
    patched = patched.replace(/<\/article>/i, `${iframe}\n</article>`);
  } else if (/<\/body>/i.test(patched)) {
    patched = patched.replace(/<\/body>/i, `${iframe}\n</body>`);
  } else {
    patched = `${patched}\n${iframe}\n`;
  }
  writeFileSync(pagePath, patched, "utf8");
  section.bytes = statSync(pagePath).size;
  section.textPreview = stripTags(patched).slice(0, 500);
  return true;
}

function recalculateCounts(manifest) {
  for (const unit of manifest.units || []) {
    let unitDownloads = 0;
    let unitH5p = 0;
    for (const lesson of unit.lessons || []) {
      lesson.resourceCounts ||= {};
      lesson.resourceCounts.downloads = lesson.downloads?.length || 0;
      lesson.resourceCounts.handsOn = lesson.handsOn?.length || 0;
      lesson.resourceCounts.h5p = [
        ...(lesson.downloads || []),
        ...(lesson.handsOn || []),
        ...(lesson.consolidation || []),
      ].filter(h5pLike).length;
      unitDownloads += lesson.resourceCounts.downloads;
      unitH5p += lesson.resourceCounts.h5p;
    }
    unit.summary ||= {};
    unit.summary.downloads = unitDownloads;
    unit.summary.h5p = unitH5p;
  }
}

if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
const report = {
  course,
  handsOnDownloadsAdded: 0,
  handsOnDownloadsUpdated: 0,
  consolidationDownloadsAdded: 0,
  consolidationDownloadsUpdated: 0,
  consolidationHtmlEmbedsAdded: 0,
  externalPrimaryUrlsRemoved: 0,
  externalHandsOnIframesRemaining: 0,
  touchedPages: [],
};

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    lesson.downloads ||= [];

    for (const item of lesson.handsOn || []) {
      if (!h5pLike(item)) continue;
      const card = normalizeHandsOnCard(item, unit, lesson);
      delete item.url;
      delete item.previewUrl;
      delete item.downloadUrl;
      const existingIndex = lesson.downloads.findIndex((resource) => sameH5p(resource, card));
      if (existingIndex >= 0) {
        lesson.downloads[existingIndex] = { ...lesson.downloads[existingIndex], ...card };
        report.handsOnDownloadsUpdated += 1;
      } else {
        lesson.downloads.push(card);
        report.handsOnDownloadsAdded += 1;
      }
    }

    const consolidationEntry = consolidationH5p.find(
      (entry) => Number(entry.unit) === Number(unit.unit) && Number(entry.lesson) === Number(lesson.lesson),
    );
    if (consolidationEntry) {
      const consolidationSection = (lesson.bookSections || []).find((section) =>
        /consolidation/i.test(`${section.sectionLabel || ""} ${section.label || ""} ${section.path || ""}`),
      );
      const card = consolidationCard(consolidationEntry, consolidationSection);
      const existingIndex = lesson.downloads.findIndex((resource) => sameH5p(resource, card));
      if (existingIndex >= 0) {
        lesson.downloads[existingIndex] = { ...lesson.downloads[existingIndex], ...card };
        report.consolidationDownloadsUpdated += 1;
      } else {
        lesson.downloads.push(card);
        report.consolidationDownloadsAdded += 1;
      }
      if (ensureConsolidationEmbed(consolidationSection, consolidationEntry)) {
        report.consolidationHtmlEmbedsAdded += 1;
        report.touchedPages.push(consolidationSection.path);
      }
    }

    for (const item of lesson.downloads) {
      if (!h5pLike(item)) continue;
      if (/^(https?:)?\/\//i.test(item.url || "")) {
        delete item.url;
        report.externalPrimaryUrlsRemoved += 1;
      }
      if (/^(https?:)?\/\//i.test(item.previewUrl || "")) {
        delete item.previewUrl;
        report.externalPrimaryUrlsRemoved += 1;
      }
      if (/^(https?:)?\/\//i.test(item.downloadUrl || "")) {
        delete item.downloadUrl;
        report.externalPrimaryUrlsRemoved += 1;
      }
    }

    for (const section of lesson.bookSections || []) {
      if (!/hands[\s_-]*on/i.test(`${section.sectionLabel || ""} ${section.label || ""} ${section.path || ""}`)) continue;
      if (!section.path) continue;
      const pagePath = join(courseRoot, section.path);
      if (!existsSync(pagePath)) continue;
      const html = readFileSync(pagePath, "utf8");
      if (/welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed/i.test(html)) {
        report.externalHandsOnIframesRemaining += 1;
      }
    }
  }
}

recalculateCounts(manifest);

manifest.sourceAudit ||= {};
manifest.sourceAudit.mpm2dH5pPlacement = {
  correctedAt: new Date().toISOString(),
  handsOnStandaloneH5pExpected: 29,
  consolidationStandaloneH5pExpected: consolidationH5p.length,
  handsOnDownloadsAdded: report.handsOnDownloadsAdded,
  handsOnDownloadsUpdated: report.handsOnDownloadsUpdated,
  consolidationDownloadsAdded: report.consolidationDownloadsAdded,
  consolidationDownloadsUpdated: report.consolidationDownloadsUpdated,
  consolidationHtmlEmbedsAdded: report.consolidationHtmlEmbedsAdded,
  externalPrimaryUrlsRemoved: report.externalPrimaryUrlsRemoved,
  note: "Hands On WordPress H5P and Consolidation Moodle H5P are separate activities. Both remain embedded in their source book-section HTML and are also represented in lesson.downloads so the lesson flow can show standalone H5P cards in the correct section.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify(report, null, 2));
if (report.externalHandsOnIframesRemaining) process.exitCode = 1;
