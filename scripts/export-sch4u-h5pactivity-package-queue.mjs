import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SCH4U");
const manifestPath = join(courseRoot, "course-manifest.json");
const queuePath = join(projectRoot, "deployment", "sch4u-h5pactivity-package-queue.json");
const mdPath = join(projectRoot, "deployment", "sch4u-h5pactivity-package-queue.md");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("\\/", "/")
    .replaceAll("\\u0026", "&");
}

function findPackageUrl(activityPath) {
  const activityRoot = join(courseRoot, activityPath.replaceAll("/", "\\"));
  const filesRoot = join(activityRoot, "files");
  if (!existsSync(filesRoot)) return "";
  for (const entry of readdirSync(filesRoot)) {
    if (!/embed\.php$/i.test(entry)) continue;
    const html = decodeEntities(readFileSync(join(filesRoot, entry), "utf8"));
    const direct = html.match(/https:\/\/www\.esunnybrook\.com\/pluginfile\.php\/[^"'<>\s]+?\.h5p/);
    if (direct) return direct[0];
    const embedded = html.match(/https:\/\/www\.esunnybrook\.com\/h5p\/embed\.php\?url=([^"'<>\s]+)/);
    if (embedded) {
      try {
        return decodeURIComponent(new URL(`https://www.esunnybrook.com/h5p/embed.php?url=${embedded[1]}`).searchParams.get("url") || "");
      } catch {
        return decodeURIComponent(embedded[1]);
      }
    }
  }
  return "";
}

const manifest = readJson(manifestPath);
const items = [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.downloads || []) {
      if (item.category !== "moodle_h5pactivity" || !item.path) continue;
      const activityDir = item.path.replace(/\/index\.html$/i, "");
      const packageUrl = findPackageUrl(activityDir);
      if (!packageUrl) continue;
      const name = decodeURIComponent(basename(new URL(packageUrl).pathname)) || `${lesson.id}-exit-card.h5p`;
      const h5pEmbedUrl = `https://www.esunnybrook.com/h5p/embed.php?url=${encodeURIComponent(packageUrl)}`;
      items.push({
        course: "SCH4U",
        unit: unit.unit,
        lesson: lesson.id,
        htmlPath: item.path,
        label: `${item.label} package`,
        kind: "h5p",
        attr: "iframe-src",
        active: true,
        url: h5pEmbedUrl,
        suggestedPath: `localized-moodle/h5p-activity/${hashText(packageUrl)}-${name}`,
      });
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  items,
  totals: {
    rows: items.length,
    courses: 1,
    lessons: new Set(items.map((item) => item.lesson)).size,
  },
};

writeFileSync(queuePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(
  mdPath,
  `# SCH4U H5P Activity Package Queue

Generated: ${report.generatedAt}

Items: ${items.length}

| Lesson | Label | Package |
| --- | --- | --- |
${items.map((item) => `| ${item.lesson} | ${item.label.replaceAll("|", "\\|")} | ${item.suggestedPath} |`).join("\n") || "| - | - | - |"}
`,
  "utf8",
);

console.log(JSON.stringify({
  queue: toPosix(queuePath),
  items: items.length,
  lessons: report.totals.lessons,
}, null, 2));
