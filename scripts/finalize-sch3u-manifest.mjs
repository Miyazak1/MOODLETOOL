import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SCH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function posix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function humanizeH5pExportUrl(value) {
  if (!value) return "";
  const name = basename(new URL(value).pathname).replace(/\.h5p$/i, "");
  return name
    .replace(/^sch3u-/i, "SCH3U ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countLessonDownloads(lesson, type) {
  return (lesson.downloads || []).filter((item) => item.type === type).length;
}

const manifest = readJson(manifestPath);
let lessonCount = 0;
let ispringCount = 0;
let ispringDownloadPackages = 0;
let h5pCount = 0;
let videoCount = 0;
let docxCount = 0;
let pdfCount = 0;
let bookSectionCount = 0;

for (const unit of manifest.units || []) {
  const summary = {
    downloads: 0,
    ispring: 0,
    docx: 0,
    pdf: 0,
    video: 0,
    h5p: 0,
    bookSections: 0,
  };

  for (const lesson of unit.lessons || []) {
    lessonCount += 1;

    for (const item of lesson.ispring || []) {
      ispringCount += 1;
      summary.ispring += 1;
      const packagePath = posix(item.packagePath);
      const zipPath = packagePath ? `${packagePath}.zip` : "";
      if (zipPath && existsSync(join(courseRoot, zipPath))) {
        item.downloadPath = zipPath;
        item.downloadBytes = statSync(join(courseRoot, zipPath)).size;
        ispringDownloadPackages += 1;
      }
    }

    for (const item of lesson.downloads || []) {
      if (item.category === "localized_external_h5p") {
        const title = humanizeH5pExportUrl(item.exportUrl);
        if (title) item.label = `Hands On H5P - ${title}`;
      }
    }

    const downloads = lesson.downloads || [];
    const lessonDocx = countLessonDownloads(lesson, "docx");
    const lessonPdf = countLessonDownloads(lesson, "pdf");
    const lessonVideo = countLessonDownloads(lesson, "mp4");
    const lessonH5p = countLessonDownloads(lesson, "h5p");
    const lessonBookSections = (lesson.bookSections || []).length;

    docxCount += lessonDocx;
    pdfCount += lessonPdf;
    videoCount += lessonVideo;
    h5pCount += lessonH5p;
    bookSectionCount += lessonBookSections;

    lesson.resourceCounts = {
      ...(lesson.resourceCounts || {}),
      downloads: downloads.length,
      bookSections: lessonBookSections,
      lessonPlan: lesson.lessonPlan ? 1 : 0,
      ispring: (lesson.ispring || []).length,
      h5p: lessonH5p,
      video: lessonVideo,
    };

    if (lesson.id === "U05L01") {
      lesson.resourceWarnings = [
        {
          type: "source_missing",
          resourceType: "video",
          source:
            "https://www.esunnybrook.com/pluginfile.php/8924/mod_book/chapter/2030/U5L1-The-%20Layers-Of-Atmosphere.mp4",
          detail:
            "Moodle source video returned HTTP 404 for the original URL and 8 authenticated filename variants during localization.",
        },
      ];
    }

    summary.downloads += downloads.length;
    summary.docx += lessonDocx;
    summary.pdf += lessonPdf;
    summary.video += lessonVideo;
    summary.h5p += lessonH5p;
    summary.bookSections += lessonBookSections;
  }

  unit.summary = summary;
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  lessonCount,
  moodleBookLessonCount: lessonCount,
  moodleBookSectionsRaw: 205,
  ispringExpected: ispringCount,
  ispringComplete: ispringCount,
  ispringPartial: 0,
  ispringDownloadPackages,
  h5pLocalized: h5pCount,
  videoExpected: 41,
  videoLocalized: videoCount,
  videoFailed: 1,
  failedMedia: [
    {
      lesson: "U05L01",
      type: "video",
      status: "source_404",
      source:
        "https://www.esunnybrook.com/pluginfile.php/8924/mod_book/chapter/2030/U5L1-The-%20Layers-Of-Atmosphere.mp4",
    },
  ],
  localizedDocumentCount: docxCount,
  localizedPdfCount: pdfCount,
  localizedH5pCount: h5pCount,
  localizedVideoCount: videoCount,
  generatedBookSectionCount: bookSectionCount,
};

manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(
  JSON.stringify(
    {
      course,
      lessonCount,
      ispringCount,
      ispringDownloadPackages,
      h5pCount,
      videoCount,
      docxCount,
      pdfCount,
      bookSectionCount,
      videoFailed: 1,
    },
    null,
    2,
  ),
);
