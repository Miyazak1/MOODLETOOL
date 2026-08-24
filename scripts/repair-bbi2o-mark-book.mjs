import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "BBI2O";
const courseRoot = join(workspaceRoot, "courseware", course);
const stagingRoot = join(projectRoot, "deployment", "course-package-staging", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");
const markBookRel = "localized-moodle-activities/folder/U08L01-6930-6930-44d18d019d/index.html";
const markBookDir = join(courseRoot, dirname(markBookRel));
const filesDir = join(markBookDir, "files");
let activeBaseUrl = "https://www.esunnybrook.com";
let markBookUrl = `${activeBaseUrl}/mod/folder/view.php?id=6930`;
let prefetchedFolderHtml = "";

function loadEnv() {
  const envPath = join(projectRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ||= value;
  }
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sanitizeFilename(value) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, "")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTypeToExt(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("spreadsheet") || type.includes("excel")) return ".xlsx";
  if (type.includes("wordprocessingml") || type.includes("msword")) return ".docx";
  return "";
}

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/login\/index\.php$/i, "")
    .replace(/\/+$/g, "");
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const cookie = headers.get("set-cookie");
  return cookie ? [cookie] : [];
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  ingest(headers) {
    for (const line of getSetCookies(headers)) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  clear() {
    this.cookies.clear();
  }
}

async function request(jar, url, options = {}) {
  const headers = new Headers(options.headers || {});
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(url, { ...options, headers, redirect: "follow" });
  jar.ingest(res.headers);
  return res;
}

function isLoginPage(html) {
  return /name=["']username["']|name=["']password["']|Enter your details to log in|Forgot your password/i.test(html);
}

async function tryLogin(jar, baseUrl, username, password) {
  jar.clear();
  const loginUrl = `${baseUrl}/login/index.php`;
  const get = await request(jar, loginUrl);
  const html = await get.text();
  const token = /name=["']logintoken["']\s+value=["']([^"']+)["']/i.exec(html)?.[1] || "";
  const body = new URLSearchParams({ username, password, anchor: "" });
  if (token) body.set("logintoken", token);
  await request(jar, loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const check = await request(jar, `${baseUrl}/mod/folder/view.php?id=6930`);
  const checkHtml = await check.text();
  if (isLoginPage(checkHtml)) return false;
  if (/data-rel=["']fatalerror["']|Can't find data record|invalidrecordunknown/i.test(checkHtml)) return false;
  if (!/Mark Book|Markbook|Teachers Evaluation For Learning Skills/i.test(checkHtml)) return false;
  prefetchedFolderHtml = checkHtml;
  return true;
}

async function login(jar) {
  const bases = [
    normalizeBaseUrl(process.env.STMARY_MOODLE_BASE_URL),
    normalizeBaseUrl(process.env.MOODLE_BASE_URL),
    "https://www.esunnybrook.com",
  ].filter(Boolean);
  const pairs = [
    [process.env.STMARY_MOODLE_USERNAME, process.env.STMARY_MOODLE_PASSWORD],
    [process.env.MOODLE_USERNAME, process.env.MOODLE_PASSWORD],
  ].filter(([username, password]) => username && password);
  if (!pairs.length) {
    throw new Error("Missing MOODLE_USERNAME/MOODLE_PASSWORD credentials in environment or .env.");
  }
  for (const baseUrl of [...new Set(bases)]) {
    for (const [username, password] of pairs) {
      if (await tryLogin(jar, baseUrl, username, password)) {
        activeBaseUrl = baseUrl;
        markBookUrl = `${activeBaseUrl}/mod/folder/view.php?id=6930`;
        return;
      }
    }
  }
  throw new Error("Moodle login did not succeed with the configured credential pairs.");
}

function extractFileLinks(html) {
  const links = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*href=["']([^"']*pluginfile\.php[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    let href = decodeEntities(match[1]);
    if (href.startsWith("/")) href = `${activeBaseUrl}${href}`;
    if (!/^https?:\/\//i.test(href)) href = new URL(href, markBookUrl).href;
    href = href.replace(/&amp;/g, "&");
    if (!/[?&]forcedownload=1\b/i.test(href)) {
      href += href.includes("?") ? "&forcedownload=1" : "?forcedownload=1";
    }
    const label = sanitizeFilename(match[2]) || sanitizeFilename(decodeURIComponent(new URL(href).pathname.split("/").pop() || ""));
    const key = `${href}|${label}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({ href, label });
    }
  }
  return links.filter((link) => /\.(docx?|xlsx?)$/i.test(link.label) || /\.(docx?|xlsx?)(?:\?|$)/i.test(link.href));
}

async function downloadAttachment(jar, link) {
  const res = await request(jar, link.href);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${link.href}`);
  const contentType = res.headers.get("content-type") || "";
  const buffer = Buffer.from(await res.arrayBuffer());
  if (/text\/html/i.test(contentType) && buffer.toString("utf8", 0, Math.min(buffer.length, 2000)).includes("login")) {
    throw new Error(`Moodle returned a login page for ${link.href}`);
  }
  let filename = sanitizeFilename(link.label);
  if (!extname(filename)) {
    filename += contentTypeToExt(contentType);
  }
  if (!/\.(docx?|xlsx?)$/i.test(filename)) {
    const fromUrl = sanitizeFilename(decodeURIComponent(new URL(link.href).pathname.split("/").pop() || ""));
    if (/\.(docx?|xlsx?)$/i.test(fromUrl)) filename = fromUrl;
  }
  const target = join(filesDir, filename);
  writeFileSync(target, buffer);
  return {
    label: filename,
    type: extname(filename).slice(1).toLowerCase(),
    path: `${dirname(markBookRel).replaceAll("\\", "/")}/files/${filename}`,
    bytes: statSync(target).size,
    source: "authenticated SunnyBrook Moodle attachment",
  };
}

function buildFolderHtml(attachments) {
  const rows = attachments.map((attachment) => {
    const filename = attachment.path.split("/").pop();
    return `          <li>
            <span class="file-label">${htmlEscape(attachment.label)}</span>
            <span class="file-actions"><a class="file-action" href="files/${htmlEscape(filename, true)}">查看</a><a class="file-action" href="files/${htmlEscape(filename, true)}" download>下载</a></span>
        </li>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mark Book</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 14px; }
    h2 { font-size: 20px; margin-top: 24px; }
    a { color: #00396f; font-weight: 700; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 18px; padding-top: 12px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .file-label { overflow-wrap: anywhere; }
    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }
    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }
    .file-action:hover { background: #eef6ff; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>Mark Book</h1>
      <section class="attachments"><h2>Files</h2><ul>
${rows}
      </ul></section>
    </article>
  </main>
</body>
</html>
`;
}

function attachmentsFromLocalFiles() {
  return readdirSync(filesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(docx?|xlsx?)$/i.test(entry.name))
    .map((entry) => {
      const target = join(filesDir, entry.name);
      return {
        label: entry.name,
        type: extname(entry.name).slice(1).toLowerCase(),
        path: `${dirname(markBookRel).replaceAll("\\", "/")}/files/${entry.name}`,
        bytes: statSync(target).size,
        source: "authenticated SunnyBrook Moodle folder download",
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
}

function walkResources(manifest, callback) {
  for (const item of manifest.courseDownloads || []) callback(item);
  for (const text of manifest.texts || []) {
    callback(text);
    for (const material of text.materials || []) callback(material);
  }
  for (const unit of manifest.units || []) {
    callback(unit.unitPlan);
    for (const resource of Object.values(unit.unitResources || {})) {
      if (Array.isArray(resource)) resource.forEach(callback);
      else callback(resource);
    }
    for (const lesson of unit.lessons || []) {
      callback(lesson.lessonPlan);
      for (const item of lesson.lessonText || []) callback(item);
      for (const item of lesson.textExports || []) callback(item);
      for (const item of lesson.downloads || []) callback(item);
      for (const item of lesson.ispring || []) callback(item);
      for (const item of lesson.bookSections || []) callback(item);
    }
  }
}

function collectStats(manifest) {
  const resources = [];
  walkResources(manifest, (item) => {
    if (!item) return;
    resources.push(item);
    for (const attachment of item.attachments || []) resources.push(attachment);
  });
  return {
    units: manifest.units?.length || 0,
    lessons: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
    resources: resources.filter((item) => item.path).length,
    attachments: resources.reduce((sum, item) => sum + (item.attachments?.length || 0), 0),
    unavailable: resources.filter((item) => item.unavailable).length,
    externalReferences: resources.filter((item) => item.externalUrl).length,
  };
}

function updateManifest(attachments) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.units = (manifest.units || []).filter((unit) => unit.title !== "Mark Book" && unit.unit !== 8);

  const markBookResource = {
    label: "Mark Book",
    type: "html",
    category: "moodle_folder",
    role: "teacher_resource",
    source: "authenticated SunnyBrook Moodle folder activity id 6930",
    moodleActivityId: "6930",
    path: markBookRel,
    bytes: statSync(join(courseRoot, markBookRel)).size,
    attachments,
    folderFileCount: attachments.length,
  };

  manifest.units.push({
    unit: 8,
    title: "Mark Book",
    coreTexts: [],
    unitPlan: null,
    unitResources: {},
    summary: {
      downloads: 1,
      ispring: 0,
      docx: attachments.filter((item) => item.type === "docx").length,
      pdf: 0,
      video: 0,
      h5p: 0,
      xlsx: attachments.filter((item) => item.type === "xlsx").length,
      lessons: 1,
    },
    lessons: [
      {
        id: "U08L01-6930",
        unit: 8,
        lesson: 1,
        title: "Mark Book",
        path: markBookRel,
        lessonText: [],
        textExports: [],
        lessonPlan: null,
        ispring: [],
        downloads: [markBookResource],
        resourceCounts: { downloads: 1, lessonPlan: 0, ispring: 0 },
      },
    ],
  });

  manifest.units.sort((a, b) => Number(a.unit || 0) - Number(b.unit || 0));
  const stats = collectStats(manifest);
  manifest.generatedAt = new Date().toISOString();
  manifest.sourceAudit = {
    ...manifest.sourceAudit,
    lessonCount: stats.lessons,
    localResourceCount: stats.resources,
    unavailableResources: stats.unavailable,
    externalReferences: stats.externalReferences,
    downloadedAttachments: stats.attachments,
    excludedAdminLessons: 0,
    excludedAdminNotes: [],
    bbi2oMarkBookRestored: {
      fixedAt: new Date().toISOString(),
      source: "authenticated SunnyBrook Moodle folder activity id 6930",
      path: markBookRel,
      attachments: attachments.length,
    },
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function updateSources(attachments) {
  let text = existsSync(sourcesPath) ? readFileSync(sourcesPath, "utf8") : "# BBI2O Sources and Localization Notes\n";
  text = text.replace(
    /Mark Book remains excluded because Moodle returned a course\/gradebook administration shell rather than downloadable courseware files\./,
    `Mark Book is retained as a localized Moodle folder section with ${attachments.length} downloaded XLSX/DOCX files.`
  );
  if (!/Mark Book is retained as a localized Moodle folder section/.test(text)) {
    text += `\n- Mark Book is retained as a localized Moodle folder section with ${attachments.length} downloaded XLSX/DOCX files.\n`;
  }
  writeFileSync(sourcesPath, text, "utf8");
}

function syncToStaging() {
  const sourceDir = join(courseRoot, dirname(markBookRel));
  const destDir = join(stagingRoot, dirname(markBookRel));
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const stack = [[sourceDir, destDir]];
  while (stack.length) {
    const [src, dst] = stack.pop();
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const from = join(src, entry.name);
      const to = join(dst, entry.name);
      if (entry.isDirectory()) stack.push([from, to]);
      else copyFileSync(from, to);
    }
  }
  mkdirSync(stagingRoot, { recursive: true });
  copyFileSync(manifestPath, join(stagingRoot, "course-manifest.json"));
  mkdirSync(join(stagingRoot, "texts"), { recursive: true });
  copyFileSync(sourcesPath, join(stagingRoot, "texts", "SOURCES.md"));
}

loadEnv();
mkdirSync(filesDir, { recursive: true });

let attachments = [];
if (process.argv.includes("--from-local-files")) {
  attachments = attachmentsFromLocalFiles();
  if (attachments.length < 6) throw new Error(`Expected at least 6 local Mark Book files in ${filesDir}, found ${attachments.length}.`);
} else {
  rmSync(filesDir, { recursive: true, force: true });
  mkdirSync(filesDir, { recursive: true });
  const jar = new CookieJar();
  await login(jar);
  let folderHtml = prefetchedFolderHtml;
  if (!folderHtml) {
    const folderRes = await request(jar, markBookUrl);
    if (!folderRes.ok) throw new Error(`Unable to open Mark Book folder: HTTP ${folderRes.status}`);
    folderHtml = await folderRes.text();
  }
  const links = extractFileLinks(folderHtml);
  if (links.length < 6) {
    writeFileSync(join(projectRoot, "deployment", "bbi2o-mark-book-folder-debug.html"), folderHtml, "utf8");
    throw new Error(`Expected at least 6 Mark Book files, found ${links.length}. Debug HTML was saved under deployment.`);
  }
  for (const link of links) {
    attachments.push(await downloadAttachment(jar, link));
  }
}
writeFileSync(join(courseRoot, markBookRel), buildFolderHtml(attachments), "utf8");
updateManifest(attachments);
updateSources(attachments);
await syncToStaging();

console.log(`BBI2O Mark Book restored: ${attachments.length} files.`);
for (const attachment of attachments) {
  console.log(`- ${attachment.label} (${attachment.bytes} bytes)`);
}
