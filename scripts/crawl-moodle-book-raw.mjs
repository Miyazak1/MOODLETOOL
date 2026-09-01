import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const inboxRoot = join(projectRoot, "inbox");

loadEnvFile(join(projectRoot, ".env"));

const course = readArg("--course")?.toUpperCase();
const unit = Number(readArg("--unit") || 0);
const bookId = Number(readArg("--book") || 0);
const explicitBaseUrl = readArg("--base-url");
const authPrefix = String(readArg("--auth-prefix") || "").trim().toUpperCase();
const timeoutMs = Math.max(10000, Number(process.env.MOODLE_ACTIVITY_TIMEOUT_MS || 60000));

if (!course || !unit || !bookId) {
  console.error("Usage: node scripts/crawl-moodle-book-raw.mjs --course COURSE --unit N --book BOOK_ID");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absolutize(raw, baseUrl) {
  try {
    return new URL(decodeEntities(raw).replaceAll("&amp;", "&"), baseUrl).toString();
  } catch {
    return "";
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
const moodleBaseUrl = normalizeBaseUrl(explicitBaseUrl || process.env.MOODLE_BASE_URL || "https://www.esunnybrook.com");

function normalizeBaseUrl(value) {
  return String(value || "https://www.esunnybrook.com")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/login\/index\.php$/i, "");
}

async function request(url, options = {}, redirects = 0) {
  const headers = new Headers(options.headers || {});
  headers.set("user-agent", "ossd-course-portal-moodle-book-crawler/1.0");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs);
  let response;
  try {
    response = await fetchWithRetry(url, { ...options, headers, redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  jar.store(response.headers);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location") && redirects < 8) {
    return request(new URL(response.headers.get("location"), url).toString(), options, redirects + 1);
  }
  return response;
}

async function fetchWithRetry(url, options, attempt = 1) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (attempt >= 3) throw error;
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    return fetchWithRetry(url, options, attempt + 1);
  }
}

function parseHiddenToken(html) {
  return /name=["']logintoken["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1] || "";
}

async function loginIfNeeded() {
  if (process.env.MOODLE_COOKIE) return;
  const username = authPrefix ? process.env[`${authPrefix}_MOODLE_USERNAME`] || process.env.MOODLE_USERNAME : process.env.MOODLE_USERNAME;
  const password = authPrefix ? process.env[`${authPrefix}_MOODLE_PASSWORD`] || process.env.MOODLE_PASSWORD : process.env.MOODLE_PASSWORD;
  if (!username || !password) throw new Error("Set MOODLE_COOKIE or MOODLE_USERNAME/MOODLE_PASSWORD.");
  const loginUrl = `${moodleBaseUrl}/login/index.php`;
  const loginPage = await request(loginUrl);
  const loginHtml = await loginPage.text();
  const token = parseHiddenToken(loginHtml);
  const body = new URLSearchParams({ username, password, anchor: "", logintoken: token });
  const response = await request(loginUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const html = await response.text();
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) {
    throw new Error("Moodle login failed.");
  }
}

async function fetchHtml(url) {
  const response = await request(url);
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  if (/name=["']username["']|name=["']password["']|logintoken/i.test(html)) throw new Error(`Moodle login page returned for ${url}`);
  return { html, url: response.url || url };
}

function extractChapterBody(html) {
  const startMatch =
    /<div\b[^>]*id=["']mod_book-chapter["'][^>]*>/i.exec(html) ||
    /<div\b[^>]*class=["'][^"']*\bbook_content\b[^"']*["'][^>]*>/i.exec(html) ||
    /<div\b[^>]*class=["'][^"']*\bgeneralbox\b[^"']*["'][^>]*>/i.exec(html);
  if (!startMatch) return "";
  const start = startMatch.index;
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tagPattern.exec(html))) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(start, match.index + tag.length);
    } else {
      depth += 1;
    }
  }
  return html.slice(start);
}

function headingsFromBody(body) {
  const headings = [];
  for (const match of body.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const text = stripTags(match[1]);
    if (text) headings.push(text);
  }
  return headings;
}

function titleFromPage(html, body) {
  return (
    stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "") ||
    headingsFromBody(body)[0] ||
    ""
  );
}

function refsFromBody(body, baseUrl) {
  const refs = [];
  for (const match of body.matchAll(/<(?<tag>a|iframe|img|source|video|script)\b[^>]*\s(?<attr>href|src|poster)\s*=\s*["'](?<url>[^"']+)["'][^>]*>(?<text>[\s\S]*?)(?:<\/\k<tag>>)?/gi)) {
    const url = absolutize(match.groups.url, baseUrl);
    if (!url) continue;
    refs.push({
      attr: match.groups.attr.toLowerCase(),
      tag: match.groups.tag.toLowerCase(),
      text: stripTags(match.groups.text || ""),
      url,
    });
  }
  return refs;
}

function normalizeLabel(value, index) {
  const text = stripTags(value);
  const lower = text.toLowerCase();
  if (!text && index === 1) return "Lesson";
  if (/^lesson\s*(?:\d+\.)?\d+\s*[:：]/i.test(lower)) return "Lesson Expectations";
  if (lower.includes("expectation") || lower === "overview" || lower === "introduction") return "Lesson Expectations";
  if (lower.includes("hands")) return "Hands On";
  if (lower.includes("consolidation")) return "Consolidation";
  if (lower.includes("homework")) return "Homework";
  if (lower === "lesson") return "Lesson";
  return text || `Section ${index}`;
}

function extractTocLinks(html, baseUrl) {
  const seen = new Set();
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["'](?<href>[^"']*view\.php\?id=\d+[^"']*)["'][^>]*>(?<text>[\s\S]*?)<\/a>/gi)) {
    const url = absolutize(match.groups.href, baseUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (Number(parsed.searchParams.get("id")) !== bookId) continue;
    const chapterId = parsed.searchParams.get("chapterid") || "";
    if (!chapterId || seen.has(chapterId)) continue;
    const text = stripTags(match.groups.text);
    if (
      !text ||
      parsed.searchParams.has("lang") ||
      /^previous|next|print book|print this chapter$/i.test(text) ||
      /^(?:english|简体中文|繁體中文|français|español)\b/i.test(text)
    ) continue;
    seen.add(chapterId);
    links.push({ chapterId, text, url });
  }
  return links;
}

function splitLessons(pages) {
  const lessons = [];
  let current = null;
  for (const page of pages) {
    const headings = page.heading || [];
    const first = headings[0] || page.linkText || "";
    const lessonNumber = Number(/lesson\s*(?:\d+\.)?(\d+)/i.exec(first)?.[1] || 0);
    const pageLabel = normalizeLabel(headings[1] || page.linkText, (current?.sections?.length || 0) + 1);
    if (!current || (lessonNumber && lessonNumber !== current.lesson) || pageLabel === "Lesson Expectations") {
      current = {
        lesson: lessonNumber || lessons.length + 1,
        title: first || `Lesson ${lessons.length + 1}`,
        sections: [],
      };
      lessons.push(current);
    }
    if ((!current.title || /^lesson\s*\d+$/i.test(current.title)) && first) current.title = first;
    current.sections.push({
      label: pageLabel,
      url: page.url,
      normalizedLabel: pageLabel,
      sectionIndex: current.sections.length + 1,
      page,
    });
  }
  return lessons.map((lesson, index) => ({ ...lesson, lesson: index + 1 }));
}

await loginIfNeeded();
const startUrl = `${moodleBaseUrl}/mod/book/view.php?id=${bookId}`;
const first = await fetchHtml(startUrl);
const chapterLinks = extractTocLinks(first.html, first.url);
if (!chapterLinks.length) throw new Error(`No chapter links found for book ${bookId}.`);

const pages = [];
{
  const body = extractChapterBody(first.html);
  const heading = headingsFromBody(body);
  pages.push({
    linkText: heading[0] || "Lesson Expectations",
    heading,
    html: body,
    navError: "",
    refs: refsFromBody(body, first.url),
    textPreview: stripTags(body).slice(0, 500),
    title: titleFromPage(first.html, body),
    url: first.url,
  });
}
for (const link of chapterLinks) {
  const pageHtml = await fetchHtml(link.url);
  const body = extractChapterBody(pageHtml.html);
  const heading = headingsFromBody(body);
  pages.push({
    linkText: link.text,
    heading,
    html: body,
    navError: "",
    refs: refsFromBody(body, pageHtml.url),
    textPreview: stripTags(body).slice(0, 500),
    title: titleFromPage(pageHtml.html, body),
    url: pageHtml.url,
  });
}

const raw = {
  course,
  unit,
  bookId,
  scrapedAt: new Date().toISOString(),
  lessons: splitLessons(pages),
};

mkdirSync(inboxRoot, { recursive: true });
const outputPath = join(inboxRoot, `moodle-book-raw-${course}-U${String(unit).padStart(2, "0")}.json`);
writeFileSync(outputPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      outputPath,
      course,
      unit,
      bookId,
      chapterCount: pages.length,
      lessonCount: raw.lessons.length,
      sectionsPerLesson: raw.lessons.map((lesson) => lesson.sections.length),
      titles: raw.lessons.map((lesson) => lesson.title),
    },
    null,
    2,
  ),
);
