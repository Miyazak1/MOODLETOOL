import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
loadEnvFile(resolve(projectRoot, ".env"));

const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) {
  console.error("Usage: node scripts/inspect-moodle-url-activity-targets.mjs 6375 [6381 ...]");
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

async function request(url, redirects = 0) {
  const headers = new Headers();
  headers.set("user-agent", "ossd-course-portal-moodle-url-target-inspector/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(url, { headers, redirect: "manual" });
  jar.store(response.headers);
  return { response, redirects };
}

function isMoodleUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.esunnybrook.com";
  } catch {
    return true;
  }
}

function extractCandidates(html, baseUrl) {
  const decoded = String(html || "").replaceAll("&amp;", "&").replaceAll("\\/", "/").replaceAll("\\u0026", "&");
  const candidates = new Set();
  const patterns = [
    /<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>]+)["']/gi,
    /\bwindow\.location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
    /\blocation\.replace\(\s*["']([^"']+)["']\s*\)/gi,
    /\b(?:href|data-url|data-href)\s*=\s*["']([^"']+)["']/gi,
    /\burl\s*:\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      const raw = String(match[1] || "").trim();
      if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) continue;
      try {
        candidates.add(new URL(raw, baseUrl).toString());
      } catch {
        // Ignore.
      }
    }
  }
  return [...candidates].filter((url) => !isMoodleUrl(url));
}

for (const id of ids) {
  const url = `https://www.esunnybrook.com/mod/url/view.php?id=${encodeURIComponent(id)}`;
  const redirectUrl = `${url}&redirect=1`;
  const redirect = await request(redirectUrl);
  const redirectText = await redirect.response.text();
  const page = await request(url);
  const html = await page.response.text();
  console.log(JSON.stringify({
    id,
    redirectStatus: redirect.response.status,
    redirectLocation: redirect.response.headers.get("location"),
    redirectContentType: redirect.response.headers.get("content-type"),
    redirectProbe: redirectText.slice(0, 220),
    pageStatus: page.response.status,
    candidates: extractCandidates(html, url).slice(0, 20),
  }, null, 2));
}
