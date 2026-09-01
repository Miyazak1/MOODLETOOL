import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MCV4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const textsRoot = join(courseRoot, "texts");
const textbookRoot = join(textsRoot, "nelson-calculus-and-vectors-12");
const curriculumRoot = join(textsRoot, "ontario-curriculum");
const textbookSourcePath = join(workspaceRoot, "docs", "Nelson MCV4U Textbook.pdf");
const textbookPath = join(textbookRoot, "Nelson-MCV4U-Textbook.pdf");
const curriculumSourcePath = join(workspaceRoot, "courseware", "MHF4U", "texts", "ontario-curriculum", "math1112currb.pdf");
const curriculumPath = join(curriculumRoot, "math1112currb.pdf");
const curriculumUrl = "https://www.edu.gov.on.ca/eng/curriculum/secondary/math1112currb.pdf";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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

function isPdf(path) {
  if (!existsSync(path)) return false;
  const buffer = readFileSync(path);
  return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

function copyCurriculumPdf() {
  if (!isPdf(curriculumSourcePath)) throw new Error(`Missing verified curriculum PDF source: ${curriculumSourcePath}`);
  mkdirSync(curriculumRoot, { recursive: true });
  copyFileSync(curriculumSourcePath, curriculumPath);
}

function copyTextbookPdf() {
  if (!isPdf(textbookSourcePath)) throw new Error(`Missing verified MCV4U textbook PDF source: ${textbookSourcePath}`);
  mkdirSync(textbookRoot, { recursive: true });
  copyFileSync(textbookSourcePath, textbookPath);
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

function extractTextbookReference(lesson) {
  const previewPath = lesson.lessonPlan?.previewPath;
  if (!previewPath) return null;
  const abs = join(courseRoot, ...previewPath.split("/"));
  if (!existsSync(abs)) return null;
  const text = stripHtml(readFileSync(abs, "utf8"));
  const match = /Homework pages in textbook to be completed:\s*(Nelson Textbook Page\s+\d+[\s\S]*?)(?:\s+Notes|\s+Appendix|\s*$)/i.exec(text);
  if (!match) return null;
  const rawReference = match[1].trim();
  const page = Number(/Page\s+(\d+)/i.exec(rawReference)?.[1] || 0);
  const exercise = /Exercise\s+([0-9.]+)/i.exec(rawReference)?.[1] || "";
  const questions = [...rawReference.matchAll(/Question\s+(\d+)/gi)].map((item) => Number(item[1]));
  return {
    lessonId: lesson.id,
    unit: lesson.unit,
    lesson: lesson.lesson,
    lessonTitle: lesson.title,
    textbook: "Nelson Textbook",
    inferredTextbookTitle: "Calculus and Vectors 12",
    page,
    exercise,
    questions,
    rawReference,
    sourceLessonPlan: lesson.lessonPlan.path,
    sourceLessonPlanPreview: lesson.lessonPlan.previewPath,
  };
}

function renderIndexMarkdown(references) {
  const rows = references.map(
    (item) =>
      `| ${item.lessonId} | ${item.lessonTitle.replaceAll("|", "\\|")} | ${item.page || "-"} | ${item.exercise || "-"} | ${
        item.questions.length ? item.questions.join(", ") : "-"
      } |`,
  );
  return `# MCV4U Textbook Reference Index

This index is derived from the title-matched local lesson plans already present in the course package.

The lesson plans reference a Nelson textbook. The user-provided legal PDF \`D:\\工作文件\\SUNNYBROOK\\docs\\Nelson MCV4U Textbook.pdf\` has been matched to these references and localized into the courseware package.

| Lesson | Lesson Title | Page | Exercise | Questions |
| --- | --- | ---: | --- | --- |
${rows.join("\n")}
`;
}

function renderSourcesMarkdown(references) {
  return `# MCV4U Text Sources

## Moodle And Local Course Materials

- The authenticated Moodle book crawl did not include a full textbook PDF or ebook file.
- The local lesson plans include ${references.length} Nelson textbook homework references.
- A legally obtained local PDF was provided at \`D:\\工作文件\\SUNNYBROOK\\docs\\Nelson MCV4U Textbook.pdf\` and localized into the courseware package.
- Moodle/localized materials already included in the course package remain the primary lesson resources: iSpring lessons, handouts, worksheets, Step-by-step guides, H5P activities, and videos.

## Textbook Reference

- Referenced name in lesson plans: Nelson Textbook.
- Identified course text: Calculus and Vectors 12, Nelson.
- Localized textbook file: \`texts/nelson-calculus-and-vectors-12/Nelson-MCV4U-Textbook.pdf\`
- The generated lesson reference JSON is kept only as source audit data and is not exposed as a textbook resource.

## Ontario Ministry Sources

- The Ontario Curriculum, Grades 11 and 12: Mathematics, 2007 (Revised), Ministry of Education.

## Public Files Localized

- Ontario curriculum PDF: \`texts/ontario-curriculum/math1112currb.pdf\`
- Nelson MCV4U textbook PDF: \`texts/nelson-calculus-and-vectors-12/Nelson-MCV4U-Textbook.pdf\`
`;
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
copyCurriculumPdf();
copyTextbookPdf();

const textbookJsonPath = join(textbookRoot, "textbook-reference-index.json");
const textbookMdPath = join(textbookRoot, "INDEX.md");
writeJson(textbookJsonPath, {
  generatedAt: new Date().toISOString(),
  course,
  source: "Local MCV4U lesson plan previews",
  textbook: {
    referencedName: "Nelson Textbook",
    inferredTitle: "Calculus and Vectors 12",
    contentIncluded: true,
    contentPath: "texts/nelson-calculus-and-vectors-12/Nelson-MCV4U-Textbook.pdf",
    contentSource: "local legally obtained file: docs/Nelson MCV4U Textbook.pdf",
  },
  references,
});
writeFileSync(textbookMdPath, renderIndexMarkdown(references), "utf8");
writeFileSync(join(textsRoot, "SOURCES.md"), renderSourcesMarkdown(references), "utf8");
writeFileSync(
  join(textsRoot, "INDEX.md"),
  `# MCV4U Texts And References

- Ontario curriculum PDF: \`ontario-curriculum/math1112currb.pdf\`
- Nelson MCV4U textbook PDF: \`nelson-calculus-and-vectors-12/Nelson-MCV4U-Textbook.pdf\`
- Nelson textbook reference index audit: \`nelson-calculus-and-vectors-12/INDEX.md\`
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
);
const textbookRecord = recordFile(
  "Nelson MCV4U Textbook",
  "pdf",
  "textbook",
  "core_text",
  "texts/nelson-calculus-and-vectors-12/Nelson-MCV4U-Textbook.pdf",
  "local legally obtained file: docs/Nelson MCV4U Textbook.pdf",
  { previewPath: "" },
);
const textbookIndexRecord = recordFile(
  "Nelson Calculus and Vectors 12 - Lesson Textbook Reference Index",
  "json",
  "textbook_reference_index",
  "textbook_reference",
  "texts/nelson-calculus-and-vectors-12/textbook-reference-index.json",
  "local MCV4U lesson plans",
);
const sourcesRecord = recordFile("MCV4U Text Sources", "md", "source_audit", "source_audit", "texts/SOURCES.md", "local source audit");

manifest.texts = [
  {
    id: "nelson-calculus-and-vectors-12",
    title: "Nelson Calculus and Vectors 12",
    publisher: "Nelson Education",
    type: "textbook",
    units: [1, 2, 3],
    copyrightStatus: "licensed_local_copy",
    sourceStatus: "provided_by_user",
    notes: "Legally obtained local textbook copy provided by the user; lesson plans reference matching Nelson textbook pages and questions.",
    materials: [textbookRecord],
  },
];

const courseDownloadKeys = new Set();
manifest.courseDownloads = [
  ...(manifest.courseDownloads || []),
  textbookRecord,
].filter(
  (item) =>
    item.role !== "textbook_reference" &&
    item.category !== "textbook_reference_index" &&
    item.role !== "curriculum_reference" &&
    item.role !== "source_audit",
)
  .filter((item) => {
  const key = item.path || item.url || item.label;
  if (courseDownloadKeys.has(key)) return false;
  courseDownloadKeys.add(key);
  return true;
});

for (const unit of manifest.units || []) {
  unit.coreTexts = [textbookRecord];
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  textMaterials: manifest.texts.length,
  textbookReferenceCount: references.length,
  textbookFullFileFound: true,
  textbookFullFilePath: "texts/nelson-calculus-and-vectors-12/Nelson-MCV4U-Textbook.pdf",
  textbookAudit: {
    status: "localized_from_user_provided_legal_file",
    identifiedTitle: "Calculus and Vectors 12",
    commonName: "Nelson Calculus and Vectors 12",
    publisher: "Nelson Education",
    evidence: "Local MCV4U lesson plan previews cite Nelson textbook pages/questions. The user provided a legal local PDF at docs/Nelson MCV4U Textbook.pdf, and spot checks matched cited textbook pages/exercises to this PDF.",
    searchedLocations: [
      "D:/工作文件/SUNNYBROOK/docs",
      "D:/工作文件/SUNNYBROOK/courseware",
    ],
    decision: "Include the provided PDF as the MCV4U core textbook. Keep the lesson reference JSON as internal audit data only.",
  },
  curriculumPdfIncluded: existsSync(curriculumPath),
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
console.log(
  JSON.stringify(
    {
      course,
      textbookReferences: references.length,
      curriculumPath: "texts/ontario-curriculum/math1112currb.pdf",
      textbookPath: "texts/nelson-calculus-and-vectors-12/Nelson-MCV4U-Textbook.pdf",
      textbookFullFileFound: true,
      texts: manifest.texts.map((item) => item.id),
    },
    null,
    2,
  ),
);
