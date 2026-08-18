import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "MCR3U");
const docsRoot = join(workspaceRoot, "docs");

const sourcePdf = join(docsRoot, "Nelson Functions 11 Textbook(1)(1).pdf");
const textbookRel = "texts/nelson-functions-11/Nelson Functions 11 Textbook.pdf";
const textbookAbs = join(courseRoot, textbookRel);
const manifestPath = join(courseRoot, "course-manifest.json");
const referenceIndexPath = join(courseRoot, "texts", "functions-11-reference-index", "textbook-reference-index.json");
const referenceIndexReadmePath = join(courseRoot, "texts", "functions-11-reference-index", "INDEX.md");
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");

if (!existsSync(sourcePdf)) throw new Error(`Missing source PDF: ${sourcePdf}`);
if (!existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
if (!existsSync(referenceIndexPath)) throw new Error(`Missing reference index: ${referenceIndexPath}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalize(value) {
  return String(value || "").replaceAll("\\", "/");
}

mkdirSync(dirname(textbookAbs), { recursive: true });
copyFileSync(sourcePdf, textbookAbs);
const textbookBytes = statSync(textbookAbs).size;
const sourceStat = statSync(sourcePdf);
const verifiedAt = new Date().toISOString();

const textbookMaterial = {
  label: "Nelson Functions 11 Textbook",
  type: "pdf",
  category: "textbook",
  role: "primary_textbook",
  path: textbookRel,
  bytes: textbookBytes,
  source: "user-provided legal local file: docs/Nelson Functions 11 Textbook(1)(1).pdf",
  publisher: "Nelson, a division of Thomson Canada Limited",
  isbn13: "978-0-17-633203-7",
  isbn10: "0-17-633203-0",
};

const manifest = readJson(manifestPath);
manifest.generatedAt = verifiedAt;

manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => {
  const key = `${item.label || ""} ${item.path || ""}`.toLowerCase();
  return !key.includes("nelson functions 11 textbook") && normalize(item.path) !== textbookRel;
});
manifest.courseDownloads.splice(1, 0, { ...textbookMaterial });

const existingTexts = (manifest.texts || []).filter((item) => item.id !== "nelson-functions-11-textbook");
const referenceEntry = existingTexts.find((item) => item.id === "functions-11-reference-index");
if (referenceEntry) {
  referenceEntry.sourceStatus = "textbook_file_provided";
  referenceEntry.notes = "Lesson plans cite Nelson Functions 11 textbook pages and questions. The matching legal textbook file is now included as a course resource.";
  referenceEntry.textbookPath = textbookRel;
  referenceEntry.textbookTitle = "Nelson Functions 11 Textbook";
  referenceEntry.textbookIsbn13 = "978-0-17-633203-7";
}

const textbookEntry = {
  id: "nelson-functions-11-textbook",
  title: "Nelson Functions 11 Textbook",
  publisher: "Nelson, a division of Thomson Canada Limited",
  authors: [
    "Marian Small",
    "Chris Kirkpatrick",
    "Barbara Alldred",
    "Andrew Dmytriw",
    "Shawn Godin",
    "Angelo Lillo",
    "David Pilmer",
    "Susanne Trew",
    "Noel Walker",
  ],
  isbn13: "978-0-17-633203-7",
  isbn10: "0-17-633203-0",
  type: "textbook",
  units: [1, 2, 3, 4],
  copyrightStatus: "user_provided_legal_copy",
  sourceStatus: "localized_from_user_provided_legal_file",
  notes: "Verified against the PDF title page, copyright page, ISBN, and MCR3U lesson-plan page references.",
  materials: [{ ...textbookMaterial }],
  path: textbookRel,
  bytes: textbookBytes,
  category: "textbook",
  role: "primary_textbook",
};

manifest.texts = [textbookEntry, ...existingTexts];

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  textMaterials: manifest.texts.length,
  textbookFullFileFound: true,
  textbookAudit: {
    status: "full_textbook_added",
    referencedTextbook: "Functions 11 Textbook",
    verifiedTextbook: "Nelson Functions 11 Textbook",
    isbn13: "978-0-17-633203-7",
    isbn10: "0-17-633203-0",
    evidence: "The user-provided legal PDF title page, copyright page, ISBN, authors, and lesson-plan page references match the MCR3U Functions 11 textbook.",
    sourceFile: normalize(sourcePdf),
    localPath: textbookRel,
    sourceBytes: sourceStat.size,
    localBytes: textbookBytes,
    verifiedAt,
    decision: "Include the verified Nelson Functions 11 textbook as the MCR3U primary textbook.",
  },
};

writeJson(manifestPath, manifest);

const referenceIndex = readJson(referenceIndexPath);
referenceIndex.generatedAt = verifiedAt;
referenceIndex.textbook = {
  ...(referenceIndex.textbook || {}),
  referencedName: "Functions 11 Textbook",
  inferredTitle: "Nelson Functions 11 Textbook",
  verifiedTitle: "Nelson Functions 11 Textbook",
  isbn13: "978-0-17-633203-7",
  isbn10: "0-17-633203-0",
  contentIncluded: true,
  contentPath: textbookRel,
  contentSource: "user-provided legal local file: docs/Nelson Functions 11 Textbook(1)(1).pdf",
};
writeJson(referenceIndexPath, referenceIndex);

writeFileSync(referenceIndexReadmePath, `# Functions 11 Reference Index

MCR3U lesson plans cite Nelson Functions 11 Textbook pages and questions. The verified textbook file is included at:

\`${textbookRel}\`

References indexed: ${referenceIndex.references?.length || 0}
`, "utf8");

writeFileSync(sourcesPath, `# MCR3U Text And Source Audit

This MCR3U package uses Moodle-localized lesson resources, locally stored planning files, the Moodle Course Outline, the verified Nelson Functions 11 textbook provided by the user, and the public Ontario curriculum reference listed below.

## Included

- MCR3U Course Outline, downloaded from the authenticated SunnyBrook Moodle course shell.
- Nelson Functions 11 Textbook, copied from the user-provided legal local file \`D:\\工作文件\\SUNNYBROOK\\docs\\Nelson Functions 11 Textbook(1)(1).pdf\`.
- The Ontario Curriculum, Grades 11 and 12: Mathematics, 2007 (Revised), copied from the verified local MCV4U curriculum reference that originated from the Ontario Ministry of Education website.
- A Functions 11 textbook reference index generated from local MCR3U lesson plan previews.

## Textbook Status

The local file was verified as the required MCR3U textbook by matching the title page, copyright page, ISBN-13 \`978-0-17-633203-7\`, ISBN-10 \`0-17-633203-0\`, authors, and the lesson-plan textbook page references. \`Nelson-Advanced-Functions-12-Textbook.pdf\` remains excluded because it is a Grade 12 Advanced Functions text, not the MCR3U Functions 11 textbook cited by this course.

## Known Moodle Source Shape

Moodle provided iSpring embeds for 26 of 27 lessons. Unit 1 Lesson 3 did not expose an iSpring iframe in the Moodle book source, so it is recorded as a Moodle source gap rather than replaced with generated content.
`, "utf8");

console.log(JSON.stringify({
  course: "MCR3U",
  copied: textbookRel,
  bytes: textbookBytes,
  courseDownloads: manifest.courseDownloads.length,
  textMaterials: manifest.texts.length,
  textbookFullFileFound: manifest.sourceAudit.textbookFullFileFound,
}, null, 2));
