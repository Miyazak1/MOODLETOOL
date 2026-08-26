import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const coursewareRoot = path.join(workspaceRoot, "courseware");
const course = safeCourse(readArg("--course") || "ICS3U");
const dryRun = hasFlag("--dry-run");
const manifestPath = path.join(coursewareRoot, course, "course-manifest.json");
const courseRoot = path.dirname(manifestPath);

if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function localText(relativePath) {
  if (!relativePath) return "";
  const filePath = path.join(courseRoot, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return "";
  const html = fs.readFileSync(filePath, "utf8");
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(items, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const item of items.map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean)) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function takeSentences(text, limit = 2) {
  return uniqueStrings(String(text || "").match(/[^.!?]+[.!?]?/g) || [], limit);
}

function extractBetween(text, start, end) {
  const lower = text.toLowerCase();
  const startIndex = lower.indexOf(start.toLowerCase());
  if (startIndex < 0) return "";
  const afterStart = startIndex + start.length;
  const endIndex = end ? lower.indexOf(end.toLowerCase(), afterStart) : -1;
  return text.slice(afterStart, endIndex >= 0 ? endIndex : undefined).trim();
}

function extractLearningGoals(expectationsText) {
  const section = extractBetween(expectationsText, "Learning Goals:", "Success Criteria:");
  const matches = section.match(/I am learning to[^.]+\.?/gi) || [];
  return uniqueStrings(matches.length ? matches : takeSentences(section, 4), 5);
}

function extractSuccessCriteria(expectationsText) {
  const section = extractBetween(expectationsText, "Success Criteria:", "");
  const matches = section.match(/I can[^.]+\.?/gi) || [];
  return uniqueStrings(matches.length ? matches : takeSentences(section, 4), 5);
}

function extractFocus(expectationsText, lessonTitle) {
  const overall = extractBetween(expectationsText, "Overall Expectations:", "Specific Lesson Expectations:");
  const specific = extractBetween(expectationsText, "Specific Lesson Expectations:", "Learning Goals:");
  const evidence = takeSentences(`${overall} ${specific}`, 2).join(" ");
  return evidence || `Plan this lesson around ${lessonTitle} and use the Moodle lesson flow as the source sequence.`;
}

function compactResource(resource) {
  if (!resource) return null;
  return {
    label: resource.label || resource.title || resource.path || "Resource",
    type: resource.type || "file",
    category: resource.category || "course_resource",
    role: resource.role || "resource",
    path: resource.path,
    url: resource.url,
    previewPath: resource.previewPath,
    previewUrl: resource.previewUrl,
    downloadPath: resource.downloadPath,
    source: resource.source,
    bytes: resource.bytes,
    packagePath: resource.packagePath,
    mode: resource.mode,
  };
}

function compactResources(resources, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const resource of resources.map(compactResource).filter(Boolean)) {
    const key = toPosix(resource.path || resource.previewPath || resource.downloadPath || resource.url || resource.label).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resource);
    if (out.length >= limit) break;
  }
  return out;
}

function isPlayable(resource) {
  const type = String(resource?.type || "").toLowerCase();
  const role = String(resource?.role || "").toLowerCase();
  const category = String(resource?.category || "").toLowerCase();
  return (
    ["h5p", "mp4", "video", "ispring"].includes(type) ||
    role.includes("h5p") ||
    role.includes("video") ||
    role.includes("ispring") ||
    category.includes("h5p") ||
    category.includes("video") ||
    category.includes("ispring")
  );
}

function isTeacherFile(resource) {
  const text = `${resource?.label || ""} ${resource?.role || ""} ${resource?.category || ""}`.toLowerCase();
  return /answer|rubric|teacher|lesson_plan|unit_plan/.test(text);
}

function unitTextReferences(unitNumber) {
  return (manifest.texts || [])
    .filter((text) => (text.units || []).includes(unitNumber))
    .flatMap((text) => text.materials || []);
}

const baseCoursePriorities = [
  "Use the Moodle book sections as the authoritative teaching sequence: expectations, lesson, hands on, consolidation, homework.",
  "Keep playable resources visible for teaching flow: iSpring for instruction, H5P for practice, video for consolidation.",
  "Treat DOCX/PDF/PPT files as attached student or teacher materials rather than separate activity cards unless they are planning references.",
  "Separate evidence from suggestion: copied lesson goals come from localized course pages; pacing and teacher moves are generated planning notes.",
];

const baseSuggestedNote = "The Before/In/After Class sequence is generated from the localized Moodle flow and should be adjusted to the teacher's class length.";

const genericProfile = {
  id: "generic",
  pacingModel:
    "The course is treated as an OSSD course. Each lesson is planned as a 3-4 hour preparation block, with remaining time reserved for unit evaluations, culminating work, final review, and teacher-directed adjustments.",
  coursePriorities: baseCoursePriorities,
  unitConcepts: {},
  externalReferences: [],
  referencePrepNote: (_unit, _lesson, references) =>
    references.length ? "Keep the indexed curriculum, textbook, or supplemental reference available when students need another explanation or example." : "",
  unitTeacherMoves: () => [],
  lessonSuggestedNotes: () => [baseSuggestedNote],
};

const courseProfiles = {
  ICS3U: {
    ...genericProfile,
    id: "ICS3U",
    pacingModel:
      "The course is treated as a 110-hour Ontario Grade 11 computer studies course. Each lesson is planned as a 3-4 hour preparation block, with remaining time reserved for unit evaluations, labs, culminating work, and final review.",
    unitConcepts: {
      1: ["Java data types and representation", "Variables, arrays, input, and methods", "Error handling and validation", "Practice-first programming fluency"],
      2: ["Hardware specifications and user needs", "File management and operating systems", "Viruses, security, and development environments", "Compiled and interpreted code"],
      3: ["Problem-solving strategies", "Program templates and structure charts", "User interface design", "Algorithms, exception handling, and SDLC"],
      4: ["Environmental and social impacts", "Green computing", "Emerging computer science research", "Careers, internships, and work habits"],
    },
    externalReferences: [
      {
        label: "Steve Sweeney ICS3U Java planning wiki (teacher reference only)",
        type: "external_link",
        category: "teacher_reference",
        role: "external_reference",
        url: "https://stevesweeney.pbworks.com/w/page/29482586/ICS3U%20Fall%202010-2011",
        source: "public teacher wiki used for planning inspiration, not localized courseware",
      },
    ],
    referencePrepNote: (_unit, _lesson, references) =>
      references.length ? "Keep the Unit 1 Java/BlueJ supplementary text available when students need an alternate explanation." : "",
    unitTeacherMoves: (unit) => [unit.unit === 1 ? "Use the Java/BlueJ supplementary text when students need more examples or vocabulary reinforcement." : ""],
    lessonSuggestedNotes: (lesson) => [
      baseSuggestedNote,
      lesson.unit === 1 ? "For Java lessons, emphasize traceable code examples and frequent short compile/run cycles." : "",
      lesson.unit === 3 ? "For design lessons, ask students to show their planning artifact before coding." : "",
      lesson.unit === 4 ? "For society and careers lessons, connect the topic to a current technology example and a written reflection." : "",
    ],
  },
};

const profile = courseProfiles[course] || genericProfile;

function unitFocus(unit) {
  const concepts = profile.unitConcepts[unit.unit] || [];
  return concepts.length
    ? `${unit.title}: ${concepts.join("; ")}.`
    : `${unit.title}: use the localized lesson sequence, planning files, and assessment resources as the preparation spine.`;
}

function unitAssessmentPlan(unit) {
  const resources = unit.unitResources || {};
  const evaluations = Array.isArray(resources.evaluations) ? resources.evaluations.length : 0;
  const reflections = Array.isArray(resources.reflectionAndLogs) ? resources.reflectionAndLogs.length : 0;
  const submissions = Array.isArray(resources.lessonDropboxes) ? resources.lessonDropboxes.length : 0;
  const answers = Array.isArray(resources.answerPages) ? resources.answerPages.length : 0;
  return uniqueStrings(
    [
      evaluations ? `${evaluations} unit evaluation resources are available for AOL planning.` : "",
      reflections ? `${reflections} reflection or learning-log resources support metacognition and progress checks.` : "",
      submissions ? `${submissions} lesson submission folders anchor homework collection.` : "",
      answers ? `${answers} answer or teacher reference pages should be checked before marking.` : "",
      "Use H5P and consolidation media as low-stakes formative checks before homework submission.",
    ],
    5,
  );
}

function lessonPrep(unit, lesson) {
  const expectations = (lesson.bookSections || []).find((section) => section.sectionLabel === "Lesson Expectations");
  const lessonSection = (lesson.bookSections || []).find((section) => section.sectionLabel === "Lesson");
  const handsOn = (lesson.bookSections || []).find((section) => section.sectionLabel === "Hands On");
  const consolidation = (lesson.bookSections || []).find((section) => section.sectionLabel === "Consolidation");
  const homework = (lesson.bookSections || []).find((section) => section.sectionLabel === "Homework");
  const expectationsText = localText(expectations?.path) || expectations?.textPreview || "";
  const lessonText = localText(lessonSection?.path) || lessonSection?.textPreview || "";
  const handsOnText = localText(handsOn?.path) || handsOn?.textPreview || "";
  const consolidationText = localText(consolidation?.path) || consolidation?.textPreview || "";
  const homeworkText = localText(homework?.path) || homework?.textPreview || "";
  const downloads = lesson.downloads || [];
  const playables = compactResources([...(lesson.ispring || []), ...downloads.filter(isPlayable)], 10);
  const studentFiles = compactResources(downloads.filter((resource) => !isPlayable(resource) && !isTeacherFile(resource)), 8);
  const teacherFiles = compactResources([lesson.lessonPlan, ...downloads.filter(isTeacherFile)], 8);
  const references = compactResources(unitTextReferences(unit.unit), 4);
  const hasH5P = downloads.some((resource) => String(resource.type).toLowerCase() === "h5p");
  const hasVideo = downloads.some((resource) => /mp4|video/i.test(resource.type || resource.label || ""));
  const hasHomework = Boolean(homeworkText || studentFiles.length);
  return {
    id: lesson.id,
    unit: lesson.unit,
    lesson: lesson.lesson,
    title: lesson.title,
    pacing: "Suggested 3-4 hours",
    focus: extractFocus(expectationsText, lesson.title),
    learningGoals: extractLearningGoals(expectationsText),
    successCriteria: extractSuccessCriteria(expectationsText),
    beforeClass: uniqueStrings(
      [
        lesson.lessonPlan ? "Open the lesson plan and confirm the learning goals, success criteria, and required materials." : "",
        lessonSection ? "Preview the Moodle Lesson section and prepare any linked student handouts before class." : "",
        lesson.ispring?.length ? "Launch the iSpring module once to confirm the teaching sequence and media load correctly." : "",
        profile.referencePrepNote(unit, lesson, references),
      ],
      5,
    ),
    inClass: uniqueStrings(
      [
        "Start with the Lesson Expectations section and ask students to restate the success criteria in their own words.",
        lessonText ? takeSentences(lessonText, 1)[0] : "",
        lesson.ispring?.length ? "Use the iSpring courseware as the main guided instruction path, pausing for short checks after new vocabulary or procedures." : "",
        hasH5P ? "Use the H5P activity as a low-stakes practice check; repeat attempts are appropriate before moving on." : "",
      ],
      5,
    ),
    afterClass: uniqueStrings(
      [
        hasVideo ? "Assign or replay the consolidation video as the recap before students complete the exit activity." : "",
        consolidationText ? takeSentences(consolidationText, 1)[0] : "",
        hasHomework ? "Direct students to the Homework section and the correct Moodle submission folder; remind them to upload Word or PDF evidence." : "",
      ],
      5,
    ),
    assessment: uniqueStrings(
      [
        hasH5P ? "H5P is formative practice and should be used to identify reteaching needs." : "",
        hasHomework ? "Homework files provide evidence of individual practice and should be checked against the matching submission folder." : "",
        "Use the unit quiz/test/lab resources for AOL only after the lesson sequence has been completed.",
      ],
      4,
    ),
    resourceGroups: {
      playables,
      studentFiles,
      teacherFiles,
      references,
    },
    evidence: uniqueStrings(
      [
        expectations ? `Lesson expectations: ${expectations.path}` : "",
        lessonSection ? `Lesson content: ${lessonSection.path}` : "",
        handsOn ? `Hands On activity: ${handsOn.path}` : "",
        consolidation ? `Consolidation: ${consolidation.path}` : "",
        homework ? `Homework: ${homework.path}` : "",
      ],
      8,
    ),
    suggestedNotes: uniqueStrings(
      profile.lessonSuggestedNotes(lesson),
      4,
    ),
  };
}

const planningReferences = compactResources([
  ...(manifest.courseDownloads || []).filter((item) => ["course_outline", "curriculum_reference"].includes(item.role)),
  ...(manifest.texts || []).flatMap((text) => text.materials || []),
], 10);

manifest.teacherPrep = {
  generatedAt: new Date().toISOString(),
  title: `${manifest.course.code} Teacher Prep Guide`,
  purpose:
    "A teacher-facing preparation layer generated from the localized Moodle lesson pages, lesson plans, unit plans, playable media, homework files, and local text references.",
  evidencePolicy:
    "Learning goals, success criteria, resources, and file paths are drawn from local course materials. Pacing, teacher moves, and sequencing notes are suggested planning notes.",
  pacingModel: profile.pacingModel,
  coursePriorities: profile.coursePriorities,
  planningReferences,
  externalReferences: profile.externalReferences,
  units: (manifest.units || []).map((unit) => ({
    unit: unit.unit,
    title: unit.title,
    pacing: `Suggested ${Math.max(lessonCount(unit) * 3, 1)}-${lessonCount(unit) * 4} hours plus unit assessment time`,
    focus: unitFocus(unit),
    keyConcepts: profile.unitConcepts[unit.unit] || [unit.title],
    assessmentPlan: unitAssessmentPlan(unit),
    teacherMoves: uniqueStrings(
      [
        "Open the unit plan first, then use the lesson prep cards to stage materials in the same order students will see them.",
        "Check every playable resource before assigning the lesson: iSpring, H5P, and video should be ready before class.",
        "Use homework and submission-folder resources as the handoff point from instruction to independent work.",
        ...profile.unitTeacherMoves(unit),
      ],
      5,
    ),
    lessons: (unit.lessons || []).map((lesson) => lessonPrep(unit, lesson)),
  })),
};

manifest.sourceAudit ||= {};
manifest.sourceAudit.teacherPrepGenerated = {
  status: "generated",
  generatedAt: manifest.teacherPrep.generatedAt,
  lessonPrepCards: manifest.teacherPrep.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
  profile: profile.id,
  source: "Generated from course-manifest.json and localized Moodle book section HTML.",
};
manifest.generatedAt = new Date().toISOString();

if (!dryRun) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      course,
      dryRun,
      profile: profile.id,
      manifestPath,
      units: manifest.teacherPrep.units.length,
      lessons: manifest.teacherPrep.units.reduce((sum, unit) => sum + unit.lessons.length, 0),
      planningReferences: manifest.teacherPrep.planningReferences.length,
    },
    null,
    2,
  ),
);

function lessonCount(unit) {
  return (unit.lessons || []).length;
}
