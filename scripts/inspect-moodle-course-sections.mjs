import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
loadEnvFile(resolve(projectRoot, ".env"));

const courseId = readArg("--course-id");
const explicitUrl = readArg("--url");

if (!courseId && !explicitUrl) {
  console.error("Usage: node scripts/inspect-moodle-course-sections.mjs --course-id ID|--url URL");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
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
    process.env[key] = line.slice(index + 1).trim();
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value) {
  return decodeEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    const value = headers.get("set-cookie") || "";
    for (const cookieText of value.split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = cookieText.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const jar = new CookieJar(process.env.MOODLE_COOKIE || "");

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-section-inspector/1.0");
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

function classIncludes(attrs, className) {
  return new RegExp(`class=["'][^"']*\\b${className}\\b`, "i").test(attrs);
}

function extractSections(html, baseUrl) {
  const markers = [];
  for (const match of html.matchAll(/<(li|section|div)\b([^>]*\bid=["']section-(\d+)["'][^>]*)>/gi)) {
    const attrs = match[2] || "";
    if (!classIncludes(attrs, "section") && !/\bdata-sectionid=/.test(attrs)) continue;
    markers.push({ index: match.index, tag: match[1].toLowerCase(), attrs, section: Number(match[3]) });
  }
  markers.sort((a, b) => a.index - b.index);
  const sections = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const next = markers[i + 1]?.index ?? html.length;
    const chunk = html.slice(marker.index, next);
    const title =
      stripTags(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(chunk)?.[1]) ||
      stripTags(/<a\b[^>]*class=["'][^"']*\bsectionname\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(chunk)?.[1]) ||
      stripTags(/<span\b[^>]*class=["'][^"']*\bsectionname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(chunk)?.[1]) ||
      `Section ${marker.section}`;
    const summary =
      stripTags(/<div\b[^>]*class=["'][^"']*\bsummary\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(chunk)?.[1]) ||
      "";
    const activities = [];
    for (const link of chunk.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = new URL(link[1].replaceAll("&amp;", "&"), baseUrl).toString();
      const text = stripTags(link[2]);
      if (!/\/mod\/(assign|resource|url|quiz|page|forum|folder|book|h5pactivity)\//i.test(href)) continue;
      if (!text) continue;
      const type = /\/mod\/([^/]+)\//i.exec(href)?.[1] || "";
      const id = /[?&]id=(\d+)/.exec(href)?.[1] || "";
      activities.push({ text, type, id, href });
    }
    sections.push({
      section: marker.section,
      title,
      summary,
      activityCount: activities.length,
      activities,
      textPreview: stripTags(chunk).slice(0, 500),
    });
  }
  return sections;
}

await loginIfNeeded();
const url = explicitUrl || `https://www.esunnybrook.com/course/view.php?id=${courseId}`;
const response = await request(url);
const html = await response.text();
if (!response.ok) throw new Error(`HTTP ${response.status}`);

console.log(JSON.stringify({
  courseId,
  url: response.url || url,
  sections: extractSections(html, response.url || url),
}, null, 2));
