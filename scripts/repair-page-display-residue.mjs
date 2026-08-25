import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const coursewareRoot = path.join(workspaceRoot, "courseware");

const requested = String(readArg("--courses") || readArg("--course") || "")
  .split(",")
  .map(safeCourse)
  .filter(Boolean);

if (!requested.length) {
  console.error("Usage: node scripts/repair-page-display-residue.mjs --courses ENG1D,SNC2D");
  process.exit(1);
}

function collectPages(manifest) {
  const pages = [];
  const seen = new Set();
  function add(ref) {
    const rel = toPosix(ref?.path || "");
    if (!/\.html?$/i.test(rel) || seen.has(rel)) return;
    seen.add(rel);
    pages.push(ref);
  }
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const section of lesson.bookSections || []) add(section);
    }
  }
  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const rel = toPosix(value.path || "");
    if (/^localized-moodle-activities\/[^/]+\/[^/]+\/index\.html$/i.test(rel) || /^course-sections\/[^/]+\/index\.html$/i.test(rel)) {
      add(value);
    }
    for (const nested of Object.values(value)) visit(nested);
  }
  visit(manifest);
  return pages;
}

function cleanResidue(html) {
  let next = String(html || "");
  for (let i = 0; i < 4; i += 1) {
    const before = next;
    next = next
      .replace(/<center\b[^>]*>\s*<div\b[^>]*\bclass=["'][^"']*\bsubmissionlinks\b[^"']*["'][\s\S]*?<\/div>\s*<\/center>/gi, "")
      .replace(/<div\b[^>]*\bclass=["'][^"']*\bsubmissionlinks\b[^"']*["'][\s\S]*?<\/div>/gi, "")
      .replace(/<div\b[^>]*\bclass=["'][^"']*\b(?:quizinfo|quizattemptcounts|quizattempt|fileuploadsubmissiontime|gradingtable)\b[^"']*["'][\s\S]*?<\/div>/gi, "")
      .replace(/<h([1-6])([^>]*)>\s*<strong([^>]*)>\s*<h\1\b[^>]*>([\s\S]*?)<\/h\1>\s*<\/strong>\s*<\/h\1>/gi, "<h$1$2><strong$3>$4</strong></h$1>")
      .replace(/<h([1-6])\b[^>]*>\s*<strong>\s*<h([1-6])\b([^>]*)>\s*<strong>([\s\S]*?)<\/strong>\s*<\/h\2>\s*<\/strong>\s*<\/h\1>/gi, "<h$2$3><strong>$4</strong></h$2>")
      .replace(/<h([1-6])\b[^>]*>\s*(?:<strong\b[^>]*>\s*)?(?:<b\b[^>]*>\s*)?(?:<br\s*\/?>|&nbsp;|\s)*(?:<\/b>\s*)?(?:<\/strong>\s*)?<\/h\1>/gi, "")
      .replace(/<p\b[^>]*>\s*(?:<strong\b[^>]*>\s*)?(?:<b\b[^>]*>\s*)?(?:<br\s*\/?>|&nbsp;|\s)*(?:<\/b>\s*)?(?:<\/strong>\s*)?<\/p>/gi, "");
    if (next === before) break;
  }
  return next;
}

const report = {
  courses: [],
  patchedPages: 0,
};

for (const course of requested) {
  const courseRoot = path.join(coursewareRoot, course);
  const manifestPath = path.join(courseRoot, "course-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    report.courses.push({ course, status: "missing-manifest", patchedPages: 0 });
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pages = collectPages(manifest);
  const patched = [];
  for (const ref of pages) {
    const rel = toPosix(ref.path);
    const filePath = path.join(courseRoot, ...rel.split("/"));
    if (!fs.existsSync(filePath)) continue;
    const before = fs.readFileSync(filePath, "utf8");
    const after = cleanResidue(before);
    if (after === before) continue;
    fs.writeFileSync(filePath, after, "utf8");
    ref.bytes = Buffer.byteLength(after);
    ref.textPreview = stripTags(after).slice(0, 720);
    patched.push(rel);
  }
  if (patched.length) {
    manifest.sourceAudit = {
      ...(manifest.sourceAudit || {}),
      pageDisplayResidueRepair20260825: {
        repairedAt: new Date().toISOString(),
        patchedPages: patched.length,
        rule: "Remove Moodle platform controls, empty headings, and malformed nested headings from localized pages.",
      },
    };
    manifest.generatedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  report.courses.push({ course, status: "ok", scannedPages: pages.length, patchedPages: patched.length, samples: patched.slice(0, 10) });
  report.patchedPages += patched.length;
}

const reportPath = path.join(repoRoot, "deployment", `page-display-residue-repair-${Date.now()}.json`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
