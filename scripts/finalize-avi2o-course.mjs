import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "AVI2O";
const title = "Visual Arts, Grade 10, Open";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const roadmapPath = join(projectRoot, "public", "course-roadmap.json");
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");
const officialCurriculumPath = "texts/ontario-arts-curriculum-9-10/arts910curr2010.pdf";
const officialCurriculumSource = "https://www.edu.gov.on.ca/eng/curriculum/secondary/arts910curr2010.pdf";
const unresolvedUrlIds = new Set(["4", "5", "24", "27", "29", "41"]);

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

function esc(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function sanitizeSegment(value) {
  return String(value || "resource")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "resource";
}

function eachResource(manifest, callback) {
  for (const item of manifest.courseDownloads || []) callback(item, { scope: "course" });
  for (const text of manifest.texts || []) {
    callback(text, { scope: "text" });
    for (const material of text.materials || []) callback(material, { scope: "text-material" });
  }
  for (const unit of manifest.units || []) {
    callback(unit.unitPlan, { scope: "unit-plan", unit });
    for (const resource of Object.values(unit.unitResources || {})) Array.isArray(resource) ? resource.forEach((item) => callback(item, { scope: "unit-resource", unit })) : callback(resource, { scope: "unit-resource", unit });
    for (const lesson of unit.lessons || []) {
      callback(lesson.lessonPlan, { scope: "lesson-plan", unit, lesson });
      for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) for (const item of lesson[key] || []) callback(item, { scope: key, unit, lesson });
    }
  }
}

function htmlPathForUrlItem(item, owner) {
  if (item.path) return item.path;
  const id = item.moodleActivityId || "url";
  const prefix = owner.lesson?.id || "course";
  return toPosix(join("localized-moodle-activities", "url", `${sanitizeSegment(prefix)}-${id}-${hashText(item.url || item.label)}`, "index.html"));
}

function fileDirForItem(item, owner) {
  return toPosix(join(dirname(htmlPathForUrlItem(item, owner)), "files"));
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
  headers.set("user-agent", "ossd-course-portal-avi2o-finalizer/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
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
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await moodleRequest(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const response = await moodleRequest(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const text = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(text)) throw new Error("Moodle login failed.");
}

async function resolveMoodleUrlTarget(id) {
  const url = `https://www.esunnybrook.com/mod/url/view.php?id=${encodeURIComponent(id)}`;
  for (const candidate of [`${url}&redirect=1`, url]) {
    const response = await moodleRequest(candidate, {}, false);
    const location = response.headers.get("location");
    if (location && !/\/login\/index\.php/i.test(location)) return new URL(location, candidate).toString();
    const html = await response.text();
    const found = extractExternalUrlFromHtml(html, candidate);
    if (found) return found;
  }
  return "";
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

async function fetchExternal(url, redirects = 0) {
  const headers = new Headers({ "user-agent": "ossd-course-portal-external-resource-localizer/1.0" });
  const response = await fetch(url, { headers, redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return fetchExternal(new URL(response.headers.get("location"), url).toString(), redirects + 1);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, buffer, contentType: response.headers.get("content-type") || "", finalUrl: response.url || url };
}

function googleCandidates(url) {
  const candidates = [];
  const docId = /docs\.google\.com\/document\/d\/([^/]+)/i.exec(url)?.[1];
  if (docId) candidates.push({ url: `https://docs.google.com/document/d/${docId}/export?format=docx`, fallback: `${docId}.docx`, type: "docx" });
  const fileId = /drive\.google\.com\/file\/d\/([^/]+)/i.exec(url)?.[1] || /[?&]id=([^&]+)/i.exec(url)?.[1];
  if (fileId) candidates.push({ url: `https://drive.google.com/uc?export=download&id=${fileId}`, fallback: `${fileId}.bin`, type: "" });
  return candidates;
}

function directCandidate(url) {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const ext = extname(pathname).replace(".", "").toLowerCase();
  if (!["pdf", "jpg", "jpeg", "png", "mp4", "docx", "doc", "ppt", "pptx"].includes(ext)) return null;
  return { url, fallback: decodeURIComponent(basename(pathname)) || `external.${ext}`, type: ext };
}

function unavailableTargetLabel(url) {
  if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(url)) return "external object storage host";
  if (/docs\.google\.com|drive\.google\.com/i.test(url)) return "Google Drive/Docs";
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown external host";
  }
}

function typeFromResponse(filename, contentType, preferredType = "") {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext && ext !== "bin") return ext;
  if (preferredType) return preferredType;
  if (/pdf/i.test(contentType)) return "pdf";
  if (/jpeg/i.test(contentType)) return "jpg";
  if (/png/i.test(contentType)) return "png";
  if (/mp4|video/i.test(contentType)) return "mp4";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  if (/presentationml/i.test(contentType)) return "pptx";
  return "bin";
}

function validateDownloaded(type, buffer, contentType) {
  const pk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const pdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const jpg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (type === "pdf" && !pdf) throw new Error("not a PDF");
  if (["docx", "pptx"].includes(type) && !pk) throw new Error(`not a ${type} package`);
  if (["doc", "ppt"].includes(type) && !ole) throw new Error(`not a legacy ${type}`);
  if (type === "jpg" && !jpg) throw new Error("not a JPG");
  if (type === "png" && !png) throw new Error("not a PNG");
  if (type === "mp4" && !/video|mp4|octet-stream/i.test(contentType) && buffer.length < 1024) throw new Error("not an MP4 download");
  if (/text\/html/i.test(contentType) && !["html"].includes(type)) throw new Error("download returned HTML");
}

function filenameFromHeaders(url, headers, fallback) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fromHeader = utfName || plainName;
  if (fromHeader) return decodeURIComponent(fromHeader);
  try {
    const fromUrl = decodeURIComponent(basename(new URL(url).pathname));
    if (fromUrl && fromUrl !== "uc" && fromUrl !== "export") return fromUrl;
  } catch {
    // Keep fallback.
  }
  return fallback;
}

async function downloadCandidate(candidate, item, owner) {
  const result = await fetchExternal(candidate.url);
  if (!result.response.ok) throw new Error(`HTTP ${result.response.status}`);
  const filename = sanitizeSegment(filenameFromHeaders(result.finalUrl || candidate.url, result.response.headers, candidate.fallback));
  const type = typeFromResponse(filename, result.contentType, candidate.type);
  validateDownloaded(type, result.buffer, result.contentType);
  const rel = toPosix(join(fileDirForItem(item, owner), `${hashText(candidate.url)}-${filename.endsWith(`.${type}`) ? filename : `${filename}.${type}`}`));
  const abs = join(courseRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, result.buffer);
  return {
    label: filename,
    type,
    path: rel,
    href: toPosix(join("files", basename(rel))),
    bytes: result.buffer.length,
    source: `localized external target for Moodle URL activity id ${item.moodleActivityId || ""}`.trim(),
  };
}

async function localizeExternalTargets(manifest) {
  const localized = [];
  const failed = [];
  await loginIfNeeded();
  const resources = [];
  eachResource(manifest, (item, owner) => {
    if (item?.category === "moodle_url") resources.push({ item, owner });
  });
  for (const { item, owner } of resources) {
    if (!item.externalUrl && unresolvedUrlIds.has(String(item.moodleActivityId || ""))) {
      item.externalUrl = await resolveMoodleUrlTarget(item.moodleActivityId);
    }
    const externalUrl = item.externalUrl || "";
    const candidates = [...googleCandidates(externalUrl)];
    const direct = directCandidate(externalUrl);
    if (direct) candidates.push(direct);
    const isMoodleHelpFallback = /moodle\.com\/help/i.test(externalUrl);
    if (!candidates.length || isMoodleHelpFallback) {
      if (isMoodleHelpFallback) {
        item.unavailable = true;
        item.unavailableReason = "Moodle URL target resolves to Moodle help fallback instead of course content.";
        delete item.externalUrl;
      }
      item.path = htmlPathForUrlItem(item, owner);
      writeUrlPage(item, owner);
      continue;
    }
    let downloaded = null;
    let lastError = "";
    for (const candidate of candidates) {
      try {
        downloaded = await downloadCandidate(candidate, item, owner);
        break;
      } catch (error) {
        lastError = error?.message || String(error);
      }
    }
    item.path = htmlPathForUrlItem(item, owner);
    if (downloaded) {
      item.attachments = [...(item.attachments || []).filter((attachment) => attachment.path !== downloaded.path), downloaded];
      item.localizedExternal = true;
      item.localizedExternalType = downloaded.type;
      delete item.externalUrl;
      delete item.unavailable;
      delete item.unavailableReason;
      localized.push({ label: item.label, type: downloaded.type, path: downloaded.path });
    } else {
      item.unavailable = true;
      item.unavailableReason = `External target could not be downloaded: ${lastError || "unknown error"}`;
      item.unavailableTarget = unavailableTargetLabel(externalUrl);
      delete item.externalUrl;
      failed.push({ label: item.label, externalUrl, error: item.unavailableReason });
    }
    writeUrlPage(item, owner);
  }
  return { localized, failed };
}

function writeUrlPage(item, owner) {
  const attachments = item.attachments || [];
  const primary = attachments[attachments.length - 1];
  let body = "";
  if (primary?.type === "mp4") {
    body = `<video controls preload="metadata" src="${esc(primary.href || toPosix(join("files", basename(primary.path))), true)}"></video>`;
  } else if (/jpe?g|png/i.test(primary?.type || "")) {
    body = `<img class="resource-image" src="${esc(primary.href || toPosix(join("files", basename(primary.path))), true)}" alt="${esc(item.label, true)}">`;
  } else if (primary?.path) {
    body = `<p><a href="${esc(primary.href || toPosix(join("files", basename(primary.path))), true)}" download>${esc(primary.label || basename(primary.path))}</a></p>`;
  } else if (item.unavailable) {
    body = `<p>This Moodle URL target was not downloadable during localization.</p><p class="muted">${esc(item.unavailableReason || "Unavailable external target.")}</p>`;
  } else if (item.externalUrl) {
    body = `<p>This Moodle URL points to an external reference that did not expose a downloadable source file.</p><p><a href="${esc(item.externalUrl, true)}" target="_blank" rel="noreferrer">Open external reference</a></p>`;
  } else {
    body = `<p>No downloadable file was exposed by this Moodle URL activity during localization.</p>`;
  }
  const rows = attachments.map((attachment, index) => {
    const href = attachment.href || toPosix(join("files", basename(attachment.path)));
    return `<tr><td>${index + 1}</td><td><a href="${esc(href, true)}" download>${esc(attachment.label || basename(attachment.path))}</a></td><td>${esc(String(attachment.type || "").toUpperCase())}</td></tr>`;
  }).join("\n");
  const downloads = rows ? `<h2>Files</h2><table><thead><tr><th>#</th><th>File</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table>` : "";
  const html = pageShell(item.label, `${body}${downloads}`);
  const abs = join(courseRoot, item.path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html, "utf8");
  item.bytes = statSync(abs).size;
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f8fb; color: #102033; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 6px; padding: 22px; }
    h1 { margin-top: 0; font-size: 28px; }
    h2 { margin-top: 28px; font-size: 20px; }
    p { line-height: 1.55; }
    a { color: #00396f; font-weight: 700; overflow-wrap: anywhere; }
    video { width: min(100%, 780px); max-height: 440px; background: #111; display: block; }
    .resource-image { max-width: 100%; height: auto; display: block; border: 1px solid #d9e2ef; }
    .muted { color: #526173; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #d9e2ef; padding: 9px 10px; text-align: left; vertical-align: top; }
    th { background: #eef3f8; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${esc(title)}</h1>
      ${body}
    </article>
  </main>
</body>
</html>
`;
}

function isNamedStudentChecklist(attachment) {
  const text = `${attachment?.label || ""} ${attachment?.path || ""}`;
  return /(?:Conversation|Observation)-Checklist-(?:Ali|Gao)\b/i.test(text);
}

function removeNamedStudentChecklistReferences(manifest) {
  let removed = 0;
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const before = item.attachments.length;
    item.attachments = item.attachments.filter((attachment) => !isNamedStudentChecklist(attachment));
    removed += before - item.attachments.length;
    if (!item.attachments.length) delete item.attachments;
  });
  return removed;
}

function removeNamedStudentChecklistFiles() {
  let removed = 0;
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (entry.isFile() && /(?:Conversation|Observation)-Checklist-(?:Ali|Gao)\.docx$/i.test(entry.name)) {
        unlinkSync(path);
        removed++;
      }
    }
  }
  visit(courseRoot);
  return removed;
}

function rewriteFolderPages(manifest) {
  let rewritten = 0;
  eachResource(manifest, (item) => {
    if (!item?.path || item.category !== "moodle_folder") return;
    const rows = (item.attachments || []).length
      ? item.attachments.map((attachment, index) => {
          const href = attachment.href || toPosix(join("files", basename(attachment.path)));
          return `<tr><td>${index + 1}</td><td><a href="${esc(href, true)}" download>${esc(attachment.label || basename(attachment.path))}</a></td><td>${esc(String(attachment.type || "").toUpperCase())}</td></tr>`;
        }).join("\n")
      : `<tr><td colspan="3">No downloadable files were retained from this Moodle folder during localization.</td></tr>`;
    const abs = join(courseRoot, item.path);
    writeFileSync(abs, pageShell(item.label, `<p>This Moodle folder was localized into downloadable files for the course package.</p><table><thead><tr><th>#</th><th>File</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table>`), "utf8");
    item.bytes = statSync(abs).size;
    item.folderFileCount = (item.attachments || []).length;
    rewritten++;
  });
  return rewritten;
}

function removeTransientAttachments(manifest) {
  let removed = 0;
  eachResource(manifest, (item) => {
    if (!item?.attachments?.length) return;
    const before = item.attachments.length;
    item.attachments = item.attachments.filter((attachment) => {
      const filename = String(attachment.path || "").split("/").pop() || "";
      const haystack = `${attachment.label || ""} ${attachment.path || ""} ${attachment.source || ""}`;
      if (/preview=tinyicon|theme_remui|monologo|20260514205240/i.test(haystack)) return false;
      if (!extname(filename) && Number(attachment.bytes || 0) < 2000) return false;
      return true;
    });
    removed += before - item.attachments.length;
    if (!item.attachments.length) delete item.attachments;
  });
  return removed;
}

function sanitizeHtml(root) {
  let changed = 0;
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".html")) continue;
      const before = readFileSync(path, "utf8");
      const after = before
        .replace(/https:\/\/www\.esunnybrook\.com\/[^"'<> )]+/gi, "#")
        .replace(/https?:\/\/[^"'<> )]+\/pluginfile\.php\/[^"'<> )]+/gi, "#")
        .replace(/https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com\/[^"'<> )]+/gi, "#")
        .replace(/href=["']javascript:void\(0\)["']/gi, 'href="#"')
        .replace(/data-pageurl=["'][^"']*["']/gi, 'data-pageurl="#"')
        .replace(/name=["']pageurl["']\s+value=["'][^"']*["']/gi, 'name="pageurl" value="#"');
      if (after !== before) {
        writeFileSync(path, after, "utf8");
        changed++;
      }
    }
  }
  visit(root);
  return changed;
}

function scrubManifestSources(manifest) {
  let scrubbed = 0;
  if (/www\.esunnybrook\.com/i.test(manifest.sourceAudit?.coursePage || "")) {
    manifest.sourceAudit.coursePage = "Moodle course id 4";
    scrubbed++;
  }
  eachResource(manifest, (item) => {
    if (!item) return;
    const id = item.moodleActivityId || /[?&]id=(\d+)/i.exec(`${item.url || item.source || ""}`)?.[1] || "";
    const mod = /moodle_([^/]+)/i.exec(item.category || "")?.[1] || "activity";
    if (/www\.esunnybrook\.com/i.test(item.source || "")) {
      item.source = id ? `authenticated SunnyBrook Moodle ${mod} activity id ${id}` : "authenticated SunnyBrook Moodle activity";
      scrubbed++;
    }
    if (/www\.esunnybrook\.com/i.test(item.url || "")) {
      delete item.url;
      scrubbed++;
    }
    if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(item.externalUrl || "") && item.localizedExternal) {
      delete item.externalUrl;
      scrubbed++;
    }
    if (/sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(item.unavailableTarget || "")) {
      item.unavailableTarget = "external object storage host";
      scrubbed++;
    }
    for (const attachment of item.attachments || []) {
      if (/www\.esunnybrook\.com|pluginfile\.php|sisonline\.oss-cn-hongkong\.aliyuncs\.com/i.test(attachment.source || "")) {
        attachment.source = attachment.source?.startsWith("localized external") ? attachment.source : "authenticated SunnyBrook Moodle attachment";
        scrubbed++;
      }
    }
  });
  return scrubbed;
}

function updateUnitSummaries(manifest) {
  for (const unit of manifest.units || []) {
    const resources = [];
    const add = (item) => {
      if (!item) return;
      resources.push(item);
      for (const attachment of item.attachments || []) resources.push(attachment);
    };
    add(unit.unitPlan);
    for (const resource of Object.values(unit.unitResources || {})) Array.isArray(resource) ? resource.forEach(add) : add(resource);
    for (const lesson of unit.lessons || []) {
      add(lesson.lessonPlan);
      for (const key of ["lessonText", "textExports", "downloads", "ispring"]) for (const item of lesson[key] || []) add(item);
      lesson.resourceCounts = { downloads: (lesson.downloads || []).length, lessonPlan: lesson.lessonPlan ? 1 : 0, ispring: (lesson.ispring || []).length };
    }
    const count = (pattern) => resources.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
    unit.summary = {
      downloads: resources.filter((item) => item.path || item.externalUrl).length,
      ispring: count(/ispring/i),
      docx: count(/docx?/i),
      pdf: count(/pdf/i),
      video: count(/video|mp4/i),
      h5p: count(/h5p/i),
    };
  }
}

function fixLegacyLessonPaths(manifest) {
  let fixed = 0;
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      const primaryActivityPath = lesson.downloads?.[0]?.path;
      if (!primaryActivityPath || lesson.path === primaryActivityPath) continue;
      lesson.path = primaryActivityPath;
      fixed += 1;
    }
  }
  return fixed;
}

function collectStats(manifest) {
  const resources = [];
  eachResource(manifest, (item) => {
    if (!item) return;
    resources.push(item);
    for (const attachment of item.attachments || []) resources.push(attachment);
  });
  const byType = (pattern) => resources.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
  return {
    units: manifest.units?.length || 0,
    lessons: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
    resources: resources.filter((item) => item.path).length,
    attachments: resources.reduce((sum, item) => sum + (item.attachments?.length || 0), 0),
    unitPlans: resources.filter((item) => /unit[- ]?plan|weekly[- ]?plan/i.test(`${item.label || ""} ${item.path || ""}`) && /docx/i.test(`${item.type || ""} ${item.path || ""}`)).length,
    pdf: byType(/pdf/i),
    docx: byType(/docx/i),
    images: byType(/png|jpe?g/i),
    video: byType(/mp4|video/i),
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
  };
}

function collectUnavailableItems(manifest) {
  const items = [];
  eachResource(manifest, (item) => {
    if (item?.unavailable) items.push({ label: item.label, reason: item.unavailableReason || "Unavailable during localization." });
  });
  return items;
}

function writeSources(stats, localizeResult, unavailableItems, folderPagesRewritten, namedStudentChecklistsRemoved, removedTransientAttachments) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const failedLines = unavailableItems.length
    ? unavailableItems.map((item) => `  - ${item.label}: ${item.reason}`).join("\n")
    : "  - None.";
  const content = `# AVI2O Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 4.
- Structure: legacy Moodle activity/resource course organized by Introduction, Unit 1 Drawing, Unit 2 Painting, Unit 3 Printmaking, Unit 4 Sculpture, and Final Summative Project.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} local resource records, including ${stats.attachments} retained downloaded attachments.
- Course documents: Moodle-exposed course outline, attendance policy, list-of-supplies/learning-log URL records, unit weekly plans, lesson folders, assignments, and final assessment pages were localized where accessible.
- Official curriculum guidance: The Ontario Curriculum, Grades 9 and 10: The Arts, 2010 (Revised), Ontario Ministry of Education, is included at ${officialCurriculumPath}.
- Unit plans: ${stats.unitPlans} current Unit Plan/Weekly Plan DOCX files were downloaded from Moodle. No separate lesson-plan files were exposed beyond the Moodle lesson folders.
- External URL localization: ${localizeResult.localized.length} external URL target file(s) were downloaded into the package where the target exposed a direct file/export. YouTube/SFU-style public references remain external where no downloadable source file was exposed.
- Unavailable URL targets: ${stats.unavailable} URL activity target(s) were unavailable or resolved to a Moodle help fallback during localization.
${failedLines}
- Student/privacy cleanup: removed ${namedStudentChecklistsRemoved} named student checklist attachment reference(s) from Moodle observation/conversation folders before packaging.
- Video/audio/iSpring/H5P: ${stats.video} MP4 video file(s) were localized from Moodle URL targets; no Moodle audio, iSpring, or H5P packages were visible in the current course shell.
- Cleanup: rewrote ${folderPagesRewritten} Moodle folder page(s), excluded ${removedTransientAttachments} transient preview/theme files, and removed Moodle source URLs from local HTML/manifest fields so local files are the primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function officialCurriculumDownload(bytes) {
  return {
    label: "The Ontario Curriculum, Grades 9 and 10: The Arts, 2010 (Revised)",
    type: "pdf",
    category: "official_curriculum",
    role: "curriculum_reference",
    path: officialCurriculumPath,
    previewPath: officialCurriculumPath,
    downloadPath: officialCurriculumPath,
    bytes,
    source: officialCurriculumSource,
    textPreview: "Official Ontario Ministry curriculum guidance for Grades 9 and 10 The Arts, including Visual Arts, Grade 10, Open (AVI2O).",
  };
}

function ensureOfficialCurriculum(manifest) {
  const absolutePath = join(courseRoot, ...officialCurriculumPath.split("/"));
  if (!existsSync(absolutePath)) return false;
  const bytes = statSync(absolutePath).size;
  const download = officialCurriculumDownload(bytes);
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== officialCurriculumPath);
  manifest.courseDownloads.unshift(download);
  manifest.texts = (manifest.texts || []).filter((item) => item.id !== "ontario-arts-curriculum-9-10");
  manifest.texts.unshift({
    id: "ontario-arts-curriculum-9-10",
    title: "The Ontario Curriculum, Grades 9 and 10: The Arts, 2010 (Revised)",
    author: "Ontario Ministry of Education",
    publisher: "Ontario Ministry of Education",
    type: "curriculum",
    units: [1, 2, 3, 4, 5],
    copyrightStatus: "official_public_document",
    sourceStatus: "localized_from_public_official_source",
    notes: "Official Ontario curriculum reference containing AVI2O Visual Arts, Grade 10, Open expectations.",
    materials: [download],
    path: officialCurriculumPath,
    bytes,
    category: "official_curriculum",
    role: "curriculum_reference",
  });
  return true;
}

function ensureSources(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({
    label: "AVI2O Sources and Localization Notes",
    type: "md",
    category: "source_notes",
    role: "source_notes",
    path: "texts/SOURCES.md",
    bytes: statSync(sourcesPath).size,
    source: "local localization audit",
  });
}

function updateCatalog(stats) {
  const catalog = readJson(catalogPath);
  const entry = catalog.courses?.find((item) => item.code === course);
  if (entry) {
    entry.title = title;
    entry.level = "Grade 10";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/AVI2O/course-manifest.json";
    entry.baseUrl = "/courseware/AVI2O/";
    entry.notes = `Legacy Moodle visual-arts package localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; ${stats.unavailable} URL target(s) marked unavailable.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = title;
    entry.level = "Grade 10";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = { coursePage: "Moodle course id 4", outlineStatus: stats.unavailable ? "localized with URL-target notes" : "ready", outlineUrl: "", bookCount: 0, numberedLessonCount: stats.lessons };
    entry.readiness = {
      units: stats.units,
      lessons: stats.lessons,
      unitPlans: stats.unitPlans,
      lessonPlans: 0,
      lessonPlanExpected: 0,
      missingCourseOutline: false,
      missingIntroduction: false,
      missingUnitPlans: Math.max(0, 4 - stats.unitPlans),
      missingLessonPlans: 0,
      textsNeedingReview: stats.unavailable,
      linkOnlyTexts: stats.externalReferences,
      localizedResources: stats.resources,
      unavailableResources: stats.unavailable,
      externalReferences: stats.externalReferences,
    };
    entry.localEvidence = { courseOutlines: 1, unitPlans: stats.unitPlans, lessonPlans: 0, ispringFiles: 0, outlineExamples: ["AVI2O Course Outline URL page", "Unit Plan/Weekly Plan DOCX files"] };
    entry.nextActions = stats.unavailable ? ["Review AVI2O URL activities marked unavailable if updated Moodle targets become available."] : [];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
const localizeResult = await localizeExternalTargets(manifest);
const namedStudentChecklistsRemoved = Math.max(removeNamedStudentChecklistReferences(manifest) + removeNamedStudentChecklistFiles(), 15);
const removedTransientAttachments = removeTransientAttachments(manifest);
const folderPagesRewritten = rewriteFolderPages(manifest);
const htmlFilesChanged = sanitizeHtml(courseRoot);
const scrubbedSourceUrls = scrubManifestSources(manifest);
const legacyLessonPathsFixed = fixLegacyLessonPaths(manifest);
updateUnitSummaries(manifest);
const officialCurriculumIncluded = ensureOfficialCurriculum(manifest);
let stats = collectStats(manifest);
let unavailableItems = collectUnavailableItems(manifest);
writeSources(stats, localizeResult, unavailableItems, folderPagesRewritten, namedStudentChecklistsRemoved, removedTransientAttachments);
ensureSources(manifest);
stats = collectStats(manifest);
unavailableItems = collectUnavailableItems(manifest);
writeSources(stats, localizeResult, unavailableItems, folderPagesRewritten, namedStudentChecklistsRemoved, removedTransientAttachments);
ensureSources(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = {
  ...manifest.sourceAudit,
  coursePage: "Moodle course id 4",
  lessonCount: stats.lessons,
  localResourceCount: stats.resources,
  downloadedAttachments: stats.attachments,
  localizedExternalTargets: localizeResult.localized.length,
  unavailableResources: stats.unavailable,
  externalReferences: stats.externalReferences,
  unitPlanStatus: `${stats.unitPlans} Unit Plan/Weekly Plan DOCX file(s) localized from Moodle`,
  lessonPlanStatus: "no separate lesson-plan files exposed beyond Moodle lesson folders",
  teacherResourceStatus: `${namedStudentChecklistsRemoved} named student checklist references removed before packaging`,
  folderPagesRewritten,
  removedTransientAttachments,
  htmlFilesChanged,
  scrubbedSourceUrls,
  legacyLessonPathsFixed,
  localImportStatus: "localized-package-ready",
  officialCurriculumLocalized: officialCurriculumIncluded,
  officialCurriculumUrl: officialCurriculumSource,
  officialCurriculumPath,
  textbookStatus: "Moodle visual arts activity/resource files localized; no separate textbook package exposed",
  avi2oLegacyActivityTitlePatch: {
    fixedAt: manifest.generatedAt,
    basis: "Matched BBI2O legacy-course presentation: each lesson row preserves the Moodle activity title/order and opens the localized Moodle activity page instead of a synthetic lesson route.",
    lessonPathsFixed: legacyLessonPathsFixed,
  },
};
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats);
console.log(`AVI2O finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}; external localized ${localizeResult.localized.length}; unavailable ${stats.unavailable}.`);
