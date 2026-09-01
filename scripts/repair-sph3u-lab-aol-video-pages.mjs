import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SPH3U";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");

const labs = [
  { unit: 1, id: 8933, title: "Unit 1 Lab (AOL)" },
  { unit: 2, id: 8953, title: "Unit 2 Lab (AOL)" },
  { unit: 3, id: 8973, title: "Unit 3 Lab (AOL)" },
  { unit: 4, id: 8994, title: "Unit 4 Lab (AOL)" },
  { unit: 5, id: 9015, title: "Unit 5 Lab (AOL)" },
];

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

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function courseRelative(fromRel, targetRel) {
  return toPosix(relative(dirname(fromRel), targetRel));
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(String(url).replaceAll("&amp;", "&"));
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return String(url || "").replaceAll("&amp;", "&");
  }
}

function isMediaAttachment(item) {
  const type = String(item?.type || "").toLowerCase();
  return ["mp4", "m4v", "mov", "webm", "mp3", "m4a", "wav", "ogg"].includes(type);
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

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-sph3u-lab-repair/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

function parseHiddenToken(html) {
  return /name=["']logintoken["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] || "";
}

function isLoginPageContent(value) {
  return /Welcome to Sunnybrook|Enter your details to log in|Forgot your password|logintoken|用户名|密码/i.test(stripTags(value));
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = "https://www.esunnybrook.com/login/index.php";
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: parseHiddenToken(loginHtml) }),
  });
  const text = await response.text();
  if (isLoginPageContent(text)) throw new Error("Moodle login failed.");
}

function extractBalancedDiv(html, startIndex) {
  let depth = 0;
  const pattern = /<\/?div\b[^>]*>/gi;
  pattern.lastIndex = startIndex;
  for (const match of html.matchAll(pattern)) {
    if (match.index < startIndex) continue;
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, match.index + match[0].length);
    } else {
      depth += 1;
    }
  }
  return "";
}

function extractIntro(html) {
  const start = /<div\b[^>]*\bclass=["'][^"']*\bactivity-description\b[^"']*["'][^>]*\bid=["']intro["'][^>]*>/i.exec(html);
  if (start?.[0]) {
    const block = extractBalancedDiv(html, start.index);
    if (block) return block.replace(start[0], "").replace(/<\/div>\s*$/i, "");
  }
  return "";
}

function cleanBody(rawHtml) {
  return String(rawHtml || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*<\/p>/gi, "")
    .replace(/<span\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*<\/span>/gi, "")
    .replace(/(<video\b[\s\S]*?<a\b[^>]*>)[\s\S]*?(<\/a>[\s\S]*?<\/video>)/gi, "$1Local video file$2")
    .replace(/\s(?:width|height)=["'][^"']*["']/gi, "")
    .replace(/\sclass=["']video-js["']/gi, "")
    .replace(/\sdata-setup-lazy=["'][^"']*["']/gi, "")
    .replace(/\sid=["']id_videojs_[^"']*["']/gi, "");
}

function localizePluginfileRefs({ body, source, indexRel, bySource }) {
  return body.replace(/\b(href|src|poster)\s*=\s*["']([^"']*(?:pluginfile\.php|draftfile\.php|forcedownload=1)[^"']*)["']/gi, (match, attr, raw) => {
    const normalized = normalizeUrl(new URL(raw.replaceAll("&amp;", "&"), source).toString());
    const attachment = bySource.get(normalized);
    if (attachment?.path) return `${attr}="${htmlEscape(courseRelative(indexRel, attachment.path), true)}"`;
    return `data-localized-link="${attr}-unavailable"`;
  });
}

function activityHtml(title, body, attachments) {
  const rows = attachments
    .filter((item) => !isMediaAttachment(item))
    .map((item) => {
      const href = courseRelative(item.ownerPath, item.path);
      const view = item.previewPath ? courseRelative(item.ownerPath, item.previewPath) : href;
      return `<li><span class="file-label">${htmlEscape(item.label)}</span><span class="file-actions"><a class="file-action" href="${htmlEscape(view, true)}">查看</a><a class="file-action" href="${htmlEscape(href, true)}" download>下载</a></span></li>`;
    })
    .join("");
  const files = rows ? `<section class="attachments"><h2>Files</h2><ul>${rows}</ul></section>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.6; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 28px; }
    h1 { font-size: 30px; margin: 0 0 18px; border-bottom: 1px solid #edf1f6; padding-bottom: 16px; }
    h2 { font-size: 20px; margin-top: 24px; }
    a { color: #00396f; font-weight: 700; }
    img, iframe { max-width: 100%; }
    .activity-body { margin-top: 20px; }
    .activity-body .mediaplugin_videojs > div, .activity-body video { display: block; margin: 18px auto; max-width: 900px !important; width: 100%; }
    .activity-body video { aspect-ratio: 16 / 9; background: #000; height: auto; }
    .attachments { border-top: 1px solid #edf1f6; margin-top: 24px; padding-top: 14px; }
    .attachments ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .attachments li { align-items: center; background: #f8fbff; border: 1px solid #d9e6f5; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; }
    .file-label { overflow-wrap: anywhere; }
    .file-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }
    .file-action { border: 1px solid #9bbce3; border-radius: 6px; color: #00396f; display: inline-flex; font-size: 14px; font-weight: 700; line-height: 1; padding: 7px 12px; text-decoration: none; }
    .file-action:hover { background: #eef6ff; }
    @media (max-width: 640px) { main { padding: 0; } article { border-left: 0; border-right: 0; border-radius: 0; } .attachments li { align-items: flex-start; flex-direction: column; } }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${htmlEscape(title)}</h1>
      <div class="activity-body">${body}</div>
      ${files}
    </article>
  </main>
</body>
</html>
`;
}

function videoResourceFromAttachment(lab, attachment, owner) {
  const abs = join(courseRoot, attachment.path);
  return {
    label: attachment.label,
    type: attachment.type,
    category: "localized_moodle_media",
    role: "aol_assessment_video",
    path: attachment.path,
    bytes: existsSync(abs) ? statSync(abs).size : attachment.bytes,
    source: attachment.source,
    moodleActivityId: `${lab.id}-video`,
    unit: lab.unit,
    parentActivityId: String(lab.id),
    parentLabel: owner.label,
    sourceGroup: "evaluation",
  };
}

function findExistingLabVideo(manifest, evaluations, lab) {
  const candidates = [
    ...(evaluations || []),
    ...(manifest.evaluations || []),
  ];
  return candidates.find((item) => (
    isMediaAttachment(item) &&
    (
      String(item.parentActivityId || "") === String(lab.id) ||
      String(item.moodleActivityId || "") === `${lab.id}-video` ||
      (String(item.path || "").includes(`assign-${lab.id}-`) && /LabVideo/i.test(String(item.label || item.path || "")))
    )
  ));
}

function updateList(list, lab, htmlRecord, videoRecord) {
  if (!Array.isArray(list)) return 0;
  let changed = 0;
  for (const item of list) {
    if (String(item.moodleActivityId || "") !== String(lab.id)) continue;
    item.attachments = (item.attachments || []).filter((attachment) => !isMediaAttachment(attachment));
    item.textPreview = htmlRecord.textPreview;
    item.bytes = htmlRecord.bytes;
    delete item.downloadPath;
    delete item.downloadUrl;
    changed += 1;
  }
  const htmlIndex = list.findIndex((item) => String(item.moodleActivityId || "") === String(lab.id));
  if (htmlIndex >= 0 && videoRecord) {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const item = list[index];
      if (item?.path === videoRecord.path || String(item?.moodleActivityId || "") === String(videoRecord.moodleActivityId)) list.splice(index, 1);
    }
    list.splice(htmlIndex + 1, 0, videoRecord);
    changed += 1;
  }
  return changed;
}

await loginIfNeeded();

const manifest = readJson(manifestPath);
const reports = [];

for (const lab of labs) {
  const source = `https://www.esunnybrook.com/mod/assign/view.php?id=${lab.id}`;
  const unit = (manifest.units || []).find((item) => Number(item.unit) === lab.unit);
  const evaluations = (unit?.unitResources || {}).evaluations || [];
  const owner = evaluations.find((item) => String(item.moodleActivityId || "") === String(lab.id)) || (manifest.evaluations || []).find((item) => String(item.moodleActivityId || "") === String(lab.id));
  if (!owner?.path) throw new Error(`Missing manifest record for ${lab.title}`);
  const existingVideo = findExistingLabVideo(manifest, evaluations, lab);

  const response = await request(source);
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
  if (isLoginPageContent(rawHtml)) throw new Error(`Moodle login page returned for ${source}`);

  const bySource = new Map();
  for (const attachment of owner.attachments || []) bySource.set(normalizeUrl(attachment.source), attachment);
  if (existingVideo?.source) bySource.set(normalizeUrl(existingVideo.source), existingVideo);

  const bodyRaw = extractIntro(rawHtml);
  if (!stripTags(bodyRaw) || !/pluginfile\.php/i.test(bodyRaw)) throw new Error(`Could not extract Moodle intro with media for ${lab.title}`);
  let body = localizePluginfileRefs({ body: bodyRaw, source, indexRel: owner.path, bySource });
  body = cleanBody(body);

  const htmlAbs = join(courseRoot, owner.path);
  const pageAttachments = (owner.attachments || []).map((item) => ({ ...item, ownerPath: owner.path }));
  mkdirSync(dirname(htmlAbs), { recursive: true });
  writeFileSync(htmlAbs, activityHtml(lab.title, body, pageAttachments), "utf8");

  const videoAttachment = (owner.attachments || []).find(isMediaAttachment) || existingVideo;
  const videoRecord = videoAttachment ? videoResourceFromAttachment(lab, videoAttachment, owner) : null;
  const htmlRecord = {
    bytes: statSync(htmlAbs).size,
    textPreview: stripTags(body).slice(0, 800),
  };

  const changes = updateList(evaluations, lab, htmlRecord, videoRecord) + updateList(manifest.evaluations || [], lab, htmlRecord, videoRecord);
  reports.push({ lab: lab.title, path: owner.path, video: videoRecord?.path || "", changes, textPreview: htmlRecord.textPreview.slice(0, 140) });
}

writeJson(manifestPath, manifest);
console.log(JSON.stringify({ course, repaired: reports.length, reports }, null, 2));
