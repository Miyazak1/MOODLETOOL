import fs from "node:fs";
import path from "node:path";

const courseRoot = "D:/工作文件/SUNNYBROOK/courseware/SBI3U";
const manifestPath = path.join(courseRoot, "course-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function localPath(value) {
  if (!value || /^https?:\/\//i.test(value)) return null;
  return String(value).replace(/\\/g, "/");
}

let refreshed = 0;
function visit(value) {
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }
  if (!value || typeof value !== "object") return;

  const rel = localPath(value.path || value.previewPath || value.downloadPath);
  if (rel) {
    const file = path.join(courseRoot, rel);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const nextBytes = fs.statSync(file).size;
      if (value.bytes !== nextBytes) {
        value.bytes = nextBytes;
        refreshed += 1;
      }
    }
  }

  for (const child of Object.values(value)) visit(child);
}

visit(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit ||= {};
manifest.sourceAudit.sbi3uManifestBytesRefresh = {
  refreshedAt: manifest.generatedAt,
  refreshed,
  reason: "SBI3U generated HTML file display normalized to MDM4U attachment style."
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ course: "SBI3U", refreshed }, null, 2));
