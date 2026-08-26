import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BOH4M";
const courseRoot = resolve(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const rawFiles = [
  join(projectRoot, "inbox", "moodle-book-raw-BOH4M-U04.json"),
  join(projectRoot, "inbox", "moodle-book-raw-BOH4M-U05.json"),
];
const dryRun = process.argv.includes("--dry-run");
const backupRoot = join(courseRoot, "_backups", `${new Date().toISOString().replace(/[:.]/g, "-")}-before-boh4m-quizalize-consolidation-repair`);

function text(value) {
  return String(value ?? "");
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function decodeEntities(value) {
  return text(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function externalCard(url) {
  return `<div class="embedded-external-card" data-frame-blocked-reason="quizalize-external"><strong>External interactive activity</strong><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open activity in a new tab</a></div>`;
}

function rawConsolidationSources() {
  const byKey = new Map();
  for (const rawFile of rawFiles) {
    if (!existsSync(rawFile)) continue;
    const raw = JSON.parse(readFileSync(rawFile, "utf8"));
    for (const lesson of raw.lessons || []) {
      for (const section of lesson.sections || []) {
        if (!/consolidation/i.test(text(section.label || section.normalizedLabel))) continue;
        const html = text(section.page?.html);
        const quizalize = [...html.matchAll(/<iframe\b[^>]*(?:src|data-src)=["']([^"']*quizalize\.com[^"']+)["'][^>]*>/gi)]
          .map((match) => decodeEntities(match[1]));
        if (!quizalize.length) continue;
        byKey.set(`${raw.unit}:${lesson.lesson}`, {
          unit: raw.unit,
          lesson: lesson.lesson,
          title: lesson.title || "",
          source: section.url || "",
          urls: [...new Set(quizalize)],
        });
      }
    }
  }
  return byKey;
}

function replaceEmptyIframe(html, url) {
  let changed = false;
  const next = html.replace(/<p\b([^>]*)>\s*(?:<br\s*\/?>\s*)?<iframe\b([^>]*)>\s*<\/iframe>\s*<\/p>/i, (full, pAttrs, iframeAttrs) => {
    if (/\bsrc\s*=|\bdata-src\s*=/i.test(iframeAttrs)) return full;
    changed = true;
    return externalCard(url);
  }).replace(/<iframe\b([^>]*)>\s*<\/iframe>/i, (full, iframeAttrs) => {
    if (changed || /\bsrc\s*=|\bdata-src\s*=/i.test(iframeAttrs)) return full;
    changed = true;
    return externalCard(url);
  });
  return { html: next, changed };
}

function backupFile(relativePath) {
  const source = join(courseRoot, relativePath);
  const target = join(backupRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const rawSources = rawConsolidationSources();
const patched = [];
const skipped = [];

for (const unit of manifest.units || []) {
  if (![4, 5].includes(Number(unit.unit))) continue;
  for (const lesson of unit.lessons || []) {
    const source = rawSources.get(`${unit.unit}:${lesson.lesson}`);
    if (!source) continue;
    for (const section of lesson.bookSections || []) {
      if (!/consolidation/i.test(text(section.sectionLabel || section.label || section.path))) continue;
      const rel = section.path;
      const abs = join(courseRoot, rel);
      if (!existsSync(abs)) {
        skipped.push({ unit: unit.unit, lesson: lesson.lesson, path: rel, reason: "page-missing" });
        continue;
      }
      const html = readFileSync(abs, "utf8");
      if (/quizalize\.com/i.test(html) || /data-frame-blocked-reason=["']quizalize-external["']/i.test(html)) {
        skipped.push({ unit: unit.unit, lesson: lesson.lesson, path: rel, reason: "already-has-quizalize" });
        continue;
      }
      const result = replaceEmptyIframe(html, source.urls[0]);
      if (!result.changed) {
        skipped.push({ unit: unit.unit, lesson: lesson.lesson, path: rel, reason: "no-empty-iframe" });
        continue;
      }
      if (!dryRun) {
        backupFile(rel);
        writeFileSync(abs, result.html, "utf8");
      }
      patched.push({ unit: unit.unit, lesson: lesson.lesson, title: lesson.title || source.title, path: rel, url: source.urls[0], source: source.source });
    }
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.boh4mQuizalizeConsolidationRepair = {
  repairedAt: new Date().toISOString(),
  dryRun,
  patchedCount: patched.length,
  note: "Quizalize consolidation iframes are external activities without Moodle/H5P packages; empty localized iframes were replaced by ENG3U-style external activity cards.",
  patched,
};

if (!dryRun && patched.length) {
  backupFile("course-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

const report = {
  generatedAt: new Date().toISOString(),
  course,
  dryRun,
  patched,
  skipped,
};

if (!dryRun) {
  const reportPath = join(projectRoot, "deployment", "BOH4M-quizalize-consolidation-repair-report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));
