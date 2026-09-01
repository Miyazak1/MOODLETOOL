import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const deploymentRoot = join(projectRoot, "deployment");
const queuePath = readArg("--queue") ? resolve(projectRoot, readArg("--queue")) : join(deploymentRoot, "moodle-media-localization-queue.json");

loadEnvFile(join(projectRoot, ".env"));

const courseArg = readArg("--course")?.toUpperCase();
const kindArg = readArg("--kind")?.toLowerCase();
const dryRun = process.argv.includes("--dry-run");
const applyHtml = process.argv.includes("--apply-html");
const applyManifest = process.argv.includes("--apply-manifest");
const force = process.argv.includes("--force");
const limitArg = Number(readArg("--limit") || 0);
const startArg = Math.max(0, Number(readArg("--start") || 0));
const cookieHeader = process.env.MOODLE_COOKIE || "";
const maxRetries = Math.max(1, Number(process.env.MOODLE_DOWNLOAD_RETRIES || 4));
const requestTimeoutMs = Math.max(10000, Number(process.env.MOODLE_DOWNLOAD_TIMEOUT_MS || 120000));

if (process.argv.includes("--help")) {
  console.log(`Usage: node scripts/download-moodle-media-localization-queue.mjs [--course COURSE] [--kind KIND] [--start N] [--limit N] [--dry-run] [--force] [--apply-html] [--apply-manifest]

Downloads authenticated Moodle resources listed in deployment/moodle-media-localization-queue.json.

Environment:
  MOODLE_COOKIE      Optional full Cookie header, for example MoodleSession=...
  MOODLE_USERNAME    Optional Moodle username, used when MOODLE_COOKIE is not set
  MOODLE_PASSWORD    Optional Moodle password, used when MOODLE_COOKIE is not set

Notes:
  --apply-html rewrites downloaded Moodle URLs in local copied HTML to local courseware paths.
  --apply-manifest adds the downloaded resources to the matching lesson downloads.
`);
  process.exit(0);
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

function errorDetails(error) {
  const parts = [String(error?.message || error)];
  if (error?.cause?.message) parts.push(`cause: ${error.cause.message}`);
  if (error?.cause?.code) parts.push(`code: ${error.cause.code}`);
  return parts.join("; ");
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function stripQuery(url) {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function nestedH5pPackageUrl(url) {
  const parsed = new URL(url);
  const nested = parsed.searchParams.get("url");
  if (!nested || !nested.includes(".h5p")) return "";
  return nested;
}

function effectiveDownloadUrl(item) {
  if (item.kind === "h5p") {
    const nested = nestedH5pPackageUrl(item.url);
    if (nested) return nested;
  }
  return item.url;
}

function normalizedUrlVariants(url) {
  const variants = new Set([url, url.replaceAll("&", "&amp;")]);
  try {
    variants.add(stripQuery(url));
    variants.add(stripQuery(url).replaceAll("&", "&amp;"));
  } catch {
    // Keep the original URL variants when URL parsing fails.
  }
  return [...variants].filter(Boolean);
}

function filenameFromHeaders(url, headers, fallbackPath) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fromHeader = utfName || plainName;
  if (fromHeader) return decodeURIComponent(fromHeader);
  const fromUrl = decodeURIComponent(basename(new URL(url).pathname));
  if (fromUrl && fromUrl !== "pluginfile.php" && fromUrl !== "embed.php") return fromUrl;
  return basename(fallbackPath);
}

function extensionFor(item, filename, contentType) {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (item.kind === "video") return "mp4";
  if (item.kind === "h5p") return "h5p";
  if (/pdf/i.test(contentType)) return "pdf";
  if (/wordprocessingml/i.test(contentType)) return "docx";
  if (/msword/i.test(contentType)) return "doc";
  return "bin";
}

function targetFilenameFor(item, filename, contentType) {
  const suggestedName = basename(item.suggestedPath);
  const suggestedExt = extname(suggestedName);
  const ext = extensionFor(item, filename, contentType);
  if (suggestedExt.toLowerCase() === `.${ext}`) return suggestedName;
  return `${suggestedName.slice(0, suggestedName.length - suggestedExt.length)}.${ext}`;
}

function localRecordType(item, filename, contentType) {
  const ext = extensionFor(item, filename, contentType);
  if (item.kind === "video") return "mp4";
  if (item.kind === "h5p") return "h5p";
  return ext;
}

function assertCoursePath(courseRoot, relPath) {
  const target = resolve(courseRoot, relPath);
  const root = resolve(courseRoot);
  if (!target.startsWith(root)) throw new Error(`Unsafe target path: ${relPath}`);
  return target;
}

function isLoginHtml(buffer, contentType, finalUrl) {
  const probe = buffer.subarray(0, Math.min(buffer.length, 1200)).toString("utf8");
  return (
    /text\/html/i.test(contentType) &&
    (/\/login\/index\.php/i.test(finalUrl) || /name=["']username["']|name=["']password["']|登录网站|logintoken/i.test(probe))
  );
}

function validateSignature(item, filename, buffer, contentType) {
  const type = extensionFor(item, filename, contentType);
  const startsWithPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const startsWithPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const startsWithMp4 =
    buffer.length > 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70;
  if (["docx", "xlsx", "pptx", "h5p"].includes(type) && !startsWithPk) {
    throw new Error(`downloaded ${type} is not a ZIP package`);
  }
  if (type === "pdf" && !startsWithPdf) {
    throw new Error("downloaded file is not a PDF");
  }
  if (type === "mp4" && !startsWithMp4 && !/video\/mp4/i.test(contentType)) {
    throw new Error("downloaded file is not an MP4");
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
      for (const cookieText of splitSetCookie(value)) {
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

function splitSetCookie(value) {
  if (!value) return [];
  return String(value).split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim()).filter(Boolean);
}

const jar = new CookieJar(cookieHeader);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableError(error) {
  const code = error?.cause?.code || error?.code || "";
  return ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code)
    || /fetch failed|network|timeout|socket|terminated/i.test(String(error?.message || error));
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-moodle-media-import/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  let response;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${requestTimeoutMs}ms`)), requestTimeoutMs);
    try {
      response = await fetch(url, {
        ...options,
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
      break;
    } catch (error) {
      if (attempt >= maxRetries || !isRetriableError(error)) throw error;
      await sleep(750 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    const next = new URL(response.headers.get("location"), url).toString();
    const originalMethod = options.method || "GET";
    const method = [301, 302, 303].includes(response.status) && originalMethod !== "GET" ? "GET" : originalMethod;
    return request(next, { ...options, method, body: method === "GET" ? undefined : options.body }, redirects + 1);
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
  if (!username || !password) {
    throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD before running without --dry-run.");
  }
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
    throw new Error("Moodle login failed; check MOODLE_USERNAME/MOODLE_PASSWORD.");
  }
  return { loggedIn: true, reason: "credentials" };
}

async function downloadItem(item) {
  const courseRoot = join(coursewareRoot, item.course);
  const downloadUrl = effectiveDownloadUrl(item);
  const response = await request(downloadUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (isLoginHtml(buffer, contentType, response.url || downloadUrl)) {
    throw new Error("download returned Moodle login page");
  }

  const filename = filenameFromHeaders(response.url || downloadUrl, response.headers, item.suggestedPath);
  const folder = dirname(item.suggestedPath);
  const relativePath = toPosix(join(folder, targetFilenameFor(item, filename, contentType)));
  const targetPath = assertCoursePath(courseRoot, relativePath);
  validateSignature(item, filename, buffer, contentType);

  if (!force && existsSync(targetPath)) {
    return {
      ...item,
      status: "skipped",
      reason: "target-exists",
      downloadUrl,
      path: relativePath,
      bytes: statSync(targetPath).size,
      contentType,
      filename,
      type: localRecordType(item, filename, contentType),
    };
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, buffer);
  return {
    ...item,
    status: "downloaded",
    downloadUrl,
    path: relativePath,
    bytes: buffer.length,
    contentType,
    filename,
    type: localRecordType(item, filename, contentType),
  };
}

function linkPath(fromHtmlPath, targetPath) {
  const fromDir = dirname(fromHtmlPath);
  return toPosix(relative(fromDir, targetPath)) || basename(targetPath);
}

function replaceAllLiteral(input, search, replacement) {
  return input.split(search).join(replacement);
}

function patchHtml(downloads) {
  const byHtml = new Map();
  for (const item of downloads) {
    if (!item.path) continue;
    const key = `${item.course}|${item.htmlPath}`;
    const list = byHtml.get(key) || [];
    list.push(item);
    byHtml.set(key, list);
  }

  const patched = [];
  for (const [key, items] of byHtml.entries()) {
    const [course, htmlPath] = key.split("|");
    const courseRoot = join(coursewareRoot, course);
    const absoluteHtmlPath = join(courseRoot, htmlPath);
    if (!existsSync(absoluteHtmlPath)) continue;
    let html = readFileSync(absoluteHtmlPath, "utf8");
    let changes = 0;
    for (const item of items) {
      const replacement = linkPath(htmlPath, item.path);
      const sourceUrls = new Set([...normalizedUrlVariants(item.url), ...normalizedUrlVariants(item.downloadUrl || "")].filter(Boolean));
      for (const sourceUrl of sourceUrls) {
        const before = html;
        html = replaceAllLiteral(html, sourceUrl, replacement);
        html = replaceAllLiteral(html, sourceUrl.replaceAll("&", "&amp;"), replacement);
        if (html !== before) changes += 1;
      }
      if (item.attr === "data-moodle-source" && !item.active) {
        html = html.replaceAll(`data-moodle-source="${replacement}"`, `href="${replacement}"`);
        html = html.replaceAll(`data-moodle-source='${replacement}'`, `href='${replacement}'`);
      }
    }
    if (changes) {
      writeFileSync(absoluteHtmlPath, html, "utf8");
      patched.push({ course, htmlPath, changes });
    }
  }
  return patched;
}

function roleFromItem(item) {
  const label = String(item.label || "").toLowerCase();
  if (label.includes("hands on")) return "hands_on";
  if (label.includes("consolidation")) return "consolidation";
  if (label.includes("homework")) return "homework";
  if (label.includes("lesson expectations")) return "lesson_expectations";
  if (label.includes("lesson")) return "lesson";
  if (item.kind === "video") return "consolidation";
  if (item.kind === "h5p") return "hands_on";
  return "lesson_attachment";
}

function patchManifests(downloads) {
  const byCourse = new Map();
  for (const item of downloads) {
    if (!item.path) continue;
    const list = byCourse.get(item.course) || [];
    list.push(item);
    byCourse.set(item.course, list);
  }

  const patched = [];
  for (const [course, items] of byCourse.entries()) {
    const manifestPath = join(coursewareRoot, course, "course-manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    let changed = 0;
    for (const item of items) {
      const unit = (manifest.units || []).find((entry) => Number(entry.unit) === Number(item.unit));
      const lessonNumber = Number(String(item.lesson || "").match(/L(\d+)$/i)?.[1] || 0);
      const lesson = unit?.lessons?.find((entry) => Number(entry.lesson) === lessonNumber);
      if (!lesson) continue;
      const record = {
        label: `${item.kind.toUpperCase()} - ${item.filename}`,
        type: item.type,
        category: "localized_moodle_resource",
        role: roleFromItem(item),
        path: item.path,
        bytes: item.bytes,
        source: item.url,
      };
      lesson.downloads = lesson.downloads || [];
      const existingIndex = lesson.downloads.findIndex((resource) => resource.path === record.path || resource.source === record.source);
      if (existingIndex >= 0) {
        lesson.downloads[existingIndex] = { ...lesson.downloads[existingIndex], ...record };
      } else {
        lesson.downloads.push(record);
      }
      lesson.resourceCounts = lesson.resourceCounts || {};
      lesson.resourceCounts.downloads = lesson.downloads.length;
      if (item.kind === "video") lesson.resourceCounts.video = (lesson.downloads || []).filter((resource) => resource.type === "mp4").length;
      if (item.kind === "h5p") lesson.resourceCounts.h5p = (lesson.downloads || []).filter((resource) => resource.type === "h5p").length;
      changed += 1;
    }
    for (const unit of manifest.units || []) {
      unit.summary = unit.summary || {};
      unit.summary.downloads = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.downloads?.length || 0), 0);
      unit.summary.video = (unit.lessons || []).reduce(
        (sum, lesson) => sum + (lesson.downloads || []).filter((resource) => resource.type === "mp4").length,
        0,
      );
      unit.summary.h5p = (unit.lessons || []).reduce(
        (sum, lesson) => sum + (lesson.downloads || []).filter((resource) => resource.type === "h5p").length,
        0,
      );
    }
    if (changed) {
      manifest.generatedAt = new Date().toISOString();
      writeJson(manifestPath, manifest);
      patched.push({ course, changed });
    }
  }
  return patched;
}

if (!existsSync(queuePath)) {
  console.error(`Missing queue: ${queuePath}. Run npm.cmd run export:moodle-media-localization-queue first.`);
  process.exit(1);
}

let rows = readJson(queuePath).items || [];
if (courseArg) rows = rows.filter((item) => item.course === courseArg);
if (kindArg) rows = rows.filter((item) => item.kind === kindArg);
if (startArg > 0) rows = rows.slice(startArg);
if (limitArg > 0) rows = rows.slice(0, limitArg);

const report = {
  generatedAt: new Date().toISOString(),
  queue: queuePath,
  course: courseArg || null,
  dryRun,
  applyHtml,
  applyManifest,
  force,
  moodleCookieConfigured: Boolean(cookieHeader),
  rows,
  downloads: [],
  failures: [],
  htmlPatched: [],
  manifestPatched: [],
};

if (!rows.length) {
  console.log("No Moodle media localization rows matched.");
} else if (dryRun) {
  console.log(`Moodle media localization dry run: ${rows.length} row(s).`);
} else {
  try {
    report.auth = await loginIfNeeded();
    for (const row of rows) {
      try {
        const result = await downloadItem(row);
        report.downloads.push(result);
        console.log(`${result.status === "skipped" ? "Skipped" : "Downloaded"} ${row.course} ${row.lesson} ${row.kind}: ${result.path}`);
      } catch (error) {
        const failure = { ...row, status: "failed", error: errorDetails(error) };
        report.failures.push(failure);
        console.error(`Failed ${row.course} ${row.lesson} ${row.kind}: ${failure.error}`);
      }
    }
    const usable = report.downloads.filter((item) => ["downloaded", "skipped"].includes(item.status));
    if (usable.length && applyHtml) report.htmlPatched = patchHtml(usable);
    if (usable.length && applyManifest) report.manifestPatched = patchManifests(usable);
  } catch (error) {
    const message = errorDetails(error);
    for (const row of rows) {
      report.failures.push({ ...row, status: "failed", error: message });
    }
    console.error(message);
  }
}

mkdirSync(deploymentRoot, { recursive: true });
const suffixParts = [];
if (courseArg) suffixParts.push(courseArg);
if (kindArg) suffixParts.push(kindArg);
const suffix = suffixParts.length ? `-${suffixParts.join("-")}` : "";
writeJson(join(deploymentRoot, `moodle-media-download-report${suffix}.json`), report);

const counts = report.downloads.reduce((totals, item) => {
  totals[item.status] = (totals[item.status] || 0) + 1;
  return totals;
}, {});

console.log(
  `Moodle media localization rows ${rows.length}; downloaded ${counts.downloaded || 0}; skipped ${counts.skipped || 0}; failed ${report.failures.length}.`,
);
if (report.failures.length) process.exitCode = 1;
