import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const inboxRoot = join(projectRoot, "inbox");
const deploymentRoot = join(projectRoot, "deployment");
const course = "SCH3U";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeUrl(raw) {
  const value = String(raw || "").replaceAll("&amp;", "&").trim();
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

function isIspringUrl(url) {
  return /hexstruct\.ispring\.com\/s\/embed_player\//i.test(url) || /ispring/i.test(url);
}

function isDownloadableMoodleUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized.startsWith("https://www.esunnybrook.com/")) return false;
  if (normalized.includes("/pluginfile.php/")) return true;
  try {
    const parsed = new URL(normalized);
    const nested = parsed.searchParams.get("url") || "";
    return parsed.pathname.endsWith("/h5p/embed.php") && nested.includes("/pluginfile.php/") && nested.includes(".h5p");
  } catch {
    return false;
  }
}

function classify(url, attr) {
  const lower = url.toLowerCase();
  if (lower.includes("/h5p/") || lower.includes(".h5p")) return "h5p";
  if (lower.includes(".mp4")) return "video";
  if (lower.includes(".docx") || lower.includes(".doc")) return "document";
  if (lower.includes(".pdf")) return "pdf";
  if (attr === "script-src") return "script";
  if (attr === "iframe-src") return "iframe";
  return "resource";
}

function suggestedPath(url, kind) {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 10);
  const parsed = new URL(url);
  const name = decodeURIComponent(basename(parsed.pathname)) || `${kind}.bin`;
  return `localized-moodle/${kind}/${hash}-${name}`;
}

function rawFiles() {
  return readdirSync(inboxRoot)
    .filter((entry) => new RegExp(`^moodle-book-raw-${course}-U\\d+\\.json$`, "i").test(entry))
    .sort()
    .map((entry) => join(inboxRoot, entry));
}

const ispringRows = [];
const mediaItems = [];

for (const file of rawFiles()) {
  const raw = readJson(file);
  const unit = Number(raw.unit);
  for (const lesson of raw.lessons || []) {
    const lessonNumber = Number(lesson.lesson || 0);
    const lessonId = `U${String(unit).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}`;
    const htmlPath = `moodle-html/unit-${String(unit).padStart(2, "0")}/${lessonId}.html`;
    for (const section of lesson.sections || []) {
      const sectionLabel = section.normalizedLabel || section.label || "";
      for (const ref of section.page?.refs || []) {
        const url = normalizeUrl(ref.url || "");
        if (!url) continue;
        if (isIspringUrl(url)) {
          ispringRows.push({
            course,
            unit,
            lesson: lessonNumber,
            lessonId,
            lessonTitle: lesson.title || "",
            section: sectionLabel,
            url,
            expectedFilename: `${course}_U${String(unit).padStart(2, "0")}_L${String(lessonNumber).padStart(2, "0")}.zip`,
          });
        }
        if (isDownloadableMoodleUrl(url)) {
          const attr = `${ref.attr || "href"}-src`;
          const kind = classify(url, attr);
          mediaItems.push({
            course,
            unit,
            lesson: lessonId,
            htmlPath,
            label: `${sectionLabel || "Moodle section"} - ${lesson.title || lessonId}`,
            kind,
            attr,
            active: ref.attr !== "data-moodle-source",
            url,
            suggestedPath: suggestedPath(url, kind),
          });
        }
      }
    }
  }
}

const uniqueIspring = [...new Map(ispringRows.map((row) => [`${row.course}|${row.lessonId}|${row.url}`, row])).values()]
  .sort((a, b) => `${a.unit}|${a.lesson}`.localeCompare(`${b.unit}|${b.lesson}`, "en", { numeric: true }));
const uniqueMedia = [...new Map(mediaItems.map((item) => [`${item.course}|${item.htmlPath}|${item.url}`, item])).values()]
  .sort((a, b) => `${a.unit}|${a.lesson}|${a.kind}|${a.url}`.localeCompare(`${b.unit}|${b.lesson}|${b.kind}|${b.url}`, "en", { numeric: true }));

mkdirSync(deploymentRoot, { recursive: true });

writeJson(join(deploymentRoot, "sch3u-ispring-embed-queue.json"), {
  generatedAt: new Date().toISOString(),
  course,
  rows: uniqueIspring,
  totals: {
    rows: uniqueIspring.length,
    lessons: new Set(uniqueIspring.map((row) => row.lessonId)).size,
  },
});

writeJson(join(deploymentRoot, "sch3u-media-localization-queue.json"), {
  generatedAt: new Date().toISOString(),
  coursewareRoot: resolve(projectRoot, "..", "courseware"),
  course,
  totals: {
    items: uniqueMedia.length,
    active: uniqueMedia.filter((item) => item.active).length,
    byKind: Object.fromEntries([...new Set(uniqueMedia.map((item) => item.kind))].sort().map((kind) => [kind, uniqueMedia.filter((item) => item.kind === kind).length])),
  },
  items: uniqueMedia,
});

console.log(`SCH3U iSpring rows: ${uniqueIspring.length}`);
console.log(`SCH3U media rows: ${uniqueMedia.length}`);
console.log(JSON.stringify({
  mediaByKind: Object.fromEntries([...new Set(uniqueMedia.map((item) => item.kind))].sort().map((kind) => [kind, uniqueMedia.filter((item) => item.kind === kind).length])),
}, null, 2));
