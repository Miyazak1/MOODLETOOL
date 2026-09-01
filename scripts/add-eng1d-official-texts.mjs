import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const COURSE = "ENG1D";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const manifestPath = join(COURSE_ROOT, "course-manifest.json");

const downloads = [
  {
    id: "ontario-english-curriculum-9-10-2007",
    title: "The Ontario Curriculum, Grades 9 and 10: English, 2007 (Revised)",
    author: "Ontario Ministry of Education",
    publisher: "Ontario Ministry of Education",
    type: "curriculum",
    units: [1, 2, 3, 4],
    copyrightStatus: "official_public_document",
    sourceStatus: "localized_from_public_official_source",
    notes: "Official Ontario Ministry curriculum reference named by the ENG1D course outline; includes English, Grade 9, Academic (ENG1D).",
    source: "https://www.edu.gov.on.ca/eng/curriculum/secondary/english910currb.pdf",
    path: "texts/ontario-curriculum/english910currb.pdf",
    label: "The Ontario Curriculum, Grades 9 and 10: English, 2007 (Revised)",
    category: "official_curriculum",
    role: "curriculum_reference",
    textPreview: "Official Ontario Ministry curriculum guidance for Grades 9 and 10 English, including ENG1D English, Grade 9, Academic.",
  },
  {
    id: "romeo-and-juliet-public-domain",
    title: "Romeo and Juliet",
    author: "William Shakespeare",
    publisher: "Project Gutenberg",
    type: "literary_text",
    units: [2],
    copyrightStatus: "public_domain",
    sourceStatus: "localized_from_public_domain_source",
    notes: "Public-domain full text supplement for Unit 2: Romeo and Juliet.",
    source: "https://www.gutenberg.org/cache/epub/1513/pg1513-images.html",
    path: "texts/public-domain/romeo-and-juliet.html",
    label: "Romeo and Juliet - public-domain full text",
    category: "public_domain_text",
    role: "core_literary_text",
    textPreview: "Public-domain Shakespeare text for Unit 2 teacher preparation and student reference.",
  },
  {
    id: "monkeys-paw-public-domain",
    title: "The Monkey's Paw",
    author: "W. W. Jacobs",
    publisher: "Project Gutenberg",
    type: "literary_text",
    units: [1],
    copyrightStatus: "public_domain",
    sourceStatus: "localized_from_public_domain_source",
    notes: "Public-domain full text supplement for Unit 1 Lesson 2: Characterization.",
    source: "https://www.gutenberg.org/cache/epub/12122/pg12122-images.html",
    path: "texts/public-domain/the-monkeys-paw.html",
    label: "The Monkey's Paw - public-domain full text",
    category: "public_domain_text",
    role: "supporting_literary_text",
    textPreview: "Public-domain story text matching ENG1D Unit 1 Lesson 2.",
  },
  {
    id: "birthmark-public-domain",
    title: "The Birthmark",
    author: "Nathaniel Hawthorne",
    publisher: "Project Gutenberg",
    type: "literary_text",
    units: [1],
    copyrightStatus: "public_domain",
    sourceStatus: "localized_from_public_domain_source",
    notes: "Public-domain Hawthorne collection containing The Birthmark; supports Unit 1 Lesson 5: Point of View/Symbolism.",
    source: "https://www.gutenberg.org/cache/epub/39716/pg39716-images.html",
    path: "texts/public-domain/hawthorne-birthmark-collection.html",
    label: "The Birthmark - public-domain source collection",
    category: "public_domain_text",
    role: "supporting_literary_text",
    textPreview: "Public-domain Hawthorne source containing The Birthmark.",
  },
  {
    id: "lottery-ticket-public-domain",
    title: "The Lottery Ticket",
    author: "Anton Chekhov; translated by Constance Garnett",
    publisher: "Project Gutenberg",
    type: "literary_text",
    units: [1],
    copyrightStatus: "public_domain",
    sourceStatus: "localized_from_public_domain_source",
    notes: "Public-domain Chekhov collection containing The Lottery Ticket; supports Unit 1 Lesson 6: Themes.",
    source: "https://www.gutenberg.org/cache/epub/1883/pg1883-images.html",
    path: "texts/public-domain/chekhov-the-wife-and-other-stories.html",
    label: "The Lottery Ticket - public-domain source collection",
    category: "public_domain_text",
    role: "supporting_literary_text",
    textPreview: "Public-domain Chekhov source containing The Lottery Ticket.",
  },
  {
    id: "bulfinch-mythology-public-domain",
    title: "Bulfinch's Mythology",
    author: "Thomas Bulfinch",
    publisher: "Project Gutenberg",
    type: "literary_reference",
    units: [4],
    copyrightStatus: "public_domain",
    sourceStatus: "localized_from_public_domain_source",
    notes: "Public-domain mythology reference for Unit 4 Greek, Trojan War, Norse mythology, and archetype preparation.",
    source: "https://www.gutenberg.org/cache/epub/4928/pg4928-images.html",
    path: "texts/public-domain/bulfinchs-mythology.html",
    label: "Bulfinch's Mythology - public-domain reference",
    category: "public_domain_text",
    role: "supporting_literary_reference",
    textPreview: "Public-domain mythology reference aligned with ENG1D Unit 4.",
  },
];

const sourceAuditPath = "texts/SOURCES.md";
const textIndexPath = "texts/eng1d-texts-and-sources/index.html";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function bytesFor(relPath) {
  const absPath = join(COURSE_ROOT, relPath);
  return existsSync(absPath) ? statSync(absPath).size : 0;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

function materialKey(item) {
  return item.path || item.downloadPath || item.label;
}

function mergeMaterials(current = [], next = []) {
  const merged = [...next];
  for (const existing of current) {
    if (existing?.type === "docx" || existing?.derivedFrom) {
      const key = materialKey(existing);
      if (!merged.some((item) => materialKey(item) === key)) merged.push(existing);
    }
  }
  return merged;
}

function upsertText(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = {
      ...items[index],
      ...item,
      materials: mergeMaterials(items[index].materials, item.materials),
    };
  } else {
    items.push(item);
  }
}

function upsertByPath(items, item) {
  const index = items.findIndex((candidate) => candidate.path === item.path);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

async function fetchToFile(source, relPath) {
  const response = await fetch(source, {
    headers: {
      "User-Agent": "ossd-course-portal-localizer/1.0",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const target = join(COURSE_ROOT, relPath);
  ensureDir(dirname(target));
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(target, buffer);
  return buffer.length;
}

function materialFor(entry) {
  const bytes = bytesFor(entry.path);
  return {
    label: entry.label,
    title: entry.label,
    type: entry.path.endsWith(".pdf") ? "pdf" : "html",
    category: entry.category,
    role: entry.role,
    path: entry.path,
    previewPath: entry.path,
    downloadPath: entry.path,
    bytes,
    source: entry.source,
    textPreview: entry.textPreview,
  };
}

function textRecord(entry) {
  const material = materialFor(entry);
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    publisher: entry.publisher,
    type: entry.type,
    units: entry.units,
    copyrightStatus: entry.copyrightStatus,
    sourceStatus: entry.sourceStatus,
    notes: entry.notes,
    materials: [material],
    path: entry.path,
    previewPath: entry.path,
    downloadPath: entry.path,
    bytes: material.bytes,
    category: entry.category,
    role: entry.role,
    source: entry.source,
    originalLabel: entry.label,
    label: `ENG1D · ${entry.title}`,
  };
}

function writeSourceAudit() {
  ensureDir(dirname(join(COURSE_ROOT, sourceAuditPath)));
  const lines = [
    "# ENG1D Text And Source Audit",
    "",
    "This file records official curriculum guidance, textbook evidence, and supplemental text decisions for the ENG1D package.",
    "",
    "## Official Curriculum Guidance",
    "",
    "- The ENG1D Moodle Course Outline names the policy document as `English, The Ontario Curriculum, Grades 9 and 10, 2008 (Revised)` and links to the Ontario Ministry PDF. The Ministry PDF itself is the 2007 revised English curriculum for Grades 9 and 10.",
    "- Local path: `texts/ontario-curriculum/english910currb.pdf`.",
    "- Public source: https://www.edu.gov.on.ca/eng/curriculum/secondary/english910currb.pdf",
    "",
    "## Textbook / Core Text Evidence",
    "",
    "The localized ENG1D Course Outline does not name one commercial textbook. It says the instructor assembles various short stories, films, video clips, and poetry, and specifically lists `Romeo & Juliet` and `Lord of the Flies`.",
    "",
    "Because no legal full commercial Grade 9 English textbook file was found in `D:/工作文件/SUNNYBROOK/docs`, no commercial textbook PDF was added.",
    "",
    "## Public-Domain Supplements Added",
    "",
    "- William Shakespeare, `Romeo and Juliet`.",
    "- W. W. Jacobs, `The Monkey's Paw`.",
    "- Nathaniel Hawthorne, `The Birthmark` source collection.",
    "- Anton Chekhov, `The Lottery Ticket` source collection, translated by Constance Garnett.",
    "- Thomas Bulfinch, `Bulfinch's Mythology`.",
    "",
    "## Copyright Boundary",
    "",
    "`Lord of the Flies`, `Through the Tunnel`, `Just Lather, That's All`, and other modern copyrighted works may remain as Moodle-provided local course files when already present, but this script does not add new full-text copies of copyrighted works from the web.",
    "",
  ];
  writeFileSync(join(COURSE_ROOT, sourceAuditPath), lines.join("\n"), "utf8");
}

function writeTextIndex() {
  ensureDir(dirname(join(COURSE_ROOT, textIndexPath)));
  const cards = downloads
    .map(
      (entry) => `<article>
        <h2>${entry.title}</h2>
        <p><strong>Use:</strong> ${entry.notes}</p>
        <p><strong>Status:</strong> ${entry.copyrightStatus.replaceAll("_", " ")}</p>
        <p><a href="../${entry.path.split("/").slice(1).join("/")}">Open local file</a></p>
      </article>`,
    )
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ENG1D Texts and Curriculum Sources</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f4f7fb; color: #001f3f; }
    main { max-width: 980px; margin: 40px auto; background: #fff; border: 1px solid #d8e4f2; border-radius: 8px; padding: 28px; }
    h1 { margin-top: 0; font-size: 30px; }
    h2 { font-size: 20px; margin: 0 0 10px; }
    p, li { line-height: 1.55; }
    article { border-top: 1px solid #e3ebf5; padding: 18px 0; }
    .notice { border: 1px solid #f4c36a; background: #fff8e8; color: #6d4600; border-radius: 6px; padding: 12px 14px; }
  </style>
</head>
<body>
  <main>
    <h1>ENG1D Texts and Curriculum Sources</h1>
    <p class="notice">The course outline does not name a single commercial textbook. It lists instructor-assembled short stories, films, video clips, poetry, Romeo & Juliet, and Lord of the Flies. Public-domain and official sources are included here; copyrighted full texts are not newly added.</p>
    ${cards}
  </main>
</body>
</html>
`;
  writeFileSync(join(COURSE_ROOT, textIndexPath), html, "utf8");
}

async function main() {
  const manifest = readJson(manifestPath);
  const fetched = [];
  const failed = [];

  for (const entry of downloads) {
    try {
      const bytes = await fetchToFile(entry.source, entry.path);
      fetched.push({ id: entry.id, path: entry.path, bytes });
    } catch (error) {
      failed.push({ id: entry.id, source: entry.source, error: error.message });
    }
  }

  writeSourceAudit();
  writeTextIndex();

  const sourceAuditMaterial = {
    label: "ENG1D Text And Source Audit",
    title: "ENG1D Text And Source Audit",
    type: "md",
    category: "source_audit",
    role: "source_audit",
    path: sourceAuditPath,
    previewPath: sourceAuditPath,
    downloadPath: sourceAuditPath,
    bytes: bytesFor(sourceAuditPath),
    source: "local source audit",
    textPreview: "Records ENG1D official curriculum, textbook evidence, public-domain supplemental texts, and copyright boundaries.",
  };
  const indexMaterial = {
    label: "ENG1D Texts and Curriculum Sources",
    title: "ENG1D Texts and Curriculum Sources",
    type: "html",
    category: "textbook_reference",
    role: "textbook_reference",
    path: textIndexPath,
    previewPath: textIndexPath,
    downloadPath: textIndexPath,
    bytes: bytesFor(textIndexPath),
    source: "local source audit",
    textPreview: "Teacher-facing index of official curriculum guidance and supplemental ENG1D literary texts.",
  };

  manifest.texts = Array.isArray(manifest.texts) ? manifest.texts : [];
  manifest.courseDownloads = Array.isArray(manifest.courseDownloads) ? manifest.courseDownloads : [];

  for (const entry of downloads) {
    const record = textRecord(entry);
    upsertText(manifest.texts, record);
    upsertByPath(manifest.courseDownloads, { ...record.materials[0], textId: entry.id });
  }

  const sourceAuditText = {
    id: "eng1d-source-audit",
    title: "ENG1D Text And Source Audit",
    author: "Local source review",
    type: "source_audit",
    units: [1, 2, 3, 4],
    copyrightStatus: "local_audit_note",
    sourceStatus: "created_from_local_source_review",
    notes: "Records ENG1D textbook and source decisions, including why no commercial textbook PDF was added.",
    materials: [sourceAuditMaterial, indexMaterial],
    path: sourceAuditPath,
    previewPath: sourceAuditPath,
    downloadPath: sourceAuditPath,
    bytes: sourceAuditMaterial.bytes,
    category: "source_audit",
    role: "source_audit",
    source: "local source audit",
    label: "ENG1D · Text And Source Audit",
  };
  const courseTextReference = {
    id: "eng1d-course-text-set-reference",
    title: "ENG1D Course Text Set Reference",
    author: "ENG1D Course Outline / local source review",
    type: "textbook_reference",
    units: [1, 2, 3, 4],
    copyrightStatus: "reference_only",
    sourceStatus: "created_from_local_course_outline",
    notes:
      "The ENG1D Course Outline does not name a single commercial textbook. It says the instructor assembles various short stories, films, video clips, and poetry, and specifically lists Romeo & Juliet and Lord of the Flies. Public-domain texts are localized where legally available; copyrighted modern works are not newly copied.",
    materials: [indexMaterial],
    path: textIndexPath,
    previewPath: textIndexPath,
    downloadPath: textIndexPath,
    bytes: indexMaterial.bytes,
    category: "textbook_reference",
    role: "textbook_reference",
    source: "localized ENG1D Course Outline",
    label: "ENG1D · Course Text Set Reference",
  };
  upsertText(manifest.texts, courseTextReference);
  upsertByPath(manifest.courseDownloads, { ...indexMaterial, textId: courseTextReference.id });
  upsertText(manifest.texts, sourceAuditText);
  upsertByPath(manifest.courseDownloads, { ...sourceAuditMaterial, textId: sourceAuditText.id });
  upsertByPath(manifest.courseDownloads, { ...indexMaterial, textId: sourceAuditText.id });

  manifest.generatedAt = new Date().toISOString();
  manifest.sourceAudit ||= {};
  manifest.sourceAudit.curriculumGuidance = [
    {
      title: "The Ontario Curriculum, Grades 9 and 10: English, 2007 (Revised)",
      status: "localized",
      source: downloads[0].source,
      path: downloads[0].path,
      evidence: "Official Ontario Ministry curriculum PDF named by the localized ENG1D Course Outline.",
    },
  ];
  manifest.sourceAudit.textbookReference = {
    status: "assembled_texts_no_single_commercial_textbook",
    evidence: "The localized ENG1D Course Outline says the instructor assembles various short stories, films, video clips, and poetry, and lists Romeo & Juliet and Lord of the Flies. No legal full commercial Grade 9 English textbook was found in docs.",
    localReferencePath: textIndexPath,
    auditPath: sourceAuditPath,
  };
  manifest.sourceAudit.publicDomainTextSupplement = {
    generatedAt: manifest.generatedAt,
    localized: fetched,
    failed,
    copyrightBoundary: "Public-domain/official files added. No new full copies of copyrighted modern works such as Lord of the Flies, Through the Tunnel, or Just Lather, That's All were added.",
  };

  writeJson(manifestPath, manifest);
  writeFileSync(
    join(REPO_ROOT, "deployment", "ENG1D-text-supplement-report.json"),
    `${JSON.stringify({ course: COURSE, fetched, failed, texts: manifest.texts.length }, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ course: COURSE, fetched: fetched.length, failed, texts: manifest.texts.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
