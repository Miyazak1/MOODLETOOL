import fs from "node:fs";
import path from "node:path";

const workspaceRoot = "D:/工作文件/SUNNYBROOK";
const courseRoot = path.join(workspaceRoot, "courseware", "ENG4U");
const manifestPath = path.join(courseRoot, "course-manifest.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function existsBytes(relativePath) {
  const absolutePath = path.join(courseRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return 0;
  return fs.statSync(absolutePath).size;
}

function fileType(filePath) {
  return path.extname(filePath).replace(/^\./, "").toLowerCase() || "file";
}

function previewPath(relativePath) {
  const candidate = path.join(courseRoot, "previews-html", `${relativePath}.html`);
  return fs.existsSync(candidate) ? `previews-html/${relativePath}.html` : undefined;
}

function resource({ label, path: resourcePath, role, source }) {
  const item = {
    label,
    type: fileType(resourcePath),
    category: "localized_moodle_resource",
    role,
    path: resourcePath,
    bytes: existsBytes(resourcePath),
  };
  if (source) item.source = source;
  const preview = previewPath(resourcePath);
  if (preview) item.previewPath = preview;
  return item;
}

const manifest = readJson(manifestPath);

const unitTitles = new Map([
  [1, "Essay Writing"],
  [2, "Hamlet"],
  [3, "Media Studies"],
  [4, "The Great Gatsby"],
]);

const reflectionAndLogs = new Map([
  [
    1,
    [
      resource({
        label: "ENG4U Unit 1 KWL",
        path: "localized-moodle/document/5cb5366263-ENG4U-Unit1-KWL.docx",
        role: "kwl",
        source: "https://www.esunnybrook.com/pluginfile.php/7737/mod_book/chapter/607/ENG4U-Unit1-KWL.docx",
      }),
      resource({
        label: "Unit 1 End-of-Unit Reflection",
        path: "localized-moodle/document/7d2d37c426-Unit1-End-of-Unit-Reflection.docx",
        role: "unit_reflection",
        source: "https://www.esunnybrook.com/pluginfile.php/7737/mod_book/chapter/642/Unit1-End-of-Unit-Reflection.docx",
      }),
    ],
  ],
  [
    2,
    [
      resource({
        label: "ENG4U Unit 2 KWL",
        path: "localized-moodle/document/38147bc169-ENG4U-Unit2-KWL.docx",
        role: "kwl",
        source: "https://www.esunnybrook.com/pluginfile.php/7762/mod_book/chapter/648/ENG4U-Unit2-KWL.docx",
      }),
      resource({
        label: "Unit 2 End-of-Unit Reflection",
        path: "localized-moodle/document/e8820fcd64-Unit2-End-of-Unit-Reflection.docx",
        role: "unit_reflection",
        source: "https://www.esunnybrook.com/pluginfile.php/7762/mod_book/chapter/673/Unit2-End-of-Unit-Reflection.docx",
      }),
    ],
  ],
  [
    3,
    [
      resource({
        label: "ENG4U Unit 3 KWL",
        path: "localized-moodle/document/9b64e4e67b-ENG4U-Unit3-KWL.docx",
        role: "kwl",
        source: "https://www.esunnybrook.com/pluginfile.php/7784/mod_book/chapter/678/ENG4U-Unit3-KWL.docx",
      }),
      resource({
        label: "Unit 3 End-of-Unit Reflection",
        path: "localized-moodle/document/9130e033b2-Unit3-End-of-Unit-Reflection.docx",
        role: "unit_reflection",
        source: "https://www.esunnybrook.com/pluginfile.php/7784/mod_book/chapter/703/Unit3-End-of-Unit-Reflection.docx",
      }),
    ],
  ],
  [
    4,
    [
      resource({
        label: "ENG4U Unit 4 KWL",
        path: "localized-moodle/document/ed8487ddd8-ENG4U-Unit4-KWL.docx",
        role: "kwl",
        source: "https://www.esunnybrook.com/pluginfile.php/7804/mod_book/chapter/708/ENG4U-Unit4-KWL.docx",
      }),
    ],
  ],
]);

for (const unit of manifest.units || []) {
  if (unitTitles.has(unit.unit)) unit.title = unitTitles.get(unit.unit);
  unit.unitResources = unit.unitResources || {};
  const items = (reflectionAndLogs.get(unit.unit) || []).filter((item) => item.bytes > 0);
  if (items.length) unit.unitResources.reflectionAndLogs = items;
}

manifest.navigation = {
  ...(manifest.navigation || {}),
  primary: "unit",
  secondary: "lesson",
  structureLabel: "Moodle Course Resources",
};

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  eng4uCourseStructurePatchedAt: new Date().toISOString(),
  eng4uCourseStructureNotes: [
    "Added Moodle-confirmed unit titles from local lesson sequence.",
    "Attached local KWL and end-of-unit reflection files to each corresponding unit where downloaded.",
    "Course outline, final/culminating, and teacher answer keys still require authenticated Moodle capture if not present locally.",
  ],
};

writeJson(manifestPath, manifest);
