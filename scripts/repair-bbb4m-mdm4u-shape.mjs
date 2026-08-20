import { existsSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BBB4M";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const reportPath = join(projectRoot, "deployment", "BBB4M-mdm4u-shape-repair-report.json");
const badAttachmentPath = "localized-moodle-activities/assign/assign-7249-Unit-1---Lesson-1/files/0c3a1310bb-index.php";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function unitLessonKey(item) {
  const unit = Number(item.unit || String(item.label || item.title || item.path || "").match(/Unit\s*(\d+)/i)?.[1] || 0);
  const lesson = Number(item.lesson || String(item.label || item.title || item.path || "").match(/Lesson\s*(\d+)/i)?.[1] || 0);
  return { unit, lesson };
}

function isBadAttachment(item) {
  const haystack = `${item?.label || ""} ${item?.title || ""} ${item?.path || ""} ${item?.downloadPath || ""} ${item?.source || ""}`;
  return /0c3a1310bb-index\.php|(^|\s)index\.php(\s|$)|SBI4U%20-%20Unit%203%20-%20Lesson%201%20-%20DNA/i.test(haystack);
}

function cleanAttachments(item) {
  if (!item || typeof item !== "object") return 0;
  const before = item.attachments?.length || 0;
  if (Array.isArray(item.attachments)) item.attachments = item.attachments.filter((attachment) => !isBadAttachment(attachment));
  return before - (item.attachments?.length || 0);
}

function walkResourceArrays(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) walkResourceArrays(item, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;
  visitor(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") walkResourceArrays(child, visitor);
  }
}

function normalizeHomeworkItem(item, role) {
  const { unit, lesson } = unitLessonKey(item);
  const normalized = {
    ...item,
    type: item.type || "html",
    category: item.category || "moodle_assign",
    role,
    parentSection: "Homework Submission Folder",
    sourceGroup: "homework_submission_folder",
    unit,
    lesson,
  };
  if (role === "homework_submission_page") {
    normalized.teacherUse = "student_submission";
    delete normalized.teacherOnly;
  } else {
    normalized.teacherUse = "homework_answer_reference";
    normalized.teacherOnly = true;
  }
  cleanAttachments(normalized);
  return normalized;
}

function dedupeByPath(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.path || item.url || item.label;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function homeworkSort(a, b) {
  const au = Number(a.unit || 0);
  const bu = Number(b.unit || 0);
  if (au !== bu) return au - bu;
  const al = Number(a.lesson || 0);
  const bl = Number(b.lesson || 0);
  if (al !== bl) return al - bl;
  const aa = a.role === "homework_answer_page" ? 1 : 0;
  const ba = b.role === "homework_answer_page" ? 1 : 0;
  if (aa !== ba) return aa - ba;
  return String(a.label || "").localeCompare(String(b.label || ""));
}

function listHtmlFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listHtmlFiles(fullPath));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".html") files.push(fullPath);
  }
  return files;
}

function ensureFileActionCss(html) {
  if (/\.file-action\s*\{/.test(html) && /\.file-actions\s*\{/.test(html) && /\.file-label\s*\{/.test(html)) return html;
  const css = [
    "    .file-label { overflow-wrap: anywhere; }",
    "    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }",
    "    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }",
    "    .file-action:hover { background: #eef6ff; }",
  ].join("\n");
  if (/<\/style>/i.test(html)) return html.replace(/\s*<\/style>/i, `\n${css}\n  </style>`);
  return html.replace(/\s*<\/head>/i, `\n  <style>\n${css}\n  </style>\n</head>`);
}

function normalizeAttachmentHtml(html) {
  let next = html;
  next = next.replace(/\s*<li>\s*<span>index\.php<\/span>\s*<span>[\s\S]*?<\/span>\s*<\/li>/gi, "");
  next = next.replace(/\s*<li>\s*<span[^>]*>[^<]*index\.php[^<]*<\/span>\s*<span[^>]*>[\s\S]*?<\/span>\s*<\/li>/gi, "");
  next = next.replace(
    /<li>\s*<span>([^<]+)<\/span>\s*<span>\s*<a href="([^"]+)">View<\/a>\s*<a href="([^"]+)" download>Download<\/a>\s*<\/span>\s*<\/li>/g,
    '<li><span class="file-label">$1</span><span class="file-actions"><a class="file-action" href="$2">查看</a><a class="file-action" href="$3" download>下载</a></span></li>',
  );
  next = next.replace(
    /<li>\s*<span>([^<]+)<\/span>\s*<span>\s*<a href="([^"]+)">Download<\/a>\s*<\/span>\s*<\/li>/g,
    '<li><span class="file-label">$1</span><span class="file-actions"><a class="file-action" href="$2" download>下载</a></span></li>',
  );
  next = next.replace(
    /<li>\s*<span class="file-label">([^<]+)<\/span>\s*<span class="file-actions">\s*<a class="file-action" href="([^"]+)">View<\/a>\s*<a class="file-action" href="([^"]+)" download>Download<\/a>\s*<\/span>\s*<\/li>/g,
    '<li><span class="file-label">$1</span><span class="file-actions"><a class="file-action" href="$2">查看</a><a class="file-action" href="$3" download>下载</a></span></li>',
  );
  next = next.replace(/>View<\/a>/g, ">查看</a>").replace(/>Download<\/a>/g, ">下载</a>");
  if (/class="attachments"|class="file-actions"|class="file-action"/.test(next)) next = ensureFileActionCss(next);
  return next;
}

const manifest = readJson(manifestPath);
const report = {
  course,
  repairedAt: new Date().toISOString(),
  movedHomeworkSubmissionPages: 0,
  movedHomeworkAnswerPages: 0,
  removedTeacherResources: manifest.teacherResources?.length || 0,
  removedBadAttachments: 0,
  patchedHtmlFiles: [],
  deletedFiles: [],
};

const homeworkItems = [];
for (const unit of manifest.units || []) {
  unit.unitResources ||= {};
  for (const item of unit.unitResources.lessonDropboxes || []) {
    homeworkItems.push(normalizeHomeworkItem(item, "homework_submission_page"));
    report.movedHomeworkSubmissionPages += 1;
  }
  for (const item of unit.unitResources.answerPages || []) {
    homeworkItems.push(normalizeHomeworkItem(item, "homework_answer_page"));
    report.movedHomeworkAnswerPages += 1;
  }
  delete unit.unitResources.lessonDropboxes;
  delete unit.unitResources.answerPages;
}

walkResourceArrays(manifest, (item) => {
  report.removedBadAttachments += cleanAttachments(item);
});

if (homeworkItems.length) {
  const nonHomeworkDownloads = (manifest.courseDownloads || []).filter(
    (item) => item.parentSection !== "Homework Submission Folder" && item.sourceGroup !== "homework_submission_folder",
  );
  manifest.courseDownloads = dedupeByPath([...nonHomeworkDownloads, ...homeworkItems.sort(homeworkSort)]);
}
manifest.teacherResources = [];

manifest.sourceAudit ||= {};
manifest.sourceAudit.homeworkSubmissionFolderRepair = {
  patchedAt: report.repairedAt,
  standard: "MDM4U legacy esunnybrook shape",
  submissionPages: report.movedHomeworkSubmissionPages,
  answerPages: report.movedHomeworkAnswerPages,
  note: "Independent Moodle side-navigation activities named Unit X - Lesson Y and Unit X - Lesson Y (Answer) are Homework Submission Folder resources, paired in courseDownloads, not Teacher Packet.",
};
manifest.sourceAudit.teacherPacketRepair = {
  patchedAt: report.repairedAt,
  removedTeacherResources: report.removedTeacherResources,
  note: "Primary BBB4M source audit did not expose a verified Teacher Packet. Homework answer pages remain in Homework Submission Folder with teacher-only metadata instead of being promoted to Teacher Packet.",
};
manifest.sourceAudit.badAttachmentRepair = {
  patchedAt: report.repairedAt,
  removedAttachments: report.removedBadAttachments,
  note: "Removed stray index.php/SBI4U attachment from BBB4M Unit 1 Lesson 1 homework submission activity.",
};
manifest.generatedAt = report.repairedAt;

for (const htmlPath of [
  ...listHtmlFiles(join(courseRoot, "course-sections")),
  ...listHtmlFiles(join(courseRoot, "localized-moodle-activities")),
]) {
  const before = readFileSync(htmlPath, "utf8");
  const after = normalizeAttachmentHtml(before);
  if (after !== before) {
    writeFileSync(htmlPath, after, "utf8");
    report.patchedHtmlFiles.push(toPosix(relative(courseRoot, htmlPath)));
  }
}

const badFullPath = join(courseRoot, badAttachmentPath);
if (existsSync(badFullPath)) {
  const bytes = statSync(badFullPath).size;
  rmSync(badFullPath);
  report.deletedFiles.push({ path: badAttachmentPath, bytes });
}

writeJson(manifestPath, manifest);
writeJson(reportPath, report);

console.log(JSON.stringify(report, null, 2));
