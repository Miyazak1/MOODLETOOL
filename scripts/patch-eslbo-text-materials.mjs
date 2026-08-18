import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLBO";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

const AESOP_SOURCE = {
  id: "aesops-fables",
  title: "Aesop's Fables",
  author: "Aesop; translated by V. S. Vernon Jones",
  type: "fable_collection",
  units: [2],
  lessons: ["U02L01"],
  filename: "Aesops_Fables_Project_Gutenberg_11339.txt",
  sourceUrl: "https://www.gutenberg.org/cache/epub/11339/pg11339.txt",
  sourcePage: "https://www.gutenberg.org/ebooks/11339",
  sourceLabel: "Project Gutenberg eBook #11339",
  rights: "Public domain in the USA according to Project Gutenberg.",
};

const HARE_AND_TORTOISE = {
  id: "the-hare-and-the-tortoise",
  title: "The Hare and the Tortoise",
  author: "Aesop; Sunnybrook Moodle worksheet",
  type: "fable",
  units: [2],
  lessons: ["U02L01"],
  materialPath: "localized-moodle-activities/assign/U02L01-4970-460f158609/files/c845923cd1-The-Hare-and-Tortoise-Story-WorksheetAFL.pdf",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/plain,text/*;q=0.9,*/*;q=0.7",
      "user-agent": "ossd-course-portal-public-domain-text-import/1.0",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function ensureAesopText() {
  const relativePath = toPosix(`texts/${AESOP_SOURCE.id}/${AESOP_SOURCE.filename}`);
  const absolutePath = join(courseRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const sourceText = await fetchText(AESOP_SOURCE.sourceUrl);
  if (!/AESOP'S FABLES/i.test(sourceText) || !/HARE AND THE TORTOISE/i.test(sourceText)) {
    throw new Error("Downloaded Aesop text did not match expected Project Gutenberg content.");
  }
  const header = [
    AESOP_SOURCE.title,
    "",
    `Source: ${AESOP_SOURCE.sourceLabel}`,
    `Source page: ${AESOP_SOURCE.sourcePage}`,
    `Source URL: ${AESOP_SOURCE.sourceUrl}`,
    `Rights note: ${AESOP_SOURCE.rights}`,
    "",
    "----",
    "",
  ].join("\n");
  writeFileSync(absolutePath, `${header}${sourceText.trim()}\n`, "utf8");
  return {
    label: AESOP_SOURCE.filename,
    type: "txt",
    category: "text_material",
    role: "core_text",
    path: relativePath,
    bytes: statSync(absolutePath).size,
    source: AESOP_SOURCE.sourceUrl,
  };
}

function hareMaterial() {
  const absolutePath = join(courseRoot, HARE_AND_TORTOISE.materialPath);
  return {
    label: "The-Hare-and-Tortoise-Story-WorksheetAFL.pdf",
    type: "pdf",
    category: "text_material",
    role: "core_text",
    path: HARE_AND_TORTOISE.materialPath,
    bytes: statSync(absolutePath).size,
    source: "https://www.esunnybrook.com/mod/assign/view.php?id=4970",
  };
}

function upsertText(texts, record) {
  const index = texts.findIndex((item) => item.id === record.id);
  if (index >= 0) texts[index] = { ...texts[index], ...record };
  else texts.push(record);
}

function writeTextDocs(texts) {
  const readme = `# ESLBO Text Materials

This folder contains local text materials referenced by course-manifest.json.

- Unit 2 is the only ESLBO unit with a clear literary-text focus in the Moodle course: Fables.
- A public-domain Project Gutenberg copy of Aesop's Fables is included for local reading and download.
- The Moodle worksheet for "The Hare and the Tortoise" is indexed as the course-specific fable handout.
- Units 1, 3, 4, and 5 are language-skills, Canadian government/resources, teen-culture, ISP, and exam work, so no unrelated textbook or literary work is forced into the index.
`;
  const sources = `# ESLBO Text Sources

## Public Domain

- ${AESOP_SOURCE.title}: ${AESOP_SOURCE.sourceLabel}. ${AESOP_SOURCE.sourcePage}. ${AESOP_SOURCE.rights}

## Moodle Localized Materials

- ${HARE_AND_TORTOISE.title}: localized from Sunnybrook Moodle assignment 4970; file ${HARE_AND_TORTOISE.materialPath}.
`;
  mkdirSync(join(courseRoot, "texts"), { recursive: true });
  writeFileSync(join(courseRoot, "texts", "README.md"), readme, "utf8");
  writeFileSync(join(courseRoot, "texts", "SOURCES.md"), sources, "utf8");

  const index = [
    "# ESLBO Text Index",
    "",
    ...texts.map((text) => `- ${text.title} (${text.author}) — Unit ${(text.units || []).join(", ") || "-"} — ${(text.materials || []).map((item) => item.path).join("; ") || "no local file"}`),
    "",
  ].join("\n");
  writeFileSync(join(courseRoot, "texts", "INDEX.md"), index, "utf8");
}

const aesopMaterial = await ensureAesopText();
const hare = hareMaterial();
const manifest = readJson(manifestPath);

manifest.texts = manifest.texts || [];
const additions = [
  {
    id: AESOP_SOURCE.id,
    title: AESOP_SOURCE.title,
    author: AESOP_SOURCE.author,
    type: AESOP_SOURCE.type,
    units: AESOP_SOURCE.units,
    lessons: AESOP_SOURCE.lessons,
    copyrightStatus: "public_domain",
    sourceStatus: "downloadable",
    notes: "Public-domain fable collection added for Unit 2 Fables.",
    materials: [aesopMaterial],
    publicDomainSource: {
      label: AESOP_SOURCE.sourceLabel,
      url: AESOP_SOURCE.sourcePage,
      rights: AESOP_SOURCE.rights,
    },
    externalLinks: [
      {
        label: AESOP_SOURCE.sourceLabel,
        type: "url",
        category: "public_domain_source",
        role: "source",
        url: AESOP_SOURCE.sourcePage,
        source: AESOP_SOURCE.rights,
      },
    ],
  },
  {
    id: HARE_AND_TORTOISE.id,
    title: HARE_AND_TORTOISE.title,
    author: HARE_AND_TORTOISE.author,
    type: HARE_AND_TORTOISE.type,
    units: HARE_AND_TORTOISE.units,
    lessons: HARE_AND_TORTOISE.lessons,
    copyrightStatus: "school_licensed",
    sourceStatus: "downloadable",
    notes: "Course-specific Moodle fable worksheet downloaded from Unit 2 Lesson 1.",
    materials: [hare],
  },
];

for (const record of additions) upsertText(manifest.texts, record);
manifest.texts.sort((a, b) => `${a.units?.[0] || 99}|${a.title}`.localeCompare(`${b.units?.[0] || 99}|${b.title}`));

for (const unit of manifest.units || []) {
  if (Number(unit.unit) === 2) {
    unit.coreTexts = [...new Set([...(unit.coreTexts || []), AESOP_SOURCE.id, HARE_AND_TORTOISE.id])];
  } else {
    unit.coreTexts = unit.coreTexts || [];
  }
}

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  textMaterialIndexPatchedAt: new Date().toISOString(),
  textMaterialCount: manifest.texts.reduce((sum, text) => sum + (text.materials?.length || 0), 0),
  textMaterialNotes: "ESLBO text index scoped to Unit 2 Fables; no unrelated texts forced into other units.",
};

writeJson(manifestPath, manifest);
writeTextDocs(additions);

console.log(
  JSON.stringify(
    {
      course,
      texts: additions.length,
      totalTexts: manifest.texts.length,
      materials: additions.reduce((sum, text) => sum + text.materials.length, 0),
      aesopPath: aesopMaterial.path,
      harePath: hare.path,
    },
    null,
    2,
  ),
);
