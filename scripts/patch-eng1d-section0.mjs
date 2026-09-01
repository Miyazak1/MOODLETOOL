import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(repoRoot, "..");
const course = "ENG1D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const sectionPath = join(repoRoot, "inbox", "eng1d-stmary-sections", "section-00.json");
const baseUrl = "http://34.30.231.58";

loadEnv();

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  store(headers) {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      for (const text of String(value).split(/,(?=\s*[^;,]+=)/g)) {
        const pair = text.split(";")[0];
        const index = pair.indexOf("=");
        if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
  }

  header() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar();

function loadEnv() {
  const envPath = resolve(repoRoot, ".env");
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

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function sha10(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"');
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "resource";
}

function fileNameFromUrl(url) {
  const parsed = new URL(url, baseUrl);
  return sanitizeSegment(decodeURIComponent(parsed.pathname.split("/").pop() || "resource"));
}

function typeFromPath(path) {
  const ext = extname(String(path || "")).replace(".", "").toLowerCase();
  return ext === "jpeg" ? "jpg" : ext || "html";
}

function relativeHref(fromRelPath, toRelPath) {
  return toPosix(relative(dirname(join(courseRoot, fromRelPath)), join(courseRoot, toRelPath)))
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
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
  const html = String(sectionHtml || "");
  const summary = /<div\b[^>]*class=["'][^"']*\bsummary\b[^"']*["'][^>]*>/i.exec(html);
  if (!summary) return html;
  return extractBalancedElement(html, summary.index || 0, "div") || summary[0];
}

function textPreview(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

async function fetchBytes(url) {
  const response = await request(url, {
    headers: {
      referer: `${baseUrl}/course/view.php?id=74`,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (bytes.subarray(0, 4).toString("latin1") !== "GIF8" || /text\/html/i.test(contentType)) {
    throw new Error(`invalid GIF download type=${contentType} bytes=${bytes.length}`);
  }
  return bytes;
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-eng1d-section0-patch/1.1");
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
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing STMARY_MOODLE_USERNAME/STMARY_MOODLE_PASSWORD in .env");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St. Mary Moodle login failed.");
}

async function localizeSummaryAssets(html, pageRel) {
  const attachments = [];
  let body = String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<ul[^>]*class=["'][^"']*\bsection\b[^"']*\bimg-text\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, "");

  const attrUrls = [...body.matchAll(/\s(?:src|href|poster)=["']([^"']+)["']/gi)].map((match) => decodeEntities(match[1]));
  for (const rawUrl of attrUrls) {
    const absolute = new URL(rawUrl, baseUrl).toString();
    if (new URL(absolute).host !== new URL(baseUrl).host || !/\/pluginfile\.php\//i.test(absolute)) continue;
    const fileName = fileNameFromUrl(absolute);
    const rel = toPosix(join("course-sections", "course-starter-resources", "files", `${sha10(absolute)}-${fileName}`));
    const abs = join(courseRoot, rel);
    ensureDir(dirname(abs));
    if (!existsSync(abs)) writeFileSync(abs, await fetchBytes(absolute));
    const bytes = readFileSync(abs);
    const item = {
      label: fileName,
      type: typeFromPath(fileName),
      category: "moodle_file",
      role: "attachment",
      path: rel,
      bytes: bytes.length,
      source: absolute,
      downloadPath: rel,
    };
    if (["gif", "png", "jpg", "jpeg", "webp", "svg", "pdf"].includes(item.type)) item.previewPath = rel;
    attachments.push(item);
    body = body.replaceAll(rawUrl, relativeHref(pageRel, rel));
  }

  body = body.replace(/\s(?:href|src|poster)=["']([^"']+)["']/gi, (full, rawUrl) => {
    const decoded = decodeEntities(rawUrl);
    if (/^(?:https?:)?\/\//i.test(decoded) || decoded.startsWith("/") || decoded.startsWith("mod/") || decoded.startsWith("view.php")) return "";
    return full;
  });

  return { html: body.trim(), attachments };
}

function renderAttachmentRow(item, pageRel) {
  const viewPath = item.previewPath || item.path;
  const downloadPath = item.downloadPath || item.path;
  return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions"><a class="button" href="${escapeAttr(relativeHref(pageRel, viewPath))}">View</a><a class="button" href="${escapeAttr(relativeHref(pageRel, downloadPath))}" download>Download</a></div></div>`;
}

function renderPage(title, bodyHtml, attachments, pageRel) {
  const attachmentHtml = attachments.length
    ? `<section class="files"><h2>Files</h2>${attachments.map((item) => renderAttachmentRow(item, pageRel)).join("")}</section>`
    : "";
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
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content video { display: block; height: auto; margin: 16px auto; max-width: 100%; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
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

const section = JSON.parse(readFileSync(sectionPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const pageRel = "course-sections/course-starter-resources/index.html";
const title = "Course Introduction";
await login();
const localized = await localizeSummaryAssets(extractSectionSummaryFragment(section.fragment || ""), pageRel);
const pageHtml = renderPage(title, localized.html, localized.attachments, pageRel);
const pageAbs = join(courseRoot, pageRel);
ensureDir(dirname(pageAbs));
writeFileSync(pageAbs, pageHtml, "utf8");

const record = {
  label: title,
  type: "html",
  category: "course_document",
  role: "introduction",
  sourceGroup: "course_introduction",
  sourceSection: 0,
  sectionOrder: 0,
  path: pageRel,
  bytes: Buffer.byteLength(pageHtml, "utf8"),
  source: section.url,
  attachments: localized.attachments,
  textPreview: textPreview(localized.html),
};

manifest.courseSections = (manifest.courseSections || []).filter(
  (item) => !(Number(item.sourceSection) === 0 || item.path === pageRel || item.path === "course-sections/section-0/index.html" || item.role === "introduction"),
);
manifest.courseSections.unshift(record);
manifest.sourceAudit = manifest.sourceAudit || {};
manifest.sourceAudit.section0Localized = true;
manifest.sourceAudit.section0Displayed = true;
manifest.sourceAudit.section0PatchedAt = new Date().toISOString();
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ added: record.label, path: record.path, attachments: record.attachments.length, textPreview: record.textPreview }, null, 2));
