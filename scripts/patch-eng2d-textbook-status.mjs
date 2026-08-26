import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "ENG2D");
const manifestPath = path.join(courseRoot, "course-manifest.json");
const textbookRel = "texts/eng2d-textbook-reference/index.html";
const sourcesRel = "texts/SOURCES.md";

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function abs(relPath) {
  return path.join(courseRoot, ...toPosix(relPath).split("/"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderPage(title, body, relPath) {
  const cssHref = path.posix.relative(path.posix.dirname(relPath), "_assets/course-page-shell.css");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ENG2D - ${title} - Course Content</title>
  <link rel="stylesheet" href="${cssHref}" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>ENG2D</p><h1>${title}</h1></div>
    <section class="moodle-section">
      <header><p>Course Content</p><h2>${title}</h2></header>
      <div class="moodle-content">${body}</div>
    </section>
  </main>
</body>
</html>
`;
}

function writeTextbookReference() {
  const title = "ENG2D · Grade 10 English · Textbook Reference";
  const body = `<section>
  <p><strong>Course:</strong> ENG2D · English, Grade 10, Academic</p>
  <p><strong>Designated textbook in Moodle Course Outline:</strong> Not specified.</p>
  <p><strong>Evidence:</strong> The localized Course Overview iSpring attachment <code>ENG2D COURSE OUTLINE</code> includes the field <code>Textbook:</code>, but the field is blank.</p>
  <p><strong>Core literary text used by the course:</strong> <em>Macbeth</em> by William Shakespeare, used in Unit 1.</p>
  <p><strong>Included legal text file:</strong> Project Gutenberg public-domain plain text for <em>Macbeth</em>.</p>
  <p><strong>Official guidance:</strong> The Ontario Curriculum, Grades 9 and 10: English, 2007 (Revised).</p>
  <p>No commercial full textbook PDF is included because the source Moodle course does not name a textbook and no legal local textbook file was identified for ENG2D.</p>
</section>`;
  fs.mkdirSync(path.dirname(abs(textbookRel)), { recursive: true });
  fs.writeFileSync(abs(textbookRel), renderPage(title, body, textbookRel), "utf8");
  return fs.statSync(abs(textbookRel)).size;
}

function appendSourcesNote() {
  const sourcesPath = abs(sourcesRel);
  const existing = fs.existsSync(sourcesPath) ? fs.readFileSync(sourcesPath, "utf8") : "# ENG2D Text Sources\n";
  const note = `\n## Textbook Status\n\n- Designated textbook in Moodle Course Outline: not specified.\n- Evidence: Course Overview iSpring attachment \`ENG2D COURSE OUTLINE\` contains a \`Textbook:\` field with no title after it.\n- Included core literary text: \`Macbeth\` by William Shakespeare for Unit 1.\n- Full textbook status: no commercial textbook full text is included because no course-designated textbook or legal local ENG2D textbook file was identified.\n`;
  const next = existing.includes("## Textbook Status")
    ? existing.replace(/## Textbook Status[\s\S]*$/m, note.trimStart())
    : `${existing.trimEnd()}\n${note}`;
  fs.writeFileSync(sourcesPath, `${next.trimEnd()}\n`, "utf8");
  return fs.statSync(sourcesPath).size;
}

function patchManifest(textbookBytes, sourcesBytes) {
  const manifest = readJson(manifestPath);
  const textbookEntry = {
    id: "eng2d-textbook-reference",
    title: "ENG2D · Grade 10 English · Textbook Reference",
    type: "textbook_reference",
    units: [1, 2, 3, 4],
    copyrightStatus: "source_audit_only",
    sourceStatus: "no_designated_textbook_in_moodle_outline",
    notes:
      "The ENG2D Course Overview/Course Outline contains a Textbook field, but it is blank. The course uses Macbeth as its Unit 1 core literary text; no separate commercial textbook is named or included.",
    materials: [
      {
        label: "ENG2D Textbook Reference",
        type: "html",
        category: "textbook_reference",
        role: "textbook_reference",
        path: textbookRel,
        previewPath: textbookRel,
        bytes: textbookBytes,
        source: "ENG2D Course Overview iSpring attachment: ENG2D COURSE OUTLINE",
        textPreview:
          "Textbook status for ENG2D: no designated textbook is specified in the Moodle Course Outline; Unit 1 uses Macbeth as the core literary text.",
      },
    ],
    path: textbookRel,
    previewPath: textbookRel,
    bytes: textbookBytes,
    category: "textbook_reference",
    role: "textbook_reference",
    originalLabel: "ENG2D Textbook Reference",
    label: "ENG2D · Grade 10 English · Textbook Reference",
  };

  manifest.texts = [
    ...(manifest.texts || []).filter((text) => text.id !== textbookEntry.id),
    textbookEntry,
  ];
  manifest.courseDownloads = [
    ...(manifest.courseDownloads || []).filter((item) => ![textbookRel, sourcesRel].includes(toPosix(item.path))),
    {
      label: textbookEntry.label,
      type: "html",
      category: "textbook_reference",
      role: "textbook_reference",
      path: textbookRel,
      previewPath: textbookRel,
      bytes: textbookBytes,
      source: "ENG2D Course Overview iSpring attachment: ENG2D COURSE OUTLINE",
      teacherUse: "textbook_status_reference",
    },
    {
      label: "ENG2D Text Sources and Curriculum Notes",
      type: "md",
      category: "source_notes",
      role: "source_notes",
      path: sourcesRel,
      bytes: sourcesBytes,
      source: "local source audit",
      teacherUse: "source_audit",
    },
  ];
  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    textbookStatusAudit: {
      auditedAt: new Date().toISOString(),
      status: "no_designated_textbook_in_moodle_outline",
      evidence:
        "Course Overview iSpring attachment ENG2D COURSE OUTLINE contains a Textbook field with no title after it.",
      coreTextIncluded: "Macbeth by William Shakespeare",
      referencePath: textbookRel,
    },
  };
  manifest.generatedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
  return manifest;
}

const textbookBytes = writeTextbookReference();
const sourcesBytes = appendSourcesNote();
const manifest = patchManifest(textbookBytes, sourcesBytes);
const report = {
  course: "ENG2D",
  textbookReferencePath: textbookRel,
  textbookReferenceBytes: textbookBytes,
  sourcesPath: sourcesRel,
  sourcesBytes,
  texts: (manifest.texts || []).map((text) => ({
    id: text.id,
    type: text.type,
    sourceStatus: text.sourceStatus,
  })),
};
const reportPath = path.join(repoRoot, "deployment", "ENG2D-textbook-status-report.json");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
writeJson(reportPath, report);
console.log(JSON.stringify(report, null, 2));
