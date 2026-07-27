import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const deploymentRoot = join(projectRoot, "deployment");
const queuePath = join(projectRoot, "deployment", "moodle-localization-queue.json");

loadEnvFile(join(projectRoot, ".env"));

const courseArg = readArg("--course")?.toUpperCase();
const dryRun = process.argv.includes("--dry-run");
const applyManifest = process.argv.includes("--apply-manifest");
const limitArg = Number(readArg("--limit") || 0);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
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

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseHiddenToken(html) {
  return /name=["']logintoken["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] || "";
}

function parsePluginfileLink(html) {
  const matches = [...String(html || "").matchAll(/href=["']([^"']*pluginfile\.php[^"']*)["']/gi)];
  return matches.length ? htmlDecode(matches[0][1]) : "";
}

function filenameFromHeaders(url, headers, fallback) {
  const disposition = headers.get("content-disposition") || "";
  const utfName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plainName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const fromHeader = utfName || plainName;
  if (fromHeader) return decodeURIComponent(fromHeader);
  const fromUrl = decodeURIComponent(basename(new URL(url).pathname));
  return fromUrl && fromUrl !== "view.php" ? fromUrl : fallback;
}

function typeFromFilename(filename, contentType) {
  const ext = extname(filename).replace(".", "").toLowerCase();
  if (ext) return ext;
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("wordprocessingml")) return "docx";
  if (contentType.includes("html")) return "html";
  if (contentType.includes("text")) return "txt";
  return "bin";
}

function targetFolder(row) {
  return toPosix(dirname(row.targetHint || `texts/${row.textId}/${safeFileFallback(row)}`));
}

function safeFileFallback(row) {
  const base = basename(row.targetHint || `${row.textId}.html`);
  return base || `${row.textId || "moodle-text"}.html`;
}

function forceViewUrl(url) {
  const separator = url.includes("?") ? "&" : "?";
  return url.includes("forceview=1") ? url : `${url}${separator}forceview=1`;
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

function splitSetCookie(value) {
  if (!value) return [];
  return String(value).split(/,(?=\s*[^;,]+=)/g).map((item) => item.trim()).filter(Boolean);
}

const jar = new CookieJar();

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, {
    ...options,
    headers,
    redirect: "manual",
  });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    const next = new URL(response.headers.get("location"), url).toString();
    const originalMethod = options.method || "GET";
    const method = [301, 302, 303].includes(response.status) && originalMethod !== "GET" ? "GET" : originalMethod;
    return request(next, { ...options, method, body: method === "GET" ? undefined : options.body }, redirects + 1);
  }
  return response;
}

async function login() {
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) {
    throw new Error("Set MOODLE_USERNAME and MOODLE_PASSWORD before running without --dry-run.");
  }
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = parseHiddenToken(loginHtml);
  const body = new URLSearchParams({
    username,
    password,
    anchor: "",
    logintoken: token,
  });
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  if (response.url.includes("/login/index.php") && /name=["']username["']/i.test(text)) {
    throw new Error("Moodle login failed; check MOODLE_USERNAME/MOODLE_PASSWORD.");
  }
}

async function downloadText(row) {
  const page = await request(forceViewUrl(row.sourceUrl));
  const contentType = page.headers.get("content-type") || "";
  const pageBuffer = Buffer.from(await page.arrayBuffer());
  let fileUrl = "";
  let fileResponse = page;
  let fileBuffer = pageBuffer;

  if (!page.url.includes("pluginfile.php") && contentType.includes("html")) {
    const html = pageBuffer.toString("utf8");
    const link = parsePluginfileLink(html);
    if (!link) throw new Error(`No pluginfile link found for ${row.course} ${row.textId}`);
    fileUrl = new URL(link, row.sourceUrl).toString();
    fileResponse = await request(fileUrl);
    fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
  } else {
    fileUrl = page.url;
  }

  const fileContentType = fileResponse.headers.get("content-type") || "";
  if (fileResponse.url.includes("/login/index.php") || fileBuffer.slice(0, 200).toString("utf8").includes("<title>登录网站")) {
    throw new Error(`Moodle returned login page for ${row.course} ${row.textId}`);
  }

  const fallback = safeFileFallback(row);
  const filename = filenameFromHeaders(fileResponse.url || fileUrl, fileResponse.headers, fallback);
  const targetDir = join(coursewareRoot, row.course, dirname(row.targetHint || `texts/${row.textId}/${filename}`));
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, filename);
  writeFileSync(targetPath, fileBuffer);

  return {
    course: row.course,
    textId: row.textId,
    label: row.label,
    sourceUrl: row.sourceUrl,
    fileUrl: fileResponse.url || fileUrl,
    path: toPosix(targetPath.slice(join(coursewareRoot, row.course).length + 1)),
    filename,
    type: typeFromFilename(filename, fileContentType),
    bytes: fileBuffer.length,
    contentType: fileContentType,
  };
}

function patchManifest(course, downloads) {
  const manifestPath = join(coursewareRoot, course, "course-manifest.json");
  const manifest = readJson(manifestPath);
  const byText = new Map(downloads.map((item) => [item.textId, item]));
  for (const text of manifest.texts || []) {
    const item = byText.get(text.id);
    if (!item) continue;
    text.sourceStatus = "downloadable";
    text.materials = [
      {
        label: item.filename,
        type: item.type,
        category: "text_material",
        role: "core_text",
        path: item.path,
        bytes: item.bytes,
      },
    ];
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function renderMarkdown(report) {
  const lines = ["# Authenticated Moodle Text Download Report", "", `Generated: ${report.generatedAt}`, ""];
  lines.push(`Course: ${report.course || "all"}`);
  lines.push("");
  lines.push(`Rows: ${report.rows.length}`);
  lines.push(`Downloaded: ${report.downloads.length}`);
  lines.push(`Failed: ${report.failures.length}`);
  lines.push("");
  if (report.dryRun && report.rows.length) {
    lines.push("## Queued", "");
    lines.push("| Course | Text ID | Label | Target Folder | Source |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of report.rows) {
      lines.push(
        `| ${row.course} | ${row.textId} | ${String(row.label || "").replaceAll("|", "\\|")} | ${targetFolder(row)} | ${row.sourceUrl} |`,
      );
    }
    lines.push("");
  }
  if (report.downloads.length) {
    lines.push("## Downloaded", "");
    lines.push("| Course | Text ID | File | Bytes | Source |");
    lines.push("| --- | --- | --- | ---: | --- |");
    for (const item of report.downloads) {
      lines.push(`| ${item.course} | ${item.textId} | ${item.path} | ${item.bytes} | ${item.sourceUrl} |`);
    }
    lines.push("");
  }
  if (report.failures.length) {
    lines.push("## Failures", "");
    lines.push("| Course | Text ID | Source | Error |");
    lines.push("| --- | --- | --- | --- |");
    for (const item of report.failures) {
      lines.push(`| ${item.course} | ${item.textId} | ${item.sourceUrl} | ${String(item.error).replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const queue = readJson(queuePath);
let rows = queue.rows.filter((row) => row.scope === "text-source" && row.textId);
if (courseArg) rows = rows.filter((row) => row.course === courseArg);
if (limitArg > 0) rows = rows.slice(0, limitArg);

const report = {
  generatedAt: new Date().toISOString(),
  course: courseArg || null,
  dryRun,
  applyManifest,
  rows,
  downloads: [],
  failures: [],
};

if (!rows.length) {
  console.log("No Moodle text-source rows matched.");
} else if (dryRun) {
  console.log(`Moodle text download dry run: ${rows.length} row(s).`);
} else {
  try {
    await login();
    for (const row of rows) {
      try {
        report.downloads.push(await downloadText(row));
        console.log(`Downloaded ${row.course} ${row.textId}`);
      } catch (error) {
        report.failures.push({ course: row.course, textId: row.textId, sourceUrl: row.sourceUrl, error: String(error.message || error) });
        console.error(`Failed ${row.course} ${row.textId}: ${error.message || error}`);
      }
    }
  } catch (error) {
    const message = String(error.message || error);
    for (const row of rows) {
      report.failures.push({ course: row.course, textId: row.textId, sourceUrl: row.sourceUrl, error: message });
    }
    console.error(message);
  }
  if (applyManifest) {
    for (const course of new Set(report.downloads.map((item) => item.course))) {
      patchManifest(course, report.downloads.filter((item) => item.course === course));
    }
  }
}

mkdirSync(deploymentRoot, { recursive: true });
const suffix = courseArg ? `-${courseArg}` : "";
writeFileSync(join(deploymentRoot, `moodle-text-download-report${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(join(deploymentRoot, `moodle-text-download-report${suffix}.md`), renderMarkdown(report), "utf8");

if (report.failures.length) process.exitCode = 1;
