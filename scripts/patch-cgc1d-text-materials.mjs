import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = resolve("D:/工作文件/SUNNYBROOK");
const courseRoot = join(workspaceRoot, "courseware", "CGC1D");
const manifestPath = join(courseRoot, "course-manifest.json");
const courseOutlineSource = join(
  courseRoot,
  "localized-moodle-activities",
  "assign",
  "assign-11758-CGC1D-Course-Outline",
  "files",
  "bd3ecf7cff-CGC1D Course Outline.docx",
);
const courseOutlineRel = "texts/cgc1d-course-outline/CGC1D Course Outline.docx";
const curriculumRel = "texts/ontario-curriculum-canadian-world-studies-9-10-2018/canworld910curr2018.pdf";
const curriculumSource = "https://www.edu.gov.on.ca/eng/curriculum/secondary/canworld910curr2018.pdf";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function upsertById(list, record) {
  const index = list.findIndex((item) => item.id === record.id);
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

if (!existsSync(courseOutlineSource)) throw new Error(`Missing course outline source: ${courseOutlineSource}`);

mkdirSync(join(courseRoot, "texts", "cgc1d-course-outline"), { recursive: true });
copyFileSync(courseOutlineSource, join(courseRoot, courseOutlineRel));

const curriculumPath = join(courseRoot, curriculumRel);
if (!existsSync(curriculumPath)) {
  throw new Error(`Missing curriculum PDF; download it first: ${curriculumPath}`);
}

const outlineBytes = statSync(join(courseRoot, courseOutlineRel)).size;
const curriculumBytes = statSync(curriculumPath).size;
const units = [1, 2, 3, 4];

const manifest = readJson(manifestPath);
manifest.texts ||= [];

upsertById(manifest.texts, {
  id: "cgc1d-course-outline",
  title: "CGC1D Course Outline",
  type: "course_outline",
  units,
  copyrightStatus: "moodle_course_material",
  sourceStatus: "localized_from_moodle_course_resource",
  notes: "Course outline retained as a related course text/reference. The outline explicitly states Textbook: None.",
  materials: [
    {
      label: "CGC1D Course Outline",
      type: "docx",
      category: "course_outline",
      role: "course_text_reference",
      path: courseOutlineRel,
      bytes: outlineBytes,
      source: "localized-moodle-activities/assign/assign-11758-CGC1D-Course-Outline/files/bd3ecf7cff-CGC1D Course Outline.docx",
      downloadPath: courseOutlineRel,
    },
  ],
  path: courseOutlineRel,
  bytes: outlineBytes,
  category: "course_outline",
  role: "course_text_reference",
});

upsertById(manifest.texts, {
  id: "ontario-canadian-world-studies-9-10-2018",
  title: "The Ontario Curriculum, Grades 9 and 10: Canadian and World Studies, 2018 (Revised)",
  publisher: "Ontario Ministry of Education",
  type: "curriculum",
  units,
  copyrightStatus: "official_public_document",
  sourceStatus: "localized_from_public_official_source",
  notes: "Official Ontario curriculum/policy document cited by the CGC1D course outline; includes Issues in Canadian Geography, Grade 9, Academic (CGC1D) expectations.",
  materials: [
    {
      label: "The Ontario Curriculum, Grades 9 and 10: Canadian and World Studies, 2018 (Revised)",
      type: "pdf",
      category: "official_curriculum",
      role: "curriculum_reference",
      path: curriculumRel,
      bytes: curriculumBytes,
      source: curriculumSource,
      previewPath: curriculumRel,
      downloadPath: curriculumRel,
    },
  ],
  path: curriculumRel,
  bytes: curriculumBytes,
  category: "official_curriculum",
  role: "curriculum_reference",
});

manifest.sourceAudit ||= {};
manifest.sourceAudit.texts = {
  textbookTitle: "None",
  textbookSource: "CGC1D Course Outline states: Textbook: None.",
  relatedTextCount: manifest.texts.length,
  addedRelatedTexts: [
    courseOutlineRel,
    curriculumRel,
  ],
  patchedAt: new Date().toISOString(),
};
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

writeFileSync(
  join(courseRoot, "texts", "SOURCES.md"),
  `# CGC1D Texts and Curriculum Sources

- Course: CGC1D - Issues in Canadian Geography, Grade 9, Academic.
- Textbook listed in course outline: **None**.
- Course outline retained: \`${courseOutlineRel}\`.
- Official curriculum reference retained: \`${curriculumRel}\`.
- Official curriculum source: ${curriculumSource}.
- Note: no commercial textbook PDF was added because the current course outline explicitly lists no textbook.
`,
  "utf8",
);

console.log(JSON.stringify({
  course: "CGC1D",
  textbook: "None",
  texts: manifest.texts.length,
  courseOutlineRel,
  curriculumRel,
  curriculumBytes,
}, null, 2));
