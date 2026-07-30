import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const deploymentRoot = join(projectRoot, "deployment");

loadEnvFile(join(projectRoot, ".env"));

const courseArg = readArg("--course")?.toUpperCase();
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const limitArg = Number(readArg("--limit") || 0);
const cookieHeader = process.env.MOODLE_COOKIE || "";
const requestTimeoutMs = Math.max(10000, Number(process.env.MOODLE_ACTIVITY_TIMEOUT_MS || 60000));

if (!courseArg) {
  console.error("Usage: node scripts/localize-moodle-activity-resources.mjs --course COURSE [--dry-run] [--force] [--limit N]");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
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
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "resource";
}

function parseActivity(url) {
  const match = String(url || "").match(/\/mod\/([^/]+)\/view\.php\?id=(\d+)/i);
  return match ? { mod: match[1].toLowerCase(), id: match[2] } : null;
}

function parseDirectMoodleFile(url) {
  return /\/pluginfile\.php\//i.test(String(url || "")) ? { mod: "file", id: hashText(url) } : null;
}

function parseMoodleSource(url) {
  return parseActivity(url) || parseDirectMoodleFile(url);
}

function collectManifestItems(manifest) {
  const items = [];
  for (const item of manifest.courseDownloads || []) {
    items.push({ scope: "courseDownloads", item });
  }
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) {
        items.push({ scope: "lesson", unit, lesson, item });
      }
    }
  }
  return items.filter(({ item }) => item?.url && !item.path && parseMoodleSource(item.url));
}

function extensionFor(filename, contentType) {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/presentationml/i.test(contentType)) return "pptx";
  if (/spreadsheetml/i.test(contentType)) return "xlsx";
  if (/html/i.test(contentType)) return "html";
  return "bin";
}

function filenameFromHeaders(url, headers, fallback) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fromHeader = utfName || plainName;
  if (fromHeader) return decodeURIComponent(fromHeader);
  try {
    const fromUrl = decodeURIComponent(basename(new URL(url).pathname));
    if (fromUrl && fromUrl !== "view.php" && fromUrl !== "pluginfile.php") return fromUrl;
  } catch {
    // Keep fallback.
  }
  return fallback;
}

function validateSignature(type, buffer, contentType) {
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (["docx", "xlsx", "pptx"].includes(type) && !startsWithPk) throw new Error(`downloaded ${type} is not an OOXML package`);
  if (type === "pdf" && !startsWithPdf) throw new Error("downloaded file is not a PDF");
  if (type === "doc" && !startsWithOle) throw new Error("downloaded file is not a legacy DOC");
  if (type === "html" && !/html/i.test(contentType)) throw new Error("downloaded file is not HTML");
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

const jar = new CookieJar(cookieHeader);

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-moodle-activity-localizer/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${requestTimeoutMs}ms`)), requestTimeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, headers, redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

function parseHiddenToken(html) {
  return /name=["']logintoken["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] || "";
}

async function loginIfNeeded() {
  if (cookieHeader) return { loggedIn: false, reason: "cookie-provided" };
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = parseHiddenToken(loginHtml);
  const body = new URLSearchParams({ username, password, anchor: "", logintoken: token });
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (response.url.includes("/login/index.php") && /name=["']username["']/i.test(text)) {
    throw new Error("Moodle login failed.");
  }
  return { loggedIn: true, reason: "credentials" };
}

function isLoginHtml(buffer, contentType, finalUrl) {
  const probe = buffer.subarray(0, Math.min(buffer.length, 1200)).toString("utf8");
  return /text\/html/i.test(contentType) && (/\/login\/index\.php/i.test(finalUrl) || /name=["']username["']|name=["']password["']|logintoken/i.test(probe));
}

async function fetchBuffer(url) {
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (isLoginHtml(buffer, contentType, response.url || url)) throw new Error("download returned Moodle login page");
  return { response, buffer, contentType };
}

function pluginfileUrls(html, baseUrl) {
  const urls = new Set();
  const pattern = /\b(?:href|src)\s*=\s*["']([^"']*(?:pluginfile\.php|forcedownload=1)[^"']*)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1].replaceAll("&amp;", "&");
    try {
      urls.add(new URL(raw, baseUrl).toString());
    } catch {
      // Ignore malformed links.
    }
  }
  return [...urls].filter((url) => !/\/(?:theme|webservice)\//i.test(url) && !/\/pluginfile\.php\/\d+\/theme_[^/]+\//i.test(url));
}

function extractBody(htmlText) {
  const region = /<section\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/section>/i.exec(htmlText)?.[1]
    || /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(htmlText)?.[1]
    || /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(htmlText)?.[1]
    || htmlText;
  return embedYoutubeLinks(region)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\s(?:href|src|poster|action)=["'](?:https?:)?\/\/www\.esunnybrook\.com\/[^"']*["']/gi, ' data-localized-link="removed"')
    .replace(/\s(?:href|src|poster|action)=["']\/pluginfile\.php[^"']*["']/gi, ' data-localized-link="removed"');
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function youtubeEmbedUrl(url) {
  const raw = decodeHtmlAttribute(url);
  try {
    const parsed = new URL(raw);
    if (/(^|\.)youtube\.com$/i.test(parsed.hostname) || /(^|\.)youtube-nocookie\.com$/i.test(parsed.hostname)) {
      if (parsed.pathname.startsWith("/embed/")) return parsed.toString();
      const id = parsed.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
    if (/youtu\.be$/i.test(parsed.hostname)) {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    }
  } catch {
    // Not a URL we can normalize.
  }
  return "";
}

function renderYoutubeEmbed(url, label = "YouTube video") {
  const embedUrl = youtubeEmbedUrl(url);
  if (!embedUrl) return "";
  return `<figure class="youtube-embed">
    <iframe src="${htmlEscape(embedUrl, true)}" title="${htmlEscape(label, true)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
    <figcaption><a href="${htmlEscape(url, true)}" target="_blank" rel="noopener">${htmlEscape(label)}</a></figcaption>
  </figure>`;
}

function embedYoutubeLinks(html) {
  return String(html || "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, (match) => {
      const src = /\bsrc=["']([^"']+)["']/i.exec(match)?.[1] || "";
      return youtubeEmbedUrl(src) ? renderYoutubeEmbed(src) || match : match;
    })
    .replace(/<a\b([^>]*)href=["']([^"']*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)[^"']*)["']([^>]*)>([\s\S]*?)<\/a>/gi, (match, before, href, after, label) => {
      const text = label.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "YouTube video";
      return renderYoutubeEmbed(decodeHtmlAttribute(href), text) || match;
    });
}

function isMoodleActivityUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.esunnybrook.com" && /^\/(?:mod|theme|lib|pluginfile|webservice)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractExternalUrlFromMoodleUrlHtml(htmlText, baseUrl) {
  const candidates = [];
  const patterns = [
    /<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)["']/gi,
    /\bwindow\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
    /\blocation\.replace\(\s*["']([^"']+)["']\s*\)/gi,
    /\b(?:href|data-url)\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of htmlText.matchAll(pattern)) {
      const raw = String(match[1] || "").replaceAll("&amp;", "&").trim();
      if (!raw) continue;
      try {
        candidates.push(new URL(raw, baseUrl).toString());
      } catch {
        // Ignore malformed links.
      }
    }
  }
  return candidates.find((url) => !isMoodleActivityUrl(url) && !/\/login\/index\.php/i.test(url)) || "";
}

function standaloneHtml(title, body, attachments = [], externalUrl = "") {
  const attachmentHtml = attachments.length
    ? `<section class="attachments"><h2>Files</h2><ul>${attachments
        .map((file) => `<li><a href="${htmlEscape(file.href, true)}" download>${htmlEscape(file.label)}</a></li>`)
        .join("")}</ul></section>`
    : "";
  const externalHtml = externalUrl
    ? `<p><a class="button" href="${htmlEscape(externalUrl, true)}" target="_blank" rel="noopener">Open external resource</a></p>`
    : "";
  const unresolvedHtml = !body && !attachments.length && !externalUrl
    ? `<p class="notice">Original Moodle URL activity was localized, but its final external target still needs manual confirmation.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    a { color: #00396f; font-weight: 700; }
    .button { display: inline-block; border: 1px solid #8db0d7; border-radius: 6px; padding: 8px 12px; background: #f4f9ff; text-decoration: none; }
    .notice { border: 1px solid #e0b45c; border-radius: 6px; background: #fff8e8; color: #674000; padding: 10px 12px; }
    iframe { display: block; width: min(100%, 820px); min-height: 420px; border: 1px solid #d9e2ef; border-radius: 6px; background: #fff; }
    .youtube-embed { width: min(100%, 820px); margin: 18px 0 24px; }
    .youtube-embed iframe { width: 100%; aspect-ratio: 16 / 9; min-height: 0; }
    .youtube-embed figcaption { color: #637083; font-size: 13px; margin-top: 8px; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      ${externalHtml}
      <div class="moodle-content">${body}</div>
      ${attachmentHtml}
    </article>
  </main>
</body>
</html>
`;
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

function localBaseRel(activity, owner) {
  const lessonPart = owner.lesson?.id ? `${owner.lesson.id}-` : "course-";
  return `localized-moodle-activities/${activity.mod}/${lessonPart}${activity.id}-${hashText(owner.item.url)}`;
}

async function downloadAttachment(url, baseRel, title) {
  const { response, buffer, contentType } = await fetchBuffer(url);
  const filename = filenameFromHeaders(response.url || url, response.headers, `${sanitizeSegment(title)}-${hashText(url)}.bin`);
  const type = extensionFor(filename, contentType);
  const targetName = `${hashText(url)}-${sanitizeSegment(filename)}`;
  const rel = toPosix(join(baseRel, "files", targetName));
  const abs = join(courseRoot, rel);
  validateSignature(type, buffer, contentType);
  if (!dryRun) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buffer);
  }
  return { label: filename, type, path: rel, href: courseRelative(join(baseRel, "index.html"), rel), bytes: buffer.length, source: url };
}

async function processActivity(owner) {
  const { item } = owner;
  const activity = parseMoodleSource(item.url);
  const baseRel = localBaseRel(activity, owner);
  const title = item.label || `${activity.mod} ${activity.id}`;

  if (activity.mod === "file") {
    const direct = await fetchBuffer(item.url);
    const filename = filenameFromHeaders(direct.response.url || item.url, direct.response.headers, `${sanitizeSegment(title)}.bin`);
    const type = extensionFor(filename, direct.contentType);
    validateSignature(type, direct.buffer, direct.contentType);
    const rel = toPosix(join(baseRel, `${hashText(item.url)}-${sanitizeSegment(filename)}`));
    const abs = join(courseRoot, rel);
    if (!dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, direct.buffer);
    }
    return { mode: "direct-file", path: rel, type, bytes: direct.buffer.length, source: item.url };
  }

  const first = await fetchBuffer(item.url);
  const htmlLike = /text\/html/i.test(first.contentType);
  const directFile = !htmlLike || /pluginfile\.php/i.test(first.response.url || "");

  if (activity.mod === "url") {
    const finalUrl = first.response.url || "";
    const htmlText = htmlLike ? first.buffer.toString("utf8") : "";
    const externalUrl = finalUrl && !isMoodleActivityUrl(finalUrl)
      ? finalUrl
      : extractExternalUrlFromMoodleUrlHtml(htmlText, item.url);
    const rel = toPosix(join(baseRel, "index.html"));
    const abs = join(courseRoot, rel);
    if (!dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, standaloneHtml(title, "", [], externalUrl), "utf8");
    }
    return {
      mode: "external-link-html",
      path: rel,
      type: "html",
      bytes: dryRun ? 0 : statSync(abs).size,
      source: item.url,
      attachments: [],
      externalUrl,
    };
  }

  if (activity.mod === "resource" && directFile) {
    const filename = filenameFromHeaders(first.response.url || item.url, first.response.headers, `${sanitizeSegment(title)}.bin`);
    const type = extensionFor(filename, first.contentType);
    validateSignature(type, first.buffer, first.contentType);
    const rel = toPosix(join(baseRel, `${hashText(item.url)}-${sanitizeSegment(filename)}`));
    const abs = join(courseRoot, rel);
    if (!dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, first.buffer);
    }
    return { mode: "file", path: rel, type, bytes: first.buffer.length, source: item.url };
  }

  const htmlText = first.buffer.toString("utf8");
  const attachments = [];
  for (const url of pluginfileUrls(htmlText, item.url)) {
    try {
      attachments.push(await downloadAttachment(url, baseRel, title));
    } catch (error) {
      attachments.push({ label: `Failed attachment: ${url}`, error: error?.message || String(error), source: url });
    }
  }

  const body = extractBody(htmlText);
  const rel = toPosix(join(baseRel, "index.html"));
  const abs = join(courseRoot, rel);
  if (!dryRun) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, standaloneHtml(title, body, attachments.filter((file) => file.path), ""), "utf8");
  }
  return {
    mode: "html",
    path: rel,
    type: "html",
    bytes: dryRun ? 0 : statSync(abs).size,
    source: item.url,
    attachments,
  };
}

const courseRoot = join(coursewareRoot, courseArg);
const manifestPath = join(courseRoot, "course-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
let owners = collectManifestItems(manifest);
if (limitArg > 0) owners = owners.slice(0, limitArg);

const report = {
  generatedAt: new Date().toISOString(),
  course: courseArg,
  dryRun,
  force,
  rows: owners.length,
  downloads: [],
  failures: [],
};
const reportPath = join(deploymentRoot, `moodle-activity-localization-report-${courseArg}.json`);

function checkpoint() {
  mkdirSync(deploymentRoot, { recursive: true });
  writeJson(reportPath, report);
  if (!dryRun) {
    manifest.generatedAt = new Date().toISOString();
    writeJson(manifestPath, manifest);
  }
}

try {
  report.auth = dryRun ? { loggedIn: false, reason: "dry-run" } : await loginIfNeeded();
  for (const owner of owners) {
    try {
      const current = owner.item;
      if (!force && current.path && existsSync(join(courseRoot, current.path))) {
        report.downloads.push({ label: current.label, status: "skipped", path: current.path });
        continue;
      }
      const result = dryRun ? { mode: "would-localize", path: "", type: current.type || "html", source: current.url } : await processActivity(owner);
      if (!dryRun) {
        current.path = result.path;
        current.type = result.type;
        current.bytes = result.bytes;
        current.source = result.source || current.url || current.source;
        delete current.url;
        if (result.externalUrl) current.externalUrl = result.externalUrl;
        else delete current.externalUrl;
        if (result.attachments?.some((file) => file.path)) current.attachments = result.attachments.filter((file) => file.path);
      }
      report.downloads.push({ label: current.label, status: "localized", mod: parseMoodleSource(current.source || current.url)?.mod, ...result });
      console.log(`Localized ${courseArg}: ${current.label} -> ${result.path || result.mode}`);
      checkpoint();
    } catch (error) {
      const failure = { label: owner.item.label, url: owner.item.url, error: error?.message || String(error) };
      report.failures.push(failure);
      console.error(`Failed ${courseArg}: ${failure.label}: ${failure.error}`);
      checkpoint();
    }
  }
} catch (error) {
  report.failures.push({ label: "login", error: error?.message || String(error) });
  console.error(error?.message || String(error));
}

checkpoint();
console.log(`Moodle activity localization ${courseArg}: rows ${owners.length}; localized ${report.downloads.length}; failed ${report.failures.length}.`);
if (report.failures.length) process.exitCode = 1;
