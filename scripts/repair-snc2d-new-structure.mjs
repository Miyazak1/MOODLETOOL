import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SNC2D";
const moodleCourseId = 67;
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

loadEnvFile(join(projectRoot, ".env"));

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
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

function sanitizeSegment(value) {
  return (
    String(value || "resource")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "resource"
  );
}

function filenameFromUrl(url) {
  const parsed = new URL(url);
  return decodeURIComponent(basename(parsed.pathname)) || `${hashText(url)}.bin`;
}

function extensionFor(filename, contentType = "") {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext && ext !== "php") return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/powerpoint|presentationml/i.test(contentType)) return "pptx";
  if (/excel|spreadsheetml/i.test(contentType)) return "xlsx";
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  if (/image\/gif/i.test(contentType)) return "gif";
  if (/svg/i.test(contentType)) return "svg";
  if (/html/i.test(contentType)) return "html";
  return "bin";
}

function validateSignature(type, buffer, contentType = "") {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  const startsWithJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const startsWithPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (type === "docx" && !startsWithPk && !startsWithOle) throw new Error("downloaded docx is not an OOXML or legacy Word package");
  if (["pptx", "xlsx"].includes(type) && !startsWithPk) throw new Error(`downloaded ${type} is not an OOXML package`);
  if (type === "doc" && !startsWithOle) throw new Error("downloaded file is not a legacy DOC");
  if (type === "pdf" && !startsWithPdf) throw new Error("downloaded file is not a PDF");
  if (["jpg", "jpeg"].includes(type) && !startsWithJpg && !/image\/jpeg/i.test(contentType)) throw new Error("downloaded file is not a JPEG");
  if (type === "png" && !startsWithPng && !/image\/png/i.test(contentType)) throw new Error("downloaded file is not a PNG");
}

class CookieJar {
  constructor(initialCookie) {
    this.cookies = new Map();
    for (const part of String(initialCookie || "").split(";")) {
      const index = part.indexOf("=");
      if (index > 0) this.cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
  }

  store(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      for (const cookieText of String(value).split(/,(?=\s*[^;,]+=)/g)) {
        const [pair] = cookieText.split(";");
        const index = pair.indexOf("=");
        if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar(process.env.MOODLE_COOKIE || "");

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-snc2d-resource-repair/1.0");
  const isMoodle = new URL(url).hostname.toLowerCase() === "www.esunnybrook.com";
  const cookie = isMoodle ? jar.header() : "";
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  if (isMoodle) jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login failed.");
}

function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString();
    const text = stripTags(match[2]);
    const key = `${text}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ text, href, html: match[0] });
  }
  return links;
}

function extractPluginfileUrls(html, baseUrl) {
  const urls = new Set();
  for (const match of html.matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi)) {
    try {
      const url = new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString();
      if (/\/pluginfile\.php\/1\/theme_remui\/logo\//i.test(url)) continue;
      urls.add(url);
    } catch {
      // Ignore malformed links.
    }
  }
  return [...urls];
}

function extractSectionCard(html, sectionId) {
  const marker = `id="collapseSection-${sectionId}"`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const before = html.lastIndexOf("<div", start);
  const next = html.indexOf('id="collapseSection-', start + marker.length);
  return html.slice(before >= 0 ? before : start, next >= 0 ? next : html.length);
}

function extractSectionByNumber(html, sectionNumber) {
  const marker = `id="section-${sectionNumber}"`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const before = html.lastIndexOf("<li", start);
  const next = html.indexOf('id="section-', start + marker.length);
  return html.slice(before >= 0 ? before : start, next >= 0 ? next : html.length);
}

function sectionBodyHtml(html, sectionId) {
  const card = extractSectionCard(html, sectionId) || html;
  const pieces = [];
  for (const match of card.matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const content = match[1].trim();
    const text = stripTags(content);
    if (!text) continue;
    if (/Skip to main content|Site navigation|Activity List|View course Enrolment page|Documentation for this page/i.test(text)) continue;
    pieces.push(content);
  }
  if (pieces.length) return pieces.join("\n");
  const summary = /<div\b[^>]*class=["'][^"']*\bsummarytext\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(card)?.[1];
  return summary || "";
}

function sectionBodyHtmlByNumber(html, sectionNumber, requiredPattern) {
  const section = extractSectionByNumber(html, sectionNumber);
  const candidates = [...section.matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => match[1].trim())
    .filter((content) => {
      const text = stripTags(content);
      if (!text && !/<(?:iframe|img)\b/i.test(content)) return false;
      if (/Skip to main content|Site navigation|Activity List|View course Enrolment page|Documentation for this page/i.test(text)) return false;
      return !requiredPattern || requiredPattern.test(text) || requiredPattern.test(content);
    });
  return candidates[0] || "";
}

function fileActionsHtml(item, hrefPrefix = "") {
  const viewHref = item.previewPath ? `${hrefPrefix}${item.previewPath}` : item.href || `${hrefPrefix}${item.path}`;
  const downloadHref = item.href || `${hrefPrefix}${item.path}`;
  return `<div class="file-row"><span>${htmlEscape(item.label || basename(item.path))}</span><span class="actions"><a href="${htmlEscape(viewHref, true)}">View</a><a href="${htmlEscape(downloadHref, true)}" download>Download</a></span></div>`;
}

function pageActionsHtml(item, hrefPrefix = "") {
  const viewHref = item.previewPath || item.path;
  return `<div class="file-row"><span>${htmlEscape(item.label || basename(item.path))}</span><span class="actions"><a href="${htmlEscape(hrefPrefix + viewHref, true)}">Open Page</a></span></div>`;
}

function shellHtml(title, bodyHtml, attachments = [], options = {}) {
  const attachmentHtml = attachments.length
    ? `<section class="attachments"><h2>Files</h2>${attachments.map((item) => fileActionsHtml(item, options.hrefPrefix || "")).join("\n")}</section>`
    : "";
  const relatedHtml = options.related?.length
    ? `<section class="attachments"><h2>Activities</h2>${options.related.map((item) => pageActionsHtml(item, options.hrefPrefix || "")).join("\n")}</section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    h2 { font-size: 18px; margin: 18px 0 10px; }
    a { color: #00396f; font-weight: 700; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .file-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; border: 1px solid #d9e2ef; border-radius: 6px; padding: 10px 12px; margin: 8px 0; background: #fbfdff; }
    .actions { display: inline-flex; gap: 8px; flex: 0 0 auto; }
    .actions a { border: 1px solid #8db0d7; border-radius: 6px; padding: 6px 10px; background: #f4f9ff; text-decoration: none; }
    img { max-width: 100%; height: auto; }
    .moodle-content img { display: block; margin: 10px 0 20px; }
    table { border-collapse: collapse; max-width: 100%; }
    td, th { border: 1px solid #d9e2ef; padding: 6px 8px; vertical-align: top; }
    @media (max-width: 640px) { .file-row { align-items: flex-start; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <div class="moodle-content">
${bodyHtml || ""}
      </div>
      ${relatedHtml}
      ${attachmentHtml}
    </article>
  </main>
</body>
</html>
`;
}

async function downloadFile(url, targetRelDir) {
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (/text\/html/i.test(contentType) && /logintoken|Enter your details to log in|Forgot your password/i.test(buffer.toString("utf8", 0, Math.min(buffer.length, 2000)))) {
    throw new Error(`Moodle login page returned for attachment: ${url}`);
  }
  let filename = filenameFromUrl(response.url || url);
  const type = extensionFor(filename, contentType);
  const currentExt = extname(filename).replace(".", "").toLowerCase();
  if (type !== "bin" && currentExt !== type) filename = `${sanitizeSegment(basename(filename, extname(filename)))}.${type}`;
  validateSignature(type, buffer, contentType);
  const rel = toPosix(join(targetRelDir, `${hashText(url)}-${sanitizeSegment(filename)}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (!existsSync(abs) || statSync(abs).size !== buffer.length) writeFileSync(abs, buffer);
  const href = toPosix(relative(join(courseRoot, targetRelDir.replace(/\/files$/i, "")), abs));
  return {
    label: filename,
    type,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: rel,
    href,
    bytes: buffer.length,
    source: url,
  };
}

async function localizeHtmlEmbeds(html, baseUrl, targetRelDir) {
  let rewritten = html || "";
  const localized = [];
  const attrUrls = [];
  for (const match of rewritten.matchAll(/<(img|iframe)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*(?:>\s*<\/iframe>|>)/gi)) {
    const [, tag, raw] = match;
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), baseUrl).toString();
      if (/^(?:https?:)?\/\//i.test(raw) || /(?:pluginfile|draftfile)\.php/i.test(raw)) attrUrls.push({ tag: tag.toLowerCase(), raw, url, markup: match[0] });
    } catch {
      // Ignore non-URL attributes.
    }
  }

  for (const item of attrUrls) {
    try {
      if (/docs\.google\.com\/spreadsheets\/d\/e\/[^/]+\/pubhtml/i.test(item.url)) {
        const title = item.url.includes("1vQKUqyr") ? "SNC2D Grade Breakdown" : "SNC2D Lesson Overview";
        const rel = toPosix(join(targetRelDir, "embeds", `${hashText(item.url)}.html`));
        const abs = join(courseRoot, rel);
        let body = "";
        try {
          const response = await request(item.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          body = await response.text();
          const sheetUrlMatch = /pageUrl:\s*"([^"]+)"/i.exec(body);
          if (sheetUrlMatch) {
            const sheetUrl = sheetUrlMatch[1]
              .replaceAll("\\/", "/")
              .replaceAll("\\x3d", "=")
              .replaceAll("\\u003d", "=");
            const sheetResponse = await request(sheetUrl);
            if (sheetResponse.ok) body = await sheetResponse.text();
          }
        } catch (error) {
          if (!existsSync(abs)) throw error;
          body = readFileSync(abs, "utf8");
        }
        body = cleanGoogleSheetHtml(body, title);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, body, "utf8");
        const href = toPosix(relative(join(courseRoot, targetRelDir), abs));
        rewritten = rewritten.replaceAll(item.raw, href);
        localized.push({ source: item.url, path: rel, type: "html", role: "embedded_sheet" });
        continue;
      }

      if (/(?:pluginfile|draftfile)\.php|\/draftfile\.php\//i.test(item.url)) {
        const file = await downloadFile(item.url, `${targetRelDir}/files`);
        if (file.type === "html") throw new Error("downloaded source returned HTML instead of an embeddable file");
        rewritten = rewritten.replaceAll(item.raw, file.href);
        localized.push({ ...file, role: "embedded_file" });
      }
    } catch (error) {
      localized.push({
        source: item.url,
        status: "localize-failed",
        reason: String(error.message || error),
      });
      const fallback = item.tag === "iframe"
        ? `<p><strong>Embedded Moodle resource unavailable locally:</strong> ${htmlEscape(item.url)}</p>`
        : "";
      rewritten = rewritten.replace(item.markup, fallback);
    }
  }

  return { html: rewritten, localized };
}

function previewPathFor(item) {
  const type = String(item.type || extname(item.path).slice(1)).toLowerCase();
  if (!["doc", "docx", "pptx", "pdf", "txt", "html", "htm"].includes(type)) return null;
  if (["html", "htm", "pdf", "txt"].includes(type)) return null;
  const preview = `previews-html/${item.path}.html`;
  return existsSync(join(courseRoot, preview)) ? preview : null;
}

function directResourceEntry(label, file, role, source) {
  const entry = {
    label,
    type: file.type,
    category: "course_document",
    role,
    source,
    path: file.path,
    bytes: file.bytes,
  };
  const preview = previewPathFor(entry);
  if (preview) entry.previewPath = preview;
  return entry;
}

function textPreviewFromHtml(html) {
  return stripTags(html).slice(0, 600);
}

function cleanGoogleSheetHtml(html, title = "Embedded Course Table") {
  const styles = [...String(html || "").matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1].replace(/@import[^;]+;/gi, ""))
    .join("\n");
  const table = /<table\b[^>]*class=["'][^"']*\bwaffle\b[^"']*["'][\s\S]*?<\/table>/i.exec(html)?.[0];
  const content = table || String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #fff; color: #102033; }
    .sheet-wrap { max-width: 100%; overflow: auto; padding: 8px; }
    table { border-collapse: collapse; width: max-content; min-width: 100%; }
    th, td { border: 1px solid #d9e2ef; padding: 4px 6px; vertical-align: middle; }
    .row-header-wrapper, .row-header-shim, .header-shim { color: #6b7280; font-size: 11px; }
${styles}
  </style>
</head>
<body>
  <div class="sheet-wrap">
${content}
  </div>
</body>
</html>
`;
}

function pngDimensions(abs) {
  const buffer = readFileSync(abs);
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return {};
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function localImageEntry(label, rel, source) {
  const abs = join(courseRoot, rel);
  if (!existsSync(abs)) return null;
  return {
    label,
    type: extname(rel).slice(1).toLowerCase(),
    category: "localized_moodle_attachment",
    role: "course_overview_image",
    path: rel,
    bytes: statSync(abs).size,
    source,
    ...pngDimensions(abs),
  };
}

function replaceOverviewEmbedsWithImages(html, images) {
  let output = html || "";
  for (const image of images) {
    if (!image) continue;
    const src = image.path.split("/").slice(-2).join("/");
    const imageHtml = `<p><img class="img-fluid" role="presentation" src="${htmlEscape(src, true)}" alt="${htmlEscape(image.label, true)}" width="${image.width || ""}" height="${image.height || ""}"></p>`;
    if (/grade breakdown/i.test(image.label)) {
      output = output.replace(/<p><iframe\b[^>]*src=["']embeds\/a9bdca0ad6\.html["'][\s\S]*?<\/iframe><br><br><\/p>/i, imageHtml);
    } else if (/lesson overview/i.test(image.label)) {
      output = output.replace(/<p><iframe\b[^>]*src=["']embeds\/01b9608114\.html["'][\s\S]*?<\/iframe><br><br><\/p>/i, imageHtml);
    }
  }
  return output;
}

function relativePrefixToCourseRoot(relDir) {
  const depth = toPosix(relDir).split("/").filter(Boolean).length;
  return "../".repeat(depth);
}

function activityBodyHtml(html) {
  const pieces = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => match[1].trim())
    .filter((content) => {
      const text = stripTags(content);
      return text && !/Skip to main content|Site navigation|Activity List|Course - SNC2D|Submission status|Grading status|Last modified|File submissions|Uploaded files/i.test(text);
    });
  return pieces.join("\n");
}

async function localizeActivityPage({ label, mod, id, role, targetRelDir, teacherUse }) {
  const source = `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`;
  const response = await request(source);
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  const attachments = [];
  const seen = new Set();
  for (const url of extractPluginfileUrls(html, source)) {
    if (seen.has(url)) continue;
    seen.add(url);
    attachments.push(await downloadFile(url, `${targetRelDir}/files`));
  }
  for (const attachment of attachments) {
    const preview = previewPathFor(attachment);
    if (preview) attachment.previewPath = preview;
  }
  let body = activityBodyHtml(html);
  if (!body && attachments.length) body = `<p>${htmlEscape(label)} files from Moodle.</p>`;
  const rel = `${targetRelDir}/index.html`;
  mkdirSync(dirname(join(courseRoot, rel)), { recursive: true });
  writeFileSync(join(courseRoot, rel), shellHtml(label, body, attachments, { hrefPrefix: relativePrefixToCourseRoot(targetRelDir) }), "utf8");
  return {
    label,
    type: "html",
    category: `moodle_${mod}`,
    role,
    path: rel,
    bytes: statSync(join(courseRoot, rel)).size,
    source,
    moodleActivityId: id,
    teacherUse,
    attachments,
    textPreview: textPreviewFromHtml(`${label} ${body}`),
  };
}

function allManifestItems(manifest) {
  const items = [];
  for (const item of manifest.courseDownloads || []) items.push(item);
  for (const item of manifest.teacherResources || []) items.push(item);
  for (const text of manifest.texts || []) {
    items.push(text);
    for (const material of text.materials || []) items.push(material);
  }
  for (const unit of manifest.units || []) {
    for (const value of Object.values(unit.unitResources || {})) {
      if (Array.isArray(value)) items.push(...value);
      else if (value) items.push(value);
    }
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) items.push(lesson.lessonPlan);
      for (const key of ["downloads", "lessonText", "textExports", "ispring", "videos"]) {
        for (const item of lesson[key] || []) items.push(item);
      }
    }
  }
  return items;
}

function updateBytes(item) {
  if (!item?.path) return;
  const abs = join(courseRoot, item.path);
  if (existsSync(abs)) item.bytes = statSync(abs).size;
  for (const attachment of item.attachments || []) updateBytes(attachment);
}

function upsertByRole(list, item) {
  const index = list.findIndex((candidate) => candidate.role === item.role || candidate.label === item.label);
  if (index >= 0) list[index] = { ...list[index], ...item };
  else list.push(item);
}

function upsertByRoleAndPath(list, item) {
  const index = list.findIndex((candidate) => candidate.role === item.role || (item.path && candidate.path === item.path) || candidate.label === item.label);
  if (index >= 0) list[index] = { ...list[index], ...item };
  else list.push(item);
}

function cleanExistingActivityHtml(manifest) {
  let rewritten = 0;
  for (const item of allManifestItems(manifest)) {
    if (!item?.path || item.type !== "html") continue;
    const abs = join(courseRoot, item.path);
    if (!existsSync(abs)) continue;
    const original = readFileSync(abs, "utf8");
    if (!/Skip to main content|Site navigation|Activity List|coursePrevious|page-wrapper|navbar-brand/i.test(original)) {
      item.textPreview ||= textPreviewFromHtml(original);
      continue;
    }
    let body = "";
    const noOverflow = [...original.matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .map((match) => match[1].trim())
      .filter((html) => {
        const text = stripTags(html);
        return text && !/Skip to main content|Site navigation|Activity List|Course - SNC2D|Previous Activity|Next Activity/i.test(text);
      });
    if (noOverflow.length) body = noOverflow.join("\n");
    if (!body && item.attachments?.length) body = `<p>${htmlEscape(item.label)} files from Moodle.</p>`;
    if (!body) body = `<p>${htmlEscape(item.label)}.</p>`;
    writeFileSync(abs, shellHtml(item.label, body, item.attachments || []), "utf8");
    item.textPreview = textPreviewFromHtml(body);
    rewritten += 1;
  }
  return rewritten;
}

function findFileByName(namePart) {
  const matches = [];
  const stack = [courseRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase().includes(namePart.toLowerCase())) matches.push(full);
    }
  }
  const needle = namePart.toLowerCase();
  const exact = matches.find((full) => basename(full).toLowerCase() === needle);
  const nonPreview = matches.find((full) => !toPosix(relative(courseRoot, full)).startsWith("previews-html/"));
  return exact || nonPreview ? toPosix(relative(courseRoot, exact || nonPreview)) : "";
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseDownloads ||= [];
manifest.teacherResources ||= [];
manifest.courseSections ||= [];

const coursePageUrl = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}`;
const coursePageResponse = await request(coursePageUrl);
const coursePageHtml = await coursePageResponse.text();
if (!coursePageResponse.ok) throw new Error(`HTTP ${coursePageResponse.status}: ${coursePageUrl}`);

const overviewUrl = `${coursePageUrl}&section=1`;
const finalUrl = `${coursePageUrl}&section=6`;
const introductionUrl = `${coursePageUrl}#collapseSection-727`;
const overviewPageResponse = await request(overviewUrl);
const overviewPageHtml = await overviewPageResponse.text();
if (!overviewPageResponse.ok) throw new Error(`HTTP ${overviewPageResponse.status}: ${overviewUrl}`);
let overviewBody = sectionBodyHtmlByNumber(overviewPageHtml, 1, /About the Course|Grade Breakdown|Lesson Overview/i) || sectionBodyHtml(coursePageHtml, 728);
const finalBody = sectionBodyHtml(coursePageHtml, 733);

const overviewLinks = extractLinks(extractSectionCard(coursePageHtml, 728), overviewUrl);
const finalLinks = extractLinks(extractSectionCard(coursePageHtml, 733), finalUrl);

const introductionDir = "course-sections/introduction";
const overviewDir = "course-sections/course-overview";
const finalDir = "course-sections/final-exam-culminating";
mkdirSync(join(courseRoot, introductionDir, "files"), { recursive: true });
mkdirSync(join(courseRoot, overviewDir, "files"), { recursive: true });
mkdirSync(join(courseRoot, finalDir, "files"), { recursive: true });

const localizedOverview = await localizeHtmlEmbeds(overviewBody, overviewUrl, overviewDir);
overviewBody = localizedOverview.html.replace(/<h[1-6]\b[^>]*>\s*<\/h[1-6]>/gi, "");
for (const stale of ["de9801d336-index.html", "de9801d336-index.php"]) {
  const abs = join(courseRoot, overviewDir, "files", stale);
  if (existsSync(abs)) unlinkSync(abs);
}
const overviewImageFiles = [
  localImageEntry(
    "SNC2D Grade Breakdown.png",
    `${overviewDir}/files/snc2d-grade-breakdown.png`,
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKUqyr2RNrbqLdL_WLUUT_mNtC1nCCPxyjLxoxBumYpISz57X9IdfUeRFbjpEM6w/pubhtml",
  ),
  localImageEntry(
    "SNC2D Lesson Overview.png",
    `${overviewDir}/files/snc2d-lesson-overview.png`,
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRgzlAA8Gu8zEEDbssjC1LWJhf1HCKGJoAt_87o2w4S3KpNJqiaQczu9aNgH0YeLQ/pubhtml",
  ),
].filter(Boolean);
overviewBody = replaceOverviewEmbedsWithImages(overviewBody, overviewImageFiles);

const labTemplate = manifest.courseDownloads.find((item) => item.role === "course_template");
const introductionFiles = labTemplate?.path ? [{ ...labTemplate }] : [];

const outlineActivity = await localizeActivityPage({
  label: "SNC2D Course Outline",
  mod: "assign",
  id: "6992",
  role: "course_outline",
  targetRelDir: "localized-moodle-activities/assign/course-6992-snc2d-course-outline",
  teacherUse: "course_setup",
});
const learningLog = manifest.courseDownloads.find((item) => item.role === "learning_log");
const overviewActivities = [outlineActivity, learningLog].filter((item) => item?.path);

const finalPluginUrls = [
  "https://www.esunnybrook.com/pluginfile.php/7158/course/section/733/SNC2D-Culminating.pdf",
  ...extractPluginfileUrls(extractSectionCard(coursePageHtml, 733), finalUrl),
  ...finalLinks.map((link) => link.href).filter((href) => /SNC2D-Culminating\.pdf/i.test(href)),
];
const finalFiles = [];
const seenFinalUrls = new Set();
for (const url of finalPluginUrls) {
  if (seenFinalUrls.has(url)) continue;
  seenFinalUrls.add(url);
  try {
    const file = await downloadFile(url, `${finalDir}/files`);
    finalFiles.push(file);
  } catch (error) {
    manifest.sourceAudit ||= {};
    manifest.sourceAudit.failedExternalResources ||= [];
    manifest.sourceAudit.failedExternalResources.push({
      url,
      localHtml: `${finalDir}/index.html`,
      status: "download-failed",
      reason: String(error.message || error),
    });
  }
}

const finalExamDocx = findFileByName("SNC2D-Final-Exam.docx");
if (finalExamDocx) {
  const finalExamEntry = {
    label: "SNC2D-Final-Exam.docx",
    type: "docx",
    category: "localized_moodle_attachment",
    role: "attachment",
    path: finalExamDocx,
    bytes: statSync(join(courseRoot, finalExamDocx)).size,
    source: "https://www.esunnybrook.com/mod/assign/view.php?id=9493",
  };
  const preview = previewPathFor(finalExamEntry);
  if (preview) finalExamEntry.previewPath = preview;
  finalFiles.push(finalExamEntry);
}

writeFileSync(
  join(courseRoot, introductionDir, "index.html"),
  shellHtml("Introduction", "", introductionFiles, { hrefPrefix: "../../" }),
  "utf8",
);
writeFileSync(
  join(courseRoot, overviewDir, "index.html"),
  shellHtml("Course Overview", overviewBody, overviewImageFiles, { hrefPrefix: "../../", related: overviewActivities }),
  "utf8",
);
writeFileSync(
  join(courseRoot, finalDir, "index.html"),
  shellHtml("Final Exam & Culminating", finalBody, finalFiles, { hrefPrefix: "../../" }),
  "utf8",
);

const introductionEntry = {
  label: "Introduction",
  type: "html",
  category: "moodle_course_section",
  role: "introduction",
  path: `${introductionDir}/index.html`,
  bytes: statSync(join(courseRoot, introductionDir, "index.html")).size,
  source: introductionUrl,
  attachments: introductionFiles,
  textPreview: "Introduction",
};
const overviewEntry = {
  label: "Course Overview",
  type: "html",
  category: "moodle_course_section",
  role: "course_overview",
  path: `${overviewDir}/index.html`,
  bytes: statSync(join(courseRoot, overviewDir, "index.html")).size,
  source: overviewUrl,
  attachments: overviewImageFiles,
  textPreview: textPreviewFromHtml(`${overviewBody} SNC2D Course Outline Learning Log`),
};
const finalEntry = {
  label: "Final Exam & Culminating",
  type: "html",
  category: "moodle_course_section",
  role: "final_examination_culminating",
  path: `${finalDir}/index.html`,
  bytes: statSync(join(courseRoot, finalDir, "index.html")).size,
  source: finalUrl,
  attachments: finalFiles,
  textPreview: textPreviewFromHtml(finalBody),
};
upsertByRole(manifest.courseDownloads, outlineActivity);
upsertByRole(manifest.courseDownloads, { ...overviewEntry, category: "course_document" });
upsertByRole(manifest.courseDownloads, { ...finalEntry, category: "course_document" });
upsertByRoleAndPath(manifest.courseSections, introductionEntry);
upsertByRoleAndPath(manifest.courseSections, overviewEntry);
upsertByRoleAndPath(manifest.courseSections, finalEntry);

manifest.courseDownloads.sort((a, b) => {
  const order = {
    course_overview: 10,
    course_outline: 20,
    learning_log: 30,
    final_examination_culminating: 40,
    course_template: 50,
  };
  return (order[a.role] || 100) - (order[b.role] || 100) || String(a.label).localeCompare(String(b.label));
});

const rewrittenActivityPages = cleanExistingActivityHtml(manifest);
for (const item of allManifestItems(manifest)) updateBytes(item);

manifest.sourceAudit ||= {};
manifest.sourceAudit.moodleCourseId = moodleCourseId;
manifest.sourceAudit.moodleCoursePage = coursePageUrl;
manifest.sourceAudit.courseOverviewSection = {
  source: overviewUrl,
  localPath: overviewEntry.path,
  activities: overviewActivities.length,
  localizedEmbeds: localizedOverview.localized,
};
manifest.sourceAudit.introductionSection = {
  source: introductionUrl,
  localPath: introductionEntry.path,
  attachments: introductionFiles.length,
};
manifest.sourceAudit.finalExamCulminatingSection = {
  source: finalUrl,
  localPath: finalEntry.path,
  attachments: finalFiles.length,
  directCulminatingPdfLocalized: finalFiles.some((item) => /SNC2D-Culminating\.pdf/i.test(item.label || item.path || "")),
};
manifest.sourceAudit.teacherPacket = {
  status: "not-exposed-in-current-moodle-shell",
  checkedCourseId: moodleCourseId,
};
manifest.sourceAudit.mismatchedSourceFilenames = allManifestItems(manifest)
  .flatMap((item) => (item.attachments || []).map((attachment) => ({ parent: item.label, attachment })))
  .filter(({ attachment }) => /SBI4U/i.test(attachment.label || "") || /SBI4U/i.test(attachment.source || ""))
  .map(({ parent, attachment }) => ({
    parent,
    label: attachment.label,
    source: attachment.source,
    path: attachment.path,
    note: "Filename/source label is present in Moodle-localized attachment; retained for audit rather than renamed.",
  }));
manifest.sourceAudit.rewrittenPollutedActivityPages = rewrittenActivityPages;
manifest.sourceAudit.failedExternalResourceCount = (manifest.sourceAudit.failedExternalResources || []).length;
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseDownloads: manifest.courseDownloads.length,
  introductionAttachments: introductionFiles.length,
  overviewActivities: overviewActivities.length,
  courseSections: manifest.courseSections.length,
  finalAttachments: finalFiles.length,
  directCulminatingPdfLocalized: manifest.sourceAudit.finalExamCulminatingSection.directCulminatingPdfLocalized,
  rewrittenActivityPages,
  mismatchedSourceFilenames: manifest.sourceAudit.mismatchedSourceFilenames.length,
}, null, 2));
