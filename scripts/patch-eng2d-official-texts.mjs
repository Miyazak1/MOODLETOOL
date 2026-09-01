import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "ENG2D");
const manifestPath = path.join(courseRoot, "course-manifest.json");

const curriculum = {
  id: "ontario-english-curriculum-9-10",
  title: "ENG2D · Grade 10 English · The Ontario Curriculum, Grades 9 and 10: English, 2007 (Revised)",
  originalLabel: "The Ontario Curriculum, Grades 9 and 10: English, 2007 (Revised)",
  publisher: "Ontario Ministry of Education",
  type: "curriculum",
  units: [1, 2, 3, 4],
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  notes: "Official Ontario curriculum reference containing ENG2D English, Grade 10, Academic expectations.",
  source: "https://www.edu.gov.on.ca/eng/curriculum/secondary/english910currb.pdf",
  sourceFallbacks: [
    path.join(workspaceRoot, "courseware", "ENG1D", "texts", "ontario-curriculum", "english910currb.pdf"),
  ],
  path: "texts/ontario-curriculum/english910currb.pdf",
};

const macbeth = {
  id: "macbeth",
  title: "ENG2D · Grade 10 English · Macbeth",
  originalLabel: "Macbeth",
  author: "William Shakespeare",
  type: "play",
  units: [1],
  lessons: ["U01L01", "U01L02", "U01L03", "U01L04", "U01L05", "U01L06"],
  copyrightStatus: "public_domain",
  sourceStatus: "localized_from_public_domain_source",
  notes: "Core drama text confirmed from the ENG2D Unit 1 Macbeth lesson sequence.",
  sourcePage: "https://www.gutenberg.org/ebooks/1533",
  sourceUrl: "https://www.gutenberg.org/cache/epub/1533/pg1533.txt",
  sourceLabel: "Project Gutenberg eBook #1533",
  rights: "Public domain in the USA according to Project Gutenberg.",
  sourceFallbacks: [
    path.join(workspaceRoot, "courseware", "ENG3U", "texts", "macbeth", "Macbeth_Project_Gutenberg_1533.txt"),
  ],
  path: "texts/macbeth/Macbeth_Project_Gutenberg_1533.txt",
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function abs(relPath) {
  return path.join(courseRoot, ...toPosix(relPath).split("/"));
}

function copyFromFallback(targetRel, fallbacks) {
  const targetPath = abs(targetRel);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const fallback = fallbacks.find((candidate) => fs.existsSync(candidate));
  if (!fallback) {
    throw new Error(`Missing fallback for ${targetRel}. Checked: ${fallbacks.join(", ")}`);
  }
  fs.copyFileSync(fallback, targetPath);
  return { targetPath, fallback };
}

function statRel(relPath) {
  return fs.statSync(abs(relPath)).size;
}

function curriculumEntry(bytes) {
  const material = {
    label: curriculum.originalLabel,
    type: "pdf",
    category: "official_curriculum",
    role: "curriculum_reference",
    path: curriculum.path,
    previewPath: curriculum.path,
    downloadPath: curriculum.path,
    bytes,
    source: curriculum.source,
    textPreview:
      "Official Ontario Ministry of Education curriculum guidance for Grades 9 and 10 English, including ENG2D English, Grade 10, Academic expectations.",
  };
  return {
    id: curriculum.id,
    title: curriculum.title,
    publisher: curriculum.publisher,
    type: curriculum.type,
    units: curriculum.units,
    copyrightStatus: curriculum.copyrightStatus,
    sourceStatus: curriculum.sourceStatus,
    notes: curriculum.notes,
    materials: [material],
    path: curriculum.path,
    bytes,
    category: "official_curriculum",
    role: "curriculum_reference",
    previewPath: curriculum.path,
    downloadPath: curriculum.path,
    originalLabel: curriculum.originalLabel,
    label: curriculum.title,
  };
}

function macbethEntry(bytes) {
  return {
    id: macbeth.id,
    title: macbeth.title,
    author: macbeth.author,
    type: macbeth.type,
    units: macbeth.units,
    lessons: macbeth.lessons,
    copyrightStatus: macbeth.copyrightStatus,
    sourceStatus: macbeth.sourceStatus,
    notes: macbeth.notes,
    materials: [
      {
        label: path.posix.basename(macbeth.path),
        type: "txt",
        category: "text_material",
        role: "core_text",
        path: macbeth.path,
        bytes,
        source: macbeth.sourceUrl,
        downloadPath: macbeth.path,
      },
    ],
    publicDomainSource: {
      label: macbeth.sourceLabel,
      url: macbeth.sourcePage,
      rights: macbeth.rights,
    },
    originalLabel: macbeth.originalLabel,
    label: macbeth.title,
  };
}

function courseDownloadForText(text) {
  if (text.id === curriculum.id) {
    return {
      label: curriculum.title,
      type: "pdf",
      category: "official_curriculum",
      role: "curriculum_reference",
      path: curriculum.path,
      bytes: text.bytes,
      source: curriculum.source,
      downloadPath: curriculum.path,
      previewPath: curriculum.path,
      teacherUse: "curriculum_reference",
    };
  }
  return {
    label: macbeth.title,
    type: "txt",
    category: "text_material",
    role: "core_text",
    path: macbeth.path,
    bytes: text.materials[0].bytes,
    source: macbeth.sourcePage,
    downloadPath: macbeth.path,
    teacherUse: "core_text_reference",
  };
}

function sourceNotes(curriculumBytes, macbethBytes) {
  return `# ENG2D Text Sources

## Official Curriculum Guidance

- Title: ${curriculum.originalLabel}
- Course covered: ENG2D English, Grade 10, Academic
- Publisher: ${curriculum.publisher}
- Local file: \`${curriculum.path}\`
- Bytes: ${curriculumBytes}
- Source: ${curriculum.source}
- Status: official public Ontario curriculum document.

## Core Literary Text

- Title: Macbeth
- Author: William Shakespeare
- Local file: \`${macbeth.path}\`
- Bytes: ${macbethBytes}
- Source page: ${macbeth.sourcePage}
- Plain text source: ${macbeth.sourceUrl}
- Status: ${macbeth.rights}

## Course Mapping

- Unit 1 core text: Macbeth
- Units 1-4 curriculum reference: ${curriculum.originalLabel}
`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function patchManifest(curriculumText, macbethText, sourcesBytes) {
  const manifest = readJson(manifestPath);
  const replacementIds = new Set([curriculum.id, macbeth.id]);
  manifest.texts = [
    ...(manifest.texts || []).filter((text) => !replacementIds.has(text.id)),
    curriculumText,
    macbethText,
  ];

  manifest.courseDownloads = [
    ...(manifest.courseDownloads || []).filter(
      (item) => ![curriculum.path, macbeth.path, "texts/SOURCES.md"].includes(toPosix(item.path)),
    ),
    courseDownloadForText(curriculumText),
    courseDownloadForText(macbethText),
    {
      label: "ENG2D Text Sources and Curriculum Notes",
      type: "md",
      category: "source_notes",
      role: "source_notes",
      path: "texts/SOURCES.md",
      bytes: sourcesBytes,
      source: "local source audit",
      teacherUse: "source_audit",
    },
  ];

  for (const unit of manifest.units || []) {
    if (unit.unit === 1) {
      unit.coreTexts = unique([...(unit.coreTexts || []), macbeth.id]);
    } else {
      unit.coreTexts = unit.coreTexts || [];
    }
  }

  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    officialCurriculumAndTextPatch: {
      patchedAt: new Date().toISOString(),
      officialCurriculum: curriculum.path,
      officialCurriculumSource: curriculum.source,
      coreText: macbeth.path,
      coreTextSource: macbeth.sourcePage,
      courseTextbookName: "Macbeth by William Shakespeare",
      curriculumDocumentName: curriculum.originalLabel,
    },
  };
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
  return manifest;
}

function main() {
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
  const curriculumCopy = copyFromFallback(curriculum.path, curriculum.sourceFallbacks);
  const macbethCopy = copyFromFallback(macbeth.path, macbeth.sourceFallbacks);
  const curriculumBytes = statRel(curriculum.path);
  const macbethBytes = statRel(macbeth.path);

  const sourcesRel = "texts/SOURCES.md";
  fs.mkdirSync(path.dirname(abs(sourcesRel)), { recursive: true });
  fs.writeFileSync(abs(sourcesRel), sourceNotes(curriculumBytes, macbethBytes), "utf8");
  const sourcesBytes = statRel(sourcesRel);

  const manifest = patchManifest(curriculumEntry(curriculumBytes), macbethEntry(macbethBytes), sourcesBytes);
  const report = {
    course: "ENG2D",
    curriculumPath: curriculum.path,
    curriculumBytes,
    curriculumCopiedFrom: curriculumCopy.fallback,
    macbethPath: macbeth.path,
    macbethBytes,
    macbethCopiedFrom: macbethCopy.fallback,
    sourcesPath: sourcesRel,
    sourcesBytes,
    manifestTexts: (manifest.texts || []).map((text) => text.id),
    unitCoreTexts: (manifest.units || []).map((unit) => ({ unit: unit.unit, coreTexts: unit.coreTexts || [] })),
  };
  const reportPath = path.join(repoRoot, "deployment", "ENG2D-official-texts-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  writeJson(reportPath, report);
  console.log(JSON.stringify(report, null, 2));
}

main();
