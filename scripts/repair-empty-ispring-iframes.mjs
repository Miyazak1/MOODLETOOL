import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coursewareRoot = path.resolve(repoRoot, "..", "courseware");

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
};

const selectedCourse = getArg("--course").toUpperCase();
const dryRun = args.includes("--dry-run");

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function relativeFromPage(pagePath, targetPath) {
  return toPosix(path.relative(path.dirname(pagePath), targetPath));
}

function flowForSection(sectionLabel) {
  const text = String(sectionLabel || "").toLowerCase();
  if (text.includes("hands")) return "hands";
  if (text.includes("consolidation")) return "consolidation";
  if (text.includes("homework")) return "homework";
  if (text.includes("lesson")) return "lesson";
  return "";
}

function candidateScore(candidate, flow) {
  const haystack = `${candidate.role || ""} ${candidate.label || ""} ${candidate.path || ""} ${candidate.previewPath || ""}`.toLowerCase();
  if (!flow) return 0;
  if (flow === "hands") return haystack.includes("hands") ? 10 : 0;
  if (flow === "consolidation") return haystack.includes("consolidation") ? 10 : 0;
  if (flow === "homework") return haystack.includes("homework") ? 10 : 0;
  if (flow === "lesson") {
    if (haystack.includes("hands") || haystack.includes("consolidation") || haystack.includes("homework")) return 0;
    return haystack.includes("lesson") ? 10 : 2;
  }
  return 0;
}

function hasSource(attrs) {
  return /\s(?:src|data|data-src)\s*=\s*["'][^"']+["']/i.test(attrs);
}

function repairHtml(html, src) {
  let changed = 0;
  const next = html.replace(/<iframe\b([^>]*)><\/iframe>/gi, (match, attrs) => {
    if (hasSource(attrs)) return match;
    changed += 1;
    return `<iframe src="${src}"${attrs}></iframe>`;
  });
  return { html: next, changed };
}

function localIspringCandidates(lesson) {
  return (lesson.ispring || [])
    .map((item) => ({
      ...item,
      path: item.path || item.previewPath || "",
    }))
    .filter((item) => item.path && !/^https?:\/\//i.test(item.path));
}

function chooseCandidate(lesson, sectionLabel) {
  const candidates = localIspringCandidates(lesson);
  if (!candidates.length) return null;
  const flow = flowForSection(sectionLabel);
  const scored = candidates
    .map((candidate) => ({ candidate, score: candidateScore(candidate, flow) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length) return scored[0].candidate;
  return flow === "lesson" && candidates.length === 1 ? candidates[0] : null;
}

function repairCourse(courseCode) {
  const courseRoot = path.join(coursewareRoot, courseCode);
  const manifestPath = path.join(courseRoot, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const repaired = [];
  const skipped = [];

  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const section of lesson.bookSections || []) {
        if (!section.path) continue;
        const pagePath = path.join(courseRoot, section.path);
        if (!fs.existsSync(pagePath)) continue;
        const html = fs.readFileSync(pagePath, "utf8");
        if (!/<iframe\b[^>]*><\/iframe>/i.test(html)) continue;

        const candidate = chooseCandidate(lesson, section.sectionLabel || section.label);
        if (!candidate) {
          skipped.push({
            unit: unit.unit,
            lesson: lesson.lesson || lesson.title || lesson.label,
            section: section.sectionLabel || section.label,
            path: toPosix(section.path),
            reason: "no matching local iSpring candidate",
          });
          continue;
        }

        const targetPath = path.join(courseRoot, candidate.path);
        const src = relativeFromPage(pagePath, targetPath);
        const result = repairHtml(html, src);
        if (!result.changed) continue;
        if (!dryRun) fs.writeFileSync(pagePath, result.html);
        repaired.push({
          unit: unit.unit,
          lesson: lesson.lesson || lesson.title || lesson.label,
          section: section.sectionLabel || section.label,
          path: toPosix(section.path),
          src,
          iframes: result.changed,
        });
      }
    }
  }

  return { course: courseCode, repaired, skipped };
}

const courses = selectedCourse
  ? [selectedCourse]
  : fs.readdirSync(coursewareRoot).filter((name) => fs.existsSync(path.join(coursewareRoot, name, "course-manifest.json")));

const results = courses.map(repairCourse).filter(Boolean);
const summary = {
  dryRun,
  courses: results.length,
  repaired: results.reduce((sum, result) => sum + result.repaired.length, 0),
  skipped: results.reduce((sum, result) => sum + result.skipped.length, 0),
  byCourse: results
    .filter((result) => result.repaired.length || result.skipped.length)
    .map((result) => ({
      course: result.course,
      repaired: result.repaired.length,
      skipped: result.skipped.length,
      skippedSamples: result.skipped.slice(0, 5),
    })),
};

console.log(JSON.stringify(summary, null, 2));
if (summary.skipped) process.exitCode = 1;
