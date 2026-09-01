import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ENG3U");
const manifestPath = join(courseRoot, "course-manifest.json");
const rawPath = join(courseRoot, "moodle-course-sections-raw", "answer-keys-9356.html");
const activityUrl = "https://www.esunnybrook.com/mod/assign/view.php?id=9356";
const activityRel = "localized-moodle-activities/assign/course-9356-a658c0c5e9";
const filesRel = `${activityRel}/files`;

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

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "resource";
}

function filenameFromUrl(url) {
  const parsed = new URL(url);
  return decodeURIComponent(basename(parsed.pathname));
}

function filenameFromHeaders(url, headers) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  return decodeURIComponent(utfName || plainName || filenameFromUrl(url));
}

function validateWordBuffer(buffer, context) {
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "docx";
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return "docx";
  {
    const probe = buffer.subarray(0, Math.min(buffer.length, 160)).toString("utf8").replace(/\s+/g, " ");
    throw new Error(`downloaded answer key is not a Word package: ${context}; probe=${probe}`);
  }
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
  headers.set("user-agent", "eng3u-answer-key-resource-patch/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const page = await request(loginUrl);
  const html = await page.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(html)?.[1] || "";
  const body = new URLSearchParams({
    username: process.env.MOODLE_USERNAME || "",
    password: process.env.MOODLE_PASSWORD || "",
    anchor: "",
    logintoken: token,
  });
  await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function answerKeyUrls(html) {
  return [...String(html || "").matchAll(/\b(?:href|src)=["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi)]
    .map((match) => new URL(match[1].replaceAll("&amp;", "&"), activityUrl).toString())
    .filter((url) => /\/mod_assign\/introattachment\//i.test(url) && /\.docx(?:[?#]|$)/i.test(url));
}

async function downloadAnswerKey(url) {
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const type = validateWordBuffer(buffer, `${response.status} ${response.headers.get("content-type") || ""} ${response.url || url}`);
  const label = filenameFromHeaders(response.url || url, response.headers);
  const rel = toPosix(join(filesRel, `${hashText(url)}-${sanitizeSegment(label)}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
  return {
    label,
    type,
    category: "answer_key",
    role: "answer_key_file",
    path: rel,
    bytes: buffer.length,
    source: url,
  };
}

function answerKeysHtml(attachments) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Answer Keys</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 900px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    ul { display: grid; gap: 10px; list-style: none; margin: 0; padding: 0; }
    li { border: 1px solid #e1e9f2; border-radius: 6px; padding: 10px 12px; background: #fbfdff; }
    a { color: #00396f; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>Answer Keys</h1>
      <ul>
        ${attachments.map((item) => `<li><a href="files/${htmlEscape(basename(item.path), true)}" download>${htmlEscape(item.label)}</a></li>`).join("\n        ")}
      </ul>
    </article>
  </main>
</body>
</html>
`;
}

await loginIfNeeded();

let rawHtml = existsSync(rawPath) ? readFileSync(rawPath, "utf8") : "";
let urls = answerKeyUrls(rawHtml);
if (!urls.length) {
  const response = await request(activityUrl);
  rawHtml = await response.text();
  mkdirSync(dirname(rawPath), { recursive: true });
  writeFileSync(rawPath, rawHtml, "utf8");
  urls = answerKeyUrls(rawHtml);
}
if (!urls.length) throw new Error("No Answer Keys DOCX links found.");

const attachments = [];
for (const url of urls) {
  attachments.push(await downloadAnswerKey(url));
}

const indexPath = join(courseRoot, activityRel, "index.html");
mkdirSync(dirname(indexPath), { recursive: true });
writeFileSync(indexPath, answerKeysHtml(attachments), "utf8");

const manifest = readJson(manifestPath);
function patchList(list) {
  for (const item of list || []) {
    if (item.moodleActivityId === "9356" || item.role === "answer_keys" || item.label === "Answer Keys") {
      item.label = "Answer Keys";
      item.type = "html";
      item.category = "moodle_assign";
      item.role = "answer_keys";
      item.path = `${activityRel}/index.html`;
      item.bytes = statSync(indexPath).size;
      item.source = activityUrl;
      item.teacherUse = "answer_key_reference";
      item.attachments = attachments;
    }
  }
}
patchList(manifest.courseDownloads);
patchList(manifest.teacherResources);
for (const unit of manifest.units || []) {
  for (const value of Object.values(unit.unitResources || {})) {
    if (Array.isArray(value)) patchList(value);
  }
}
manifest.sourceAudit ||= {};
manifest.sourceAudit.eng3uAnswerKeysPatch = {
  patchedAt: new Date().toISOString(),
  activityId: "9356",
  attachmentCount: attachments.length,
  attachments: attachments.map((item) => item.label),
};
writeJson(manifestPath, manifest);

console.log(JSON.stringify(manifest.sourceAudit.eng3uAnswerKeysPatch, null, 2));
