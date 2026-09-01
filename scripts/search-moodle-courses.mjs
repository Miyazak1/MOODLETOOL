import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
loadEnvFile(resolve(projectRoot, ".env"));

const queries = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!queries.length) {
  console.error("Usage: node scripts/search-moodle-courses.mjs QUERY [QUERY...]");
  process.exit(1);
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
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
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
  headers.set("user-agent", "ossd-course-portal-moodle-course-search/1.0");
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
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(text)) throw new Error("Moodle login failed.");
}

await loginIfNeeded();

const output = [];
for (const query of queries) {
  const searchUrl = `https://www.esunnybrook.com/course/search.php?search=${encodeURIComponent(query)}`;
  const response = await request(searchUrl);
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${searchUrl}`);
  const hits = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*course\/view\.php\?id=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), searchUrl).toString();
    const text = stripTags(match[2]);
    if (!text) continue;
    hits.push({ text, href });
  }
  output.push({ query, hits: [...new Map(hits.map((hit) => [hit.href, hit])).values()] });
}

console.log(JSON.stringify(output, null, 2));
