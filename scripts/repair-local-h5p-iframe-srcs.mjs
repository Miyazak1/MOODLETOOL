import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");
const course = readArg("--course").toUpperCase();

if (!course) {
  console.error("Usage: node scripts/repair-local-h5p-iframe-srcs.mjs --course COURSE");
  process.exit(1);
}

const courseRoot = join(coursewareRoot, course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function relativeHref(fromRel, targetRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(targetRel)))
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function h5pId(value) {
  const text = String(value || "").replaceAll("&amp;", "&");
  return (
    /h5p_embed&id=(\d+)/i.exec(text)?.[1] ||
    /(?:activity-|[-_])(\d+)\.h5p/i.exec(text)?.[1] ||
    /-(\d+)\.h5p/i.exec(text)?.[1] ||
    ""
  );
}

function sectionRole(section) {
  const text = `${section.sectionLabel || ""} ${section.label || ""} ${section.path || ""}`.toLowerCase();
  if (/consolidation/.test(text)) return "consolidation";
  if (/hands[\s_-]*on/.test(text)) return "hands_on";
  if (/lesson/.test(text)) return "lesson";
  return "";
}

function recordRole(item) {
  const text = `${item.role || ""} ${item.category || ""} ${item.label || ""}`.toLowerCase();
  if (/consolidation/.test(text)) return "consolidation";
  if (/hands[\s_-]*on/.test(text)) return "hands_on";
  if (/lesson/.test(text)) return "lesson";
  return "";
}

function h5pRecordsForLesson(lesson) {
  return [
    ...(lesson.downloads || []),
    ...(lesson.handsOn || []),
    ...(lesson.lessonText || []),
  ]
    .filter((item) => String(item.type || "").toLowerCase() === "h5p" || /\.h5p(?:$|[?#])/i.test(item.path || ""))
    .filter((item) => item.previewPath)
    .map((item) => ({
      item,
      id: h5pId(`${item.source || ""} ${item.exportUrl || ""} ${item.path || ""} ${item.previewPath || ""}`),
      role: recordRole(item),
    }));
}

function normalizePreviewKey(value) {
  return toPosix(value)
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function localIframePreviewPath(pageRel, src) {
  const normalizedSrc = normalizePreviewKey(src);
  if (!normalizedSrc || /^https?:\/\//i.test(normalizedSrc)) return "";
  return normalizePreviewKey(posix.normalize(posix.join(posix.dirname(pageRel), normalizedSrc)));
}

function setIframeTitle(attrs, title) {
  const escapedTitle = escapeHtml(title || "H5P activity");
  if (/\btitle\s*=/i.test(attrs)) {
    return attrs.replace(/\btitle=(['"])[^'"]*\1/i, `title="${
      escapedTitle
    }"`);
  }
  return `${attrs} title="${escapedTitle}"`;
}

function fixLabel(item, unit, lesson, id) {
  if (!/External H5P - Title/i.test(item.label || "")) return false;
  const role = recordRole(item) === "consolidation" ? "Consolidation" : recordRole(item) === "lesson" ? "Lesson" : "Hands On";
  item.label = `H5P - ${course} Unit ${unit.unit} Lesson ${lesson.lesson} ${role} Activity ${id}`;
  return true;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const report = {
  course,
  labelsFixed: 0,
  pagesChanged: 0,
  iframeSrcChanged: 0,
  missingPages: 0,
  unresolvedIframes: [],
};

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const records = h5pRecordsForLesson(lesson);
    if (!records.length) continue;

    for (const record of records) {
      if (fixLabel(record.item, unit, lesson, record.id)) report.labelsFixed += 1;
    }

    for (const section of lesson.bookSections || []) {
      const pageRel = toPosix(section.path || "");
      if (!pageRel) continue;
      const pagePath = join(courseRoot, pageRel);
      if (!existsSync(pagePath)) {
        report.missingPages += 1;
        continue;
      }

      const expectedRole = sectionRole(section);
      let html = readFileSync(pagePath, "utf8");
      const before = html;
      const recordsByPreviewPath = new Map();
      for (const record of records) {
        if (record.item.previewPath) recordsByPreviewPath.set(normalizePreviewKey(record.item.previewPath), record);
      }

      html = html.replace(
        /<iframe\b([^>]*?src=(['"])([^'"]*welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed(?:&amp;|&)id=(\d+)[^'"]*)\2[^>]*)>\s*<\/iframe>/gi,
        (match, attrs, quote, src, id) => {
          let record = records.find((candidate) => candidate.id === id && (!expectedRole || candidate.role === expectedRole));
          if (!record) record = records.find((candidate) => candidate.id === id);
          if (!record) {
            report.unresolvedIframes.push({ page: pageRel, id, src });
            return match;
          }
          const localSrc = `${relativeHref(pageRel, record.item.previewPath)}?embed=1`;
          let nextAttrs = attrs.replace(/\bsrc=(['"])[^'"]*\1/i, `src=${quote}${escapeHtml(localSrc)}${quote}`);
          if (!/\bclass\s*=/i.test(nextAttrs)) nextAttrs += ' class="h5p-iframe"';
          if (!/\bloading\s*=/i.test(nextAttrs)) nextAttrs += ' loading="lazy"';
          if (!/\ballowfullscreen\b/i.test(nextAttrs)) nextAttrs += ' allowfullscreen="allowfullscreen"';
          nextAttrs = setIframeTitle(nextAttrs, record.item.label || "H5P activity");
          report.iframeSrcChanged += 1;
          return `<iframe${nextAttrs}></iframe>`;
        },
      );

      html = html.replace(
        /<iframe\b([^>]*?\bsrc=(['"])([^'"]*h5p[^'"]*\/index\.html(?:\?embed=1)?[^'"]*)\2[^>]*)>\s*<\/iframe>/gi,
        (match, attrs, quote, src) => {
          const previewPath = localIframePreviewPath(pageRel, src);
          const record = recordsByPreviewPath.get(previewPath);
          if (!record) return match;
          const nextAttrs = setIframeTitle(attrs, record.item.label || "H5P activity");
          return `<iframe${nextAttrs}></iframe>`;
        },
      );

      if (html !== before) {
        writeFileSync(pagePath, html, "utf8");
        section.bytes = statSync(pagePath).size;
        report.pagesChanged += 1;
      }
    }

    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = (lesson.downloads || []).length;
    lesson.resourceCounts.h5p = (lesson.downloads || []).filter((item) => item.type === "h5p").length;
  }
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  unit.summary.h5p = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length, 0);
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  h5pLocalIframeRepair: {
    repairedAt: new Date().toISOString(),
    course,
    labelsFixed: report.labelsFixed,
    pagesChanged: report.pagesChanged,
    iframeSrcChanged: report.iframeSrcChanged,
    unresolvedIframes: report.unresolvedIframes.length,
  },
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify(report, null, 2));
if (report.unresolvedIframes.length) process.exitCode = 1;
