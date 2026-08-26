import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const docsRoot = path.join(workspaceRoot, "docs");
const coursewareRoot = path.join(workspaceRoot, "courseware");

const syncStamp = "2026-08-26";

const mappings = [
  {
    course: "SCH4U",
    source: "Nelson-Chemistry-12-SCH4U 新.pdf",
    dest: "texts/nelson-chemistry-12/Nelson-Chemistry-12.pdf",
    label: "Nelson Chemistry 12 Textbook",
    category: "course_textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "MPM2D",
    source: "Nelson-Principles-of-Mathematics-10-MPM2D 新.pdf",
    dest: "texts/nelson-principles-of-mathematics-10/Nelson-Principles-of-Mathematics-10.pdf",
    label: "MPM2D · Principles of Mathematics · Nelson Principles of Mathematics 10",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "SPH3U",
    source: "Nelson-Physics-11-SPH3U 新.pdf",
    dest: "texts/nelson-physics-11/Nelson-Physics-11.pdf",
    label: "SPH3U · Physics · Nelson Physics 11 Textbook",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "MCV4U",
    source: "Nelson-MCV4U-Textbook-新.pdf",
    dest: "texts/nelson-calculus-and-vectors-12/Nelson-MCV4U-Textbook.pdf",
    label: "MCV4U · Calculus and Vectors · Nelson Calculus and Vectors 12 Textbook",
    category: "textbook",
    role: "core_text",
    mode: "replace",
  },
  {
    course: "MDM4U",
    source: "mcgraw-hill-ryerson-data-management-12-MDM4U 新.pdf",
    dest: "texts/mcgraw-hill-ryerson-data-management-12-2014.pdf",
    label: "MDM4U · Mathematics of Data Management · McGraw-Hill Ryerson Data Management 12 Textbook (2014)",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "BBI2O",
    source: "pdfcoffee.com_the-world-of-business-fifth-edition-by-jack-wilson-david-notman-lorie-guest-and-terry-g-murphy-pdf-free.pdf",
    dest: "texts/textbook/the-world-of-business-5th-edition.pdf",
    label: "BBI2O · Grade 10 Introduction to Business · The World of Business, 5th Edition",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "BAF3M",
    source: "Principles of Accounting, 4th Edition © 2013.pdf",
    dest: "texts/principles-of-accounting-4e/Principles of Accounting 4th Edition 2013.pdf",
    label: "BAF3M · Principles of Accounting, 4th Edition",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "BBB4M",
    source: "Grade 12-BBB4M-International Business Fundamentals.pdf",
    dest: "texts/fundamentals-of-international-business-a-canadian-perspective.pdf",
    label: "Fundamentals of International Business: A Canadian Perspective",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "CHC2D",
    source: "Think History. Canadian History Since 1914 © 2016.pdf",
    dest: "texts/think-history-canadian-history-since-1914/Think History Canadian History Since 1914 2016.pdf",
    label: "CHC2D · Think History: Canadian History Since 1914",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "SBI3U",
    source: "McGraw-Hill-Ryerson-Biology-11.pdf",
    dest: "texts/mcgraw-hill-ryerson-biology-11/McGraw-Hill-Ryerson-Biology-11.pdf",
    label: "SBI3U · Biology, Grade 11, University Preparation · McGraw-Hill Ryerson Biology 11 Textbook",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "SBI4U",
    source: "Nelson Biology 12.pdf",
    dest: "texts/nelson-biology-12/Nelson Biology 12.pdf",
    label: "Biology 12, Nelson Education Ltd., 2012",
    category: "textbook",
    role: "core_text",
    mode: "replace",
  },
  {
    course: "SNC2D",
    source: "ON Science 10 © 2009.pdf",
    dest: "texts/on-science-10/ON Science 10.pdf",
    label: "SNC2D · ON Science 10",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "SCH3U",
    source: "Nelson-Chemistry-11.pdf",
    dest: "texts/nelson-chemistry-11/Nelson-Chemistry-11.pdf",
    label: "SCH3U · Chemistry, Grade 11, University Preparation · Nelson Chemistry 11 Textbook",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "SPH4U",
    source: "NelsonPhysics12.pdf",
    dest: "texts/nelson-physics-12/Nelson-Physics-12-Textbook.pdf",
    label: "Nelson Physics 12 Textbook",
    category: "textbook",
    role: "core_text",
    mode: "replace",
  },
  {
    course: "MCR3U",
    source: "Nelson Functions 11 Textbook(1)(1).pdf",
    dest: "texts/nelson-functions-11/Nelson Functions 11 Textbook.pdf",
    label: "MCR3U · Functions · Nelson Functions 11 Textbook",
    category: "textbook",
    role: "core_textbook",
    mode: "replace",
  },
  {
    course: "MHF4U",
    source: "Nelson-Advanced-Functions-12-Textbook.pdf",
    dest: "texts/nelson-advanced-functions-12/Nelson-Advanced-Functions-12-Textbook.pdf",
    label: "Nelson Advanced Functions 12 Textbook",
    category: "textbook",
    role: "core_text",
    mode: "replace",
  },
  {
    course: "ICS3U",
    source: "preview-9781292159089_A27018378.pdf",
    dest: "texts/objects-first-with-java-bluej-6e-global/Objects-First-with-Java-BlueJ-6th-Global-Edition-preview.pdf",
    label: "Objects First with Java: A Practical Introduction Using BlueJ, 6th Global Edition",
    category: "textbook",
    role: "supplementary_textbook",
    mode: "replace",
  },
  {
    course: "ESLEO",
    source: "Of Mice And Men Pages 1-50 - Flip PDF Download _ FlipHTML5.pdf",
    dest: "texts/of-mice-and-men/Of-Mice-and-Men.pdf",
    label: "Of Mice and Men",
    category: "text_material",
    role: "core_text",
    mode: "replace",
  },
  {
    course: "SBI4U",
    source: "McGraw-Hill-Ryerson-Biology-12.pdf",
    dest: "texts/mcgraw-hill-ryerson-biology-12/McGraw-Hill-Ryerson-Biology-12.pdf",
    label: "McGraw-Hill Ryerson Biology 12 Supplemental Textbook",
    category: "textbook",
    role: "supplementary_textbook",
    mode: "add",
  },
  {
    course: "SNC2D",
    source: "pdfcoffee.com_nelson-science-perspectives-10-pdf-free.pdf",
    dest: "texts/nelson-science-perspectives-10/Nelson Science Perspectives 10.pdf",
    label: "Nelson Science Perspectives 10 Supplemental Textbook",
    category: "textbook",
    role: "supplementary_textbook",
    mode: "add",
  },
  {
    course: "SCH3U",
    source: "Edvantage Chemistry 11.pdf",
    dest: "texts/edvantage-chemistry-11/Edvantage Chemistry 11.pdf",
    label: "Edvantage Chemistry 11 Supplemental Textbook",
    category: "textbook",
    role: "supplementary_textbook",
    mode: "add",
  },
  {
    course: "SCH3U",
    source: "378bd-grade-11-chemistry-textbook.pdf",
    dest: "texts/grade-11-chemistry-textbook/grade-11-chemistry-textbook.pdf",
    label: "Grade 11 Chemistry Supplemental Textbook",
    category: "textbook",
    role: "supplementary_textbook",
    mode: "add",
  },
  {
    course: "BAF3M",
    source: "fundamentals-of-accounting.pdf",
    dest: "texts/fundamentals-of-accounting/fundamentals-of-accounting.pdf",
    label: "Fundamentals of Accounting Supplemental Text",
    category: "textbook",
    role: "supplementary_textbook",
    mode: "add",
  },
  ...[
    ["ICS3U_basic_math.pdf", "ICS3U Basic Math Review"],
    ["ICS3U_case_study_height.pdf", "ICS3U Case Study - Height"],
    ["ICS3U_garvintunes_project.pdf", "ICS3U GarvinTunes Project"],
    ["ICS3U_input_output.pdf", "ICS3U Input and Output"],
    ["ICS3U_more_math.pdf", "ICS3U More Math Review"],
    ["ICS3U_python_basics_review.pdf", "ICS3U Python Basics Review"],
    ["ICS3U_variables_types.pdf", "ICS3U Variables and Types"],
  ].map(([source, label]) => ({
    course: "ICS3U",
    source,
    dest: `texts/ics3u-python-supplemental/${source}`,
    label,
    category: "text_material",
    role: "supplemental_lesson_text",
    mode: "add",
  })),
];

const skipped = [
  { source: "Nelson-Chemistry-11 (1).pdf", reason: "duplicate of Nelson-Chemistry-11.pdf" },
  { source: "Nelson Chemistry 12.pdf", reason: "older duplicate; SCH4U-specific replacement file is preferred" },
  { source: "Nelson MCV4U Textbook.pdf", reason: "older duplicate; MCV4U-specific replacement file is preferred" },
  { source: "Nelson-Physics-11.pdf", reason: "older duplicate; SPH3U-specific replacement file is preferred" },
  { source: "ON Science 10.pdf", reason: "older duplicate; copyright-labelled ON Science 10 file is preferred" },
  { source: "MDM4U-Ministry.pdf", reason: "course already carries the official Ontario mathematics curriculum reference" },
  { source: "Textbook-list-June-2022-2023.pdf", reason: "cross-course approved-list reference, not a course textbook" },
  { source: "SBI4U - Culminatng.pdf", reason: "course activity file, not a textbook placement candidate" },
  { source: "Nelson-Textbook-of-Pediatrics-22nd-Edition-2024.pdf", reason: "not an OSSD course textbook in this courseware set" },
  { source: "中外合作办学项日批准书.pdf", reason: "administrative document, not a course textbook" },
  { source: "宣传册中文版1206.pdf", reason: "brochure, not a course textbook" },
];

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function courseRoot(course) {
  return path.join(coursewareRoot, course);
}

function manifestPath(course) {
  return path.join(courseRoot(course), "course-manifest.json");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textPreviewFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".txt" || ext === ".html") {
    return stripTags(fs.readFileSync(filePath, "utf8")).slice(0, 240);
  }
  return undefined;
}

function recordFor(mapping, bytes) {
  const record = {
    label: mapping.label,
    type: "pdf",
    category: mapping.category,
    role: mapping.role,
    path: mapping.dest,
    bytes,
    source: `user-provided legal local file: docs/${mapping.source}`,
    previewPath: mapping.dest,
    downloadPath: mapping.dest,
    syncedFromDocsAt: syncStamp,
  };
  return record;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "text";
}

function unitNumbers(manifest) {
  const units = (manifest.units || []).map((unit) => Number(unit.unit)).filter((unit) => Number.isFinite(unit));
  return units.length ? units : [];
}

function textEntryFor(mapping, material, manifest) {
  const baseId = slug(mapping.dest.replace(/^texts\//, "").replace(/\.[^.]+$/u, ""));
  return {
    id: baseId,
    title: mapping.label,
    type: mapping.category === "text_material" ? "text_material" : "pdf",
    units: unitNumbers(manifest),
    copyrightStatus: "user_provided_legal_copy",
    sourceStatus: "localized_from_user_provided_legal_file",
    notes:
      mapping.mode === "replace"
        ? "Existing course textbook/material file replaced in place from the user-provided legal docs folder."
        : "Supplemental course-appropriate textbook/material added from the user-provided legal docs folder.",
    materials: [material],
  };
}

function upsertByPath(list, record) {
  const items = Array.isArray(list) ? [...list] : [];
  const index = items.findIndex((item) => toPosix(item?.path) === toPosix(record.path));
  if (index >= 0) {
    items[index] = { ...items[index], ...record };
  } else {
    items.push(record);
  }
  return items;
}

function cleanTextRegistry(list) {
  return (Array.isArray(list) ? list : []).filter((text) => text?.id && text?.title && Array.isArray(text?.units));
}

function textContainsPath(text, relPath) {
  const target = toPosix(relPath);
  if (toPosix(text?.path) === target) return true;
  return (text?.materials || []).some((item) => toPosix(item?.path) === target);
}

function upsertTextEntry(list, mapping, material, manifest) {
  const items = cleanTextRegistry(list);
  const index = items.findIndex((text) => textContainsPath(text, mapping.dest));
  if (index >= 0) {
    const materials = upsertByPath(items[index].materials || [], material);
    items[index] = {
      ...items[index],
      materials,
      path: items[index].path || material.path,
      previewPath: items[index].previewPath || material.previewPath,
      downloadPath: items[index].downloadPath || material.downloadPath,
      bytes: items[index].path === material.path || !items[index].bytes ? material.bytes : items[index].bytes,
    };
    return items;
  }
  items.push(textEntryFor(mapping, material, manifest));
  return items;
}

function refreshMatchingRecords(node, record) {
  if (!node || typeof node !== "object") return 0;
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + refreshMatchingRecords(item, record), 0);
  let updated = 0;
  if (toPosix(node.path) === toPosix(record.path)) {
    Object.assign(node, { ...node, ...record });
    updated += 1;
  }
  for (const value of Object.values(node)) updated += refreshMatchingRecords(value, record);
  return updated;
}

function updateSources(course, courseMappings) {
  const sourcesPath = path.join(courseRoot(course), "texts", "SOURCES.md");
  fs.mkdirSync(path.dirname(sourcesPath), { recursive: true });
  const marker = `## Docs Textbook Sync ${syncStamp}`;
  const lines = [
    "",
    marker,
    "",
    "The following user-provided legal local files from `D:/工作文件/SUNNYBROOK/docs` were synced into this course package:",
    "",
    ...courseMappings.map((item) => `- ${item.mode === "replace" ? "Replaced" : "Added"}: \`${item.dest}\` from \`${item.source}\`.`),
    "",
  ];
  let current = fs.existsSync(sourcesPath) ? fs.readFileSync(sourcesPath, "utf8").replace(/\s+$/u, "") : `# ${course} Text Sources`;
  const markerIndex = current.indexOf(marker);
  if (markerIndex >= 0) current = current.slice(0, markerIndex).replace(/\s+$/u, "");
  fs.writeFileSync(sourcesPath, `${current}\n${lines.join("\n")}`, "utf8");
  const stat = fs.statSync(sourcesPath);
  return {
    label: `${course} Text And Source Audit`,
    type: "md",
    category: "source_audit",
    role: "source_audit",
    path: "texts/SOURCES.md",
    bytes: stat.size,
    previewPath: "texts/SOURCES.md",
    downloadPath: "texts/SOURCES.md",
    textPreview: textPreviewFor(sourcesPath),
  };
}

function syncCourse(course, courseMappings, report) {
  const manifestFile = manifestPath(course);
  if (!fs.existsSync(manifestFile)) {
    report.errors.push({ course, error: "missing course-manifest.json" });
    return;
  }
  const manifest = readJson(manifestFile);
  manifest.texts = cleanTextRegistry(manifest.texts);

  for (const mapping of courseMappings) {
    const sourcePath = path.join(docsRoot, mapping.source);
    const destPath = path.join(courseRoot(course), ...toPosix(mapping.dest).split("/"));
    if (!fs.existsSync(sourcePath)) {
      report.errors.push({ course, source: mapping.source, error: "missing source file" });
      continue;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const previousBytes = fs.existsSync(destPath) ? fs.statSync(destPath).size : null;
    fs.copyFileSync(sourcePath, destPath);
    const bytes = fs.statSync(destPath).size;
    const record = recordFor(mapping, bytes);
    const recordUpdates = refreshMatchingRecords(manifest, record);
    manifest.texts = upsertTextEntry(manifest.texts || [], mapping, record, manifest);
    if (Array.isArray(manifest.textMaterials)) manifest.textMaterials = upsertByPath(manifest.textMaterials, record);
    manifest.courseDownloads = upsertByPath(manifest.courseDownloads || [], record);
    report.synced.push({
      course,
      mode: mapping.mode,
      source: mapping.source,
      dest: mapping.dest,
      previousBytes,
      bytes,
      recordUpdates,
    });
  }

  const sourcesRecord = updateSources(course, courseMappings);
  refreshMatchingRecords(manifest, sourcesRecord);
  if (Array.isArray(manifest.textMaterials)) manifest.textMaterials = upsertByPath(manifest.textMaterials, sourcesRecord);
  manifest.courseDownloads = upsertByPath(manifest.courseDownloads || [], sourcesRecord);

  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    docsTextbookSync20260826: {
      syncedAt: new Date().toISOString(),
      docsRoot,
      syncedFiles: courseMappings.length,
      replacements: courseMappings.filter((item) => item.mode === "replace").length,
      additions: courseMappings.filter((item) => item.mode === "add").length,
      rule: "User-provided legal textbook files in docs were copied to course-specific texts folders; existing canonical course paths were replaced in place.",
    },
  };
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestFile, manifest);
}

const byCourse = new Map();
for (const mapping of mappings) {
  const items = byCourse.get(mapping.course) || [];
  items.push(mapping);
  byCourse.set(mapping.course, items);
}

const report = {
  syncedAt: new Date().toISOString(),
  docsRoot,
  courses: [...byCourse.keys()].sort(),
  synced: [],
  skipped,
  errors: [],
};

for (const [course, courseMappings] of byCourse) syncCourse(course, courseMappings, report);

const reportPath = path.join(repoRoot, "deployment", `docs-textbook-sync-${syncStamp.replace(/-/g, "")}.json`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
writeJson(reportPath, report);
console.log(JSON.stringify(report, null, 2));
