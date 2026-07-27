import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const deploymentRoot = join(projectRoot, "deployment");
const inboxRoot = join(projectRoot, "inbox");
const reportJsonPath = join(deploymentRoot, "moodle-media-localization-queue.json");
const reportMdPath = join(deploymentRoot, "moodle-media-localization-queue.md");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return join(workspaceRoot, course.manifestUrl.slice(1));
}

function localCourseRoot(course) {
  if (!course.baseUrl?.startsWith("/courseware/")) return null;
  return join(workspaceRoot, course.baseUrl.slice(1));
}

function collectHtmlResources(manifest) {
  const records = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of [...(lesson.downloads || []), ...(lesson.bookSections || [])]) {
        if (item.path && [".html", ".htm"].includes(extname(item.path).toLowerCase())) {
          records.push({ unit: unit.unit, lesson: lesson.id, item });
        }
      }
    }
  }
  return records;
}

function collectLegacyLessonHtmlResources(courseRoot) {
  const root = join(courseRoot, "moodle-html");
  if (!existsSync(root)) return [];
  const records = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const absolute = join(current, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      const match = /^U(?<unit>\d+)L(?<lesson>\d+)\.html$/i.exec(entry);
      if (!match) continue;
      records.push({
        unit: Number(match.groups.unit),
        lesson: `U${String(Number(match.groups.unit)).padStart(2, "0")}L${String(Number(match.groups.lesson)).padStart(2, "0")}`,
        item: {
          label: `Legacy Moodle lesson page ${entry}`,
          path: toPosix(relative(courseRoot, absolute)),
        },
      });
    }
  }
  return records;
}

function normalizeMoodleUrl(raw) {
  if (!raw) return "";
  const trimmed = raw.replaceAll("&amp;", "&").trim();
  if (trimmed.startsWith("/")) return `https://www.esunnybrook.com${trimmed}`;
  return trimmed;
}

function classify(url, attr) {
  const lower = url.toLowerCase();
  if (lower.includes("/h5p/") || lower.includes(".h5p")) return "h5p";
  if (lower.includes(".mp4")) return "video";
  if (lower.includes(".docx") || lower.includes(".doc")) return "document";
  if (lower.includes(".pdf")) return "pdf";
  if (attr === "script-src") return "script";
  if (attr === "iframe-src") return "iframe";
  return "resource";
}

function isDownloadableMoodleUrl(url) {
  const normalized = normalizeMoodleUrl(url);
  if (!normalized.startsWith("https://www.esunnybrook.com/")) return false;
  if (normalized.includes("/pluginfile.php/")) return true;
  try {
    const parsed = new URL(normalized);
    const nested = parsed.searchParams.get("url") || "";
    return parsed.pathname.endsWith("/h5p/embed.php") && nested.includes("/pluginfile.php/") && nested.includes(".h5p");
  } catch {
    return false;
  }
}

function suggestedPath(url, kind) {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 10);
  const parsed = new URL(url);
  const name = decodeURIComponent(basename(parsed.pathname)) || `${kind}.bin`;
  return `localized-moodle/${kind}/${hash}-${name}`;
}

function extractRefs(html) {
  const refs = [];
  const attrPattern = /\b(?<attr>href|src|poster|action)\s*=\s*["'](?<url>https:\/\/www\.esunnybrook\.com\/[^"']+|\/pluginfile\.php[^"']*)/gi;
  const inertPattern = /\b(?<attr>data-moodle-source)\s*=\s*["'](?<url>https:\/\/www\.esunnybrook\.com\/[^"']+|\/pluginfile\.php[^"']*)/gi;
  const cssPattern = /url\(\s*["']?(?<url>https:\/\/www\.esunnybrook\.com\/[^)"']+|\/pluginfile\.php[^)"']*)/gi;
  for (const match of html.matchAll(attrPattern)) {
    refs.push({ attr: `${match.groups.attr}-src`, active: true, url: normalizeMoodleUrl(match.groups.url) });
  }
  for (const match of html.matchAll(inertPattern)) {
    refs.push({ attr: "data-moodle-source", active: false, url: normalizeMoodleUrl(match.groups.url) });
  }
  for (const match of html.matchAll(cssPattern)) {
    refs.push({ attr: "css-url", active: true, url: normalizeMoodleUrl(match.groups.url) });
  }
  return refs;
}

function collectRawScrapeResources(courseCode) {
  if (!existsSync(inboxRoot)) return [];
  const prefix = `moodle-book-raw-${courseCode}-U`;
  const records = [];
  for (const entry of readdirSync(inboxRoot)) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".json")) continue;
    const raw = readJson(join(inboxRoot, entry));
    for (const lesson of raw.lessons || []) {
      const lessonNumber = Number(lesson.lesson || 0);
      const lessonId = `U${String(Number(raw.unit)).padStart(2, "0")}L${String(lessonNumber).padStart(2, "0")}`;
      const htmlPath = `moodle-html/unit-${String(Number(raw.unit)).padStart(2, "0")}/${lessonId}.html`;
      for (const section of lesson.sections || []) {
        for (const ref of section.page?.refs || []) {
          const url = normalizeMoodleUrl(ref.url || "");
          if (!isDownloadableMoodleUrl(url)) continue;
          records.push({
            unit: Number(raw.unit),
            lesson: lessonId,
            item: {
              label: `${section.normalizedLabel || section.label || "Moodle section"} - ${lesson.title || lessonId}`,
              path: htmlPath,
            },
            rawRef: {
              attr: `${ref.attr || "href"}-src`,
              active: ref.attr !== "data-moodle-source",
              url,
            },
          });
        }
      }
    }
  }
  return records;
}

function renderMarkdown(report) {
  const rows = report.items.slice(0, 200).map((item) =>
    `| ${item.course} | ${item.lesson} | ${item.kind} | ${item.active ? "active" : "source"} | ${item.url.replaceAll("|", "\\|")} | ${item.suggestedPath} |`,
  );
  return `# Moodle Media Localization Queue

Generated: ${report.generatedAt}

Items: ${report.items.length}

| Course | Lesson | Kind | Mode | Source URL | Suggested Local Path |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n") || "| - | - | - | - | - | - |"}
`;
}

if (!existsSync(catalogPath)) {
  console.error(`Missing course catalog: ${catalogPath}`);
  process.exit(1);
}

const catalog = readJson(catalogPath);
const byKey = new Map();

for (const course of catalog.courses || []) {
  const manifestPath = localManifestPath(course);
  const courseRoot = localCourseRoot(course);
  if (!manifestPath || !courseRoot || !existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  for (const resource of [...collectRawScrapeResources(course.code), ...collectHtmlResources(manifest), ...collectLegacyLessonHtmlResources(courseRoot)]) {
    const htmlPath = join(courseRoot, resource.item.path);
    const refs = resource.rawRef
      ? [resource.rawRef]
      : existsSync(htmlPath)
        ? extractRefs(readFileSync(htmlPath, "utf8"))
        : [];
    for (const ref of refs) {
      const kind = classify(ref.url, ref.attr);
      if (kind === "h5p" && !isDownloadableMoodleUrl(ref.url)) continue;
      const key = `${course.code}|${resource.item.path}|${ref.url}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          course: course.code,
          unit: resource.unit,
          lesson: resource.lesson,
          htmlPath: toPosix(relative(courseRoot, htmlPath)),
          label: resource.item.label || "",
          kind,
          attr: ref.attr,
          active: ref.active,
          url: ref.url,
          suggestedPath: suggestedPath(ref.url, kind),
        });
      }
    }
  }
}

const items = [...byKey.values()].sort((a, b) =>
  `${a.course}|${a.unit}|${a.lesson}|${a.kind}|${a.url}`.localeCompare(`${b.course}|${b.unit}|${b.lesson}|${b.kind}|${b.url}`),
);

const report = {
  generatedAt: new Date().toISOString(),
  coursewareRoot,
  totals: {
    items: items.length,
    active: items.filter((item) => item.active).length,
    sourceOnly: items.filter((item) => !item.active).length,
    byKind: Object.fromEntries(
      [...new Set(items.map((item) => item.kind))].sort().map((kind) => [kind, items.filter((item) => item.kind === kind).length]),
    ),
  },
  items,
};

mkdirSync(deploymentRoot, { recursive: true });
writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(reportMdPath, renderMarkdown(report), "utf8");

console.log(`Wrote ${reportJsonPath}`);
console.log(`Wrote ${reportMdPath}`);
console.log(`Moodle localization items ${report.totals.items}; active ${report.totals.active}; source-only ${report.totals.sourceOnly}`);
