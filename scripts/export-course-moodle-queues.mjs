import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const inboxRoot = join(projectRoot, "inbox");
const deploymentRoot = join(projectRoot, "deployment");
const course = safeCourse(readArg("--course"));
const ispringPath = readArg("--ispring-out")
  ? resolve(projectRoot, readArg("--ispring-out"))
  : join(deploymentRoot, `${course}-moodle-ispring-embed-queue.json`);
const mediaPath = readArg("--media-out")
  ? resolve(projectRoot, readArg("--media-out"))
  : join(deploymentRoot, `${course}-moodle-media-localization-queue.json`);

if (!course) {
  console.error("Usage: node scripts/export-course-moodle-queues.mjs --course COURSE");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
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

const ispringRows = [];
const mediaItems = [];
const mediaKeys = new Set();
for (const entry of readdirSync(inboxRoot)) {
  const match = new RegExp(`^moodle-book-raw-${course}-U(?<unit>\\d+)\\.json$`, "i").exec(entry);
  if (!match) continue;
  const raw = readJson(join(inboxRoot, entry));
  for (const lesson of raw.lessons || []) {
    const lessonId = `U${String(Number(raw.unit)).padStart(2, "0")}L${String(Number(lesson.lesson)).padStart(2, "0")}`;
    const htmlPath = `moodle-html/unit-${String(Number(raw.unit)).padStart(2, "0")}/${lessonId}.html`;
    for (const section of lesson.sections || []) {
      const sectionLabel = section.normalizedLabel || section.label || "";
      for (const ref of section.page?.refs || []) {
        const url = normalizeUrl(ref.url || "");
        if (!url) continue;
        if (isIspringUrl(url)) {
          ispringRows.push({
            course,
            unit: Number(raw.unit),
            lesson: Number(lesson.lesson),
            lessonId,
            lessonTitle: lesson.title || "",
            section: sectionLabel,
            url,
            expectedFilename: `${course}_U${String(Number(raw.unit)).padStart(2, "0")}_L${String(Number(lesson.lesson)).padStart(2, "0")}.zip`,
          });
        }
        if (!isDownloadableMoodleUrl(url)) continue;
        const kind = classify(url, `${ref.attr || "href"}-src`);
        const key = `${htmlPath}|${url}`;
        if (mediaKeys.has(key)) continue;
        mediaKeys.add(key);
        mediaItems.push({
          course,
          unit: Number(raw.unit),
          lesson: lessonId,
          htmlPath,
          label: `${sectionLabel || "Moodle section"} - ${lesson.title || lessonId}`,
          kind,
          attr: `${ref.attr || "href"}-src`,
          active: ref.attr !== "data-moodle-source",
          url,
          suggestedPath: suggestedPath(url, kind),
        });
      }
    }
  }
}

const uniqueIspringRows = [...new Map(ispringRows.map((row) => [`${row.lessonId}|${row.url}`, row])).values()].sort((a, b) =>
  `${a.unit}|${a.lesson}|${a.url}`.localeCompare(`${b.unit}|${b.lesson}|${b.url}`, undefined, { numeric: true }),
);
const sortedMediaItems = mediaItems.sort((a, b) =>
  `${a.unit}|${a.lesson}|${a.kind}|${a.url}`.localeCompare(`${b.unit}|${b.lesson}|${b.kind}|${b.url}`, undefined, { numeric: true }),
);

writeJson(ispringPath, {
  generatedAt: new Date().toISOString(),
  course,
  rows: uniqueIspringRows,
  totals: {
    rows: uniqueIspringRows.length,
    courses: uniqueIspringRows.length ? 1 : 0,
    lessons: new Set(uniqueIspringRows.map((row) => row.lessonId)).size,
  },
});
writeJson(mediaPath, {
  generatedAt: new Date().toISOString(),
  coursewareRoot: join(projectRoot, "..", "courseware"),
  course,
  totals: {
    items: sortedMediaItems.length,
    active: sortedMediaItems.filter((item) => item.active).length,
    sourceOnly: sortedMediaItems.filter((item) => !item.active).length,
    byKind: Object.fromEntries(
      [...new Set(sortedMediaItems.map((item) => item.kind))].sort().map((kind) => [kind, sortedMediaItems.filter((item) => item.kind === kind).length]),
    ),
  },
  items: sortedMediaItems,
});

console.log(
  JSON.stringify(
    {
      course,
      ispringPath,
      ispringRows: uniqueIspringRows.length,
      mediaPath,
      mediaItems: sortedMediaItems.length,
      mediaByKind: Object.fromEntries(
        [...new Set(sortedMediaItems.map((item) => item.kind))].sort().map((kind) => [kind, sortedMediaItems.filter((item) => item.kind === kind).length]),
      ),
    },
    null,
    2,
  ),
);
