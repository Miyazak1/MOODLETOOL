import { readFileSync, writeFileSync } from "node:fs";

const manifestPath = "D:/工作文件/SUNNYBROOK/courseware/SNC1D/course-manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.ispring || []) {
      item.mode = "page";
      if (item.url && !/^https?:\/\//i.test(item.url)) delete item.url;
      delete item.downloadPath;
      delete item.downloadUrl;
    }
  }
}

manifest.texts = (manifest.texts || []).map((text) => ({
  id: text.id || "grade-9-on-science-textbook",
  title: text.title || text.label || "Grade 9 ON Science Textbook (McGraw-Hill Ryerson)",
  units: Array.isArray(text.units) ? text.units : [1, 2, 3, 4],
  ...text,
}));

manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ fixed: true }, null, 2));
