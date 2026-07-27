import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLEO";
const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function isIspringUrl(url) {
  return /hexstruct\.ispring\.com\/s\/embed_player\//i.test(String(url || "")) || /ispring/i.test(String(url || ""));
}

function dedupeByUrl(items) {
  const byUrl = new Map();
  for (const item of items || []) {
    const key = item.url || item.path || item.label;
    if (key) byUrl.set(key, item);
  }
  return [...byUrl.values()];
}

const manifest = readJson(manifestPath);
let count = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const rawPath = join(workspaceRoot, "courseware", course, lesson.path, "book_pages_raw.json");
    const pages = readJson(rawPath);
    const records = [];
    for (const page of pages || []) {
      const sectionLabel = page.normalizedLabel || page.sourceLabel || "";
      for (const ref of page.refs || []) {
        if (!isIspringUrl(ref.url)) continue;
        records.push({
          label: `${sectionLabel || "Lesson"} - ${lesson.title}`,
          mode: "external",
          url: ref.url,
          source: page.url || "authenticated Moodle Book crawl",
        });
      }
    }
    lesson.ispring = dedupeByUrl([...(lesson.ispring || []), ...records]);
    lesson.resourceCounts = lesson.resourceCounts || {};
    lesson.resourceCounts.ispring = lesson.ispring.length;
    count += lesson.ispring.length;
  }
}

for (const unit of manifest.units || []) {
  unit.summary = unit.summary || {};
  unit.summary.ispring = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0);
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  ispringExpected: count,
  ispringExternalEmbedCount: count,
  ispringComplete: manifest.sourceAudit?.ispringComplete || 0,
  ispringEmbedPatchedAt: new Date().toISOString(),
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(`${course}: linked ${count} external iSpring embeds from Moodle Book raw pages`);
