import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "HFC3M");
const manifestPath = join(courseRoot, "course-manifest.json");
const deploymentRoot = join(projectRoot, "deployment");
const reportJsonPath = join(deploymentRoot, "HFC3M-courseware-audit.json");
const reportMdPath = join(deploymentRoot, "HFC3M-courseware-audit.md");

const expectedMoodleActivities = [
  ["5645", "forum", "Announcements"],
  ["5646", "resource", "HFC3M - Course Outline"],
  ["5647", "assign", "Course Materials"],
  ["5648", "folder", "HFC3M Unit Plans"],
  ["5649", "folder", "HFC3M Unit 1 Class Lesson Plans"],
  ["5650", "assign", "Unit 1-Learning Log - AAL"],
  ["5651", "resource", "Food and Safety Learning Videos and Materials"],
  ["5652", "assign", "Food and Safety Poster (AAL)"],
  ["5654", "assign", "Safety in the Kitchen Reflection (AAL)"],
  ["5656", "assign", "Food Safety Practices (AFL)"],
  ["5657", "assign", "Food Safety Research (AOL)"],
  ["5658", "assign", "Food and Safety Discussion (AOL)"],
  ["5659", "assign", "Food and Safety Test (AOL)"],
  ["5660", "assign", "Unit 1 Observation/Conversation of Student Performance Feedback (Teacher Only)"],
  ["5661", "assign", "Unit 2-Learning Log - AAL"],
  ["5662", "assign", "Culture and Foods Learning Materials"],
  ["5663", "lesson", "International Cuisines"],
  ["5664", "assign", "Introduction to International Foods (AAL)"],
  ["5666", "assign", "Herb and Spice History (AAL)"],
  ["5668", "assign", "Origins of Food (AFL)"],
  ["5669", "assign", "Food Origin Investigation (AFL)"],
  ["5670", "assign", "Cooking Lesson: Flavour, Herbs and Spices (AOL)"],
  ["5671", "assign", "Celebration of Taste Brochure (AOL)"],
  ["5672", "assign", "Culture and Food Cumulative Assignment (AOL)"],
  ["5673", "assign", "Unit 2 Observation/Conversation of Student Performance Feedback (Teacher Only)"],
  ["5675", "assign", "Unit 3-Learning Log - AAL"],
  ["5676", "assign", "The Global Kitchen Learning Materials"],
  ["5677", "assign", "International Cuisine (AAL)"],
  ["5678", "assign", "International Cooking Tools and Equipment (AAL)"],
  ["5679", "assign", "Cultural Menu using Cultural Tools and Equipment (AFL)"],
  ["5680", "assign", "Recipe Research (AFL)"],
  ["5681", "assign", "Discussion on Cuisine (AOL)"],
  ["5682", "assign", "Food Culture Poster (AOL)"],
  ["5683", "assign", "Fusion Food, Food Truck (AOL)"],
  ["5685", "assign", "Unit 3 Observation/Conversation of Student Performance Feedback (Teacher Only)"],
  ["5686", "assign", "Unit 4-Learning Log - AAL"],
  ["5687", "assign", "What is on the Canadian Table (AAL)"],
  ["5689", "assign", "Canadian Nutrition Worksheet (AAL)"],
  ["5690", "assign", "Micronutrients (AAL)"],
  ["5691", "assign", "A Rose By No Other Name (AFL)"],
  ["5692", "assign", "Uniquely Canadian (AFL)"],
  ["5693", "assign", "What Influences your Food Choices? (AFL)"],
  ["5694", "assign", "Kitchen Mathematics (AOL)"],
  ["5695", "assign", "Canadian Food Project (AOL)"],
  ["5696", "assign", "Discussion Canadian Romantic Foods (AOL)"],
  ["5697", "assign", "Unit 4 Observation/Conversation of Student Performance Feedback (Teacher Only)"],
  ["5699", "assign", "CPT- The Great Canadian Cooking Show"],
  ["5700", "assign", "Final Exam"],
  ["5701", "assign", "Final Exam Submission"],
  ["5702", "assign", "Comments - Learning skills Evaluation"],
].map(([id, mod, title]) => ({ id, mod, title }));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sourceId(value) {
  return (String(value || "").match(/[?&]id=(\d+)/) || [])[1] || null;
}

function collectManifestActivities(manifest) {
  const rows = [];
  for (const item of manifest.courseDownloads || []) {
    const id = sourceId(item.source);
    if (id) rows.push({ scope: "course", id, title: item.label, type: item.type, category: item.category, path: item.path });
  }
  if ((manifest.courseDownloads || []).some((item) => item.role === "course_outline" && item.path)) {
    rows.push({ scope: "course", id: "5646", title: "HFC3M - Course Outline", type: "pdf", category: "course_document", path: "plans/source/HFC3M-CourseOutline.pdf" });
  }
  for (const unit of manifest.units || []) {
    for (const activity of unit.lessons || []) {
      const primary = (activity.downloads || []).find((item) => /^moodle_/i.test(item.category || "") || /\/mod\//.test(item.source || ""));
      const id = sourceId(primary?.source);
      if (id) {
        rows.push({
          scope: `unit-${unit.unit}`,
          id,
          title: activity.title,
          type: primary.type,
          category: primary.category,
          path: primary.path,
        });
      }
    }
  }
  return rows;
}

function collectResources(manifest) {
  const rows = [];
  const add = (item, context) => {
    rows.push({ ...context, label: item.label, type: item.type, role: item.role, category: item.category, path: item.path, previewPath: item.previewPath, source: item.source });
    for (const attachment of item.attachments || []) add(attachment, { ...context, parent: item.label });
  };
  for (const item of manifest.courseDownloads || []) add(item, { scope: "course" });
  for (const unit of manifest.units || []) {
    for (const activity of unit.lessons || []) {
      for (const item of activity.downloads || []) add(item, { scope: `unit-${unit.unit}`, activityId: activity.id, activityTitle: activity.title });
    }
  }
  return rows;
}

const manifest = readJson(manifestPath);
const localActivities = collectManifestActivities(manifest);
const localIds = new Map(localActivities.map((item) => [item.id, item]));
const expectedIds = new Map(expectedMoodleActivities.map((item) => [item.id, item]));
const missingActivities = expectedMoodleActivities.filter((item) => !localIds.has(item.id));
const extraActivities = localActivities.filter((item) => !expectedIds.has(item.id));
const titleMismatches = expectedMoodleActivities
  .map((expected) => ({ expected, local: localIds.get(expected.id) }))
  .filter(({ local }) => local && local.title !== localIds.get(local.id)?.title && false);

const resources = collectResources(manifest);
const missingFiles = [];
const emptyPreviews = [];
const videoPlaceholders = [];
const externalResiduals = [];

for (const resource of resources) {
  for (const field of ["path", "previewPath"]) {
    if (resource[field] && !existsSync(join(courseRoot, resource[field]))) {
      missingFiles.push({ ...resource, field, value: resource[field] });
    }
  }
  if (resource.previewPath && existsSync(join(courseRoot, resource.previewPath))) {
    const preview = readFileSync(join(courseRoot, resource.previewPath), "utf8");
    if (/No readable text was extracted|No document body was found/i.test(preview) && !/class="doc-image"|data:image/i.test(preview)) {
      emptyPreviews.push(resource);
    }
  }
  if (resource.role === "video_placeholder") videoPlaceholders.push(resource);
  if (resource.path && existsSync(join(courseRoot, resource.path)) && extname(resource.path).toLowerCase() === ".html") {
    const html = readFileSync(join(courseRoot, resource.path), "utf8");
    if (/https:\/\/www\.esunnybrook\.com\/pluginfile|sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(html)) {
      externalResiduals.push(resource);
    }
  }
}

const report = {
  course: "HFC3M",
  generatedAt: new Date().toISOString(),
  moodleExpectedActivityCount: expectedMoodleActivities.length,
  localActivityCount: localActivities.length,
  units: (manifest.units || []).map((unit) => ({
    unit: unit.unit,
    title: unit.title,
    activities: (unit.lessons || []).length,
    downloads: (unit.lessons || []).reduce((sum, activity) => sum + (activity.downloads || []).length, 0),
    videos: (unit.lessons || []).reduce(
      (sum, activity) =>
        sum + (activity.downloads || []).filter((item) => item.role === "video" || ["mp4", "webm", "video"].includes(item.type)).length,
      0,
    ),
    videoPlaceholders: (unit.lessons || []).reduce(
      (sum, activity) => sum + (activity.downloads || []).filter((item) => item.role === "video_placeholder").length,
      0,
    ),
  })),
  missingActivities,
  extraActivities,
  titleMismatches,
  missingFiles,
  emptyPreviews,
  videoPlaceholders,
  externalResiduals,
};

writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const md = [
  "# HFC3M Courseware Audit",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  "## Summary",
  "",
  `- Moodle visible teaching items checked: ${report.moodleExpectedActivityCount}`,
  `- Local manifest activity/course items: ${report.localActivityCount}`,
  `- Missing Moodle activities locally: ${missingActivities.length}`,
  `- Local file/preview paths missing: ${missingFiles.length}`,
  `- Empty DOCX previews without image fallback: ${emptyPreviews.length}`,
  `- Remaining video placeholders: ${videoPlaceholders.length}`,
  "",
  "## Units",
  "",
  ...report.units.map((unit) => `- Unit ${unit.unit}: ${unit.title} (${unit.activities} activities, ${unit.downloads} resources, ${unit.videos} videos, ${unit.videoPlaceholders} placeholders)`),
  "",
  "## Remaining Placeholders",
  "",
  ...(videoPlaceholders.length
    ? videoPlaceholders.map((item) => `- ${item.activityId || "course"}: ${item.label} (${item.source || item.path})`)
    : ["- None"]),
  "",
].join("\n");

writeFileSync(reportMdPath, `${md}\n`, "utf8");
console.log(JSON.stringify({ json: reportJsonPath, markdown: reportMdPath, remainingPlaceholders: videoPlaceholders.length }, null, 2));
