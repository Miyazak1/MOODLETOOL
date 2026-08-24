import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const docsRoot = join(workspaceRoot, "docs");
const verifiedAt = new Date().toISOString();

const textbooks = [
  {
    course: "BAF3M",
    sourceName: "Principles of Accounting, 4th Edition © 2013.pdf",
    rel: "texts/principles-of-accounting-4e/Principles of Accounting 4th Edition 2013.pdf",
    id: "principles-of-accounting-4e",
    title: "BAF3M · Principles of Accounting, 4th Edition",
    originalTitle: "Principles of Accounting, 4th Edition",
    publisher: "Unknown from filename",
    units: [1, 2, 3, 4],
    notes:
      "Core accounting textbook PDF provided by the user as a legal local copy for BAF3M Financial Accounting Fundamentals.",
  },
  {
    course: "CHC2D",
    sourceName: "Think History. Canadian History Since 1914 © 2016.pdf",
    rel: "texts/think-history-canadian-history-since-1914/Think History Canadian History Since 1914 2016.pdf",
    id: "think-history-canadian-history-since-1914",
    title: "CHC2D · Think History: Canadian History Since 1914",
    originalTitle: "Think History: Canadian History Since 1914",
    publisher: "Unknown from filename",
    units: [1, 2, 3, 4, 5, 6],
    notes:
      "Core Canadian history textbook PDF provided by the user as a legal local copy for CHC2D Canadian History since World War I.",
  },
  {
    course: "SNC2D",
    sourceName: "ON Science 10.pdf",
    rel: "texts/on-science-10/ON Science 10.pdf",
    id: "on-science-10-textbook",
    title: "SNC2D · ON Science 10",
    originalTitle: "ON Science 10",
    publisher: "McGraw-Hill Ryerson",
    units: [1, 2, 3, 4],
    isbn13: "978-0-07-072222-4",
    notes:
      "Core Grade 10 science textbook PDF provided by the user as a legal local copy. The local textbook list identifies SNC2D as ON Science 10, ISBN 9780070722224.",
  },
];

function normalize(value) {
  return String(value || "").replaceAll("\\", "/");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function dedupeByPath(items) {
  const seen = new Set();
  const out = [];
  for (const item of items.filter(Boolean)) {
    const key = normalize(item.path || item.previewPath || item.downloadPath || item.id || item.label || item.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

for (const config of textbooks) {
  const courseRoot = join(workspaceRoot, "courseware", config.course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  const sourcePath = join(docsRoot, config.sourceName);
  const targetPath = join(courseRoot, config.rel);

  if (!existsSync(sourcePath)) throw new Error(`Missing source PDF: ${sourcePath}`);
  if (!existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);

  const sourceBytes = statSync(sourcePath).size;
  const localBytes = statSync(targetPath).size;
  const manifest = readJson(manifestPath);
  manifest.generatedAt = verifiedAt;

  const material = {
    label: config.title,
    originalTitle: config.originalTitle,
    type: "pdf",
    category: "textbook",
    role: "core_textbook",
    path: config.rel,
    previewPath: config.rel,
    downloadPath: config.rel,
    bytes: localBytes,
    source: `user-provided legal local file: docs/${config.sourceName}`,
  };
  if (config.publisher) material.publisher = config.publisher;
  if (config.isbn13) material.isbn13 = config.isbn13;

  const textEntry = {
    id: config.id,
    title: config.title,
    originalTitle: config.originalTitle,
    publisher: config.publisher,
    isbn13: config.isbn13,
    type: "textbook",
    units: config.units,
    copyrightStatus: "user_provided_legal_copy",
    sourceStatus: "localized_from_user_provided_legal_file",
    notes: config.notes,
    materials: [{ ...material }],
    path: config.rel,
    previewPath: config.rel,
    downloadPath: config.rel,
    bytes: localBytes,
    category: "textbook",
    role: "core_textbook",
  };

  const existingTexts = (manifest.texts || []).filter((item) => {
    const key = `${item.id || ""} ${item.title || ""} ${item.path || ""}`.toLowerCase();
    return item.id !== config.id && normalize(item.path) !== config.rel && !key.includes(config.originalTitle.toLowerCase());
  });
  manifest.texts = dedupeByPath([textEntry, ...existingTexts]);
  manifest.textMaterials = manifest.texts;

  const existingDownloads = (manifest.courseDownloads || []).filter((item) => {
    const key = `${item.label || ""} ${item.title || ""} ${item.path || ""}`.toLowerCase();
    return normalize(item.path) !== config.rel && !key.includes(config.originalTitle.toLowerCase());
  });
  manifest.courseDownloads = dedupeByPath([material, ...existingDownloads]);

  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    textMaterials: manifest.texts.length,
    textbookAudit: {
      ...((manifest.sourceAudit || {}).textbookAudit || {}),
      status: "full_textbook_added",
      title: config.title,
      originalTitle: config.originalTitle,
      sourceFile: normalize(sourcePath),
      localPath: config.rel,
      sourceBytes,
      localBytes,
      verifiedAt,
      decision: `Include the user-provided legal PDF as the ${config.course} core textbook.`,
    },
  };
  if (config.course === "SNC2D") {
    manifest.sourceAudit.textbookReference = {
      ...((manifest.sourceAudit || {}).textbookReference || {}),
      status: "full_textbook_added",
      title: config.title,
      isbn13: config.isbn13,
      localPath: config.rel,
      verifiedAt,
    };
  }

  const sourcesPath = join(courseRoot, "texts", "SOURCES.md");
  const previousSources = existsSync(sourcesPath) ? readFileSync(sourcesPath, "utf8").trimEnd() : `# ${config.course} Text And Source Audit`;
  const marker = `## Added Core Textbook (${verifiedAt.slice(0, 10)})`;
  const appended = `${previousSources}

${marker}

- ${config.title} (${config.originalTitle}) was copied from the user-provided legal local file \`D:\\工作文件\\SUNNYBROOK\\docs\\${config.sourceName}\`.
- Course package path: \`${config.rel}\`.
`;
  writeFileSync(sourcesPath, `${appended}\n`, "utf8");

  writeJson(manifestPath, manifest);

  console.log(JSON.stringify({
    course: config.course,
    textbook: config.title,
    path: config.rel,
    bytes: localBytes,
    texts: manifest.texts.length,
    courseDownloads: manifest.courseDownloads.length,
  }));
}
