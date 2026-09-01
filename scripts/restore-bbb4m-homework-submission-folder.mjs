import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BBB4M");
const manifestPath = join(courseRoot, "course-manifest.json");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function walkHtml(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.isFile() && entry.name.toLowerCase() === "index.html") out.push(full);
  }
  return out;
}

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromHtml(html, fallback) {
  return (
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ||
    fallback
  );
}

function parseUnitLesson(value) {
  const match = String(value || "").match(/Unit-(\d+)---Lesson-(\d+)/i) || String(value || "").match(/Unit\s*(\d+)\s*-\s*Lesson\s*(\d+)/i);
  return {
    unit: Number(match?.[1] || 0),
    lesson: Number(match?.[2] || 0),
  };
}

function typeForPath(path) {
  const ext = extname(path).replace(".", "").toLowerCase();
  if (ext === "htm") return "html";
  return ext || "file";
}

function courseRelativeFromHref(pageRel, href) {
  if (!href || /^https?:\/\//i.test(href)) return "";
  const decoded = href.split("#")[0].split("?")[0];
  return toPosix(posix.normalize(posix.join(posix.dirname(toPosix(pageRel)), decoded)));
}

function parseAttachments(html, pageRel) {
  const attachments = [];
  const rowPattern = /<li>\s*<span class="file-label">([\s\S]*?)<\/span>\s*<span class="file-actions">([\s\S]*?)<\/span>\s*<\/li>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const label = stripTags(match[1]);
    const actions = match[2];
    const hrefs = [...actions.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map((hrefMatch) => hrefMatch[1]);
    const viewHref = hrefs[0] || "";
    const downloadHref = hrefs[hrefs.length - 1] || viewHref;
    const path = courseRelativeFromHref(pageRel, downloadHref);
    if (!label || !path) continue;
    const recoveredPath = !existsSync(join(courseRoot, path)) && /\.docx$/i.test(label) && existsSync(join(courseRoot, `${path}docx`))
      ? `${path}docx`
      : path;
    const previewPath = viewHref && viewHref !== downloadHref ? courseRelativeFromHref(pageRel, viewHref) : "";
    const fullPath = join(courseRoot, recoveredPath);
    const attachment = {
      label,
      type: typeForPath(recoveredPath),
      category: "localized_moodle_attachment",
      role: "attachment",
      path: recoveredPath,
      bytes: existsSync(fullPath) ? statSync(fullPath).size : 0,
    };
    if (previewPath && existsSync(join(courseRoot, previewPath))) attachment.previewPath = previewPath;
    attachments.push(attachment);
  }
  return attachments;
}

function makeResource(htmlPath) {
  const pageRel = toPosix(relative(courseRoot, htmlPath));
  const html = readFileSync(htmlPath, "utf8");
  const dirName = toPosix(dirname(pageRel));
  const { unit, lesson } = parseUnitLesson(dirName);
  if (!unit || !lesson) return null;
  const isAnswer = /-Answer$/i.test(dirName) || /\(Answer\)/i.test(titleFromHtml(html, ""));
  const label = titleFromHtml(html, `Unit ${unit} - Lesson ${lesson}${isAnswer ? " (Answer)" : ""}`)
    .replace(/^Unit\s+(\d+)\s+-\s+Lesson\s+(\d+)\s+Answer$/i, "Unit $1 - Lesson $2 (Answer)");
  return {
    label,
    type: "html",
    category: pageRel.includes("/page/") ? "moodle_page" : "moodle_assign",
    role: isAnswer ? "homework_answer_page" : "homework_submission_page",
    path: pageRel,
    bytes: statSync(htmlPath).size,
    teacherUse: isAnswer ? "homework_answer_reference" : "student_submission",
    ...(isAnswer ? { teacherOnly: true } : {}),
    attachments: parseAttachments(html, pageRel),
    textPreview: stripTags(html).slice(0, 500),
    parentSection: "Homework Submission Folder",
    sourceGroup: "homework_submission_folder",
    unit,
    lesson,
  };
}

function sortHomework(a, b) {
  if (a.unit !== b.unit) return a.unit - b.unit;
  if (a.lesson !== b.lesson) return a.lesson - b.lesson;
  const aa = a.role === "homework_answer_page" ? 1 : 0;
  const ba = b.role === "homework_answer_page" ? 1 : 0;
  if (aa !== ba) return aa - ba;
  return a.label.localeCompare(b.label);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const htmlFiles = [
  ...walkHtml(join(courseRoot, "localized-moodle-activities", "assign")),
  ...walkHtml(join(courseRoot, "localized-moodle-activities", "page")),
];
const homework = htmlFiles
  .filter((file) => /(?:assign|page)-\d+-Unit-\d+---Lesson-\d+(?:-Answer)?[\\/]index\.html$/i.test(file))
  .map(makeResource)
  .filter(Boolean)
  .sort(sortHomework);

const existingNonHomework = (manifest.courseDownloads || []).filter(
  (item) => item.parentSection !== "Homework Submission Folder" && item.sourceGroup !== "homework_submission_folder",
);
manifest.courseDownloads = [...existingNonHomework, ...homework];
manifest.sourceAudit ||= {};
manifest.sourceAudit.homeworkSubmissionFolderRestore = {
  restoredAt: new Date().toISOString(),
  restored: homework.length,
  submissionPages: homework.filter((item) => item.role === "homework_submission_page").length,
  answerPages: homework.filter((item) => item.role === "homework_answer_page").length,
  note: "Restored Homework Submission Folder records from localized Moodle assign/page HTML after a non-idempotent repair script removed existing courseDownloads entries.",
};
manifest.generatedAt = new Date().toISOString();

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify(manifest.sourceAudit.homeworkSubmissionFolderRestore, null, 2));
