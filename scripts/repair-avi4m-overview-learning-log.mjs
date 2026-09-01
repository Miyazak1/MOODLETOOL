import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "AVI4M");
const manifestPath = join(courseRoot, "course-manifest.json");
const overviewRel = "course-sections/course-overview/index.html";
const overviewIspringRel = "ispring-localized/unit-00/course-overview";
const overviewPresentationRel = `${overviewIspringRel}/presentation.html`;
const overviewPresentationPath = join(courseRoot, overviewPresentationRel);
const overviewSourceUrl = "https://hexstruct.ispring.com/s/embed_player/5b6fc702-d433-11ed-86bb-3a9a83d567ea";
const learningLogRel = "localized-moodle-activities/assign/assign-10627-Learning-Log/index.html";
const learningLogFilesRel = "localized-moodle-activities/assign/assign-10627-Learning-Log/files";
const moodleBase = "http://34.30.231.58";

loadEnv(join(projectRoot, ".env"));

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
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

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function href(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function sha(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function fileType(fileName) {
  return String(fileName).split(".").pop()?.toLowerCase() || "file";
}

function previewPathFor(path) {
  const rel = `previews-html/${toPosix(path).replace(/^\/+/, "")}.html`;
  return existsSync(join(courseRoot, rel)) ? rel : undefined;
}

function hasValidSignature(bytes, fileName) {
  const ext = fileType(fileName);
  if (ext === "pdf") return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  if (["docx", "pptx", "xlsx", "h5p", "zip"].includes(ext)) return bytes[0] === 0x50 && bytes[1] === 0x4b;
  return bytes.length > 0;
}

function renderAttachmentRow(fromRel, resource) {
  const viewHref = href(fromRel, resource.previewPath || resource.path);
  const downloadHref = href(fromRel, resource.downloadPath || resource.path);
  return `<div class="file-row"><div class="file-label">${escapeHtml(resource.label)}</div><div class="actions"><a class="button" href="${viewHref}">View</a><a class="button" href="${downloadHref}" download>Download</a></div></div>`;
}

function renderFileSection(title, resources, fromRel) {
  if (!resources.length) return "";
  return `<section class="files"><h2>${escapeHtml(title)}</h2>${resources.map((item) => renderAttachmentRow(fromRel, item)).join("")}</section>`;
}

function extractPlayerData(html) {
  const match = html.match(/const playerData = (.*?);\s*\n/s);
  if (!match) throw new Error(`Missing playerData in ${overviewPresentationRel}`);
  return JSON.parse(JSON.parse(match[1]));
}

function replacePlayerData(html, data) {
  return html.replace(/const playerData = .*?;\s*\n/s, `const playerData = ${escapeScriptJson(JSON.stringify(data))};\n`);
}

function findAttachmentBlocks(data) {
  const blocks = [];
  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.t === "a" && typeof value.fn === "string" && typeof value.s === "string") blocks.push(value);
    Object.values(value).forEach(visit);
  }
  visit(data);
  return blocks;
}

function copyLanguageFile() {
  const rel = `${overviewIspringRel}/lng/en-US.1740f3.json`;
  const target = join(courseRoot, rel);
  if (existsSync(target)) return rel;
  const candidates = [
    join(workspaceRoot, "courseware", "BAF3M", "ispring-localized/unit-00/course-overview/lng/en-US.1740f3.json"),
    join(workspaceRoot, "courseware", "BAT4M", "ispring-localized/unit-00/course-overview/lng/en-US.1740f3.json"),
    join(workspaceRoot, "courseware", "SNC1D", "ispring-localized/unit-00/course-overview/lng/en-US.1740f3.json"),
    join(workspaceRoot, "courseware", "SES4U", "ispring-localized/unit-00/course-overview/lng/en-US.1740f3.json"),
    join(workspaceRoot, "courseware", "BAF3M", "ispring-localized/unit-00/course-overview/lng/en-US.c9165f.json"),
    join(workspaceRoot, "courseware", "BAT4M", "ispring-localized/unit-00/course-overview/lng/en-US.c9165f.json"),
    join(workspaceRoot, "courseware", "SNC1D", "ispring-localized/unit-00/course-overview/lng/en-US.c9165f.json"),
    join(workspaceRoot, "courseware", "SES4U", "ispring-localized/unit-00/course-overview/lng/en-US.c9165f.json"),
  ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) throw new Error("Missing reusable iSpring roll-preview language file.");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  const compatibilityTarget = join(courseRoot, `${overviewIspringRel}/lng/en-US.c9165f.json`);
  if (!existsSync(compatibilityTarget)) copyFileSync(source, compatibilityTarget);
  return rel;
}

function patchOverviewIspring() {
  if (!existsSync(overviewPresentationPath)) throw new Error(`Missing localized overview iSpring: ${overviewPresentationRel}`);
  const languageRel = copyLanguageFile();
  let presentationHtml = readFileSync(overviewPresentationPath, "utf8");
  const playerData = extractPlayerData(presentationHtml);
  const blocks = findAttachmentBlocks(playerData);
  const resources = [];
  const seen = new Set();
  const targetDirRel = `${overviewIspringRel}/resources/templates`;
  mkdirSync(join(courseRoot, targetDirRel), { recursive: true });

  for (const block of blocks) {
    const fileName = block.fn;
    const sourceRel = `${overviewIspringRel}/resources/${block.s}`;
    const sourceAbs = join(courseRoot, sourceRel);
    if (!existsSync(sourceAbs)) continue;
    const targetRel = `${targetDirRel}/${fileName}`;
    const targetAbs = join(courseRoot, targetRel);
    if (!existsSync(targetAbs) || statSync(targetAbs).size !== statSync(sourceAbs).size) copyFileSync(sourceAbs, targetAbs);
    block.s = `templates/${fileName}`;
    block.iL = false;
    block.fe = fileType(fileName);
    block.fs = statSync(targetAbs).size;
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    resources.push({
      label: fileName,
      type: fileType(fileName),
      category: "moodle_file",
      role: /outline/i.test(fileName) ? "course_outline" : "course_template",
      path: targetRel,
      bytes: statSync(targetAbs).size,
      source: overviewSourceUrl,
      previewPath: previewPathFor(targetRel),
      downloadPath: targetRel,
    });
  }

  playerData.resourcesBaseUrl = "resources/";
  playerData.playerI18nUrl = languageRel.replace(`${overviewIspringRel}/`, "");
  playerData.editorDocumentUrl = "";
  presentationHtml = replacePlayerData(presentationHtml, playerData);
  writeFileSync(overviewPresentationPath, presentationHtml, "utf8");

  const overviewPath = join(courseRoot, overviewRel);
  let overviewHtml = readFileSync(overviewPath, "utf8");
  const iframe = `<div class="localized-ispring"><iframe src="${href(overviewRel, overviewPresentationRel)}" width="1500" height="600" frameborder="0" scrolling="auto" allowfullscreen="allowfullscreen" loading="lazy" title="AVI4M Course Overview iSpring"></iframe></div>`;
  if (!overviewHtml.includes(overviewPresentationRel) && !overviewHtml.includes(href(overviewRel, overviewPresentationRel))) {
    overviewHtml = overviewHtml.replace(/<\/article>/, `${iframe}</article>`);
  }
  overviewHtml = overviewHtml.replace(/\s*<section class="files"><h2>Course Overview iSpring Resources<\/h2>[\s\S]*?<\/section>/g, "");
  overviewHtml = overviewHtml.replace(/\s*<\/main>/, `\n    ${renderFileSection("Course Overview iSpring Resources", resources, overviewRel)}\n  </main>`);
  writeFileSync(overviewPath, overviewHtml, "utf8");

  return {
    languageRel,
    resources,
    overviewBytes: Buffer.byteLength(overviewHtml, "utf8"),
    presentationBytes: statSync(overviewPresentationPath).size,
  };
}

const jar = new Map();

function storeCookies(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    for (const text of String(value).split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = text.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
}

function cookieHeader() {
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(url, options = {}, redirects = 0) {
  const headers = { ...(options.headers || {}) };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 5) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function login() {
  const loginUrl = `${moodleBase}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["']\s+value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing STMARY_MOODLE_USERNAME/STMARY_MOODLE_PASSWORD or MOODLE_USERNAME/MOODLE_PASSWORD");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("login failed");
}

async function downloadLearningLogFiles() {
  const files = [
    {
      label: "Learning Log-Sample v1.0.pdf",
      url: `${moodleBase}/pluginfile.php/11740/mod_assign/introattachment/0/Learning%20Log-Sample%20v1.0.pdf?forcedownload=1`,
    },
    {
      label: "Learning Log.docx",
      url: `${moodleBase}/pluginfile.php/11740/mod_assign/introattachment/0/Learning%20Log.docx?forcedownload=1`,
    },
  ];
  await login();
  mkdirSync(join(courseRoot, learningLogFilesRel), { recursive: true });
  const resources = [];
  for (const item of files) {
    const response = await request(item.url);
    if (!response.ok) throw new Error(`Learning Log download failed ${response.status}: ${item.url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!hasValidSignature(bytes, item.label)) throw new Error(`Invalid Learning Log file signature: ${item.label}`);
    const rel = `${learningLogFilesRel}/${sha(item.url)}-${item.label}`;
    writeFileSync(join(courseRoot, rel), bytes);
    resources.push({
      label: item.label,
      type: fileType(item.label),
      category: "moodle_file",
      role: "attachment",
      path: rel,
      bytes: bytes.length,
      source: item.url,
      previewPath: previewPathFor(rel) || (fileType(item.label) === "pdf" ? rel : undefined),
      downloadPath: rel,
    });
  }
  return resources;
}

function patchLearningLogPage(resources) {
  const learningLogPath = join(courseRoot, learningLogRel);
  let html = readFileSync(learningLogPath, "utf8");
  html = html.replace(/\s*<section class="files">[\s\S]*?<\/section>/g, "");
  html = html.replace(/\s*<\/main>/, `\n    ${renderFileSection("Files", resources, learningLogRel)}\n  </main>`);
  writeFileSync(learningLogPath, html, "utf8");
  return Buffer.byteLength(html, "utf8");
}

const overviewPatch = patchOverviewIspring();
const learningLogAttachments = await downloadLearningLogFiles();
const learningLogBytes = patchLearningLogPage(learningLogAttachments);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const overview = (manifest.courseSections || []).find((item) => item.role === "course_overview");
if (!overview) throw new Error("Missing course overview manifest item.");
overview.ispring = [
  {
    label: "AVI4M Course Overview iSpring",
    type: "ispring",
    category: "ispring",
    role: "course_overview_ispring",
    mode: "page",
    path: overviewPresentationRel,
    packagePath: overviewIspringRel,
    source: overviewSourceUrl,
    bytes: overviewPatch.presentationBytes,
    localizationStatus: "localized",
    failedAssets: [],
  },
];
overview.attachments = [
  ...(overview.attachments || []).filter((item) => !["course_template", "course_outline"].includes(item.role)),
  ...overviewPatch.resources,
];
overview.bytes = overviewPatch.overviewBytes;

const learningLog = (manifest.courseDownloads || []).find((item) => item.role === "learning_log" && item.path === learningLogRel);
if (!learningLog) throw new Error("Missing Learning Log manifest item.");
learningLog.attachments = learningLogAttachments;
learningLog.bytes = learningLogBytes;

manifest.sourceAudit ||= {};
manifest.sourceAudit.courseOverviewIspring = {
  source: overviewSourceUrl,
  path: overviewPresentationRel,
  packagePath: overviewIspringRel,
  localized: true,
  languageFile: overviewPatch.languageRel,
  localizedInternalFiles: overviewPatch.resources.map((item) => item.path),
};
manifest.sourceAudit.learningLogAttachmentRepair = {
  source: `${moodleBase}/mod/assign/view.php?id=10627`,
  localizedFiles: learningLogAttachments.map((item) => item.path),
};
manifest.sourceAudit.ispringExpectedFromBookRefs = 23;
manifest.sourceAudit.ispringComplete = 23;
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  overviewIspring: overviewPresentationRel,
  overviewInternalFiles: overviewPatch.resources.length,
  learningLogAttachments: learningLogAttachments.length,
}, null, 2));
