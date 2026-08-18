import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = safeCourse(readArg("--course"));
if (!course) {
  console.error("Usage: node scripts/download-moodle-h5pactivity-packages.mjs --course COURSE");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const outDir = join(courseRoot, "localized-moodle", "h5p-activity");
const reportPath = join(projectRoot, "deployment", `${course}-h5pactivity-package-download-report.json`);

loadEnvFile(join(projectRoot, ".env"));

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
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

function slugify(value) {
  return (
    String(value || "h5p")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "h5p"
  );
}

function collectItems(manifest) {
  const items = [];
  for (const item of manifest.courseDownloads || []) items.push({ item });
  for (const unit of manifest.units || []) {
    for (const resource of Object.values(unit.unitResources || {})) {
      if (Array.isArray(resource)) {
        for (const item of resource) items.push({ unit, item });
      } else if (resource) {
        items.push({ unit, item: resource });
      }
    }
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) items.push({ unit, lesson, item });
    }
  }
  return items.filter(({ item }) => item?.category === "moodle_h5pactivity" || /\/mod\/h5pactivity\/view\.php/i.test(item?.url || item?.source || ""));
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

const jar = new CookieJar(process.env.STMARY_MOODLE_COOKIE || process.env.MOODLE_COOKIE || "");

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-h5pactivity-package-downloader/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

function determineMoodleBaseUrl(owners) {
  const explicit = process.env.STMARY_MOODLE_BASE_URL || process.env.MOODLE_BASE_URL || "";
  if (explicit) return explicit.replace(/\/+$/, "");
  const source = owners.map(({ item }) => item?.url || item?.source || "").find(Boolean);
  if (!source) return "https://www.esunnybrook.com";
  const parsed = new URL(source);
  return `${parsed.protocol}//${parsed.host}`;
}

async function loginIfNeeded(baseUrl) {
  if (process.env.STMARY_MOODLE_COOKIE || process.env.MOODLE_COOKIE) return;
  const host = new URL(baseUrl).host;
  const isStMary = host === "34.30.231.58" || /stmary/i.test(host);
  const username = (isStMary ? process.env.STMARY_MOODLE_USERNAME : "") || process.env.MOODLE_USERNAME;
  const password = (isStMary ? process.env.STMARY_MOODLE_PASSWORD : "") || process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD, or STMARY_MOODLE_USERNAME/STMARY_MOODLE_PASSWORD for the St. Mary Moodle.");
  const loginUrl = new URL("/login/index.php", baseUrl).toString();
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error("Moodle login failed.");
}

function decodeEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("\\/", "/")
    .replaceAll("\\u0026", "&");
}

function extractPackageUrl(html, baseUrl) {
  const decoded = decodeEntities(html);
  const direct = decoded.match(/https?:\/\/[^"'<>\s]+\/pluginfile\.php\/[^"'<>\s]+?\.h5p/i)
    || decoded.match(/\/pluginfile\.php\/[^"'<>\s]+?\.h5p/i);
  if (direct) return new URL(direct[0], baseUrl).toString();
  const embedded = decoded.match(/https?:\/\/[^"'<>\s]+\/h5p\/embed\.php\?url=([^"'<>\s&]+)/i)
    || decoded.match(/\/h5p\/embed\.php\?url=([^"'<>\s&]+)/i);
  if (embedded) {
    const nested = decodeURIComponent(embedded[1]);
    if (/\.h5p/i.test(nested)) return new URL(nested, baseUrl).toString();
  }
  const edit = decoded.match(/\/h5p\/edit\.php\?url=([^"'<>\s&]+)/i);
  if (edit) {
    const nested = decodeURIComponent(edit[1]);
    if (/\.h5p/i.test(nested)) return new URL(nested, baseUrl).toString();
  }
  return "";
}

function filenameFromHeaders(url, headers, fallback) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fromHeader = utfName || plainName;
  if (fromHeader) return decodeURIComponent(fromHeader);
  const fromUrl = decodeURIComponent(basename(new URL(url).pathname));
  return fromUrl && fromUrl !== "pluginfile.php" ? fromUrl : fallback;
}

function titleFromPage(html, item, owner) {
  return (
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    || item.label
    || owner.lesson?.id
    || "H5P Activity"
  );
}

function validateH5p(buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("downloaded H5P is not a ZIP package");
}

const manifest = readJson(manifestPath);
const owners = collectItems(manifest);
const downloaded = [];
const failures = [];
mkdirSync(outDir, { recursive: true });

const moodleBaseUrl = determineMoodleBaseUrl(owners);
await loginIfNeeded(moodleBaseUrl);

for (const owner of owners) {
  const sourceUrl = owner.item.url || owner.item.source;
  try {
    const page = await request(sourceUrl);
    const html = await page.text();
    if (!page.ok) throw new Error(`activity HTTP ${page.status}`);
    const packageUrl = extractPackageUrl(html, sourceUrl);
    if (!packageUrl) throw new Error("missing H5P package URL");
    const response = await request(packageUrl);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`package HTTP ${response.status}`);
    validateH5p(buffer);
    const title = titleFromPage(html, owner.item, owner);
    const filename = filenameFromHeaders(response.url || packageUrl, response.headers, `${slugify(title)}.h5p`);
    const targetName = `${hashText(packageUrl)}-${slugify(filename.replace(/\.h5p$/i, ""))}.h5p`;
    const targetPath = join(outDir, targetName);
    if (!existsSync(targetPath)) writeFileSync(targetPath, buffer);
    const relPath = toPosix(relative(courseRoot, targetPath));
    owner.item.label = owner.item.label || title;
    owner.item.type = "h5p";
    owner.item.category = "moodle_h5pactivity";
    owner.item.role = owner.item.role || "exit_card";
    owner.item.path = relPath;
    owner.item.bytes = statSync(targetPath).size;
    owner.item.source = sourceUrl;
    owner.item.packageSource = packageUrl;
    owner.item.previewPath = relPath.replace(/\.h5p$/i, "/index.html");
    delete owner.item.url;
    downloaded.push({ lesson: owner.lesson?.id || "", label: owner.item.label, path: relPath, bytes: owner.item.bytes, packageUrl });
  } catch (error) {
    failures.push({ lesson: owner.lesson?.id || "", label: owner.item.label, sourceUrl, error: error?.message || String(error) });
  }
}

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    lesson.resourceCounts ||= {};
    lesson.resourceCounts.downloads = lesson.downloads?.length || 0;
    lesson.resourceCounts.h5p = (lesson.downloads || []).filter((item) => item.type === "h5p").length;
  }
  unit.summary ||= {};
  unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0)
    + Object.values(unit.unitResources || {}).flat().length;
  unit.summary.h5p = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads || []).filter((item) => item.type === "h5p").length, 0);
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.h5pActivityExpected = owners.length;
manifest.sourceAudit.h5pActivityLocalized = downloaded.length;
manifest.sourceAudit.h5pActivityFailed = failures.length;
manifest.generatedAt = new Date().toISOString();

writeJson(manifestPath, manifest);
writeJson(reportPath, {
  generatedAt: new Date().toISOString(),
  course,
  expected: owners.length,
  downloaded,
  failures,
});

console.log(JSON.stringify({
  course,
  expected: owners.length,
  downloaded: downloaded.length,
  failures: failures.length,
  reportPath: toPosix(relative(projectRoot, reportPath)),
}, null, 2));

if (failures.length) process.exitCode = 1;
