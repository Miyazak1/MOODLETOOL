import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SCH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const moodleBase = "https://www.esunnybrook.com";

const labIds = new Set(["8604", "8632", "8651", "8680", "8707"]);

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

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function labelFromMoodleUrl(value) {
  try {
    const parsed = new URL(String(value || "").replaceAll("&amp;", "&"));
    const filename = decodeURIComponent(parsed.pathname.split("/").pop() || "").trim();
    return filename || "localized Moodle resource";
  } catch {
    return "localized Moodle resource";
  }
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

function normalizeRelPath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function relativeFromPage(pageRel, targetRel) {
  return posix.relative(posix.dirname(normalizeRelPath(pageRel)), normalizeRelPath(targetRel)) || ".";
}

function withoutSearchAndHash(url) {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function normalizeMoodleUrl(raw, baseUrl) {
  const parsed = new URL(String(raw || "").replaceAll("&amp;", "&"), baseUrl);
  return parsed.toString();
}

function h5pNestedUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/\/h5p\/embed\.php$/i.test(parsed.pathname)) return "";
    const nested = parsed.searchParams.get("url");
    return nested ? new URL(nested, url).toString() : "";
  } catch {
    return "";
  }
}

function isDownloadableAttachment(attachment) {
  const type = String(attachment?.type || "").toLowerCase();
  const path = String(attachment?.path || "").toLowerCase();
  return !["mp4", "webm", "mov", "m4v"].includes(type) && !/\.(mp4|webm|mov|m4v)(?:$|[?#])/i.test(path);
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
  headers.set("user-agent", "ossd-course-portal-sch3u-lab-repair/1.0");
  if (new URL(url).hostname === "www.esunnybrook.com") {
    const cookie = jar.header();
    if (cookie) headers.set("cookie", cookie);
  }
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  if (new URL(url).hostname === "www.esunnybrook.com") jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

function parseHiddenToken(html) {
  return /name=["']logintoken["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] || "";
}

function isLoginPageContent(value) {
  return /Welcome to Sunnybrook|Enter your details to log in|Forgot your password|Moodle: Log in to the site|logintoken|用户名|密码/i.test(stripTags(value));
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = `${moodleBase}/login/index.php`;
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

function findTagEnd(html, start) {
  const end = html.indexOf(">", start);
  return end < 0 ? html.length : end + 1;
}

function extractBalancedDiv(html, start) {
  const openEnd = findTagEnd(html, start);
  let depth = 1;
  const pattern = /<\/?div\b[^>]*>/gi;
  pattern.lastIndex = openEnd;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(openEnd, match.index);
  }
  return html.slice(openEnd);
}

function extractMoodleIntro(html) {
  const introPatterns = [
    /<div\b[^>]*\bid=["']intro["'][^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*>/i,
    /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>/i,
    /<div\b[^>]*\bid=["']intro["'][^>]*>/i,
  ];
  for (const pattern of introPatterns) {
    const match = pattern.exec(html);
    if (match) return extractBalancedDiv(html, match.index);
  }
  return "";
}

function buildLocalByUrl(item) {
  const localByUrl = new Map();
  for (const attachment of item.attachments || []) {
    const targetPath = attachment.previewPath || attachment.path;
    const urls = [attachment.source, attachment.fileSource].filter(Boolean);
    for (const rawUrl of urls) {
      try {
        const url = normalizeMoodleUrl(rawUrl, moodleBase);
        localByUrl.set(url, { attachment, targetPath });
        localByUrl.set(withoutSearchAndHash(url), { attachment, targetPath });
        const nested = h5pNestedUrl(url);
        if (nested) {
          localByUrl.set(nested, { attachment, targetPath });
          localByUrl.set(withoutSearchAndHash(nested), { attachment, targetPath });
        }
      } catch {
        // Ignore malformed historic source entries.
      }
    }
  }
  return localByUrl;
}

function localizeBodyRefs(body, source, pageRel, item) {
  const localByUrl = buildLocalByUrl(item);
  return String(body || "").replace(/\b(href|src|poster)\s*=\s*["']([^"']+)["']/gi, (match, attr, rawValue) => {
    try {
      const url = normalizeMoodleUrl(rawValue, source);
      const nested = h5pNestedUrl(url);
      const local = localByUrl.get(url) || localByUrl.get(withoutSearchAndHash(url)) || (nested ? localByUrl.get(nested) || localByUrl.get(withoutSearchAndHash(nested)) : null);
      if (local?.targetPath) return `${attr}="${htmlEscape(relativeFromPage(pageRel, local.targetPath), true)}"`;
      const host = new URL(url).hostname.toLowerCase();
      if (host === "www.esunnybrook.com" || host.endsWith(".esunnybrook.com")) return `data-localized-link="${attr}-unavailable"`;
    } catch {
      // Keep ordinary relative links if they are not Moodle URLs.
    }
    return match;
  });
}

function cleanBody(body) {
  return String(body || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/<div\b[^>]*\bclass=["'][^"']*\bfileuploadsubmissiontime\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>[\s\S]*?<\/ul>\s*<\/div>/gi, "")
    .replace(/<div\b[^>]*\bid=["']assign_files_tree[^"']*["'][^>]*>\s*(?:<div>\s*<\/div>|\s|&nbsp;)*<\/div>/gi, "")
    .replace(/<a\b(?=[^>]*\bdata-localized-link=["'][^"']+["'])[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/(<a\b[^>]*>)(https?:\/\/(?:www\.)?esunnybrook\.com\/[^<]+)(<\/a>)/gi, (_match, open, url, close) => {
      return `${open}${htmlEscape(labelFromMoodleUrl(url))}${close}`;
    })
    .replace(/<img\b(?=[^>]*\bdata-localized-link=["'][^"']+["'])[^>]*>\s*/gi, "")
    .replace(/\sdata-localized-link=["'][^"']+["']/gi, "")
    .replace(/\sdata-localized-src=["'][^"']+["']/gi, "")
    .replace(/\s+yuiConfig='[^']*'/gi, "")
    .replace(/\s+id=["']yui_[^"']*["']/gi, "")
    .replace(/\s(?:cellspacing|cellpadding|border)=["'][^"']*["']/gi, "")
    .replace(/<p\b[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*<\/p>/gi, "")
    .replace(/(?:<br\b[^>]*>\s*){3,}/gi, "<br><br>")
    .trim();
}

function renderAttachments(pageRel, item) {
  const rows = (item.attachments || [])
    .filter((attachment) => attachment?.path)
    .map((attachment) => {
      const originalHref = relativeFromPage(pageRel, attachment.path);
      const viewHref = attachment.previewPath ? relativeFromPage(pageRel, attachment.previewPath) : originalHref;
      const downloadLink = isDownloadableAttachment(attachment)
        ? `\n              <a class="button" href="${htmlEscape(originalHref, true)}" download>Download</a>`
        : "";
      return `          <li>
            <span>${htmlEscape(attachment.label || attachment.path || "Attachment")}</span>
            <span class="actions">
              <a class="button" href="${htmlEscape(viewHref, true)}">View</a>${downloadLink}
            </span>
          </li>`;
    })
    .join("\n");
  if (!rows) return "";
  return `
        <section class="attachments">
          <h2>Files</h2>
          <ul>
${rows}
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
    img, video, iframe { max-width: 100%; }
    iframe { border: 1px solid #d8e2ef; border-radius: 6px; min-height: 320px; width: 100%; }
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
      <div class="activity-body">${body}</div>${attachmentsHtml}
    </article>
  </main>
</body>
</html>
`;
}

function collectLabItems(manifest) {
  const itemsById = new Map();
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    if (labIds.has(String(value.moodleActivityId)) && value.path) {
      if (!itemsById.has(String(value.moodleActivityId))) itemsById.set(String(value.moodleActivityId), value);
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(manifest);
  return [...itemsById.values()];
}

function updateCopies(manifest, repairedById) {
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const repaired = repairedById.get(String(value.moodleActivityId || ""));
    if (repaired && value.path === repaired.path) {
      Object.assign(value, {
        bytes: repaired.bytes,
        textPreview: repaired.textPreview,
        repairedAt: repaired.repairedAt,
      });
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(manifest);
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
const labItems = collectLabItems(manifest);
const repairedById = new Map();

for (const item of labItems) {
  const id = String(item.moodleActivityId);
  const source = item.source || `${moodleBase}/mod/assign/view.php?id=${id}`;
  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (isLoginPageContent(rawHtml)) throw new Error(`Moodle login page returned for ${source}`);

  const intro = extractMoodleIntro(rawHtml);
  if (!stripTags(intro)) throw new Error(`No Moodle intro body found for ${id} ${item.label}`);

  const pageRel = normalizeRelPath(item.path);
  const body = cleanBody(localizeBodyRefs(intro, source, pageRel, item));
  if (!stripTags(body)) throw new Error(`Localized body became empty for ${id} ${item.label}`);

  const abs = join(courseRoot, pageRel);
  writeFileSync(abs, pageHtml(item.label || `Lab ${id}`, body, renderAttachments(pageRel, item)), "utf8");
  repairedById.set(id, {
    path: pageRel,
    bytes: statSync(abs).size,
    textPreview: stripTags(readFileSync(abs, "utf8")).slice(0, 800),
    repairedAt: new Date().toISOString(),
  });
}

updateCopies(manifest, repairedById);
manifest.sourceAudit ||= {};
manifest.sourceAudit.sch3uLabActivityPageRepair = {
  repairedAt: new Date().toISOString(),
  repairedIds: [...repairedById.keys()],
  note:
    "Restored SCH3U Lab(AOL) Moodle activity pages from authenticated Moodle intro HTML. Main activity pages remain local HTML pages; attachment actions retain local previews/downloads, with video downloads omitted.",
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course, repaired: [...repairedById.entries()].map(([id, result]) => ({ id, ...result })) }, null, 2));
