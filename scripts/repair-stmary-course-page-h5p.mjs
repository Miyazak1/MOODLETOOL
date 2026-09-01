import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import unzipper from "unzipper";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");

loadEnv(resolve(projectRoot, ".env"));

const course = safeCourse(readArg("--course"));
const activityId = String(readArg("--activity-id") || "").trim();
const labelArg = String(readArg("--label") || "").trim();
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "").replace(/\/login\/index\.php$/i, "");

if (!course || !activityId) {
  console.error("Usage: node scripts/repair-stmary-course-page-h5p.mjs --course COURSE --activity-id ID [--label LABEL]");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const outDir = join(courseRoot, "localized-moodle", "h5p-external");
const reportPath = join(projectRoot, "deployment", `${course}-stmary-page-${activityId}-h5p-repair-report.json`);
const pageSourceUrl = `${baseUrl}/mod/page/view.php?id=${activityId}`;
const jar = new Map();

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function safeCourse(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "");
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function storeCookies(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    for (const cookieText of String(value).split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = cookieText.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-stmary-page-h5p-repair/1.0");
  const cookie = cookieHeader();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function login() {
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing STMARY_MOODLE_USERNAME/STMARY_MOODLE_PASSWORD in .env");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("Moodle login failed");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function extractJsonString(html, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i").exec(html);
  if (!match) return "";
  return JSON.parse(`"${match[1]}"`);
}

function extractH5pIds(html) {
  const normalized = decodeEntities(html);
  return [...new Set([
    ...normalized.matchAll(/welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed&id=(\d+)/gi),
    ...normalized.matchAll(/data-h5p-id=["'](\d+)["']/gi),
  ].map((match) => match[1]))];
}

function extractBalancedDiv(html, startIndex) {
  const openEnd = html.indexOf(">", startIndex);
  let depth = 1;
  const pattern = /<\/?div\b[^>]*>/gi;
  pattern.lastIndex = openEnd + 1;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(openEnd + 1, match.index);
  }
  return html.slice(openEnd + 1);
}

function extractMainContent(html) {
  const roleMain = /<div\b[^>]*\brole=["']main["'][^>]*>/i.exec(html);
  if (roleMain) return extractBalancedDiv(html, roleMain.index);
  const noOverflow = /<div\b[^>]*class=["'][^"']*\bno-overflow\b[^"']*["'][^>]*>/i.exec(html);
  if (noOverflow) return extractBalancedDiv(html, noOverflow.index);
  return "";
}

function textPreview(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, 600);
}

function slugify(value) {
  return String(value || "h5p").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "h5p";
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function htmlHref(fromRelPath, toRelPath) {
  return toPosix(posix.relative(posix.dirname(toPosix(fromRelPath)), toPosix(toRelPath))).split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { buffer, contentType: response.headers.get("content-type") || "", finalUrl: response.url || url };
}

async function packageTitle(buffer, fallback) {
  try {
    const directory = await unzipper.Open.buffer(buffer);
    const entry = directory.files.find((file) => file.path === "h5p.json");
    if (!entry) return fallback;
    const metadata = JSON.parse((await entry.buffer()).toString("utf8"));
    return String(metadata.title || fallback).replace(/\s+/g, " ").trim() || fallback;
  } catch {
    return fallback;
  }
}

function findManifestPage(manifest) {
  const all = [...(manifest.courseSections || []), ...(manifest.courseDownloads || [])];
  return all.find((item) => String(item.moodleActivityId || "") === activityId)
    || all.find((item) => item?.path && /Writing-Formal-Lab-Reports/i.test(item.path))
    || all.find((item) => labelArg && String(item.label || "").trim() === labelArg);
}

function renderPage(title, bodyHtml, pageRel) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .content img, .content iframe, .content video { max-width: 100%; }
    .embedded-h5p { display: block; margin: 16px 0 24px; max-width: 100%; width: 100%; }
    .embedded-h5p iframe { border: 0; display: block; min-height: 640px; width: 100%; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; background: #f7f9fc; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 8px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>${htmlEscape(title)}</h1>
    <article class="content">${bodyHtml}</article>
  </main>
  <script>
    window.addEventListener("message", function (event) {
      if (!event.data || event.data.type !== "ossd:h5p-height") return;
      document.querySelectorAll(".embedded-h5p iframe").forEach(function (iframe) {
        if (event.source === iframe.contentWindow) iframe.style.height = Math.max(Number(event.data.height) || 0, 640) + "px";
      });
    });
  </script>
</body>
</html>
`;
}

function cleanMainContent(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<span[^>]*id=["']maincontent["'][^>]*><\/span>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bmodified\b[^"']*["'][\s\S]*?<\/div>/gi, "")
    .replace(/<div\b[^>]*class=["'][^"']*\bcompletion-info\b[^"']*["'][\s\S]*?<\/div>/gi, "")
    .replace(/<form\b[\s\S]*?<\/form>/gi, "")
    .replace(/\s(?:href|src|poster)=["']https?:\/\/34\.30\.231\.58[^"']*["']/gi, "")
    .trim();
}

function replaceH5pIframes(html, h5pRecords, pageRel) {
  let output = html;
  for (const record of h5pRecords) {
    const id = String(record.id);
    const iframe = `<div class="embedded-h5p embedded-h5p-frame"><iframe src="${htmlHref(pageRel, record.previewPath)}?embed=1" title="${htmlEscape(record.label, true)}" loading="lazy" allowfullscreen="allowfullscreen"></iframe></div>`;
    const externalFramePattern = new RegExp(
      String.raw`\s*(?:<p[^>]*>\s*)?<iframe\b[^>]*welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed(?:&amp;|&)id=${id}[^>]*>\s*<\/iframe>(?:\s*<\/p>)?`,
      "gi",
    );
    output = output.replace(externalFramePattern, `\n${iframe}\n`);
  }
  output = output.replace(/\s*(?:<p[^>]*>\s*)?<iframe\b(?![^>]*\bsrc=)[^>]*>\s*<\/iframe>(?:\s*<\/p>)?/gi, "");
  if (!/embedded-h5p-frame/.test(output) && h5pRecords[0]) {
    const record = h5pRecords[0];
    output += `\n<div class="embedded-h5p embedded-h5p-frame"><iframe src="${htmlHref(pageRel, record.previewPath)}?embed=1" title="${htmlEscape(record.label, true)}" loading="lazy" allowfullscreen="allowfullscreen"></iframe></div>`;
  }
  return output;
}

await login();

const response = await request(pageSourceUrl);
const sourceHtml = await response.text();
if (/name=["']password["']|logintoken/i.test(sourceHtml) && !/Writing Formal Lab Reports/i.test(sourceHtml)) {
  throw new Error("Fetched login page instead of Moodle activity");
}

const ids = extractH5pIds(sourceHtml);
if (!ids.length) throw new Error(`No welcome.hexstruct H5P id found in ${pageSourceUrl}`);

mkdirSync(outDir, { recursive: true });
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const page = findManifestPage(manifest);
if (!page?.path) throw new Error(`No manifest course page found for activity ${activityId}`);

const records = [];
for (const id of ids) {
  const embedUrl = `https://welcome.hexstruct.com/wp-admin/admin-ajax.php?action=h5p_embed&id=${id}`;
  const embed = await fetchBytes(embedUrl);
  const embedHtml = embed.buffer.toString("utf8");
  const exportUrl = extractJsonString(embedHtml, "exportUrl");
  if (!exportUrl) throw new Error(`H5P ${id} missing exportUrl`);
  const packageUrl = new URL(exportUrl, "https://welcome.hexstruct.com").toString();
  const h5p = await fetchBytes(packageUrl);
  if (h5p.buffer[0] !== 0x50 || h5p.buffer[1] !== 0x4b) throw new Error(`H5P ${id} package is not ZIP/H5P`);
  const fallbackTitle = extractJsonString(embedHtml, "title") || labelArg || page.label || `H5P ${id}`;
  const title = await packageTitle(h5p.buffer, fallbackTitle);
  const targetPath = join(outDir, `${String(id).padStart(4, "0")}-${slugify(title)}.h5p`);
  if (!existsSync(targetPath)) writeFileSync(targetPath, h5p.buffer);
  const relPath = toPosix(relative(courseRoot, targetPath));
  records.push({
    id,
    label: `Writing Formal Lab Reports - ${title}`,
    type: "h5p",
    category: "localized_external_h5p",
    role: "course_resource",
    parentSection: "Introduction",
    sourceGroup: "course_section_0",
    path: relPath,
    previewPath: relPath.replace(/\.h5p$/i, "/index.html"),
    source: `https://welcome.hexstruct.com/h5p-embed/${id}`,
    originalSource: embedUrl,
    bytes: statSync(targetPath).size,
  });
}

page.attachments ||= [];
for (const record of records) {
  const index = page.attachments.findIndex((item) => item.originalSource === record.originalSource || item.source === record.source || item.path === record.path);
  if (index >= 0) page.attachments[index] = { ...page.attachments[index], ...record };
  else page.attachments.push(record);
}

let mainContent = cleanMainContent(extractMainContent(sourceHtml));
if (!mainContent) {
  const localHtml = readFileSync(join(courseRoot, page.path), "utf8");
  mainContent = cleanMainContent(localHtml.match(/<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i)?.[1] || "");
}
mainContent = replaceH5pIframes(mainContent, records, page.path);

const title = labelArg || page.label || "Writing Formal Lab Reports";
const outputHtml = renderPage(title, mainContent, page.path);
writeFileSync(join(courseRoot, page.path), outputHtml, "utf8");
page.bytes = Buffer.byteLength(outputHtml, "utf8");
page.textPreview = textPreview(mainContent);

manifest.sourceAudit ||= {};
manifest.sourceAudit.stmaryPageH5pRepair ||= {};
manifest.sourceAudit.stmaryPageH5pRepair[activityId] = {
  generatedAt: new Date().toISOString(),
  source: pageSourceUrl,
  ids,
  page: page.path,
  records: records.map(({ label, path, previewPath, bytes, originalSource }) => ({ label, path, previewPath, bytes, originalSource })),
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
writeFileSync(reportPath, `${JSON.stringify({
  course,
  activityId,
  source: pageSourceUrl,
  page: page.path,
  h5p: records,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ course, activityId, page: page.path, h5p: records.length, reportPath }, null, 2));
