import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ENG3U");
const manifestPath = join(courseRoot, "course-manifest.json");
const dryRun = process.argv.includes("--dry-run");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function suffixForItem(item, count) {
  if (count <= 1) return "";
  const match = String(item.path || "").match(/html5-package-(.+?)\/presentation\.html$/i);
  return match ? `-${match[1].toLowerCase()}` : "-ispring";
}

function packagePathFromPresentation(path) {
  return toPosix(path).replace(/\/presentation\.html$/i, "");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const moves = [];

for (const unit of manifest.units || []) {
  const unitNo = Number(unit.unit);
  for (let lessonIndex = 0; lessonIndex < (unit.lessons || []).length; lessonIndex += 1) {
    const lesson = unit.lessons[lessonIndex];
    const lessonNo = lessonIndex + 1;
    const ispringItems = lesson.ispring || [];
    for (const item of ispringItems) {
      if (!item.path || item.path.startsWith("ispring-localized/")) {
        item.type = item.type || "ispring";
        item.category = item.category || "ispring";
        if (item.path) item.packagePath = packagePathFromPresentation(item.path);
        delete item.downloadPath;
        delete item.downloadUrl;
        continue;
      }
      const oldPresentationRel = toPosix(item.path);
      const oldPackageRel = oldPresentationRel.replace(/\/presentation\.html$/i, "");
      const targetFolder = `U${pad(unitNo)}L${pad(lessonNo)}${suffixForItem(item, ispringItems.length)}`;
      const newPackageRel = `ispring-localized/unit-${pad(unitNo)}/${targetFolder}`;
      const newPresentationRel = `${newPackageRel}/presentation.html`;
      moves.push({ oldPackageRel, newPackageRel, oldPresentationRel, newPresentationRel });
      item.path = newPresentationRel;
      item.packagePath = newPackageRel;
      item.type = "ispring";
      item.category = "ispring";
      delete item.downloadPath;
      delete item.downloadUrl;
    }
  }
}

for (const move of moves) {
  const oldAbs = join(courseRoot, move.oldPackageRel);
  const newAbs = join(courseRoot, move.newPackageRel);
  if (!existsSync(oldAbs)) {
    if (!existsSync(newAbs)) throw new Error(`Missing iSpring package: ${move.oldPackageRel}`);
    continue;
  }
  if (existsSync(newAbs)) throw new Error(`Target already exists: ${move.newPackageRel}`);
  if (!dryRun) {
    mkdirSync(dirname(newAbs), { recursive: true });
    renameSync(oldAbs, newAbs);
  }
}

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  ispringLocalizedPathMigration: {
    migratedAt: new Date().toISOString(),
    policy: "ispring packages live under ispring-localized/unit-XX/UXXLXX",
    movedPackages: moves.length,
    note: "ENG3U legacy lesson html5-package paths were normalized to match current courseware and OSS/CDN import conventions.",
  },
};

if (!dryRun) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  course: "ENG3U",
  dryRun,
  moves: moves.length,
  samples: moves.slice(0, 8),
}, null, 2));
