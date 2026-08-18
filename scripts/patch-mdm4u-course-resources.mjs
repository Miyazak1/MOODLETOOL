import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MDM4U";
const moodleCourseId = 78;
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
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/powerpoint|presentationml/i.test(contentType)) return "pptx";
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  if (/image\/gif/i.test(contentType)) return "gif";
  if (/svg/i.test(contentType)) return "svg";
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
  headers.set("user-agent", "ossd-course-portal-mdm4u-resource-localizer/1.0");
  const hostname = new URL(url).hostname.toLowerCase();
  const useMoodleCookies = hostname === "www.esunnybrook.com";
  const cookie = useMoodleCookies ? jar.header() : "";
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  if (useMoodleCookies) jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

function parseHiddenToken(html) {
  return /name=["']logintoken["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] || "";
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const body = new URLSearchParams({ username, password, anchor: "", logintoken: parseHiddenToken(loginHtml) });
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (response.url.includes("/login/index.php") && /name=["']username["']/i.test(text)) throw new Error("Moodle login failed.");
}

function isLoginPageContent(value) {
  return /Welcome to Sunnybrook|Enter your details to log in|Forgot your password|Forgotten your username or password|Moodle: Log in to the site|SEO Boleh Login|logintoken|用户名|密码/i.test(stripTags(value));
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  const pattern = /\b(?:href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    try {
      urls.add(new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString());
    } catch {
      // Ignore malformed Moodle links.
    }
  }
  return [...urls];
}

function googleSpreadsheetUrls(html, baseUrl) {
  const urls = new Set();
  const pattern = /\b(?:src|href)\s*=\s*["']([^"']*docs\.google\.com\/spreadsheets\/d\/e\/[^"']*\/pubhtml[^"']*)["']/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    try {
      urls.add(new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString());
    } catch {
      // Ignore malformed public spreadsheet links.
    }
  }
  return [...urls];
}

async function downloadFile(url, targetDir) {
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (/text\/html/i.test(contentType) && isLoginPageContent(buffer.toString("utf8", 0, Math.min(buffer.length, 2000)))) {
    throw new Error(`Moodle login page returned for attachment: ${url}`);
  }
  const filename = filenameFromUrl(response.url || url);
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer, contentType);
  const rel = toPosix(join(targetDir, `${hashText(url)}-${sanitizeSegment(filename)}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (!existsSync(abs) || statSync(abs).size !== buffer.length) writeFileSync(abs, buffer);
  return {
    label: filename,
    type,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: rel,
    bytes: buffer.length,
    source: url,
  };
}

function previewPath(resourcePath) {
  const candidate = join(courseRoot, "previews-html", `${resourcePath}.html`);
  return existsSync(candidate) ? `previews-html/${toPosix(resourcePath)}.html` : undefined;
}

function withPreview(item) {
  if (item?.path) {
    const preview = previewPath(item.path);
    if (preview) item.previewPath = preview;
  }
  return item;
}

function extractSectionBody(rawHtml, sectionNumber) {
  const patterns = [
    new RegExp(`<li\\b[^>]*(?:id=["']section-${sectionNumber}["']|data-section=["']${sectionNumber}["']|data-number=["']${sectionNumber}["'])[^>]*>([\\s\\S]*?)(?=<li\\b[^>]*(?:id=["']section-|data-section=|data-number=)|<\\/ul>\\s*<\\/li>|$)`, "i"),
    new RegExp(`<div\\b[^>]*id=["']coursecontentcollapse${sectionNumber}["'][^>]*>([\\s\\S]*?)(?=<div\\b[^>]*id=["']coursecontentcollapse\\d+["']|$)`, "i"),
    new RegExp(`<div\\b[^>]*id=["']collapseSection-\\d+["'][^>]*>([\\s\\S]*?)(?=<div\\b[^>]*id=["']collapseSection-|$)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(rawHtml);
    if (match?.[1]) return match[1];
  }
  return /<section\b[^>]*id=["']region-main["'][^>]*>([\s\S]*?)<\/section>/i.exec(rawHtml)?.[1] || rawHtml;
}

function sectionContentOnly(rawHtml) {
  const blocks = [];
  for (const match of String(rawHtml || "").matchAll(/<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const block = match[1] || "";
    if (stripTags(block).length > 10 || /<img\b/i.test(block)) blocks.push(block);
  }
  return blocks.length ? blocks.join("\n") : rawHtml;
}

function cleanBody(rawHtml) {
  return String(rawHtml || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "")
    .replace(/<ul\b[^>]*class=["'][^"']*\bactivity-cards\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\b(?:drawer|navbar|breadcrumb|secondary-navigation|courseindex|block-region|dropdown-menu|gradingsummary)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/(?:www\.)?esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/<a\b(?=[^>]*\bdata-localized-link=["'][^"']+["'])[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<img\b(?=[^>]*\bdata-localized-link=["'](?:removed|[^"']*-unavailable)["'])[^>]*>\s*/gi, "")
    .replace(/<h[1-6]\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*<\/h[1-6]>/gi, "");
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

function localizePluginfileRefs({ body, source, indexRel, localByUrl }) {
  return body.replace(/\b(href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), source).toString();
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      const attachment = localByUrl.get(url) || localByUrl.get(parsed.toString());
      if (attachment?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, attachment.path), true)}"`;
    } catch {
      // Keep original below.
    }
    return `data-localized-link="${attr}-unavailable"`;
  });
}

function cleanEmbeddedHtml(rawHtml, source) {
  let body =
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(rawHtml)?.[1] ||
    /<table\b[\s\S]*?<\/table>/i.exec(rawHtml)?.[0] ||
    rawHtml;
  body = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/\s(?:href|src|action)=["']https?:\/\/[^"']*["']/gi, ' data-localized-link="removed"');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Published spreadsheet</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #102033; background: #fff; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #d8e2ef; padding: 6px 8px; vertical-align: top; }
    a { color: #00396f; }
  </style>
</head>
<body>
${body}
</body>
</html>
`;
}

function csvToRows(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  row.push(value);
  rows.push(row);
  return rows.filter((entry) => entry.some((cell) => cell.trim()));
}

function spreadsheetTableHtml(csv) {
  const rows = csvToRows(csv);
  if (!rows.length) return "";
  return `<table>
${rows
  .map((row, index) => {
    const tag = index === 0 ? "th" : "td";
    return `  <tr>${row.map((cell) => `<${tag}>${htmlEscape(cell)}</${tag}>`).join("")}</tr>`;
  })
  .join("\n")}
</table>`;
}

async function localizeGoogleSpreadsheet(url, targetDir) {
  let html = "";
  const csvUrl = url.replace(/\/pubhtml(?:\?.*)?$/i, "/pub?output=csv");
  const csvResponse = await request(csvUrl);
  const csv = await csvResponse.text();
  if (csvResponse.ok && csv.trim() && !/<html/i.test(csv.slice(0, 200))) {
    html = spreadsheetTableHtml(csv);
  }
  if (!html) {
    const response = await request(url);
    html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    html = cleanEmbeddedHtml(html, url);
  } else {
    html = cleanEmbeddedHtml(html, url);
  }
  const rel = toPosix(join(targetDir, "embeds", `${hashText(url)}-spreadsheet.html`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html, "utf8");
  return {
    label: "Published Google spreadsheet",
    type: "html",
    category: "localized_public_embed",
    role: "embedded_reference",
    path: rel,
    bytes: statSync(abs).size,
    source: url,
  };
}

function pageHtml(title, body, attachments) {
  const files = attachments.length
    ? `<section class="attachments"><h2>Files</h2><ul>${attachments
        .map((item) => {
          const view = item.previewHref || item.href;
          return `<li><span>${htmlEscape(item.label)}</span><span><a href="${htmlEscape(view, true)}">View</a> <a href="${htmlEscape(item.href, true)}" download>Download</a></span></li>`;
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
    img, video, iframe { max-width: 100%; height: auto; }
    a { color: #00396f; font-weight: 700; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
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

async function buildCourseSectionPage({ sectionNumber, title, role, targetDir, sourceTitle = title }) {
  const source = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=${sectionNumber}`;
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (isLoginPageContent(rawHtml)) throw new Error(`Moodle login page returned for ${source}`);
  const bodyRaw = extractSectionBody(rawHtml, sectionNumber);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(bodyRaw, source)) {
    let attachment = null;
    try {
      attachment = await downloadFile(url, join(targetDir, "files"));
    } catch {
      continue;
    }
    attachments.push(attachment);
    localByUrl.set(url, attachment);
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    localByUrl.set(parsed.toString(), attachment);
  }
  const embeds = [];
  const localEmbedByUrl = new Map();
  for (const url of googleSpreadsheetUrls(bodyRaw, source)) {
    const embed = await localizeGoogleSpreadsheet(url, targetDir);
    embeds.push(embed);
    localEmbedByUrl.set(url, embed);
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = sectionContentOnly(bodyRaw);
  body = localizePluginfileRefs({ body, source, indexRel, localByUrl });
  body = body.replace(/\b(src|href)\s*=\s*["']([^"']*docs\.google\.com\/spreadsheets\/d\/e\/[^"']*\/pubhtml[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), source).toString();
      const embed = localEmbedByUrl.get(url);
      if (embed?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, embed.path), true)}"`;
    } catch {
      // Keep original below for cleanup.
    }
    return `data-localized-link="${attr}-unavailable"`;
  });
  body = cleanBody(body);
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    pageHtml(
      sourceTitle,
      body,
      attachments.map((item) => ({ ...item, href: courseRelative(indexRel, item.path), previewHref: item.previewPath ? courseRelative(indexRel, item.previewPath) : "" })),
    ),
    "utf8",
  );
  return {
    label: title,
    type: "html",
    category: "moodle_course_section",
    role,
    path: indexRel,
    bytes: statSync(abs).size,
    source,
    sectionNumber,
    attachments,
    embeds,
    textPreview: stripTags(body).slice(0, 800),
  };
}

function extractIntro(html) {
  const match = html.match(
    /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*(?:<\/div>\s*)?<div\b[^>]*\brole=["']main["']/i,
  );
  if (match?.[1]) return match[1];
  return /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html)?.[1] || "";
}

async function buildActivityPage({ id, mod = "assign", title, role, targetDir, teacherUse }) {
  const source = `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`;
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (isLoginPageContent(rawHtml)) throw new Error(`Moodle login page returned for ${source}`);
  const bodyRaw = extractIntro(rawHtml) || rawHtml;
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(bodyRaw, source)) {
    const attachment = withPreview(await downloadFile(url, join(targetDir, "files")));
    attachments.push(attachment);
    localByUrl.set(url, attachment);
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    localByUrl.set(parsed.toString(), attachment);
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = localizePluginfileRefs({ body: bodyRaw, source, indexRel, localByUrl });
  body = cleanBody(body)
    .replace(/<div\b[^>]*\bclass=["'][^"']*\bfileuploadsubmissiontime\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi, "");
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    pageHtml(
      title,
      body,
      attachments.map((item) => ({
        ...item,
        href: courseRelative(indexRel, item.path),
        previewHref: item.previewPath ? courseRelative(indexRel, item.previewPath) : "",
      })),
    ),
    "utf8",
  );
  return {
    label: title,
    type: "html",
    category: `moodle_${mod}`,
    role,
    path: indexRel,
    bytes: statSync(abs).size,
    source,
    moodleActivityId: String(id),
    teacherUse,
    attachments,
    textPreview: stripTags(body).slice(0, 800),
  };
}

function upsertByIdentity(list, record) {
  const index = list.findIndex((item) => (
    (record.path && item.path === record.path) ||
    (record.moodleActivityId && item.moodleActivityId === record.moodleActivityId && item.category === record.category) ||
    (record.source && item.source === record.source)
  ));
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

function dedupeList(list) {
  const seen = new Set();
  const result = [];
  for (const item of list || []) {
    const key = `${item.path || ""}|${item.moodleActivityId || ""}|${item.category || ""}|${item.source || ""}|${item.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseDownloads ||= [];
manifest.courseSections ||= [];

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.ispring || []) {
      delete item.downloadPath;
      delete item.downloadUrl;
      delete item.downloadBytes;
    }
  }
}

const legacyOutline = manifest.courseDownloads.find((item) => item.path === "plans/course/MDM4U_Course_Outline.docx");
if (legacyOutline) {
  legacyOutline.role = "course_outline";
  legacyOutline.category = "course_document";
  legacyOutline.label = "MDM4U Course Outline.docx";
  legacyOutline.source ||= "https://www.esunnybrook.com/pluginfile.php/8408/mod_assign/introattachment/0/MDM4U-Course-Outline-v1.0.docx?forcedownload=1";
  delete legacyOutline.moodleActivityId;
}

const courseOverview = await buildCourseSectionPage({
  sectionNumber: 1,
  title: "Course Overview",
  role: "course_overview",
  targetDir: "course-sections/course-overview",
});
const finalSection = await buildCourseSectionPage({
  sectionNumber: 7,
  title: "Final Examination",
  role: "final_examination",
  targetDir: "course-sections/final-examination",
});
const courseOutline = await buildActivityPage({
  id: 8195,
  title: "MDM4U Course Outline",
  role: "course_outline",
  targetDir: "localized-moodle-activities/assign/course-8195-course-outline",
  teacherUse: "course_setup",
});

for (const section of [courseOverview, finalSection]) upsertByIdentity(manifest.courseSections, section);
upsertByIdentity(manifest.courseDownloads, courseOutline);

const learningLog = manifest.courseDownloads.find((item) => item.role === "learning_log");
const finalExam = manifest.courseDownloads.find((item) => item.role === "final_exam_submission");
for (const item of [learningLog, finalExam]) {
  if (item?.path) delete item.url;
}

manifest.courseSections = dedupeList(manifest.courseSections);
manifest.courseDownloads = dedupeList(manifest.courseDownloads);

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseResourcesPatchedAt = new Date().toISOString();
manifest.sourceAudit.courseResourceExpectedActivities = {
  courseOutline: 8195,
  learningLog: 8196,
  finalExamSubmission: 8301,
};
manifest.sourceAudit.courseSectionLocalization = {
  patchedAt: new Date().toISOString(),
  moodleCourseId,
  sections: [
    { sectionNumber: 1, role: "course_overview", path: courseOverview.path, attachments: courseOverview.attachments.length },
    { sectionNumber: 7, role: "final_examination", path: finalSection.path, attachments: finalSection.attachments.length },
  ],
  note: "Course-level pages are localized from Moodle section pages, matching the ENG3U/ENG4U/MHF4U structure. Synthetic section index pages are not used.",
};
manifest.sourceAudit.ispringDownloadPackages = 0;
manifest.sourceAudit.ispringDownloadPolicy = "playback-only-no-download";
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseSections: manifest.courseSections.map((item) => ({ label: item.label, role: item.role, path: item.path, bytes: item.bytes, attachments: item.attachments?.length || 0 })),
  courseOutline: { path: courseOutline.path, attachments: courseOutline.attachments.length, bytes: courseOutline.bytes },
}, null, 2));
