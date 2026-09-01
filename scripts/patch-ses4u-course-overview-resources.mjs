import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "SES4U");
const manifestPath = join(courseRoot, "course-manifest.json");
const previewJsonPath = join(projectRoot, "deployment", "SES4U-course-overview-preview.json");
const overviewPageRel = "course-sections/course-overview/index.html";
const overviewIspringRel = "ispring-localized/unit-00/course-overview/presentation.html";
const overviewIspringRootRel = "ispring-localized/unit-00/course-overview";
const overviewIspringRoot = join(courseRoot, overviewIspringRootRel);
const learningLogRel = "localized-moodle-activities/assign/assign-12281-Learning-Log/index.html";
const learningLogFilesRel = "localized-moodle-activities/assign/assign-12281-Learning-Log/files";
const knownTemplateSourceDir = join(workspaceRoot, "courseware", "SNC1D", "ispring-localized", "unit-00", "course-overview", "resources", "templates");
const sourceUrl = "https://hexstruct.ispring.com/s/embed_player/71fd9cc0-dada-11ed-8c71-36840ad1f71b";
const baseUrl = "http://34.30.231.58";

loadEnv(join(projectRoot, ".env"));

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
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

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function relativeHref(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function shaPrefix(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
}

function typeFromLabel(label) {
  return String(label).split(".").pop()?.toLowerCase() || "file";
}

function assertSignature(bytes, label) {
  const type = typeFromLabel(label);
  if (type === "pdf" && bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error(`Invalid PDF signature: ${label}`);
  }
  if (["doc", "docx", "pptx", "xlsx"].includes(type) && bytes.subarray(0, 2).toString("latin1") !== "PK") {
    throw new Error(`Invalid Office ZIP signature: ${label}`);
  }
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
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
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar();

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-ses4u-overview-patch/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
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
  if (!username || !password) throw new Error("Missing STMARY Moodle credentials in .env.");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) {
    throw new Error("St. Mary Moodle login failed.");
  }
}

async function downloadMoodleFile(url, label) {
  const response = await request(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assertSignature(bytes, label);
  const rel = `${learningLogFilesRel}/${shaPrefix(url)}-${label}`;
  const target = join(courseRoot, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return {
    label,
    type: typeFromLabel(label),
    category: "moodle_file",
    role: "attachment",
    path: rel,
    bytes: bytes.length,
    source: url,
    downloadPath: rel,
    previewPath: typeFromLabel(label) === "docx" ? `previews-html/${rel}.html` : rel,
  };
}

function existingResource(label, type, rel, previewPath = rel, downloadPath = rel) {
  const abs = join(courseRoot, rel);
  if (!existsSync(abs)) throw new Error(`Missing local resource: ${rel}`);
  return {
    label,
    type,
    category: type === "h5p" ? "localized_external_h5p" : "moodle_file",
    role: "course_template",
    path: rel,
    bytes: statSync(abs).size,
    previewPath,
    downloadPath,
  };
}

function findManifestResource(manifest, labelPattern) {
  const matches = [];
  function walk(value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (labelPattern.test(value.label || "") && value.path && value.bytes) matches.push(value);
    Object.values(value).forEach(walk);
  }
  walk(manifest);
  if (!matches.length) throw new Error(`Missing manifest resource: ${labelPattern}`);
  return { ...matches[0] };
}

function removeRollSectionsByTitle(playerData, titles) {
  const titleSet = new Set(titles.map((title) => title.toLowerCase()));
  const state = playerData?.state?.c;
  const pages = state?.B;
  const order = state?.o;
  if (!pages || !Array.isArray(order)) return [];
  const removed = [];
  for (const [key, page] of Object.entries(pages)) {
    const title = String(page?.h?.t || "").trim();
    if (!titleSet.has(title.toLowerCase())) continue;
    delete pages[key];
    removed.push(title);
  }
  if (removed.length) state.o = order.filter((key) => Object.hasOwn(pages, key));
  return removed;
}

function readPresentationPlayerData() {
  const path = join(courseRoot, overviewIspringRel);
  const html = readFileSync(path, "utf8");
  const match = /const playerData = ("(?:\\.|[^"\\])*");/.exec(html);
  if (!match) throw new Error("Cannot locate playerData in SES4U Course Overview iSpring.");
  return { path, html, match, playerData: JSON.parse(JSON.parse(match[1])) };
}

function readOriginalOverviewPlayerData() {
  if (!existsSync(previewJsonPath)) {
    throw new Error(`Missing original SES4U iSpring preview JSON: ${previewJsonPath}`);
  }
  const preview = JSON.parse(readFileSync(previewJsonPath, "utf8"));
  if (!preview.playerData) throw new Error("Missing playerData in SES4U course overview preview JSON.");
  return JSON.parse(JSON.stringify(preview.playerData));
}

function writePresentationPlayerData(payload, playerData) {
  const replacement = `const playerData = ${JSON.stringify(JSON.stringify(playerData)).replace(/</g, "\\u003c")};`;
  const nextHtml = `${payload.html.slice(0, payload.match.index)}${replacement}${payload.html.slice(payload.match.index + payload.match[0].length)}`;
  writeFileSync(payload.path, nextHtml, "utf8");
}

function localizeRollTemplateAttachments(playerData) {
  const expected = new Set(["End of Unit Reflection.docx", "KWL Chart.docx", "Learning Log.docx", "Exit Slip.docx"]);
  const localized = [];

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;

    if (value.t === "a" && expected.has(value.fn)) {
      const sourcePath = join(knownTemplateSourceDir, value.fn);
      if (!existsSync(sourcePath)) throw new Error(`Missing known local iSpring template: ${sourcePath}`);
      const targetRel = `templates/${value.fn}`;
      const targetPath = join(overviewIspringRoot, "resources", targetRel);
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
      value.fe = typeFromLabel(value.fn);
      value.fs = statSync(targetPath).size;
      value.iL = false;
      value.s = targetRel;
      localized.push({ fileName: value.fn, rel: `resources/${targetRel}`, bytes: value.fs });
    }

    Object.values(value).forEach(visit);
  }

  visit(playerData);
  return localized;
}

function renderAttachmentRow(item, pageRel) {
  const viewHref = item.previewPath ? relativeHref(pageRel, item.previewPath) : "";
  const downloadHref = relativeHref(pageRel, item.downloadPath || item.path);
  const view = viewHref ? `<a class="button" href="${escapeAttr(viewHref)}">View</a>` : "";
  return `<div class="file-row"><div class="file-label">${escapeHtml(item.label)}</div><div class="actions">${view}<a class="button" href="${escapeAttr(downloadHref)}" download>Download</a></div></div>`;
}

function renderLearningLogPage(attachments) {
  const rows = attachments.map((item) => renderAttachmentRow(item, learningLogRel)).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Learning Log</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; line-height: 1.6; }
    body { margin: 0; padding: 32px 18px 56px; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d6e2f0; border-radius: 8px; padding: 28px 34px 36px; }
    h1 { font-size: 30px; line-height: 1.25; margin: 0 0 12px; }
    h2 { font-size: 21px; margin: 28px 0 12px; }
    .content { border-top: 1px solid #e0e8f2; padding-top: 18px; }
    .files { border-top: 1px solid #e0e8f2; margin-top: 26px; padding-top: 8px; }
    .file-row { align-items: center; border: 1px solid #d6e2f0; border-radius: 6px; display: flex; gap: 12px; justify-content: space-between; margin: 10px 0; padding: 10px 12px; }
    .file-label { font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex: 0 0 auto; gap: 8px; }
    .button { border: 1px solid #9fbfe5; border-radius: 6px; color: #003b72; font-weight: 700; padding: 6px 10px; text-decoration: none; }
    @media (max-width: 720px) { body { padding: 0; } main { border-left: 0; border-radius: 0; border-right: 0; padding: 22px 18px 34px; } h1 { font-size: 24px; } .file-row { align-items: stretch; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <h1>Learning Log</h1>
    <article class="content">
      <h2>Learning Log</h2>
      <p>After each unit, the student must submit a learning log to track the hours spent on assignments. The learning log is to provide learning accountability from the student and to help the student develop a good study routine. Attached you will find a sample learning log filled out.</p>
    </article>
    <section class="files"><h2>Files</h2>${rows}</section>
  </main>
</body>
</html>
`;
}

function presentationFilesBlock(resources) {
  const rows = resources.map((item) => renderAttachmentRow(item, overviewPageRel)).join("");
  return `<!-- presentation-files-start --><div class="presentation-files templates-local"><h3>Presentation Files</h3><p>These are the local Moodle resources corresponding to the templates referenced in the overview presentation. Exit Slip is provided as a local H5P activity package, not as a fixed Word document.</p>${rows}</div><!-- presentation-files-end -->`;
}

function rewriteOverviewPage(templateResources) {
  const pagePath = join(courseRoot, overviewPageRel);
  let html = readFileSync(pagePath, "utf8");
  html = html.replace(/<section class="overview-block templates-local">[\s\S]*?<\/section>/, "");
  html = html.replace(/<!-- presentation-files-start -->[\s\S]*?<!-- presentation-files-end -->/, "");
  html = html.replace(
    /(<section class="overview-block">\s*<h2>Course Overview Presentation<\/h2>\s*<iframe\b[\s\S]*?<\/iframe>)/,
    `$1${presentationFilesBlock(templateResources)}`,
  );
  writeFileSync(pagePath, html, "utf8");
  return Buffer.byteLength(html, "utf8");
}

await login();
const learningLogAttachments = [
  await downloadMoodleFile(
    "http://34.30.231.58/pluginfile.php/13821/mod_assign/introattachment/0/Learning%20Log-Sample%20v1.0.pdf?forcedownload=1",
    "Learning Log-Sample v1.0.pdf",
  ),
  await downloadMoodleFile(
    "http://34.30.231.58/pluginfile.php/13821/mod_assign/introattachment/0/Learning%20Log.docx?forcedownload=1",
    "Learning Log.docx",
  ),
];

writeFileSync(join(courseRoot, learningLogRel), renderLearningLogPage(learningLogAttachments), "utf8");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const kwlReflectionResources = [];
for (let unit = 1; unit <= 5; unit += 1) {
  kwlReflectionResources.push(findManifestResource(manifest, new RegExp(`^Unit ${unit} KWL\\.docx$`, "i")));
}
for (let unit = 1; unit <= 5; unit += 1) {
  const resource = findManifestResource(manifest, new RegExp(`^Unit ${unit} Reflection\\.docx$`, "i"));
  resource.label = `Unit ${unit} End-of-Unit Reflection.docx`;
  kwlReflectionResources.push(resource);
}
const exitSlip = existingResource(
  "Exit Slip H5P package",
  "h5p",
  "localized-moodle/h5p-external/0131-title.h5p",
  "localized-moodle/h5p-external/0131-title/index.html",
  "localized-moodle/h5p-external/0131-title.h5p",
);
const templateResources = [...learningLogAttachments.map((item) => ({ ...item, role: "course_template" })), ...kwlReflectionResources.map((item) => ({ ...item, role: "course_template" })), exitSlip];

const presentation = readPresentationPlayerData();
const originalPlayerData = readOriginalOverviewPlayerData();
const localizedRollTemplates = localizeRollTemplateAttachments(originalPlayerData);
originalPlayerData.resourcesBaseUrl = "resources/";
originalPlayerData.playerI18nUrl = "lng/en-US.c9165f.json";
originalPlayerData.editorDocumentUrl = "";
writePresentationPlayerData(presentation, originalPlayerData);

const overviewBytes = rewriteOverviewPage(templateResources);
const learningLogBytes = statSync(join(courseRoot, learningLogRel)).size;
const presentationBytes = statSync(join(courseRoot, overviewIspringRel)).size;

const overview = (manifest.courseSections || []).find((item) => item.role === "course_overview");
if (!overview) throw new Error("Missing course_overview in manifest.");
overview.bytes = overviewBytes;
overview.attachments = [...(overview.attachments || []).filter((item) => item.role !== "course_template"), ...templateResources];
const overviewIspring = overview.ispring?.find((item) => item.role === "course_overview_ispring");
if (overviewIspring) overviewIspring.bytes = presentationBytes;

const learningLog = (manifest.courseDownloads || []).find((item) => item.role === "learning_log" || item.moodleActivityId === "12281");
if (!learningLog) throw new Error("Missing Learning Log courseDownload in manifest.");
learningLog.bytes = learningLogBytes;
learningLog.attachments = learningLogAttachments;
learningLog.textPreview = "Learning Log After each unit, the student must submit a learning log to track the hours spent on assignments. The learning log is to provide learning accountability from the student and to help the student develop a good study routine. Attached you will find a sample learning log filled out.";

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewTemplates = {
  source: sourceUrl,
  strategy: "Restored the original iSpring Templates section and localized its attachment blocks to courseware resources/templates. Verified Moodle copies remain exposed on the Course Overview page for View/Download workflows.",
  restoredIspringSections: ["Templates"],
  localizedRollTemplates,
  resources: templateResources.map((item) => ({ label: item.label, path: item.path, previewPath: item.previewPath, downloadPath: item.downloadPath })),
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  downloadedLearningLog: learningLogAttachments.map((item) => ({ label: item.label, path: item.path, bytes: item.bytes })),
  restoredIspringSections: ["Templates"],
  localizedRollTemplates,
  courseOverviewTemplates: templateResources.length,
}, null, 2));
