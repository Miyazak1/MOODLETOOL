import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const defaultChecklistPath = join(projectRoot, "deployment", "upload-gap-checklist.json");
const defaultOutbox = join(projectRoot, "inbox", "collection");
const checklistPath = readArg("--checklist") || defaultChecklistPath;
const outbox = resolve(readArg("--outbox") || defaultOutbox);
const requestedCourses = readArgs("--course").map((course) => course.toUpperCase());
const dryRun = process.argv.includes("--dry-run");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readArgs(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeText(path, content) {
  if (dryRun) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function ensureDir(path) {
  if (!dryRun) mkdirSync(path, { recursive: true });
}

function courseManifest(course) {
  const path = join(workspaceRoot, "courseware", course, "course-manifest.json");
  if (!existsSync(path)) return null;
  return readJson(path);
}

function lessonRows(course) {
  const manifest = courseManifest(course);
  if (!manifest) return [];
  return (manifest.units || []).flatMap((unit) =>
    (unit.lessons || []).map((lesson) => {
      const unitOverview =
        lesson.planningStatus === "unit_overview" || (/^unit overview$/i.test(lesson.title || "") && !lesson.lessonPlan);
      return {
        unit: lesson.unit,
        lesson: lesson.lesson,
        id: lesson.id,
        title: lesson.title,
        filename: `${course}_U${String(lesson.unit).padStart(2, "0")}_L${String(lesson.lesson).padStart(2, "0")}.zip`,
        note: unitOverview ? "Unit-level placeholder; use only if the iSpring package is unit-level." : "Lesson-level slot.",
      };
    }),
  );
}

function directReadme(course, courseRecord) {
  const lines = [
    `# ${course} Direct Upload Files`,
    "",
    "Put the real files for this course in this folder using the suggested filenames below.",
    "Do not create empty placeholder DOCX/PDF files; the importer treats matching files as real courseware.",
    "",
    "After files are placed here, run:",
    "",
    "```text",
    "npm.cmd run import:gap-files -- --dry-run",
    "npm.cmd run import:gap-files -- --rebuild-manifest",
    "```",
    "",
    "| Upload Type | Unit | Lesson | Suggested Filename | Admin Target | Note |",
    "| --- | ---: | ---: | --- | --- | --- |",
  ];
  for (const item of courseRecord.uploadItems || []) {
    lines.push(
      `| ${item.uploadType} | ${item.unit ?? ""} | ${item.lesson ?? ""} | ${item.suggestedFilename || ""} | ${item.adminTarget || ""} | ${(item.note || "").replaceAll("|", "\\|")} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function ispringReadme(course, courseRecord) {
  const lessons = lessonRows(course);
  const lines = [
    `# ${course} iSpring Batch Package`,
    "",
    "Create one outer ZIP for the teacher admin `iSpring ZIP Batch` upload.",
    "Inside that outer ZIP, put one complete iSpring ZIP per lesson using the filenames below.",
    "",
    "Supported inner ZIP name pattern:",
    "",
    "```text",
    `${course}_U01_L01.zip`,
    "U01_L01.zip",
    "```",
    "",
  ];
  if (!lessons.length) {
    lines.push("No lessons are indexed for this course yet, so iSpring cannot be attached until lesson structure exists.", "");
  } else {
    lines.push("| Unit | Lesson | Lesson ID | Title | Inner ZIP Filename | Notes |");
    lines.push("| ---: | ---: | --- | --- | --- | --- |");
    for (const lesson of lessons) {
      lines.push(
        `| ${lesson.unit} | ${lesson.lesson} | ${lesson.id} | ${(lesson.title || "").replaceAll("|", "\\|")} | ${lesson.filename} | ${lesson.note} |`,
      );
    }
    lines.push("");
  }
  for (const item of courseRecord.externalItems || []) {
    lines.push(`- Status: ${item.connectedCount || 0}/${item.lessonCount || 0} connected. ${item.note || ""}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function reviewReadme(courseRecord) {
  const lines = [
    `# ${courseRecord.course} Text Review Items`,
    "",
    "These are not direct upload tasks. Confirm title, author, copyright status, and whether the text can be linked or stored.",
    "",
    "| Text | Author | Suggested Folder | Note |",
    "| --- | --- | --- | --- |",
  ];
  for (const item of courseRecord.reviewItems || []) {
    lines.push(
      `| ${(item.textTitle || "").replaceAll("|", "\\|")} | ${(item.author || "").replaceAll("|", "\\|")} | ${item.suggestedFolder || ""} | ${(item.note || "").replaceAll("|", "\\|")} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function staleReadme(category, course) {
  return `# ${course} Stale Collection Folder

This folder has no active ${category} task in the current collection summary.

Do not add new files here for the current import cycle. Existing non-README files were left untouched and should be reviewed or moved manually if they are still needed.
`;
}

function existingCourseDirs(category) {
  const root = join(outbox, category);
  if (!existsSync(root)) return [];
  return readDirCourseNames(root);
}

function readDirCourseNames(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name.toUpperCase())
    .sort();
}

function markStaleFolders(summary) {
  if (requestedCourses.length) {
    summary.staleFolders = [];
    return;
  }

  const active = {
    "direct-uploads": new Set(summary.courses.filter((course) => course.directUploads).map((course) => course.course)),
    "ispring-batches": new Set(summary.courses.filter((course) => course.ispringDecisions).map((course) => course.course)),
    "text-review": new Set(summary.courses.filter((course) => course.textReviews).map((course) => course.course)),
  };

  summary.staleFolders = [];
  for (const [category, activeCourses] of Object.entries(active)) {
    for (const course of existingCourseDirs(category)) {
      if (activeCourses.has(course)) continue;
      summary.staleFolders.push({ category, course });
      writeText(join(outbox, category, course, "README.md"), staleReadme(category, course));
    }
  }
}

if (!existsSync(checklistPath)) {
  console.error(`Missing checklist: ${checklistPath}`);
  process.exit(1);
}

const checklist = readJson(checklistPath);
const courses = (checklist.courses || []).filter((course) => {
  if (!requestedCourses.length) return true;
  return requestedCourses.includes(course.course.toUpperCase());
});

const summary = {
  generatedAt: new Date().toISOString(),
  checklist: checklistPath,
  outbox,
  dryRun,
  courses: [],
};

ensureDir(outbox);
for (const courseRecord of courses) {
  const course = courseRecord.course.toUpperCase();
  const courseSummary = {
    course,
    directUploads: courseRecord.uploadItems?.length || 0,
    textReviews: courseRecord.reviewItems?.length || 0,
    ispringDecisions: courseRecord.externalItems?.length || 0,
    lessonZipNames: courseRecord.externalItems?.length ? lessonRows(course).map((lesson) => lesson.filename) : [],
  };
  summary.courses.push(courseSummary);

  if (courseSummary.directUploads) {
    const directDir = join(outbox, "direct-uploads", course);
    ensureDir(directDir);
    writeText(join(directDir, "README.md"), directReadme(course, courseRecord));
  }

  if (courseSummary.textReviews) {
    const reviewDir = join(outbox, "text-review", course);
    ensureDir(reviewDir);
    writeText(join(reviewDir, "README.md"), reviewReadme(courseRecord));
  }

  if (courseSummary.ispringDecisions) {
    const ispringDir = join(outbox, "ispring-batches", course);
    ensureDir(ispringDir);
    writeText(join(ispringDir, "README.md"), ispringReadme(course, courseRecord));
    if (courseSummary.lessonZipNames.length) {
      writeText(join(ispringDir, "lesson-zip-filenames.txt"), `${courseSummary.lessonZipNames.join("\n")}\n`);
    }
  }
}

markStaleFolders(summary);

const indexLines = [
  "# Courseware Collection Inbox",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  "Use this folder to collect missing course files before importing or uploading them.",
  "",
  "Folders:",
  "",
  "- `direct-uploads/<COURSE>/`: course outlines, unit plans, and lesson plans. Files placed here can be copied into `inbox/upload-gaps/<COURSE>/` or uploaded from the admin page.",
  "- `ispring-batches/<COURSE>/`: expected inner ZIP names for the admin `iSpring ZIP Batch` upload.",
  "- `text-review/<COURSE>/`: items that require copyright/title review before storing or linking.",
  "- Folders that are no longer active are left in place but their README is overwritten with a stale notice.",
  "",
  "Summary:",
  "",
  "| Course | Direct Uploads | Text Reviews | iSpring Decisions | Lesson ZIP Names |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...summary.courses.map(
    (course) => `| ${course.course} | ${course.directUploads} | ${course.textReviews} | ${course.ispringDecisions} | ${course.lessonZipNames.length} |`,
  ),
  "",
];

const staleLines = [
  "# Stale Collection Folders",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  "These folders exist on disk but have no active task in the current collection summary.",
  "They are not deleted automatically because they may contain manually collected files.",
  "",
  "| Category | Course |",
  "| --- | --- |",
  ...(summary.staleFolders.length
    ? summary.staleFolders.map((item) => `| ${item.category} | ${item.course} |`)
    : ["| - | - |"]),
  "",
];

writeText(join(outbox, "README.md"), `${indexLines.join("\n")}\n`);
writeText(join(outbox, "STALE_DIRECTORIES.md"), `${staleLines.join("\n")}\n`);
writeText(join(outbox, "collection-inbox-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun,
      outbox,
      courses: summary.courses.length,
      directUploadCourses: summary.courses.filter((course) => course.directUploads).length,
      textReviewCourses: summary.courses.filter((course) => course.textReviews).length,
      ispringBatchCourses: summary.courses.filter((course) => course.ispringDecisions).length,
    },
    null,
    2,
  ),
);
