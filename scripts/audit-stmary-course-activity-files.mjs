import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
loadEnv(resolve(projectRoot, ".env"));

const course = (readArg("--course") || "SNC1D").toUpperCase();
const courseRoot = resolve(projectRoot, "..", "courseware", course);
const manifestPath = `${courseRoot}/course-manifest.json`;
const outPath = readArg("--out") ? resolve(projectRoot, readArg("--out")) : resolve(projectRoot, "deployment", `${course.toLowerCase()}-moodle-activity-file-audit.json`);
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "").replace(/\/login\/index\.php$/i, "");
const jar = new Map();

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

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
  const headers = { "user-agent": "ossd-course-portal-activity-audit/1.0", ...(options.headers || {}) };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
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

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractBalancedDiv(html, start) {
  const openEnd = html.indexOf(">", start);
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

function extractIntro(html) {
  const match = /<div\b[^>]*\bid=["']intro["'][^>]*>/i.exec(html);
  return match ? extractBalancedDiv(html, match.index) : "";
}

function extractFiles(html, sourceUrl) {
  const byUrl = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*pluginfile\.php[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = new URL(decodeEntities(match[1]), sourceUrl).toString();
    byUrl.set(url, { label: stripTags(match[2]) || decodeURIComponent(new URL(url).pathname.split("/").pop() || ""), url });
  }
  return [...byUrl.values()];
}

function collectActivities(manifest) {
  const activities = [];
  function walk(value, path = []) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, path.concat(index)));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.moodleActivityId && value.mod) {
      activities.push({
        manifestPath: path,
        label: value.label,
        mod: value.mod,
        id: String(value.moodleActivityId),
        localAttachments: value.attachments?.length || 0,
        localTextLength: stripTags(value.textPreview || "").length,
        path: value.path || "",
      });
    }
    for (const [key, item] of Object.entries(value)) walk(item, path.concat(key));
  }
  walk(manifest);
  return activities;
}

async function login() {
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing Moodle credentials in env.");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("Moodle login failed.");
}

await login();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const activities = collectActivities(manifest);
const rows = [];
for (const activity of activities) {
  const url = `${baseUrl}/mod/${activity.mod}/view.php?id=${activity.id}`;
  const response = await request(url);
  const html = await response.text();
  const introText = stripTags(extractIntro(html));
  const files = extractFiles(html, url);
  rows.push({
    ...activity,
    url,
    status: response.status,
    sawLogin: /name=["']password["']|logintoken/i.test(html),
    moodleIntroLength: introText.length,
    moodleIntroPreview: introText.slice(0, 280),
    moodleFiles: files,
    needsAttention: files.length > activity.localAttachments || (introText.length > 0 && activity.localTextLength === 0),
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  course,
  activityCount: rows.length,
  needsAttention: rows.filter((row) => row.needsAttention),
  rows,
};
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ course, activityCount: rows.length, needsAttention: report.needsAttention.length, outPath }, null, 2));
