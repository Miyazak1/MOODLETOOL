import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ENG3U");
const manifestPath = join(courseRoot, "course-manifest.json");

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<section\b[^>]*class=["'][^"']*\battachments\b[^"']*["'][\s\S]*?<\/section>/gi, " ")
      .replace(/<a\b[^>]*href=["']files\/[^"']*["'][\s\S]*?<\/a>/gi, " ")
      .replace(/<h1\b[\s\S]*?<\/h1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\b(?:Opened|Due):\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[^.]+?(?=\s[A-Z]|\s*$)/gi, " ")
    .replace(/\b(?:Grade|Grading summary|Make a submission|Hidden from students|Mark as done)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textPreviewForHtml(path, label) {
  const abs = join(courseRoot, path);
  if (!existsSync(abs)) return "";
  let text = stripTags(readFileSync(abs, "utf8"));
  const normalizedLabel = String(label || "").replace(/\s+/g, " ").trim();
  if (normalizedLabel && text.toLowerCase().startsWith(normalizedLabel.toLowerCase())) {
    text = text.slice(normalizedLabel.length).trim();
  }
  return text.length >= 80 ? text.slice(0, 500) : "";
}

function walkResources(value, visit) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkResources(item, visit));
    return;
  }
  if (typeof value !== "object") return;
  if ("label" in value) {
    visit(value);
    for (const attachment of value.attachments || []) walkResources(attachment, visit);
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let withText = 0;
let fileOnly = 0;

const collections = [
  manifest.courseDownloads,
  manifest.courseSections,
  manifest.evaluations,
  manifest.teacherResources,
  ...(manifest.units || []).flatMap((unit) => [
    unit.unitPlan,
    ...Object.values(unit.unitResources || {}),
    ...(unit.lessons || []).flatMap((lesson) => [lesson.lessonPlan, lesson.downloads, lesson.bookSections, lesson.textExports]),
  ]),
];

for (const collection of collections) {
  walkResources(collection, (item) => {
    const category = String(item.category || "").toLowerCase();
    if (!item.path || item.type !== "html" || !category.startsWith("moodle_") || category === "moodle_course_section") return;
    if (!(item.attachments || []).length) return;
    const preview = textPreviewForHtml(item.path, item.label);
    if (preview) {
      item.textPreview = preview;
      withText += 1;
    } else {
      delete item.textPreview;
      fileOnly += 1;
    }
  });
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`ENG3U activity text previews synced: with text ${withText}, file-only ${fileOnly}.`);
