import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const moodleIndexPath = join(projectRoot, "deployment", "moodle-course-resource-index.csv");

const importedAt = new Date().toISOString();

const COURSES = [
  {
    code: "ENG2D",
    moodleCourseId: 8,
    title: "ENG2D · English",
    manifestTitle: "English, Grade 10, Academic",
    level: "Grade 10",
    outlineText: "ENG2D Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=376",
    units: [
      { title: "Short Stories & Poetry", section: 3 },
      { title: "Persuasive Texts & Media", section: 4 },
      { title: "Novel Study - Lord of the Flies", section: 5 },
      { title: "Drama - Othello", section: 6 },
    ],
    texts: [
      {
        id: "lord_of_the_flies",
        title: "Lord of the Flies",
        author: "William Golding",
        units: [3],
        notes: "Detected from Moodle Unit 3 title; file not collected yet.",
      },
      {
        id: "othello",
        title: "Othello",
        author: "William Shakespeare",
        units: [4],
        notes: "Detected from Moodle Unit 4 title; file not collected yet.",
      },
    ],
  },
  {
    code: "OLC4O",
    moodleCourseId: 9,
    title: "OLC4O · Ontario Secondary School Literacy Course",
    manifestTitle: "Ontario Secondary School Literacy Course, Grade 12, Open",
    level: "Grade 12",
    outlineText: "OLC4O Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=494",
    units: [
      { title: "Reading and Writing for Personal Success", section: 3 },
      { title: "Community Voices Through Reading and Writing", section: 4 },
      { title: "Reading and Writing as Community Action", section: 5 },
      { title: "Culminating Project - Demonstrating Success in Reading and Writing", section: 7 },
    ],
  },
  {
    code: "ICS4U",
    moodleCourseId: 37,
    title: "ICS4U · Computer Science",
    manifestTitle: "Computer Science, Grade 12, University",
    level: "Grade 12",
    outlineText: "ICS4U Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=3829",
    units: [
      { title: "Programming Concepts and Skills Review", section: 2 },
      { title: "Object-Oriented Programming", section: 3 },
      { title: "Design and Analysis of Algorithms", section: 4 },
      { title: "Software Development Life Cycle", section: 5 },
    ],
  },
  {
    code: "ICS2O",
    moodleCourseId: 36,
    title: "ICS2O · Introduction to Computer Studies",
    manifestTitle: "Introduction to Computer Studies, Grade 10, Open",
    level: "Grade 10",
    outlineText: "ICS2O Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=3753",
    units: [
      {
        title: "Understanding Computers",
        sections: [
          ["Overview", 2],
          ["Lesson Plans", 3],
          ["Slides/Notes", 4],
          ["Assessments", 5],
        ],
      },
      {
        title: "Introduction to Programming",
        sections: [
          ["Overview", 6],
          ["Lesson Plans", 7],
          ["Slides/Notes", 8],
          ["Assessments", 9],
        ],
      },
      {
        title: "Computers and Societies",
        sections: [
          ["Overview", 10],
          ["Lesson Plans", 11],
          ["Slides/Notes", 12],
          ["Assessments", 13],
        ],
      },
    ],
  },
  {
    code: "MTH1W",
    moodleCourseId: 59,
    title: "MTH1W · Mathematics",
    manifestTitle: "Mathematics, Grade 9, De-Streamed",
    level: "Grade 9",
    outlineText: "MTH1W Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=5821",
    units: [
      { title: "Number", section: 1 },
      { title: "Algebra", section: 2 },
      { title: "Data", section: 3 },
      { title: "Geometry and Measurement", section: 4 },
      { title: "Coding", section: 5 },
      { title: "Financial Literacy", section: 6 },
    ],
  },
  {
    code: "PPL3O",
    moodleCourseId: 58,
    title: "PPL3O · Healthy Active Living Education",
    manifestTitle: "Healthy Active Living Education, Grade 11, Open",
    level: "Grade 11",
    outlineText: "PPL3O Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=5747",
    units: [
      { title: "Introduction to Health and Healthy Active Living", section: 2 },
      { title: "Introduction to Health Growth and Sexuality", section: 3 },
      { title: "Mental Health and Stress Management", section: 4 },
      { title: "Safety and Decision Making", section: 5 },
    ],
  },
  {
    code: "PPL1O",
    moodleCourseId: 57,
    title: "PPL1O · Healthy Active Living Education",
    manifestTitle: "Healthy Active Living Education, Grade 9, Open",
    level: "Grade 9",
    outlineText: "PPL1O Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=5704",
    units: [
      { title: "Active Living", section: 1 },
      { title: "Safety, Substance Abuse and Bullying", section: 2 },
      { title: "Healthy Living and Sexual Health", section: 3 },
      { title: "Movement Competence", section: 4 },
    ],
  },
  {
    code: "CGC1D",
    moodleCourseId: 43,
    title: "CGC1D · Issues in Canadian Geography",
    manifestTitle: "Issues in Canadian Geography, Grade 9 Academic",
    level: "Grade 9",
    outlineText: "Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=4393",
    units: [
      { title: "Canadian Connections and Methods of Geographical Inquiry", section: 1 },
      { title: "Canada's Ecozones and Cultural Connections", section: 2 },
      { title: "Canada's Economic Connections", section: 3 },
      { title: "Canada's Global and Future Connections", section: 4 },
    ],
  },
  {
    code: "AVI3M",
    moodleCourseId: 68,
    title: "AVI3M · Visual Arts",
    manifestTitle: "Visual Arts, Grade 11, University/College",
    level: "Grade 11",
    outlineText: "AVI3M Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=7117",
    units: [
      { title: "Elements and Principle of Art", section: 1 },
      { title: "Art Criticism", section: 2 },
      { title: "Studio Practice", section: 3 },
      { title: "Portfolio Development", section: 4 },
    ],
  },
  {
    code: "EPS3O",
    moodleCourseId: 10,
    title: "EPS3O · Presentation and Speaking Skills",
    manifestTitle: "Presentation and Speaking Skills, Grade 11, Open",
    level: "Grade 11",
    outlineText: "EPS3O Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=591",
    units: [
      { title: "Understanding Presentations - Speaking for Yourself", section: 1 },
      { title: "Understanding Presentations - Speaking for the Classroom", section: 2 },
      { title: "Making Presentations - Speaking for the Workplace", section: 3 },
      { title: "Making Presentations - Speaking for the Community", section: 4 },
    ],
  },
  {
    code: "ASM3M",
    moodleCourseId: 66,
    title: "ASM3M · Media Arts",
    manifestTitle: "Media Arts, Grade 11, University/College",
    level: "Grade 11",
    outlineText: "Video Game Design Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/assign/view.php?id=6980",
    units: [
      { title: "Design", section: 1 },
      { title: "Character Design", section: 2 },
      { title: "Video Art and Animation", section: 3 },
      { title: "Video Game", section: 4 },
    ],
  },
  {
    code: "AVI1O",
    moodleCourseId: 5,
    title: "AVI1O · Visual Arts",
    manifestTitle: "Visual Arts, Grade 9, Open",
    level: "Grade 9",
    outlineText: "AVI1O Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=74",
    units: [
      { title: "Elements and Principles of Design", section: 1 },
      { title: "Shading and Portraiture Details", section: 2 },
      { title: "Color Theory", section: 3 },
      { title: "Printmaking", section: 4 },
      { title: "Sculpting", section: 5 },
    ],
  },
  {
    code: "AVI2O",
    moodleCourseId: 4,
    title: "AVI2O · Visual Arts",
    manifestTitle: "Visual Arts, Grade 10, Open",
    level: "Grade 10",
    outlineText: "Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/url/view.php?id=3",
    units: [
      { title: "Drawing", section: 1 },
      { title: "Painting", section: 2 },
      { title: "Printmaking", section: 3 },
      { title: "Sculpture", section: 4 },
    ],
  },
  {
    code: "MPM1D",
    moodleCourseId: 19,
    title: "MPM1D · Principles of Mathematics",
    manifestTitle: "Principles of Mathematics, Grade 9, Academic",
    level: "Grade 9",
    outlineText: "Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/url/view.php?id=1686",
    units: [
      { title: "Number Sense and Algebra", section: 1 },
      { title: "Linear Relations and Linear Equations", section: 4 },
      { title: "Analytic Geometry", section: 7 },
      { title: "Measurement and Geometry", section: 10 },
    ],
  },
  {
    code: "BBI2O",
    moodleCourseId: 65,
    title: "BBI2O · Introduction to Business",
    manifestTitle: "Introduction to Business, Grade 10, Open",
    level: "Grade 10",
    outlineText: "BBI1O/BBI2O Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=6867",
    units: [
      { title: "Business Fundamentals", section: 1 },
      { title: "Functions of a Business", section: 2 },
      { title: "Finance", section: 3 },
      { title: "Entrepreneurship", section: 4 },
    ],
  },
  {
    code: "BAF3M",
    moodleCourseId: 32,
    title: "BAF3M · Financial Accounting Fundamentals",
    manifestTitle: "Financial Accounting Fundamentals, Grade 11, University/College",
    level: "Grade 11",
    outlineText: "BAF3M Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=3372",
    units: [
      { title: "Accounting Basics and Double Entries", section: 1 },
      { title: "Accounting Ethics and T Accounts", section: 2 },
      { title: "Business Entities and Trial Balance", section: 3 },
      { title: "Internal Control and Profit/Loss Account", section: 4 },
      { title: "Advanced Statements, Depreciation, and Careers", section: 5 },
    ],
  },
  {
    code: "BTT1O",
    moodleCourseId: 31,
    title: "BTT1O · Information and Communication Technology in Business",
    manifestTitle: "Information and Communication Technology in Business, Grade 9, Open",
    level: "Grade 9",
    units: [
      { title: "Building a Webpage", section: 1 },
      { title: "Using Microsoft Word in Communication", section: 2 },
      { title: "Using Microsoft Excel in Business", section: 3 },
      { title: "Making Creative Presentations Using Microsoft PowerPoint", section: 4 },
    ],
  },
  {
    code: "CIA4U",
    moodleCourseId: 40,
    title: "CIA4U · Analysing Current Economic Issues",
    manifestTitle: "Analysing Current Economic Issues, Grade 12, University",
    level: "Grade 12",
    outlineText: "Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=4102",
    units: [
      { title: "Basic Economic Ideas", section: 1 },
      { title: "Productive Resources and Economic Systems", section: 2 },
      { title: "Demand and Supply", section: 3 },
      { title: "Demand and Supply: The Canadian Perspective", section: 4 },
      { title: "Application of Demand and Supply", section: 5 },
      { title: "Real Estate Market and Contract Law", section: 6 },
      { title: "Big and Small Businesses", section: 7 },
      { title: "Revision and Summative Assessment", section: 8 },
    ],
  },
  {
    code: "LKBCU",
    moodleCourseId: 44,
    title: "LKBCU · International Languages, Simplified Chinese",
    manifestTitle: "International Languages, Simplified Chinese, Level 2, University",
    level: "Level 2",
    outlineText: "LKBCU Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=4496",
    units: [
      { title: "Unit 1", section: 1 },
      { title: "Unit 2", section: 2 },
      { title: "Unit 3", section: 3 },
      { title: "Unit 4", section: 4 },
    ],
  },
  {
    code: "ESLCO",
    moodleCourseId: 73,
    title: "ESLCO · ESL Level 3",
    manifestTitle: "English as a Second Language, ESL Level 3, Open",
    level: "ESL",
    outlineText: "ESLCO Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/assign/view.php?id=7650",
    bookIds: [7653, 7671, 7688, 7702],
    units: [
      { title: "Unit 1", section: 2 },
      { title: "Unit 2", section: 3 },
      { title: "Unit 3", section: 4 },
      { title: "Unit 4", section: 5 },
    ],
  },
  {
    code: "ESLBO",
    moodleCourseId: 49,
    title: "ESLBO · ESL Level 2",
    manifestTitle: "English as a Second Language, ESL Level 2, Open",
    level: "ESL",
    outlineText: "Course Outline",
    outlineUrl: "https://www.esunnybrook.com/course/view.php?id=49#collapseSection-537",
    units: [
      { title: "Unit 1", section: 4 },
      { title: "Unit 2", section: 5 },
      { title: "Unit 3", section: 6 },
      { title: "Unit 4", section: 7 },
    ],
  },
  {
    code: "ESLAO",
    moodleCourseId: 48,
    title: "ESLAO · ESL Level 1",
    manifestTitle: "English as a Second Language, ESL Level 1, Open",
    level: "ESL",
    outlineText: "Course Outline",
    outlineUrl: "https://www.esunnybrook.com/course/view.php?id=48#collapseSection-527",
    units: [
      { title: "Writing", section: 4 },
      { title: "Canada and Me", section: 5 },
      { title: "Short Stories - Fiction and Non-Fiction", section: 6 },
      { title: "Media Introduction and Course Review", section: 7 },
    ],
  },
  {
    code: "HFN1O",
    moodleCourseId: 55,
    title: "HFN1O/2O · Food and Nutrition",
    manifestTitle: "Food and Nutrition, Grade 9 or 10",
    level: "Grade 9/10",
    outlineText: "HFN1O/2O Course Outline",
    outlineUrl: "https://www.esunnybrook.com/mod/resource/view.php?id=5570",
    units: [
      { title: "Nutrition and Health", section: 1 },
      { title: "Food Choices", section: 2 },
      { title: "Local and Global Foods", section: 3 },
      { title: "Food Preparation Skills", section: 4 },
    ],
  },
];

function isExcludedCourseCode(course) {
  return /C$/i.test(String(course || "").trim());
}

const eligibleCourses = COURSES.filter((course) => !isExcludedCourseCode(course.code));

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function readCsv(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function writeCsv(path, rows) {
  const headers = [
    "course",
    "moodleCourseId",
    "coursePage",
    "outlineStatus",
    "outlineTargetFilename",
    "outlineUrl",
    "bookCount",
    "bookIds",
    "bookChapterLinkCounts",
    "notes",
  ];
  const body = rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n");
  writeFileSync(path, `${headers.join(",")}\n${body}\n`, "utf8");
}

function sectionUrl(course, section) {
  return `https://www.esunnybrook.com/course/view.php?id=${course.moodleCourseId}&section=${section}`;
}

function downloadRecord({ label, url, role = "moodle_section" }) {
  return {
    label,
    type: "html",
    category: "moodle_resource",
    role,
    url,
  };
}

function buildUnit(course, unit, index) {
  const unitNumber = index + 1;
  const sections = unit.sections || [["Moodle Section", unit.section || unitNumber]];
  const downloads = sections.map(([label, section]) =>
    downloadRecord({
      label: sections.length === 1 ? `Open Moodle section: ${unit.title}` : `${label}: ${unit.title}`,
      url: sectionUrl(course, section),
    }),
  );

  return {
    unit: unitNumber,
    title: `Unit ${unitNumber}: ${unit.title}`,
    coreTexts: (course.texts || []).filter((text) => text.units.includes(unitNumber)).map((text) => text.id),
    unitResources: {},
    summary: {
      downloads: downloads.length,
      ispring: 0,
      docx: 0,
      pdf: 0,
      video: 0,
      h5p: 0,
    },
    lessons: [
      {
        id: `U${String(unitNumber).padStart(2, "0")}L01`,
        unit: unitNumber,
        lesson: 1,
        title: "Moodle Activity Index",
        path: `lessons/U${String(unitNumber).padStart(2, "0")}L01`,
        bookPageCount: 0,
        lessonText: [],
        textExports: [],
        ispring: [],
        downloads,
        resourceCounts: {
          downloads: downloads.length,
        },
      },
    ],
  };
}

function buildManifest(course) {
  const courseDownloads = course.outlineUrl
    ? [
        {
          label: course.outlineText || `${course.code} Course Outline`,
          type: "docx",
          category: "course_document",
          role: "course_outline",
          url: course.outlineUrl,
        },
      ]
    : [];

  return {
    schemaVersion: 1,
    generatedAt: importedAt,
    course: {
      code: course.code,
      title: course.manifestTitle,
      audience: "Teachers preparing OSSD lessons",
      source: "Authenticated SunnyBrook Moodle course shell",
    },
    sourceAudit: {
      lessonCount: course.units.length,
      ispringExpected: 0,
      ispringComplete: 0,
      moodleCourseId: course.moodleCourseId,
      outlineUrl: course.outlineUrl,
      moodleShellImported: true,
    },
    navigation: {
      primary: "unit",
      secondary: "lesson",
    },
    courseDownloads,
    texts: (course.texts || []).map((text) => ({
      id: text.id,
      title: text.title,
      author: text.author,
      units: text.units,
      materials: [],
      externalLinks: [],
      notes: text.notes,
    })),
    units: course.units.map((unit, index) => buildUnit(course, unit, index)),
  };
}

function upsertCatalog() {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const existing = new Map(catalog.courses.map((course, index) => [course.code, index]));

  for (const course of eligibleCourses) {
    const item = {
      code: course.code,
      title: course.title,
      level: course.level,
      status: "moodle-shell",
      manifestUrl: `/courseware/${course.code}/course-manifest.json`,
      baseUrl: `/courseware/${course.code}/`,
      notes: course.outlineUrl
        ? "Authenticated Moodle course shell imported; Course Outline and unit sections are linked."
        : "Authenticated Moodle course shell imported; unit sections are linked; Course Outline still needs URL.",
    };
    if (existing.has(course.code)) {
      catalog.courses[existing.get(course.code)] = item;
    } else {
      catalog.courses.push(item);
    }
  }

  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

function upsertMoodleIndex() {
  const rows = readCsv(moodleIndexPath);
  const byCourse = new Map(rows.map((row, index) => [row.course, index]));

  for (const course of eligibleCourses) {
    const bookIds = course.bookIds || [];
    const row = {
      course: course.code,
      moodleCourseId: String(course.moodleCourseId),
      coursePage: `https://www.esunnybrook.com/course/view.php?id=${course.moodleCourseId}`,
      outlineStatus: course.outlineUrl ? "ready" : "needs-url",
      outlineTargetFilename: `${course.code}_Course_Outline.docx`,
      outlineUrl: course.outlineUrl || "",
      bookCount: String(bookIds.length),
      bookIds: bookIds.join(";"),
      bookChapterLinkCounts: bookIds.map((id) => `${id}:0`).join(";"),
      notes: course.outlineUrl
        ? `Authenticated Moodle shell visible; ${bookIds.length ? `${bookIds.length} Moodle Book container(s) found; ` : "no Moodle Book containers found; "}section structure imported.`
        : "Authenticated Moodle shell visible; no Course Outline URL exposed; section structure imported.",
    };
    if (byCourse.has(course.code)) {
      rows[byCourse.get(course.code)] = row;
    } else {
      rows.push(row);
    }
  }

  writeCsv(moodleIndexPath, rows);
}

for (const course of eligibleCourses) {
  const courseDir = join(coursewareRoot, course.code);
  mkdirSync(courseDir, { recursive: true });
  writeFileSync(join(courseDir, "course-manifest.json"), `${JSON.stringify(buildManifest(course), null, 2)}\n`, "utf8");
}

upsertCatalog();
upsertMoodleIndex();

console.log(`Imported ${eligibleCourses.length} authenticated Moodle course shells; skipped ${COURSES.length - eligibleCourses.length} excluded course(s).`);
