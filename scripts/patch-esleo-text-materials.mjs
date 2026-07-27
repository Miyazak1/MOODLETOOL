import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLEO";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const romeoPath = "texts/romeo-and-juliet/Romeo_and_Juliet_Project_Gutenberg_1513.txt";
const romeoUrl = "https://www.gutenberg.org/cache/epub/1513/pg1513.txt";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function ensureRomeoText() {
  const outputPath = join(courseRoot, romeoPath);
  mkdirSync(join(courseRoot, "texts", "romeo-and-juliet"), { recursive: true });
  const response = await fetch(romeoUrl, { headers: { "user-agent": "ossd-course-portal-text-import/1.0" } });
  if (!response.ok) throw new Error(`Failed to download Romeo and Juliet: HTTP ${response.status}`);
  const text = await response.text();
  if (!/Romeo and Juliet/i.test(text) || !/William Shakespeare/i.test(text)) {
    throw new Error("Downloaded Romeo and Juliet text did not match expected content.");
  }
  writeFileSync(outputPath, text, "utf8");
  return Buffer.byteLength(text, "utf8");
}

const romeoBytes = await ensureRomeoText();
const manifest = readJson(manifestPath);

manifest.texts = [
  {
    id: "romeo-and-juliet",
    title: "Romeo and Juliet",
    author: "William Shakespeare",
    type: "play",
    units: [2],
    lessons: ["U02L03", "U02L04", "U02L05", "U02L06", "U02L07", "U02L08"],
    copyrightStatus: "public_domain",
    sourceStatus: "downloadable",
    notes: "Core drama text detected from ESLEO Moodle Book Unit 2 lesson sequence.",
    materials: [
      {
        label: "Romeo_and_Juliet_Project_Gutenberg_1513.txt",
        type: "txt",
        category: "text_material",
        role: "core_text",
        path: romeoPath,
        bytes: romeoBytes,
      },
    ],
    publicDomainSource: {
      label: "Project Gutenberg eBook #1513",
      url: "https://www.gutenberg.org/ebooks/1513",
      rights: "Public domain in the USA according to Project Gutenberg.",
    },
  },
  {
    id: "of-mice-and-men",
    title: "Of Mice and Men",
    author: "John Steinbeck",
    type: "novella",
    units: [4],
    lessons: ["U04L01", "U04L02", "U04L03", "U04L04", "U04L05"],
    copyrightStatus: "copyrighted",
    sourceStatus: "unavailable",
    notes: "Core novella detected from ESLEO Moodle Book Unit 4 lesson sequence; no complete local source-text file was found in Moodle-localized resources.",
    materials: [],
    externalLinks: [],
  },
];

manifest.textMaterials = [];
manifest.textExternalLinks = [];
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  textMaterialIndexPatchedAt: new Date().toISOString(),
  textMaterialCount: manifest.texts.reduce((sum, text) => sum + (text.materials?.length || 0), 0),
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(`${course}: wrote ${manifest.texts.length} text index entries; materials ${manifest.sourceAudit.textMaterialCount}`);
