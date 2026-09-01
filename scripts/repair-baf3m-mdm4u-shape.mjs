import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const COURSE = "BAF3M";
const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE_ROOT = resolve(WORKSPACE_ROOT, "courseware", COURSE);
const MANIFEST_PATH = join(COURSE_ROOT, "course-manifest.json");
const CURRICULUM_REL = "texts/ontario-business-studies-curriculum-11-12/business1112currb.pdf";
const SOURCES_REL = "texts/SOURCES.md";
const OVERVIEW_ISPRING_REL = "ispring-localized/unit-00/course-overview/presentation.html";
const OVERVIEW_ISPRING_PACKAGE_REL = "ispring-localized/unit-00/course-overview";
const OVERVIEW_ISPRING_SOURCE = "https://hexstruct.ispring.com/s/embed_player/38fb0d93-d44a-11ed-8863-3a9a83d567ea";
const CURRICULUM_SOURCE = "https://www.edu.gov.on.ca/eng/curriculum/secondary/business1112currb.pdf";
const SECTION0_REL = "course-sections/course-starter-resources/index.html";
const TEACHER_PACKET_ACTIVITY_REL = "localized-moodle-activities/assign/assign-11071-Answer-Keys/index.html";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel)))
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/'/g, "%27"))
    .join("/");
}

function fileBytes(relPath) {
  const abs = join(COURSE_ROOT, relPath);
  return existsSync(abs) ? statSync(abs).size : 0;
}

function compactText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function eachResource(manifest, callback) {
  for (const item of manifest.courseDownloads || []) callback(item);
  for (const section of manifest.courseSections || []) callback(section);
  for (const item of manifest.teacherResources || []) callback(item);
  for (const item of manifest.evaluations || []) callback(item);
  for (const text of manifest.texts || []) {
    callback(text);
    for (const material of text.materials || []) callback(material);
  }
  for (const unit of manifest.units || []) {
    callback(unit.unitPlan);
    for (const resource of Object.values(unit.unitResources || {})) {
      if (Array.isArray(resource)) resource.forEach(callback);
      else callback(resource);
    }
    for (const lesson of unit.lessons || []) {
      callback(lesson.lessonPlan);
      for (const item of lesson.lessonText || []) callback(item);
      for (const item of lesson.textExports || []) callback(item);
      for (const item of lesson.downloads || []) callback(item);
      for (const item of lesson.ispring || []) callback(item);
      for (const item of lesson.h5p || []) callback(item);
      for (const item of lesson.bookSections || []) callback(item);
    }
  }
}

function dedupeByPath(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = item?.path || item?.downloadPath || item?.previewPath || item?.label;
    if (!item || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function lessonNumber(label) {
  const match = String(label || "").match(/\bLesson\s+(\d+)\b/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function sortByLessonNumber(items) {
  return [...(items || [])].sort((a, b) => lessonNumber(a.label) - lessonNumber(b.label) || String(a.label || "").localeCompare(String(b.label || "")));
}

function backfillPreviewPaths(manifest) {
  let updated = 0;
  const officeExts = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
  eachResource(manifest, (item) => {
    if (!item?.path || !officeExts.has(extname(item.path).toLowerCase())) return;
    const previewRel = `previews-html/${toPosix(item.path)}.html`;
    if (!existsSync(join(COURSE_ROOT, previewRel))) return;
    if (item.previewPath !== previewRel) {
      item.previewPath = previewRel;
      updated += 1;
    }
  });
  return updated;
}

function renderFileRow(item, pageRel) {
  const viewPath = item.previewPath || item.path;
  const downloadPath = item.downloadPath || item.path;
  const viewButton = viewPath ? `<a class="button" href="${htmlEscape(relativeHref(pageRel, viewPath), true)}">View</a>` : "";
  const downloadButton = downloadPath ? `<a class="button" href="${htmlEscape(relativeHref(pageRel, downloadPath), true)}" download>Download</a>` : "";
  return `<div class="file-row"><div class="file-label">${htmlEscape(item.label)}</div><div class="actions">${viewButton}${downloadButton}</div></div>`;
}

function renderMdmActivityAttachmentList(attachments, pageRel) {
  if (!attachments?.length) return "";
  const rows = attachments.map((item) => {
    const href = htmlEscape(relativeHref(pageRel, item.path || item.downloadPath), true);
    return `<li><span class="file-label">${htmlEscape(item.label || item.path)}</span><span class="file-actions"><a class="file-action" href="${href}">查看</a><a class="file-action" href="${href}" download>下载</a></span></li>`;
  }).join("");
  return `<section class="attachments"><h2>Files</h2><ul>${rows}</ul></section>`;
}

function renderMdmActivityPage(title, bodyHtml, attachments, pageRel) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    h2 { font-size: 20px; margin-top: 24px; }
    img, video, iframe { max-width: 100%; height: auto; }
    a { color: #00396f; font-weight: 700; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .file-label { overflow-wrap: anywhere; }
    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }
    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }
    .file-action:hover { background: #eef6ff; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${bodyHtml || ""}
      ${renderMdmActivityAttachmentList(attachments, pageRel)}
    </article>
  </main>
</body>
</html>
`;
}

function renderSimplePage(title, bodyHtml, attachments, pageRel) {
  const files = attachments?.length
    ? `<section class="files"><h2>Files</h2>${attachments.map((item) => renderFileRow(item, pageRel)).join("")}</section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; max-width: 100%; }
    .localized-ispring { border: 0; display: block; height: min(72vh, 760px); margin: 16px 0; width: 100%; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(title)}</h1>
    <article class="content">${bodyHtml}</article>
    ${files}
  </main>
</body>
</html>
`;
}

function repairTeacherResources(manifest) {
  const before = manifest.teacherResources?.length || 0;
  manifest.teacherResources = dedupeByPath((manifest.teacherResources || [])
    .filter((item) => {
      const scope = `${item?.parentSection || ""} ${item?.sourceGroup || ""} ${item?.role || ""}`.toLowerCase();
      const isTeacherPacket = /teacher[\s_-]*packet/.test(scope) || item?.moodleActivityId === "11071" || /Answer Keys/i.test(item?.label || "");
      if (isTeacherPacket) return true;
      if (isNumberedLessonActivity(item) || isNumberedLessonAnswerActivity(item)) return false;
      if (item?.role === "answer_key" || /\bAnswer\b/i.test(item?.label || "")) return false;
      return /teacher[\s_-]*packet/.test(scope) || item?.teacherOnly === true;
    })
    .map((item) => ({
      ...item,
      role: item.role || "teacher_resource",
      category: item.category || "teacher_packet",
      parentSection: "Teacher Packet",
      sourceGroup: "teacher_packet",
      teacherOnly: true,
    })));
  return before - manifest.teacherResources.length;
}

function ensureCourseIntroduction(manifest) {
  const path = SECTION0_REL;
  const existing = (manifest.courseSections || []).find((item) => item?.role === "introduction" || item?.path === path);
  if (!existsSync(join(COURSE_ROOT, path))) return Boolean(existing);
  const section = existing || {
    label: "Course Introduction",
    type: "html",
    category: "course_document",
    role: "introduction",
    path,
    source: "http://34.30.231.58/course/view.php?id=73",
    attachments: [],
  };
  section.label = "Course Introduction";
  section.role = "introduction";
  section.category = "course_document";
  section.type = "html";
  section.path = path;
  section.bytes = fileBytes(path);
  section.source = section.source || "http://34.30.231.58/course/view.php?id=73";
  section.textPreview = section.textPreview || "This course introduces students to the fundamental principles and procedures of accounting.";
  manifest.courseSections = [
    section,
    ...(manifest.courseSections || []).filter((item) => item !== existing && item?.role !== "teacher_packet" && item?.path !== path),
  ];
  return true;
}

function ensureTeacherPacketAnswerKeys(manifest) {
  manifest.courseSections = (manifest.courseSections || []).filter((item) => item?.role !== "teacher_packet");
  if (!existsSync(join(COURSE_ROOT, TEACHER_PACKET_ACTIVITY_REL))) return false;
  const body = [
    "<h2>Answer Keys</h2>",
    "<p>The St.Mary Moodle Teacher Packet activity is present, but its assignment download area reports: <strong>Nothing has been submitted for this assignment.</strong></p>",
    "<p>Worksheet answer documents are preserved in the Homework Submission Folder as the individual Unit X - Lesson Y (Answer) pages.</p>",
  ].join("\n");
  const pageHtml = renderSimplePage("Answer Keys", body, [], TEACHER_PACKET_ACTIVITY_REL);
  writeFileSync(join(COURSE_ROOT, TEACHER_PACKET_ACTIVITY_REL), pageHtml, "utf8");
  const existing = (manifest.teacherResources || []).find((item) => item?.moodleActivityId === "11071" || item?.path === TEACHER_PACKET_ACTIVITY_REL);
  const item = existing || {
    label: "Answer Keys",
    type: "html",
    category: "moodle_assign",
    role: "teacher_packet",
    path: TEACHER_PACKET_ACTIVITY_REL,
    source: "http://34.30.231.58/mod/assign/view.php?id=11071",
    moodleActivityId: "11071",
    mod: "assign",
    attachments: [],
  };
  item.label = "Answer Keys";
  item.role = "teacher_packet";
  item.parentSection = "Teacher Packet";
  item.sourceGroup = "teacher_packet";
  item.teacherOnly = true;
  item.teacherUse = "teacher_reference";
  item.bytes = fileBytes(item.path);
  item.textPreview = "Teacher Packet / Answer Keys activity from the St.Mary Moodle source. Download all submissions reports: Nothing has been submitted for this assignment. Worksheet answer documents are preserved in the Homework Submission Folder as individual Unit X - Lesson Y (Answer) pages.";
  manifest.teacherResources = dedupeByPath([
    ...(manifest.teacherResources || []).filter((resource) => resource !== existing),
    item,
  ]);
  return true;
}

function repairUnitResourceOrder(manifest) {
  let changed = 0;
  for (const unit of manifest.units || []) {
    const resources = unit.unitResources || {};
    for (const key of ["lessonDropboxes", "answerPages"]) {
      const before = JSON.stringify(resources[key] || []);
      resources[key] = sortByLessonNumber(resources[key] || []);
      if (JSON.stringify(resources[key] || []) !== before) changed += 1;
    }
  }
  return changed;
}

function isNumberedLessonActivity(item) {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+$/i.test(String(item?.label || "").trim());
}

function isNumberedLessonAnswerActivity(item) {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+\s*\(Answer\)$/i.test(String(item?.label || "").trim());
}

function parseUnitLesson(item) {
  const match = String(item?.label || "").match(/^Unit\s+(\d+)\s*-\s*Lesson\s+(\d+)/i);
  return {
    unit: Number(item?.unit || match?.[1] || 0),
    lesson: Number(item?.lesson || match?.[2] || 0),
  };
}

function homeworkResource(item) {
  const position = parseUnitLesson(item);
  const answer = isNumberedLessonAnswerActivity(item);
  const normalized = {
    ...item,
    role: answer ? "homework_answer_page" : "homework_submission_page",
    teacherUse: answer ? "homework_answer_reference" : "student_submission",
    parentSection: "Homework Submission Folder",
    sourceGroup: "homework_submission_folder",
    unit: position.unit || item.unit,
    lesson: position.lesson || item.lesson,
    teacherOnly: answer ? true : item.teacherOnly,
  };
  return normalized;
}

function repairHomeworkSubmissionFolder(manifest) {
  const homework = [];
  for (const item of manifest.courseDownloads || []) {
    if (item.parentSection === "Homework Submission Folder" || item.sourceGroup === "homework_submission_folder" || isNumberedLessonActivity(item) || isNumberedLessonAnswerActivity(item)) {
      homework.push(homeworkResource(item));
    }
  }
  for (const unit of manifest.units || []) {
    const resources = unit.unitResources || {};
    for (const item of resources.lessonDropboxes || []) homework.push(homeworkResource(item));
    for (const item of resources.answerPages || []) homework.push(homeworkResource(item));
    resources.lessonDropboxes = [];
    resources.answerPages = [];
  }
  const existing = (manifest.courseDownloads || []).filter((item) => {
    if (isNumberedLessonActivity(item) || isNumberedLessonAnswerActivity(item)) return false;
    return item.parentSection !== "Homework Submission Folder" && item.sourceGroup !== "homework_submission_folder";
  });
  const sortedHomework = sortByLessonNumber(homework).sort((a, b) => {
    const left = parseUnitLesson(a);
    const right = parseUnitLesson(b);
    return left.unit - right.unit || left.lesson - right.lesson || (isNumberedLessonAnswerActivity(a) ? 1 : 0) - (isNumberedLessonAnswerActivity(b) ? 1 : 0);
  });
  manifest.courseDownloads = [...existing, ...dedupeByPath(sortedHomework)];
  return sortedHomework.length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractArticleContent(html) {
  return /<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i.exec(String(html || ""))?.[1]
    || /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(String(html || ""))?.[1]
    || String(html || "");
}

function extractMdmHomeworkBody(html) {
  const article = extractArticleContent(html);
  const noOverflow = /<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*)<\/div>\s*<\/div>\s*$/i.exec(article)?.[1]
    || /<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(article)?.[1]
    || article;
  return noOverflow
    .replace(/<h3><strong[^>]*>\s*<h3><strong>(Basic Submission Procedure:)<\/strong><\/h3>\s*<\/strong>\s*<\/h3>/gi, "<h3><strong>$1</strong></h3>")
    .replace(/<h3><strong>\s*<h3><strong>(Basic Submission Procedure:)<\/strong><\/h3>\s*<\/strong>\s*<\/h3>/gi, "<h3><strong>$1</strong></h3>")
    .trim();
}

function relinkAttachmentHrefs(bodyHtml, pageRel, attachments) {
  let out = String(bodyHtml || "");
  for (const attachment of attachments || []) {
    const path = toPosix(attachment.path || attachment.downloadPath || "");
    if (!path) continue;
    const basename = posix.basename(path);
    const encodedBasename = basename.split("/").map(encodeURIComponent).join("/");
    const target = relativeHref(pageRel, path);
    for (const name of [basename, encodedBasename]) {
      out = out.replace(new RegExp(`href=(["'])[^"']*${escapeRegExp(name)}\\1`, "gi"), `href="${htmlEscape(target, true)}"`);
    }
  }
  return out;
}

function copyHomeworkAttachmentToActivity(item, attachment) {
  if (!item?.path || !attachment?.path) return attachment;
  const activityDir = posix.dirname(toPosix(item.path));
  const fileName = posix.basename(toPosix(attachment.path));
  const targetRel = `${activityDir}/files/${fileName}`;
  const sourceAbs = join(COURSE_ROOT, attachment.path);
  const targetAbs = join(COURSE_ROOT, targetRel);
  if (existsSync(sourceAbs)) {
    mkdirSync(dirname(targetAbs), { recursive: true });
    copyFileSync(sourceAbs, targetAbs);
  }
  const normalized = {
    ...attachment,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: targetRel,
    downloadPath: targetRel,
    bytes: fileBytes(targetRel) || attachment.bytes,
  };
  if (attachment.previewPath && toPosix(attachment.previewPath) === toPosix(attachment.path)) {
    normalized.previewPath = targetRel;
  } else if (attachment.previewPath) {
    normalized.previewPath = attachment.previewPath;
  }
  return normalized;
}

function findHomeworkBookSection(manifest, unitNo, lessonNo) {
  const unit = (manifest.units || []).find((item) => Number(item.unit) === Number(unitNo));
  const lesson = (unit?.lessons || []).find((item) => Number(item.lesson) === Number(lessonNo));
  return (lesson?.bookSections || []).find((section) => String(section.sectionLabel || "").toLowerCase() === "homework");
}

function syncHomeworkSubmissionPages(manifest) {
  let updated = 0;
  for (const item of manifest.courseDownloads || []) {
    if (item.role !== "homework_submission_page") continue;
    const position = parseUnitLesson(item);
    const homeworkSection = findHomeworkBookSection(manifest, position.unit, position.lesson);
    if (!homeworkSection?.path) continue;
    const sectionHtmlPath = join(COURSE_ROOT, homeworkSection.path);
    if (!existsSync(sectionHtmlPath)) continue;
    item.attachments = dedupeByPath((homeworkSection.attachments || []).map((attachment) => copyHomeworkAttachmentToActivity(item, attachment)));
    const sectionHtml = readFileSync(sectionHtmlPath, "utf8");
    const body = relinkAttachmentHrefs(extractMdmHomeworkBody(sectionHtml), item.path, item.attachments);
    const html = renderMdmActivityPage(item.label, body, item.attachments, item.path);
    writeFileSync(join(COURSE_ROOT, item.path), html, "utf8");
    item.bytes = Buffer.byteLength(html, "utf8");
    item.textPreview = compactText(body);
    updated += 1;
  }
  return updated;
}

function syncHomeworkAnswerPages(manifest) {
  let updated = 0;
  for (const item of manifest.courseDownloads || []) {
    if (item.role !== "homework_answer_page" || !item.path) continue;
    const abs = join(COURSE_ROOT, item.path);
    if (!existsSync(abs)) continue;
    const firstAttachment = item.attachments?.[0];
    const href = firstAttachment?.path ? relativeHref(item.path, firstAttachment.path) : "";
    const body = href
      ? `<p>Please click&nbsp;<a href="${htmlEscape(href, true)}" target="_blank" rel="noopener">HERE</a> to view the answers from the previous activity.</p>`
      : "<p>Please use the attached answer file for this activity.</p>";
    const nextHtml = renderMdmActivityPage(item.label, body, item.attachments || [], item.path);
    writeFileSync(abs, nextHtml, "utf8");
    item.bytes = Buffer.byteLength(nextHtml, "utf8");
    item.textPreview = compactText(body);
    updated += 1;
  }
  return updated;
}

function learningLogAttachments() {
  const base = "localized-moodle-activities/assign/assign-10949-Learning-Log/files";
  const pdfRel = `${base}/d8fd11dd0e-Learning%20Log-Sample%20v1.0.pdf`;
  const docxRel = `${base}/e48715535f-Learning%20Log.docx`;
  return [
    {
      label: "Learning Log-Sample v1.0.pdf",
      type: "pdf",
      category: "moodle_file",
      role: "attachment",
      path: pdfRel,
      bytes: fileBytes(pdfRel),
      source: "http://34.30.231.58/pluginfile.php/12065/mod_assign/introattachment/0/Learning%20Log-Sample%20v1.0.pdf?forcedownload=1",
      downloadPath: pdfRel,
      previewPath: pdfRel,
    },
    {
      label: "Learning Log.docx",
      type: "docx",
      category: "moodle_file",
      role: "attachment",
      path: docxRel,
      bytes: fileBytes(docxRel),
      source: "http://34.30.231.58/pluginfile.php/12065/mod_assign/introattachment/0/Learning%20Log.docx?forcedownload=1",
      downloadPath: docxRel,
    },
  ].filter((item) => existsSync(join(COURSE_ROOT, item.path)));
}

function repairLearningLog(manifest) {
  const item = (manifest.courseDownloads || []).find((entry) => entry?.role === "learning_log" || entry?.moodleActivityId === "10949");
  if (!item?.path) return { attachments: 0, pageWritten: false };
  const attachments = learningLogAttachments();
  item.attachments = dedupeByPath([...(item.attachments || []), ...attachments]);
  const body = `<h2>Learning Log</h2><p>After each unit, the student must submit a learning log to track the hours spent on assignments. The learning log is to provide learning accountability from the student and to help the student develop a good study routine. Attached you will find a sample learning log filled out.</p>`;
  const html = renderSimplePage("Learning Log", body, item.attachments, item.path);
  writeFileSync(join(COURSE_ROOT, item.path), html, "utf8");
  item.bytes = Buffer.byteLength(html, "utf8");
  item.textPreview = compactText(body);
  return { attachments: item.attachments.length, pageWritten: true };
}

function repairCourseOutline(manifest) {
  const item = (manifest.courseDownloads || []).find((entry) => entry?.role === "course_outline" || entry?.moodleActivityId === "10948");
  if (!item) return false;
  const body = `<h2>BAF3M Course Outline</h2><p>In the course outline, you will find the specific and overall expectations, forms of assessments AAL, AFL and AOL. In the document, you will also come across the course breakdown and accommodations for students with learning needs. Students and educators should review the course outline to become familiar with the expectations and grading criteria.</p>`;
  if (item.path) {
    const html = renderSimplePage("BAF3M Course Outline", body, item.attachments || [], item.path);
    writeFileSync(join(COURSE_ROOT, item.path), html, "utf8");
    item.bytes = Buffer.byteLength(html, "utf8");
  }
  item.textPreview = String(item.textPreview || "")
    .replace(/\s*BAF3M Course Outline\.docx\s+\d{1,2}\s+\w+\s+\d{4},\s+\d{1,2}:\d{2}\s+(?:AM|PM)\s*$/i, "")
    .trim();
  if (!item.textPreview) item.textPreview = compactText(body);
  return true;
}

function repairCourseOverview(manifest) {
  const overview = (manifest.courseSections || []).find((item) => item?.role === "course_overview" || item?.label === "Course Overview");
  if (!overview?.path || !existsSync(join(COURSE_ROOT, OVERVIEW_ISPRING_REL))) return false;
  const gif = (overview.attachments || []).find((item) => item.type === "gif" || /\.gif$/i.test(item.path || ""));
  const hero = gif ? `<figure class="overview-hero"><img src="${htmlEscape(relativeHref(overview.path, gif.previewPath || gif.path), true)}" alt="Course overview"></figure>` : "";
  const body = `${hero}
      <section class="overview-block">
        <h2>Course Overview Presentation</h2>
        <iframe class="localized-ispring" src="${htmlEscape(relativeHref(overview.path, OVERVIEW_ISPRING_REL), true)}" loading="lazy" allowfullscreen></iframe>
      </section>
      <section class="overview-block">
        <h2>BAF3M Course Outline</h2>
        <p>In the course outline, you will find the specific and overall expectations, forms of assessments AAL, AFL and AOL. Students and educators should review the course outline to become familiar with the expectations and grading criteria.</p>
      </section>
      <section class="overview-block">
        <h2>Learning Log</h2>
        <p>After each unit, the student must submit a learning log to track the hours spent on assignments and support learning accountability.</p>
      </section>`;
  const html = renderSimplePage("Course Overview", body, overview.attachments || [], overview.path);
  writeFileSync(join(COURSE_ROOT, overview.path), html, "utf8");
  overview.bytes = Buffer.byteLength(html, "utf8");
  overview.textPreview = compactText(body);
  overview.ispring = [
    {
      label: "BAF3M Course Overview iSpring",
      type: "ispring",
      category: "ispring",
      role: "course_overview_ispring",
      mode: "page",
      path: OVERVIEW_ISPRING_REL,
      packagePath: OVERVIEW_ISPRING_PACKAGE_REL,
      bytes: fileBytes(OVERVIEW_ISPRING_REL),
      source: OVERVIEW_ISPRING_SOURCE,
    },
  ];
  overview.packagePath = OVERVIEW_ISPRING_PACKAGE_REL;
  return true;
}

function readH5pTitle(id) {
  const dir = `${String(id).padStart(4, "0")}-title`;
  const h5pJsonPath = join(COURSE_ROOT, "localized-moodle", "h5p-external", dir, "h5p.json");
  if (!existsSync(h5pJsonPath)) return `H5P activity ${id}`;
  try {
    const h5p = JSON.parse(readFileSync(h5pJsonPath, "utf8"));
    return h5p.title || `H5P activity ${id}`;
  } catch {
    return `H5P activity ${id}`;
  }
}

function h5pPackageRel(id) {
  const dir = `${String(id).padStart(4, "0")}-title`;
  const direct = `localized-moodle/h5p-external/${dir}.h5p`;
  return existsSync(join(COURSE_ROOT, direct)) ? direct : "";
}

function h5pPreviewRel(id) {
  const dir = `${String(id).padStart(4, "0")}-title`;
  const rel = `localized-moodle/h5p-external/${dir}/index.html`;
  return existsSync(join(COURSE_ROOT, rel)) ? rel : "";
}

function h5pIdsFromRaw(unitNo, lessonNo, sectionIndex) {
  const rawPath = join(REPO_ROOT, "inbox", `moodle-book-raw-${COURSE}-U${String(unitNo).padStart(2, "0")}.json`);
  if (!existsSync(rawPath)) return [];
  const raw = readJson(rawPath);
  const rawLesson = (raw.lessons || []).find((item) => Number(item.lesson) === Number(lessonNo));
  const rawSection = (rawLesson?.sections || []).find((item) => Number(item.sectionIndex) === Number(sectionIndex));
  const html = String(rawSection?.page?.html || "").replaceAll("&amp;", "&");
  return [...html.matchAll(/welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed&id=(\d+)/gi)].map((match) => match[1]);
}

function sectionFileFolder(section) {
  const filename = toPosix(section?.path || "").split("/").pop() || "";
  return filename.replace(/\.html$/i, "");
}

function syncBookSectionOwnedResources(manifest) {
  let sectionFileAttachments = 0;
  let sectionH5pAttachments = 0;
  let lessonH5pDownloads = 0;
  for (const unit of manifest.units || []) {
    let unitH5p = 0;
    for (const lesson of unit.lessons || []) {
      lesson.downloads = dedupeByPath(lesson.downloads || []);
      const h5pByKey = new Map((lesson.h5p || []).map((item) => [`${item.h5pId || ""}|${item.ownerPath || ""}`, item]));

      for (const section of lesson.bookSections || []) {
        const folder = sectionFileFolder(section);
        const ownedFiles = (lesson.downloads || []).filter((item) => {
          if (isPlayableOnlyManifestResource(item)) return false;
          const path = toPosix(item.path || item.downloadPath || "");
          return folder && path.includes(`/book_sections/files/${folder}/`);
        });
        const ownedH5p = [];
        for (const id of h5pIdsFromRaw(unit.unit, lesson.lesson, section.sectionIndex)) {
          const record = h5pByKey.get(`${id}|${section.path}`) || (lesson.h5p || []).find((item) => String(item.h5pId || "") === String(id));
          if (record) ownedH5p.push(record);
        }
        section.attachments = dedupeByPath([...(section.attachments || []), ...ownedFiles, ...ownedH5p]);
        sectionFileAttachments += ownedFiles.length;
        sectionH5pAttachments += ownedH5p.length;
      }

      const h5pDownloads = (lesson.h5p || []).map((item) => ({
        ...item,
        role: item.role || "lesson_h5p",
        category: item.category || "localized_external_h5p",
      }));
      const beforeDownloads = lesson.downloads.length;
      lesson.downloads = dedupeByPath([...lesson.downloads, ...h5pDownloads]);
      lessonH5pDownloads += lesson.downloads.length - beforeDownloads;
      unitH5p += h5pDownloads.length;
      lesson.resourceCounts ||= {};
      lesson.resourceCounts.h5p = h5pDownloads.length;
      lesson.resourceCounts.downloads = (lesson.downloads || []).length;
    }
    unit.summary ||= {};
    unit.summary.h5p = unitH5p;
    unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
  }
  return { sectionFileAttachments, sectionH5pAttachments, lessonH5pDownloads };
}

function isPlayableOnlyManifestResource(item) {
  const type = String(item?.type || "").toLowerCase();
  const category = String(item?.category || "").toLowerCase();
  const path = `${item?.path || ""} ${item?.previewPath || ""} ${item?.downloadPath || ""}`.toLowerCase();
  return type === "h5p" || type === "ispring" || type === "video" || category.includes("h5p") || category.includes("ispring") || path.includes("/h5p-");
}

function repairH5pManifestRecords(manifest) {
  let expected = 0;
  let localized = 0;
  const missing = [];
  const uniqueIds = new Set();
  for (const unit of manifest.units || []) {
    let unitH5p = 0;
    for (const lesson of unit.lessons || []) {
      const lessonRecords = [];
      for (const section of lesson.bookSections || []) {
        const ids = h5pIdsFromRaw(unit.unit, lesson.lesson, section.sectionIndex);
        expected += ids.length;
        for (const id of ids) {
          uniqueIds.add(id);
          const previewPath = h5pPreviewRel(id);
          const path = h5pPackageRel(id);
          if (!previewPath || !path) {
            missing.push({ unit: unit.unit, lesson: lesson.lesson, section: section.sectionLabel, id });
            continue;
          }
          localized += 1;
          lessonRecords.push({
            label: readH5pTitle(id),
            type: "h5p",
            category: "localized_external_h5p",
            role: "lesson_h5p",
            path,
            previewPath,
            downloadPath: path,
            bytes: fileBytes(path),
            source: `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`,
            h5pId: id,
            unit: unit.unit,
            lesson: lesson.lesson,
            sectionLabel: section.sectionLabel,
            ownerPath: section.path,
          });
        }
      }
      lesson.h5p = dedupeByPath(lessonRecords);
      lesson.resourceCounts ||= {};
      lesson.resourceCounts.h5p = lesson.h5p.length;
      unitH5p += lesson.h5p.length;
    }
    unit.summary ||= {};
    unit.summary.h5p = unitH5p;
  }
  const ownership = syncBookSectionOwnedResources(manifest);
  return { expected, localized, uniqueLocalized: uniqueIds.size - new Set(missing.map((item) => item.id)).size, missing, ownership };
}

function ensureTextResources(manifest) {
  mkdirSync(join(COURSE_ROOT, "texts"), { recursive: true });
  const sources = `# BAF3M Text And Source Audit

- Official curriculum: The Ontario Curriculum, Grades 11 and 12: Business Studies, 2006 (Revised), Ontario Ministry of Education.
- BAF3M appears in the official curriculum as Financial Accounting Fundamentals, Grade 11, University/College Preparation.
- Local curriculum file: ${CURRICULUM_REL}
- Moodle source: http://34.30.231.58/course/view.php?id=73
- Course structure: new Moodle course with four units and 25 Moodle book lessons.
- Textbook status: no separate full-course textbook package was exposed in the localized Moodle source. Lesson handouts, worksheets, chapter materials, iSpring packages, and H5P activities are retained under their owning Moodle pages.
- H5P status: local H5P packages under localized-moodle/h5p-external are linked back to their Moodle book sections when the package is available locally.
`;
  writeFileSync(join(COURSE_ROOT, SOURCES_REL), sources, "utf8");

  const units = (manifest.units || []).map((unit) => unit.unit);
  const textEntries = [];
  if (existsSync(join(COURSE_ROOT, CURRICULUM_REL))) {
    const bytes = fileBytes(CURRICULUM_REL);
    textEntries.push({
      id: "ontario-business-studies-curriculum-11-12",
      title: "The Ontario Curriculum, Grades 11 and 12: Business Studies, 2006 (Revised)",
      publisher: "Ontario Ministry of Education",
      author: "Ontario Ministry of Education",
      type: "curriculum",
      units,
      copyrightStatus: "official_public_document",
      sourceStatus: "localized_from_public_official_source",
      notes: "Official Ontario curriculum reference containing BAF3M Financial Accounting Fundamentals, Grade 11, University/College Preparation.",
      materials: [
        {
          label: "The Ontario Curriculum, Grades 11 and 12: Business Studies, 2006 (Revised)",
          type: "pdf",
          category: "official_curriculum",
          role: "curriculum_reference",
          path: CURRICULUM_REL,
          bytes,
          source: CURRICULUM_SOURCE,
          previewPath: CURRICULUM_REL,
        },
      ],
      path: CURRICULUM_REL,
      bytes,
      category: "official_curriculum",
      role: "curriculum_reference",
    });
  }
  textEntries.push({
    id: "baf3m-source-audit",
    title: "BAF3M Text And Source Audit",
    type: "source_audit",
    units,
    copyrightStatus: "local_audit_note",
    sourceStatus: "created_from_local_source_review",
    notes: "Records official curriculum availability and the absence of a separate exposed full-course textbook package.",
    materials: [
      {
        label: "BAF3M Text And Source Audit",
        type: "md",
        category: "source_audit",
        role: "source_audit",
        path: SOURCES_REL,
        bytes: fileBytes(SOURCES_REL),
        source: "local source audit",
      },
    ],
    path: SOURCES_REL,
    bytes: fileBytes(SOURCES_REL),
    category: "source_audit",
    role: "source_audit",
  });
  const keep = (manifest.texts || []).filter((item) => !["ontario-business-studies-curriculum-11-12", "baf3m-source-audit"].includes(item.id));
  manifest.texts = [...keep, ...textEntries];

  const downloadsByRole = new Set(["curriculum_reference", "source_audit"]);
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => !downloadsByRole.has(item.role));
  for (const text of textEntries) {
    for (const material of text.materials || []) {
      manifest.courseDownloads.push({ ...material, label: text.title });
    }
  }
  return textEntries.length;
}

function repairOverviewIspringPackageRefs() {
  const root = join(COURSE_ROOT, OVERVIEW_ISPRING_PACKAGE_REL);
  const cssFonts = join(root, "css", "fonts");
  const cssRes = join(root, "css", "res");
  let ensured = 0;
  if (existsSync(cssFonts)) {
    const target = join(root, "fonts");
    mkdirSync(target, { recursive: true });
    for (const file of readdirSync(cssFonts, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const source = join(cssFonts, file.name);
      const dest = join(target, file.name);
      if (!existsSync(dest)) {
        writeFileSync(dest, readFileSync(source));
        ensured += 1;
      }
    }
  }
  if (existsSync(cssRes)) {
    const target = join(root, "res");
    mkdirSync(target, { recursive: true });
    for (const file of readdirSync(cssRes, { withFileTypes: true })) {
      if (!file.isFile()) continue;
      const source = join(cssRes, file.name);
      const dest = join(target, file.name);
      if (!existsSync(dest)) {
        writeFileSync(dest, readFileSync(source));
        ensured += 1;
      }
    }
  }
  return ensured;
}

function normalizeUnitResourceMetadata(manifest) {
  let updated = 0;
  const mark = (item, patch) => {
    if (!item) return;
    for (const [key, value] of Object.entries(patch)) {
      if (item[key] !== value) {
        item[key] = value;
        updated += 1;
      }
    }
  };

  for (const unit of manifest.units || []) {
    const resources = unit.unitResources || {};
    for (const item of resources.evaluations || []) {
      mark(item, {
        role: "evaluation",
        parentSection: "Evaluation",
        sourceGroup: "evaluation",
        unit: unit.unit,
      });
    }
    for (const item of resources.reflectionAndLogs || []) {
      const label = String(item?.label || "");
      const role = /KWL/i.test(label)
        ? "reflection_kwl"
        : /Reflection Summary/i.test(label)
          ? "reflection_summary"
          : "learning_log";
      mark(item, {
        role,
        parentSection: "Reflection / Learning Log",
        sourceGroup: "reflection_learning_log",
        unit: unit.unit,
      });
    }
  }
  return updated;
}

function rebuildEvaluationIndex(manifest) {
  const before = manifest.evaluations?.length || 0;
  const evaluations = [];
  for (const unit of manifest.units || []) {
    for (const item of unit.unitResources?.evaluations || []) {
      evaluations.push({
        ...item,
        role: "evaluation",
        parentSection: "Evaluation",
        sourceGroup: "evaluation",
        unit: unit.unit,
      });
    }
  }
  manifest.evaluations = dedupeByPath(evaluations);
  return { before, after: manifest.evaluations.length, removed: before - manifest.evaluations.length };
}

function removeStaleTeacherPacketCourseSection() {
  const staleRel = "course-sections/teacher-packet";
  const staleAbs = join(COURSE_ROOT, staleRel);
  if (!existsSync(staleAbs)) return false;
  rmSync(staleAbs, { recursive: true, force: true });
  return true;
}

function removeStaleCulminatingAssignPages() {
  const staleRels = [
    "localized-moodle-activities/assign/assign-11069-Culminating-1",
    "localized-moodle-activities/assign/assign-11070-Culminating-2",
  ];
  const removed = [];
  for (const staleRel of staleRels) {
    const staleAbs = join(COURSE_ROOT, staleRel);
    if (!existsSync(staleAbs)) continue;
    rmSync(staleAbs, { recursive: true, force: true });
    removed.push(staleRel);
  }
  return removed;
}

function updateAudit(manifest, report) {
  manifest.sourceAudit ||= {};
  manifest.sourceAudit.ispringComplete = Math.max(Number(manifest.sourceAudit.ispringComplete || 0), 26);
  manifest.sourceAudit.courseOverviewIspring = {
    source: OVERVIEW_ISPRING_SOURCE,
    path: OVERVIEW_ISPRING_REL,
    packagePath: OVERVIEW_ISPRING_PACKAGE_REL,
    localized: existsSync(join(COURSE_ROOT, OVERVIEW_ISPRING_REL)),
  };
  const introduction = (manifest.courseSections || []).find((item) => item?.role === "introduction");
  manifest.sourceAudit.section0 = {
    role: "Course Introduction",
    source: "http://34.30.231.58/course/view.php?id=73",
    localized: Boolean(introduction),
    path: introduction?.path || SECTION0_REL,
    attachments: introduction?.attachments?.length || 0,
    textPreview: introduction?.textPreview || "",
  };
  const teacherPacket = (manifest.teacherResources || []).find((item) => item?.moodleActivityId === "11071" || item?.sourceGroup === "teacher_packet");
  manifest.sourceAudit.teacherPacket = {
    sourceSection: 7,
    activityId: "11071",
    label: "Answer Keys",
    localized: Boolean(teacherPacket),
    path: teacherPacket?.path || TEACHER_PACKET_ACTIVITY_REL,
    attachments: teacherPacket?.attachments?.length || 0,
    note: "Only the source Teacher Packet Answer Keys activity is kept here; Homework Submission lesson/answer pages remain in Homework Submission Folder.",
  };
  manifest.sourceAudit.h5pExternalEmbedsExpected = report.h5p.expected;
  manifest.sourceAudit.h5pExternalEmbedsLocalized = report.h5p.localized;
  manifest.sourceAudit.h5pExternalUniqueLocalized = report.h5p.uniqueLocalized;
  manifest.sourceAudit.h5pExternalEmbedsPending = report.h5p.missing.length;
  manifest.sourceAudit.h5pExternalMissing = report.h5p.missing;
  manifest.sourceAudit.textbookStatus = "No separate full-course textbook package was exposed in the localized Moodle source.";
  manifest.sourceAudit.structureNote = "BAF3M normalized to the shared MDM4U field ownership rules: AOL remains in Unit Evaluation, teacherResources contains only teacher-facing answer keys, and course-level materials retain their owning pages and attachments.";
  manifest.sourceAudit.note = "Lesson iSpring and locally available external H5P packages are embedded from local courseware. External H5P records remain pending only when no local package exists.";
}

function collectReferencedPathPrefixes(manifest) {
  const prefixes = new Set();
  eachResource(manifest, (item) => {
    if (!item?.path) return;
    const parts = toPosix(item.path).split("/");
    if (parts.length >= 3 && parts[0] === "localized-moodle-activities" && parts[1] === "assign") {
      prefixes.add(parts.slice(0, 3).join("/"));
    }
  });
  return prefixes;
}

function quarantineStaleLegacyActivityDirs(manifest) {
  const assignRoot = join(COURSE_ROOT, "localized-moodle-activities", "assign");
  if (!existsSync(assignRoot)) return [];
  const referenced = collectReferencedPathPrefixes(manifest);
  const quarantineRoot = join(REPO_ROOT, "deployment", "BAF3M-stale-unreferenced-localized-activities");
  mkdirSync(quarantineRoot, { recursive: true });
  const moved = [];
  for (const entry of readdirSync(assignRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^U\d{2}L\d{2}-/i.test(entry.name)) continue;
    const rel = `localized-moodle-activities/assign/${entry.name}`;
    if (referenced.has(rel)) continue;
    const source = join(assignRoot, entry.name);
    const target = join(quarantineRoot, entry.name);
    if (existsSync(target)) continue;
    renameSync(source, target);
    moved.push(rel);
  }
  return moved;
}

const manifest = readJson(MANIFEST_PATH);
const report = {
  removedTeacherResourceEvaluations: repairTeacherResources(manifest),
  homeworkSubmissionFolderResources: repairHomeworkSubmissionFolder(manifest),
  homeworkSubmissionPagesSynced: 0,
  homeworkAnswerPagesSynced: 0,
  sortedUnitResourceGroups: repairUnitResourceOrder(manifest),
  courseOutlineCleaned: repairCourseOutline(manifest),
  learningLog: repairLearningLog(manifest),
  courseIntroduction: ensureCourseIntroduction(manifest),
  teacherPacketAnswerKeys: ensureTeacherPacketAnswerKeys(manifest),
  overviewIspringPatched: repairCourseOverview(manifest),
  overviewIspringRefsEnsured: repairOverviewIspringPackageRefs(),
  textEntries: ensureTextResources(manifest),
  unitResourceMetadataNormalized: 0,
  evaluationIndex: null,
  previewPathsBackfilled: 0,
  h5p: repairH5pManifestRecords(manifest),
  staleTeacherPacketCourseSectionRemoved: false,
  staleCulminatingAssignPagesRemoved: [],
  staleLegacyActivityDirsMoved: [],
};
report.homeworkSubmissionPagesSynced = syncHomeworkSubmissionPages(manifest);
report.homeworkAnswerPagesSynced = syncHomeworkAnswerPages(manifest);
report.unitResourceMetadataNormalized = normalizeUnitResourceMetadata(manifest);
report.evaluationIndex = rebuildEvaluationIndex(manifest);
report.previewPathsBackfilled = backfillPreviewPaths(manifest);
report.staleTeacherPacketCourseSectionRemoved = removeStaleTeacherPacketCourseSection();
report.staleCulminatingAssignPagesRemoved = removeStaleCulminatingAssignPages();
report.staleLegacyActivityDirsMoved = quarantineStaleLegacyActivityDirs(manifest);
updateAudit(manifest, report);
manifest.generatedAt = new Date().toISOString();
writeJson(MANIFEST_PATH, manifest);
writeFileSync(join(REPO_ROOT, "deployment", "BAF3M-mdm4u-shape-repair-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
