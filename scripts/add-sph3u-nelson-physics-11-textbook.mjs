import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SPH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const sourcePath = join(workspaceRoot, "docs", "Nelson-Physics-11.pdf");
const textbookPath = "texts/nelson-physics-11/Nelson-Physics-11.pdf";
const textbookTitle = "SPH3U · Physics · Nelson Physics 11 Textbook";
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");

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

if (!existsSync(sourcePath)) throw new Error(`Missing user-provided legal textbook file: ${sourcePath}`);
assertPdf(sourcePath);

const targetPath = join(courseRoot, textbookPath);
mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);
const bytes = statSync(targetPath).size;

const manifest = readJson(manifestPath);
const existingTexts = Array.isArray(manifest.texts) ? manifest.texts : [];
const textsById = new Map(existingTexts.map((item) => [item.id, item]));

textsById.set("nelson-physics-11", {
  ...(textsById.get("nelson-physics-11") || {}),
  id: "nelson-physics-11",
  title: textbookTitle,
  label: textbookTitle,
  publisher: "Nelson Education",
  type: "textbook",
  units: [1, 2, 3, 4, 5],
  copyrightStatus: "licensed_local_copy",
  sourceStatus: "provided_by_user",
  notes:
    "Legally obtained local textbook copy provided by the user; matched to SPH3U planning references to Nelson Textbook pages and Grade 11 Physics content.",
  materials: [
    {
      label: textbookTitle,
      title: textbookTitle,
      type: "pdf",
      category: "textbook",
      role: "core_textbook",
      path: textbookPath,
      downloadPath: textbookPath,
      bytes,
      source: "local legally obtained file: docs/Nelson-Physics-11.pdf",
    },
  ],
  path: textbookPath,
  bytes,
  category: "textbook",
  role: "core_textbook",
});

const sourceAudit = textsById.get("sph3u-source-audit");
if (sourceAudit) {
  sourceAudit.notes = "Records the legal local textbook copy now included for SPH3U.";
  sourceAudit.sourceStatus = "updated_after_user_provided_textbook";
}

const orderedIds = ["nelson-physics-11", "ontario-science-curriculum-11-12", "sph3u-source-audit"];
manifest.texts = [
  ...orderedIds.map((id) => textsById.get(id)).filter(Boolean),
  ...[...textsById.values()].filter((item) => !orderedIds.includes(item.id)),
];

manifest.sourceAudit ||= {};
manifest.sourceAudit.textbookAudit = {
  status: "identified_and_included",
  title: "Nelson Physics 11",
  publisher: "Nelson Education",
  sourceFile: "docs/Nelson-Physics-11.pdf",
  coursePath: textbookPath,
  bytes,
  evidence:
    "The PDF is Nelson Physics 11 content. SPH3U unit and lesson plans cite Nelson Textbook pages including pages 8, 12, 13, 23, 126, 131, 133, 139, and 152; spot checks match the referenced practice questions and Grade 11 Physics topics.",
  decision: "Included as a user-provided legal local textbook copy for SPH3U.",
};
manifest.sourceAudit.textMaterialIndexPatchedAt = new Date().toISOString();
manifest.sourceAudit.textMaterialCount = manifest.texts.reduce((sum, item) => sum + (item.materials?.length || 0), 0);
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

writeFileSync(
  sourcesPath,
  `# SPH3U Text And Source Audit

This SPH3U package uses Moodle-localized lesson resources, locally stored planning files, the Moodle Course Outline, the public Ontario curriculum reference, and the user-provided legal textbook listed below.

## Included

- Nelson Physics 11, provided by the user as a legally obtained local PDF and matched against SPH3U Nelson Textbook page references.
- SPH3U Course Outline, downloaded from the authenticated SunnyBrook Moodle course shell.
- The Ontario Curriculum, Grades 11 and 12: Science, 2008 (Revised), downloaded from the Ontario Ministry of Education website.

## Textbook Status

Nelson Physics 11 is included as a local licensed textbook copy at \`${textbookPath}\`.
`,
  "utf8",
);

console.log(JSON.stringify({ course, textbookPath, bytes }, null, 2));
