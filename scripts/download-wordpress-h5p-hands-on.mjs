import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const course = valueAfter("--course") || "ESLEO";
const workspaceRoot = resolve(valueAfter("--workspace-root") || "..");
const coursewareRoot = resolve(valueAfter("--courseware-root") || join(workspaceRoot, "courseware"));
const courseRoot = join(coursewareRoot, course);
const manifestPath = join(courseRoot, "course-manifest.json");

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeExternalH5pUrl(value) {
  return String(value || "").replaceAll("&amp;", "&");
}

function extractWordpressH5pIds(page) {
  const ids = [];
  const refs = [...(page.refs || [])];
  const html = String(page.html || "");
  const iframeMatches = html.matchAll(/welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed(?:&amp;|&)id=(\d+)/gi);
  for (const match of iframeMatches) {
    refs.push({ url: `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${match[1]}` });
  }
  for (const ref of refs) {
    const url = normalizeExternalH5pUrl(ref.url);
    const match = /welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed&id=(\d+)/i.exec(url);
    if (match && !ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

function extractTitle(html, fallback) {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return String(title || fallback).replace(/\s+/g, " ").trim();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, bytes);
  return bytes.length;
}

function lessonCode(unitNumber, lessonNumber) {
  return `U${unitNumber}L${lessonNumber}`;
}

function findRawBookPages(lessonDir) {
  const path = join(lessonDir, "book_pages_raw.json");
  return existsSync(path) ? readJson(path) : [];
}

function resourceExists(resources, path, source) {
  return resources.findIndex((item) => item.path === path || item.source === source);
}

if (!existsSync(manifestPath)) {
  throw new Error(`Missing manifest: ${manifestPath}`);
}

const manifest = readJson(manifestPath);
const downloads = [];
const skipped = [];
let changed = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const lessonSourceDir = lesson.sourceDir || lesson.path || "";
    const lessonDir = join(courseRoot, lessonSourceDir);
    const rawPages = findRawBookPages(lessonDir);
    const handsOnPages = rawPages.filter((page) => String(page.kind || "").toLowerCase() === "handson");
    for (const page of handsOnPages) {
      const ids = extractWordpressH5pIds(page);
      for (const id of ids) {
        const embedUrl = `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`;
        try {
          const embedHtml = await fetchText(embedUrl);
          const title = extractTitle(embedHtml, `${course} ${lessonCode(unit.unit, lesson.lesson)} Hands On Activity`);
          const exportUrl = `https://welcome.hexstruct.com/wp-content/uploads/h5p/exports/${slugify(title)}-${id}.h5p`;
          const relPath = toPosix(join(lessonSourceDir, "downloaded_resources", "hands_on", "h5p", `${slugify(title)}-${id}.h5p`));
          const absPath = join(courseRoot, relPath);
          const bytes = existsSync(absPath) ? 0 : await downloadFile(exportUrl, absPath);
          lesson.downloads = lesson.downloads || [];
          const record = {
            label: `Hands On Quiz - ${title}`,
            type: "h5p",
            category: "localized_moodle_resource",
            role: "hands_on",
            path: relPath,
            source: exportUrl,
          };
          if (bytes) record.bytes = bytes;
          const existing = resourceExists(lesson.downloads, relPath, exportUrl);
          if (existing >= 0) {
            lesson.downloads[existing] = { ...lesson.downloads[existing], ...record, bytes: lesson.downloads[existing].bytes || bytes || undefined };
          } else {
            lesson.downloads.push(record);
            changed += 1;
          }
          downloads.push({ unit: unit.unit, lesson: lesson.lesson, id, title, path: relPath, bytes });
        } catch (error) {
          skipped.push({ unit: unit.unit, lesson: lesson.lesson, id, reason: error.message });
        }
      }
    }
    lesson.resourceCounts = lesson.resourceCounts || {};
    lesson.resourceCounts.downloads = (lesson.downloads || []).length;
    lesson.resourceCounts.h5p = (lesson.downloads || []).filter((item) => item.type === "h5p").length;
  }
  unit.summary = unit.summary || {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  unit.summary.h5p = (unit.lessons || []).reduce(
    (sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length,
    0,
  );
}

if (changed || downloads.length) {
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

console.log(
  JSON.stringify(
    {
      course,
      downloaded: downloads.length,
      manifestItemsAdded: changed,
      skipped,
      downloads,
    },
    null,
    2,
  ),
);
