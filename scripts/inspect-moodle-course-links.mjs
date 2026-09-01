import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
loadEnvFile(resolve(projectRoot, '.env'));

const courseId = readArg('--course-id');
const explicitUrl = readArg('--url');
const filter = new RegExp(readArg('--filter') || 'course|outline|unit|lesson|book|assign|resource|url|page|quiz|h5p', 'i');

if (!courseId && !explicitUrl) {
  console.error('Usage: node scripts/inspect-moodle-course-links.mjs --course-id ID|--url URL [--filter REGEX]');
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (process.env[key]) continue;
    process.env[key] = line.slice(index + 1).trim();
  }
}

function stripTags(value) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

class CookieJar {
  constructor(initialCookie) {
    this.cookies = new Map();
    for (const part of String(initialCookie || '').split(';')) {
      const index = part.indexOf('=');
      if (index > 0) this.cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
  }

  store(headers) {
    const value = headers.get('set-cookie') || '';
    for (const cookieText of value.split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = cookieText.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

const jar = new CookieJar(process.env.MOODLE_COOKIE || '');

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set('user-agent', 'ossd-course-portal-course-link-inspector/1.0');
  const cookie = jar.header();
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(url, { ...options, headers, redirect: 'manual' });
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location') && redirects < 8) {
    return request(new URL(response.headers.get('location'), url).toString(), options, redirects + 1);
  }
  return response;
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error('Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.');
  const loginUrl = 'https://www.esunnybrook.com/login/index.php';
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = /name=["']logintoken["'][^>]*value=["']([^"']+)/i.exec(loginHtml)?.[1] || '';
  const response = await request(loginUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, anchor: '', logintoken: token }),
  });
  const html = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error('Moodle login failed.');
}

await loginIfNeeded();
const url = explicitUrl || `https://www.esunnybrook.com/course/view.php?id=${courseId}`;
const response = await request(url);
const html = await response.text();
if (!response.ok) throw new Error(`HTTP ${response.status}`);

const links = [];
for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
  const href = new URL(match[1].replaceAll('&amp;', '&'), response.url || url).toString();
  const text = stripTags(match[2]);
  if (!filter.test(`${text} ${href}`)) continue;
  links.push({ text, href });
}
const media = [];
for (const match of html.matchAll(/<(?<tag>iframe|img|source|video|script)\b[^>]*\s(?<attr>href|src|poster)\s*=\s*["'](?<url>[^"']+)["'][^>]*>/gi)) {
  const href = new URL(match.groups.url.replaceAll('&amp;', '&'), response.url || url).toString();
  if (!filter.test(href)) continue;
  media.push({ tag: match.groups.tag.toLowerCase(), attr: match.groups.attr.toLowerCase(), href });
}

console.log(JSON.stringify({ courseId, url: response.url || url, linkCount: links.length, links, mediaCount: media.length, media }, null, 2));
