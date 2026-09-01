import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SCH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const outDir = join(courseRoot, "localized-moodle", "h5p-external");
const reportPath = join(projectRoot, "deployment", "SCH3U-external-h5p-download-report.json");

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
  return (
    String(value || "h5p")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "h5p"
  );
}

function extractWordpressH5pIds(page) {
  const html = String(page.html || "").replaceAll("&amp;", "&");
  return [...html.matchAll(/welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed&id=(\d+)/gi)].map((match) => match[1]);
}

function extractJsonString(html, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i").exec(html);
  if (!match) return "";
  return JSON.parse(`"${match[1]}"`);
}

function titleFromEmbed(html, id) {
  return (
    extractJsonString(html, "title") ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
    `H5P ${id}`
  );
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { buffer, contentType: response.headers.get("content-type") || "", finalUrl: response.url || url };
}

function validateH5p(buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("downloaded H5P is not a ZIP package");
}

function recordIndex(resources, source) {
  return (resources || []).findIndex((item) => item.source === source);
}

const manifest = readJson(manifestPath);
const seen = new Set();
const downloaded = [];
const skipped = [];
const failures = [];

mkdirSync(outDir, { recursive: true });

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const lessonDir = join(courseRoot, lesson.sourceDir || lesson.path || "");
    const rawPath = join(lessonDir, "book_pages_raw.json");
    if (!existsSync(rawPath)) continue;
    const rawPages = readJson(rawPath);
    const ids = rawPages.flatMap((page) => extractWordpressH5pIds(page));
    for (const id of ids) {
      const embedUrl = `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`;
      const key = `${lesson.id}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const embed = await fetchBytes(embedUrl);
        const embedHtml = embed.buffer.toString("utf8");
        const exportUrl = extractJsonString(embedHtml, "exportUrl");
        if (!exportUrl) {
          skipped.push({ unit: unit.unit, lesson: lesson.id, id, embedUrl, reason: "missing-exportUrl" });
          continue;
        }
        const title = titleFromEmbed(embedHtml, id);
        const absoluteExportUrl = new URL(exportUrl, "https://welcome.hexstruct.com").toString();
        const h5p = await fetchBytes(absoluteExportUrl);
        validateH5p(h5p.buffer);
        const name = `${String(id).padStart(4, "0")}-${slugify(title)}.h5p`;
        const targetPath = join(outDir, name);
        if (!existsSync(targetPath)) writeFileSync(targetPath, h5p.buffer);
        const relPath = toPosix(relative(courseRoot, targetPath));
        const record = {
          label: `Hands On H5P - ${title}`,
          type: "h5p",
          category: "localized_external_h5p",
          role: "hands_on",
          path: relPath,
          bytes: statSync(targetPath).size,
          source: embedUrl,
          exportUrl: absoluteExportUrl,
          previewPath: relPath.replace(/\.h5p$/i, "/index.html"),
        };
        lesson.downloads ||= [];
        const index = recordIndex(lesson.downloads, embedUrl);
        if (index >= 0) lesson.downloads[index] = { ...lesson.downloads[index], ...record };
        else lesson.downloads.push(record);
        lesson.resourceCounts ||= {};
        lesson.resourceCounts.downloads = lesson.downloads.length;
        lesson.resourceCounts.h5p = (lesson.downloads || []).filter((item) => item.type === "h5p").length;
        downloaded.push({ unit: unit.unit, lesson: lesson.id, id, title, path: relPath, bytes: record.bytes, exportUrl: absoluteExportUrl });
      } catch (error) {
        failures.push({ unit: unit.unit, lesson: lesson.id, id, embedUrl, error: String(error?.message || error) });
      }
    }
  }
}

for (const unit of manifest.units || []) {
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  unit.summary.h5p = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length, 0);
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.externalH5pEmbeds = seen.size;
manifest.sourceAudit.externalH5pLocalized = downloaded.length;
manifest.sourceAudit.externalH5pSkipped = skipped.length;
manifest.sourceAudit.externalH5pFailed = failures.length;
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
writeJson(reportPath, {
  generatedAt: new Date().toISOString(),
  course,
  totalEmbeds: seen.size,
  downloaded,
  skipped,
  failures,
});

console.log(JSON.stringify({
  embeds: seen.size,
  downloaded: downloaded.length,
  skipped: skipped.length,
  failures: failures.length,
  reportPath: toPosix(relative(projectRoot, reportPath)),
}, null, 2));

if (failures.length) process.exitCode = 1;
