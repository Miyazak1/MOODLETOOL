import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const inboxRoot = join(projectRoot, "inbox");
const deploymentRoot = join(projectRoot, "deployment");
const course = "HFA4U";
const queuePath = join(deploymentRoot, `${course}-draftfile-media-localization-queue.json`);
const raw = JSON.parse(readFileSync(join(inboxRoot, `moodle-book-raw-${course}-U01.json`), "utf8"));

function classify(url) {
  const lower = url.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.includes(".docx") || lower.includes(".doc")) return "document";
  return "resource";
}

function suggestedPath(url, kind) {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 10);
  const name = decodeURIComponent(basename(new URL(url).pathname)) || `${kind}.bin`;
  return `localized-moodle/${kind}/${hash}-${name}`;
}

const seen = new Set();
const items = [];
for (const lesson of raw.lessons || []) {
  const lessonId = `U01L${String(Number(lesson.lesson)).padStart(2, "0")}`;
  for (const section of lesson.sections || []) {
    for (const ref of section.page?.refs || []) {
      const url = String(ref.url || "").replaceAll("&amp;", "&");
      if (!/^https:\/\/eclasssunnybrook\.com\/draftfile\.php\//i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const kind = classify(url);
      items.push({
        course,
        unit: 1,
        lesson: lessonId,
        htmlPath: `lessons/${lessonId}/book_sections/${String(section.sectionIndex || 1).padStart(2, "0")}.html`,
        label: `${section.normalizedLabel || section.label || "Moodle draft file"} - ${lesson.title || lessonId}`,
        kind,
        attr: `${ref.attr || "href"}-src`,
        active: true,
        url,
        suggestedPath: suggestedPath(url, kind),
      });
    }
  }
}

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

console.log(JSON.stringify({ queuePath, items: items.length }, null, 2));
