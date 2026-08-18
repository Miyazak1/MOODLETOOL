import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const deploymentRoot = join(projectRoot, "deployment");
const course = "HFA4U";
const queuePath = join(deploymentRoot, `${course}-extra-activity-media-localization-queue.json`);

const rows = [
  ["U01L03", "document", "Unit 1 Assignment 1", "https://www.esunnybrook.com/pluginfile.php/10333/mod_assign/introattachment/0/Assignment-1.docx?forcedownload=1"],
  ["U01L08", "document", "Unit 1 Assignment 2", "https://www.esunnybrook.com/pluginfile.php/10334/mod_assign/introattachment/0/Assignment-2.docx?forcedownload=1"],
  ["U01L10", "document", "Unit 1 Assignment 3", "https://www.esunnybrook.com/pluginfile.php/10335/mod_assign/introattachment/0/Assignment-3.docx?forcedownload=1"],
  ["U01L01", "document", "Unit 1 Lesson 1 Submission Handout", "https://www.esunnybrook.com/pluginfile.php/10337/mod_assign/intro/HFA4U-Unit-1-Lesson-1-Nutrients-and-Their-Purposes-Homework-Handout.docx"],
  ["U01L01", "pdf", "Unit 1 Lesson 1 Submission Guide", "https://www.esunnybrook.com/pluginfile.php/10337/mod_assign/intro/Step-by-step-guide.pdf"],
  ["U01L02", "document", "Unit 1 Lesson 2 Submission Handout", "https://www.esunnybrook.com/pluginfile.php/10339/mod_assign/intro/HFA4U-Unit-1-Lesson-2-Carbohydrates-Homework-Handout.docx"],
  ["U01L02", "pdf", "Unit 1 Lesson 2 Submission Guide", "https://www.esunnybrook.com/pluginfile.php/10339/mod_assign/intro/Step-by-step-guide.pdf"],
  ["U01L03", "document", "Unit 1 Lesson 3 Submission Handout", "https://www.esunnybrook.com/pluginfile.php/10341/mod_assign/intro/HFA4U-Unit-1-Lesson-3-Fats-and-Proteins-Homework-Handout.docx"],
  ["U01L03", "pdf", "Unit 1 Lesson 3 Submission Guide", "https://www.esunnybrook.com/pluginfile.php/10341/mod_assign/intro/Step-by-step-guide.pdf"],
  ["U01L01", "document", "Unit 1 Lesson 1 Answer", "https://www.esunnybrook.com/pluginfile.php/10338/mod_page/content/2/HFA4U-Unit1-Lesson-1-Nutrients-and-Their-Purposes-Homework-Handout.docx"],
  ["U01L02", "document", "Unit 1 Lesson 2 Answer", "https://www.esunnybrook.com/pluginfile.php/10340/mod_page/content/2/HFA4U-U1L2-ANSWER.docx"],
  ["U01L03", "document", "Unit 1 Lesson 3 Answer", "https://www.esunnybrook.com/pluginfile.php/10342/mod_page/content/2/HFA4U-U1L3-ANSWER.docx"],
];

function suggestedPath(url, kind) {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 10);
  const parsed = new URL(url);
  const name = decodeURIComponent(basename(parsed.pathname)) || `${kind}.bin`;
  return `localized-moodle/${kind}/${hash}-${name}`;
}

const items = rows.map(([lesson, kind, label, url]) => ({
  course,
  unit: 1,
  lesson,
  htmlPath: `lessons/${lesson}/book_sections/05-homework.html`,
  label,
  kind,
  attr: "href-src",
  active: true,
  url,
  suggestedPath: suggestedPath(url, kind),
}));

mkdirSync(dirname(queuePath), { recursive: true });
writeFileSync(queuePath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  coursewareRoot: join(projectRoot, "..", "courseware"),
  course,
  totals: {
    items: items.length,
    active: items.length,
    sourceOnly: 0,
    byKind: Object.fromEntries([...new Set(items.map((item) => item.kind))].sort().map((kind) => [kind, items.filter((item) => item.kind === kind).length])),
  },
  items,
}, null, 2)}\n`, "utf8");

console.log(`Wrote ${queuePath}`);
