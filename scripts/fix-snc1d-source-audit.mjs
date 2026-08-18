import { readFileSync, writeFileSync } from "node:fs";

const manifestPath = "D:/工作文件/SUNNYBROOK/courseware/SNC1D/course-manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const lessonIspring = (manifest.units || []).reduce(
  (sum, unit) => sum + (unit.lessons || []).reduce((lessonSum, lesson) => lessonSum + (lesson.ispring || []).length, 0),
  0,
);

manifest.sourceAudit = manifest.sourceAudit || {};
manifest.sourceAudit.lessonBookIspringRefs = lessonIspring;
manifest.sourceAudit.ispringExpectedFromBookRefs = lessonIspring;
manifest.sourceAudit.ispringComplete = lessonIspring;
manifest.sourceAudit.courseOverviewExternalIspring = {
  source: "https://hexstruct.ispring.com/s/embed_player/0bf86f2c-db30-11ed-92d9-36840ad1f71b",
  status: "not_manifested",
  reason: "The embed resolves to roll-preview output rather than a standard mirrored iSpring presentation package; no external playback URL is displayed.",
};
manifest.sourceAudit.note = "External H5P embeds are not displayed because local .h5p packages were not available. Lesson iSpring embeds are represented by local mirrored packages only; the Course Overview roll-preview embed is recorded for audit and not displayed as playback.";
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ lessonIspring }, null, 2));
