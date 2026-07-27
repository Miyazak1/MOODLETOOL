import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "ENG2D", "course-manifest.json");

const moodleResourceToTextId = new Map([
  [387, "lady-or-the-tiger"],
  [390, "the-interlopers"],
  [392, "the-rocking-horse-winner"],
  [395, "myth-of-prometheus"],
  [398, "daedalus-and-icarus"],
  [402, "landscape-with-the-fall-of-icarus"],
  [410, "queen-elizabeth-address-to-the-troops"],
  [413, "i-have-a-dream"],
  [414, "jfk-inaugural-address"],
  [415, "pearl-harbor-address"],
  [432, "lord-of-the-flies"],
  [466, "othello"],
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const manifest = readJson(manifestPath);
const localizedByText = new Map();

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.downloads || []) {
      if (!item.path || item.role !== "source_text") continue;
      const moodleId = Number(/-(\d+)-/.exec(item.path)?.[1]);
      const textId = moodleResourceToTextId.get(moodleId);
      if (!textId) continue;
      localizedByText.set(textId, {
        label: item.label,
        type: item.type,
        category: "moodle_resource",
        role: "source_text",
        path: item.path,
        source: "localized authenticated Moodle resource",
        bytes: item.bytes,
      });
    }
  }
}

let updated = 0;
for (const text of manifest.texts || []) {
  const localized = localizedByText.get(text.id);
  if (!localized) continue;
  const materials = text.materials || [];
  if (!materials.some((item) => item.path === localized.path)) {
    materials.push(localized);
    updated += 1;
  }
  text.materials = materials;
  text.externalLinks = [];
  text.sourceStatus = "Local Moodle file";
}

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  eng2dTextMaterialsPatchedAt: new Date().toISOString(),
  eng2dLocalizedTextMaterialCount: localizedByText.size,
};

writeJson(manifestPath, manifest);
console.log(`ENG2D: linked ${localizedByText.size} localized Moodle text materials; added ${updated} new material record(s).`);
