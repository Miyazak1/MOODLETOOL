import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
loadEnv(resolve(REPO_ROOT, ".env"));

const ids = process.argv.slice(2).filter((arg) => /^\d+$/.test(arg));
if (!ids.length) {
  console.error("Usage: node scripts/probe-stmary-activity-files.mjs ACTIVITY_ID [ACTIVITY_ID...]");
  process.exit(1);
}

const BASE_URL = String(process.env.STMARY_MOODLE_BASE_URL || "http://34.30.231.58").replace(/\/+$/, "").replace(/\/login\/index\.php$/i, "");
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
  const headers = { ...(options.headers || {}) };
  const cookie = cookieHeader();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  storeCookies(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 5) {
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
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

async function login() {
  const loginUrl = `${BASE_URL}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["']\s+value=["']([^"']+)/i.exec(loginHtml)?.[1] || "";
  const username = process.env.STMARY_MOODLE_USERNAME || process.env.MOODLE_USERNAME || "";
  const password = process.env.STMARY_MOODLE_PASSWORD || process.env.MOODLE_PASSWORD || "";
  if (!username || !password) throw new Error("Missing STMARY_MOODLE_USERNAME/STMARY_MOODLE_PASSWORD or MOODLE_USERNAME/MOODLE_PASSWORD");
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, anchor: "", logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']password["']|logintoken/i.test(html) && !/Dashboard|My courses/i.test(html)) throw new Error("login failed");
}

function extractFiles(html) {
  const files = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*pluginfile\.php[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    files.push({ text: stripTags(match[2]), url: decodeEntities(match[1]) });
  }
  for (const match of html.matchAll(/<img\b[^>]*(?:alt|title)=["']([^"']+\.(?:pdf|docx?|pptx?|xlsx?|h5p|zip|mp4|jpe?g|png))["'][^>]*>/gi)) {
    files.push({ text: decodeEntities(match[1]), url: "" });
  }
  return files;
}

await login();
const results = [];
for (const id of ids) {
  const url = `${BASE_URL}/mod/assign/view.php?id=${id}`;
  const response = await request(url);
  const html = await response.text();
  results.push({
    id,
    url,
    title: stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ""),
    sawLogin: /name=["']password["']|logintoken/i.test(html),
    files: extractFiles(html),
    text: stripTags(html).slice(0, 1000),
  });
}

console.log(JSON.stringify(results, null, 2));
