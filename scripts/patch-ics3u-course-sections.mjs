import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "ICS3U";
const moodleCourseId = 87;
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
  if (/excel|spreadsheetml/i.test(contentType)) return "xlsx";
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
  headers.set("user-agent", "ossd-course-portal-ics3u-course-section-localizer/1.0");
  const useMoodleCookies = new URL(url).hostname.toLowerCase() === "www.esunnybrook.com";
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
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: parseHiddenToken(loginHtml) }),
  });
  const text = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(text)) throw new Error("Moodle login failed.");
}

function isLoginPageContent(value) {
  return /Welcome to Sunnybrook|Enter your details to log in|Forgot your password|Forgotten your username or password|Moodle: Log in to the site|SEO Boleh Login|logintoken|用户名|密码/i.test(stripTags(value));
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  const pattern = /\b(?:href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi;
  for (const match of String(html || "").matchAll(pattern)) {
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
    if (stripTags(block).length > 10 || /<img\b|<iframe\b|<video\b/i.test(block)) blocks.push(block);
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
    .replace(/<div\b[^>]*class=["'][^"']*\b(?:drawer|navbar|breadcrumb|secondary-navigation|courseindex|block-region|dropdown-menu|gradingsummary|activity-navigation)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/(?:www\.)?esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/<a\b(?=[^>]*\bdata-localized-link=["'][^"']+["'])[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<img\b(?=[^>]*\bdata-localized-link=["'](?:removed|[^"']*-unavailable)["'])[^>]*>\s*/gi, "")
    .replace(/<h[1-6]\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*<\/h[1-6]>/gi, "")
    .replace(/\s+yuiConfig='[^']*'/gi, "")
    .trim();
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
      // Fall through to a removed marker.
    }
    return `data-localized-link="${attr}-unavailable"`;
  });
}

function pageHtml(title, body, attachments) {
  const files = attachments.length
    ? `<section class="attachments"><h2>Files</h2><ul>${attachments
        .map((item) => {
          const view = item.previewHref || item.href;
          const download = /^(mp4|webm|mov|m4v)$/i.test(item.type || "") ? "" : ` <a href="${htmlEscape(item.href, true)}" download>Download</a>`;
          return `<li><span>${htmlEscape(item.label)}</span><span><a href="${htmlEscape(view, true)}">View</a>${download}</span></li>`;
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

async function buildCourseSectionPage({ sectionNumber, title, role, targetDir }) {
  const source = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}&section=${sectionNumber}`;
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (isLoginPageContent(rawHtml)) throw new Error(`Moodle login page returned for ${source}`);
  const bodyRaw = extractSectionBody(rawHtml, sectionNumber);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(bodyRaw, source)) {
    try {
      const attachment = withPreview(await downloadFile(url, join(targetDir, "files")));
      attachments.push(attachment);
      localByUrl.set(url, attachment);
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      localByUrl.set(parsed.toString(), attachment);
    } catch {
      // Broken Moodle files are not fabricated into local courseware.
    }
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = sectionContentOnly(bodyRaw);
  body = localizePluginfileRefs({ body, source, indexRel, localByUrl });
  body = cleanBody(body);
  if (role === "teacher_packet" && attachments.length === 0) {
    body = "";
  }
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    pageHtml(
      title,
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
    textPreview: stripTags(body).slice(0, 800),
  };
}

function upsertByIdentity(list, record) {
  const index = list.findIndex((item) => (
    (record.path && item.path === record.path) ||
    (record.source && item.source === record.source) ||
    (record.role && item.role === record.role && item.category === record.category)
  ));
  if (index >= 0) list[index] = { ...list[index], ...record };
  else list.push(record);
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseSections ||= [];
manifest.teacherResources ||= [];
manifest.courseDownloads ||= [];

const sections = [
  await buildCourseSectionPage({
    sectionNumber: 1,
    title: "Course Overview",
    role: "course_overview",
    targetDir: "course-sections/course-overview",
  }),
  await buildCourseSectionPage({
    sectionNumber: 6,
    title: "Final Exam & Culminating",
    role: "final_examination_culminating",
    targetDir: "course-sections/final-exam-culminating",
  }),
  await buildCourseSectionPage({
    sectionNumber: 7,
    title: "Teacher Packet",
    role: "teacher_packet",
    targetDir: "course-sections/teacher-packet",
  }),
];

for (const section of sections) upsertByIdentity(manifest.courseSections, section);
for (const section of sections) {
  if (section.role === "teacher_packet") upsertByIdentity(manifest.teacherResources, { ...section });
  if (section.role !== "teacher_packet") {
    upsertByIdentity(manifest.courseDownloads, { ...section, category: "course_document" });
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseSectionsPatchedAt = new Date().toISOString();
manifest.sourceAudit.courseSectionsPatched = sections.map((section) => ({
  label: section.label,
  sectionNumber: section.sectionNumber,
  path: section.path,
  bytes: section.bytes,
  attachments: section.attachments.length,
  textPreviewLength: section.textPreview.length,
}));
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseSections: manifest.courseSections.map((section) => ({
    label: section.label,
    role: section.role,
    path: section.path,
    bytes: section.bytes,
    attachments: section.attachments?.length || 0,
    textPreviewLength: section.textPreview?.length || 0,
  })),
}, null, 2));


