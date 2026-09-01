import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "MDM4U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "");
const activityId = 9812;
const activityUrl = `${baseUrl}/mod/assign/view.php?id=${activityId}`;
const targetRelDir = "localized-moodle-activities/assign/assign-9812-answer-keys";
const targetAbsDir = join(courseRoot, targetRelDir);
const filesRelDir = `${targetRelDir}/files`;
const filesAbsDir = join(courseRoot, filesRelDir);

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
  return "bin";
}

function validateSignature(type, buffer) {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (type === "pdf" && !startsWithPdf) throw new Error("downloaded file is not a PDF");
  if (type === "docx" && !startsWithPk && !startsWithOle) throw new Error("downloaded docx is not an OOXML or legacy Word package");
  if (["pptx", "xlsx"].includes(type) && !startsWithPk) throw new Error(`downloaded ${type} is not an OOXML package`);
  if (["doc", "ppt", "xls"].includes(type) && !startsWithOle) throw new Error(`downloaded ${type} is not a legacy Office file`);
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

function collectAttachmentLinks(html) {
  const links = [];
  const seen = new Set();
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] || "";
    const rawHref = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.replaceAll("&amp;", "&");
    if (!rawHref || !/pluginfile\.php/i.test(rawHref)) continue;
    const href = new URL(rawHref, activityUrl).toString();
    if (!/\/mod_assign\/introattachment\//i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ href, label: stripTags(match[2]) || filenameFromUrl(href) });
  }
  return links;
}

async function downloadAttachment(link) {
  const response = await request(link.href);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${link.href}`);
  const contentType = response.headers.get("content-type") || "";
  const filename = filenameFromUrl(link.href);
  const type = extensionFor(filename, contentType);
  validateSignature(type, buffer);
  const localName = `${hashText(link.href)}-${filename}`;
  const absPath = join(filesAbsDir, localName);
  writeFileSync(absPath, buffer);
  const relPath = toPosix(join(filesRelDir, localName));
  return {
    label: link.label,
    type,
    category: "localized_moodle_attachment",
    role: "teacher_packet_attachment",
    path: relPath,
    downloadPath: relPath,
    source: link.href,
    bytes: statSync(absPath).size,
  };
}

function pageHtml(title, attachments) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { color: #10233f; font-family: Arial, sans-serif; line-height: 1.55; margin: 0 auto; max-width: 960px; padding: 28px; }
    h1 { color: #00396f; font-size: 28px; margin: 0 0 12px; }
    .source { background: #f6f9fd; border: 1px solid #d9e6f5; border-radius: 8px; margin: 0 0 18px; padding: 12px 14px; }
    ul { display: grid; gap: 8px; list-style: none; margin: 0; padding: 0; }
    li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; justify-content: space-between; padding: 10px 12px; }
    .file-label { overflow-wrap: anywhere; }
    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }
    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }
    .file-action:hover { background: #eef6ff; }
  </style>
</head>
<body>
  <article>
    <h1>${htmlEscape(title)}</h1>
    <p class="source">Teacher Packet answer-key materials localized from the St.Mary Moodle MDM4U Answer Keys activity because the legacy esunnybrook MDM4U source did not expose a usable Teacher Packet.</p>
    <ul>
      ${attachments.map((item) => `<li><span class="file-label">${htmlEscape(item.label)}</span><span class="file-actions"><a class="file-action" href="${htmlEscape(toPosix(relative(targetAbsDir, join(courseRoot, item.path))), true)}">查看</a><a class="file-action" href="${htmlEscape(toPosix(relative(targetAbsDir, join(courseRoot, item.downloadPath || item.path))), true)}" download>下载</a></span></li>`).join("\n      ")}
    </ul>
  </article>
</body>
</html>
`;
}

function upsertTeacherResource(manifest, resource) {
  manifest.teacherResources ||= [];
  const key = String(resource.source || resource.path || resource.label);
  const index = manifest.teacherResources.findIndex((item) => String(item.source || item.path || item.label) === key || String(item.moodleActivityId || "") === String(resource.moodleActivityId));
  if (index >= 0) manifest.teacherResources[index] = { ...manifest.teacherResources[index], ...resource };
  else manifest.teacherResources.push(resource);
}

await login();
mkdirSync(filesAbsDir, { recursive: true });

const response = await request(activityUrl);
const html = await response.text();
if (!response.ok) throw new Error(`HTTP ${response.status}: ${activityUrl}`);
if (isLoginPageContent(html)) throw new Error(`Moodle login page returned for ${activityUrl}`);

const links = collectAttachmentLinks(html);
if (!links.length) throw new Error("No Teacher Packet attachments found.");
const attachments = [];
for (const link of links) attachments.push(await downloadAttachment(link));

mkdirSync(targetAbsDir, { recursive: true });
const title = "MDM4U Teacher Packet - Answer Keys";
const indexPath = join(targetAbsDir, "index.html");
writeFileSync(indexPath, pageHtml(title, attachments), "utf8");

const manifest = readJson(manifestPath);
const resource = {
  label: "Answer Keys",
  type: "html",
  category: "moodle_assign",
  role: "teacher_packet",
  path: toPosix(join(targetRelDir, "index.html")),
  source: activityUrl,
  attachments,
  textPreview: "Teacher Packet answer-key materials localized from the St.Mary Moodle MDM4U Answer Keys activity.",
  moodleActivityId: String(activityId),
  parentSection: "Teacher Packet",
  sourceGroup: "teacher_packet",
  teacherOnly: true,
  teacherUse: "answer_key_reference",
  bytes: statSync(indexPath).size,
};
upsertTeacherResource(manifest, resource);

manifest.sourceAudit ||= {};
manifest.sourceAudit.teacherPacketSupplement = {
  patchedAt: new Date().toISOString(),
  source: activityUrl,
  reason: "Legacy esunnybrook MDM4U did not expose a usable Teacher Packet; the user provided the matching St.Mary Moodle Answer Keys activity as supplemental source.",
  parentSection: "Teacher Packet",
  moodleActivityId: String(activityId),
  attachmentCount: attachments.length,
  attachments: attachments.map((item) => ({ label: item.label, path: item.path, bytes: item.bytes })),
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course,
  teacherResources: manifest.teacherResources.length,
  patched: { label: resource.label, path: resource.path, attachments: attachments.length, bytes: resource.bytes },
}, null, 2));
