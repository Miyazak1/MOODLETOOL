import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { createHash } from "node:crypto";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BAT4M");
const manifestPath = join(courseRoot, "course-manifest.json");
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "");
const learningLogId = "10812";
const learningLogRel = "localized-moodle-activities/assign/assign-10812-Learning-Log/index.html";
const learningLogFilesRel = "localized-moodle-activities/assign/assign-10812-Learning-Log/files";
const rollRootRel = "ispring-localized/unit-00/course-overview";
const rollRoot = join(courseRoot, rollRootRel);

loadEnv(join(projectRoot, ".env"));
loadEnv(join(workspaceRoot, ".env"));

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
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
  const headers = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", ...(options.headers || {}) };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 5) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function login() {
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["']\s+value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing Moodle credentials in .env");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) {
    throw new Error("Moodle login failed");
  }
}

function extractLearningLogBody(html) {
  const candidates = [
    /<div[^>]+class=["'][^"']*activity-description[^"']*["'][^>]*>([\s\S]*?)<div[^>]+class=["'][^"']*activity-information/i,
    /<div[^>]+class=["'][^"']*activity-description[^"']*["'][^>]*>([\s\S]*?)<section[^>]+data-region=["']grade-panel/i,
    /<div[^>]+class=["'][^"']*activity-description[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]+class=["'][^"']*activity-information/i,
  ];
  for (const pattern of candidates) {
    const match = pattern.exec(html);
    if (match?.[1] && /learning log/i.test(stripTags(match[1]))) return cleanBody(match[1]);
  }
  const text = stripTags(html);
  const sentence = "After each unit, the student must submit a learning log to track the hours spent on assignments. The learning log is to provide learning accountability from the student and to help the student develop a good study routine. Attached you will find a sample learning log filled out.";
  if (text.includes(sentence.slice(0, 40))) return `<p>${escapeHtml(sentence)}</p>`;
  return `<p>After each unit, the student must submit a learning log to track the hours spent on assignments. The learning log is to provide learning accountability from the student and to help the student develop a good study routine. Attached you will find a sample learning log filled out.</p>`;
}

function cleanBody(html) {
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<a\b[^>]*href=["'][^"']*pluginfile\.php[^"']+["'][^>]*>[\s\S]*?<\/a>/gi, "")
    .replace(/<img\b[^>]*alt=["'][^"']+\.(?:pdf|docx?)["'][^>]*>/gi, "")
    .replace(/\s(?:class|id|style|onclick|data-[\w-]+)=["'][^"']*["']/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/<p\b|<div\b|<br\b/i.test(body)) body = `<p>${escapeHtml(stripTags(body))}</p>`;
  return body;
}

function extractPluginFiles(html) {
  const byUrl = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*pluginfile\.php[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = new URL(decodeEntities(match[1]), baseUrl).toString();
    const label = stripTags(match[2]) || decodeURIComponent(basename(new URL(url).pathname));
    if (/\.(pdf|docx?)($|\?)/i.test(url) && /Learning Log/i.test(label)) byUrl.set(url, { label, url });
  }
  return [...byUrl.values()];
}

function safeFileName(label) {
  return String(label || "file").replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-").trim();
}

function ext(label) {
  return String(label).split(".").pop()?.toLowerCase() || "file";
}

function previewPathFor(path) {
  const rel = `previews-html/${toPosix(path).replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._/\- ]+/g, "_")}.html`;
  return existsSync(join(courseRoot, rel)) ? rel : undefined;
}

async function downloadFile(file) {
  const response = await request(file.url);
  if (!response.ok) throw new Error(`${file.url} HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha1").update(file.url).digest("hex").slice(0, 10);
  const fileName = `${hash}-${safeFileName(file.label)}`;
  const rel = `${learningLogFilesRel}/${fileName}`;
  const target = join(courseRoot, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return {
    label: file.label,
    type: ext(file.label),
    category: "moodle_file",
    role: "attachment",
    path: rel,
    bytes: statSync(target).size,
    source: file.url,
    previewPath: ext(file.label) === "pdf" ? rel : previewPathFor(rel),
    downloadPath: rel,
  };
}

function href(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function fileRow(fromRel, resource) {
  const viewHref = href(fromRel, resource.previewPath || resource.path);
  const downloadHref = href(fromRel, resource.downloadPath || resource.path);
  return `<div class="file-row"><div class="file-label">${escapeHtml(resource.label)}</div><div class="actions"><a class="button" href="${viewHref}">View</a><a class="button" href="${downloadHref}" download>Download</a></div></div>`;
}

function writeActivityHtml(bodyHtml, attachments) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Learning Log</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f5f7fb; color: #102033; line-height: 1.6; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 20px 64px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; box-shadow: 0 14px 36px rgba(16, 32, 51, 0.06); }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; color: #002f5f; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #14395c; }
    p { margin: 0 0 14px; }
    a { color: #00396f; font-weight: 700; }
    .activity-body { overflow-wrap: anywhere; }
    .files { border-top: 1px solid #edf1f6; margin-top: 22px; padding-top: 14px; }
    .file-row { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; justify-content: space-between; margin: 8px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { background: #f4f9ff; border: 1px solid #8db0d7; border-radius: 6px; color: #00396f; display: inline-block; font-weight: 700; padding: 5px 10px; text-decoration: none; }
    @media (max-width: 640px) { article { padding: 20px; } .file-row { align-items: flex-start; flex-direction: column; } .actions { flex-wrap: wrap; } }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>Learning Log</h1>
      <div class="activity-body">${bodyHtml}</div>
      <section class="files"><h2>Files</h2>${attachments.map((item) => fileRow(learningLogRel, item)).join("")}</section>
    </article>
  </main>
</body>
</html>
`;
  writeFileSync(join(courseRoot, learningLogRel), html, "utf8");
  return Buffer.byteLength(html, "utf8");
}

function patchRollI18n() {
  const sourceLang = join(rollRoot, "lng", "en-US.c9165f.json");
  if (!existsSync(sourceLang)) throw new Error(`Missing roll language file: ${sourceLang}`);
  const compatLang = join(rollRoot, "lng", "en-US.1740f3.json");
  copyFileSync(sourceLang, compatLang);
  const patched = [];
  for (const rel of [`${rollRootRel}/presentation.html`, `${rollRootRel}/index.html`]) {
    const full = join(courseRoot, rel);
    if (!existsSync(full)) continue;
    let html = readFileSync(full, "utf8");
    const before = html;
    html = html.replace(/"en-US":"lng\/en-US\.[^"]+\.json"/, '"en-US":"lng/en-US.c9165f.json"');
    html = html.replace(/const i18nUrl = LNG_MANIFEST\[locale\];/, 'const i18nUrl = LNG_MANIFEST[locale] || "lng/en-US.c9165f.json";');
    if (html !== before) {
      writeFileSync(full, html, "utf8");
      patched.push(rel);
    }
  }
  return patched;
}

await login();
const activityUrl = `${baseUrl}/mod/assign/view.php?id=${learningLogId}`;
const response = await request(activityUrl);
const activityHtml = await response.text();
const files = extractPluginFiles(activityHtml);
if (files.length < 2) throw new Error(`Expected two Learning Log attachments, found ${files.length}`);
const attachments = [];
for (const file of files) attachments.push(await downloadFile(file));
const activityBytes = writeActivityHtml(extractLearningLogBody(activityHtml), attachments);
const patchedRoll = patchRollI18n();

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const learningLog = (manifest.courseDownloads || []).find((item) => item.role === "learning_log" && item.path === learningLogRel);
if (!learningLog) throw new Error("Missing Learning Log manifest item");
learningLog.attachments = attachments;
learningLog.bytes = activityBytes;
learningLog.source = activityUrl;
learningLog.previewPath = learningLogRel;

for (const section of manifest.courseSections || []) {
  if (section.role !== "course_overview") continue;
  for (const ispring of section.ispring || []) {
    if (ispring.path === `${rollRootRel}/presentation.html`) {
      ispring.bytes = statSync(join(courseRoot, ispring.path)).size;
      ispring.localizationStatus = "localized";
      ispring.failedAssets = [];
    }
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.bat4mLearningLogRepair = {
  source: activityUrl,
  attachments: attachments.map((item) => ({ label: item.label, path: item.path, source: item.source })),
};
manifest.sourceAudit.courseOverviewRollI18nPatch = {
  languageFile: `${rollRootRel}/lng/en-US.c9165f.json`,
  compatLanguageFile: `${rollRootRel}/lng/en-US.1740f3.json`,
  patchedRoll,
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ attachments, patchedRoll }, null, 2));
