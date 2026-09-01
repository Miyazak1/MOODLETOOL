import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLEO";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const sourcePath = join(workspaceRoot, "docs", "Of Mice And Men Pages 1-50 - Flip PDF Download _ FlipHTML5.pdf");
const textPath = "texts/of-mice-and-men/Of-Mice-and-Men.pdf";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function assertPdf(path) {
  const buffer = readFileSync(path, { start: 0, end: 4 });
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    throw new Error(`Expected PDF file: ${path}`);
  }
}

if (!existsSync(sourcePath)) throw new Error(`Missing user-provided legal text file: ${sourcePath}`);
assertPdf(sourcePath);

const targetPath = join(courseRoot, textPath);
mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);
const bytes = statSync(targetPath).size;

const manifest = readJson(manifestPath);
const existingTexts = Array.isArray(manifest.texts) ? manifest.texts : [];
const textsById = new Map(existingTexts.map((item) => [item.id, item]));
textsById.set("of-mice-and-men", {
  ...(textsById.get("of-mice-and-men") || {}),
  id: "of-mice-and-men",
  title: "Of Mice and Men",
  author: "John Steinbeck",
  type: "novella",
  units: [4],
  lessons: ["U04L01", "U04L02", "U04L03", "U04L04", "U04L05"],
  copyrightStatus: "licensed_local_copy",
  sourceStatus: "provided_by_user",
  notes: "Legally obtained local copy provided by the user for ESLEO Unit 4.",
  materials: [
    {
      label: "Of Mice and Men",
      type: "pdf",
      category: "text_material",
      role: "core_text",
      path: textPath,
      bytes,
      source: "local legally obtained file: docs/Of Mice And Men Pages 1-50 - Flip PDF Download _ FlipHTML5.pdf",
      previewPath: "",
    },
  ],
  externalLinks: [],
});

const orderedIds = ["romeo-and-juliet", "of-mice-and-men"];
manifest.texts = [
  ...orderedIds.map((id) => textsById.get(id)).filter(Boolean),
  ...[...textsById.values()].filter((item) => !orderedIds.includes(item.id)),
];
manifest.sourceAudit ||= {};
manifest.sourceAudit.textMaterialIndexPatchedAt = new Date().toISOString();
manifest.sourceAudit.textMaterialCount = manifest.texts.reduce((sum, item) => sum + (item.materials?.length || 0), 0);
manifest.sourceAudit.ofMiceAndMenText = {
  status: "included",
  sourceFile: "docs/Of Mice And Men Pages 1-50 - Flip PDF Download _ FlipHTML5.pdf",
  path: textPath,
  bytes,
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(JSON.stringify({ course, path: textPath, bytes }, null, 2));
