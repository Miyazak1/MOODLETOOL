import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = "SNC1D";
const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
const outDir = join(courseRoot, "texts", "grade-9-on-science-textbook");
const reportPath = join(projectRoot, "deployment", "SNC1D-textbook-download-report.json");
const bookUrl = "https://www.esunnybrook.com/mod/book/view.php?id=6351";

loadEnvFile(join(projectRoot, ".env"));

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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function hashText(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
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

function sanitizeSegment(value) {
  return String(value || "file")
    .replace(/%20/gi, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "file";
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
  headers.set("user-agent", "ossd-course-portal-snc1d-textbook-downloader/1.0");
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

function extractChapterLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*chapterid=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString();
    if (seen.has(href)) continue;
    seen.add(href);
    links.push({ href, label: stripTags(match[2]) });
  }
  return links;
}

function extractPdfLinks(html, baseUrl) {
  const urls = new Set();
  const attrPattern = /\b(?:href|src)\s*=\s*["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi;
  for (const match of html.matchAll(attrPattern)) {
    urls.add(new URL(match[1].replaceAll("&amp;", "&"), baseUrl).toString());
  }
  const barePattern = /https?:\/\/[^\s"'<>]+?\.pdf(?:\?[^\s"'<>]*)?/gi;
  for (const match of html.matchAll(barePattern)) {
    urls.add(match[0].replaceAll("&amp;", "&"));
  }
  return [...urls];
}

function titleFromChapter(html, fallback) {
  return stripTags(
    /<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(html)?.[1]
      || /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1]
      || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
      || fallback
  );
}

function filenameFromUrl(url) {
  try {
    return decodeURIComponent(basename(new URL(url).pathname)) || "textbook.pdf";
  } catch {
    return "textbook.pdf";
  }
}

function validatePdf(buffer) {
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    throw new Error("downloaded file is not a PDF");
  }
}

function validateZip(buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("downloaded IMS CP is not a ZIP package");
}

function chapterSortKey(material) {
  const chapter = /chapter\s*(\d+)/i.exec(material.label)?.[1] || /Chapter-(\d+)/i.exec(material.path)?.[1];
  if (chapter) return Number(chapter);
  if (/answer/i.test(material.label)) return 999;
  return 500;
}

function renderIndex(materials, pdfAttempts, imsFailure) {
  const localized = materials.filter((item) => item.type === "pdf");
  const pdfRows = pdfAttempts.length
    ? `<ul>${pdfAttempts
        .map((item) => `<li>${htmlEscape(item.label || item.page)}: ${htmlEscape(item.status)}</li>`)
        .join("")}</ul>`
    : "<p>No chapter PDF links were found in the scanned Moodle book pages.</p>";
  const localizedRows = localized.length
    ? `<ul>${localized.map((item) => `<li><a href="${htmlEscape(item.path.split("/").pop(), true)}" download>${htmlEscape(item.label)}</a></li>`).join("")}</ul>`
    : "<p>No chapter PDFs could be downloaded. The linked OSS files currently return AccessDenied.</p>";
  const imsHtml = imsFailure
    ? `<p>Moodle IMS Common Cartridge export could not be downloaded: ${htmlEscape(imsFailure)}</p>`
    : "<p>The Moodle Book IMS Common Cartridge export is included as a downloadable source package when available.</p>";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SNC1D Textbook Source Index</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #f6f8fb; color: #102033; line-height: 1.55; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px 56px; }
    article { background: #fff; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; }
    h1 { font-size: 28px; margin: 0 0 16px; border-bottom: 1px solid #edf1f6; padding-bottom: 12px; }
    h2 { font-size: 20px; margin-top: 24px; }
    li { margin: 6px 0; }
    .notice { border: 1px solid #e0b45c; border-radius: 6px; background: #fff8e8; color: #674000; padding: 10px 12px; }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>SNC1D Textbook Source Index</h1>
      <p class="notice">This index records the current Moodle Book source for Grade 9 ON Science Textbook (McGraw-Hill Ryerson). Chapter PDF links are visible in Moodle, but the external OSS host currently blocks direct downloads with AccessDenied.</p>
      <h2>Localized Chapter PDFs</h2>
      ${localizedRows}
      <h2>Moodle Book Package</h2>
      ${imsHtml}
      <h2>PDF Download Attempts</h2>
      ${pdfRows}
    </article>
  </main>
</body>
</html>
`;
}

await loginIfNeeded();
mkdirSync(outDir, { recursive: true });

const first = await request(bookUrl);
const firstHtml = await first.text();
if (!first.ok) throw new Error(`book HTTP ${first.status}`);
if (/name=["']username["']|name=["']password["']|logintoken/i.test(firstHtml)) throw new Error("Moodle login page returned.");

const chapterLinks = extractChapterLinks(firstHtml, bookUrl);
const fallbackChapterLinks = Array.from({ length: 13 }, (_, index) => {
  const chapterId = 13 + index;
  return {
    href: `${bookUrl}&chapterid=${chapterId}`,
    label: chapterId === 25 ? "Answer Key" : `Chapter ${chapterId - 12}`,
  };
});
const pages = [{ href: first.url || `${bookUrl}&chapterid=13`, label: titleFromChapter(firstHtml, "Chapter 1") }, ...chapterLinks, ...fallbackChapterLinks];
const seenPages = new Set();
const materials = [];
const failures = [];
const pdfAttempts = [];
const seenPdfUrls = new Set();

for (const page of pages) {
  if (seenPages.has(page.href)) continue;
  seenPages.add(page.href);
  try {
    const response = page.href === (first.url || bookUrl) ? first : await request(page.href);
    const html = page.href === (first.url || bookUrl) ? firstHtml : await response.text();
    if (!response.ok) throw new Error(`chapter HTTP ${response.status}`);
    const title = titleFromChapter(html, page.label || "Textbook Chapter");
    for (const pdfUrl of extractPdfLinks(html, page.href)) {
      if (seenPdfUrls.has(pdfUrl)) continue;
      seenPdfUrls.add(pdfUrl);
      try {
        const pdfResponse = await request(pdfUrl);
        const buffer = Buffer.from(await pdfResponse.arrayBuffer());
        if (!pdfResponse.ok) throw new Error(`PDF HTTP ${pdfResponse.status}`);
        validatePdf(buffer);
        const sourceName = filenameFromUrl(pdfResponse.url || pdfUrl);
        const targetName = `${hashText(pdfUrl)}-${sanitizeSegment(sourceName)}`;
        const targetPath = join(outDir, targetName);
        writeFileSync(targetPath, buffer);
        const rel = toPosix(targetPath.slice(courseRoot.length + 1));
        materials.push({
          label: title,
          type: "pdf",
          category: "textbook",
          role: /answer/i.test(title) ? "answer_key" : "chapter",
          path: rel,
          bytes: statSync(targetPath).size,
          source: pdfUrl,
          sourcePage: page.href,
        });
        pdfAttempts.push({ page: page.href, label: title, pdfUrl, status: "downloaded" });
      } catch (error) {
        const message = error?.message || String(error);
        failures.push({ page: page.href, pdfUrl, error: message });
        pdfAttempts.push({ page: page.href, label: title, pdfUrl, status: message });
      }
    }
  } catch (error) {
    failures.push({ page: page.href, error: error?.message || String(error) });
  }
}

materials.sort((a, b) => chapterSortKey(a) - chapterSortKey(b) || a.label.localeCompare(b.label));

let imsFailure = "";
try {
  const imsUrl = "https://www.esunnybrook.com/mod/book/tool/exportimscp/index.php?id=6351";
  const imsResponse = await request(imsUrl);
  const buffer = Buffer.from(await imsResponse.arrayBuffer());
  if (!imsResponse.ok) throw new Error(`IMS CP HTTP ${imsResponse.status}`);
  validateZip(buffer);
  const targetPath = join(outDir, "moodle-book-ims-cp.zip");
  writeFileSync(targetPath, buffer);
  materials.push({
    label: "SNC1D Moodle Book IMS Common Cartridge",
    type: "zip",
    category: "textbook",
    role: "source_package",
    path: toPosix(targetPath.slice(courseRoot.length + 1)),
    bytes: statSync(targetPath).size,
    source: imsUrl,
  });
} catch (error) {
  imsFailure = error?.message || String(error);
  failures.push({ page: "https://www.esunnybrook.com/mod/book/tool/exportimscp/index.php?id=6351", error: imsFailure });
}

const indexPath = join(outDir, "index.html");
writeFileSync(indexPath, renderIndex(materials, pdfAttempts, imsFailure), "utf8");
materials.unshift({
  label: "SNC1D Textbook Source Index",
  type: "html",
  category: "textbook",
  role: "source_index",
  path: toPosix(indexPath.slice(courseRoot.length + 1)),
  bytes: statSync(indexPath).size,
  source: bookUrl,
});

const manifest = readJson(manifestPath);
const text = manifest.texts?.find((item) => item.id === "grade-9-on-science-textbook");
if (!text) throw new Error("Missing grade-9-on-science-textbook entry in manifest.");
text.sourceStatus = materials.some((item) => item.type === "pdf") ? "localized_from_moodle_book_chapter_pdfs" : "moodle_book_index_localized_pdf_links_access_denied";
text.notes = materials.some((item) => item.type === "pdf")
  ? "Localized from the current SNC1D Moodle Book pages. Original chapter PDFs are linked from Moodle and saved locally here."
  : "The current SNC1D Moodle Book was scanned and a local source index was generated. The visible chapter PDF links are blocked by the external OSS host with AccessDenied, so chapter PDFs could not be downloaded.";
text.materials = materials;
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

const report = {
  generatedAt: new Date().toISOString(),
  course,
  bookUrl,
  pagesScanned: seenPages.size,
  pdfsDownloaded: materials.filter((item) => item.type === "pdf").length,
  imsDownloaded: materials.some((item) => item.role === "source_package"),
  pdfAttempts,
  failures,
  materials,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeJson(reportPath, report);
console.log(`SNC1D textbook PDFs: pages ${seenPages.size}; downloaded ${report.pdfsDownloaded}; IMS ${report.imsDownloaded ? "yes" : "no"}; failures ${failures.length}.`);
