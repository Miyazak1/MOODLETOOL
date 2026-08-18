import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
loadEnv(join(projectRoot, ".env"));
loadEnv(join(workspaceRoot, ".env"));

const course = (process.argv.find((arg) => arg.startsWith("--course="))?.split("=")[1] || process.argv[2] || "").toUpperCase();
if (!course) {
  console.error("Usage: node scripts/audit-stmary-course-activity-attachments.mjs --course=BAT4M");
  process.exit(1);
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifest = JSON.parse(readFileSync(join(courseRoot, "course-manifest.json"), "utf8"));
const baseUrl = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "");
const jar = new Map();

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
  const headers = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", ...(options.headers || {}) };
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
  const loginUrl = `${baseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["']\s+value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing Moodle credentials in .env");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("login failed");
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
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function fileNameFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
}

function comparableName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/%20/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFiles(html) {
  const files = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*pluginfile\.php[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = new URL(decodeEntities(match[1]), baseUrl).toString();
    const urlFileName = fileNameFromUrl(url);
    const label = stripTags(match[2]) || urlFileName;
    if (/\.(docx?|pdf|pptx?|xlsx?|h5p|zip|mp4|mov|m4v|png|jpe?g|gif|tiff?|txt|csv)($|\?)/i.test(url) || /\.[A-Za-z0-9]{2,5}$/.test(label)) {
      files.push({ label, url, fileName: urlFileName });
    }
  }
  const byKey = new Map();
  for (const file of files) byKey.set(`${file.label} ${file.url}`, file);
  return [...byKey.values()];
}

function flatten(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => flatten(item, out));
  } else if (value && typeof value === "object") {
    out.push(value);
    for (const child of ["attachments", "resources", "downloads", "evaluations", "h5p", "ispring", "videos", "bookSections", "lessons", "units", "unitResources"]) {
      if (value[child]) flatten(value[child], out);
    }
  }
  return out;
}

const items = flatten(manifest)
  .filter((item) => item && typeof item === "object" && item.source && /\/mod\/[^/]+\/view\.php\?id=\d+/i.test(item.source))
  .filter((item) => item.path && String(item.path).includes("localized-moodle-activities/"))
  .filter((item, index, arr) => arr.findIndex((other) => other.path === item.path) === index);

await login();
const results = [];
for (const item of items) {
  const response = await request(item.source);
  const html = await response.text();
  const moodleFiles = extractFiles(html).filter((file) => !/pluginfile\.php\/\d+\/mod_[^/]+\/intro\//i.test(file.url) || file.label);
  const localNames = new Set();
  for (const attachment of item.attachments || []) {
    localNames.add(comparableName(attachment.label));
    localNames.add(comparableName(attachment.path?.split("/").pop()));
    localNames.add(comparableName(attachment.downloadPath?.split("/").pop()));
  }
  const missing = moodleFiles.filter((file) => {
    return !localNames.has(comparableName(file.label)) && !localNames.has(comparableName(file.fileName));
  });
  if (moodleFiles.length || missing.length) {
    results.push({
      label: item.label,
      path: item.path,
      source: item.source,
      moodleFiles: moodleFiles.map((file) => file.fileName || file.label),
      localAttachments: [...localNames],
      missing: missing.map((file) => file.label),
    });
  }
}

const problems = results.filter((item) => item.missing.length);
console.log(JSON.stringify({ course, checked: items.length, withMoodleFiles: results.length, problems }, null, 2));
