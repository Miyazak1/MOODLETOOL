import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SPH3U";
const moodleCourseId = 83;
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
  headers.set("user-agent", "ossd-course-portal-sph3u-resource-localizer/1.0");
  const useMoodleCookies = new URL(url).hostname.toLowerCase() === "www.esunnybrook.com";
  const cookie = useMoodleCookies ? jar.header() : "";
  if (cookie) headers.set("cookie", cookie);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch(url, { ...options, headers, redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
    .replace(/(<video\b[\s\S]*?<a\b[^>]*>)[\s\S]*?(<\/a>[\s\S]*?<\/video>)/gi, "$1Local video file$2")
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
      // Fall through to a removed marker.
    }
    return `data-localized-link="${attr}-unavailable"`;
  });
}

function pageHtml(title, body, attachments) {
  const downloadableAttachments = attachments.filter((item) => !isMediaAttachment(item));
  const files = downloadableAttachments.length
    ? `<section class="attachments"><h2>Files</h2><ul>${downloadableAttachments
        .map((item) => {
          const view = item.previewHref || item.href;
          return `<li><span class="file-label">${htmlEscape(item.label)}</span><span class="file-actions"><a class="file-action" href="${htmlEscape(view, true)}">查看</a><a class="file-action" href="${htmlEscape(item.href, true)}" download>下载</a></span></li>`;
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
    .file-label { overflow-wrap: anywhere; }
    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }
    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }
    .file-action:hover { background: #eef6ff; }
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
  console.error(`section ${sectionNumber}: ${title}`);
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
      // Broken Moodle files are not fabricated into the local course.
    }
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = sectionContentOnly(bodyRaw);
  body = localizePluginfileRefs({ body, source, indexRel, localByUrl });
  body = cleanBody(body);
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

function extractIntro(html) {
  const start = /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>/i.exec(html);
  if (start?.[0]) {
    const block = extractBalancedDiv(html, start.index);
    if (block) return block.replace(start[0], "").replace(/<\/div>\s*$/i, "");
  }
  return /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i.exec(html)?.[1] || "";
}

function extractBalancedDiv(html, startIndex) {
  let depth = 0;
  const pattern = /<\/?div\b[^>]*>/gi;
  pattern.lastIndex = startIndex;
  for (const match of html.matchAll(pattern)) {
    if (match.index < startIndex) continue;
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, match.index + match[0].length);
    } else {
      depth += 1;
    }
  }
  return "";
}

function isMediaAttachment(item) {
  const type = String(item?.type || "").toLowerCase();
  return ["mp4", "m4v", "mov", "webm", "mp3", "m4a", "wav", "ogg"].includes(type);
}

async function buildActivityPage({ id, mod = "assign", title, role, targetDir, teacherUse, teacherOnly = false, unit }) {
  const source = `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`;
  console.error(`${mod} ${id}: ${title}`);
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (isLoginPageContent(rawHtml)) throw new Error(`Moodle login page returned for ${source}`);
  const bodyRaw = extractIntro(rawHtml) || rawHtml;
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
      // Skip unavailable attachment files.
    }
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = localizePluginfileRefs({ body: bodyRaw, source, indexRel, localByUrl });
  body = cleanBody(body)
    .replace(/<div\b[^>]*\bclass=["'][^"']*\bfileuploadsubmissiontime\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi, "")
    .replace(/\b(?:Previous|Next) Activity\b/gi, "");
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
    category: `moodle_${mod}`,
    role,
    path: indexRel,
    bytes: statSync(abs).size,
    source,
    moodleActivityId: String(id),
    teacherUse,
    ...(teacherOnly ? { teacherOnly: true } : {}),
    ...(unit ? { unit } : {}),
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

function parseUnitLesson(label) {
  const match = /Unit\s*(\d+)\s*-\s*Lesson\s*(\d+)/i.exec(label || "");
  return match ? { unit: Number(match[1]), lesson: Number(match[2]) } : null;
}

function homeworkItem(item, role) {
  const parsed = parseUnitLesson(item?.label || item?.title || "");
  const copy = {
    ...item,
    role,
    parentSection: "Homework Submission Folder",
    sourceGroup: "homework_submission_folder",
    unit: item.unit || parsed?.unit,
  };
  if (role === "homework_answer_page") copy.teacherOnly = true;
  delete copy.teacherUse;
  return copy;
}

function sortHomeworkItems(items) {
  return [...items].sort((a, b) => {
    const pa = parseUnitLesson(a.label || a.title || "") || {};
    const pb = parseUnitLesson(b.label || b.title || "") || {};
    const unitDelta = (pa.unit || 99) - (pb.unit || 99);
    if (unitDelta) return unitDelta;
    const lessonDelta = (pa.lesson || 99) - (pb.lesson || 99);
    if (lessonDelta) return lessonDelta;
    return (a.role === "homework_answer_page" ? 1 : 0) - (b.role === "homework_answer_page" ? 1 : 0);
  });
}

function isEmptySubmissionShell(item) {
  if (!["culminating_submission", "final_exam_submission"].includes(item?.role)) return false;
  if ((item.attachments || []).length > 0) return false;
  const text = stripTags(existsSync(join(courseRoot, item.path || "")) ? readFileSync(join(courseRoot, item.path), "utf8") : item.textPreview || "");
  const label = item.label || item.title || "";
  return !text || text === label || text === `${label} ${label}`;
}

function activityTargetDir(mod, id, title) {
  return `localized-moodle-activities/${mod}/${mod}-${id}-${sanitizeSegment(title)}`;
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
manifest.courseDownloads ||= [];
manifest.courseSections ||= [];
manifest.teacherResources ||= [];
manifest.evaluations = [];
manifest.courseDownloads = manifest.courseDownloads.filter((item) => item.role !== "source_audit" && item.category !== "source_audit");
manifest.courseDownloads = manifest.courseDownloads.filter(
  (item) => !/^localized-moodle-activities\/assign\/(?:course-)?(8928|8929)-/i.test(String(item.path || "")),
);
manifest.courseDownloads = manifest.courseDownloads.filter((item) => item.path !== "plans/course/SPH3U_Course_Outline.docx");
manifest.courseDownloads = manifest.courseDownloads.filter((item) => !isEmptySubmissionShell(item));
manifest.courseDownloads = manifest.courseDownloads.filter(
  (item) => !["lesson_dropbox", "lesson_answer_page", "homework_submission_page", "homework_answer_page"].includes(item.role),
);

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.ispring || []) {
      delete item.downloadPath;
      delete item.downloadUrl;
      delete item.downloadBytes;
    }
    for (const item of lesson.downloads || []) {
      if (/^(mp4|webm|video)$/i.test(item.type || "")) {
        delete item.downloadPath;
        delete item.downloadUrl;
      }
    }
  }
}

const courseOverview = await buildCourseSectionPage({
  sectionNumber: 1,
  title: "Course Overview",
  role: "course_overview",
  targetDir: "course-sections/course-overview",
});
const finalSection = await buildCourseSectionPage({
  sectionNumber: 7,
  title: "Final Exam",
  role: "final_examination_culminating",
  targetDir: "course-sections/final-exam",
});
const teacherPacket = await buildCourseSectionPage({
  sectionNumber: 8,
  title: "Teacher Packet",
  role: "teacher_packet",
  targetDir: "course-sections/teacher-packet",
});
for (const section of [courseOverview, finalSection, teacherPacket]) upsertByIdentity(manifest.courseSections, section);

const courseActivities = [
  { id: 8928, title: "SPH3U Course Outline", role: "course_outline", teacherUse: "course_setup" },
  { id: 8929, title: "Learning Log", role: "learning_log", teacherUse: "student_tracking_template" },
  { id: 9033, title: "Culminating Dropbox", role: "culminating_submission", teacherUse: "assessment_preparation" },
  { id: 9034, title: "Final Exam Dropbox", role: "final_exam_submission", teacherUse: "assessment_preparation" },
];
for (const activity of courseActivities) {
  const record = await buildActivityPage({
    ...activity,
    targetDir: activityTargetDir("assign", activity.id, activity.title),
  });
  upsertByIdentity(manifest.courseDownloads, record);
}
const answerKeys = await buildActivityPage({
  id: 9035,
  mod: "assign",
  title: "Answer Keys",
  role: "answer_keys",
  teacherUse: "answer_key_reference",
  teacherOnly: true,
  targetDir: activityTargetDir("assign", 9035, "Answer Keys"),
});
upsertByIdentity(manifest.teacherResources, answerKeys);

manifest.courseDownloads = manifest.courseDownloads.filter((item) => item.path !== "course/introduction.html");

const unitActivities = {
  1: {
    evaluations: [
      ["Unit 1 Lab (AOL)", "assign", 8933],
      ["Unit 1 - Quiz (AOL)", "quiz", 8934],
      ["Unit 1 - Test (AOL)", "quiz", 8935],
    ],
    reflectionAndLogs: [
      ["Unit 1 - KWL Dropbox", "assign", 8948, "kwl_dropbox"],
      ["Unit 1 - Reflection Summary Dropbox", "assign", 8949, "reflection_dropbox"],
    ],
    lessonDropboxes: [8937, 8939, 8941, 8943, 8944, 8945, 8947].map((id, index) => [`Unit 1 - Lesson ${index + 1}`, "assign", id]),
    answerPages: [
      ["Unit 1 - Lesson 1 Answer", "page", 8938],
      ["Unit 1 - Lesson 2 Answer", "page", 8940],
      ["Unit 1 - Lesson 3 Answer", "page", 8942],
      ["Unit 1 - Lesson 6 Answer", "page", 8946],
    ],
  },
  2: {
    evaluations: [
      ["Unit 2 Lab (AOL)", "assign", 8953],
      ["Unit 2 - Test (AOL)", "quiz", 8954],
      ["Unit 2 - Quiz (AOL)", "quiz", 8955],
    ],
    reflectionAndLogs: [
      ["Unit 2 - KWL Dropbox", "assign", 8968, "kwl_dropbox"],
      ["Unit 2 - Reflection Summary Dropbox", "assign", 8969, "reflection_dropbox"],
    ],
    lessonDropboxes: [8957, 8958, 8960, 8961, 8963, 8965, 8967].map((id, index) => [`Unit 2 - Lesson ${index + 1}`, "assign", id]),
    answerPages: [
      ["Unit 2 - Lesson 2 Answer", "page", 8959],
      ["Unit 2 - Lesson 4 Answer", "page", 8962],
      ["Unit 2 - Lesson 5 Answer", "page", 8964],
      ["Unit 2 - Lesson 6 Answer", "page", 8966],
    ],
  },
  3: {
    evaluations: [
      ["Unit 3 Lab (AOL)", "assign", 8973],
      ["Unit 3 Quiz (AOL)", "quiz", 8974],
      ["Unit 3 - Test (AOL)", "quiz", 8975],
    ],
    reflectionAndLogs: [
      ["Unit 3 - KWL Dropbox", "assign", 8989, "kwl_dropbox"],
      ["Unit 3 - Reflection Summary Dropbox", "assign", 8990, "reflection_dropbox"],
    ],
    lessonDropboxes: [8977, 8979, 8981, 8983, 8984, 8985, 8987].map((id, index) => [`Unit 3 - Lesson ${index + 1}`, "assign", id]),
    answerPages: [
      ["Unit 3 - Lesson 1 Answer", "page", 8978],
      ["Unit 3 - Lesson 2 Answer", "page", 8980],
      ["Unit 3 - Lesson 3 Answer", "page", 8982],
      ["Unit 3 - Lesson 6 Answer", "page", 8986],
      ["Unit 3 - Lesson 7 Answer", "page", 8988],
    ],
  },
  4: {
    evaluations: [
      ["Unit 4 Lab (AOL)", "assign", 8994],
      ["Unit 4 - Quiz (AOL)", "quiz", 8995],
      ["Unit 4 - Test (AOL)", "quiz", 8996],
    ],
    reflectionAndLogs: [
      ["Unit 4 - KWL Dropbox", "assign", 9010, "kwl_dropbox"],
      ["Unit 4 - Reflection Summary Dropbox", "assign", 9011, "reflection_dropbox"],
    ],
    lessonDropboxes: [
      ["Unit 4 - Lesson 1", "assign", 8998],
      ["Unit 4 - Lesson 2", "assign", 8999],
      ["Unit 4 - Lesson 3", "assign", 9001],
      ["Unit 4 - Lesson 4", "assign", 9003],
      ["Unit 4 - Lesson 5", "assign", 9005],
      ["Unit 4 - Lesson 6", "assign", 9006],
      ["Unit 4 - Lesson 7", "assign", 9008],
    ],
    answerPages: [
      ["Unit 4 - Lesson 2 Answer", "page", 9000],
      ["Unit 4 - Lesson 3 Answer", "page", 9002],
      ["Unit 4 - Lesson 4 Answer", "page", 9004],
      ["Unit 4 - Lesson 6 Answer", "page", 9007],
      ["Unit 4 - Lesson 7 Answer", "page", 9009],
    ],
  },
  5: {
    evaluations: [
      ["Unit 5 Lab (AOL)", "assign", 9015],
      ["Unit 5 - Quiz (AOL)", "quiz", 9016],
      ["Unit 5 - Test (AOL)", "quiz", 9017],
    ],
    reflectionAndLogs: [
      ["Unit 5 - KWL Dropbox", "assign", 9031, "kwl_dropbox"],
      ["Unit 5 - Reflection Summary Dropbox", "assign", 9032, "reflection_dropbox"],
    ],
    lessonDropboxes: [9019, 9021, 9022, 9023, 9025, 9026, 9028, 9029].map((id, index) => [`Unit 5 - Lesson ${index + 1}`, "assign", id]),
    answerPages: [
      ["Unit 5 - Lesson 1 Answer", "page", 9020],
      ["Unit 5 - Lesson 4 Answer", "page", 9024],
      ["Unit 5 - Lesson 6 Answer", "page", 9027],
      ["Unit 5 - Lesson 8 Answer", "page", 9030],
    ],
  },
};

const moodleUnitTitles = new Map();

for (const unit of manifest.units || []) {
  if (moodleUnitTitles.has(unit.unit)) unit.title = moodleUnitTitles.get(unit.unit);
  const config = unitActivities[unit.unit];
  if (!config) continue;
  unit.unitResources ||= {};
  unit.unitResources.evaluations = [];
  unit.unitResources.reflectionAndLogs = [];
  unit.unitResources.lessonDropboxes = [];
  unit.unitResources.answerPages = [];

  for (const [title, mod, id] of config.evaluations) {
    const record = await buildActivityPage({
      id,
      mod,
      title,
      role: "aol_assessment",
      unit: unit.unit,
      teacherUse: "assessment_preparation",
      targetDir: activityTargetDir(mod, id, title),
    });
    upsertByIdentity(unit.unitResources.evaluations, record);
    upsertByIdentity(manifest.evaluations, record);
  }
  for (const [title, mod, id, role] of config.reflectionAndLogs) {
    const record = await buildActivityPage({
      id,
      mod,
      title,
      role,
      unit: unit.unit,
      teacherUse: "student_progress_tracking",
      targetDir: activityTargetDir(mod, id, title),
    });
    upsertByIdentity(unit.unitResources.reflectionAndLogs, record);
  }
  for (const [title, mod, id] of config.lessonDropboxes) {
    const record = await buildActivityPage({
      id,
      mod,
      title,
      role: "lesson_dropbox",
      unit: unit.unit,
      teacherUse: "lesson_submission",
      targetDir: activityTargetDir(mod, id, title),
    });
    upsertByIdentity(unit.unitResources.lessonDropboxes, record);
  }
  for (const [title, mod, id] of config.answerPages) {
    const record = await buildActivityPage({
      id,
      mod,
      title,
      role: "lesson_answer_page",
      unit: unit.unit,
      teacherUse: "answer_key_reference",
      teacherOnly: true,
      targetDir: activityTargetDir(mod, id, title),
    });
    upsertByIdentity(unit.unitResources.answerPages, record);
  }
}

const homeworkItems = [];
const missingHomeworkAnswerPartners = [];
for (const unit of manifest.units || []) {
  const resources = unit.unitResources || {};
  const answersByLesson = new Map();
  for (const answer of resources.answerPages || []) {
    const parsed = parseUnitLesson(answer.label || answer.title || "");
    if (parsed?.lesson) answersByLesson.set(parsed.lesson, answer);
  }
  for (const lesson of resources.lessonDropboxes || []) {
    const parsed = parseUnitLesson(lesson.label || lesson.title || "");
    homeworkItems.push(homeworkItem(lesson, "homework_submission_page"));
    const answer = parsed?.lesson ? answersByLesson.get(parsed.lesson) : null;
    if (answer) homeworkItems.push(homeworkItem(answer, "homework_answer_page"));
    else missingHomeworkAnswerPartners.push({ unit: unit.unit, lesson: parsed?.lesson, label: lesson.label || lesson.title });
  }
  delete resources.lessonDropboxes;
  delete resources.answerPages;
}

manifest.courseDownloads.push(...sortHomeworkItems(homeworkItems));
manifest.teacherResources = manifest.teacherResources
  .filter((item) => !["aol_assessment", "lesson_answer_page", "lesson_dropbox", "homework_submission_page", "homework_answer_page"].includes(item.role))
  .map((item) => /^Answer Keys$/i.test(item.label || item.title || "") ? {
    ...item,
    role: "teacher_packet",
    parentSection: "Teacher Packet",
    sourceGroup: "teacher_packet",
    teacherOnly: true,
  } : item);
manifest.courseSections = manifest.courseSections.filter((item) => !(item.role === "teacher_packet" && (item.attachments || []).length === 0));

manifest.courseSections = dedupeList(manifest.courseSections);
manifest.courseDownloads = dedupeList(manifest.courseDownloads);
manifest.teacherResources = dedupeList(manifest.teacherResources);
manifest.evaluations = dedupeList(manifest.evaluations);
manifest.sourceAudit ||= {};
manifest.sourceAudit.courseResourcesPatchedAt = new Date().toISOString();
manifest.sourceAudit.courseSectionLocalization = {
  patchedAt: new Date().toISOString(),
  moodleCourseId,
  sections: [
    { sectionNumber: 1, role: "course_overview", path: courseOverview.path, attachments: courseOverview.attachments.length },
    { sectionNumber: 7, role: "final_examination_culminating", path: finalSection.path, attachments: finalSection.attachments.length },
    { sectionNumber: 8, role: "teacher_packet", path: teacherPacket.path, attachments: teacherPacket.attachments.length },
  ],
  note: "Course-level pages are localized from Moodle section pages. Synthetic section index pages are not used.",
};
manifest.sourceAudit.courseResourceExpectedActivities = {
  courseOutline: 8928,
  learningLog: 8929,
  culminatingSubmission: 9033,
  finalExamSubmission: 9034,
  answerKeys: 9035,
};
manifest.sourceAudit.moodleActivityLocalization = {
  patchedAt: new Date().toISOString(),
  courseActivities: courseActivities.length,
  unitEvaluations: Object.values(unitActivities).reduce((sum, item) => sum + item.evaluations.length, 0),
  unitReflectionAndLogs: Object.values(unitActivities).reduce((sum, item) => sum + item.reflectionAndLogs.length, 0),
  lessonDropboxes: Object.values(unitActivities).reduce((sum, item) => sum + item.lessonDropboxes.length, 0),
  answerPages: Object.values(unitActivities).reduce((sum, item) => sum + item.answerPages.length, 0),
  homeworkSubmissionItemsAddedToCourseDownloads: homeworkItems.length,
  missingHomeworkAnswerPartners,
  excluded: "Exit Cards are formative student activities and are not included as teacher preparation resources.",
};
manifest.sourceAudit.moodleUnitTitleAlignment = {
  patchedAt: new Date().toISOString(),
  source: `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}`,
  unitTitles: Object.fromEntries(moodleUnitTitles),
  note: "Display unit titles follow the authenticated Moodle shell.",
};
manifest.sourceAudit.ispringDownloadPackages = 0;
manifest.sourceAudit.ispringDownloadPolicy = "playback-only-no-download";
if (Array.isArray(manifest.sourceAudit.failedIspring)) {
  manifest.sourceAudit.failedIspring = manifest.sourceAudit.failedIspring.map((item) => {
    const { url, ...rest } = item;
    return { ...rest, source: url || item.source };
  });
}
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseSections: manifest.courseSections.map((item) => ({ label: item.label, role: item.role, path: item.path, bytes: item.bytes, attachments: item.attachments?.length || 0 })),
  courseDownloads: manifest.courseDownloads.map((item) => ({ label: item.label, role: item.role, path: item.path, attachments: item.attachments?.length || 0 })),
  teacherResources: manifest.teacherResources.length,
  evaluations: manifest.evaluations.length,
}, null, 2));
