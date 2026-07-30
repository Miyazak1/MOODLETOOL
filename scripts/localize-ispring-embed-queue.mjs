import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const queuePath = join(projectRoot, "deployment", "moodle-ispring-embed-queue.json");
const reportPath = join(projectRoot, "deployment", "ispring-localization-report.json");
const ua =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const courseArg = readArg("--course")?.toUpperCase();
const limitArg = Number(readArg("--limit") || 0);
const startArg = Math.max(0, Number(readArg("--start") || 0));
const force = process.argv.includes("--force");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
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

function safeSegment(value) {
  return String(value || "item").replace(/[^A-Za-z0-9_.-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "item";
}

function splitSetCookie(value) {
  if (!value) return [];
  return String(value).split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim()).filter(Boolean);
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
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

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", ua);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    const next = new URL(response.headers.get("location"), url).toString();
    const method = [301, 302, 303].includes(response.status) ? "GET" : options.method || "GET";
    return request(next, { ...options, method, body: method === "GET" ? undefined : options.body }, redirects + 1);
  }
  return response;
}

function extractContentId(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/\/embed_player\/([^/?#]+)/) || parsed.pathname.match(/\/embed-player\/([^/?#]+)/);
  if (!match) throw new Error(`Cannot extract iSpring content id from ${url}`);
  return match[1];
}

function parseBffData(html) {
  const match = html.match(/<script id=["']ispring-bff-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return {};
  return JSON.parse(match[1]);
}

async function getEmbedInfo(row) {
  const contentId = extractContentId(row.url);
  const jar = new CookieJar();
  const embedResponse = await request(row.url, {
    headers: { accept: "text/html,application/xhtml+xml", cookie: jar.header() },
  });
  jar.store(embedResponse.headers);
  const html = await embedResponse.text();
  const csrf = html.match(/<meta name=["']csrf-token["'] content=["']([^"']+)/i)?.[1] || "";
  const bff = parseBffData(html);
  const accountID = bff?.environment?.account?.accountID;
  if (!csrf || !accountID) throw new Error(`Missing iSpring csrf/accountID for ${row.lessonId}`);

  const infoResponse = await request(`https://hexstruct.ispring.com/s/embed_player/${contentId}/info`, {
    method: "POST",
    headers: {
      accept: "application/json,*/*",
      "content-type": "application/json",
      "x-requested-with": "FetchApiRequest",
      "x-csrf-token": csrf,
      referer: embedResponse.url || row.url,
      cookie: jar.header(),
    },
    body: "{}",
  });
  jar.store(infoResponse.headers);
  if (!infoResponse.ok) throw new Error(`iSpring info HTTP ${infoResponse.status}`);
  const info = await infoResponse.json();

  const previewResponse = await request(`https://hexstruct.ispring.com/sharing/api/v1/embed_preview/${accountID}/${contentId}/en-US`, {
    method: "POST",
    headers: {
      accept: "application/json,*/*",
      "content-type": "application/json",
      "x-requested-with": "FetchApiRequest",
      authorization: `bearer ${info.authKey}`,
      referer: embedResponse.url || row.url,
      cookie: jar.header(),
    },
    body: "{}",
  });
  if (!previewResponse.ok) throw new Error(`iSpring preview HTTP ${previewResponse.status}`);
  const preview = await previewResponse.json();
  const playerUrl = new URL(preview.playerData?.playerUrl, "https://hexstruct.ispring.com").toString();
  return { contentId, accountID, info, preview, playerUrl };
}

function isTextContent(contentType, pathname) {
  const ext = extname(pathname).toLowerCase();
  return /text|javascript|json|xml|svg/i.test(contentType) || [".html", ".js", ".css", ".json", ".xml", ".svg", ".txt", ".vtt"].includes(ext);
}

function extractAssetUrls(text, baseUrl, packageRootUrl) {
  const found = new Set();
  const normalizedText = String(text || "").replaceAll("\\/", "/").replaceAll('\\"', '"');
  const add = (raw) => {
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("javascript:") || raw.startsWith("#")) return;
    if (/^(mailto|tel):/i.test(raw)) return;
    if (/^https?$/i.test(raw) || raw.endsWith("/https") || raw.endsWith("/http")) return;
    if (/[<>"'{}()[\]+^$\\]/.test(raw)) return;
    try {
      const clean = raw.replace(/&amp;/g, "&");
      const url = new URL(clean, clean.startsWith("data/") ? packageRootUrl : baseUrl);
      if (url.origin === "https://hexstruct.ispring.com") found.add(url.toString());
    } catch {
      // Ignore malformed generated strings.
    }
  };
  for (const match of normalizedText.matchAll(/\b(?:src|href|poster|data)=["']([^"']+)["']/gi)) add(match[1]);
  for (const match of normalizedText.matchAll(/url\((["']?)([^"')]+)\1\)/gi)) add(match[2]);
  for (const match of normalizedText.matchAll(/["']((?:\.\/)?(?:data|assets|content|fonts|res|skin)\/[^"'<>+\[\]{}()]+\.(?:html?|js|css|json|xml|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp3|mp4|webm|wav|ogg|vtt|cur)(?:\?[^"'<>+\[\]{}()]*)?)["']/gi)) {
    add(match[1]);
  }
  return [...found];
}

function extractPresentationInfoAssetUrls(text, baseUrl, packageRootUrl) {
  const found = new Set();
  const matches = String(text || "").matchAll(/var\s+presInfo\s*=\s*["']([^"']+)["']/g);
  for (const match of matches) {
    try {
      const decoded = inflateSync(Buffer.from(match[1], "base64")).toString("utf8");
      for (const url of extractAssetUrls(decoded, baseUrl, packageRootUrl)) found.add(url);
    } catch {
      // Some packages omit compressed presentation metadata; normal parsing still applies.
    }
  }
  return [...found];
}

function likelyPackageUrls(playerUrl) {
  const urls = new Set();
  const add = (rel) => urls.add(new URL(rel, playerUrl).toString());
  for (let index = 0; index <= 16; index += 1) {
    add(`data/fnt${index}.woff`);
    add(`data/fnt${index}.woff2`);
  }
  for (let index = 1; index <= 50; index += 1) {
    add(`data/slide${index}.js`);
    add(`data/slide${index}.css`);
    add(`data/thmb${index}.png`);
  }
  for (const rel of [
    "data/lock.cur",
    "data/btn_play_big.svg",
    "data/btn_pause_big.svg",
    "data/goodbye.html",
  ]) add(rel);
  return [...urls];
}

function localPathForUrl(rootDir, rootUrl, assetUrl) {
  const root = new URL(rootUrl);
  const asset = new URL(assetUrl);
  let rel = decodeURIComponent(asset.pathname.slice(dirname(root.pathname).length + 1));
  if (!rel || rel.startsWith("..")) rel = "presentation.html";
  rel = rel.split("/").map(safeSegment).join("/");
  return join(rootDir, rel);
}

async function mirrorPlayerPackage(row, playerUrl) {
  const courseRoot = join(coursewareRoot, row.course);
  const targetRoot = join(courseRoot, "ispring-localized", `unit-${String(row.unit).padStart(2, "0")}`, row.lessonId);
  mkdirSync(targetRoot, { recursive: true });
  const pending = [{ url: playerUrl, optional: false }, ...likelyPackageUrls(playerUrl).map((url) => ({ url, optional: true }))];
  const seen = new Set();
  const files = [];
  const failures = [];
  let optionalMisses = 0;

  async function processItem(item) {
    const url = item?.url;
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const discovered = [];
    try {
      const targetPath = localPathForUrl(targetRoot, playerUrl, url);
      const pathname = new URL(url).pathname;
      if (!force && existsSync(targetPath)) {
        const buffer = readFileSync(targetPath);
        files.push({ url, path: toPosix(relative(courseRoot, targetPath)), bytes: statSync(targetPath).size, status: "skipped" });
        if (isTextContent("existing/local", pathname)) {
          const text = buffer.toString("utf8");
          for (const next of extractAssetUrls(text, url, playerUrl)) discovered.push({ url: next, optional: false });
          for (const next of extractPresentationInfoAssetUrls(text, url, playerUrl)) discovered.push({ url: next, optional: false });
        }
        return discovered;
      }
      const response = await request(url, { headers: { referer: playerUrl } });
      if (!response.ok) {
        if (item.optional && [403, 404].includes(response.status)) {
          optionalMisses += 1;
          return discovered;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, buffer);
      files.push({ url, path: toPosix(relative(courseRoot, targetPath)), bytes: buffer.length, status: "downloaded" });
      const contentType = response.headers.get("content-type") || "";
      if (isTextContent(contentType, pathname)) {
        const text = buffer.toString("utf8");
        for (const next of extractAssetUrls(text, url, playerUrl)) {
          if (!seen.has(next)) discovered.push({ url: next, optional: false });
        }
        for (const next of extractPresentationInfoAssetUrls(text, url, playerUrl)) {
          if (!seen.has(next)) discovered.push({ url: next, optional: false });
        }
      }
    } catch (error) {
      if (item.optional) optionalMisses += 1;
      else failures.push({ url, error: String(error?.message || error) });
    }
    return discovered;
  }

  while (pending.length) {
    const batch = pending.splice(0, 10);
    const discovered = (await Promise.all(batch.map((item) => processItem(item)))).flat();
    for (const item of discovered) {
      if (!seen.has(item.url)) pending.push(item);
    }
  }

  return {
    targetRoot: toPosix(relative(courseRoot, targetRoot)),
    entryPath: toPosix(relative(courseRoot, join(targetRoot, "presentation.html"))),
    files,
    failures,
    optionalMisses,
  };
}

function patchManifest(reportRows) {
  const byCourse = new Map();
  for (const row of reportRows.filter((item) => ["localized", "partial"].includes(item.status))) {
    const rows = byCourse.get(row.course) || [];
    rows.push(row);
    byCourse.set(row.course, rows);
  }
  const patched = [];
  for (const [course, rows] of byCourse.entries()) {
    const manifestPath = join(coursewareRoot, course, "course-manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    let changed = 0;
    for (const row of rows) {
      for (const unit of manifest.units || []) {
        for (const lesson of unit.lessons || []) {
          const normalizedId = normalizeLessonId(lesson.id);
          if (normalizedId !== row.lessonId) continue;
          const record = {
            label: row.title || `iSpring ${row.lessonId}`,
            mode: "page",
            type: "ispring",
            category: "ispring",
            role: "lesson_ispring",
            path: row.entryPath,
            packagePath: row.targetRoot,
            source: row.url,
            files: row.fileCount,
          };
          if (row.status === "partial") {
            record.localizationStatus = "partial";
            record.failedAssets = row.failures || [];
          }
          lesson.ispring = lesson.ispring || [];
          const index = lesson.ispring.findIndex((item) => item.path === record.path || item.source === record.source);
          if (index >= 0) lesson.ispring[index] = { ...lesson.ispring[index], ...record };
          else lesson.ispring.push(record);
          lesson.resourceCounts = lesson.resourceCounts || {};
          lesson.resourceCounts.ispring = lesson.ispring.length;
          changed += 1;
        }
      }
    }
    for (const unit of manifest.units || []) {
      unit.summary = unit.summary || {};
      unit.summary.ispring = (unit.lessons || []).reduce((sum, lesson) => sum + (lesson.ispring?.length || 0), 0);
    }
    manifest.sourceAudit = manifest.sourceAudit || {};
    manifest.sourceAudit.ispringExpected = rows.length;
    manifest.sourceAudit.ispringComplete = rows.filter((row) => row.status === "localized").length;
    manifest.sourceAudit.ispringPartial = rows.filter((row) => row.status === "partial").length;
    if (changed) writeJson(manifestPath, manifest);
    patched.push({ course, changed });
  }
  return patched;
}

function normalizeLessonId(id) {
  const match = String(id || "").match(/^U(\d+)L(\d+)$/i);
  if (!match) return String(id || "");
  return `U${String(match[1]).padStart(2, "0")}L${String(match[2]).padStart(2, "0")}`;
}

const queue = readJson(queuePath);
let rows = queue.rows || [];
if (courseArg) rows = rows.filter((row) => row.course === courseArg);
if (startArg > 0) rows = rows.slice(startArg);
if (limitArg > 0) rows = rows.slice(0, limitArg);

const report = {
  generatedAt: new Date().toISOString(),
  rows: [],
  failures: [],
  manifestPatched: [],
};

for (const row of rows) {
  try {
    const embed = await getEmbedInfo(row);
    const mirror = await mirrorPlayerPackage(row, embed.playerUrl);
    const localized = {
      ...row,
      status: mirror.failures.length ? "partial" : "localized",
      title: embed.preview.title || embed.info.title,
      contentId: embed.contentId,
      playerUrl: embed.playerUrl,
      entryPath: mirror.entryPath,
      targetRoot: mirror.targetRoot,
      fileCount: mirror.files.length,
      bytes: mirror.files.reduce((sum, file) => sum + (file.bytes || 0), 0),
      optionalMisses: mirror.optionalMisses,
      failures: mirror.failures,
    };
    report.rows.push(localized);
    console.log(`${localized.status} ${row.course} ${row.lessonId}: ${mirror.files.length} files, ${mirror.failures.length} failures`);
  } catch (error) {
    const failure = { ...row, status: "failed", error: String(error?.message || error) };
    report.failures.push(failure);
    console.error(`Failed ${row.course} ${row.lessonId}: ${failure.error}`);
  }
}

report.manifestPatched = patchManifest(report.rows);
writeJson(reportPath, report);

const localizedCount = report.rows.filter((row) => row.status === "localized").length;
console.log(`iSpring localization rows ${report.rows.length}; localized ${localizedCount}; failed ${report.failures.length}.`);
