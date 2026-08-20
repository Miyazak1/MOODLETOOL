import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const courseRoot = path.join(workspaceRoot, "courseware", "AVI2O");
const manifestPath = path.join(courseRoot, "course-manifest.json");

loadEnvFile(path.join(projectRoot, ".env"));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeHtml(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
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

async function moodleRequest(url, options = {}, follow = true, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-avi2o-url-activity-repair/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  let response;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url, { ...options, headers, redirect: "manual" });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  jar.store(response.headers);
  if (follow && [301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return moodleRequest(new URL(response.headers.get("location"), url).toString(), options, follow, redirects + 1);
  }
  return response;
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password || username.includes("Fill ") || password.includes("Fill ")) {
    throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD before repairing AVI2O Moodle HTML activity pages.");
  }
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await moodleRequest(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const response = await moodleRequest(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login failed.");
}

function extractElementFromStart(html, startMatch) {
  const start = startMatch.index;
  const tag = startMatch[1];
  const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = start;
  let depth = 0;
  for (const match of html.matchAll(tagPattern)) {
    const token = match[0];
    const closing = /^<\//.test(token);
    const selfClosing = /\/\s*>$/.test(token);
    if (closing) depth -= 1;
    else if (!selfClosing) depth += 1;
    if (depth === 0) return html.slice(start, match.index + token.length);
  }
  return "";
}

function findElementByAttr(html, attr, value) {
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\b${attr}=["'][^"']*\\b${value}\\b)[^>]*>`, "i");
  const match = pattern.exec(html);
  return match ? extractElementFromStart(html, match) : "";
}

function findElementById(html, id) {
  const pattern = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>`, "i");
  const match = pattern.exec(html);
  return match ? extractElementFromStart(html, match) : "";
}

function extractExternalUrlFromHtml(html, baseUrl) {
  const decoded = String(html || "").replaceAll("&amp;", "&").replaceAll("\\/", "/").replaceAll("\\u0026", "&");
  const patterns = [
    /<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)["']/gi,
    /\bwindow\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
    /\blocation\.replace\(\s*["']([^"']+)["']\s*\)/gi,
    /\b(?:href|data-url|data-href)\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      const raw = String(match[1] || "").trim();
      if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) continue;
      try {
        const url = new URL(raw, baseUrl).toString();
        if (!/www\.esunnybrook\.com/i.test(url)) return url;
      } catch {
        // Ignore malformed candidates.
      }
    }
  }
  return "";
}

function attachmentHrefForUrl(url, attachments) {
  if (!/www\.esunnybrook\.com\/pluginfile\.php/i.test(url)) return "";
  let urlName = "";
  try {
    urlName = decodeURIComponent(path.basename(new URL(url).pathname));
  } catch {
    return "";
  }
  const normalizedUrlName = urlName.toLowerCase();
  const match = attachments.find((attachment) => String(attachment.label || path.basename(attachment.path || "")).toLowerCase() === normalizedUrlName);
  if (!match?.path) return "";
  return match.href || toPosix(path.join("files", path.basename(match.path)));
}

function cleanFragment(fragment, baseUrl, currentPath, activityPathById, attachments = []) {
  let html = fragment
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/<button\b[\s\S]*?<\/button>/gi, "")
    .replace(/<img\b[^>]*\bsrc=["']https?:\/\/www\.esunnybrook\.com\/theme\/image\.php[^>]*>/gi, "")
    .replace(/<div\b[^>]*\bclass=["'][^"']*\bfileuploadsubmissiontime\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/\syuiConfig=(?:"[^"]*"|'[^']*')/gi, "")
    .replace(/\s(?:on[a-z]+|data-[\w:-]+)=["'][^"']*["']/gi, "")
    .replace(/\s(?:id)=["'][^"']*["']/gi, "");

  html = html.replace(/\s(href|src)=["']([^"']+)["']/gi, (match, attr, raw) => {
    const value = decodeHtml(raw).trim();
    if (!value || value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("tel:") || value.startsWith("data:")) return match;
    try {
      const url = new URL(value, baseUrl).toString();
      const internalId = /www\.esunnybrook\.com\/mod\/[^/]+\/view\.php\?id=(\d+)/i.exec(url)?.[1] || "";
      const localTarget = internalId ? activityPathById.get(internalId) : "";
      if (localTarget) {
        const relative = toPosix(path.relative(path.dirname(currentPath), localTarget));
        return ` ${attr.toLowerCase()}="${escapeHtml(relative || path.basename(localTarget), true)}"`;
      }
      const attachmentHref = attachmentHrefForUrl(url, attachments);
      if (attachmentHref) return ` ${attr.toLowerCase()}="${escapeHtml(attachmentHref, true)}" download`;
      if (/www\.esunnybrook\.com\/pluginfile\.php/i.test(url)) return "";
      return ` ${attr.toLowerCase()}="${escapeHtml(url, true)}"`;
    } catch {
      return match;
    }
  });

  html = html.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
    if (!/\bhref=["']https?:\/\//i.test(attrs)) return match;
    const withoutTarget = attrs.replace(/\s(?:target|rel)=["'][^"']*["']/gi, "");
    return `<a${withoutTarget} target="_blank" rel="noreferrer">`;
  });

  return html.trim();
}

function uniqueMeaningfulFragments(html, baseUrl, currentPath, activityPathById, attachments = []) {
  const candidates = [
    findElementById(html, "intro"),
    findElementByAttr(html, "class", "activity-description"),
    findElementByAttr(html, "class", "urlworkaround"),
    findElementByAttr(html, "class", "resourcecontent"),
    findElementByAttr(html, "class", "boxaligncenter"),
    findElementByAttr(html, "class", "foldertree"),
    findElementByAttr(html, "class", "generalbox"),
  ];
  const seen = new Set();
  const fragments = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const text = stripHtml(candidate);
    if (!text || text.length < 3) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fragments.push(cleanFragment(candidate, baseUrl, currentPath, activityPathById, attachments));
  }
  return fragments;
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #102033; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 6px; padding: 22px; }
    h1 { margin-top: 0; font-size: 28px; }
    h2 { margin-top: 28px; font-size: 20px; }
    p, li { line-height: 1.55; }
    a { color: #00396f; font-weight: 700; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; }
    .muted { color: #526173; }
    .urlworkaround, .resourcecontent, .generalbox, .foldertree { margin-top: 18px; padding: 16px; background: #f8fbff; border: 1px solid #d9e2ef; border-radius: 6px; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments ul { margin-bottom: 0; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${escapeHtml(title)}</h1>
      ${body}
    </article>
  </main>
</body>
</html>
`;
}

function isMoodleHtmlActivity(item) {
  const category = String(item?.category || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  if (!item?.path || !["html", "htm"].includes(type)) return false;
  return ["moodle_url", "moodle_assign", "moodle_folder", "moodle_forum", "moodle_page"].includes(category);
}

function eachMoodleHtmlActivityResource(manifest, callback) {
  for (const item of manifest.courseDownloads || []) {
    if (isMoodleHtmlActivity(item)) callback(item);
  }
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) {
        if (isMoodleHtmlActivity(item)) callback(item, lesson);
      }
    }
  }
}

function activityUrlForItem(item) {
  const id = String(item.moodleActivityId || "").trim();
  const mod = String(item.category || "").toLowerCase().replace(/^moodle_/, "") || "activity";
  return `https://www.esunnybrook.com/mod/${mod}/view.php?id=${encodeURIComponent(id)}`;
}

function attachmentsSection(item) {
  const attachments = item.attachments || [];
  if (!attachments.length) return "";
  const rows = attachments
    .filter((attachment) => attachment.path)
    .map((attachment) => {
      const href = attachment.href || toPosix(path.join("files", path.basename(attachment.path)));
      return `<li><a href="${escapeHtml(href, true)}" download>${escapeHtml(attachment.label || path.basename(attachment.path))}</a></li>`;
    })
    .join("");
  return rows ? `<section class="attachments"><h2>Files</h2><ul>${rows}</ul></section>` : "";
}

async function repairHtmlActivity(item, activityPathById) {
  const id = String(item.moodleActivityId || "").trim();
  if (!id || !item.path) return { status: "skipped", reason: "missing id/path", label: item.label };
  const isUrlActivity = String(item.category || "").toLowerCase() === "moodle_url";
  const activityUrl = activityUrlForItem(item);
  const response = await moodleRequest(activityUrl, {}, !isUrlActivity);
  const redirectLocation = response.headers.get("location");
  if (isUrlActivity && [301, 302, 303, 307, 308].includes(response.status) && redirectLocation) {
    const externalUrl = new URL(redirectLocation, activityUrl).toString();
    const fallback = `<div class="urlworkaround"><p>Click on <a href="${escapeHtml(externalUrl, true)}" target="_blank" rel="noreferrer">${escapeHtml(item.label || "the linked resource")}</a> to open the resource.</p></div>`;
    const localHtml = pageShell(item.label || "Moodle URL Activity", fallback);
    const abs = path.join(courseRoot, item.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, localHtml, "utf8");
    item.type = "html";
    item.bytes = Buffer.byteLength(localHtml);
    item.textPreview = stripHtml(fallback).slice(0, 500);
    item.source = `authenticated SunnyBrook Moodle url activity id ${id}`;
    item.externalReference = true;
    item.externalUrl = externalUrl;
    delete item.previewUrl;
    delete item.unavailable;
    delete item.unavailableReason;
    delete item.unavailableTarget;
    return { status: "restored", label: item.label, id, textPreview: item.textPreview.slice(0, 120), redirected: true };
  }
  const html = await response.text();
  if (!response.ok) return { status: "failed", reason: `HTTP ${response.status}`, label: item.label };
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) {
    throw new Error(`Moodle login expired while fetching ${activityUrl}`);
  }

  const fragments = uniqueMeaningfulFragments(html, activityUrl, item.path, activityPathById, item.attachments || []);
  const externalUrl = extractExternalUrlFromHtml(html, activityUrl);
  if (isUrlActivity && !fragments.length && externalUrl) {
    fragments.push(`<div class="urlworkaround"><p>Click on <a href="${escapeHtml(externalUrl, true)}" target="_blank" rel="noreferrer">${escapeHtml(item.label || "the linked resource")}</a> to open the resource.</p></div>`);
  }
  if (!fragments.length) {
    fragments.push(`<p class="muted">This Moodle activity did not expose additional text content in the current course shell.</p>`);
  }

  const localHtml = pageShell(item.label || "Moodle Activity", `${fragments.join("\n")}${attachmentsSection(item)}`);
  const abs = path.join(courseRoot, item.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, localHtml, "utf8");

  item.type = "html";
  item.bytes = Buffer.byteLength(localHtml);
  item.textPreview = stripHtml(fragments.join(" ")).slice(0, 500);
  item.source = `authenticated SunnyBrook Moodle url activity id ${id}`;
  item.externalReference = Boolean(isUrlActivity && externalUrl);
  if (isUrlActivity && externalUrl) item.externalUrl = externalUrl;
  else delete item.externalUrl;
  delete item.previewUrl;
  delete item.unavailable;
  delete item.unavailableReason;
  delete item.unavailableTarget;
  return { status: "restored", label: item.label, id, category: item.category, textPreview: item.textPreview.slice(0, 120) };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
await loginIfNeeded();
const activityPathById = new Map();
eachMoodleHtmlActivityResource(manifest, (item) => {
  const id = String(item.moodleActivityId || "").trim();
  if (id && item.path) activityPathById.set(id, item.path);
});
const resources = [];
eachMoodleHtmlActivityResource(manifest, (item) => {
  resources.push(item);
});
const settled = [];
for (const item of resources) {
  try {
    settled.push(await repairHtmlActivity(item, activityPathById));
  } catch (error) {
    settled.push({ status: "failed", label: item.label, category: item.category, reason: error instanceof Error ? error.message : String(error) });
  }
}
const restored = settled.filter((item) => item.status === "restored").length;
const failed = settled.filter((item) => item.status === "failed");

manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...(manifest.sourceAudit || {}),
  avi2oMoodleHtmlActivityPagesRestored: {
    restoredAt: manifest.generatedAt,
    restored,
    failed: failed.length,
    basis: "Preserved Moodle HTML activity pages as local text-and-link pages. External linked content was not downloaded.",
  },
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ restored, failed, samples: settled.filter((item) => item.status === "restored").slice(0, 5) }, null, 2));
