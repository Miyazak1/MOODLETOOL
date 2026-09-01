import fs from "node:fs";
import path from "node:path";

const workspaceRoot = "D:/工作文件/SUNNYBROOK";
const course = "SBI3U";
const courseRoot = path.join(workspaceRoot, "courseware", course);
const manifestPath = path.join(courseRoot, "course-manifest.json");

const textbookId = "sbi3u-mcgraw-hill-ryerson-biology-11";
const oldTextbookId = "mcgraw-hill-ryerson-biology-11";
const textbookTitle = "SBI3U · Biology, Grade 11, University Preparation · McGraw-Hill Ryerson Biology 11 Textbook";
const textbookPath = "texts/mcgraw-hill-ryerson-biology-11/McGraw-Hill-Ryerson-Biology-11.pdf";
const textbookReferencePath = "texts/biology-11-textbook-reference/index.html";
const sourceAuditPath = "texts/SOURCES.md";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function bytes(relPath) {
  return fs.statSync(path.join(courseRoot, relPath)).size;
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function relPath(file) {
  return normalizeSlash(path.relative(courseRoot, file));
}

function displayLabel(item) {
  return String(item?.label || item?.title || "");
}

function parseUnitLesson(label) {
  const match = String(label || "").match(/^Unit\s+(\d+)\s*-\s*Lesson\s+(\d+)(?:\s*\(Answer\))?$/i);
  if (!match) return null;
  return { unit: Number(match[1]), lesson: Number(match[2]) };
}

function isHomeworkLesson(label) {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+$/i.test(String(label || ""));
}

function isHomeworkAnswer(label) {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+\s*\(Answer\)$/i.test(String(label || ""));
}

function isHomeworkSubmissionRecord(item) {
  const label = displayLabel(item);
  return isHomeworkLesson(label) || isHomeworkAnswer(label);
}

function isEmptyFinalSubmissionShell(item) {
  const label = displayLabel(item);
  const text = String(item?.textPreview || "").trim();
  const attachments = item?.attachments?.length || 0;
  const materials = item?.materials?.length || 0;
  if (attachments || materials) return false;
  if (!["Culminating", "Final Exam Dropbox"].includes(label)) return false;
  return /^(Culminating|Final Exam Dropbox)\s+View all submissions\s+Grade$/i.test(text);
}

function withLocalBytes(item) {
  const next = { ...item };
  if (normalizeSlash(next.path) && typeof next.bytes !== "number") {
    const file = path.join(courseRoot, normalizeSlash(next.path));
    if (fs.existsSync(file)) next.bytes = fs.statSync(file).size;
  }
  if (Array.isArray(next.attachments)) {
    next.attachments = next.attachments.map(withLocalBytes);
  }
  if (Array.isArray(next.materials)) {
    next.materials = next.materials.map(withLocalBytes);
  }
  return next;
}

function missingHomeworkPartnersFromItems(items) {
  const submissions = items.filter((item) => isHomeworkLesson(displayLabel(item)));
  const answerLabels = new Set(items.filter((item) => isHomeworkAnswer(displayLabel(item))).map(displayLabel));
  return submissions
    .filter((item) => !answerLabels.has(`${displayLabel(item)} (Answer)`))
    .map((item) => {
      const parsed = parseUnitLesson(displayLabel(item));
      return { unit: parsed?.unit, lesson: parsed?.lesson, label: displayLabel(item) };
    });
}

function cloneHomeworkItem(item, role) {
  const parsed = parseUnitLesson(displayLabel(item));
  return {
    ...item,
    role,
    category: item.category || (role === "homework_answer_page" ? "moodle_page" : "moodle_assign"),
    parentSection: "Homework Submission Folder",
    sourceGroup: "homework_submission_folder",
    unit: parsed?.unit,
    lesson: parsed?.lesson,
    teacherOnly: role === "homework_answer_page" ? true : item.teacherOnly,
    label: displayLabel(item),
    title: item.title || displayLabel(item)
  };
}

function sortHomeworkItems(items) {
  return [...items].sort((a, b) => {
    const pa = parseUnitLesson(displayLabel(a)) || { unit: 999, lesson: 999 };
    const pb = parseUnitLesson(displayLabel(b)) || { unit: 999, lesson: 999 };
    if (pa.unit !== pb.unit) return pa.unit - pb.unit;
    if (pa.lesson !== pb.lesson) return pa.lesson - pb.lesson;
    const aa = isHomeworkAnswer(displayLabel(a)) ? 1 : 0;
    const ab = isHomeworkAnswer(displayLabel(b)) ? 1 : 0;
    return aa - ab;
  });
}

function htmlTextPreview(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

function parseFileRows(activityRelPath, html) {
  const rows = [];
  const rowRe = /<div class="file-row">([\s\S]*?)<\/div><\/div>/gi;
  let match;
  while ((match = rowRe.exec(html))) {
    const row = match[1];
    const labelMatch = row.match(/<div class="file-label">([\s\S]*?)<\/div>/i);
    const label = labelMatch ? labelMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const hrefs = [...row.matchAll(/<a[^>]+href="([^"]+)"[^>]*>(View|Download)<\/a>/gi)]
      .map((hrefMatch) => ({ href: hrefMatch[1], action: hrefMatch[2].toLowerCase() }));
    const downloadHref = hrefs.find((href) => href.action === "download")?.href || hrefs.at(-1)?.href;
    const viewHref = hrefs.find((href) => href.action === "view")?.href || downloadHref;
    if (!label || !downloadHref) continue;
    const downloadPath = normalizeSlash(path.posix.join(path.posix.dirname(activityRelPath), decodeURIComponent(downloadHref)));
    const previewPath = viewHref?.startsWith("../../../")
      ? normalizeSlash(decodeURIComponent(viewHref.replace(/^\.\.\/\.\.\/\.\.\//, "")))
      : normalizeSlash(path.posix.join(path.posix.dirname(activityRelPath), decodeURIComponent(viewHref || downloadHref)));
    const ext = path.extname(label).replace(/^\./, "").toLowerCase() || "file";
    rows.push({
      label,
      title: label,
      type: ext,
      role: "attachment",
      path: downloadPath,
      downloadPath,
      previewPath,
      bytes: fs.existsSync(path.join(courseRoot, downloadPath)) ? bytes(downloadPath) : undefined
    });
  }
  return rows;
}

function rebuildHomeworkItemsFromLocalizedActivities() {
  const assignRoot = path.join(courseRoot, "localized-moodle-activities", "assign");
  const pageRoot = path.join(courseRoot, "localized-moodle-activities", "page");
  const submissions = fs.readdirSync(assignRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.match(/^assign-(\d+)-Unit-(\d+)-Lesson-(\d+)$/i))
    .filter(Boolean)
    .map((match) => ({ id: match[1], unit: Number(match[2]), lesson: Number(match[3]), dir: path.join(assignRoot, match.input) }));
  const answers = fs.existsSync(pageRoot)
    ? fs.readdirSync(pageRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.match(/^page-(\d+)-Unit-(\d+)-Lesson-(\d+)-Answer$/i))
      .filter(Boolean)
      .map((match) => ({ id: match[1], unit: Number(match[2]), lesson: Number(match[3]), dir: path.join(pageRoot, match.input) }))
    : [];
  const answerByKey = new Map(answers.map((answer) => [`${answer.unit}:${answer.lesson}`, answer]));
  const items = [];
  const missing = [];
  for (const submission of submissions) {
    const label = `Unit ${submission.unit} - Lesson ${submission.lesson}`;
    const index = path.join(submission.dir, "index.html");
    const activityPath = relPath(index);
    const html = fs.readFileSync(index, "utf8");
    items.push({
      id: `sbi3u-homework-u${String(submission.unit).padStart(2, "0")}l${String(submission.lesson).padStart(2, "0")}`,
      label,
      title: label,
      type: "html",
      role: "homework_submission_page",
      category: "moodle_assign",
      parentSection: "Homework Submission Folder",
      sourceGroup: "homework_submission_folder",
      unit: submission.unit,
      lesson: submission.lesson,
      path: activityPath,
      previewPath: activityPath,
      bytes: bytes(activityPath),
      source: `http://34.30.231.58/mod/assign/view.php?id=${submission.id}`,
      textPreview: htmlTextPreview(html),
      attachments: parseFileRows(activityPath, html)
    });
    const answer = answerByKey.get(`${submission.unit}:${submission.lesson}`);
    if (!answer) {
      missing.push({ unit: submission.unit, lesson: submission.lesson, label });
      continue;
    }
    const answerLabel = `${label} (Answer)`;
    const answerIndex = path.join(answer.dir, "index.html");
    const answerPath = relPath(answerIndex);
    const answerHtml = fs.readFileSync(answerIndex, "utf8");
    items.push({
      id: `sbi3u-homework-u${String(answer.unit).padStart(2, "0")}l${String(answer.lesson).padStart(2, "0")}-answer`,
      label: answerLabel,
      title: answerLabel,
      type: "html",
      role: "homework_answer_page",
      category: "moodle_page",
      parentSection: "Homework Submission Folder",
      sourceGroup: "homework_submission_folder",
      unit: answer.unit,
      lesson: answer.lesson,
      teacherOnly: true,
      path: answerPath,
      previewPath: answerPath,
      bytes: bytes(answerPath),
      source: `http://34.30.231.58/mod/page/view.php?id=${answer.id}`,
      textPreview: htmlTextPreview(answerHtml),
      attachments: parseFileRows(answerPath, answerHtml)
    });
  }
  return { items: sortHomeworkItems(items), missing };
}

function writeSourcesMd(curriculumEntry) {
  const textbookBytes = bytes(textbookPath);
  const curriculumBytes = curriculumEntry?.bytes || bytes(curriculumEntry.path);
  const content = `# SBI3U Text And Source Audit

This SBI3U package uses resources localized from the St. Mary Moodle course shell, local files extracted from Moodle activities/books, local iSpring/H5P packages, and the official Ontario curriculum reference listed below.

## Textbook Name

- Display title: ${textbookTitle}
- Original title: McGraw-Hill Ryerson Biology 11.
- Publisher: McGraw-Hill Ryerson.
- Student text ISBN: 0-07-088708-X.
- Course match: SBI3U Biology, Grade 11, University Preparation.

## Textbook Status

A legally obtained Biology 11 textbook PDF was provided by the user and is included in the course package.

- Source file: \`docs/McGraw-Hill-Ryerson-Biology-11.pdf\`
- Local courseware path: \`${textbookPath}\`
- Size: ${textbookBytes} bytes

Biology 12 files remain excluded because they do not match SBI3U.

## Included

- St. Mary Moodle course page: http://34.30.231.58/course/view.php?id=35
- Moodle section/activity resources, including Course Introduction, Course Outline, Learning Log, Lab report template, Writing Formal Lab Reports, final/culminating resources, unit lessons, iSpring packages, H5P packages, assignments, homework, and teacher answer resources where available.
- ${curriculumEntry?.title || "The Ontario Curriculum, Grades 11 and 12: Science, 2008 (Revised)"}, from the Ontario Ministry of Education.

## Official Curriculum

- Local path: \`${curriculumEntry?.path || "texts/ontario-curriculum/2009science11_12.pdf"}\`
- Size: ${curriculumBytes} bytes
- Public source: https://www.edu.gov.on.ca/eng/curriculum/secondary/2009science11_12.pdf
- Notes: This official document includes Biology, Grade 11, University Preparation (SBI3U) curriculum expectations.

## Structure Notes

- Homework Submission Folder lesson pages and matching \`(Answer)\` pages are displayed together in course-level Homework Submission Folder records, not in Teacher Packet.
- Teacher Packet contains only verified teacher-facing Answer Keys material.
- No missing homework answer page was generated where Moodle did not expose a matching source activity.
`;
  fs.writeFileSync(path.join(courseRoot, sourceAuditPath), content);
}

const manifest = readJson(manifestPath);
const units = (manifest.units || []).map((unit) => Number(unit.unit)).filter(Number.isFinite);
const teacherResourcesBefore = manifest.teacherResources?.length || 0;
const existingHomeworkItems = sortHomeworkItems((manifest.courseDownloads || []).filter(isHomeworkSubmissionRecord).map(withLocalBytes));

const curriculumEntry = (manifest.texts || []).find((text) => text.role === "curriculum_reference" || text.type === "curriculum");
const sourceAuditEntry = (manifest.texts || []).find((text) => text.id === "sbi3u-source-audit");
const oldTextbook = (manifest.texts || []).find((text) => text.id === oldTextbookId || normalizeSlash(text.path) === textbookPath);

if (!oldTextbook) {
  throw new Error("Missing SBI3U textbook entry to normalize.");
}
if (!fs.existsSync(path.join(courseRoot, textbookPath))) {
  throw new Error(`Missing textbook file: ${textbookPath}`);
}

const textbookBytes = bytes(textbookPath);
const referenceBytes = fs.existsSync(path.join(courseRoot, textbookReferencePath)) ? bytes(textbookReferencePath) : undefined;
const sourceAuditBytesBefore = fs.existsSync(path.join(courseRoot, sourceAuditPath)) ? bytes(sourceAuditPath) : undefined;

const textbookEntry = {
  ...oldTextbook,
  id: textbookId,
  title: textbookTitle,
  publisher: "McGraw-Hill Ryerson",
  type: "textbook",
  units,
  copyrightStatus: "user_provided_legal_copy",
  sourceStatus: "localized_from_user_provided_source",
  notes: "Core SBI3U textbook for Biology, Grade 11, University Preparation. User confirmed the PDF was legally obtained.",
  path: textbookPath,
  previewPath: textbookPath,
  downloadPath: textbookPath,
  bytes: textbookBytes,
  category: "textbook",
  role: "core_textbook",
  materials: [
    {
      label: textbookTitle,
      type: "pdf",
      category: "textbook",
      role: "core_textbook",
      path: textbookPath,
      previewPath: textbookPath,
      downloadPath: textbookPath,
      bytes: textbookBytes,
      source: "local legally obtained file provided by user: docs/McGraw-Hill-Ryerson-Biology-11.pdf",
      textPreview: "Legally obtained local copy of the SBI3U Biology 11 textbook."
    },
    ...(referenceBytes ? [{
      label: "SBI3U Biology 11 Textbook Reference",
      type: "html",
      category: "textbook_reference",
      role: "textbook_reference",
      path: textbookReferencePath,
      previewPath: textbookReferencePath,
      bytes: referenceBytes,
      source: "local source audit based on Moodle review and public bibliographic references",
      textPreview: "Records the SBI3U textbook name and confirms the legally obtained textbook PDF included in this package."
    }] : [])
  ]
};

manifest.texts = [
  ...(curriculumEntry ? [curriculumEntry] : []),
  {
    ...(sourceAuditEntry || {}),
    id: "sbi3u-source-audit",
    title: "SBI3U Text And Source Audit",
    type: "source_audit",
    units,
    copyrightStatus: "local_audit_note",
    sourceStatus: "created_from_local_source_review",
    notes: "Records Moodle source, textbook status, official curriculum inclusion, and structure normalization decisions.",
    path: sourceAuditPath,
    category: "source_audit",
    role: "source_audit",
    downloadPath: sourceAuditPath,
    materials: [
      {
        label: "SBI3U Text And Source Audit",
        type: "md",
        category: "source_audit",
        role: "source_audit",
        path: sourceAuditPath,
        downloadPath: sourceAuditPath,
        bytes: sourceAuditBytesBefore || 0,
        source: "local source audit"
      }
    ]
  },
  textbookEntry,
  ...(manifest.texts || []).filter((text) => ![
    oldTextbookId,
    textbookId,
    "ontario-science-curriculum-11-12",
    "sbi3u-source-audit"
  ].includes(text.id))
];

const homeworkItems = [];
const missingPartners = [];
for (const unit of manifest.units || []) {
  unit.coreTexts = [textbookId];
  const dropboxes = unit.unitResources?.lessonDropboxes || [];
  const answers = unit.unitResources?.answerPages || [];
  const answerByLabel = new Map(answers.map((item) => [displayLabel(item), item]));
  for (const dropbox of dropboxes) {
    const label = displayLabel(dropbox);
    if (!isHomeworkLesson(label)) continue;
    homeworkItems.push(cloneHomeworkItem(dropbox, "homework_submission_page"));
    const answerLabel = `${label} (Answer)`;
    const answer = answerByLabel.get(answerLabel);
    if (answer) {
      homeworkItems.push(cloneHomeworkItem(answer, "homework_answer_page"));
    } else {
      const parsed = parseUnitLesson(label);
      missingPartners.push({ unit: parsed?.unit || unit.unit, lesson: parsed?.lesson, label });
    }
  }
  if (unit.unitResources) {
    delete unit.unitResources.lessonDropboxes;
    delete unit.unitResources.answerPages;
  }
}

const sortedHomeworkItems = sortHomeworkItems(homeworkItems);
const rebuiltHomework = sortedHomeworkItems.length
  ? { items: sortedHomeworkItems, missing: missingPartners }
  : (existingHomeworkItems.length ? { items: existingHomeworkItems, missing: missingHomeworkPartnersFromItems(existingHomeworkItems) } : rebuildHomeworkItemsFromLocalizedActivities());
const existingDownloads = (manifest.courseDownloads || []).filter((item) => {
  if (isEmptyFinalSubmissionShell(item)) return false;
  if (isHomeworkSubmissionRecord(item)) return false;
  if (item.id === oldTextbookId || item.textId === oldTextbookId) return false;
  if (normalizeSlash(item.path) === textbookPath) return false;
  if (/McGraw-Hill Ryerson Biology 11/i.test(displayLabel(item))) return false;
  return true;
});

const textbookDownload = {
  label: textbookTitle,
  title: textbookTitle,
  type: "pdf",
  role: "core_textbook",
  category: "textbook",
  textId: textbookId,
  path: textbookPath,
  previewPath: textbookPath,
  downloadPath: textbookPath,
  bytes: textbookBytes,
  source: "local legally obtained file provided by user: docs/McGraw-Hill-Ryerson-Biology-11.pdf"
};

let insertAt = existingDownloads.findIndex((item) => item.role === "curriculum_reference");
if (insertAt === -1) insertAt = existingDownloads.findIndex((item) => item.role === "source_audit");
if (insertAt === -1) insertAt = existingDownloads.length;
existingDownloads.splice(insertAt + 1, 0, textbookDownload);
manifest.courseDownloads = [...existingDownloads, ...rebuiltHomework.items];

manifest.evaluations = (manifest.evaluations || []).filter((item) => !isEmptyFinalSubmissionShell(item));

manifest.teacherResources = (manifest.teacherResources || [])
  .filter((item) => {
    const label = displayLabel(item);
    if (isHomeworkSubmissionRecord(item)) return false;
    if (item.role === "evaluation") return false;
    if (item.role === "final_exam" || item.role === "culminating_assignment") return false;
    return true;
  })
  .map((item) => displayLabel(item) === "Answer Keys" ? {
    ...item,
    role: "teacher_packet",
    sourceGroup: "teacher_packet",
    parentSection: "Teacher Packet",
    teacherOnly: true
  } : item);

writeSourcesMd(curriculumEntry);
const sourceAuditBytes = bytes(sourceAuditPath);
for (const text of manifest.texts || []) {
  if (text.id === "sbi3u-source-audit") {
    text.bytes = sourceAuditBytes;
    text.materials = (text.materials || []).map((material) => ({
      ...material,
      bytes: sourceAuditBytes
    }));
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.mdm4uStructureRepair = {
  patchedAt: new Date().toISOString(),
  standard: "docs/MOODLE_COURSE_IMPORT_DISPLAY_RULES.md; MDM4U course-manifest baseline; St.Mary section 0 exception",
  teacherResourcesBefore,
  teacherResourcesAfter: manifest.teacherResources.length,
  homeworkSubmissionItemsAddedToCourseDownloads: rebuiltHomework.items.length,
  missingHomeworkAnswerPartners: rebuiltHomework.missing,
  removedEmptyFinalSubmissionShells: ["Culminating", "Final Exam Dropbox"],
  textbookId,
  textbookTitle,
  note: "Normalized SBI3U teacher/homework/textbook ownership without changing localized teaching content. Homework lesson/answer pages now display in Homework Submission Folder and no longer pollute Teacher Packet."
};
manifest.sourceAudit.textbookReference = {
  patchedAt: new Date().toISOString(),
  textbookId,
  textbookTitle,
  textbookPath,
  source: "User-provided legal local copy: docs/McGraw-Hill-Ryerson-Biology-11.pdf",
  sourceStatus: "localized_from_user_provided_source",
  evidence: "SBI3U Text And Source Audit records McGraw-Hill Ryerson Biology 11 as the Biology 11 course text and user-provided legal PDF exists in courseware.",
  officialCurriculum: curriculumEntry ? {
    id: curriculumEntry.id,
    title: curriculumEntry.title,
    path: curriculumEntry.path,
    source: curriculumEntry.materials?.[0]?.source || "https://www.edu.gov.on.ca/eng/curriculum/secondary/2009science11_12.pdf",
    sourceStatus: curriculumEntry.sourceStatus
  } : undefined,
  sourceAuditPath
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  teacherResources: manifest.teacherResources.map((item) => ({
    label: item.label,
    role: item.role,
    attachments: item.attachments?.length || 0
  })),
  homeworkCourseDownloads: sortedHomeworkItems.length,
  rebuiltHomeworkCourseDownloads: rebuiltHomework.items.length,
  missingPartners: rebuiltHomework.missing,
  textbookTitle,
  unitCoreTexts: (manifest.units || []).map((unit) => ({ unit: unit.unit, coreTexts: unit.coreTexts }))
}, null, 2));
