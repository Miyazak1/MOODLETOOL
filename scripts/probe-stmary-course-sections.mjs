import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
loadEnvFile(resolve(projectRoot, ".env"));

const courseId = process.argv.find((arg) => /^\d+$/.test(arg));
if (!courseId) {
  console.error("Usage: node scripts/probe-stmary-course-sections.mjs COURSE_ID");
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

function stripTags(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
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
  headers.set("user-agent", "ossd-course-portal-stmary-section-probe/1.0");
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
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("St. Mary Moodle login failed.");
}

function links(html, pageUrl) {
  const rows = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), pageUrl).toString();
    const text = stripTags(match[2]);
    if (/\/mod\/|course\/view\.php/.test(href) || /course|unit|lesson|outline|log|final|exam|packet|answer|lab/i.test(text)) rows.push({ text, href });
  }
  return [...new Map(rows.map((row) => [`${row.text}|${row.href}`, row])).values()];
}

await login();

const out = [];
for (let section = 0; section <= 12; section += 1) {
  const url = `${BASE_URL}/course/view.php?id=${courseId}${section ? `&section=${section}` : ""}`;
  const response = await request(url);
  const html = await response.text();
  const title = stripTags(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  const sectionName = stripTags(/<h[23]\b[^>]*class=["'][^"']*(?:sectionname|section-title|h3)[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/i.exec(html)?.[1] || "");
  const foundLinks = links(html, url);
  out.push({
    section,
    status: response.status,
    url: response.url || url,
    bytes: Buffer.byteLength(html),
    title,
    sectionName,
    sawLogin: /name=["']password["']|logintoken/i.test(html),
    modLinks: foundLinks.filter((link) => /\/mod\//.test(link.href)).slice(0, 120),
    courseLinks: foundLinks.filter((link) => /course\/view\.php/.test(link.href)).slice(0, 40),
    textPreview: stripTags(html).slice(0, 400),
  });
}

console.log(JSON.stringify(out, null, 2));
