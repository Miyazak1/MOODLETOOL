import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const deploymentRoot = join(projectRoot, "deployment");
const courseArg = readArg("--course");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textWords(value) {
  return normalizeText(value)
    .split(" ")
    .filter((word) => word.length > 2);
}

function collectResources(manifest) {
  const items = [];
  const add = (item, scope) => {
    if (item?.path) items.push({ ...item, scope });
  };
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) add(item, `${lesson.id}-download`);
    }
  }
  return items;
}

function extractWithPython(path) {
  const script = join(projectRoot, "tools", "extract_file_text.py");
  const result = spawnSync("python", [script, path], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) return "";
  return result.stdout;
}

function extractText(path) {
  const ext = extname(path).toLowerCase();
  if ([".txt", ".md", ".html", ".htm"].includes(ext)) {
    return readFileSync(path, "utf8");
  }
  if ([".docx", ".pdf"].includes(ext)) {
    return extractWithPython(path);
  }
  return "";
}

function scoreCandidate(text, entry) {
  const normalized = normalizeText(text);
  const titleWords = textWords(entry.title);
  const authorWords = textWords(entry.author);
  const titleHits = titleWords.filter((word) => normalized.includes(word)).length;
  const authorHits = authorWords.filter((word) => normalized.includes(word)).length;
  const lengthScore = Math.min(Math.floor(normalized.length / 1500), 8);
  return titleHits * 4 + authorHits * 2 + lengthScore;
}

function isLikelyWorksheet(item, text) {
  const haystack = normalizeText(`${item.label || ""} ${item.path || ""} ${text.slice(0, 800)}`);
  return (
    haystack.includes("response questions") ||
    haystack.includes("question answer") ||
    haystack.includes("questions") ||
    haystack.includes("worksheet") ||
    haystack.includes("activity sheet")
  );
}

function hasTitleSignal(text, entry) {
  const normalized = normalizeText(text.slice(0, 2500));
  const title = normalizeText(entry.title);
  if (title && normalized.includes(title)) return true;
  return textWords(entry.title).filter((word) => normalized.includes(word)).length >= Math.min(textWords(entry.title).length, 2);
}

function firstSnippet(text, entry) {
  const normalizedTitle = textWords(entry.title)[0];
  const index = normalizedTitle ? text.toLowerCase().indexOf(normalizedTitle) : -1;
  const start = index >= 0 ? Math.max(index - 120, 0) : 0;
  return text.slice(start, start + 420).replace(/\s+/g, " ").trim();
}

function auditCourse(course) {
  const courseRoot = join(coursewareRoot, course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = readJson(manifestPath);
  const missingTexts = (manifest.texts || []).filter((text) => !(text.materials || []).length);
  const resources = collectResources(manifest).filter((item) => [".docx", ".pdf", ".txt", ".md"].includes(extname(item.path).toLowerCase()));
  const candidates = [];

  for (const item of resources) {
    const filePath = join(courseRoot, item.path);
    if (!existsSync(filePath)) continue;
    const text = extractText(filePath);
    if (!text || text.length < 2000 || isLikelyWorksheet(item, text)) continue;
    for (const entry of missingTexts) {
      if (!hasTitleSignal(text, entry)) continue;
      const score = scoreCandidate(text, entry);
      if (score < 10) continue;
      candidates.push({
        course,
        textId: entry.id,
        title: entry.title,
        author: entry.author,
        score,
        chars: text.length,
        scope: item.scope,
        label: item.label,
        path: item.path,
        snippet: firstSnippet(text, entry),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.chars - a.chars);
  return {
    course,
    missingTexts: missingTexts.map((text) => ({
      id: text.id,
      title: text.title,
      author: text.author,
    })),
    candidates,
  };
}

function renderMarkdown(report) {
  const lines = [`# Text Material Candidate Audit`, "", `Generated: ${report.generatedAt}`, ""];
  for (const course of report.courses) {
    lines.push(`## ${course.course}`, "");
    lines.push(`Missing text downloads: ${course.missingTexts.length}`);
    lines.push("");
    if (!course.candidates.length) {
      lines.push("- No local candidates found.");
      lines.push("");
      continue;
    }
    lines.push("| Text | Score | Chars | Scope | File | Snippet |");
    lines.push("| --- | ---: | ---: | --- | --- | --- |");
    for (const item of course.candidates.slice(0, 40)) {
      lines.push(
        `| ${item.title} | ${item.score} | ${item.chars} | ${item.scope} | ${toPosix(item.path)} | ${item.snippet.replaceAll("|", "\\|")} |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const courses = courseArg
  ? [courseArg.toUpperCase()]
  : readJson(join(projectRoot, "public", "course-catalog.json")).courses.map((course) => course.code);
const report = {
  generatedAt: new Date().toISOString(),
  courses: courses.map(auditCourse).filter(Boolean),
};

mkdirSync(deploymentRoot, { recursive: true });
const suffix = courseArg ? `-${courseArg.toUpperCase()}` : "";
writeFileSync(join(deploymentRoot, `text-material-candidates${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(join(deploymentRoot, `text-material-candidates${suffix}.md`), renderMarkdown(report), "utf8");

const candidateCount = report.courses.reduce((sum, course) => sum + course.candidates.length, 0);
console.log(`Text material candidate audit: ${report.courses.length} course(s), ${candidateCount} candidate(s).`);
