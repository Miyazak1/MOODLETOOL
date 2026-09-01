import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "BBI2O");
const sourcePath = path.join(
  workspaceRoot,
  "docs",
  "pdfcoffee.com_the-world-of-business-fifth-edition-by-jack-wilson-david-notman-lorie-guest-and-terry-g-murphy-pdf-free.pdf",
);
const textbookRel = "texts/textbook/the-world-of-business-5th-edition.pdf";
const textbookPath = path.join(courseRoot, ...textbookRel.split("/"));
const manifestPath = path.join(courseRoot, "course-manifest.json");
const sourcesPath = path.join(courseRoot, "texts", "SOURCES.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function upsertByPath(items, item) {
  const index = items.findIndex((entry) => entry.path === item.path);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Source textbook not found: ${sourcePath}`);
}

fs.mkdirSync(path.dirname(textbookPath), { recursive: true });
fs.copyFileSync(sourcePath, textbookPath);
const bytes = fs.statSync(textbookPath).size;

const manifest = readJson(manifestPath);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = manifest.sourceAudit || {};
manifest.sourceAudit.textbookStatus =
  "User supplied a legally obtained local copy of the supporting textbook. The full textbook PDF is localized at texts/textbook/the-world-of-business-5th-edition.pdf.";
manifest.sourceAudit.bbi2oUserSuppliedTextbook = {
  addedAt: new Date().toISOString(),
  title: "The World of Business",
  edition: "5th Edition",
  authors: ["Jack Wilson", "David Notman", "Lorie Guest", "Terry G. Murphy"],
  publisher: "Nelson Education / Nelson Thomson Learning",
  isbn13: "9780176337513",
  isbn10: "0176337512",
  path: textbookRel,
  bytes,
  source: "User-supplied legally obtained copy from local docs folder",
};

manifest.sourceAudit.bbi2oTextbookIdentification = {
  ...(manifest.sourceAudit.bbi2oTextbookIdentification || {}),
  title: "The World of Business",
  edition: "5th Edition",
  authors: ["Jack Wilson", "David Notman", "Lorie Guest", "Terry G. Murphy"],
  publisher: "Nelson Education / Nelson Thomson Learning",
  isbn13: "9780176337513",
  isbn10: "0176337512",
  status: "localized_full_text_user_supplied_legal_copy",
  localizedPath: textbookRel,
  evidence: [
    ...new Set([
      ...((manifest.sourceAudit.bbi2oTextbookIdentification || {}).evidence || []),
      "User supplied a legally obtained local copy of The World of Business, 5th Edition for BBI2O.",
    ]),
  ],
};

const textbookDownload = {
  label: "BBI2O · Grade 10 Introduction to Business · The World of Business, 5th Edition",
  type: "pdf",
  category: "textbook",
  role: "core_textbook",
  path: textbookRel,
  previewPath: textbookRel,
  downloadPath: textbookRel,
  bytes,
  source: "User-supplied legally obtained copy from local docs folder",
  copyrightStatus: "licensed_user_supplied",
  textPreview:
    "Supporting textbook for BBI2O Introduction to Business: The World of Business, 5th Edition, Nelson Education.",
};

manifest.courseDownloads = Array.isArray(manifest.courseDownloads) ? manifest.courseDownloads : [];
upsertByPath(manifest.courseDownloads, textbookDownload);

manifest.texts = Array.isArray(manifest.texts) ? manifest.texts : [];
const textbookText = {
  id: "the-world-of-business-5th-edition",
  title: "BBI2O · Grade 10 Introduction to Business · The World of Business, 5th Edition",
  originalLabel: "The World of Business, 5th Edition",
  label: "BBI2O · Grade 10 Introduction to Business · The World of Business, 5th Edition",
  authors: ["Jack Wilson", "David Notman", "Lorie Guest", "Terry G. Murphy"],
  publisher: "Nelson Education / Nelson Thomson Learning",
  edition: "5th Edition",
  isbn: "9780176337513 / 0176337512",
  type: "textbook",
  courseCodes: ["BBI1O", "BBI2O"],
  units: [1, 2, 3, 4],
  path: textbookRel,
  bytes,
  source: "User-supplied legally obtained copy from local docs folder",
  copyrightStatus: "licensed_user_supplied",
  sourceStatus: "localized_from_user_supplied_legal_copy",
  notes:
    "Supporting/reference textbook for BBI2O Introduction to Business. Access should follow the school's licensing and distribution rules.",
  materials: [textbookDownload],
};
const existingTextIndex = manifest.texts.findIndex((entry) => entry.id === textbookText.id || entry.path === textbookRel);
if (existingTextIndex >= 0) manifest.texts[existingTextIndex] = { ...manifest.texts[existingTextIndex], ...textbookText };
else manifest.texts.push(textbookText);

writeJson(manifestPath, manifest);

let sources = fs.readFileSync(sourcesPath, "utf8");
sources = sources.replace(
  /- Textbook identification:.*?The full commercial textbook PDF is not included locally; this identification is based on public BBI1O\/BBI2O reference-text listings and local worksheet chapter\/page references\./s,
  "- Textbook: `The World of Business`, 5th Edition, by Jack Wilson, David Notman, Lorie Guest, and Terry G. Murphy; Nelson Education / Nelson Thomson Learning; ISBN 9780176337513 / 0176337512. A legally obtained user-supplied copy is localized at `texts/textbook/the-world-of-business-5th-edition.pdf` for BBI2O teacher/course use.",
);
if (!sources.includes("texts/textbook/the-world-of-business-5th-edition.pdf")) {
  sources +=
    "\n- User-supplied textbook copy: `texts/textbook/the-world-of-business-5th-edition.pdf`. Access and redistribution should follow the school's licensing and distribution rules.\n";
}
fs.writeFileSync(sourcesPath, sources, "utf8");

console.log(
  JSON.stringify(
    {
      course: "BBI2O",
      copiedFrom: sourcePath,
      copiedTo: textbookPath,
      manifestPath,
      sourcesPath,
      bytes,
    },
    null,
    2,
  ),
);
