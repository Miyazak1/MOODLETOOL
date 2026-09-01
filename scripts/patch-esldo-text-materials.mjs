import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ESLDO";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

const ROMEO_SOURCE = {
  id: "romeo-and-juliet",
  title: "Romeo and Juliet",
  author: "William Shakespeare",
  type: "play",
  units: [2],
  lessons: ["U02L01", "U02L02", "U02L03", "U02L04", "U02L05", "U02L06"],
  copyrightStatus: "public_domain",
  sourceStatus: "downloadable",
  notes: "Core play for Unit 2. Public-domain full text added for local reading and download.",
  filename: "Romeo_and_Juliet_Project_Gutenberg_1513.txt",
  sourceUrl: "https://www.gutenberg.org/cache/epub/1513/pg1513.txt",
  sourceLabel: "Project Gutenberg eBook #1513",
  rights: "Public domain in the USA according to Project Gutenberg.",
};

const UNIT1_TEXTS = [
  {
    id: "the-myth-of-uranus",
    title: "The Myth of Uranus",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L02"],
    match: ["The-Myth-of-Uranus-Reading-and-Response"],
  },
  {
    id: "the-myth-of-prometheus",
    title: "The Myth of Prometheus",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L03"],
    match: ["The-Myth-of-Prometheus-Reading-and-Response"],
  },
  {
    id: "pandoras-box",
    title: "Pandora's Box",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L04"],
    match: ["The-Myth-of-Pandora-Reading-and-Response"],
  },
  {
    id: "demeter-and-midas",
    title: "Demeter and Midas",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L05"],
    match: ["The-Myth-of-Demeter-Midas"],
  },
  {
    id: "eros-and-psyche",
    title: "Eros and Psyche",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L06"],
    match: ["The-Myth-of-Eros-and-Psyche"],
  },
  {
    id: "daedalus",
    title: "Daedalus",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L07"],
    match: ["The-Myth-of-Daedalus"],
  },
  {
    id: "orpheus",
    title: "Orpheus",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L08"],
    match: ["The-Myth-of-Orpheus.docx"],
  },
  {
    id: "echo-and-narcissus",
    title: "Echo and Narcissus",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L09"],
    match: ["The-Myth-of-Echo-and-Narcissus"],
  },
  {
    id: "theseus-and-perseus",
    title: "Theseus and Perseus",
    author: "Sunnybrook Moodle course handout",
    lessons: ["U01L10"],
    match: ["The-Myth-of-Theseus", "Perseus-Heros-Journey-Activity", "Perseus-Mythology-Matching-Activity-Worksheet"],
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function textHeader(source) {
  return [
    source.filename.replace(/[_-]/g, " ").replace(/\.[^.]+$/, ""),
    "",
    `Source: ${source.sourceLabel}`,
    `Source URL: ${source.sourceUrl}`,
    `Rights note: ${source.rights}`,
    "",
    "----",
    "",
  ].join("\n");
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

function normalizeDownloadLabel(value) {
  return String(value || "")
    .replace(/^(DOCUMENT|PDF|TXT)\s*-\s*/i, "")
    .trim();
}

function materialFromResource(resource, role = "core_text") {
  const record = {
    label: normalizeDownloadLabel(resource.label),
    type: resource.type,
    category: "text_material",
    role,
    path: resource.path,
    bytes: resource.bytes,
  };
  if (resource.previewPath) record.previewPath = resource.previewPath;
  if (resource.source) record.source = resource.source;
  return record;
}

function collectLessonResources(manifest) {
  const resources = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) {
        resources.push({ unit: unit.unit, lessonId: lesson.id, lessonTitle: lesson.title, item });
      }
    }
  }
  return resources;
}

function findMaterials(resources, definition) {
  const lessons = new Set(definition.lessons || []);
  const matches = definition.match.map((value) => value.toLowerCase());
  return resources
    .filter(({ lessonId, item }) => {
      if (lessons.size && !lessons.has(lessonId)) return false;
      const haystack = `${item.label || ""} ${item.path || ""}`.toLowerCase();
      return matches.some((needle) => haystack.includes(needle.toLowerCase()));
    })
    .map(({ item }) => materialFromResource(item));
}

async function ensureRomeoText() {
  const relativePath = toPosix(`texts/${ROMEO_SOURCE.id}/${ROMEO_SOURCE.filename}`);
  const absolutePath = join(courseRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const text = `${textHeader(ROMEO_SOURCE)}${(await fetchText(ROMEO_SOURCE.sourceUrl)).trim()}\n`;
  writeFileSync(absolutePath, text, "utf8");
  return {
    label: ROMEO_SOURCE.filename,
    type: "txt",
    category: "text_material",
    role: "core_text",
    path: relativePath,
    bytes: statSync(absolutePath).size,
    source: ROMEO_SOURCE.sourceUrl,
  };
}

function upsertText(texts, record) {
  const index = texts.findIndex((item) => item.id === record.id);
  if (index >= 0) texts[index] = { ...texts[index], ...record };
  else texts.push(record);
}

function setCoreTexts(manifest) {
  const byUnit = new Map([
    [1, UNIT1_TEXTS.map((item) => item.id)],
    [2, [ROMEO_SOURCE.id]],
    [3, []],
    [4, []],
  ]);
  for (const unit of manifest.units || []) {
    unit.coreTexts = byUnit.get(Number(unit.unit)) || unit.coreTexts || [];
  }
}

function writeTextDocs(texts) {
  const readme = `# ESLDO Text Materials

This folder contains local text materials referenced by course-manifest.json.

- Unit 1 literature materials point to Moodle handouts that were downloaded into localized-moodle/.
- Unit 2 includes a public-domain Project Gutenberg copy of Romeo and Juliet.
- Unit 3 and Unit 4 are writing/life-skills units, so no literary core text is forced into the index.
`;
  const sources = [
    "# ESLDO Text Sources",
    "",
    "## Public Domain",
    "",
    `- ${ROMEO_SOURCE.title}: ${ROMEO_SOURCE.sourceLabel}. ${ROMEO_SOURCE.sourceUrl}. ${ROMEO_SOURCE.rights}`,
    "",
    "## Moodle Localized Materials",
    "",
    ...texts
      .filter((text) => text.copyrightStatus === "school_licensed")
      .map((text) => `- ${text.title}: localized from Sunnybrook Moodle handout(s): ${text.materials.map((item) => item.path).join("; ")}`),
    "",
  ].join("\n");
  mkdirSync(join(courseRoot, "texts"), { recursive: true });
  writeFileSync(join(courseRoot, "texts", "README.md"), readme, "utf8");
  writeFileSync(join(courseRoot, "texts", "SOURCES.md"), sources, "utf8");
}

const manifest = readJson(manifestPath);
const resources = collectLessonResources(manifest);
const texts = [];

for (const definition of UNIT1_TEXTS) {
  const materials = findMaterials(resources, definition);
  texts.push({
    id: definition.id,
    title: definition.title,
    author: definition.author,
    type: "myth",
    units: [1],
    lessons: definition.lessons,
    copyrightStatus: "school_licensed",
    sourceStatus: materials.length ? "downloadable" : "unavailable",
    notes: materials.length
      ? "Localized from Moodle Unit 1 reading handout(s)."
      : "Expected Moodle handout was not found in localized course resources.",
    materials,
  });
}

const romeoMaterial = await ensureRomeoText();
texts.push({
  id: ROMEO_SOURCE.id,
  title: ROMEO_SOURCE.title,
  author: ROMEO_SOURCE.author,
  type: ROMEO_SOURCE.type,
  units: ROMEO_SOURCE.units,
  lessons: ROMEO_SOURCE.lessons,
  copyrightStatus: ROMEO_SOURCE.copyrightStatus,
  sourceStatus: ROMEO_SOURCE.sourceStatus,
  notes: ROMEO_SOURCE.notes,
  materials: [romeoMaterial],
  externalLinks: [
    {
      label: ROMEO_SOURCE.sourceLabel,
      type: "url",
      category: "public_domain_source",
      role: "source",
      url: ROMEO_SOURCE.sourceUrl,
      source: ROMEO_SOURCE.rights,
    },
  ],
});

manifest.texts = manifest.texts || [];
for (const record of texts) upsertText(manifest.texts, record);
manifest.texts.sort((a, b) => `${a.units?.[0] || 99}|${a.title}`.localeCompare(`${b.units?.[0] || 99}|${b.title}`));
setCoreTexts(manifest);
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
writeTextDocs(texts);

console.log(
  JSON.stringify(
    {
      course,
      texts: texts.length,
      downloadable: texts.filter((text) => text.materials.length).length,
      materials: texts.reduce((sum, text) => sum + text.materials.length, 0),
      romeoPath: romeoMaterial.path,
    },
    null,
    2,
  ),
);
