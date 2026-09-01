import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const workspaceRoot = resolve("D:/工作文件/SUNNYBROOK");
const projectRoot = join(workspaceRoot, "ossd-course-portal");
const courseRoot = join(workspaceRoot, "courseware", "CGC1D");
const targetActivityRel = "localized-moodle-activities/assign/assign-11762-Learning-Log";
const targetActivityRoot = join(courseRoot, targetActivityRel);
const targetFilesRel = `${targetActivityRel}/files`;
const manifestPath = join(courseRoot, "course-manifest.json");
const baseUrl = "http://34.30.231.58";

loadEnv(join(projectRoot, ".env"));

const files = [
  {
    url: `${baseUrl}/pluginfile.php/13288/mod_assign/introattachment/0/Learning%20Log-Sample%20v1.0.pdf?forcedownload=1`,
    targetName: "13288-Learning Log-Sample v1.0.pdf",
    label: "Learning Log-Sample v1.0.pdf",
    type: "pdf",
    signature: "%PDF",
  },
  {
    url: `${baseUrl}/pluginfile.php/13288/mod_assign/introattachment/0/Learning%20Log.docx?forcedownload=1`,
    targetName: "13288-Learning Log.docx",
    label: "Learning Log.docx",
    type: "docx",
    signature: "PK",
  },
];

const stalePaths = [
  `${targetFilesRel}/7fbbdce53c-Learning Log-Sample v1.0.pdf`,
  `${targetFilesRel}/bcfd51200a-Learning Log.docx`,
  `previews-html/${targetFilesRel}/bcfd51200a-Learning Log.docx.html`,
];

const sourceAttachmentNotes = [
  {
    label: "Learning Log-Sample v1.0.pdf",
    source: `${baseUrl}/pluginfile.php/13288/mod_assign/introattachment/0/Learning%20Log-Sample%20v1.0.pdf?forcedownload=1`,
    note: "Retained because it is explicitly attached to the CGC1D Moodle activity. The filled sample PDF itself says Course Code: MHF4U.",
  },
];

const jar = new Map();

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function storeCookies(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    for (const text of String(value).split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = text.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

function cookieHeader() {
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(url, options = {}, redirects = 0) {
  const headers = { ...(options.headers || {}) };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function login() {
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing Moodle credentials in .env");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("Moodle login failed");
}

async function downloadFile(file) {
  const response = await request(file.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${file.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.slice(0, file.signature.length).toString("latin1") !== file.signature) {
    throw new Error(`Unexpected file signature for ${file.label}; Moodle may have returned HTML instead of the file.`);
  }
  const rel = `${targetFilesRel}/${file.targetName}`;
  const target = join(courseRoot, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return {
    label: file.label,
    type: file.type,
    category: "moodle_file",
    role: "attachment",
    path: rel,
    bytes: statSync(target).size,
    source: file.url,
    previewPath: file.type === "pdf" ? rel : `previews-html/${rel}.html`,
    downloadPath: rel,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function href(fromRel, toRel) {
  return relative(dirname(fromRel), toRel).replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
}

function renderFilesSection(attachments, pageRel) {
  const rows = attachments.map((item) => {
    const viewTarget = item.previewPath || item.path;
    const viewHref = htmlEscape(href(pageRel, viewTarget));
    const downloadHref = htmlEscape(href(pageRel, item.downloadPath || item.path));
    return `<div class="file-row"><div class="file-label">${htmlEscape(item.label)}</div><div class="actions"><a class="button" href="${viewHref}">View</a><a class="button" href="${downloadHref}" download>Download</a></div></div>`;
  }).join("");
  return `<section class="files"><h2>Files</h2>${rows}</section>`;
}

mkdirSync(join(targetActivityRoot, "files"), { recursive: true });

for (const rel of stalePaths) {
  const target = join(courseRoot, rel);
  if (existsSync(target)) rmSync(target, { force: true });
}

await login();
const attachments = [];
for (const file of files) attachments.push(await downloadFile(file));

const pageRel = `${targetActivityRel}/index.html`;
const pagePath = join(courseRoot, pageRel);
let html = readFileSync(pagePath, "utf8");
const filesSection = renderFilesSection(attachments, pageRel);
if (/<section class="files">[\s\S]*?<\/section>/i.test(html)) {
  html = html.replace(/<section class="files">[\s\S]*?<\/section>/i, filesSection);
} else {
  html = html.replace(/\s*<\/main>/, `\n    ${filesSection}\n  </main>`);
}
writeFileSync(pagePath, html, "utf8");

const manifest = readJson(manifestPath);
const record = (manifest.courseDownloads || []).find((item) => item.moodleActivityId === "11762");
if (!record) throw new Error("Missing Learning Log courseDownloads record");
record.attachments = attachments;
record.bytes = statSync(pagePath).size;
record.previewPath = pageRel;

manifest.sourceAudit ||= {};
manifest.sourceAudit.learningLogAttachmentRepair = {
  repairedAt: new Date().toISOString(),
  moodleActivityId: "11762",
  activityPath: pageRel,
  attachments: attachments.map((item) => ({ label: item.label, path: item.path, source: item.source })),
  sourceAttachmentNotes,
  note: "Downloaded both Learning Log attachments from the CGC1D St. Mary Moodle activity 11762, context 13288. The sample PDF is retained because Moodle attaches it to CGC1D, while sourceAttachmentNotes records that the filled sample body names MHF4U.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({
  course: "CGC1D",
  activity: "Learning Log",
  attachments: attachments.map((item) => ({ label: item.label, path: item.path, bytes: item.bytes, source: item.source })),
  pageBytes: record.bytes,
}, null, 2));
