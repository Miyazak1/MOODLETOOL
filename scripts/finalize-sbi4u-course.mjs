import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SBI4U";
const moodleCourseId = 88;
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");

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

function filenameFromUrl(url, fallback = "resource.bin") {
  try {
    const fromUrl = decodeURIComponent(basename(new URL(url).pathname));
    return fromUrl && fromUrl !== "pluginfile.php" && fromUrl !== "view.php" ? fromUrl : fallback;
  } catch {
    return fallback;
  }
}

function filenameFromHeaders(url, headers, fallback) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fromHeader = utfName || plainName;
  if (fromHeader) return decodeURIComponent(fromHeader);
  return filenameFromUrl(url, fallback);
}

function extensionFor(filename, contentType = "") {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/presentationml|powerpoint/i.test(contentType)) return "pptx";
  if (/spreadsheetml|excel/i.test(contentType)) return "xlsx";
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  if (/image\/gif/i.test(contentType)) return "gif";
  if (/svg/i.test(contentType)) return "svg";
  if (/video\/mp4/i.test(contentType)) return "mp4";
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
  headers.set("user-agent", "ossd-course-portal-sbi4u-finalizer/1.0");
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

function isLoginPageContent(value) {
  return /Welcome to Sunnybrook|Enter your details to log in|Forgot your password|Moodle: Log in to the site|logintoken|用户名|密码/i.test(stripTags(value));
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  const pattern = /\b(?:href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    try {
      const url = new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString();
      if (!/\/(?:theme|webservice)\//i.test(url) && !/\/pluginfile\.php\/\d+\/theme_[^/]+\//i.test(url)) urls.add(url);
    } catch {
      // Ignore malformed URLs.
    }
  }
  return [...urls];
}

function previewPath(resourcePath) {
  const rel = `previews-html/${toPosix(resourcePath)}.html`;
  return existsSync(join(courseRoot, rel)) ? rel : undefined;
}

function withPreview(item) {
  if (item?.path) {
    const preview = previewPath(item.path);
    if (preview) item.previewPath = preview;
  }
  return item;
}

async function downloadFile(url, targetDir, label) {
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (/text\/html/i.test(contentType) && isLoginPageContent(buffer.toString("utf8", 0, Math.min(buffer.length, 2000)))) {
    throw new Error(`Moodle login page returned for attachment: ${url}`);
  }
  const filename = filenameFromHeaders(response.url || url, response.headers, label || `${hashText(url)}.bin`);
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer, contentType);
  const rel = toPosix(join(targetDir, `${hashText(url)}-${sanitizeSegment(filename)}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  if (!existsSync(abs) || statSync(abs).size !== buffer.length) writeFileSync(abs, buffer);
  return withPreview({
    label: filename,
    type,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: rel,
    bytes: buffer.length,
    source: url,
  });
}

function extractCollapseBody(rawHtml, collapseId) {
  const marker = `id="collapseSection-${collapseId}"`;
  const start = rawHtml.indexOf(marker);
  if (start < 0) throw new Error(`Missing collapseSection-${collapseId}`);
  const openStart = rawHtml.lastIndexOf("<div", start);
  if (openStart < 0) throw new Error(`Cannot locate collapseSection-${collapseId} opening div`);
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = openStart;
  let depth = 0;
  for (const match of rawHtml.matchAll(tagPattern)) {
    if (match.index < openStart) continue;
    if (/^<div\b/i.test(match[0])) depth += 1;
    else depth -= 1;
    if (depth === 0) return rawHtml.slice(openStart, match.index + match[0].length);
  }
  return rawHtml.slice(openStart);
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
    .replace(/<div\b[^>]*class=["'][^"']*\b(?:drawer|navbar|breadcrumb|secondary-navigation|courseindex|block-region|dropdown-menu|gradingsummary|activity-navigation|availabilityinfo)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
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
  return String(body || "").replace(/\b(href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    try {
      const url = new URL(raw.replaceAll("&amp;", "&"), source).toString();
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      const attachment = localByUrl.get(url) || localByUrl.get(parsed.toString());
      if (attachment?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, attachment.path), true)}"`;
    } catch {
      // Fall through.
    }
    return `data-localized-link="${attr}-unavailable"`;
  });
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

function attachmentLinks(indexRel, attachments) {
  return attachments.map((item) => ({
    ...item,
    href: courseRelative(indexRel, item.path),
    previewHref: item.previewPath ? courseRelative(indexRel, item.previewPath) : "",
  }));
}

function resourceListHtml(indexRel, items) {
  const rows = [];
  for (const item of items.filter(Boolean)) {
    if (!item.path) continue;
    const href = courseRelative(indexRel, item.path);
    const attachmentCount = item.attachments?.length || 0;
    rows.push(`<li><span><a href="${htmlEscape(href, true)}">${htmlEscape(item.label)}</a>${attachmentCount ? ` <small>${attachmentCount} file${attachmentCount === 1 ? "" : "s"}</small>` : ""}</span><span><a href="${htmlEscape(href, true)}">Open</a></span></li>`);
    for (const attachment of attachmentLinks(indexRel, item.attachments || [])) {
      const view = attachment.previewHref || attachment.href;
      rows.push(`<li><span class="child-file">${htmlEscape(attachment.label)}</span><span><a href="${htmlEscape(view, true)}">View</a> <a href="${htmlEscape(attachment.href, true)}" download>Download</a></span></li>`);
    }
  }
  return rows.length ? `<section class="attachments"><h2>Resources</h2><ul>${rows.join("")}</ul></section>` : "";
}

function rewriteSectionPage(record, items, note = "") {
  const indexRel = record.path;
  const body = `${note ? `<p>${htmlEscape(note)}</p>` : ""}${resourceListHtml(indexRel, items)}`;
  const abs = join(courseRoot, indexRel);
  writeFileSync(abs, pageHtml(record.label, body, []), "utf8");
  record.bytes = statSync(abs).size;
  record.textPreview = stripTags(body).slice(0, 800);
  record.linkedResources = items.filter(Boolean).map((item) => ({
    label: item.label,
    path: item.path,
    attachments: item.attachments?.length || 0,
  }));
}

function rewriteCourseResourceSections(manifest) {
  const courseDownloads = manifest.courseDownloads || [];
  const teacherResources = manifest.teacherResources || [];
  const byRole = (roles) => courseDownloads.filter((item) => roles.includes(item.role));
  const findSection = (role) => manifest.courseSections?.find((item) => item.role === role);

  const introduction = findSection("course_introduction");
  if (introduction) {
    rewriteSectionPage(introduction, byRole(["formal_lab_reports"]));
  }

  const overview = findSection("course_overview");
  if (overview) {
    rewriteSectionPage(overview, byRole(["course_outline", "learning_log"]));
  }

  const finalSection = findSection("final_examination_culminating");
  if (finalSection) {
    rewriteSectionPage(finalSection, byRole(["culminating_submission", "exam_review", "final_exam_submission"]));
  }

  const teacherPacket = findSection("teacher_packet");
  if (teacherPacket) {
    const answerKeys = teacherResources.filter((item) => item.role === "answer_keys" || /answer keys/i.test(item.label || ""));
    rewriteSectionPage(teacherPacket, answerKeys);
  }
}

async function buildSectionPage(rawCourseHtml, { collapseId, title, role, targetDir, sectionNumber }) {
  const source = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}${sectionNumber != null ? `&section=${sectionNumber}` : ""}`;
  rmSync(join(courseRoot, targetDir), { recursive: true, force: true });
  const bodyRaw = extractCollapseBody(rawCourseHtml, collapseId);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(bodyRaw, source)) {
    try {
      const attachment = await downloadFile(url, join(targetDir, "files"));
      attachments.push(attachment);
      localByUrl.set(url, attachment);
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      localByUrl.set(parsed.toString(), attachment);
    } catch {
      // Broken Moodle files are recorded elsewhere; do not fabricate content.
    }
  }
  const indexRel = toPosix(join(targetDir, "index.html"));
  let body = sectionContentOnly(bodyRaw);
  body = localizePluginfileRefs({ body, source, indexRel, localByUrl });
  body = cleanBody(body);
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, pageHtml(title, body, attachmentLinks(indexRel, attachments)), "utf8");
  return {
    label: title,
    type: "html",
    category: "moodle_course_section",
    role,
    path: indexRel,
    bytes: statSync(abs).size,
    source,
    moodleSectionNumber: sectionNumber,
    moodleSectionId: String(collapseId),
    attachments,
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

async function fetchActivityHtml({ id, mod }) {
  const source = `https://www.esunnybrook.com/mod/${mod}/view.php?id=${id}`;
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (isLoginPageContent(rawHtml)) throw new Error(`Moodle login page returned for ${source}`);
  return { source, rawHtml };
}

async function buildActivityPage({ id, mod = "assign", title, role, targetDir, teacherUse, teacherOnly = false, unit }) {
  const { source, rawHtml } = await fetchActivityHtml({ id, mod });
  const bodyRaw = extractIntro(rawHtml) || sectionContentOnly(rawHtml);
  const attachments = [];
  const localByUrl = new Map();
  for (const url of pluginfileUrls(`${bodyRaw}\n${rawHtml}`, source)) {
    try {
      const attachment = await downloadFile(url, join(targetDir, "files"));
      attachments.push(attachment);
      localByUrl.set(url, attachment);
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      localByUrl.set(parsed.toString(), attachment);
    } catch {
      // Skip unavailable attachments.
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
  writeFileSync(abs, pageHtml(title, body, attachmentLinks(indexRel, attachments)), "utf8");
  return {
    label: title,
    type: "html",
    category: `moodle_${mod}`,
    role,
    path: indexRel,
    bytes: statSync(abs).size,
    source,
    moodleActivityId: String(id),
    mod,
    teacherUse,
    ...(teacherOnly ? { teacherOnly: true } : {}),
    ...(unit ? { unit } : {}),
    attachments,
    textPreview: stripTags(body).slice(0, 800),
  };
}

async function buildResourceFile({ id, title, role, targetDir, teacherUse, unit }) {
  const { source, rawHtml } = await fetchActivityHtml({ id, mod: "resource" });
  const urls = pluginfileUrls(rawHtml, source);
  if (!urls.length) {
    return buildActivityPage({ id, mod: "resource", title, role, targetDir, teacherUse, unit });
  }
  const item = await downloadFile(urls[0], targetDir, title);
  return {
    ...item,
    label: title,
    category: "moodle_resource",
    role,
    source,
    moodleActivityId: String(id),
    mod: "resource",
    teacherUse,
    ...(unit ? { unit } : {}),
  };
}

function activityTargetDir(mod, id, title) {
  return `localized-moodle-activities/${mod}/${mod}-${id}-${sanitizeSegment(title)}`;
}

function keyOf(item) {
  return `${item.path || ""}|${item.moodleActivityId || ""}|${item.category || ""}|${item.source || ""}|${item.label || ""}`;
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
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

const unavailableActivities = [];

async function tryBuildActivity(build, context) {
  try {
    return await build();
  } catch (error) {
    unavailableActivities.push({
      ...context,
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function walkResources(node, callback) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkResources(item, callback);
    return;
  }
  if (node.path || node.previewPath || node.packagePath || node.downloadPath) callback(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walkResources(value, callback);
  }
}

function removePlaybackDownloads(manifest) {
  let ispringZipBytes = 0;
  let ispringZipCount = 0;
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.ispring || []) {
        delete item.downloadPath;
        delete item.downloadUrl;
        delete item.downloadBytes;
      }
      for (const item of lesson.downloads || []) {
        if (/^(mp4|webm|mov|video)$/i.test(item.type || "")) {
          delete item.downloadPath;
          delete item.downloadUrl;
        }
      }
    }
  }
  const zipRoot = join(courseRoot, "ispring-localized");
  if (existsSync(zipRoot)) {
    const stack = [zipRoot];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(abs);
        else if (/\.zip$/i.test(entry.name)) {
          ispringZipBytes += statSync(abs).size;
          ispringZipCount += 1;
          rmSync(abs, { force: true });
        }
      }
    }
  }
  return { ispringZipCount, ispringZipBytes };
}

function countFiles(relativeDir, pattern = null) {
  const dir = join(courseRoot, relativeDir);
  if (!existsSync(dir)) return 0;
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (!pattern || pattern.test(entry.name)) count += 1;
    }
  }
  return count;
}

await loginIfNeeded();

const courseUrl = `https://www.esunnybrook.com/course/view.php?id=${moodleCourseId}`;
const courseResponse = await request(courseUrl);
const rawCourseHtml = await courseResponse.text();
if (!courseResponse.ok) throw new Error(`HTTP ${courseResponse.status}: ${courseUrl}`);
if (isLoginPageContent(rawCourseHtml)) throw new Error(`Moodle login page returned for ${courseUrl}`);

const manifest = readJson(manifestPath);
manifest.courseDownloads ||= [];
manifest.courseSections ||= [];
manifest.teacherResources ||= [];
manifest.evaluations = [];
const previousSourceAudit = manifest.sourceAudit || {};

const cleanup = removePlaybackDownloads(manifest);

const courseSections = [
  await buildSectionPage(rawCourseHtml, { collapseId: 894, sectionNumber: 0, title: "Introduction", role: "course_introduction", targetDir: "course-sections/introduction" }),
  await buildSectionPage(rawCourseHtml, { collapseId: 895, sectionNumber: 1, title: "Course Overview", role: "course_overview", targetDir: "course-sections/course-overview" }),
  await buildSectionPage(rawCourseHtml, { collapseId: 901, sectionNumber: 7, title: "Final Exam & Culminating", role: "final_examination_culminating", targetDir: "course-sections/final-exam-culminating" }),
  await buildSectionPage(rawCourseHtml, { collapseId: 903, sectionNumber: 9, title: "Teacher Packet", role: "teacher_packet", targetDir: "course-sections/teacher-packet" }),
];
for (const section of courseSections) upsertByIdentity(manifest.courseSections, section);

const courseActivities = [
  () => buildResourceFile({ id: 9501, title: "Lab Report Template", role: "lab_report_template", targetDir: "localized-moodle-activities/resource/course-9501-lab-report-template", teacherUse: "course_preparation" }),
  () => buildActivityPage({ id: 9502, mod: "page", title: "Writing Formal Lab Reports", role: "formal_lab_reports", targetDir: activityTargetDir("page", 9502, "Writing Formal Lab Reports"), teacherUse: "course_preparation" }),
  () => buildActivityPage({ id: 9503, mod: "assign", title: "SBI4U Course Outline", role: "course_outline", targetDir: activityTargetDir("assign", 9503, "SBI4U Course Outline"), teacherUse: "course_planning" }),
  () => buildActivityPage({ id: 9504, mod: "assign", title: "Learning Log", role: "learning_log", targetDir: activityTargetDir("assign", 9504, "Learning Log"), teacherUse: "student_progress_tracking" }),
  () => buildActivityPage({ id: 9606, mod: "assign", title: "Culminating", role: "culminating_submission", targetDir: activityTargetDir("assign", 9606, "Culminating"), teacherUse: "final_evaluation" }),
  () => buildResourceFile({ id: 9607, title: "SBI4U Exam Review", role: "exam_review", targetDir: "localized-moodle-activities/resource/course-9607-sbi4u-exam-review", teacherUse: "final_evaluation" }),
  () => buildActivityPage({ id: 9605, mod: "assign", title: "Final Exam Submission", role: "final_exam_submission", targetDir: activityTargetDir("assign", 9605, "Final Exam Submission"), teacherUse: "final_evaluation" }),
];
for (const build of courseActivities) {
  const record = await tryBuildActivity(build, { scope: "course_resource" });
  if (record) upsertByIdentity(manifest.courseDownloads, record);
}
manifest.courseDownloads = manifest.courseDownloads.filter((item) => item.path !== "plans/course/SBI4U_Course_Outline.docx");

const answerKeys = await tryBuildActivity(
  () => buildActivityPage({
    id: 9636,
    mod: "assign",
    title: "Answer Keys",
    role: "answer_keys",
    targetDir: activityTargetDir("assign", 9636, "Answer Keys"),
    teacherUse: "answer_key_reference",
    teacherOnly: true,
  }),
  { scope: "teacher_resource", id: 9636, mod: "assign", title: "Answer Keys" },
);
if (answerKeys) upsertByIdentity(manifest.teacherResources, answerKeys);

const unitActivities = {
  1: {
    evaluations: [
      ["Unit 1 - Lab", "assign", 9508, "unit_lab"],
      ["Unit 1 - Test 1", "quiz", 9509, "quiz"],
      ["Unit 1 - Test 2", "quiz", 9510, "quiz"],
    ],
    reflectionAndLogs: [
      ["Unit 1 - KWL Dropbox", "assign", 9524, "kwl_dropbox"],
      ["Unit 1 - Reflection Summary Dropbox", "assign", 9525, "reflection_dropbox"],
    ],
    lessonDropboxes: [9512, 9514, 9516, 9518, 9520, 9522].map((id, index) => [`Unit 1 - Lesson ${index + 1}`, "assign", id]),
    answerPages: [9513, 9515, 9517, 9519, 9521, 9523].map((id, index) => [`Unit 1 - Lesson ${index + 1} Answer`, "page", id]),
  },
  2: {
    evaluations: [
      ["Unit 2 Assignment", "assign", 9529, "aol_assessment"],
      ["Unit 2 - Test 1", "quiz", 9530, "quiz"],
      ["Unit 2 - Test 2", "quiz", 9531, "quiz"],
    ],
    reflectionAndLogs: [
      ["Unit 2 - KWL Dropbox", "assign", 9546, "kwl_dropbox"],
      ["Unit 2 - Reflection Summary Dropbox", "assign", 9547, "reflection_dropbox"],
    ],
    lessonDropboxes: [9533, 9535, 9537, 9539, 9542, 9544].map((id, index) => [`Unit 2 - Lesson ${index + 1}`, "assign", id]),
    answerPages: [9534, 9536, 9538, 9540, 9543, 9545].map((id, index) => [`Unit 2 - Lesson ${index + 1} Answer`, "page", id]),
  },
  3: {
    evaluations: [
      ["Unit 3 - Lab", "assign", 9551, "unit_lab"],
      ["Unit 3 - Test 1", "quiz", 9552, "quiz"],
      ["Unit 3 - Test 2", "quiz", 9553, "quiz"],
    ],
    reflectionAndLogs: [
      ["Unit 3 - KWL Dropbox", "assign", 9563, "kwl_dropbox"],
      ["Unit 3 - Reflection Summary Dropbox", "assign", 9564, "reflection_dropbox"],
    ],
    lessonDropboxes: [
      ["Unit 3 - Lesson 1", "assign", 9555],
      ["Unit 3 - Lesson 2", "assign", 9557],
      ["Unit 3 - Lesson 3", "assign", 9559],
      ["Unit 3 - Lesson 4", "assign", 9561],
    ],
    answerPages: [
      ["Unit 3 - Lesson 1 Answer", "page", 9556],
      ["Unit 3 - Lesson 3 Answer", "page", 9560],
      ["Unit 3 - Lesson 4 Answer", "page", 9562],
    ],
  },
  4: {
    evaluations: [
      ["Unit 4 - Lab", "assign", 9568, "unit_lab"],
      ["Unit 4 - Test 1", "quiz", 9569, "quiz"],
      ["Unit 4 - Test 2", "quiz", 9570, "quiz"],
    ],
    reflectionAndLogs: [
      ["Unit 4 - KWL Dropbox", "assign", 9586, "kwl_dropbox"],
      ["Unit 4 - Reflection Summary Dropbox", "assign", 9587, "reflection_dropbox"],
    ],
    lessonDropboxes: [9572, 9574, 9576, 9578, 9580, 9582, 9584].map((id, index) => [`Unit 4 - Lesson ${index + 1}`, "assign", id]),
    answerPages: [9573, 9575, 9577, 9579, 9581, 9583, 9585].map((id, index) => [`Unit 4 - Lesson ${index + 1} Answer`, "page", id]),
  },
  5: {
    evaluations: [
      ["Unit 5 Lab", "assign", 9591, "unit_lab"],
      ["Unit 5 - Test 1", "quiz", 9592, "quiz"],
      ["Unit 5 - Test 2", "quiz", 9593, "quiz"],
    ],
    reflectionAndLogs: [
      ["Unit 5 - KWL Dropbox", "assign", 9603, "kwl_dropbox"],
      ["Unit 5 - Reflection Summary Dropbox", "assign", 9604, "reflection_dropbox"],
    ],
    lessonDropboxes: [9595, 9597, 9599, 9601].map((id, index) => [`Unit 5 - Lesson ${index + 1}`, "assign", id]),
    answerPages: [9596, 9598, 9600, 9602].map((id, index) => [`Unit 5 - Lesson ${index + 1} Answer`, "page", id]),
  },
};

for (const unit of manifest.units || []) {
  const config = unitActivities[unit.unit];
  if (!config) continue;
  unit.unitResources ||= {};
  unit.unitResources.evaluations = [];
  unit.unitResources.reflectionAndLogs = [];
  unit.unitResources.lessonDropboxes = [];
  unit.unitResources.answerPages = [];

  for (const [title, mod, id, role] of config.evaluations) {
    const record = await tryBuildActivity(
      () => buildActivityPage({
        id,
        mod,
        title,
        role: role === "quiz" ? "quiz" : role,
        unit: unit.unit,
        targetDir: activityTargetDir(mod, id, title),
        teacherUse: "assessment_preparation",
      }),
      { scope: "unit_evaluation", unit: unit.unit, id, mod, title },
    );
    if (record) {
      upsertByIdentity(unit.unitResources.evaluations, record);
      upsertByIdentity(manifest.evaluations, record);
      upsertByIdentity(manifest.teacherResources, { ...record, teacherUse: "assessment_preparation" });
    }
  }
  for (const [title, mod, id, role] of config.reflectionAndLogs) {
    const record = await tryBuildActivity(
      () => buildActivityPage({
        id,
        mod,
        title,
        role,
        unit: unit.unit,
        targetDir: activityTargetDir(mod, id, title),
        teacherUse: "student_progress_tracking",
      }),
      { scope: "unit_reflection_log", unit: unit.unit, id, mod, title },
    );
    if (record) upsertByIdentity(unit.unitResources.reflectionAndLogs, record);
  }
  for (const [title, mod, id] of config.lessonDropboxes) {
    const record = await tryBuildActivity(
      () => buildActivityPage({
        id,
        mod,
        title,
        role: "lesson_dropbox",
        unit: unit.unit,
        targetDir: activityTargetDir(mod, id, title),
        teacherUse: "lesson_submission",
      }),
      { scope: "lesson_dropbox", unit: unit.unit, id, mod, title },
    );
    if (record) upsertByIdentity(unit.unitResources.lessonDropboxes, record);
  }
  for (const [title, mod, id] of config.answerPages) {
    const record = await tryBuildActivity(
      () => buildActivityPage({
        id,
        mod,
        title,
        role: "lesson_answer_page",
        unit: unit.unit,
        targetDir: activityTargetDir(mod, id, title),
        teacherUse: "answer_key_reference",
        teacherOnly: true,
      }),
      { scope: "lesson_answer_page", unit: unit.unit, id, mod, title },
    );
    if (record) {
      upsertByIdentity(unit.unitResources.answerPages, record);
      upsertByIdentity(manifest.teacherResources, record);
    }
  }
}

manifest.courseSections = dedupeList(manifest.courseSections);
manifest.courseDownloads = dedupeList(manifest.courseDownloads);
manifest.teacherResources = dedupeList(manifest.teacherResources);
manifest.evaluations = dedupeList(manifest.evaluations);

rewriteCourseResourceSections(manifest);

let ispringExpected = 0;
let ispringComplete = 0;
let ispringPlayable = 0;
for (const unit of manifest.units || []) {
  let downloads = 0;
  let ispring = 0;
  let videos = 0;
  for (const lesson of unit.lessons || []) {
    downloads += (lesson.downloads || []).length;
    ispring += (lesson.ispring || []).length;
    videos += (lesson.downloads || []).filter((item) => /^(mp4|webm|mov)$/i.test(item.type || "")).length;
    for (const item of lesson.ispring || []) {
      ispringExpected += 1;
      if (item.localizationStatus === "localized") ispringComplete += 1;
      if (["localized", "partial"].includes(item.localizationStatus) && item.path) ispringPlayable += 1;
    }
    lesson.resourceCounts = {
      ...(lesson.resourceCounts || {}),
      downloads: (lesson.downloads || []).length,
      bookSections: lesson.bookPageCount || lesson.bookSections?.length || 0,
      lessonPlan: lesson.lessonPlan ? 1 : 0,
      ispring: lesson.ispring?.length || 0,
      h5p: lesson.h5p?.length || 0,
      video: (lesson.downloads || []).filter((item) => /^(mp4|webm|mov)$/i.test(item.type || "")).length,
    };
  }
  unit.summary = {
    ...(unit.summary || {}),
    downloads,
    ispring,
    video: videos,
    evaluations: unit.unitResources?.evaluations?.length || 0,
    reflectionAndLogs: unit.unitResources?.reflectionAndLogs?.length || 0,
  };
}

const sourceAuditDoc = (manifest.texts || []).find((item) => item.id === "sbi4u-source-audit");
if (sourceAuditDoc?.materials?.[0]) {
  sourceAuditDoc.bytes = statSync(join(courseRoot, sourceAuditDoc.path)).size;
  sourceAuditDoc.materials[0].bytes = sourceAuditDoc.bytes;
}

manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  lessonCount: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
  ispringExpected,
  ispringComplete,
  ispringPartial: Math.max(0, ispringExpected - ispringComplete),
  ispringDownloadPackages: 0,
  ispringPlayable,
  ispringDownloadPolicy: "playback-only-no-download",
  removedIspringZipPackages: cleanup.ispringZipCount || previousSourceAudit.removedIspringZipPackages || 0,
  removedIspringZipBytes: cleanup.ispringZipBytes || previousSourceAudit.removedIspringZipBytes || 0,
  ispringZipPackagesPresent: countFiles("ispring-localized", /\.zip$/i),
  textbookAudit: {
    status: "not_identified",
    evidence: "No full textbook file or specific textbook title was identified in Moodle book pages, local SBI4U planning previews, or the local docs folder.",
    searchedLocations: ["D:/工作文件/SUNNYBROOK/docs", "D:/工作文件/SUNNYBROOK/courseware/SBI4U"],
    decision: "Do not add a textbook until a matching legal SBI4U/Biology 12 textbook is provided or Moodle explicitly supplies one.",
  },
  curriculumPdfIncluded: true,
  textMaterials: manifest.texts?.length || 0,
  localizedDocumentCount: countFiles("localized-moodle/document"),
  localizedPdfCount: countFiles("localized-moodle/pdf"),
  localizedH5pCount: countFiles("localized-moodle/h5p"),
  localizedVideoCount: countFiles("localized-moodle/video"),
  videoExpected: 28,
  videoLocalized: countFiles("localized-moodle/video"),
  videoFailed: Math.max(0, 28 - countFiles("localized-moodle/video")),
  documentExpected: 39,
  documentLocalized: countFiles("localized-moodle/document"),
  pdfExpected: 27,
  pdfLocalized: countFiles("localized-moodle/pdf"),
  h5pExpected: 0,
  h5pLocalized: countFiles("localized-moodle/h5p"),
  courseResourcesFinalizedAt: new Date().toISOString(),
  courseSectionLocalization: {
    moodleCourseId,
    sections: courseSections.map((item) => ({
      title: item.label,
      role: item.role,
      moodleSectionId: item.moodleSectionId,
      moodleSectionNumber: item.moodleSectionNumber,
      path: item.path,
      attachments: item.attachments?.length || 0,
    })),
    note: "Course-level pages are localized from Moodle collapse sections. Exit Cards are excluded as formative student activities.",
  },
  courseResourceExpectedActivities: {
    labReportTemplate: 9501,
    writingFormalLabReports: 9502,
    courseOutline: 9503,
    learningLog: 9504,
    finalExamSubmission: 9605,
    culminating: 9606,
    examReview: 9607,
    answerKeys: 9636,
  },
  unavailableActivities,
};

if (Array.isArray(previousSourceAudit.failedMedia)) {
  manifest.sourceAudit.failedMedia = previousSourceAudit.failedMedia.map((item) => {
    if (item?.url && !item.source) item.source = item.url;
    if (item?.url) delete item.url;
    return item;
  });
}

walkResources(manifest, (item) => {
  if (item.path) withPreview(item);
});

manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

const catalog = readJson(catalogPath);
const row = catalog.courses.find((courseRow) => courseRow.code === course);
if (!row) throw new Error(`${course} not found in course catalog`);
row.status = "ready";
row.notes = "Moodle book lessons, localized iSpring/video, course resources, unit evaluations/reflections, local documents/PDFs, previews, course outline, official curriculum, and source audit are packaged; no confirmed legal textbook title/file has been identified.";
writeJson(catalogPath, catalog);

console.log(JSON.stringify({
  course,
  courseSections: manifest.courseSections.map((item) => ({ label: item.label, role: item.role, path: item.path, attachments: item.attachments?.length || 0 })),
  courseDownloads: manifest.courseDownloads.map((item) => ({ label: item.label, role: item.role, path: item.path, attachments: item.attachments?.length || 0 })),
  teacherResources: manifest.teacherResources.length,
  evaluations: manifest.evaluations.length,
  removedIspringZipPackages: cleanup.ispringZipCount,
  removedIspringZipBytes: cleanup.ispringZipBytes,
}, null, 2));
