import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const courseRoot = join(WORKSPACE_ROOT, "courseware", "MCV4U");
const activityRoot = join(courseRoot, "localized-moodle-activities");
const manifestPath = join(courseRoot, "course-manifest.json");

function walkHtml(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walkHtml(full));
    if (stat.isFile() && entry.toLowerCase() === "index.html") files.push(full);
  }
  return files;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCss(html) {
  let out = String(html || "")
    .replace(/^\s*\.actions \{[^\n]*\n/gm, "")
    .replace(/^\s*\.button \{[^\n]*\n/gm, "")
    .replace(/^\s*\.button:hover \{[^\n]*\n/gm, "")
    .replace(/^\s*\.attachments li \{([^\n]*)\}\n/gm, "    .attachments li {$1}\n")
    .replace(/^\s*\.attachments li \{([^\n]*)\}\n/gm, (match) => match.includes("justify-content") ? match : match.replace("display: flex;", "display: flex; justify-content: space-between;"));

  if (!/\.file-label\s*\{/.test(out)) {
    out = out.replace("</style>", "    .file-label { overflow-wrap: anywhere; }\n  </style>");
  }
  if (!/\.file-actions\s*\{/.test(out)) {
    out = out.replace("</style>", "    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }\n  </style>");
  }
  if (!/\.file-action\s*\{/.test(out)) {
    out = out.replace("</style>", "    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }\n    .file-action:hover { background: #eef6ff; }\n  </style>");
  }
  out = out.replace(/\.actions \{ flex-wrap: wrap; \}/g, ".file-actions { flex-wrap: wrap; }");
  return out;
}

function parseAttachmentRows(sectionHtml) {
  const rows = [];
  const liPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = liPattern.exec(sectionHtml))) {
    const li = match[1];
    const links = [...li.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((linkMatch) => {
      const attrs = linkMatch[1] || "";
      return {
        attrs,
        label: stripTags(linkMatch[2]),
        href: attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || "",
        download: /\bdownload\b/i.test(attrs)
      };
    });
    const download = links.find((link) => link.download) || links.at(-1);
    const view = links.find((link) => !link.download) || download;
    const firstSpan = li.match(/<span\b(?![^>]*class=["'](?:actions|file-actions)["'])[^>]*>([\s\S]*?)<\/span>/i);
    const label = stripTags(firstSpan?.[1] || li.replace(/<span\b[^>]*class=["'](?:actions|file-actions)["'][\s\S]*?<\/span>/i, ""));
    const href = download?.href || view?.href || "";
    if (!label || !href) continue;
    rows.push({ label, href });
  }
  return rows;
}

function renderSection(rows) {
  const items = rows
    .map((row) => `<li><span class="file-label">${row.label}</span><span class="file-actions"><a class="file-action" href="${row.href}">查看</a><a class="file-action" href="${row.href}" download>下载</a></span></li>`)
    .join("");
  return `<section class="attachments"><h2>Files</h2><ul>${items}</ul></section>`;
}

let pagesScanned = 0;
let pagesChanged = 0;
let attachmentSections = 0;

if (existsSync(activityRoot)) {
  for (const file of walkHtml(activityRoot)) {
    pagesScanned += 1;
    const original = readFileSync(file, "utf8");
    let html = normalizeCss(original);
    html = html.replace(/<section class="attachments">[\s\S]*?<\/section>/gi, (section) => {
      const rows = parseAttachmentRows(section);
      if (!rows.length) return section;
      attachmentSections += 1;
      return renderSection(rows);
    });
    if (html !== original) {
      writeFileSync(file, html, "utf8");
      pagesChanged += 1;
    }
  }
}

let manifestPreviewUpdates = 0;
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const patchPreview = (value) => {
    if (typeof value === "string" && value.includes("View Download")) {
      manifestPreviewUpdates += 1;
      return value.replaceAll("View Download", "查看 下载");
    }
    return value;
  };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      if (key === "textPreview") node[key] = patchPreview(node[key]);
      else visit(node[key]);
    }
  };
  visit(manifest);
  manifest.generatedAt = new Date().toISOString();
  manifest.sourceAudit = {
    ...(manifest.sourceAudit || {}),
    mcv4uActivityAttachmentDisplayNormalization: {
      patchedAt: new Date().toISOString(),
      pagesScanned,
      pagesChanged,
      attachmentSections,
      manifestPreviewUpdates,
      baseline: "MDM4U localized Moodle activity attachments use file-label/file-actions/file-action with 查看/下载 labels."
    }
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ pagesScanned, pagesChanged, attachmentSections, manifestPreviewUpdates }, null, 2));
