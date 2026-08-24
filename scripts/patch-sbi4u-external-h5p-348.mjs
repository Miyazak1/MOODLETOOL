import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SBI4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const url = "https://welcome.hexstruct.com/wp-content/uploads/h5p/exports/sbi4u-unit-1-lesson-1-hands-on-activity-348.h5p";
const targetRel = "localized-moodle/h5p-external/0348-title.h5p";
const targetPath = join(courseRoot, targetRel);

const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
const buffer = Buffer.from(await response.arrayBuffer());
if (!response.ok || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error(`H5P 348 download failed: HTTP ${response.status}, bytes ${buffer.length}`);
mkdirSync(dirname(targetPath), { recursive: true });
writeFileSync(targetPath, buffer);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const unit = manifest.units.find((item) => Number(item.unit) === 1);
const lesson = unit?.lessons?.find((item) => Number(item.lesson) === 1);
if (!lesson) throw new Error("Missing U01L01 in manifest");
lesson.downloads ||= [];
const record = {
  label: "External H5P - Title",
  type: "h5p",
  category: "localized_external_h5p",
  role: "hands_on",
  path: targetRel,
  bytes: statSync(targetPath).size,
  source: "https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=348",
  previewPath: targetRel.replace(/\.h5p$/i, "/index.html"),
};
const existing = lesson.downloads.findIndex((item) => item.source === record.source && item.role === record.role);
if (existing >= 0) lesson.downloads[existing] = record;
else lesson.downloads.push(record);
lesson.resourceCounts ||= {};
lesson.resourceCounts.downloads = lesson.downloads.length;
lesson.resourceCounts.h5p = lesson.downloads.filter((item) => item.type === "h5p").length;

for (const summaryUnit of manifest.units || []) {
  summaryUnit.summary ||= {};
  summaryUnit.summary.downloads = (summaryUnit.lessons || []).reduce((sum, item) => sum + (item.downloads?.length || 0), 0);
  summaryUnit.summary.h5p = (summaryUnit.lessons || []).reduce((sum, item) => sum + (item.downloads || []).filter((download) => download.type === "h5p").length, 0);
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.externalH5pLocalized = 38;
manifest.sourceAudit.externalH5pFailed = 0;
manifest.sourceAudit.h5pExternalEmbedsPending = 0;
manifest.sourceAudit.h5pExternalManualFixes = [{ id: "348", path: targetRel, exportUrl: url }];
manifest.sourceAudit.note = "Localized iSpring embeds, Moodle H5P activity packages, and external WordPress H5P embeds are represented by local courseware resources only; no external playback links are used.";

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ course, path: relative(courseRoot, targetPath), bytes: buffer.length }, null, 2));
