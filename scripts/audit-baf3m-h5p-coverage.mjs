import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const courseRoot = resolve(projectRoot, "..", "courseware", "BAF3M");
const manifest = JSON.parse(readFileSync(join(courseRoot, "course-manifest.json"), "utf8"));

const problems = [];
let expected = 0;
let actual = 0;

for (const file of readdirSync(join(projectRoot, "inbox")).filter((name) => /^moodle-book-raw-BAF3M-U\d+\.json$/.test(name)).sort()) {
  const raw = JSON.parse(readFileSync(join(projectRoot, "inbox", file), "utf8"));
  for (const rawLesson of raw.lessons || []) {
    const lessonId = `U${String(raw.unit).padStart(2, "0")}L${String(rawLesson.lesson).padStart(2, "0")}`;
    const manifestLesson = (manifest.units || [])
      .find((unit) => unit.unit === raw.unit)
      ?.lessons?.find((lesson) => lesson.id === lessonId);
    for (const rawSection of rawLesson.sections || []) {
      const label = rawSection.normalizedLabel || rawSection.label || "";
      const ids = [...String(rawSection.page?.html || "").replaceAll("&amp;", "&").matchAll(/welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed&id=(\d+)/gi)].map((match) => match[1]);
      if (!ids.length) continue;
      expected += ids.length;
      const manifestSection = (manifestLesson?.bookSections || []).find((section) => section.sectionLabel === label);
      const html = manifestSection ? readFileSync(join(courseRoot, manifestSection.path), "utf8") : "";
      const count = (html.match(/class="embedded-h5p"/g) || []).length;
      actual += count;
      if (count !== ids.length) {
        problems.push({ lessonId, section: label, expected: ids.length, actual: count, ids, path: manifestSection?.path || "" });
      }
    }
  }
}

console.log(JSON.stringify({ expected, actual, problems }, null, 2));
if (problems.length) process.exitCode = 1;
