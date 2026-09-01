import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MPM2D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const textbookSourcePath = join(workspaceRoot, "docs", "未确认 406415.crdownload");
const textbookPath = "texts/nelson-principles-of-mathematics-10/Nelson-Principles-of-Mathematics-10.pdf";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertPdf(path) {
  const bytes = readFileSync(path, { start: 0, end: 4 });
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error(`Expected a PDF file: ${path}`);
  }
}

if (!existsSync(textbookSourcePath)) {
  throw new Error(`Expected user-provided legal textbook file not found: ${textbookSourcePath}`);
}

assertPdf(textbookSourcePath);

const targetAbsPath = join(courseRoot, textbookPath);
mkdirSync(dirname(targetAbsPath), { recursive: true });
copyFileSync(textbookSourcePath, targetAbsPath);
const textbookBytes = statSync(targetAbsPath).size;

const manifest = readJson(manifestPath);
manifest.texts = [
  {
    id: "nelson-principles-of-mathematics-10",
    title: "Nelson Principles of Mathematics 10",
    publisher: "Nelson Education",
    type: "textbook",
    units: [1, 2, 3, 4],
    copyrightStatus: "licensed_local_copy",
    sourceStatus: "provided_by_user",
    notes:
      "Legally obtained local textbook copy provided by the user; verified against the PDF title/copyright pages and MPM2D course topics.",
    materials: [
      {
        label: "Nelson Principles of Mathematics 10",
        type: "pdf",
        category: "textbook",
        role: "core_text",
        path: textbookPath,
        bytes: textbookBytes,
        source: "local legally obtained file: docs/未确认 406415.crdownload",
        previewPath: "",
      },
    ],
  },
];
manifest.sourceAudit ||= {};
manifest.sourceAudit.textbookAudit = {
  status: "identified_and_included",
  title: "Nelson Principles of Mathematics 10",
  publisher: "Nelson Education",
  sourceFile: "docs/未确认 406415.crdownload",
  coursePath: textbookPath,
  bytes: textbookBytes,
  evidence:
    "PDF title/copyright pages identify Nelson Principles of Mathematics 10; table of contents covers linear systems, analytic geometry, quadratic relations, factoring, quadratic equations, and trigonometry, matching MPM2D.",
  decision: "Included as a user-provided legal local textbook copy for MPM2D.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course, textbookPath, textbookBytes }, null, 2));
