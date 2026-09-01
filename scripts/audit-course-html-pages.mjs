import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course");
const limit = Number(readArg("--limit") || 80);
const requestedKind = readArg("--kind");

if (!course) fail("Usage: node scripts/audit-course-html-pages.mjs --course COURSE [--limit 80]");

const courseRoot = join(workspaceRoot, "courseware", course);
if (!existsSync(courseRoot)) fail(`Missing course root: ${courseRoot}`);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) files.push(path);
  }
  return files;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function localRefs(html, absPath) {
  const refs = [];
  for (const match of html.matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1].replaceAll("&amp;", "&").trim();
    if (
      !raw ||
      raw.startsWith("#") ||
      /^(?:https?:|mailto:|tel:|javascript:|data:|blob:)/i.test(raw)
    ) {
      continue;
    }
    if (raw.startsWith("/")) continue;
    const withoutHash = raw.split("#")[0].split("?")[0];
    if (!withoutHash) continue;
    try {
      refs.push({
        raw,
        abs: resolve(dirname(absPath), decodeURIComponent(withoutHash)),
      });
    } catch {
      refs.push({
        raw,
        abs: resolve(dirname(absPath), withoutHash),
      });
    }
  }
  return refs;
}

function classify(rel) {
  const normalized = toPosix(rel);
  if (normalized.startsWith("previews-html/") && normalized.endsWith(".docx.html")) return "docxPreviewHtml";
  if (normalized.startsWith("previews-html/")) return "otherPreviewHtml";
  if (normalized.includes("/ispring-localized/") || normalized.startsWith("ispring-localized/")) return "ispringHtml";
  if (normalized.startsWith("localized-moodle/h5p/")) return "h5pEmbedHtml";
  return "pureHtml";
}

const FLAG_PATTERNS = [
  ["loginPage", /Welcome to Sunnybrook|Enter your details to log in|Forgot your password|logintoken|用户名|密码/i],
  ["completionRequirements", /Completion requirements/i],
  ["gradingSummary", /Grading summary|Hidden from students|Participants|Needs grading|Submitted\s+\d+/i],
  ["activityNavigation", /Previous Activity|Next Activity|Prev Section|Next Section/],
  ["attemptState", /Your attempts|Attempt 1|Status In progress|Continue the last preview|Attempts allowed/i],
  ["unavailableAttachment", /Unavailable Attachments|was not packaged because the source did not return a valid file/i],
  ["moodleUrl", /https?:\/\/www\.esunnybrook\.com|https?:\/\/esunnybrook\.com|\/pluginfile\.php/i],
  ["localizedLinkRemoved", /data-localized-link=["'](?:removed|[^"']*-unavailable)["']/i],
  ["brokenImageLikely", /<img\b(?=[^>]*\bdata-localized-link=["'](?:removed|[^"']*-unavailable)["'])|<img\b[^>]*(?:src=["']\s*["']|src=["']#["'])/i],
  ["attachmentTimestamp", /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4},\s+\d{1,2}:\d{2}\s+(?:AM|PM)\b/i],
  ["duplicateGeneratedAttachments", /<h2>\s*Attachments\s*<\/h2>[\s\S]*\bfileuploadsubmission\b/i],
];

const DOCX_PREVIEW_PATTERNS = [
  ["conversionIssue", /docx-preview-error|encrypted-or-unsupported-docx|unsupported docx|preview unavailable|could not generate/i],
  ["moodleUrl", /https?:\/\/www\.esunnybrook\.com|https?:\/\/esunnybrook\.com|\/pluginfile\.php/i],
  ["brokenImageLikely", /<img\b(?=[^>]*(?:src=["']\s*["']|src=["']#["']))/i],
];

function audit(absPath) {
  const rel = toPosix(relative(courseRoot, absPath));
  const html = readFileSync(absPath, "utf8");
  const htmlWithoutComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const text = stripTags(htmlWithoutComments);
  const kind = classify(rel);
  const patterns = kind === "docxPreviewHtml" ? DOCX_PREVIEW_PATTERNS : FLAG_PATTERNS;
  const flags = patterns.filter(([, pattern]) => pattern.test(htmlWithoutComments) || pattern.test(text)).map(([flag]) => flag);
  const missingLocalRefs = localRefs(htmlWithoutComments, absPath)
    .filter((ref) => !existsSync(ref.abs))
    .map((ref) => ref.raw);
  if (missingLocalRefs.length) flags.push("missingLocalRefs");
  return {
    path: rel,
    kind,
    bytes: Buffer.byteLength(html),
    textLength: text.length,
    flags,
    missingLocalRefs: missingLocalRefs.slice(0, 10),
    title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() || "",
    snippet: text.slice(0, 180),
  };
}

const records = walk(courseRoot).map(audit);
const groups = Map.groupBy(records, (record) => record.kind);

function summarize(kind) {
  const list = groups.get(kind) || [];
  const flagged = list.filter((record) => record.flags.length);
  const flagCounts = {};
  for (const record of flagged) {
    for (const flag of record.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  }
  return {
    kind,
    total: list.length,
    flagged: flagged.length,
    flagCounts,
    examples: flagged.slice(0, limit).map((record) => ({
      path: record.path,
      flags: record.flags,
      missingLocalRefs: record.missingLocalRefs,
      bytes: record.bytes,
      snippet: record.snippet,
    })),
  };
}

const output = {
  course,
  courseRoot: toPosix(courseRoot),
  summary: {
    htmlTotal: records.length,
    byKind: Object.fromEntries([...groups.entries()].map(([kind, list]) => [kind, list.length])),
  },
  pureHtml: summarize("pureHtml"),
  docxPreviewHtml: summarize("docxPreviewHtml"),
  otherPreviewHtml: summarize("otherPreviewHtml"),
  h5pEmbedHtml: summarize("h5pEmbedHtml"),
  ispringHtml: {
    total: (groups.get("ispringHtml") || []).length,
    note: "Skipped from content-page audit because these are iSpring runtime/player pages.",
  },
};

if (requestedKind) {
  if (!output[requestedKind]) fail(`Unknown --kind ${requestedKind}`);
  console.log(JSON.stringify({ course, [requestedKind]: output[requestedKind] }, null, 2));
} else {
  console.log(JSON.stringify(output, null, 2));
}
