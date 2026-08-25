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

const COURSE = safeCourse(readArg("--course"));
if (!COURSE) {
  console.error("Usage: node scripts/sync-course-duplicate-resource-attachments.mjs --course COURSE");
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", COURSE);
const manifestPath = path.join(courseRoot, "course-manifest.json");

const previewExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf"]);
const hiddenFileRowExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mp3", ".wav"]);

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function abs(relPath) {
  return path.join(courseRoot, ...toPosix(relPath).split("/"));
}

function stripHashPrefix(fileName) {
  return fileName.replace(/^[a-f0-9]{10}-/i, "");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attachmentKey(attachment) {
  return toPosix(attachment.path || attachment.downloadPath || attachment.previewPath || attachment.label);
}

function normalizeAttachment(attachment) {
  const pathRel = toPosix(attachment.path || attachment.downloadPath || "");
  const ext = path.posix.extname(pathRel || attachment.label || "").toLowerCase();
  const next = {
    ...attachment,
    type: attachment.type || ext.replace(/^\./, "") || "file",
    category: attachment.category || "moodle_file",
    role: attachment.role || "attachment",
  };
  if (pathRel) {
    next.path = pathRel;
    next.downloadPath = toPosix(attachment.downloadPath || pathRel);
    const previewRel = toPosix(attachment.previewPath || (previewExtensions.has(ext) ? `previews-html/${pathRel}.html` : ""));
    if (previewRel && fs.existsSync(abs(previewRel))) next.previewPath = previewRel;
  }
  return next;
}

function localFileAttachmentsForPage(pageRel) {
  const pageDir = path.posix.dirname(toPosix(pageRel));
  const filesRel = path.posix.join(pageDir, "files");
  const filesDir = abs(filesRel);
  if (!fs.existsSync(filesDir) || !fs.statSync(filesDir).isDirectory()) return [];

  const attachments = [];
  for (const entry of fs.readdirSync(filesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.posix.extname(entry.name).toLowerCase();
    if (hiddenFileRowExtensions.has(ext)) continue;
    const rel = path.posix.join(filesRel, entry.name);
    const previewRel = previewExtensions.has(ext) ? `previews-html/${rel}.html` : rel;
    const stat = fs.statSync(abs(rel));
    const attachment = {
      label: stripHashPrefix(entry.name),
      type: ext.replace(/^\./, "") || "file",
      category: "moodle_file",
      role: "attachment",
      path: rel,
      bytes: stat.size,
      downloadPath: rel,
      inferredFromLocalFiles: true,
    };
    if (fs.existsSync(abs(previewRel))) attachment.previewPath = previewRel;
    attachments.push(attachment);
  }
  return attachments;
}

function mergeAttachments(...attachmentLists) {
  const byKey = new Map();
  for (const list of attachmentLists) {
    for (const attachment of list || []) {
      const normalized = normalizeAttachment(attachment);
      const key = attachmentKey(normalized);
      if (!key) continue;
      byKey.set(key, { ...(byKey.get(key) || {}), ...normalized });
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const a = String(left.label || left.path || "");
    const b = String(right.label || right.path || "");
    return a.localeCompare(b);
  });
}

function collectResourceRefs(node, refs = []) {
  if (!node || typeof node !== "object") return refs;
  if (Array.isArray(node)) {
    for (const item of node) collectResourceRefs(item, refs);
    return refs;
  }
  if (node.path && typeof node.path === "string") refs.push(node);
  for (const value of Object.values(node)) collectResourceRefs(value, refs);
  return refs;
}

function refreshHtmlRefMetadata(ref) {
  const rel = toPosix(ref.path);
  if (!/\.html?$/i.test(rel) || !fs.existsSync(abs(rel))) return;
  const html = fs.readFileSync(abs(rel), "utf8");
  ref.bytes = Buffer.byteLength(html);
  ref.textPreview = stripTags(html).slice(0, 240);
}

function removeFalseMissingMessage(pageRel, attachments) {
  if (!attachments.length || !/\.html?$/i.test(pageRel) || !fs.existsSync(abs(pageRel))) return false;
  const filePath = abs(pageRel);
  const html = fs.readFileSync(filePath, "utf8");
  const next = html.replace(
    /<p>\s*No localized answer file is currently indexed for this item\.\s*<\/p>/gi,
    "",
  );
  if (next === html) return false;
  fs.writeFileSync(filePath, next, "utf8");
  return true;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const refs = collectResourceRefs(manifest);
const refsByPath = new Map();

for (const ref of refs) {
  const rel = toPosix(ref.path);
  if (!rel) continue;
  const group = refsByPath.get(rel) || [];
  group.push(ref);
  refsByPath.set(rel, group);
}

const report = {
  course: COURSE,
  duplicatePathGroups: 0,
  refsUpdated: 0,
  pagesCleaned: 0,
  changedPaths: [],
};

for (const [rel, group] of refsByPath) {
  const localAttachments = /\.html?$/i.test(rel) ? localFileAttachmentsForPage(rel) : [];
  const merged = mergeAttachments(localAttachments, ...group.map((ref) => ref.attachments || []));
  if (!merged.length) continue;
  if (group.length > 1) report.duplicatePathGroups += 1;

  let pathChanged = false;
  for (const ref of group) {
    const before = JSON.stringify(ref.attachments || []);
    const after = JSON.stringify(merged);
    if (before !== after) {
      ref.attachments = merged;
      report.refsUpdated += 1;
      pathChanged = true;
    }
  }
  if (removeFalseMissingMessage(rel, merged)) {
    report.pagesCleaned += 1;
    pathChanged = true;
  }
  if (pathChanged) {
    for (const ref of group) refreshHtmlRefMetadata(ref);
    report.changedPaths.push(rel);
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  [`${COURSE.toLowerCase()}DuplicateAttachmentSync20260825`]: {
    syncedAt: new Date().toISOString(),
    duplicatePathGroups: report.duplicatePathGroups,
    refsUpdated: report.refsUpdated,
    pagesCleaned: report.pagesCleaned,
    rule: "All duplicate manifest resources with the same local path share the same non-media local file attachments.",
  },
};
manifest.generatedAt = new Date().toISOString();

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const reportPath = path.join(repoRoot, "deployment", `${COURSE}-duplicate-attachment-sync-report.json`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
