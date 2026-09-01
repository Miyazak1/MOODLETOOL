import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
loadEnvFile(resolve(projectRoot, ".env"));

const ids = process.argv.slice(2).filter((arg) => /^\d+$/.test(arg));
if (!ids.length) {
  console.error("Usage: node scripts/inspect-stmary-course.mjs COURSE_ID [COURSE_ID...]");
  process.exit(1);
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
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

function baseUrl() {
  return String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/login\/index\.php$/i, "");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
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
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  }
}

const BASE_URL = baseUrl();
const jar = new CookieJar();

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-stmary-course-inspector/1.0");
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
  const loginUrl = `${BASE_URL}/login/index.php`;
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
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St. Mary Moodle login failed.");
}

function extractLinks(html, pageUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), pageUrl).toString();
    const text = stripTags(match[2]);
    if (!text && !/mod\/|course\/view/.test(href)) continue;
    links.push({ text, href });
  }
  return links;
}

function extractSections(html) {
  const sections = [];
  for (const match of html.matchAll(/<li\b[^>]*\bid=["']section-(\d+)["'][^>]*>([\s\S]*?)(?=<li\b[^>]*\bid=["']section-\d+["']|<\/ul>\s*<\/div>)/gi)) {
    const number = Number(match[1]);
    const body = match[2];
    const heading =
      stripTags(/<h[23]\b[^>]*class=["'][^"']*(?:sectionname|section-title)[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/i.exec(body)?.[1] || "") ||
      stripTags(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(body)?.[1] || "") ||
      stripTags(/data-sectionname=["']([^"']+)["']/i.exec(body)?.[1] || "");
    const activities = extractLinks(body, BASE_URL).filter((link) => /\/mod\/(?:assign|book|folder|h5pactivity|lesson|page|quiz|resource|url)\/view\.php\?id=\d+/i.test(link.href));
    sections.push({ number, heading, activities });
  }
  return sections;
}

await login();

const output = [];
for (const id of ids) {
  const url = `${BASE_URL}/course/view.php?id=${id}`;
  const response = await request(url);
  const html = await response.text();
  const title =
    stripTags(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || "") ||
    stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  const links = extractLinks(html, url);
  const activities = links.filter((link) => /\/mod\/(?:assign|book|folder|h5pactivity|lesson|page|quiz|resource|url)\/view\.php\?id=\d+/i.test(link.href));
  output.push({
    id,
    status: response.status,
    url: response.url || url,
    title,
    sawLogin: /name=["']password["']|logintoken/i.test(html),
    activityCount: activities.length,
    activities: activities.slice(0, 80),
    sections: extractSections(html).map((section) => ({
      number: section.number,
      heading: section.heading,
      activityCount: section.activities.length,
      activities: section.activities.slice(0, 30),
    })),
  });
}

console.log(JSON.stringify(output, null, 2));
