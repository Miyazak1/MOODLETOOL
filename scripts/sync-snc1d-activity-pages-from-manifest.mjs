import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SNC1D";
const courseRoot = resolve(workspaceRoot, "courseware", course);
const manifestPath = resolve(courseRoot, "course-manifest.json");
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "").replace(/\/login\/index\.php$/i, "");
const idsToSync = new Set(["11085", "11094", "11454", "11449", "11452"]);
const emptyDropboxes = new Set(["11449", "11452"]);
const jar = new Map();

loadEnv(resolve(projectRoot, ".env"));

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
  const headers = { "user-agent": "ossd-course-portal-snc1d-page-sync/1.0", ...(options.headers || {}) };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
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
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractBalancedDiv(html, start) {
  const openEnd = html.indexOf(">", start);
  let depth = 1;
  const pattern = /<\/?div\b[^>]*>/gi;
  pattern.lastIndex = openEnd + 1;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(openEnd + 1, match.index);
  }
  return html.slice(openEnd + 1);
}

function extractIntro(html) {
  const match = /<div\b[^>]*\bid=["']intro["'][^>]*>/i.exec(html);
  return match ? stripTags(extractBalancedDiv(html, match.index)) : "";
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanIntroText(introText, attachments) {
  let text = stripTags(introText);
  for (const attachment of attachments) {
    if (!attachment.label) continue;
    text = text.replaceAll(attachment.label, " ");
  }
  return text
    .replace(/\b\d{1,2}\s+[A-Z][a-z]+\s+\d{4},\s+\d{1,2}:\d{2}\s+(?:AM|PM)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toPosix(path) {
  return String(path || "").replace(/\\/g, "/");
}

function href(fromRel, targetRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return encodeURI(posix.relative(fromDir, toPosix(targetRel))).replace(/#/g, "%23");
}

function collectManifestItems(value, id, items = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectManifestItems(item, id, items);
    return items;
  }
  if (!value || typeof value !== "object") return items;
  if (String(value.moodleActivityId || "") === id) items.push(value);
  for (const item of Object.values(value)) collectManifestItems(item, id, items);
  return items;
}

async function login() {
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing Moodle credentials in env.");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("Moodle login failed.");
}

function pageHtml(title, introText, pageRel, attachments) {
  const cleanedIntro = cleanIntroText(introText, attachments);
  const paragraphs = cleanedIntro
    ? `<article class="content"><p>${htmlEscape(cleanedIntro)}</p></article>`
    : emptyDropboxes.has(String(currentId))
      ? `<article class="content"><p class="muted">Moodle lists this activity as a submission dropbox with no description or attached files.</p></article>`
      : "";
  const files = attachments.length
    ? `<section class="files"><h2>Files</h2>${attachments.map((attachment) => {
        const viewTarget = attachment.previewPath || attachment.path;
        const downloadTarget = attachment.downloadPath || attachment.path;
        const type = String(attachment.type || "").toLowerCase();
        const needsPreview = ["doc", "docx", "ppt", "pptx", "xls", "xlsx"].includes(type);
        const showView = viewTarget && (!needsPreview || attachment.previewPath);
        return `<div class="file-row"><div class="file-label">${htmlEscape(attachment.label)}</div><div class="actions">${showView ? `<a class="button" href="${href(pageRel, viewTarget)}">View</a>` : ""}${downloadTarget ? `<a class="button" href="${href(pageRel, downloadTarget)}" download>Download</a>` : ""}</div></div>`;
      }).join("")}</section>`
    : "";
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
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .muted { color: #516276; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(title)}</h1>
    ${paragraphs}
    ${files}
  </main>
</body>
</html>
`;
}

let currentId = "";
await login();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const synced = [];
for (const id of idsToSync) {
  currentId = id;
  const response = await request(`${baseUrl}/mod/assign/view.php?id=${id}`);
  const html = await response.text();
  const intro = emptyDropboxes.has(id) ? "" : extractIntro(html);
  const items = collectManifestItems(manifest, id).filter((item) => item.path);
  const seenPaths = new Set();
  for (const item of items) {
    if (seenPaths.has(item.path)) continue;
    seenPaths.add(item.path);
    const outputPath = resolve(courseRoot, item.path);
    writeFileSync(outputPath, pageHtml(item.label, intro, item.path, item.attachments || []), "utf8");
    item.bytes = Buffer.byteLength(readFileSync(outputPath));
    synced.push(item.path);
  }
}
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ course, synced: synced.map((path) => relative(courseRoot, resolve(courseRoot, path)).replace(/\\/g, "/")) }, null, 2));
