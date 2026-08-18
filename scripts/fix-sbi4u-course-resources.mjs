import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SBI4U");
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
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
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

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function sanitizeSegment(value) {
  return (
    String(value || "resource")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "resource"
  );
}

function filenameFromHeaders(url, headers, fallback) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fromHeader = utfName || plainName;
  if (fromHeader) return decodeURIComponent(fromHeader);
  const fromUrl = decodeURIComponent(basename(new URL(url).pathname));
  return fromUrl && fromUrl !== "pluginfile.php" ? fromUrl : fallback;
}

function extensionFor(filename, contentType = "") {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml|msword/i.test(contentType)) return "docx";
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  if (/image\/gif/i.test(contentType)) return "gif";
  return "bin";
}

function validateSignature(type, buffer) {
  const pk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const pdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  const jpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const gif = buffer.toString("ascii", 0, 3) === "GIF";
  if (type === "pdf" && !pdf) throw new Error("downloaded file is not a PDF");
  if (type === "docx" && !pk && !ole) throw new Error("downloaded file is not a Word document");
  if (["jpg", "jpeg"].includes(type) && !jpg) throw new Error("downloaded file is not a JPEG");
  if (type === "png" && !png) throw new Error("downloaded file is not a PNG");
  if (type === "gif" && !gif) throw new Error("downloaded file is not a GIF");
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
  headers.set("user-agent", "ossd-course-portal-sbi4u-course-resource-fix/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
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
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)["']/i.exec(loginHtml)?.[1] || "";
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const text = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(text)) throw new Error("Moodle login failed.");
}

function previewPath(resourcePath) {
  const rel = `previews-html/${toPosix(resourcePath)}.html`;
  return existsSync(join(courseRoot, rel)) ? rel : undefined;
}

function pluginfileLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString();
    links.push({ href, text: stripTags(match[2]) });
  }
  return links;
}

function pluginfileRefs(html, baseUrl) {
  const refs = [];
  for (const match of String(html || "").matchAll(/\b(href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi)) {
    const attr = match[1];
    const href = new URL(match[2].replaceAll("&amp;", "&"), baseUrl).toString();
    refs.push({ attr, href });
  }
  return refs;
}

async function downloadAttachment(url, targetDir, label, referer = "") {
  const response = await request(url, referer ? { headers: { referer } } : {});
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const contentType = response.headers.get("content-type") || "";
  const filename = filenameFromHeaders(response.url || url, response.headers, label);
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer);
  const rel = toPosix(join(targetDir, `${hashText(url)}-${sanitizeSegment(filename)}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (!existsSync(abs) || statSync(abs).size !== buffer.length) writeFileSync(abs, buffer);
  const item = {
    label: filename,
    type,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: rel,
    bytes: buffer.length,
    source: url,
  };
  const preview = previewPath(rel);
  if (preview) item.previewPath = preview;
  return item;
}

async function tryDownloadAttachment(url, targetDir, label, referer, failedMedia) {
  const candidates = [url];
  const parsed = new URL(url);
  parsed.search = "";
  candidates.push(parsed.toString());
  for (const candidate of candidates) {
    try {
      return await downloadAttachment(candidate, targetDir, label, referer);
    } catch (error) {
      if (candidate === candidates.at(-1)) {
        const record = {
          label,
          type: extensionFor(label),
          scope: "course_resource",
          source: url,
          status: "unavailable",
          error: error instanceof Error ? error.message : String(error),
        };
        const index = failedMedia.findIndex((item) => item.label === record.label && item.scope === record.scope && item.source === record.source);
        if (index >= 0) failedMedia[index] = { ...failedMedia[index], ...record };
        else failedMedia.push(record);
      }
    }
  }
  return null;
}

function copyFallbackAttachment(sourceRel, targetDir, label, type, moodleSource) {
  const normalizedSourceRel = toPosix(sourceRel);
  const sourceAbs = normalizedSourceRel.startsWith("docs/")
    ? join(workspaceRoot, normalizedSourceRel)
    : join(workspaceRoot, "courseware", normalizedSourceRel);
  if (!existsSync(sourceAbs)) throw new Error(`Missing fallback Learning Log file: ${sourceAbs}`);
  const rel = toPosix(join(targetDir, sanitizeSegment(label)));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  copyFileSync(sourceAbs, abs);
  const item = {
    label,
    type,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: rel,
    bytes: statSync(abs).size,
    source: moodleSource,
    localFallbackSource: sourceRel,
  };
  const preview = previewPath(rel);
  if (preview) item.previewPath = preview;
  return item;
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

function pageHtml(title, body, attachments = []) {
  const files = attachments.length
    ? `<section class="attachments"><h2>Files</h2><ul>${attachments
        .map((item) => {
          const href = courseRelative("localized-moodle-activities/assign/assign-9504-Learning-Log/index.html", item.path);
          const previewHref = item.previewPath ? courseRelative("localized-moodle-activities/assign/assign-9504-Learning-Log/index.html", item.previewPath) : href;
          return `<li><span>${htmlEscape(item.label)}</span><span><a href="${htmlEscape(previewHref, true)}">View</a> <a href="${htmlEscape(href, true)}" download>Download</a></span></li>`;
        })
        .join("")}</ul></section>`
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
    h2 { font-size: 20px; margin-top: 24px; }
    a { color: #00396f; font-weight: 700; }
    small { color: #5d7088; margin-left: 6px; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .child-file { padding-left: 18px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${body}
      ${files}
    </article>
  </main>
</body>
</html>
`;
}

function activityPageHtml(title, body, attachments, indexRel) {
  const files = attachments.length
    ? `<section class="attachments"><h2>Files</h2><ul>${attachments
        .map((item) => {
          const href = courseRelative(indexRel, item.path);
          const previewHref = item.previewPath ? courseRelative(indexRel, item.previewPath) : href;
          return `<li><span>${htmlEscape(item.label)}</span><span><a href="${htmlEscape(previewHref, true)}">View</a> <a href="${htmlEscape(href, true)}" download>Download</a></span></li>`;
        })
        .join("")}</ul></section>`
    : "";
  return pageHtml(title, `${body}${files}`, []);
}

function resourceListHtml(indexRel, items) {
  const rows = [];
  for (const item of items.filter(Boolean)) {
    if (!item.path) continue;
    const href = courseRelative(indexRel, item.path);
    const attachmentCount = item.attachments?.length || 0;
    rows.push(`<li><span><a href="${htmlEscape(href, true)}">${htmlEscape(item.label)}</a>${attachmentCount ? ` <small>${attachmentCount} file${attachmentCount === 1 ? "" : "s"}</small>` : ""}</span><span><a href="${htmlEscape(href, true)}">Open</a></span></li>`);
    for (const attachment of item.attachments || []) {
      const fileHref = courseRelative(indexRel, attachment.path);
      const previewHref = attachment.previewPath ? courseRelative(indexRel, attachment.previewPath) : fileHref;
      rows.push(`<li><span class="child-file">${htmlEscape(attachment.label)}</span><span><a href="${htmlEscape(previewHref, true)}">View</a> <a href="${htmlEscape(fileHref, true)}" download>Download</a></span></li>`);
    }
  }
  return rows.length ? `<section class="attachments"><h2>Resources</h2><ul>${rows.join("")}</ul></section>` : "<p>No local course-resource file is available from this Moodle section.</p>";
}

function courseResourceCardsHtml(indexRel, items) {
  const cards = [];
  for (const item of items.filter(Boolean)) {
    if (!item.path) continue;
    const openHref = courseRelative(indexRel, item.path);
    const attachmentRows = (item.attachments || [])
      .map((attachment) => {
        const fileHref = courseRelative(indexRel, attachment.path);
        const previewHref = attachment.previewPath ? courseRelative(indexRel, attachment.previewPath) : fileHref;
        return `<li><span>${htmlEscape(attachment.label)}</span><span><a href="${htmlEscape(previewHref, true)}">View</a><a href="${htmlEscape(fileHref, true)}" download>Download</a></span></li>`;
      })
      .join("");
    cards.push(`<section class="resource-card">
        <div>
          <h2>${htmlEscape(item.label)}</h2>
          ${item.textPreview ? `<p>${htmlEscape(item.textPreview)}</p>` : ""}
        </div>
        <p class="actions"><a href="${htmlEscape(openHref, true)}">Open Page</a></p>
        ${attachmentRows ? `<ul class="file-list">${attachmentRows}</ul>` : ""}
      </section>`);
  }
  return cards.join("\n");
}

function writeSection(section, items) {
  const body = resourceListHtml(section.path, items);
  const abs = join(courseRoot, section.path);
  writeFileSync(abs, pageHtml(section.label, body, []), "utf8");
  section.bytes = statSync(abs).size;
  section.textPreview = stripTags(body).slice(0, 800);
  section.linkedResources = items.filter(Boolean).map((item) => ({
    label: item.label,
    path: item.path,
    attachments: item.attachments?.length || 0,
  }));
}

function writeMoodleSectionShell(section, items = [], bodyText = "") {
  const body = `${bodyText ? `<p class="section-copy">${htmlEscape(bodyText)}</p>` : ""}${courseResourceCardsHtml(section.path, items)}`;
  const abs = join(courseRoot, section.path);
  writeFileSync(abs, sectionShellHtml(section.label, body || "<p>No local course-resource file is available from this Moodle section.</p>"), "utf8");
  section.bytes = statSync(abs).size;
  section.textPreview = stripTags(body).slice(0, 800);
  delete section.linkedResources;
}

function sectionShellHtml(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 24px; }
    h1 { font-size: 30px; margin: 0 0 20px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    h2 { font-size: 18px; margin: 0 0 8px; }
    p { margin: 0; color: #334761; }
    img { display: block; max-width: 100%; height: auto; margin: 14px 0; }
    a { color: #00396f; font-weight: 700; }
    .section-copy { margin-bottom: 16px; }
    .resource-card { border: 1px solid #d9e6f5; border-radius: 8px; margin-top: 14px; padding: 16px; background: #fbfdff; }
    .resource-card .actions { margin-top: 12px; }
    .resource-card .actions a { display: inline-block; border: 1px solid #9bb8d8; border-radius: 6px; padding: 6px 10px; text-decoration: none; }
    .file-list { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 8px; }
    .file-list li { align-items: center; background: #fff; border: 1px solid #e3ebf5; border-radius: 6px; display: flex; justify-content: space-between; gap: 12px; padding: 9px 10px; }
    .file-list li span:last-child { display: flex; gap: 8px; white-space: nowrap; }
    .file-list a { border: 1px solid #b8cbe0; border-radius: 5px; padding: 4px 8px; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${body}
    </article>
  </main>
</body>
</html>
`;
}

function extractRealSectionBody(html) {
  const blocks = [];
  for (const match of String(html || "").matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const block = match[1] || "";
    const text = stripTags(block);
    if (/Grade Breakdown|Lesson Overview|About the Course|Formative and Summative/i.test(text) || /\/course\/section\/895\//i.test(block)) {
      blocks.push(block);
    }
  }
  return blocks.length ? blocks.join("\n") : "";
}

async function rebuildRealCourseOverview(section) {
  const source = "https://www.esunnybrook.com/course/view.php?id=88&section=1";
  const response = await request(source);
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  let body = extractRealSectionBody(html);
  if (!body) throw new Error("Could not extract SBI4U section=1 Course Overview body.");

  const refs = pluginfileRefs(body, source).filter((ref) => /\/course\/section\/895\//i.test(ref.href));
  const attachments = [];
  const localBySource = new Map();
  for (const ref of refs) {
    if (localBySource.has(ref.href)) continue;
    const attachment = await downloadAttachment(ref.href, "course-sections/course-overview/files", basename(new URL(ref.href).pathname), source);
    attachments.push(attachment);
    localBySource.set(ref.href, attachment);
    const clean = new URL(ref.href);
    clean.search = "";
    clean.hash = "";
    localBySource.set(clean.toString(), attachment);
  }

  for (const [sourceUrl, attachment] of localBySource.entries()) {
    body = body.replaceAll(sourceUrl.replaceAll("&", "&amp;"), courseRelative(section.path, attachment.path));
    body = body.replaceAll(sourceUrl, courseRelative(section.path, attachment.path));
  }
  body = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/(?:www\.)?esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/<a\b(?=[^>]*\bdata-localized-link=["'][^"']+["'])[^>]*>([\s\S]*?)<\/a>/gi, "$1");

  const files = attachments.length
    ? `<section class="attachments"><h2>Files</h2><ul>${attachments
        .map((item) => {
          const href = courseRelative(section.path, item.path);
          return `<li><span>${htmlEscape(item.label)}</span><span><a href="${htmlEscape(href, true)}">View</a><a href="${htmlEscape(href, true)}" download>Download</a></span></li>`;
        })
        .join("")}</ul></section>`
    : "";
  const page = sectionShellHtml(section.label, `${body}${files}`);
  const abs = join(courseRoot, section.path);
  writeFileSync(abs, page, "utf8");
  section.source = source;
  section.bytes = statSync(abs).size;
  section.attachments = attachments;
  section.textPreview = stripTags(body).slice(0, 800);
}

function extractFinalSectionBody(html) {
  const blocks = [];
  for (const match of String(html || "").matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const block = match[1] || "";
    const text = stripTags(block);
    if (/Culminating|About the Exam|final evaluation|Eligibility|Instructions/i.test(text) || /\/course\/section\/901\//i.test(block)) {
      blocks.push(block);
    }
  }
  return blocks.length ? blocks.join("\n") : "";
}

async function rebuildRealFinalSection(section) {
  const source = "https://www.esunnybrook.com/course/view.php?id=88&section=7";
  const response = await request(source);
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  let body = extractFinalSectionBody(html);
  if (!body) throw new Error("Could not extract SBI4U section=7 Final Exam & Culminating body.");

  const refs = pluginfileRefs(body, source).filter((ref) => /\/course\/section\/901\//i.test(ref.href));
  const attachments = [];
  const localBySource = new Map();
  for (const ref of refs) {
    if (localBySource.has(ref.href)) continue;
    let attachment;
    try {
      attachment = await downloadAttachment(ref.href, "course-sections/final-exam-culminating/files", basename(new URL(ref.href).pathname), source);
    } catch {
      attachment = copyFallbackAttachment(
        "docs/SBI4U - Culminatng.pdf",
        "course-sections/final-exam-culminating/files",
        "SBI4U - Culminatng.pdf",
        "pdf",
        ref.href,
      );
    }
    attachments.push(attachment);
    localBySource.set(ref.href, attachment);
    const clean = new URL(ref.href);
    clean.search = "";
    clean.hash = "";
    localBySource.set(clean.toString(), attachment);
  }

  for (const [sourceUrl, attachment] of localBySource.entries()) {
    body = body.replaceAll(sourceUrl.replaceAll("&", "&amp;"), courseRelative(section.path, attachment.path));
    body = body.replaceAll(sourceUrl, courseRelative(section.path, attachment.path));
  }
  body = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/(?:www\.)?esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/<a\b(?=[^>]*\bdata-localized-link=["'][^"']+["'])[^>]*>([\s\S]*?)<\/a>/gi, "$1");

  const files = attachments.length
    ? `<section class="attachments"><h2>Files</h2><ul class="file-list">${attachments
        .map((item) => {
          const href = courseRelative(section.path, item.path);
          return `<li><span>${htmlEscape(item.label)}</span><span><a href="${htmlEscape(href, true)}">View</a><a href="${htmlEscape(href, true)}" download>Download</a></span></li>`;
        })
        .join("")}</ul></section>`
    : "";
  const page = sectionShellHtml(section.label, `${body}${files}`);
  const abs = join(courseRoot, section.path);
  writeFileSync(abs, page, "utf8");
  section.source = source;
  section.bytes = statSync(abs).size;
  section.attachments = attachments;
  section.textPreview = stripTags(body).slice(0, 800);
}

function upsertCourseDocumentForSection(manifest, section) {
  const record = {
    label: section.label,
    type: "html",
    category: "course_document",
    role: section.role,
    path: section.path,
    bytes: section.bytes,
    source: section.source,
    attachments: section.attachments || [],
    textPreview: section.textPreview,
  };
  const index = manifest.courseDownloads.findIndex((item) => item.path === record.path || (item.role === record.role && item.category === "course_document"));
  if (index >= 0) manifest.courseDownloads[index] = { ...manifest.courseDownloads[index], ...record };
  else manifest.courseDownloads.unshift(record);
}

function upsertAudit(list, record) {
  const index = list.findIndex((item) => item.id === record.id && item.scope === record.scope);
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

function walkManifest(node, callback) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkManifest(item, callback);
    return;
  }
  callback(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walkManifest(value, callback);
  }
}

function rewritePollutedActivityPages(manifest) {
  const records = [];
  walkManifest(manifest, (item) => {
    if (item.path && /localized-moodle-activities\/page\/page-\d+-.+\/index\.html$/i.test(item.path)) records.push(item);
  });
  const rewritten = [];
  for (const item of records) {
    const abs = join(courseRoot, item.path);
    if (!existsSync(abs)) continue;
    const html = readFileSync(abs, "utf8");
    if (!/hexstruct|esunnybrook\.com|Skip to main content|Site administration|Dashboard|Edit mode|Log out/i.test(html)) continue;
    const body = item.attachments?.length ? "" : "<p>This Moodle page has no local file attachment available.</p>";
    writeFileSync(abs, activityPageHtml(item.label, body, item.attachments || [], item.path), "utf8");
    item.bytes = statSync(abs).size;
    item.textPreview = stripTags(body).slice(0, 800);
    rewritten.push(item.path);
  }

  const formalLabPage = "localized-moodle-activities/page/page-9502-Writing-Formal-Lab-Reports/index.html";
  const formalAbs = join(courseRoot, formalLabPage);
  if (existsSync(formalAbs)) {
    writeFileSync(
      formalAbs,
      pageHtml(
        "Writing Formal Lab Reports",
        "<p>This Moodle page embeds an external H5P player. No local H5P package was available, so this page is not exposed as playable courseware.</p>",
        [],
      ),
      "utf8",
    );
    rewritten.push(formalLabPage);
  }
  return rewritten;
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
const learningLog = manifest.courseDownloads.find((item) => item.moodleActivityId === "9504");
if (!learningLog) throw new Error("Missing Learning Log course download record.");
manifest.sourceAudit ||= {};
manifest.sourceAudit.failedMedia ||= [];

const learningLogSource = "https://www.esunnybrook.com/mod/assign/view.php?id=9504";
const learningLogPage = await request(learningLogSource);
const learningLogHtml = await learningLogPage.text();
if (!learningLogPage.ok) throw new Error(`HTTP ${learningLogPage.status}: ${learningLogSource}`);
const learningLogLinks = pluginfileLinks(learningLogHtml, learningLogSource);
const findLearningLogLink = (pattern) => {
  const link = learningLogLinks.find((item) => pattern.test(item.text) || pattern.test(decodeURIComponent(new URL(item.href).pathname)));
  if (!link) throw new Error(`Missing Learning Log attachment matching ${pattern}`);
  return link.href;
};

const learningLogTargetDir = "localized-moodle-activities/assign/assign-9504-Learning-Log/files";
const learningLogSampleSource = findLearningLogLink(/Learning Log-Sample.*\.pdf/i);
const learningLogDocSource = findLearningLogLink(/Learning Log\.docx/i);
const learningLogAttachments = [
  (await tryDownloadAttachment(
    learningLogSampleSource,
    learningLogTargetDir,
    "Learning Log-Sample (1).pdf",
    learningLogSource,
    manifest.sourceAudit.failedMedia,
  )) ||
    copyFallbackAttachment(
      "ESLDO/localized-moodle-activities/assign/course-7753-learning-log/files/Learning-Log-Sample-1.pdf",
      learningLogTargetDir,
      "Learning Log-Sample (1).pdf",
      "pdf",
      learningLogSampleSource,
    ),
  (await tryDownloadAttachment(
    learningLogDocSource,
    learningLogTargetDir,
    "Learning Log.docx",
    learningLogSource,
    manifest.sourceAudit.failedMedia,
  )) ||
    copyFallbackAttachment(
      "ESLDO/localized-moodle-activities/assign/course-7753-learning-log/files/Learning-Log.docx",
      learningLogTargetDir,
      "Learning Log.docx",
      "docx",
      learningLogDocSource,
    ),
].filter(Boolean);
manifest.sourceAudit.failedMedia = manifest.sourceAudit.failedMedia.filter(
  (item) => !(item.scope === "course_resource" && /Learning Log(?:-Sample)?/i.test(item.label || "")),
);
learningLog.attachments = learningLogAttachments;

const learningLogIndex = learningLog.path;
const learningLogBody = '<p>After each unit, the student must submit a learning log to track the hours spent on assignments. The learning log is to provide learning accountability from the student and to help the student develop a good study routine. Attached you will find a sample learning log filled out.</p>';
writeFileSync(join(courseRoot, learningLogIndex), activityPageHtml("Learning Log", learningLogBody, learningLogAttachments, learningLogIndex), "utf8");
learningLog.bytes = statSync(join(courseRoot, learningLogIndex)).size;
learningLog.textPreview = stripTags(learningLogBody);

manifest.courseDownloads = manifest.courseDownloads.filter((item) => item.moodleActivityId !== "9502");
manifest.courseDownloads = manifest.courseDownloads.filter((item) => item.moodleActivityId !== "9605");
manifest.sourceAudit ||= {};
manifest.sourceAudit.unavailableActivities ||= [];
upsertAudit(manifest.sourceAudit.unavailableActivities, {
  scope: "course_resource",
  id: 9502,
  mod: "page",
  title: "Writing Formal Lab Reports",
  status: "not_exposed",
  source: "https://www.esunnybrook.com/mod/page/view.php?id=9502",
  reason: "The Moodle page embeds an external hexstruct H5P player; no local H5P package was available, so it is not exposed as playable courseware.",
});
upsertAudit(manifest.sourceAudit.unavailableActivities, {
  scope: "course_resource",
  id: 9605,
  mod: "assign",
  title: "Final Exam Submission",
  status: "not_exposed",
  source: "https://www.esunnybrook.com/mod/assign/view.php?id=9605",
  reason: "The Moodle assignment is a submission dropbox with no local instructional file attachment, so it is not exposed as a course-resource card.",
});

const courseDownloads = manifest.courseDownloads || [];
const teacherResources = manifest.teacherResources || [];
const byRole = (roles) => courseDownloads.filter((item) => roles.includes(item.role));
const sectionByRole = (role) => manifest.courseSections.find((item) => item.role === role);

const examReview = manifest.courseDownloads.find((item) => item.moodleActivityId === "9607" && item.role === "exam_review");
if (examReview?.path) {
  examReview.downloadPath = examReview.path;
  examReview.teacherUse = "final_evaluation";
}

const introduction = sectionByRole("course_introduction");
if (introduction) writeMoodleSectionShell(introduction, []);

const overview = sectionByRole("course_overview");
if (overview) await rebuildRealCourseOverview(overview);

const finalSection = sectionByRole("final_examination_culminating");
if (finalSection) await rebuildRealFinalSection(finalSection);

const teacherPacket = sectionByRole("teacher_packet");
if (teacherPacket) {
  writeMoodleSectionShell(teacherPacket, teacherResources.filter((item) => item.role === "answer_keys" || /answer keys/i.test(item.label || "")));
}

const rewrittenPollutedPages = rewritePollutedActivityPages(manifest);

manifest.courseDownloads = manifest.courseDownloads.filter((item) => item.category !== "course_document" || !/^course-sections\//i.test(item.path || ""));

walkManifest(manifest, (item) => {
  if (!item.path || !/\.html?$/i.test(item.path)) return;
  const abs = join(courseRoot, item.path);
  if (!existsSync(abs)) return;
  item.bytes = statSync(abs).size;
  item.textPreview = stripTags(readFileSync(abs, "utf8")).slice(0, 800);
});

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  ok: true,
  learningLogAttachments: learningLog.attachments.map((item) => ({ label: item.label, path: item.path, previewPath: item.previewPath || null })),
  courseDownloads: manifest.courseDownloads.length,
  courseSections: manifest.courseSections.map((item) => ({ label: item.label, path: item.path, linkedResources: item.linkedResources?.length || 0 })),
  rewrittenPollutedPages,
}, null, 2));
