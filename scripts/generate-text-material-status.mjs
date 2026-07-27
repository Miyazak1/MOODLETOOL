import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const deploymentRoot = join(projectRoot, "deployment");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const requestedCourse = readArg("--course");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function fileType(path) {
  return extname(path || "").replace(".", "").toLowerCase() || "link";
}

function courseRoot(course) {
  return normalize(join(coursewareRoot, course));
}

function materialStatus(course, material) {
  if (material.path) {
    const absolutePath = join(courseRoot(course), material.path);
    return {
      label: material.label || material.path,
      type: material.type || fileType(material.path),
      path: toPosix(material.path),
      url: null,
      exists: existsSync(absolutePath),
      bytes: material.bytes || null,
    };
  }
  return {
    label: material.label || material.url || "External link",
    type: material.type || fileType(material.url),
    path: null,
    url: material.url || null,
    exists: Boolean(material.url),
    bytes: null,
  };
}

function readManifest(course) {
  const manifestPath = join(courseRoot(course), "course-manifest.json");
  if (!existsSync(manifestPath)) return null;
  return readJson(manifestPath);
}

function summarizeCourse(courseEntry) {
  const manifest = readManifest(courseEntry.code);
  if (!manifest) return null;
  const texts = (manifest.texts || []).map((text) => {
    const materials = (text.materials || []).map((material) => materialStatus(courseEntry.code, material));
    const externalLinks = (text.externalLinks || []).map((material) => materialStatus(courseEntry.code, material));
    return {
      id: text.id,
      title: text.title,
      author: text.author,
      units: text.units || [],
      lessons: text.lessons || [],
      copyrightStatus: text.copyrightStatus || "",
      sourceStatus: text.sourceStatus || "",
      notes: text.notes || "",
      materials,
      externalLinks,
      downloadable: materials.length > 0 && materials.every((material) => material.exists),
      missingDownload: text.sourceStatus !== "unavailable" && materials.length === 0,
    };
  });
  return {
    course: courseEntry.code,
    title: manifest.course?.title || courseEntry.title,
    textEntries: texts.length,
    downloadableTexts: texts.filter((text) => text.downloadable).length,
    missingDownloadableTexts: texts.filter((text) => text.missingDownload).length,
    localMaterialFiles: texts.reduce((sum, text) => sum + text.materials.length, 0),
    moodleLinkedTexts: texts.filter((text) => text.externalLinks.some((link) => link.url?.includes("esunnybrook.com"))).length,
    texts,
  };
}

function renderMarkdown(report) {
  const lines = ["# Text Material Status", "", `Generated: ${report.generatedAt}`, ""];
  lines.push("## Summary", "");
  lines.push("| Course | Texts | Downloadable | Missing Downloadable | Moodle Links | Local Files |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const course of report.courses.filter((item) => item.textEntries > 0)) {
    lines.push(
      `| ${course.course} | ${course.textEntries} | ${course.downloadableTexts} | ${course.missingDownloadableTexts} | ${course.moodleLinkedTexts} | ${course.localMaterialFiles} |`,
    );
  }
  lines.push("");
  lines.push("## Courses With Missing Downloadable Texts", "");
  const missingCourses = report.courses.filter((course) => course.missingDownloadableTexts > 0);
  if (!missingCourses.length) {
    lines.push("- None");
  } else {
    for (const course of missingCourses) {
      lines.push(`### ${course.course}`);
      lines.push("");
      lines.push("| Text ID | Text | Author | Units/Lessons | Source Status | Moodle Link | Suggested Folder |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- |");
      for (const text of course.texts.filter((item) => item.missingDownload)) {
        const moodleLink = text.externalLinks.find((link) => link.url?.includes("esunnybrook.com"));
        const scope = [...(text.units || []).map((unit) => `Unit ${unit}`), ...(text.lessons || [])].join(", ");
        lines.push(
          `| ${text.id} | ${text.title} | ${text.author || ""} | ${scope || ""} | ${text.sourceStatus || ""} | ${moodleLink?.url || ""} | courseware/${course.course}/texts/${text.id}/ |`,
        );
      }
      lines.push("");
    }
  }
  lines.push("## Downloadable Texts Already Collected", "");
  const collectedRows = report.courses.flatMap((course) =>
    course.texts
      .filter((text) => text.materials.length)
      .map((text) => ({ course: course.course, text })),
  );
  if (!collectedRows.length) {
    lines.push("- None");
  } else {
    lines.push("| Course | Text | Author | Files |");
    lines.push("| --- | --- | --- | --- |");
    for (const row of collectedRows) {
      lines.push(
        `| ${row.course} | ${row.text.title} | ${row.text.author || ""} | ${row.text.materials.map((material) => material.path || material.label).join("<br>")} |`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const catalog = readJson(catalogPath);
const selectedCourses = requestedCourse
  ? catalog.courses.filter((course) => course.code === requestedCourse.toUpperCase())
  : catalog.courses;
const courses = selectedCourses.map(summarizeCourse).filter(Boolean);
const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    courses: courses.length,
    coursesWithTexts: courses.filter((course) => course.textEntries > 0).length,
    textEntries: courses.reduce((sum, course) => sum + course.textEntries, 0),
    downloadableTexts: courses.reduce((sum, course) => sum + course.downloadableTexts, 0),
    missingDownloadableTexts: courses.reduce((sum, course) => sum + course.missingDownloadableTexts, 0),
  },
  courses,
};

mkdirSync(deploymentRoot, { recursive: true });
const suffix = requestedCourse ? `-${requestedCourse.toUpperCase()}` : "";
writeFileSync(join(deploymentRoot, `text-material-status${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(join(deploymentRoot, `text-material-status${suffix}.md`), renderMarkdown(report), "utf8");
console.log(
  `Text material status: ${report.totals.coursesWithTexts} course(s) with texts, ${report.totals.downloadableTexts} downloadable, ${report.totals.missingDownloadableTexts} missing.`,
);
