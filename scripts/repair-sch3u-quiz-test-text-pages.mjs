import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SCH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

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
  headers.set("user-agent", "ossd-course-portal-sch3u-quiz-text-repair/1.0");
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

function parseHiddenToken(html) {
  return /name=["']logintoken["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] || "";
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: parseHiddenToken(loginHtml) }),
  });
  const text = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(text)) throw new Error("Moodle login failed.");
}

function activityIntro(html) {
  const direct = /<div\b[^>]*\bid=["']intro["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*\bclass=["'][^"']*\bbox[^"']*["']/i.exec(html)?.[1];
  if (direct) return direct;
  const start = html.search(/<div\b[^>]*\bid=["']intro["'][^>]*>/i);
  if (start < 0) return "";
  const openEnd = html.indexOf(">", start);
  let depth = 1;
  let cursor = openEnd + 1;
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = cursor;
  for (let match; (match = tagPattern.exec(html)); ) {
    if (match[0][1] === "/") depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(cursor, match.index);
  }
  return "";
}

function cleanBody(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/(?:www\.)?esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\sclass=["'][^"']*(?:editing|commands|availabilityinfo|completion|singlebutton|continuebutton|quizattempt|quizinfo|tertiary-navigation)[^"']*["']/gi, "")
    .replace(/\sstyle=["'][^"']*["']/gi, "")
    .replace(/\sdata-[a-z0-9_-]+=["'][^"']*["']/gi, "")
    .replace(/<button\b[\s\S]*?<\/button>/gi, "")
    .replace(/<input\b[^>]*>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function courseRelative(fromRel, toRel) {
  return toPosix(relative(dirname(join(courseRoot, fromRel)), join(courseRoot, toRel))) || ".";
}

function renderAttachments(indexRel, item) {
  const attachments = item.attachments || [];
  if (!attachments.length) return "";
  return `<section class="attachments">
          <h2>Files</h2>
          <ul>
          ${attachments
            .map((attachment) => {
              const href = courseRelative(indexRel, attachment.path);
              const previewHref = attachment.previewPath ? courseRelative(indexRel, attachment.previewPath) : href;
              return `<li>
            <span>${htmlEscape(attachment.label || attachment.path)}</span>
            <span class="actions">
              ${previewHref ? `<a class="button" href="${htmlEscape(previewHref, true)}">View</a>` : ""}
              <a class="button" href="${htmlEscape(href, true)}" download>Download</a>
            </span>
          </li>`;
            })
            .join("\n")}
          </ul>
        </section>`;
}

function pageHtml(title, body, attachmentsHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f5f7fb; color: #102033; line-height: 1.6; }
    main { max-width: 980px; margin: 0 auto; padding: 40px 20px 64px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; box-shadow: 0 14px 36px rgba(16, 32, 51, 0.06); }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; color: #002f5f; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #14395c; }
    p { margin: 0 0 14px; }
    table { border-collapse: collapse; margin: 16px 0; max-width: 100%; }
    td, th { border: 1px solid #d8e2ef; padding: 8px 10px; vertical-align: top; }
    a { color: #00396f; font-weight: 700; }
    .activity-body { overflow-wrap: anywhere; }
    .activity-body:empty { display: none; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 22px; padding-top: 14px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; gap: 12px; justify-content: space-between; padding: 10px 12px; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { background: #f4f9ff; border: 1px solid #8db0d7; border-radius: 6px; color: #00396f; display: inline-block; font-weight: 700; padding: 5px 10px; text-decoration: none; }
    @media (max-width: 640px) {
      article { padding: 20px; }
      .attachments li { align-items: flex-start; flex-direction: column; }
      .actions { flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <div class="activity-body">${body}</div>
        ${attachmentsHtml}
    </article>
  </main>
</body>
</html>
`;
}

function collectQuizTestItems(manifest) {
  const rows = [];
  const seen = new Set();
  for (const unit of manifest.units || []) {
    for (const item of unit.unitResources?.evaluations || []) {
      if (!/\/quiz\//i.test(item.path || "") || !/quiz|test/i.test(item.label || item.title || "")) continue;
      const key = item.path;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
    }
  }
  return rows;
}

function syncManifestItemPreviews(value, byPath) {
  if (Array.isArray(value)) {
    for (const item of value) syncManifestItemPreviews(item, byPath);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.path && byPath.has(value.path)) {
    const patch = byPath.get(value.path);
    value.textPreview = patch.textPreview;
    value.bytes = patch.bytes;
  }
  for (const child of Object.values(value)) syncManifestItemPreviews(child, byPath);
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
const patches = new Map();
const repaired = [];

for (const item of collectQuizTestItems(manifest)) {
  const response = await request(item.source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${item.source}`);
  const body = cleanBody(activityIntro(rawHtml));
  if (stripTags(body).length < 120) throw new Error(`Quiz/test intro is unexpectedly short: ${item.label}`);
  const indexRel = toPosix(item.path);
  const abs = join(courseRoot, indexRel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, pageHtml(item.label || item.title, body, renderAttachments(indexRel, item)), "utf8");
  const bytes = statSync(abs).size;
  const textPreview = stripTags(body).slice(0, 800);
  patches.set(indexRel, { bytes, textPreview });
  repaired.push({ label: item.label, path: indexRel, bytes, textPreviewLength: textPreview.length });
}

syncManifestItemPreviews(manifest, patches);
manifest.sourceAudit ||= {};
manifest.sourceAudit.sch3uQuizTestTextRepair = {
  patchedAt: new Date().toISOString(),
  repairedPages: repaired.length,
  note: "Restored Moodle quiz/test intro text into localized activity HTML pages; rubric attachments remain listed separately.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course, repaired }, null, 2));
