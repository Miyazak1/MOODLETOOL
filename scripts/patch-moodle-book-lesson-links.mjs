import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..", "..");
const coursewareRoot = join(workspaceRoot, "courseware");

const moodleBookDownload = (label, url) => ({
  label,
  type: "html",
  category: "moodle_book",
  role: "lesson_text",
  url,
  source: "authenticated Moodle Book crawl",
});

const unitSummary = (lessons) => ({
  downloads: lessons.reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0),
  ispring: lessons.reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0),
  docx: lessons.reduce((sum, lesson) => sum + (lesson.lessonPlan ? 1 : 0), 0),
  pdf: lessons.reduce(
    (sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "pdf").length,
    0,
  ),
  video: lessons.reduce(
    (sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "video").length,
    0,
  ),
  h5p: lessons.reduce(
    (sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length,
    0,
  ),
});

function readManifest(course) {
  return JSON.parse(readFileSync(join(coursewareRoot, course, "course-manifest.json"), "utf8"));
}

function writeManifest(course, manifest) {
  manifest.generatedAt = new Date().toISOString();
  writeFileSync(
    join(coursewareRoot, course, "course-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function patchEslco() {
  const course = "ESLCO";
  const manifest = readManifest(course);
  const books = [
    {
      unit: 1,
      title: "Unit 1: Unit 1",
      bookId: 7653,
      lessons: [
        ["Formal Language", null],
        ["Asking Questions", 742],
        ["Non-Fiction Text Features", 747],
        ["Reliable Sources", 752],
        ["Presentation Skills", 757],
      ],
    },
    {
      unit: 2,
      title: "Unit 2: Unit 2",
      bookId: 7671,
      lessons: [
        ["Short Story Elements: Plot", null],
        ["Setting & Point of View", 767],
        ["Characterization", 772],
        ["Theme & Setting", 777],
        ["Point of View", 782],
        ["Figurative Language", 787],
      ],
    },
    {
      unit: 3,
      title: "Unit 3: Unit 3",
      bookId: 7688,
      lessons: [
        ["In My Opinion: Fact vs Opinion", null],
        ["Supporting Your Opinion with Facts", 797],
        ["The Art of Persuasion", 802],
        ["Persuasion in the Media", 807],
        ["Opinion Essay", 812],
      ],
    },
    {
      unit: 4,
      title: "Unit 4: Unit 4",
      bookId: 7702,
      lessons: [
        ["Canada and the Media: All About Canada", null],
        ["Canada and the Media: The Government of Canada", 822],
        ["Canada and the Media: Canadian Citizenship", 827],
        ["Canada and the Media: Rights and Responsibilities of Canadian Citizens", 832],
        ["Canada and the Media: The News", 837],
      ],
    },
  ];

  manifest.units = books.map((book) => {
    const lessons = book.lessons.map(([title, chapterId], index) => {
      const lessonNumber = index + 1;
      const id = `U${String(book.unit).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}`;
      const url = chapterId
        ? `https://www.esunnybrook.com/mod/book/view.php?id=${book.bookId}&chapterid=${chapterId}`
        : `https://www.esunnybrook.com/mod/book/view.php?id=${book.bookId}`;
      const downloads = [moodleBookDownload(`Moodle Book: Lesson ${lessonNumber}: ${title}`, url)];

      return {
        id,
        unit: book.unit,
        lesson: lessonNumber,
        title,
        path: `lessons/U${String(book.unit).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}`,
        bookPageCount: 1,
        lessonText: [],
        textExports: [],
        lessonPlan: null,
        ispring: [],
        downloads,
        resourceCounts: {
          downloads: downloads.length,
          moodleBook: downloads.length,
        },
      };
    });

    return {
      unit: book.unit,
      title: book.title,
      coreTexts: [],
      unitPlan: null,
      unitResources: {},
      summary: unitSummary(lessons),
      lessons,
    };
  });

  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    lessonCount: books.reduce((sum, book) => sum + book.lessons.length, 0),
    moodleBookCount: books.length,
    moodleBookLessonCount: books.reduce((sum, book) => sum + book.lessons.length, 0),
  };

  writeManifest(course, manifest);
  console.log(`${course}: wrote ${manifest.sourceAudit.moodleBookLessonCount} Moodle Book lesson links`);
}

function patchHfa4u() {
  const course = "HFA4U";
  const manifest = readManifest(course);
  const lessons = [
    ["Nutrients and Their Purposes", null],
    ["Carbohydrates", 3517],
    ["Fats and Proteins", 3522],
    ["Micronutrients", 3527],
    ["Nutrient Deficiency", 3532],
    ["Determining Nutrient Content", 3537],
    ["Energy Balance", 3542],
    ["Metabolism & Digestion", 3547],
    ["Nutritional Status", 3552],
    ["The History of The Food Guide", 3557],
  ];
  const unitOne = manifest.units?.find((unit) => unit.unit === 1);

  if (!unitOne || !Array.isArray(unitOne.lessons) || unitOne.lessons.length < lessons.length) {
    throw new Error("HFA4U Unit 1 does not have the expected 10 local lesson entries.");
  }

  unitOne.lessons = unitOne.lessons.map((lesson) => {
    const source = lessons[lesson.lesson - 1];
    if (!source) return lesson;

    const [title, chapterId] = source;
    const url = chapterId
      ? `https://www.esunnybrook.com/mod/book/view.php?id=9805&chapterid=${chapterId}`
      : "https://www.esunnybrook.com/mod/book/view.php?id=9805";
    const existingDownloads = (lesson.downloads || []).filter((item) => item.category !== "moodle_book");
    const downloads = [
      ...existingDownloads,
      moodleBookDownload(`Moodle Book: Lesson ${lesson.lesson}: ${title}`, url),
    ];

    return {
      ...lesson,
      title,
      bookPageCount: Math.max(lesson.bookPageCount || 0, 1),
      downloads,
      resourceCounts: {
        ...(lesson.resourceCounts || {}),
        downloads: downloads.length,
        moodleBook: 1,
      },
    };
  });

  unitOne.summary = unitSummary(unitOne.lessons);
  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    moodleBookCount: 1,
    moodleBookLessonCount: lessons.length,
  };

  writeManifest(course, manifest);
  console.log(`${course}: attached ${lessons.length} Moodle Book lesson links to Unit 1`);
}

patchEslco();
patchHfa4u();
