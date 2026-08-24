import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MHF4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

const chemistryObjectivePatterns = [
  /<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*(?:<em>)?At the end of this lesson(?:\s+you)?(?:<\/em>)?\s+you will learn about the different atomic theories and experiments that led to the understanding of the atomic structure and components\.\s*<\/p>\s*/gi,
  /<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*(?:<em>)?At the end of this lesson you(?:<\/em>)?\s+learn about the different atomic theories and can critique and differentiate between the different atomic models\.\s*<\/p>\s*/gi,
  /<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*At the end of this lesson, you will learn about the concept of energy levels in shells and subshells and the rules for electron configurations\.\s*<\/p>\s*/gi,
  /<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*At the end of this lesson, you will learn how to write the electron configuration for any given element or ion using the rules for electron configurations\.\s*<\/p>\s*/gi,
  /<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*At the end of this lesson, you will learn about the bonds in ionic and molecular compounds using Lewis Dot Diagrams &amp; Structures and the octet rules\.\s*<\/p>\s*/gi,
  /<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*At the end of this lesson, you will learn if a molecule is polar or nonpolar using the valence shell electron pair repulsion \(VSEPR\)\.\s*<\/p>\s*/gi,
];

const previewPatterns = [
  /\s*At the end of this lesson you will learn about the different atomic theories and experiments that led to the understanding of the atomic structure and components\./gi,
  /\s*At the end of this lesson you learn about the different atomic theories and can critique and differentiate between the different atomic models\./gi,
  /\s*At the end of this lesson, you will learn about the concept of energy levels in shells and subshells and the rules for electron configurations\./gi,
  /\s*At the end of this lesson, you will learn how to write the electron configuration for any given element or ion using the rules for electron configurations\./gi,
  /\s*At the end of this lesson, you will learn about the bonds in ionic and molecular compounds using Lewis Dot Diagrams & Structures and the octet rules\./gi,
  /\s*At the end of this lesson, you will learn if a molecule is polar or nonpolar using the valence shell electron pair repulsion \(VSEPR\)\./gi,
];

const localVideoHrefPattern = /(<a\b[^>]*href=["'][^"']*localized-moodle\/video\/([^"']+)["'][^>]*>)https?:\/\/www\.esunnybrook\.com\/pluginfile\.php\/[^<]+(<\/a>)/gi;
const brokenTrigIconPattern = /<img\b[^>]*\balt=["']egg["'][^>]*\bsrc=["']https?:\/\/www\.esunnybrook\.com\/theme\/image\.php\/[^"']+["'][^>]*>/gi;
const previewExternalVideoPattern = /https?:\/\/www\.esunnybrook\.com\/pluginfile\.php\/\S*\/([^/?\s]+)(?:\?\S*)?/gi;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stripChemistryObjectives(html) {
  let next = String(html || "");
  for (const pattern of chemistryObjectivePatterns) next = next.replace(pattern, "");
  return next;
}

function cleanLocalizedDisplayHtml(html) {
  return stripChemistryObjectives(html)
    .replace(localVideoHrefPattern, (_, open, fileName, close) => `${open}${decodeURIComponent(fileName)}${close}`)
    .replace(brokenTrigIconPattern, "15 degrees");
}

function stripPreviewText(text) {
  let next = String(text || "");
  for (const pattern of previewPatterns) next = next.replace(pattern, "");
  return next
    .replace(previewExternalVideoPattern, (_, fileName) => decodeURIComponent(fileName))
    .replace(/\bsin\s+egg\b/gi, "sin 15 degrees")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function collectMissingAnswerWorksheets(manifest) {
  const gaps = [];
  const coveredByAnswerPage = new Set(
    (manifest.courseDownloads || [])
      .filter((item) => item.role === "homework_answer_page" && item.unit && item.lesson)
      .map((item) => `${item.unit}:${item.lesson}`),
  );
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      if (coveredByAnswerPage.has(`${unit.unit}:${lesson.lesson}`)) continue;
      for (const item of lesson.downloads || []) {
        const text = `${item.label || ""} ${item.path || ""} ${item.source || ""}`;
        if (!/MISSING-ANSWERS/i.test(text)) continue;
        gaps.push({
          unit: unit.unit,
          lesson: lesson.lesson,
          lessonId: lesson.id,
          label: item.label,
          path: item.path,
          source: item.source,
        });
      }
    }
  }
  return gaps;
}

const manifest = readJson(manifestPath);
const corrected = [];
let localizedLinkTextUpdated = 0;
let brokenTrigIconsUpdated = 0;

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const section of lesson.bookSections || []) {
      if (!section?.path || section.type !== "html") continue;
      const absPath = join(courseRoot, section.path);
      if (!existsSync(absPath)) continue;
      const before = readFileSync(absPath, "utf8");
      const linkMatches = [...before.matchAll(localVideoHrefPattern)].length;
      const iconMatches = [...before.matchAll(brokenTrigIconPattern)].length;
      const after = cleanLocalizedDisplayHtml(before);
      const previewBefore = section.textPreview || "";
      const previewAfter = stripPreviewText(previewBefore);
      if (after !== before) {
        writeFileSync(absPath, after, "utf8");
        section.bytes = statSync(absPath).size;
        corrected.push({
          unit: unit.unit,
          lesson: lesson.lesson,
          lessonId: lesson.id,
          section: section.sectionLabel || section.label,
          path: section.path,
        });
        localizedLinkTextUpdated += linkMatches;
        brokenTrigIconsUpdated += iconMatches;
      }
      if (previewAfter !== previewBefore) section.textPreview = previewAfter;
    }
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.mhf4uContentSourceDriftRepair = {
  generatedAt: new Date().toISOString(),
  correctedConsolidationPages: corrected,
  localizedLinkTextUpdated,
  brokenTrigIconsUpdated,
  note: "Removed obvious chemistry objective sentences from current display HTML and manifest previews by matching MDM4U consolidation display shape. Raw book_pages_raw.json files are retained unchanged as source evidence.",
};
manifest.sourceAudit.mhf4uUnresolvedStMaryGaps = {
  generatedAt: new Date().toISOString(),
  courseIntroduction: {
    status: "pending_authenticated_source",
    note: "Do not map Course Overview as Course Introduction without St. Mary section 0 evidence.",
  },
  missingAnswerWorksheets: collectMissingAnswerWorksheets(manifest),
  note: "MISSING-ANSWERS student worksheet filenames are not treated as unresolved when the matching St.Mary Unit X - Lesson Y (Answer) activity is present in Homework Submission Folder.",
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  correctedConsolidationPages: corrected.length,
  localizedLinkTextUpdated,
  brokenTrigIconsUpdated,
  missingAnswerWorksheets: manifest.sourceAudit.mhf4uUnresolvedStMaryGaps.missingAnswerWorksheets.length,
}, null, 2));
