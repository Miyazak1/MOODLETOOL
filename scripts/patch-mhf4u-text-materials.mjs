import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MHF4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const textsRoot = join(courseRoot, "texts");
const textbookRoot = join(textsRoot, "nelson-advanced-functions-12");
const localTextbookSourcePath = join(workspaceRoot, "docs", "Nelson-Advanced-Functions-12-Textbook.pdf");
const localTextbookPath = join(textbookRoot, "Nelson-Advanced-Functions-12-Textbook.pdf");
const curriculumRoot = join(textsRoot, "ontario-curriculum");
const curriculumUrl = "https://www.edu.gov.on.ca/eng/curriculum/secondary/math1112currb.pdf";
const curriculumPath = join(curriculumRoot, "math1112currb.pdf");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function lessonPlanPreviewPath(lesson) {
  const previewPath = lesson.lessonPlan?.previewPath;
  if (!previewPath) return "";
  return join(courseRoot, ...previewPath.split("/"));
}

function extractTextbookReference(lesson) {
  const previewPath = lessonPlanPreviewPath(lesson);
  if (!previewPath || !existsSync(previewPath)) return null;
  const text = stripHtml(readFileSync(previewPath, "utf8"));
  const match = /Homework pages in textbook to be completed:\s*(Nelson Textbook Page\s+\d+[^.]*?)(?:\s+Notes|\s+Appendix|\s*$)/i.exec(text);
  if (!match) return null;
  const rawReference = match[1].trim();
  const page = Number(/Page\s+(\d+)/i.exec(rawReference)?.[1] || 0);
  const exerciseSet = /(Check Your Understanding|Further Your Understanding)/i.exec(rawReference)?.[1] || "";
  const questions = [...rawReference.matchAll(/Question\s+(\d+)/gi)].map((item) => Number(item[1]));
  return {
    lessonId: lesson.id,
    unit: lesson.unit,
    lesson: lesson.lesson,
    lessonTitle: lesson.title,
    textbook: "Nelson Textbook",
    inferredTextbookTitle: "Advanced Functions 12",
    page,
    exerciseSet,
    questions,
    rawReference,
    sourceLessonPlan: lesson.lessonPlan.path,
    sourceLessonPlanPreview: lesson.lessonPlan.previewPath,
  };
}

function renderIndexMarkdown(references) {
  const rows = references.map((item) =>
    `| ${item.lessonId} | ${item.lessonTitle.replaceAll("|", "\\|")} | ${item.page || "-"} | ${item.exerciseSet || "-"} | ${
      item.questions.length ? item.questions.join(", ") : "-"
    } |`,
  );
  return `# MHF4U Textbook Reference Index

This index is derived from the local Moodle-aligned lesson plans already present in the course package.

It records where each lesson plan points students in the Nelson Advanced Functions 12 textbook.

| Lesson | Lesson Title | Page | Exercise Set | Questions |
| --- | --- | ---: | --- | --- |
${rows.join("\n")}
`;
}

function renderSourcesMarkdown(references) {
  return `# MHF4U Text Sources

## Moodle And Local Course Materials

- The Moodle book crawl did not include a full textbook PDF or ebook file.
- A legally obtained local copy of the Nelson Advanced Functions 12 textbook was provided in \`D:\\工作文件\\SUNNYBROOK\\docs\` and copied into this course package.
- The local lesson plans include ${references.length} Nelson textbook homework references.
- Moodle/localized materials already included in the course package remain the primary lesson resources: iSpring lessons, handouts, worksheets, Step-by-step guides, H5P activities, and videos.

## Textbook

- File: \`texts/nelson-advanced-functions-12/Nelson-Advanced-Functions-12-Textbook.pdf\`
- Title: Nelson Advanced Functions 12.
- Evidence: lesson plans reference Nelson textbook pages, and sampled PDF pages match those page/exercise references.

## Ontario Ministry Sources

- The Ontario Curriculum, Grades 11 and 12: Mathematics, 2007 (Revised), Ministry of Education.
- Trillium List: Ontario-approved textbook list. The Ministry approves textbooks for use, while school boards/schools select resources from the list according to their process.

## Public Files Localized

- Ontario curriculum PDF: \`texts/ontario-curriculum/math1112currb.pdf\`
`;
}

function isPdf(path) {
  if (!existsSync(path)) return false;
  const buffer = readFileSync(path);
  return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

async function downloadCurriculumPdf() {
  if (existsSync(curriculumPath) && statSync(curriculumPath).size > 0) return false;
  mkdirSync(curriculumRoot, { recursive: true });
  const response = await fetch(curriculumUrl, { headers: { "user-agent": "ossd-course-portal-text-audit/1.0" } });
  if (!response.ok) throw new Error(`Curriculum PDF download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!(buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46)) {
    throw new Error("Downloaded curriculum file is not a PDF.");
  }
  writeFileSync(curriculumPath, buffer);
  return true;
}

function copyLocalTextbook() {
  if (!existsSync(localTextbookSourcePath)) return false;
  if (!isPdf(localTextbookSourcePath)) throw new Error(`Local textbook is not a PDF: ${localTextbookSourcePath}`);
  mkdirSync(textbookRoot, { recursive: true });
  copyFileSync(localTextbookSourcePath, localTextbookPath);
  return true;
}

function recordFile(label, type, category, role, path, source, extra = {}) {
  const abs = join(courseRoot, ...path.split("/"));
  return {
    label,
    type,
    category,
    role,
    path,
    bytes: existsSync(abs) ? statSync(abs).size : 0,
    source,
    ...extra,
  };
}

const manifest = readJson(manifestPath);
const references = [];
for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    const reference = extractTextbookReference(lesson);
    if (reference) references.push(reference);
  }
}

mkdirSync(textbookRoot, { recursive: true });
mkdirSync(textsRoot, { recursive: true });
const downloadedCurriculum = await downloadCurriculumPdf();
const copiedTextbook = copyLocalTextbook();

const textbookJsonPath = join(textbookRoot, "textbook-reference-index.json");
const textbookMdPath = join(textbookRoot, "INDEX.md");
writeJson(textbookJsonPath, {
  generatedAt: new Date().toISOString(),
  course,
  source: "Local MHF4U lesson plan previews",
  textbook: {
    referencedName: "Nelson Textbook",
    title: "Nelson Advanced Functions 12",
    contentIncluded: existsSync(localTextbookPath),
    contentPath: existsSync(localTextbookPath) ? "texts/nelson-advanced-functions-12/Nelson-Advanced-Functions-12-Textbook.pdf" : "",
    contentSource: existsSync(localTextbookPath) ? "legally obtained local file provided in workspace docs" : "",
  },
  references,
});
writeFileSync(textbookMdPath, renderIndexMarkdown(references), "utf8");
writeFileSync(join(textsRoot, "SOURCES.md"), renderSourcesMarkdown(references), "utf8");
writeFileSync(
  join(textsRoot, "INDEX.md"),
  `# MHF4U Texts And References

- Ontario curriculum PDF: \`ontario-curriculum/math1112currb.pdf\`
- Nelson textbook reference index: \`nelson-advanced-functions-12/INDEX.md\`
- Source audit: \`SOURCES.md\`
`,
  "utf8",
);

const curriculumRecord = recordFile(
  "Ontario Curriculum, Grades 11 and 12: Mathematics, 2007 (Revised)",
  "pdf",
  "official_curriculum",
  "curriculum_reference",
  "texts/ontario-curriculum/math1112currb.pdf",
  curriculumUrl,
  { previewPath: "" },
);
const textbookIndexRecord = recordFile(
  "Nelson Advanced Functions 12 - Lesson Textbook Reference Index",
  "json",
  "textbook_reference_index",
  "textbook_reference",
  "texts/nelson-advanced-functions-12/textbook-reference-index.json",
  "local MHF4U lesson plans",
);
const textbookRecord = recordFile(
  "Nelson Advanced Functions 12 Textbook",
  "pdf",
  "textbook",
  "core_text",
  "texts/nelson-advanced-functions-12/Nelson-Advanced-Functions-12-Textbook.pdf",
  "local legally obtained file: docs/Nelson-Advanced-Functions-12-Textbook.pdf",
  { previewPath: "" },
);

const sourcesRecord = recordFile(
  "MHF4U Text Sources",
  "md",
  "source_audit",
  "source_audit",
  "texts/SOURCES.md",
  "local source audit",
);

manifest.texts = [
  {
    id: "nelson-advanced-functions-12",
    title: "Nelson Advanced Functions 12",
    publisher: "Nelson Education",
    type: "textbook",
    units: [1, 2, 3, 4],
    copyrightStatus: "licensed_local_copy",
    sourceStatus: "provided_by_user",
    notes: "Legally obtained local textbook copy provided by the user; lesson plans reference Nelson textbook pages and questions.",
    materials: [textbookRecord, textbookIndexRecord],
  },
  {
    id: "ontario-mathematics-curriculum-11-12",
    title: "The Ontario Curriculum, Grades 11 and 12: Mathematics, 2007 (Revised)",
    publisher: "Ontario Ministry of Education",
    type: "curriculum",
    units: [1, 2, 3, 4],
    copyrightStatus: "official_public_document",
    sourceStatus: "downloadable",
    notes: "Official Ontario curriculum reference for Grades 11 and 12 Mathematics.",
    materials: [curriculumRecord],
  },
];
manifest.courseDownloads = [
  ...(manifest.courseDownloads || []).filter((item) => !String(item.path || "").startsWith("texts/")),
  textbookRecord,
  curriculumRecord,
  textbookIndexRecord,
  sourcesRecord,
];
for (const unit of manifest.units || []) {
  unit.coreTexts = [
    textbookRecord,
    curriculumRecord,
    {
      ...textbookIndexRecord,
      references: references.filter((item) => Number(item.unit) === Number(unit.unit)).length,
    },
  ];
}
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  textbookReferenceCount: references.length,
  textbookReferenceSource: "local lesson plan previews",
  textbookFullFileFound: existsSync(localTextbookPath),
  textbookFullFilePath: existsSync(localTextbookPath) ? "texts/nelson-advanced-functions-12/Nelson-Advanced-Functions-12-Textbook.pdf" : "",
  textbookFullFileSource: existsSync(localTextbookPath) ? "local legally obtained file provided by user" : "",
  officialCurriculumLocalized: true,
  officialCurriculumUrl: curriculumUrl,
  textMaterialsPatchedAt: new Date().toISOString(),
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(
  JSON.stringify(
    {
      course,
      textbookReferences: references.length,
      downloadedCurriculum,
      copiedTextbook,
      files: [
        existsSync(localTextbookPath) ? toPosix(relative(courseRoot, localTextbookPath)) : "",
        toPosix(relative(courseRoot, curriculumPath)),
        toPosix(relative(courseRoot, textbookJsonPath)),
        toPosix(relative(courseRoot, textbookMdPath)),
        "texts/INDEX.md",
        "texts/SOURCES.md",
      ],
    },
    null,
    2,
  ),
);
