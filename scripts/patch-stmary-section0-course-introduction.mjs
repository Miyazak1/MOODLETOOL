import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
loadEnvFile(join(projectRoot, ".env"));

const course = readArg("--course")?.toUpperCase();
const courseId = readArg("--course-id");
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/login\/index\.php$/i, "");

if (!course || !courseId) {
  console.error("Usage: node scripts/patch-stmary-section0-course-introduction.mjs --course COURSE --course-id ID");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const sectionDir = join(projectRoot, "inbox", `${course.toLowerCase()}-stmary-sections`);
const courseUrl = `${baseUrl}/course/view.php?id=${courseId}`;
const downloadCache = new Map();
const downloadFailures = [];

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
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

class CookieJar {
  constructor() {
    this.cookies = new Map();
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

const jar = new CookieJar();

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-stmary-section0-patch/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function login() {
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing St.Mary Moodle credentials in .env.");
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St.Mary Moodle login failed.");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sha10(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function textPreview(value, length = 800) {
  return stripTags(value).slice(0, length);
}

function sanitizeSegment(value) {
  return decodeEntities(String(value || "resource"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "") || "resource";
}

function slug(value) {
  return sanitizeSegment(value)
    .replace(/&/g, "and")
    .replace(/[^A-Za-z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90)
    .replace(/-$/g, "") || "resource";
}

function fileNameFromUrl(url, fallback = "resource") {
  const parsed = new URL(decodeEntities(url), baseUrl);
  let name = decodeURIComponent(parsed.pathname.split("/").pop() || fallback);
  name = sanitizeSegment(name);
  if (!extname(name)) {
    const match = /filename="?([^";]+)"?/i.exec(parsed.search);
    if (match) name = sanitizeSegment(match[1]);
  }
  return name || fallback;
}

function typeFromPath(path) {
  const ext = extname(String(path || "")).replace(".", "").toLowerCase();
  return ext === "jpeg" ? "jpg" : ext || "html";
}

function hasValidSignature(bytes, fileName, contentType = "") {
  const ext = extname(fileName).toLowerCase();
  const head = bytes.subarray(0, 16);
  const ascii = head.toString("latin1");
  const textHead = bytes.subarray(0, 128).toString("utf8").trimStart();
  if (/text\/html/i.test(contentType) || /^<!doctype html|^<html\b/i.test(textHead)) return false;
  if ([".docx", ".xlsx", ".pptx", ".zip", ".h5p"].includes(ext)) return ascii.startsWith("PK") || ascii.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1");
  if ([".doc", ".xls", ".ppt"].includes(ext)) return ascii.startsWith("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1");
  if (ext === ".pdf") return ascii.startsWith("%PDF");
  if (ext === ".png") return ascii.startsWith("\x89PNG");
  if (ext === ".gif") return ascii.startsWith("GIF8");
  if ([".jpg", ".jpeg"].includes(ext)) return head[0] === 0xff && head[1] === 0xd8;
  if (ext === ".svg") return /<svg\b/i.test(bytes.subarray(0, 2048).toString("utf8"));
  if ([".mp4", ".m4v", ".mov"].includes(ext)) return bytes.subarray(4, 12).toString("latin1").includes("ftyp") || /video\//i.test(contentType);
  return bytes.length > 0;
}

function maybePreviewPath(resource) {
  if (!resource?.path) return resource;
  const ext = extname(resource.path).toLowerCase();
  if ([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".tif", ".tiff"].includes(ext)) resource.previewPath = resource.path;
  return resource;
}

function extractUrls(htmlValue) {
  const urls = new Set();
  for (const match of String(htmlValue || "").matchAll(/\s(?:href|src|poster)=["']([^"']+)["']/gi)) urls.add(decodeEntities(match[1]));
  return [...urls];
}

function isDownloadableMoodleUrl(url) {
  if (!url) return false;
  const absolute = new URL(url, baseUrl).toString();
  if (new URL(absolute).host !== new URL(baseUrl).host) return false;
  if (!/\/(?:pluginfile|draftfile)\.php\//i.test(absolute)) return false;
  if (/\/theme(?:\/|_)|\/logo\/|\/icon\b/i.test(absolute)) return false;
  return true;
}

function extractBalancedElement(html, start, tagName) {
  const tag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "ig");
  token.lastIndex = start;
  let depth = 0;
  let sawStart = false;
  for (const match of html.matchAll(token)) {
    const index = match.index || 0;
    if (index < start) continue;
    const text = match[0];
    if (!sawStart && !new RegExp(`^<${tag}\\b`, "i").test(text)) return "";
    sawStart = true;
    if (new RegExp(`^<${tag}\\b`, "i").test(text) && !/\/\s*>$/.test(text)) depth += 1;
    else if (new RegExp(`^</${tag}\\b`, "i").test(text)) depth -= 1;
    if (sawStart && depth === 0) return html.slice(start, index + text.length);
  }
  return "";
}

function extractSectionSummaryFragment(sectionHtml) {
  const summary = /<div\b[^>]*class=["'][^"']*\bsummary\b[^"']*["'][^>]*>/i.exec(String(sectionHtml || ""));
  if (!summary) return sectionHtml || "";
  return extractBalancedElement(sectionHtml, summary.index || 0, "div") || summary[0];
}

function extractMainContent(html) {
  const roleMain = /<div\b[^>]*role=["']main["'][^>]*>/i.exec(html);
  if (roleMain) {
    const balanced = extractBalancedElement(html, roleMain.index || 0, "div");
    if (balanced) return balanced.replace(/^<div\b[^>]*role=["']main["'][^>]*>/i, "").replace(/<\/div>\s*$/i, "");
  }
  const region = /<section\b[^>]*\bid=["']region-main["'][^>]*>/i.exec(html);
  if (region) {
    const balanced = extractBalancedElement(html, region.index || 0, "section");
    if (balanced) return balanced.replace(/^<section\b[^>]*\bid=["']region-main["'][^>]*>/i, "").replace(/<\/section>\s*$/i, "");
  }
  return html;
}

async function downloadResource(url, targetRelDir, label = "") {
  const absoluteUrl = new URL(decodeEntities(url), baseUrl).toString();
  if (downloadCache.has(absoluteUrl)) return downloadCache.get(absoluteUrl);
  const fileName = fileNameFromUrl(absoluteUrl, label || "resource");
  const targetRel = toPosix(join(targetRelDir, `${sha10(absoluteUrl)}-${fileName}`));
  const targetAbs = join(courseRoot, targetRel);
  mkdirSync(dirname(targetAbs), { recursive: true });
  try {
    let bytes = null;
    if (existsSync(targetAbs)) {
      bytes = readFileSync(targetAbs);
      if (!hasValidSignature(bytes, fileName, "")) bytes = null;
    }
    if (!bytes) {
      const response = await request(absoluteUrl, { headers: { referer: courseUrl } });
      bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !hasValidSignature(bytes, fileName, contentType)) throw new Error(`invalid-download status=${response.status} type=${contentType} bytes=${bytes.length}`);
      writeFileSync(targetAbs, bytes);
    }
    const resource = maybePreviewPath({
      label: fileName,
      type: typeFromPath(fileName),
      category: "moodle_file",
      role: "attachment",
      path: targetRel,
      bytes: bytes.length,
      source: absoluteUrl,
    });
    if (!["mp4", "m4v", "mov"].includes(resource.type)) resource.downloadPath = targetRel;
    downloadCache.set(absoluteUrl, resource);
    return resource;
  } catch (error) {
    downloadFailures.push({ url: absoluteUrl, targetRel, reason: String(error.message || error) });
    downloadCache.set(absoluteUrl, null);
    return null;
  }
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function cleanHtmlFragment(htmlValue, attachmentMap = new Map()) {
  let body = String(htmlValue || "");
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  body = body.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  body = body.replace(/<form\b[\s\S]*?<\/form>/gi, "");
  body = body.replace(/<nav\b[\s\S]*?<\/nav>/gi, "");
  body = body.replace(/<div[^>]*class=["'][^"']*(?:navigation-arrows|navtop|navbottom|region_main_settings_menu_proxy|notifications|availabilityinfo|activity-information|completion-info|gradingsummary|fileuploadsubmissiontime|tileiconcontainer|completionhelp|modified|completionchangenotify)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");
  body = body.replace(/<button\b[\s\S]*?<\/button>/gi, "");
  body = body.replace(/<ul[^>]*class=["'][^"']*\bsection\b[^"']*\bimg-text\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, "");
  body = body.replace(/<span[^>]*id=["']maincontent["'][^>]*><\/span>/gi, "");
  body = body.replace(/<img[^>]+src=["'][^"']*\/theme\/image\.php[^"']*["'][^>]*>/gi, "");
  body = body.replace(/\s(?:href|src|poster)=["']([^"']+)["']/gi, (full, rawUrl) => {
    const absolute = new URL(decodeEntities(rawUrl), baseUrl).toString();
    if (attachmentMap.has(absolute)) return full.replace(rawUrl, attachmentMap.get(absolute));
    if (/^(?:https?:)?\/\//i.test(rawUrl) || rawUrl.startsWith("/") || rawUrl.startsWith("view.php") || rawUrl.startsWith("mod/")) return "";
    return full;
  });
  body = body.replace(/\s(?:onclick|data-region|data-id|aria-describedby)=["'][^"']*["']/gi, "");
  body = body.replace(/https?:\/\/(?:34\.30\.231\.58|www\.esunnybrook\.com|welcome\.hexstruct\.com|hexstruct\.ispring\.com)[^\s<"]*/gi, "");
  body = body.replace(/\b(?:Completion requirements|Make a submission|Previous Activity|Next Activity|complete|Not complete)\b/gi, "");
  return body.trim();
}

async function localizeHtmlAssets(htmlValue, targetRelDir, pageRel) {
  const attachmentMap = new Map();
  const attachments = [];
  for (const url of extractUrls(htmlValue)) {
    if (!isDownloadableMoodleUrl(url)) continue;
    const resource = await downloadResource(url, targetRelDir, fileNameFromUrl(url));
    if (!resource) continue;
    const abs = new URL(decodeEntities(url), baseUrl).toString();
    attachmentMap.set(abs, relativeHref(pageRel, resource.previewPath || resource.path));
    attachments.push(resource);
  }
  return {
    html: cleanHtmlFragment(htmlValue, attachmentMap),
    attachments: uniqueResources(attachments),
  };
}

function uniqueResources(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.path || seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function renderAttachmentRow(item, pageRel) {
  const viewPath = item.previewPath || item.path;
  const type = String(item.type || "").toLowerCase();
  const canDownload = !["mp4", "m4v", "mov"].includes(type);
  const downloadButton = canDownload ? `<a class="button" href="${escapeAttr(relativeHref(pageRel, item.downloadPath || item.path))}" download>Download</a>` : "";
  return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${escapeAttr(relativeHref(pageRel, viewPath))}">View</a>${downloadButton}</div></div>`;
}

function renderPage(title, bodyHtml, attachments = [], pageRel = "index.html") {
  const attachmentHtml = attachments.length ? `<section class="files"><h2>Files</h2>${attachments.map((item) => renderAttachmentRow(item, pageRel)).join("")}</section>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    h3 { font-size: 18px; margin: 22px 0 10px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; margin-left: auto; margin-right: auto; max-width: 100%; }
    .content table { border-collapse: collapse; display: block; max-width: 100%; overflow-x: auto; }
    .content td, .content th { border: 1px solid #d6e2f0; padding: 8px 10px; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <article class="content">${bodyHtml || "<p>No page text was available from Moodle.</p>"}</article>
    ${attachmentHtml}
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function parseActivityUrl(url) {
  const parsed = new URL(url, baseUrl);
  const mod = /\/mod\/([^/]+)\//i.exec(parsed.pathname)?.[1] || "";
  const id = parsed.searchParams.get("id") || "";
  return { mod, id };
}

async function localizeActivity(link) {
  const { mod, id } = parseActivityUrl(link.href);
  const title = String(link.text || `${mod} ${id}`).trim();
  const relDir = toPosix(join("localized-moodle-activities", mod, `${mod}-${id}-${slug(title)}`));
  const response = await request(link.href, { headers: { referer: courseUrl } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${link.href}`);
  const contentType = response.headers.get("content-type") || "";
  if (mod === "resource" && !/html/i.test(contentType)) {
    const bytes = Buffer.from(await response.arrayBuffer());
    let fileName = fileNameFromUrl(response.url || link.href, title);
    if (!extname(fileName) && /pdf/i.test(contentType)) fileName = `${slug(title)}.pdf`;
    if (!hasValidSignature(bytes, fileName, contentType)) throw new Error(`invalid-resource-download type=${contentType} bytes=${bytes.length}`);
    const targetRel = toPosix(join(relDir, "files", `${sha10(response.url || link.href)}-${fileName}`));
    const targetAbs = join(courseRoot, targetRel);
    mkdirSync(dirname(targetAbs), { recursive: true });
    writeFileSync(targetAbs, bytes);
    const item = maybePreviewPath({
      label: title,
      fileName,
      type: typeFromPath(fileName),
      category: `moodle_${mod}`,
      role: "introduction",
      path: targetRel,
      bytes: bytes.length,
      source: link.href,
      moodleActivityId: id,
      mod,
      attachments: [],
      parentSection: "Introduction",
      sourceGroup: "course_section_0",
      textPreview: "",
    });
    if (!["mp4", "m4v", "mov"].includes(item.type)) item.downloadPath = targetRel;
    return item;
  }
  const html = await response.text();
  const main = extractMainContent(html);
  const pageRel = toPosix(join(relDir, "index.html"));
  const localized = await localizeHtmlAssets(main, toPosix(join(relDir, "files")), pageRel);
  for (const url of extractUrls(html)) {
    if (!isDownloadableMoodleUrl(url)) continue;
    const resource = await downloadResource(url, toPosix(join(relDir, "files")), fileNameFromUrl(url));
    if (resource && !localized.attachments.some((item) => item.path === resource.path)) localized.attachments.push(resource);
  }
  const pageHtml = renderPage(title, localized.html, localized.attachments.map(maybePreviewPath), pageRel);
  const pageAbs = join(courseRoot, pageRel);
  mkdirSync(dirname(pageAbs), { recursive: true });
  writeFileSync(pageAbs, pageHtml, "utf8");
  return {
    label: title,
    type: "html",
    category: `moodle_${mod}`,
    role: "introduction",
    path: pageRel,
    bytes: Buffer.byteLength(pageHtml, "utf8"),
    source: link.href,
    moodleActivityId: id,
    mod,
    attachments: localized.attachments.map(maybePreviewPath),
    textPreview: textPreview(localized.html),
    parentSection: "Introduction",
    sourceGroup: "course_section_0",
  };
}

function section0Payload() {
  const p = join(sectionDir, "section-00.json");
  if (!existsSync(p)) throw new Error(`Missing ${p}. Run export-stmary-course-raw first.`);
  return readJson(p);
}

function upsertByKey(items, resource) {
  const index = items.findIndex((item) => item.path === resource.path || item.source === resource.source || (resource.moodleActivityId && String(item.moodleActivityId || "") === String(resource.moodleActivityId)));
  if (index >= 0) items[index] = { ...items[index], ...resource };
  else items.push(resource);
}

function orderCourseSection(item) {
  if (item.role === "introduction") return 0;
  if (item.role === "course_overview") return 1;
  if (/final|culminating/i.test(item.role || "")) return 9;
  return 5;
}

await login();

const manifest = readJson(manifestPath);
const section0 = section0Payload();
const introRelDir = "course-sections/course-starter-resources";
const introPageRel = toPosix(join(introRelDir, "index.html"));
const sectionSummary = extractSectionSummaryFragment(section0.fragment || "");
const localizedIntro = await localizeHtmlAssets(sectionSummary, toPosix(join(introRelDir, "files")), introPageRel);
const introPageHtml = renderPage("Course Introduction", localizedIntro.html, localizedIntro.attachments.map(maybePreviewPath), introPageRel);
const introAbsPath = join(courseRoot, introPageRel);
mkdirSync(dirname(introAbsPath), { recursive: true });
writeFileSync(introAbsPath, introPageHtml, "utf8");

const introResource = {
  label: "Course Introduction",
  type: "html",
  category: "moodle_course_section",
  role: "introduction",
  path: introPageRel,
  bytes: Buffer.byteLength(introPageHtml, "utf8"),
  source: section0.url || courseUrl,
  sectionNumber: 0,
  attachments: localizedIntro.attachments.map(maybePreviewPath),
  textPreview: textPreview(localizedIntro.html),
  parentSection: "Introduction",
  sourceGroup: "course_section_0",
};

const introductionActivities = [];
for (const link of section0.modLinks || []) {
  if (/Lab report template|Writing Formal Lab Reports/i.test(link.text || "")) introductionActivities.push(await localizeActivity(link));
}

manifest.courseSections = (manifest.courseSections || []).filter((item) => {
  if (item.sourceGroup === "course_section_0") return false;
  if (item.path === introPageRel) return false;
  if (["10511", "10512"].includes(String(item.moodleActivityId || ""))) return false;
  return true;
});
upsertByKey(manifest.courseSections, introResource);
for (const item of introductionActivities) upsertByKey(manifest.courseSections, item);
manifest.courseSections.sort((a, b) => orderCourseSection(a) - orderCourseSection(b));

manifest.sourceAudit ||= {};
manifest.sourceAudit.section0Supplement = {
  patchedAt: new Date().toISOString(),
  source: section0.url || courseUrl,
  moodleHost: baseUrl,
  moodleCourseId: Number(courseId),
  role: "Course Introduction",
  includedActivities: introductionActivities.map((item) => ({ label: item.label, moodleActivityId: item.moodleActivityId, path: item.path, attachments: item.attachments?.length || 0 })),
  excludedActivities: ["Announcements", "Attendance Tracker"],
  attachments: localizedIntro.attachments.map((item) => ({ label: item.label, path: item.path, bytes: item.bytes })),
  note: "Localized St.Mary/New Moodle section 0 as Course Introduction; administrative forum and attendance tracker were not included as courseware content.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  courseId: Number(courseId),
  courseIntroduction: { path: introPageRel, attachments: localizedIntro.attachments.length, bytes: statSync(introAbsPath).size },
  activities: introductionActivities.map((item) => ({ label: item.label, type: item.type, path: item.path, attachments: item.attachments?.length || 0 })),
  downloadFailures,
}, null, 2));
