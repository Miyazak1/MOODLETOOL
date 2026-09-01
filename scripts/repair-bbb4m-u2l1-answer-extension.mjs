import { existsSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BBB4M");
const oldRel = "localized-moodle-activities/page/page-7271-Unit-2---Lesson-1-Answer/files/80886367b7-BBB4M-Unit-2-Lesson-1-International-Trade-Agreements-and-Organizations-Homework-Handout-Answers.";
const newRel = `${oldRel}docx`;
const manifestPath = join(courseRoot, "course-manifest.json");
const htmlPath = join(courseRoot, "localized-moodle-activities/page/page-7271-Unit-2---Lesson-1-Answer/index.html");

const oldAbs = join(courseRoot, oldRel);
const newAbs = join(courseRoot, newRel);

if (existsSync(oldAbs) && !existsSync(newAbs)) {
  renameSync(oldAbs, newAbs);
}

for (const path of [manifestPath, htmlPath]) {
  const before = readFileSync(path, "utf8");
  const after = before.replaceAll(oldRel, newRel);
  if (after !== before) writeFileSync(path, after, "utf8");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.sourceAudit ||= {};
manifest.sourceAudit.u2l1AnswerExtensionRepair = {
  patchedAt: new Date().toISOString(),
  oldPath: oldRel,
  newPath: newRel,
  note: "Recovered truncated .docx extension for BBB4M Unit 2 Lesson 1 homework answer attachment.",
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ repaired: true, oldRel, newRel }, null, 2));
