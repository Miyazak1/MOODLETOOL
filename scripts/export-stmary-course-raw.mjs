import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
loadEnvFile(resolve(projectRoot, ".env"));

const course = readArg("--course")?.toUpperCase();
const courseId = readArg("--course-id");
const sections = Number(readArg("--sections") || 0);
const includeZero = process.argv.includes("--include-zero");
if (!course || !courseId || !sections) {
  console.error("Usage: node scripts/export-stmary-course-raw.mjs --course COURSE --course-id ID --sections N");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
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
  headers.set("user-agent", "ossd-course-portal-stmary-raw-export/1.0");
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

function links(html, pageUrl) {
  const rows = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), pageUrl).toString();
    const text = stripTags(match[2]);
    rows.push({ text, href });
  }
  return [...new Map(rows.map((row) => [`${row.text}|${row.href}`, row])).values()];
}

function sectionFragment(html, sectionNo) {
  const marker = new RegExp(`<li\\b[^>]*\\bid=["']section-${sectionNo}["'][^>]*>`, "i").exec(html);
  if (!marker) {
    const main = /<section\b[^>]*\bid=["']region-main["'][^>]*>([\s\S]*?)<\/section>/i.exec(html)?.[1];
    return main || html;
  }
  return extractBalancedElement(html, marker.index, "li") || html.slice(marker.index);
}

function extractBalancedElement(html, start, tagName) {
  const tag = String(tagName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const token = new RegExp(`<\\/?${tag}\\b[^>]*>`, "ig");
  token.lastIndex = start;
  let depth = 0;
  let first = true;
  for (const match of html.matchAll(token)) {
    const index = match.index || 0;
    if (index < start) continue;
    const text = match[0];
    if (first && !new RegExp(`^<${tag}\\b`, "i").test(text)) return "";
    first = false;
    if (new RegExp(`^<${tag}\\b`, "i").test(text) && !/\/\s*>$/.test(text)) depth += 1;
    else if (new RegExp(`^</${tag}\\b`, "i").test(text)) depth -= 1;
    if (!first && depth === 0) return html.slice(start, index + text.length);
  }
  return "";
}

function modLinks(sectionHtml, pageUrl) {
  return links(sectionHtml, pageUrl).filter((link) => /\/mod\/(?:assign|book|folder|h5pactivity|lesson|page|quiz|resource|url)\/view\.php\?id=\d+/i.test(link.href));
}

await login();

const sectionDir = join(projectRoot, "inbox", `${course.toLowerCase()}-stmary-sections`);
mkdirSync(sectionDir, { recursive: true });

const exported = [];
for (let section = includeZero ? 0 : 1; section <= sections; section += 1) {
  const url = `${BASE_URL}/course/view.php?id=${courseId}${section ? `&section=${section}` : ""}`;
  const response = await request(url);
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const fragment = sectionFragment(html, section);
  const heading =
    stripTags(/<h[23]\b[^>]*class=["'][^"']*(?:sectionname|section-title)[^"']*["'][^>]*>([\s\S]*?)<\/h[23]>/i.exec(fragment)?.[1] || "") ||
    stripTags(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(fragment)?.[1] || "");
  const payload = {
    course,
    courseId: Number(courseId),
    section,
    url,
    status: response.status,
    heading,
    html,
    fragment,
    links: links(fragment, url),
    modLinks: modLinks(fragment, url),
    textPreview: stripTags(fragment).slice(0, 1000),
  };
  const outPath = join(sectionDir, `section-${String(section).padStart(2, "0")}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  exported.push({ section, heading, links: payload.modLinks.length, path: outPath });
}

console.log(JSON.stringify({ course, courseId: Number(courseId), sectionDir, exported }, null, 2));
