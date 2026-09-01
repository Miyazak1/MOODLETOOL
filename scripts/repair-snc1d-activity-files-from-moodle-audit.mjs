import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SNC1D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const auditPath = resolve(projectRoot, "deployment", "snc1d-moodle-activity-file-audit-20260812.json");
const baseUrl = "http://34.30.231.58";

loadEnv(join(projectRoot, ".env"));

const targetIds = new Set(["11085", "11094", "11454"]);
const emptyDropboxes = new Set(["11449", "11452"]);
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
  const headers = { "user-agent": "ossd-course-portal-snc1d-repair/1.0", ...(options.headers || {}) };
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
  const loginHtml = await (await request(loginUrl)).text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing Moodle credentials in env.");
  const html = await (await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  })).text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("Moodle login failed.");
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

function safeFileName(value) {
  return String(value || "file").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim() || "file";
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function href(fromRel, toRel) {
  return toPosix(posix.relative(posix.dirname(toPosix(fromRel)), toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function extType(fileName) {
  const ext = extname(fileName).replace(/^\./, "").toLowerCase();
  return ext || "file";
}

function pageHtml(title, introText, pageRel, attachments) {
  const paragraphs = stripTags(introText)
    ? `<p>${htmlEscape(stripTags(introText))}</p>`
    : `<p class="muted">Moodle lists this activity as a submission dropbox with no description or attached files.</p>`;
  const files = attachments.length
    ? `<section class="files"><h2>Files</h2>${attachments.map((attachment) => {
        const view = href(pageRel, attachment.previewPath || attachment.path);
        const download = href(pageRel, attachment.downloadPath || attachment.path);
        return `<div class="file-row"><div class="file-label">${htmlEscape(attachment.label)}</div><div class="actions"><a class="button" href="${view}">View</a><a class="button" href="${download}" download>Download</a></div></div>`;
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
    <article class="content">${paragraphs}</article>
    ${files}
  </main>
</body>
</html>
`;
}

function collectManifestItems(manifest, id) {
  const items = [];
  function walk(value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (String(value.moodleActivityId || "") === id) items.push(value);
    Object.values(value).forEach(walk);
  }
  walk(manifest);
  return items;
}

async function downloadAttachment(url, targetRel, label) {
  const response = await request(url);
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const target = join(courseRoot, targetRel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return bytes.length;
}

await login();
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
const rowsById = new Map();
for (const row of audit.rows) {
  if (!targetIds.has(String(row.id)) && !emptyDropboxes.has(String(row.id))) continue;
  if (!rowsById.has(String(row.id))) rowsById.set(String(row.id), row);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const downloaded = [];

for (const id of targetIds) {
  const row = rowsById.get(id);
  if (!row) continue;
  const items = collectManifestItems(manifest, id);
  if (!items.length) continue;
  const primary = items.find((item) => item.path) || items[0];
  const filesDirRel = `${posix.dirname(toPosix(primary.path))}/files`;
  const attachments = [];
  for (const file of row.moodleFiles) {
    const fileName = safeFileName(file.label || decodeURIComponent(new URL(file.url).pathname.split("/").pop() || "file"));
    const prefix = createHash("sha1").update(file.url).digest("hex").slice(0, 10);
    const targetRel = `${filesDirRel}/${prefix}-${fileName}`;
    const bytes = await downloadAttachment(file.url, targetRel, fileName);
    downloaded.push(targetRel);
    attachments.push({
      label: fileName,
      type: extType(fileName),
      category: "moodle_file",
      role: "attachment",
      path: targetRel,
      bytes,
      source: file.url,
      previewPath: targetRel,
      downloadPath: targetRel,
    });
  }
  for (const item of items) {
    item.attachments = attachments;
    item.textPreview = `${item.label} ${stripTags(row.moodleIntroPreview)}`.trim();
    if (item.path) {
      const html = pageHtml(item.label, row.moodleIntroPreview, item.path, attachments);
      writeFileSync(join(courseRoot, item.path), html, "utf8");
      item.bytes = Buffer.byteLength(html, "utf8");
    }
  }
}

for (const id of emptyDropboxes) {
  const row = rowsById.get(id);
  const items = collectManifestItems(manifest, id);
  for (const item of items) {
    item.attachments = [];
    item.textPreview = "";
    if (item.path) {
      const html = pageHtml(item.label, "", item.path, []);
      writeFileSync(join(courseRoot, item.path), html, "utf8");
      item.bytes = Buffer.byteLength(html, "utf8");
    }
  }
}

const wrongLearningLog = join(courseRoot, "localized-moodle-activities/assign/assign-11085-Learning-Log/files/150c3b9f2a-Learning-Log-Form.pdf");
if (existsSync(wrongLearningLog)) unlinkSync(wrongLearningLog);

manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ downloaded, patchedIds: [...targetIds, ...emptyDropboxes] }, null, 2));
