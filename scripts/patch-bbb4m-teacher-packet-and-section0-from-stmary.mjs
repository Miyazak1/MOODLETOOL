import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BBB4M";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "");
const teacherActivityId = 8012;
const teacherActivityUrl = `${baseUrl}/mod/assign/view.php?id=${teacherActivityId}`;
const teacherRelDir = "localized-moodle-activities/assign/assign-8012-answer-keys";
const teacherAbsDir = join(courseRoot, teacherRelDir);
const section0RelDir = "course-sections/course-starter-resources";
const section0AbsDir = join(courseRoot, section0RelDir);

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

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function filenameFromUrl(url) {
  const parsed = new URL(url);
  const name = decodeURIComponent(basename(parsed.pathname));
  return name && name !== "/" ? name : `${hashText(url)}.bin`;
}

function extensionFor(filename, contentType = "") {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/image\/gif/i.test(contentType)) return "gif";
  if (/image\/jpeg/i.test(contentType)) return "jpg";
  if (/image\/png/i.test(contentType)) return "png";
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/powerpoint|presentationml/i.test(contentType)) return "pptx";
  if (/excel|spreadsheetml/i.test(contentType)) return "xlsx";
  return "bin";
}

function validateSignature(type, buffer) {
  const pk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const pdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const jpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const gif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  if (type === "pdf" && !pdf) throw new Error("downloaded file is not a PDF");
  if (type === "docx" && !pk && !ole) throw new Error("downloaded docx is not an OOXML or legacy Word package");
  if (["pptx", "xlsx"].includes(type) && !pk) throw new Error(`downloaded ${type} is not an OOXML package`);
  if (["doc", "ppt", "xls"].includes(type) && !ole) throw new Error(`downloaded ${type} is not a legacy Office file`);
  if (type === "png" && !png) throw new Error("downloaded file is not PNG");
  if (["jpg", "jpeg"].includes(type) && !jpg) throw new Error("downloaded file is not JPEG");
  if (type === "gif" && !gif) throw new Error("downloaded file is not GIF");
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  header() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  store(headers) {
    const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const cookie of setCookies) {
      const match = /^([^=]+)=([^;]*)/.exec(cookie || "");
      if (match) this.cookies.set(match[1], match[2]);
    }
  }
}

const jar = new CookieJar();

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

function parseHiddenToken(html) {
  return /name=["']logintoken["']\s+value=["']([^"']+)/i.exec(html)?.[1] || "";
}

function isLoginPageContent(html) {
  return /name=["']password["']|logintoken|Moodle: Log in to the site|Forgotten your username or password/i.test(String(html || ""));
}

async function login() {
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing STMARY_MOODLE_USERNAME/STMARY_MOODLE_PASSWORD or MOODLE_USERNAME/MOODLE_PASSWORD.");
  let response = await request(`${baseUrl}/login/index.php`);
  const loginHtml = await response.text();
  response = await request(`${baseUrl}/login/index.php`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: parseHiddenToken(loginHtml) }),
  });
  const html = await response.text();
  if (isLoginPageContent(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St.Mary Moodle login failed.");
}

function absoluteUrl(url, contextUrl) {
  return new URL(String(url || "").replaceAll("&amp;", "&"), contextUrl).toString();
}

function collectPluginfileLinks(html, contextUrl, filter = () => true) {
  const links = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>|<(img)\b([^>]*)>/gi)) {
    const attrs = match[1] || match[4] || "";
    const raw = /\b(?:href|src)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!raw || !/pluginfile\.php/i.test(raw)) continue;
    const href = absoluteUrl(raw, contextUrl);
    if (!filter(href) || seen.has(href)) continue;
    seen.add(href);
    links.push({ href, label: stripTags(match[2] || "") || filenameFromUrl(href) });
  }
  return links;
}

async function downloadLocalized(link, relDir) {
  const response = await request(link.href);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${link.href}`);
  const contentType = response.headers.get("content-type") || "";
  const filename = filenameFromUrl(link.href);
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer);
  const filesRelDir = `${relDir}/files`;
  const filesAbsDir = join(courseRoot, filesRelDir);
  mkdirSync(filesAbsDir, { recursive: true });
  const localName = `${hashText(link.href)}-${filename}`;
  const absPath = join(filesAbsDir, localName);
  writeFileSync(absPath, buffer);
  const relPath = toPosix(join(filesRelDir, localName));
  return {
    label: link.label,
    type,
    category: "localized_moodle_attachment",
    role: "attachment",
    path: relPath,
    downloadPath: relPath,
    source: link.href,
    bytes: statSync(absPath).size,
  };
}

function renderAttachmentList(attachments, fromAbsDir) {
  if (!attachments.length) return "";
  return `<section class="files"><h2>Files</h2>${attachments.map((item) => {
    const rel = htmlEscape(toPosix(relative(fromAbsDir, join(courseRoot, item.path))), true);
    return `<div class="file-row"><div class="file-label">${htmlEscape(item.label)}</div><div class="actions"><a class="button" href="${rel}">View</a><a class="button" href="${rel}" download>Download</a></div></div>`;
  }).join("\n")}</section>`;
}

function shellHtml(title, bodyHtml, attachments, fromAbsDir) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    h3 { font-size: 18px; margin: 22px 0 10px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; max-width: 100%; }
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
    <h1>${htmlEscape(title)}</h1>
    <article class="content">${bodyHtml}</article>
    ${renderAttachmentList(attachments, fromAbsDir)}
  </main>
</body>
</html>
`;
}

function replacePluginfileRefs(html, attachmentBySource, pageRelDir) {
  let output = html;
  for (const item of attachmentBySource.values()) {
    const rel = toPosix(relative(join(courseRoot, pageRelDir), join(courseRoot, item.path)));
    output = output.replaceAll(item.source.replaceAll("&", "&amp;"), rel).replaceAll(item.source, rel);
  }
  return output;
}

function extractCourseId(html) {
  return (
    /\/course\/view\.php\?id=(\d+)/i.exec(html)?.[1] ||
    /data-courseid=["'](\d+)/i.exec(html)?.[1] ||
    ""
  );
}

function extractSection0(html) {
  const marker = html.search(/\bid=["']section-0["']/i);
  if (marker < 0) return "";
  const startCandidates = [
    html.lastIndexOf("<li", marker),
    html.lastIndexOf("<section", marker),
    html.lastIndexOf("<div", marker),
  ].filter((value) => value >= 0);
  const start = startCandidates.length ? Math.max(...startCandidates) : marker;
  const rest = html.slice(marker + 1);
  const next = rest.search(/\bid=["']section-1["']/i);
  const end = next >= 0 ? marker + 1 + next : html.indexOf("</main>", marker);
  return trimSection0Introduction(html.slice(start, end > start ? end : undefined));
}

function trimSection0Introduction(sectionHtml) {
  const summaryMatch = String(sectionHtml || "").match(/<div class=["']summary["'][^>]*>([\s\S]*?)<\/div>\s*<ul\b/i);
  let body = summaryMatch ? summaryMatch[1] : sectionHtml;
  body = body
    .replace(/<span class=["']hidden sectionname["'][\s\S]*?<\/span>/gi, "")
    .replace(/<div class=["'](?:left|right) side["'][\s\S]*?<\/div>/gi, "")
    .replace(/<ul class=["']section[\s\S]*$/i, "")
    .replace(/<li\b[^>]*\bdata-section=["'][^"']+["'][\s\S]*$/i, "")
    .replace(/<p[^>]*>\s*(?:<strong><\/strong>)?\s*(?:<span[^>]*><\/span>)?\s*<\/p>/gi, "")
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "<br>")
    .trim();
  return body;
}

function upsertBySource(items, resource) {
  const index = items.findIndex((item) => item.source === resource.source || item.path === resource.path || String(item.moodleActivityId || "") === String(resource.moodleActivityId || ""));
  if (index >= 0) items[index] = { ...items[index], ...resource };
  else items.push(resource);
}

await login();

const teacherResponse = await request(teacherActivityUrl);
const teacherHtml = await teacherResponse.text();
if (!teacherResponse.ok) throw new Error(`HTTP ${teacherResponse.status}: ${teacherActivityUrl}`);
if (isLoginPageContent(teacherHtml)) throw new Error(`Moodle login page returned for ${teacherActivityUrl}`);

mkdirSync(teacherAbsDir, { recursive: true });
const teacherLinks = collectPluginfileLinks(teacherHtml, teacherActivityUrl, (href) => /\/mod_assign\/introattachment\//i.test(href));
if (!teacherLinks.length) throw new Error("No BBB4M Teacher Packet attachments found on activity 8012.");
const teacherAttachments = [];
for (const link of teacherLinks) {
  const item = await downloadLocalized(link, teacherRelDir);
  item.role = "teacher_packet_attachment";
  teacherAttachments.push(item);
}
const teacherTitle = "BBB4M Teacher Packet - Answer Keys";
const teacherIndexPath = join(teacherAbsDir, "index.html");
writeFileSync(
  teacherIndexPath,
  shellHtml(
    teacherTitle,
    `<p>Teacher Packet answer-key materials localized from the St.Mary Moodle BBB4M activity provided as supplemental source.</p>`,
    teacherAttachments,
    teacherAbsDir,
  ),
  "utf8",
);

const courseId = extractCourseId(teacherHtml);
if (!courseId) throw new Error("Could not infer St.Mary BBB4M course id from Teacher Packet page.");
const courseUrl = `${baseUrl}/course/view.php?id=${courseId}`;
const courseResponse = await request(courseUrl);
const courseHtml = await courseResponse.text();
if (!courseResponse.ok) throw new Error(`HTTP ${courseResponse.status}: ${courseUrl}`);
if (isLoginPageContent(courseHtml)) throw new Error(`Moodle login page returned for ${courseUrl}`);

const rawSection0 = extractSection0(courseHtml);
if (!rawSection0) throw new Error(`Could not find section-0 on ${courseUrl}`);
mkdirSync(section0AbsDir, { recursive: true });
const section0Links = collectPluginfileLinks(rawSection0, courseUrl);
const section0Attachments = [];
const section0BySource = new Map();
for (const link of section0Links) {
  const item = await downloadLocalized(link, section0RelDir);
  section0Attachments.push(item);
  section0BySource.set(item.source, item);
}
const localizedSection0Body = replacePluginfileRefs(rawSection0, section0BySource, section0RelDir);
const section0IndexPath = join(section0AbsDir, "index.html");
writeFileSync(section0IndexPath, shellHtml("Course Introduction", localizedSection0Body, section0Attachments, section0AbsDir), "utf8");

const manifest = readJson(manifestPath);
manifest.teacherResources ||= [];
upsertBySource(manifest.teacherResources, {
  label: "Answer Keys",
  type: "html",
  category: "moodle_assign",
  role: "teacher_packet",
  path: toPosix(join(teacherRelDir, "index.html")),
  source: teacherActivityUrl,
  attachments: teacherAttachments,
  textPreview: "Teacher Packet answer-key materials localized from the St.Mary Moodle BBB4M activity.",
  moodleActivityId: String(teacherActivityId),
  parentSection: "Teacher Packet",
  sourceGroup: "teacher_packet",
  teacherOnly: true,
  teacherUse: "answer_key_reference",
  bytes: statSync(teacherIndexPath).size,
});

manifest.courseSections ||= [];
upsertBySource(manifest.courseSections, {
  label: "Course Introduction",
  type: "html",
  category: "moodle_course_section",
  role: "introduction",
  path: toPosix(join(section0RelDir, "index.html")),
  source: courseUrl,
  sectionNumber: 0,
  attachments: section0Attachments,
  textPreview: stripTags(localizedSection0Body).slice(0, 500),
  parentSection: "Course Introduction",
  sourceGroup: "course_section_0",
  bytes: statSync(section0IndexPath).size,
});
manifest.courseSections.sort((a, b) => {
  const order = (item) => item.role === "introduction" ? 0 : item.role === "course_overview" ? 1 : item.role?.includes("final") || item.role?.includes("culminating") ? 9 : 5;
  return order(a) - order(b);
});

manifest.sourceAudit ||= {};
manifest.sourceAudit.teacherPacketSupplement = {
  patchedAt: new Date().toISOString(),
  source: teacherActivityUrl,
  reason: "Legacy esunnybrook BBB4M did not expose a usable Teacher Packet; the user provided the matching St.Mary Moodle Answer Keys activity as supplemental source.",
  parentSection: "Teacher Packet",
  moodleActivityId: String(teacherActivityId),
  attachmentCount: teacherAttachments.length,
  attachments: teacherAttachments.map((item) => ({ label: item.label, path: item.path, bytes: item.bytes })),
};
manifest.sourceAudit.section0Supplement = {
  patchedAt: new Date().toISOString(),
  source: courseUrl,
  reason: "User requested St.Mary/New Moodle section 0 be added as supplemental Course Introduction for BBB4M.",
  attachmentCount: section0Attachments.length,
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  stMaryCourseId: courseId,
  teacherResources: manifest.teacherResources.length,
  teacherPacket: { path: toPosix(join(teacherRelDir, "index.html")), attachments: teacherAttachments.length },
  section0: { path: toPosix(join(section0RelDir, "index.html")), attachments: section0Attachments.length, bytes: statSync(section0IndexPath).size },
}, null, 2));
