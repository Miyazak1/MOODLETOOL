import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ENG4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

const sources = [
  {
    id: "hamlet",
    title: "Hamlet",
    author: "William Shakespeare",
    type: "play",
    units: [2],
    lessons: ["U02L01", "U02L02", "U02L03", "U02L04", "U02L05", "U02L06"],
    filename: "Hamlet_Project_Gutenberg_1524.txt",
    sourceUrl: "https://www.gutenberg.org/cache/epub/1524/pg1524.txt",
    sourcePage: "https://www.gutenberg.org/ebooks/1524",
    sourceLabel: "Project Gutenberg eBook #1524",
    rights: "Public domain in the USA according to Project Gutenberg.",
    note: "Core drama text confirmed from ENG4U Moodle Unit 2 Act I-V lesson sequence.",
    validate: [/Hamlet/i, /William Shakespeare/i],
  },
  {
    id: "the-great-gatsby",
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    type: "novel",
    units: [4],
    lessons: ["U04L01", "U04L02", "U04L03", "U04L04", "U04L05", "U04L06"],
    filename: "The_Great_Gatsby_Project_Gutenberg_64317.txt",
    sourceUrl: "https://www.gutenberg.org/cache/epub/64317/pg64317.txt",
    sourcePage: "https://www.gutenberg.org/ebooks/64317",
    sourceLabel: "Project Gutenberg eBook #64317",
    rights: "Public domain in the USA according to Project Gutenberg.",
    note: "Core novel confirmed from ENG4U Moodle Unit 4 Chapter 1-9 lesson sequence and Unit 4 lesson plans.",
    validate: [/The Great Gatsby/i, /F\. Scott Fitzgerald|Fitzgerald/i],
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function sourceHeader(source) {
  return [
    `${source.title} by ${source.author}`,
    "",
    `Source: ${source.sourceLabel}`,
    `Source URL: ${source.sourcePage}`,
    `Plain text URL: ${source.sourceUrl}`,
    `Rights note: ${source.rights}`,
    "",
    "----",
    "",
  ].join("\n");
}

async function downloadText(source) {
  const response = await fetch(source.sourceUrl, {
    headers: { "user-agent": "ossd-course-portal-text-import/1.0" },
  });
  if (!response.ok) throw new Error(`Failed to download ${source.title}: HTTP ${response.status}`);
  const body = await response.text();
  for (const pattern of source.validate) {
    if (!pattern.test(body)) throw new Error(`Downloaded ${source.title} text did not match ${pattern}.`);
  }
  return `${sourceHeader(source)}${body.trim()}\n`;
}

async function ensureText(source) {
  const relativePath = toPosix(`texts/${source.id}/${source.filename}`);
  const outputDir = join(courseRoot, "texts", source.id);
  const outputPath = join(outputDir, source.filename);
  mkdirSync(outputDir, { recursive: true });
  const text = await downloadText(source);
  writeFileSync(outputPath, text, "utf8");
  return {
    ...source,
    path: relativePath,
    bytes: statSync(outputPath).size,
  };
}

function textEntry(source) {
  return {
    id: source.id,
    title: source.title,
    author: source.author,
    type: source.type,
    units: source.units,
    lessons: source.lessons,
    copyrightStatus: "public_domain",
    sourceStatus: "downloadable",
    notes: source.note,
    materials: [
      {
        label: source.filename,
        type: "txt",
        category: "text_material",
        role: "core_text",
        path: source.path,
        bytes: source.bytes,
      },
    ],
    publicDomainSource: {
      label: source.sourceLabel,
      url: source.sourcePage,
      rights: source.rights,
    },
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function patchManifest(imports) {
  const manifest = readJson(manifestPath);
  const replacementIds = new Set(imports.map((source) => source.id));
  manifest.texts = [
    ...(manifest.texts || []).filter((text) => !replacementIds.has(text.id)),
    ...imports.map(textEntry),
  ];

  const coreTextByUnit = new Map();
  for (const source of imports) {
    for (const unit of source.units) {
      coreTextByUnit.set(unit, [...(coreTextByUnit.get(unit) || []), source.id]);
    }
  }

  for (const unit of manifest.units || []) {
    const additions = coreTextByUnit.get(unit.unit) || [];
    unit.coreTexts = additions.length ? unique([...(unit.coreTexts || []), ...additions]) : unit.coreTexts || [];
  }

  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    eng4uTextMaterialIndexPatchedAt: new Date().toISOString(),
    eng4uTextMaterialCount: imports.length,
    eng4uTextMaterialSources: imports.map((source) => ({
      id: source.id,
      source: source.sourcePage,
    })),
  };
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
  return manifest;
}

const imports = [];
for (const source of sources) {
  imports.push(await ensureText(source));
}

const manifest = patchManifest(imports);
console.log(`${course}: wrote ${imports.length} text material(s).`);
for (const source of imports) {
  console.log(`- ${source.title}: ${source.path} (${source.bytes} bytes)`);
}
console.log(`Manifest texts: ${(manifest.texts || []).length}`);
