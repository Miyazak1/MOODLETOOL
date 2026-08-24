import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "AVI2O");
const manifestPath = path.join(courseRoot, "course-manifest.json");

const localizableExts = new Set(["doc", "docx", "pdf", "ppt", "pptx", "xls", "xlsx", "jpg", "jpeg", "png", "gif", "mp4", "webm", "mov", "mp3"]);

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/%([0-9a-f]{2})/gi, (match) => {
      try {
        return decodeURIComponent(match);
      } catch {
        return match;
      }
    });
}

function hashText(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function basenameFromUrl(url) {
  try {
    return decodeURIComponent(path.posix.basename(new URL(url).pathname)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  } catch {
    return `resource-${hashText(url)}`;
  }
}

function extensionOf(fileName) {
  return path.extname(fileName).slice(1).toLowerCase();
}

function uniqueByPath(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = toPosix(item.path || item.href || item.url || item.label || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function walkManifestActivities(manifest) {
  const records = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) {
        if (!item.path || !["html", "htm"].includes(String(item.type || "").toLowerCase())) continue;
        if (!String(item.category || "").startsWith("moodle_")) continue;
        records.push({ unit, lesson, item });
      }
    }
  }
  for (const item of manifest.courseDownloads || []) {
    if (!item.path || !["html", "htm"].includes(String(item.type || "").toLowerCase())) continue;
    if (!String(item.category || "").startsWith("moodle_")) continue;
    records.push({ unit: null, lesson: null, item });
  }
  return records;
}

function externalLinksFromHtml(html) {
  const links = [];
  const re = /\s(?:href|src)=["'](https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com[^"']+)["']/gi;
  for (const match of html.matchAll(re)) {
    const url = match[1].replaceAll("&amp;", "&");
    const name = basenameFromUrl(url);
    const ext = extensionOf(name);
    if (!localizableExts.has(ext)) continue;
    links.push({ url, name, ext });
  }
  return [...new Map(links.map((item) => [item.url, item])).values()];
}

async function download(url, targetPath) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",
    },
  });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    return { ok: false, status: response.status, contentType };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || /application\/xml/i.test(contentType)) {
    return { ok: false, status: response.status, contentType, bytes: bytes.length };
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, bytes);
  return { ok: true, status: response.status, contentType, bytes: bytes.length };
}

function ensureAttachmentStyles(html) {
  const css = `
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments h2 { font-size: 14px; color: #32445a; margin: 0 0 8px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .file-label { font-weight: 700; overflow-wrap: anywhere; }
    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }
    .file-button, .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }
    .file-button:hover, .file-action:hover { background: #eef6ff; }
`;
  return html.includes(".file-actions") ? html : html.replace("</style>", `${css}\n  </style>`);
}

function attachmentsSection(attachments) {
  const rows = (attachments || [])
    .filter((attachment) => attachment.path && attachment.href)
    .map((attachment) => {
      const label = escapeHtml(attachment.label || path.basename(attachment.path));
      const href = escapeHtml(attachment.href);
      return `<li><span class="file-label">${label}</span><span class="file-actions"><a class="file-button" href="${href}">查看</a><a class="file-button" href="${href}" download>下载</a></span></li>`;
    })
    .join("\n");
  return rows ? `<section class="attachments"><h2>附件</h2>\n<ul>\n${rows}\n</ul>\n</section>` : "";
}

function upsertAttachmentsSection(html, attachments) {
  const section = attachmentsSection(attachments);
  if (!section) return html;
  let next = ensureAttachmentStyles(html);
  if (/<section class="attachments">[\s\S]*?<\/section>/i.test(next)) {
    return next.replace(/<section class="attachments">[\s\S]*?<\/section>/i, section);
  }
  return next.replace("</article>", `      ${section}\n    </article>`);
}

function rewriteExternalLinks(html, replacements) {
  let next = html;
  for (const [url, href] of replacements) {
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(escapedUrl.replace(/&/g, "(?:&|&amp;)"), "g"), href);
  }
  return next;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fixedAt = new Date().toISOString();
const records = [];
const failures = [];
let downloaded = 0;
let htmlChanged = 0;

for (const { unit, lesson, item } of walkManifestActivities(manifest)) {
  const abs = path.join(courseRoot, item.path);
  if (!fs.existsSync(abs)) continue;
  const original = fs.readFileSync(abs, "utf8");
  const links = externalLinksFromHtml(original);
  if (!links.length && !(item.attachments || []).length) continue;

  const activityDir = path.dirname(abs);
  const activityRelDir = toPosix(path.dirname(item.path));
  const replacements = new Map();
  const attachments = [...(item.attachments || [])];
  const unavailableFiles = [...(item.unavailableFiles || [])];

  for (const link of links) {
    const existing = attachments.find((attachment) => attachment.sourceUrl === link.url || path.basename(attachment.path || "") === link.name);
    if (existing?.href) {
      replacements.set(link.url, existing.href);
      continue;
    }
    const localName = `${hashText(link.url)}-${link.name}`;
    const href = `files/${localName}`;
    const relPath = `${activityRelDir}/files/${localName}`;
    const targetPath = path.join(activityDir, "files", localName);
    const result = await download(link.url, targetPath);
    if (!result.ok) {
      failures.push({ label: item.label, path: item.path, url: link.url, status: result.status, contentType: result.contentType });
      if (!unavailableFiles.some((entry) => entry.url === link.url)) {
        unavailableFiles.push({
          url: link.url,
          status: result.status,
          reason: "External file returned an error during AVI2O attachment localization.",
        });
      }
      continue;
    }
    downloaded += 1;
    attachments.push({
      label: link.name,
      type: link.ext,
      path: relPath,
      href,
      bytes: result.bytes,
      source: "localized from AVI2O Moodle activity external file link",
      sourceUrl: link.url,
    });
    replacements.set(link.url, href);
  }

  item.attachments = uniqueByPath(attachments);
  if (unavailableFiles.length) item.unavailableFiles = unavailableFiles;
  else delete item.unavailableFiles;

  const nextHtml = upsertAttachmentsSection(rewriteExternalLinks(original, replacements), item.attachments);
  if (nextHtml !== original) {
    fs.writeFileSync(abs, nextHtml, "utf8");
    htmlChanged += 1;
    item.bytes = Buffer.byteLength(nextHtml);
  }

  if (links.length || item.attachments.length) {
    records.push({
      unit: unit?.title || "",
      lesson: lesson?.title || "",
      label: item.label,
      path: item.path,
      externalLinks: links.length,
      attachments: item.attachments.length,
      unavailableFiles: (item.unavailableFiles || []).length,
    });
  }
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  avi2oActivityAttachmentRepair: {
    fixedAt,
    basis: "Aligned AVI2O legacy Moodle activity pages with BBI2O: localizable files are mounted as attachments on the owning HTML activity page; unavailable external files are recorded instead of shown as local resources.",
    downloaded,
    htmlChanged,
    failures,
    records,
  },
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ course: "AVI2O", downloaded, htmlChanged, failures: failures.length, records }, null, 2));
