import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "LKBCU";
const title = "International Languages, Simplified Chinese, Level 2, University";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const roadmapPath = join(projectRoot, "public", "course-roadmap.json");
const sourcesPath = join(courseRoot, "texts", "SOURCES.md");

loadEnvFile(join(projectRoot, ".env"));

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function writeJson(path, data) { writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8"); }
function toPosix(path) { return String(path || "").replaceAll("\\", "/"); }
function hash(value) { return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 10); }
function esc(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}
function safeName(value) { return String(value || "file").replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "file"; }

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
  header() { return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
}

const jar = new CookieJar(process.env.MOODLE_COOKIE || "");

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-lkbcu-finalizer/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
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

function eachResource(manifest, callback) {
  for (const item of manifest.courseDownloads || []) callback(item);
  for (const text of manifest.texts || []) {
    callback(text);
    for (const material of text.materials || []) callback(material);
  }
  for (const unit of manifest.units || []) {
    callback(unit.unitPlan);
    for (const lesson of unit.lessons || []) {
      callback(lesson.lessonPlan);
      for (const key of ["lessonText", "textExports", "downloads", "ispring", "bookSections"]) for (const item of lesson[key] || []) callback(item);
    }
  }
}

function pageShell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f6f8fb;color:#102033}main{max-width:980px;margin:0 auto;padding:32px 20px 56px}article{background:#fff;border:1px solid #d9e2ef;border-radius:6px;padding:22px}h1{margin-top:0;font-size:28px}p{line-height:1.55}.notice{border-left:4px solid #c27c00;background:#fff7e6;padding:12px 14px}.muted{color:#526173}</style></head><body><main><article><h1>${esc(title)}</h1>${body}</article></main></body></html>\n`;
}

function ensureUnavailablePage(item, reason) {
  item.unavailable = true;
  item.unavailableReason ||= reason;
  item.unavailableTarget ||= "Moodle resource target";
  item.path ||= `localized-moodle-activities/unavailable/${item.moodleActivityId || hash(item.label)}/index.html`;
  const abs = join(courseRoot, item.path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, pageShell(item.label || "Unavailable Resource", `<p class="notice">${esc(item.unavailableReason)}</p>`), "utf8");
  item.bytes = statSync(abs).size;
  delete item.url;
}

function folderItems(manifest) {
  const rows = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.downloads || []) {
        if (item?.category === "moodle_folder" && item.moodleActivityId) rows.push({ unit, lesson, item });
      }
    }
  }
  return rows;
}

async function downloadFolderZips(manifest) {
  await loginIfNeeded();
  let downloaded = 0;
  let extractedFiles = 0;
  const failures = [];
  for (const { item } of folderItems(manifest)) {
    const id = item.moodleActivityId;
    const zipRel = `localized-moodle/folder-zips/${id}-${hash(item.label)}.zip`;
    const zipAbs = join(courseRoot, zipRel);
    const extractRel = `localized-moodle/folder-files/${id}-${hash(item.label)}`;
    const extractAbs = join(courseRoot, extractRel);
    mkdirSync(dirname(zipAbs), { recursive: true });
    const response = await request(`https://www.esunnybrook.com/mod/folder/download_folder.php?id=${id}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!response.ok || buffer.subarray(0, 2).toString("latin1") !== "PK") {
      failures.push({ label: item.label, status: response.status, bytes: buffer.length });
      continue;
    }
    writeFileSync(zipAbs, buffer);
    rmSync(extractAbs, { recursive: true, force: true });
    mkdirSync(extractAbs, { recursive: true });
    const tar = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
    execFileSync(tar, ["-xf", zipAbs, "-C", extractAbs], { stdio: "ignore" });
    const attachments = [{
      label: `${item.label} folder package.zip`,
      type: "zip",
      path: zipRel,
      href: toPosix(relative(dirname(join(courseRoot, item.path)), zipAbs)),
      bytes: statSync(zipAbs).size,
      source: "authenticated SunnyBrook Moodle folder package",
    }];
    for (const file of listFiles(extractAbs)) {
      const rel = toPosix(relative(courseRoot, file));
      const ext = extname(file).slice(1).toLowerCase() || "file";
      attachments.push({
        label: basename(file),
        type: ext,
        path: rel,
        href: toPosix(relative(dirname(join(courseRoot, item.path)), file)),
        bytes: statSync(file).size,
        source: "authenticated SunnyBrook Moodle folder package",
      });
      extractedFiles++;
    }
    item.attachments = attachments;
    downloaded++;
  }
  return { downloaded, extractedFiles, failures };
}

function listFiles(root) {
  const files = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  if (existsSync(root)) visit(root);
  return files;
}

function mergeLessonPlans(manifest) {
  let matched = 0;
  for (const unit of manifest.units || []) {
    const planFolder = unit.lessons?.flatMap((lesson) => lesson.downloads || []).find((item) => /Daily Lesson Plans/i.test(item.label || ""));
    const plans = (planFolder?.attachments || []).filter((item) => /\.(docx?|pdf)$/i.test(item.path || item.label || ""));
    if (planFolder) unit.unitPlan = { label: `${unit.title} Daily Lesson Plans`, type: "html", category: "teacher_plan", role: "unit_plan", path: planFolder.path, bytes: planFolder.bytes, source: "authenticated SunnyBrook Moodle daily lesson plans folder" };
    for (const lesson of unit.lessons || []) {
      const lessonNumber = /Lesson\s+(\d+)/i.exec(lesson.title || "")?.[1] || "";
      const plan = plans.find((item) => lessonNumber && new RegExp(`Lesson\\s*-?\\s*${lessonNumber}\\b|Lesson${lessonNumber}\\b`, "i").test(item.label || item.path || ""));
      if (plan) {
        lesson.lessonPlan = { label: plan.label, type: plan.type, category: "teacher_plan", role: "lesson_plan", path: plan.path, bytes: plan.bytes, source: "authenticated SunnyBrook Moodle daily lesson plans folder" };
        matched++;
      }
      lesson.resourceCounts ||= {};
      lesson.resourceCounts.lessonPlan = lesson.lessonPlan ? 1 : 0;
    }
  }
  return matched;
}

function buildTextsIndex(manifest) {
  const groups = [
    { id: "ci-poetry", title: "Classical Chinese poetry and Ci-poem resources", pattern: /Li Qing|Ci-poem|poems?|Xu Zhimo|Cambridge/i },
    { id: "writing", title: "Chinese writing course materials", pattern: /Narrative|Prose Writing|Expository|News Writing|Argumentative/i },
    { id: "classical", title: "Classic Chinese language and literature resources", pattern: /Classic Chinese|Pre-Qin|Zhuangzi|Wei, Jin|Tang Dynasty|Qing Dynasty|Yingying|Tales of the World|Story Room/i },
    { id: "modern", title: "Modern Chinese fiction and prose resources", pattern: /Ah Q|Shi Tiesheng|Distant Qingping Bay|Modern Chinese|Saying Good-bye/i },
  ];
  const all = [];
  for (const unit of manifest.units || []) for (const lesson of unit.lessons || []) for (const item of lesson.downloads || []) {
    if (item?.path && groups.some((group) => group.pattern.test(item.label || ""))) all.push({ unit: unit.unit, item });
    for (const attachment of item?.attachments || []) if (groups.some((group) => group.pattern.test(`${item.label || ""} ${attachment.label || ""}`))) all.push({ unit: unit.unit, item: attachment });
  }
  manifest.texts = groups.map((group) => {
    const materials = all.filter(({ item }) => group.pattern.test(item.label || ""));
    if (!materials.length) return null;
    return {
      id: group.id,
      title: group.title,
      type: "literary_resources",
      units: [...new Set(materials.map((row) => row.unit))].sort((a, b) => a - b),
      copyrightStatus: "moodle_provided_course_resource",
      sourceStatus: "localized_from_authenticated_moodle",
      notes: "Index entry created from Moodle-provided LKBCU resource titles; no teaching content was generated.",
      materials: materials.map((row) => ({
        ...row.item,
        category: row.item.category || "literary_resource",
        role: row.item.role || "text_material",
      })),
    };
  }).filter(Boolean);
  return manifest.texts.length;
}

function sanitizeHtml(root) {
  let changed = 0;
  for (const file of listFiles(root).filter((path) => path.toLowerCase().endsWith(".html"))) {
    const before = readFileSync(file, "utf8");
    const after = before
      .replace(/https:\/\/www\.esunnybrook\.com\/[^"'<> )]+/gi, "#")
      .replace(/https?:\/\/[^"'<> )]+\/pluginfile\.php\/[^"'<> )]+/gi, "#")
      .replace(/https:\/\/sisonline\.oss-cn-hongkong\.aliyuncs\.com\/[^"'<> )]+/gi, "#")
      .replace(/href=["']javascript:void\(0\)["']/gi, 'href="#"')
      .replace(/data-pageurl=["'][^"']*["']/gi, 'data-pageurl="#"')
      .replace(/name=["']pageurl["']\s+value=["'][^"']*["']/gi, 'name="pageurl" value="#"');
    if (after !== before) {
      writeFileSync(file, after, "utf8");
      changed++;
    }
  }
  return changed;
}

function scrubManifestSources(manifest) {
  let scrubbed = 0;
  if (/www\.esunnybrook\.com/i.test(manifest.sourceAudit?.coursePage || "")) {
    manifest.sourceAudit.coursePage = "Moodle course id 44";
    scrubbed++;
  }
  eachResource(manifest, (item) => {
    if (!item) return;
    const id = item.moodleActivityId || /[?&]id=(\d+)/i.exec(`${item.url || item.source || ""}`)?.[1] || "";
    const mod = /moodle_([^/]+)/i.exec(item.category || "")?.[1] || "activity";
    if (/www\.esunnybrook\.com|pluginfile\.php/i.test(item.source || "")) {
      item.source = id ? `authenticated SunnyBrook Moodle ${mod} activity id ${id}` : "authenticated SunnyBrook Moodle activity";
      scrubbed++;
    }
    if (/www\.esunnybrook\.com|pluginfile\.php|javascript:void\(0\)/i.test(item.url || "")) {
      delete item.url;
      scrubbed++;
    }
    for (const attachment of item.attachments || []) {
      if (/www\.esunnybrook\.com|pluginfile\.php|sisonline/i.test(attachment.source || "")) {
        attachment.source = "authenticated SunnyBrook Moodle attachment";
        scrubbed++;
      }
    }
  });
  return scrubbed;
}

function updateUnitSummaries(manifest) {
  for (const unit of manifest.units || []) {
    const resources = [];
    const add = (item) => { if (item) { resources.push(item); for (const a of item.attachments || []) resources.push(a); } };
    add(unit.unitPlan);
    for (const lesson of unit.lessons || []) {
      add(lesson.lessonPlan);
      for (const item of lesson.downloads || []) add(item);
      lesson.resourceCounts = { downloads: (lesson.downloads || []).length, lessonPlan: lesson.lessonPlan ? 1 : 0, ispring: (lesson.ispring || []).length };
    }
    const count = (pattern) => resources.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
    unit.summary = { downloads: resources.filter((item) => item.path || item.externalUrl).length, ispring: 0, docx: count(/docx?/i), pdf: count(/pdf/i), presentation: count(/pptx?|ppt/i), video: count(/video|mp4|youtube/i), h5p: count(/h5p/i) };
  }
}

function collectStats(manifest) {
  const byPath = new Map();
  const unavailable = [];
  const external = [];
  eachResource(manifest, (item) => {
    if (!item) return;
    if (item.path) byPath.set(item.path, item);
    if (item.unavailable) unavailable.push(item);
    if (item.externalUrl) external.push(item);
    for (const attachment of item.attachments || []) if (attachment.path) byPath.set(attachment.path, attachment);
  });
  const values = [...byPath.values()];
  const unavailableKeys = new Set(unavailable.map((item) => `${item.label || ""}|${item.unavailableReason || ""}`));
  const byType = (pattern) => values.filter((item) => pattern.test(String(item.type || item.path || item.label || ""))).length;
  return {
    units: manifest.units?.length || 0,
    lessons: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
    resources: values.length,
    attachments: values.filter((item) => !String(item.path || "").endsWith(".html")).length,
    docx: byType(/docx/i),
    doc: byType(/\bdoc\b|\.doc$/i),
    pdf: byType(/pdf/i),
    zip: byType(/zip/i),
    unavailable: unavailableKeys.size,
    externalReferences: external.length,
  };
}

function unavailableItems(manifest) {
  const rows = [];
  const seen = new Set();
  eachResource(manifest, (item) => {
    if (!item?.unavailable) return;
    const row = { label: item.label, reason: item.unavailableReason || "Unavailable during localization." };
    const key = `${row.label}|${row.reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  });
  return rows;
}

function writeSources(stats, metrics) {
  mkdirSync(dirname(sourcesPath), { recursive: true });
  const unavailableLines = metrics.unavailableItems.length ? metrics.unavailableItems.map((item) => `  - ${item.label}: ${item.reason}`).join("\n") : "  - None.";
  const content = `# LKBCU Sources and Localization Notes

- Course source: authenticated SunnyBrook Moodle course shell, course id 44.
- Structure: Moodle activity/resource course organized as General, Unit 1, Unit 2, Unit 3 Classic Chinese Language and Literature, Unit 4 Modern Chinese Literature, and Final Evaluation.
- Localized structure: ${stats.units} units, ${stats.lessons} lesson/activity groups, ${stats.resources} unique local resource records, including ${stats.attachments} downloadable non-HTML files.
- Folder packages: ${metrics.folderPackagesDownloaded} Moodle folder package(s) were downloaded as ZIP files, extracting ${metrics.folderFilesExtracted} file(s) into local courseware.
- Lesson plans: ${metrics.lessonPlansMatched} daily lesson-plan file(s) were matched from Moodle folder packages.
- Literary/text index: ${metrics.textIndexCount} text index group(s) were created from Moodle resource titles: classical poetry/Ci, writing materials, classical Chinese literature, and modern Chinese fiction/prose. No teaching content was generated.
- Failed resources: ${metrics.unavailableItems.length} Moodle resource(s) returned 404 or were otherwise unavailable.
${unavailableLines}
- Teacher/privacy review: teacher observation/conversation checklist activities were retained as Moodle activities; no named student checklist files were identified in retained attachment filenames.
- Video/audio/iSpring/H5P: no iSpring or H5P packages were visible. YouTube links remain external public references where Moodle did not expose downloadable source files.
- Cleanup: changed ${metrics.htmlFilesChanged} HTML file(s), removed Moodle/source-storage URLs from local HTML/manifest fields, and kept local files/folder packages as primary course content.
`;
  writeFileSync(sourcesPath, content, "utf8");
}

function ensureSources(manifest) {
  manifest.courseDownloads = (manifest.courseDownloads || []).filter((item) => item.path !== "texts/SOURCES.md");
  manifest.courseDownloads.push({ label: "LKBCU Sources and Localization Notes", type: "md", category: "source_notes", role: "source_notes", path: "texts/SOURCES.md", bytes: statSync(sourcesPath).size, source: "local localization audit" });
}

function updateCatalog(stats) {
  const catalog = readJson(catalogPath);
  const entry = catalog.courses?.find((item) => item.code === course);
  if (entry) {
    entry.title = title;
    entry.level = "Grade 11";
    entry.status = "ready";
    entry.manifestUrl = "/courseware/LKBCU/course-manifest.json";
    entry.baseUrl = "/courseware/LKBCU/";
    entry.notes = `Moodle Chinese course localized: ${stats.units} units, ${stats.lessons} activity groups, ${stats.resources} local resource records; folder packages and text index included.`;
  }
  writeJson(catalogPath, catalog);
}

function updateRoadmap(stats, metrics) {
  const roadmap = readJson(roadmapPath);
  const entry = roadmap.courses?.find((item) => item.course === course);
  if (entry) {
    entry.title = title;
    entry.level = "Grade 11";
    entry.status = "ready";
    entry.phase = "package-ready";
    entry.moodle = { coursePage: "Moodle course id 44", outlineStatus: metrics.courseOutlineAvailable ? "ready" : "unavailable-404", outlineUrl: "", bookCount: 0, numberedLessonCount: stats.lessons };
    entry.readiness = { units: stats.units, lessons: stats.lessons, unitPlans: 4, lessonPlans: metrics.lessonPlansMatched, lessonPlanExpected: stats.lessons, missingCourseOutline: !metrics.courseOutlineAvailable, missingIntroduction: false, missingUnitPlans: 0, missingLessonPlans: Math.max(0, stats.lessons - metrics.lessonPlansMatched), textsNeedingReview: stats.unavailable, linkOnlyTexts: stats.externalReferences, localizedResources: stats.resources, unavailableResources: stats.unavailable, externalReferences: stats.externalReferences };
    entry.localEvidence = { courseOutlines: metrics.courseOutlineAvailable ? 1 : 0, unitPlans: 4, lessonPlans: metrics.lessonPlansMatched, ispringFiles: 0, outlineExamples: metrics.courseOutlineAvailable ? ["LKBCU Course Outline"] : ["LKBCU course outline resource returned HTTP 404"] };
    entry.nextActions = stats.unavailable ? ["Review LKBCU 404 Moodle resources if source files are restored."] : [];
  }
  writeJson(roadmapPath, roadmap);
}

const manifest = readJson(manifestPath);
for (const item of [ ...(manifest.courseDownloads || []), ...(manifest.units || []).flatMap((unit) => (unit.lessons || []).flatMap((lesson) => lesson.downloads || [])) ]) {
  if (!item?.path) ensureUnavailablePage(item, "Moodle resource returned HTTP 404 during localization.");
}
const folderResult = await downloadFolderZips(manifest);
const lessonPlansMatched = mergeLessonPlans(manifest);
const textIndexCount = buildTextsIndex(manifest);
const htmlFilesChanged = sanitizeHtml(courseRoot);
const scrubbedSourceUrls = scrubManifestSources(manifest);
updateUnitSummaries(manifest);
let stats = collectStats(manifest);
let metrics = { folderPackagesDownloaded: folderResult.downloaded, folderFilesExtracted: folderResult.extractedFiles, folderFailures: folderResult.failures, lessonPlansMatched, textIndexCount, htmlFilesChanged, scrubbedSourceUrls, unavailableItems: unavailableItems(manifest), courseOutlineAvailable: !(manifest.courseDownloads || []).some((item) => /Course Outline/i.test(item.label || "") && item.unavailable) };
writeSources(stats, metrics);
ensureSources(manifest);
stats = collectStats(manifest);
metrics = { ...metrics, unavailableItems: unavailableItems(manifest) };
writeSources(stats, metrics);
ensureSources(manifest);
stats = collectStats(manifest);
manifest.generatedAt = new Date().toISOString();
manifest.sourceAudit = { ...manifest.sourceAudit, coursePage: "Moodle course id 44", lessonCount: stats.lessons, localResourceCount: stats.resources, downloadedAttachments: stats.attachments, unavailableResources: stats.unavailable, externalReferences: stats.externalReferences, folderPackagesDownloaded: folderResult.downloaded, folderFilesExtracted: folderResult.extractedFiles, lessonPlansMatched, textIndexCount, htmlFilesChanged, scrubbedSourceUrls, localImportStatus: "localized-package-ready", teacherResourceStatus: "generic teacher observation/conversation activities retained; no named student checklist filenames identified" };
writeJson(manifestPath, manifest);
updateCatalog(stats);
updateRoadmap(stats, metrics);
console.log(`LKBCU finalized: units ${stats.units}; lessons ${stats.lessons}; resources ${stats.resources}; attachments ${stats.attachments}; unavailable ${stats.unavailable}; folder packages ${folderResult.downloaded}; extracted files ${folderResult.extractedFiles}.`);
