import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const deploymentRoot = join(projectRoot, "deployment");
const courseArg = readArg("--course")?.toUpperCase();
const dryRun = process.argv.includes("--dry-run");

const SOURCES = [
  {
    course: "ENG2D",
    textId: "othello",
    filename: "Othello_Project_Gutenberg_1531.txt",
    sourceKind: "urlText",
    sourceUrl: "https://www.gutenberg.org/cache/epub/1531/pg1531.txt",
    sourceLabel: "Project Gutenberg eBook #1531",
    rights: "Public domain in the USA according to Project Gutenberg.",
  },
  {
    course: "ENG2D",
    textId: "lady-or-the-tiger",
    filename: "The_Lady_or_the_Tiger_Wikisource.txt",
    sourceKind: "wikisourceExtract",
    page: "The lady, or the tiger? and other stories/The Lady, or the Tiger?",
    sourceUrl: "https://en.wikisource.org/wiki/The_lady,_or_the_tiger%3F_and_other_stories/The_Lady,_or_the_Tiger%3F",
    sourceLabel: "Wikisource transcription",
    rights: "Underlying work is public domain; Wikisource transcription is available under its site terms.",
  },
  {
    course: "ENG2D",
    textId: "the-interlopers",
    filename: "The_Interlopers_Wikisource.txt",
    sourceKind: "wikisourceExtract",
    page: "The Interlopers",
    sourceUrl: "https://en.wikisource.org/wiki/The_Interlopers",
    sourceLabel: "Wikisource transcription",
    rights: "Underlying work is public domain; Wikisource transcription is available under its site terms.",
  },
  {
    course: "ENG2D",
    textId: "the-rocking-horse-winner",
    filename: "The_Rocking_Horse_Winner_Pressbooks.txt",
    sourceKind: "htmlTextSection",
    sourceUrl: "https://viva.pressbooks.pub/compreader/chapter/the-rocking-horse-winner/",
    sourceLabel: "VIVA Pressbooks, Let's Read: A Collection of Texts for College Composition",
    rights: "Source page marks this work as public domain / free of known copyright restrictions.",
    startMarker: "<p>There was a woman",
    endMarker: "<hr />",
  },
  {
    course: "ENG2D",
    textId: "myth-of-prometheus",
    filename: "Prometheus_Project_Gutenberg_9313.txt",
    sourceKind: "urlTextSection",
    sourceUrl: "https://www.gutenberg.org/cache/epub/9313/pg9313.txt",
    sourceLabel: "Project Gutenberg eBook #9313, Old Greek Folk Stories Told Anew",
    rights: "Public domain in the USA according to Project Gutenberg.",
    startMarker: "PROMETHEUS.",
    endMarker: "THE DELUGE.",
  },
  {
    course: "ENG2D",
    textId: "daedalus-and-icarus",
    filename: "Icarus_and_Daedalus_Project_Gutenberg_9313.txt",
    sourceKind: "urlTextSection",
    sourceUrl: "https://www.gutenberg.org/cache/epub/9313/pg9313.txt",
    sourceLabel: "Project Gutenberg eBook #9313, Old Greek Folk Stories Told Anew",
    rights: "Public domain in the USA according to Project Gutenberg.",
    startMarker: "ICARUS AND DAEDALUS.",
    endMarker: "PHAETHON.",
  },
  {
    course: "ENG2D",
    textId: "queen-elizabeth-address-to-the-troops",
    filename: "Speech_to_the_Troops_at_Tilbury_Wikisource.txt",
    sourceKind: "wikisourceExtract",
    page: "Speech to the Troops at Tilbury",
    sourceUrl: "https://en.wikisource.org/wiki/Speech_to_the_Troops_at_Tilbury",
    sourceLabel: "Wikisource transcription",
    rights: "Historical speech text; Wikisource transcription is available under its site terms.",
  },
  {
    course: "ENG2D",
    textId: "jfk-inaugural-address",
    filename: "JFK_Inaugural_Address_Project_Gutenberg_3.txt",
    sourceKind: "urlText",
    sourceUrl: "https://www.gutenberg.org/cache/epub/3/pg3.txt",
    sourceLabel: "Project Gutenberg eBook #3",
    rights: "Public domain in the USA according to Project Gutenberg.",
  },
  {
    course: "ENG2D",
    textId: "pearl-harbor-address",
    filename: "Day_of_Infamy_Speech_Project_Gutenberg_21805.txt",
    sourceKind: "urlText",
    sourceUrl: "https://www.gutenberg.org/cache/epub/21805/pg21805.txt",
    sourceLabel: "Project Gutenberg eBook #21805",
    rights: "Public domain in the USA according to Project Gutenberg.",
  },
  {
    course: "OLC4O",
    textId: "the-road-not-taken",
    filename: "The_Road_Not_Taken_Wikisource.txt",
    sourceKind: "wikisourceExtract",
    page: "Mountain Interval/The Road Not Taken",
    sourceUrl: "https://en.wikisource.org/wiki/Road_Not_Taken",
    sourceLabel: "Wikisource transcription of Mountain Interval/The Road Not Taken",
    rights: "Public domain in the United States; first published before January 1, 1931 according to Wikisource.",
  },
];

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  throw lastError;
}

async function fetchWikisourceExtract(page) {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    redirects: "1",
    format: "json",
    formatversion: "2",
    titles: page,
  });
  const data = JSON.parse(await fetchText(`https://en.wikisource.org/w/api.php?${params}`));
  const pageData = data.query?.pages?.[0];
  if (!pageData?.extract) return fetchWikisourceParseText(page);
  return pageData.extract;
}

async function fetchWikisourceParseText(page) {
  const params = new URLSearchParams({
    action: "parse",
    page,
    prop: "text",
    redirects: "1",
    format: "json",
    formatversion: "2",
  });
  const data = JSON.parse(await fetchText(`https://en.wikisource.org/w/api.php?${params}`));
  const html = data.parse?.text;
  if (!html) throw new Error(`No Wikisource text for ${page}`);
  return htmlToText(html);
}

function htmlToText(html) {
  return htmlDecode(
    String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<sup[\s\S]*?<\/sup>/gi, "")
      .replace(/<\/(p|div|section|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

async function loadSource(source) {
  if (source.sourceKind === "urlText") return fetchText(source.sourceUrl);
  if (source.sourceKind === "urlTextSection") {
    const text = await fetchText(source.sourceUrl);
    return extractTextSection(text, source.startMarker, source.endMarker);
  }
  if (source.sourceKind === "htmlTextSection") {
    const html = await fetchText(source.sourceUrl);
    return htmlToText(extractTextSection(html, source.startMarker, source.endMarker));
  }
  if (source.sourceKind === "wikisourceExtract") return fetchWikisourceExtract(source.page);
  throw new Error(`Unsupported source kind: ${source.sourceKind}`);
}

function extractTextSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing section start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Missing section end marker: ${endMarker}`);
  return text.slice(start, end).trim();
}

function textHeader(source) {
  return [
    source.filename.replace(/[_-]/g, " ").replace(/\.[^.]+$/, ""),
    "",
    `Source: ${source.sourceLabel}`,
    `Source URL: ${source.sourceUrl}`,
    `Rights note: ${source.rights}`,
    "",
    "----",
    "",
  ].join("\n");
}

function patchManifest(course, imports) {
  const manifestPath = join(coursewareRoot, course, "course-manifest.json");
  const manifest = readJson(manifestPath);
  const byText = new Map(imports.map((item) => [item.textId, item]));
  for (const text of manifest.texts || []) {
    const item = byText.get(text.id);
    if (!item) continue;
    text.sourceStatus = "downloadable";
    text.materials = [
      {
        label: item.filename,
        type: "txt",
        category: "text_material",
        role: "core_text",
        path: item.path,
        bytes: item.bytes,
      },
    ];
    text.publicDomainSource = {
      label: item.sourceLabel,
      url: item.sourceUrl,
      rights: item.rights,
    };
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function existingImport(source) {
  const relativePath = toPosix(`texts/${source.textId}/${source.filename}`);
  const targetPath = join(coursewareRoot, source.course, "texts", source.textId, source.filename);
  if (!existsSync(targetPath)) return null;
  return {
    course: source.course,
    textId: source.textId,
    filename: source.filename,
    path: relativePath,
    bytes: statSync(targetPath).size,
    sourceUrl: source.sourceUrl,
    sourceLabel: source.sourceLabel,
    rights: source.rights,
    reusedExisting: true,
  };
}

function renderMarkdown(report) {
  const lines = ["# Public Domain Text Import Report", "", `Generated: ${report.generatedAt}`, ""];
  lines.push(`Course: ${report.course || "all"}`);
  lines.push(`Dry run: ${report.dryRun ? "yes" : "no"}`);
  lines.push("");
  lines.push(`Imported: ${report.imports.length}`);
  lines.push(`Failed: ${report.failures.length}`);
  lines.push("");
  if (report.imports.length) {
    lines.push("## Imported", "");
    lines.push("| Course | Text ID | File | Bytes | Reused | Source |");
    lines.push("| --- | --- | --- | ---: | --- | --- |");
    for (const item of report.imports) {
      lines.push(`| ${item.course} | ${item.textId} | ${item.path} | ${item.bytes} | ${item.reusedExisting ? "yes" : "no"} | ${item.sourceUrl} |`);
    }
    lines.push("");
  }
  if (report.failures.length) {
    lines.push("## Failures", "");
    lines.push("| Course | Text ID | Source | Error |");
    lines.push("| --- | --- | --- | --- |");
    for (const item of report.failures) {
      lines.push(`| ${item.course} | ${item.textId} | ${item.sourceUrl} | ${String(item.error).replaceAll("|", "\\|")} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

let selected = SOURCES;
if (courseArg) selected = selected.filter((source) => source.course === courseArg);

const report = {
  generatedAt: new Date().toISOString(),
  course: courseArg || null,
  dryRun,
  sources: selected,
  imports: [],
  failures: [],
};

for (const source of selected) {
  try {
    if (dryRun) {
      report.imports.push({
        course: source.course,
        textId: source.textId,
        filename: source.filename,
        path: toPosix(`texts/${source.textId}/${source.filename}`),
        bytes: 0,
        sourceUrl: source.sourceUrl,
        sourceLabel: source.sourceLabel,
        rights: source.rights,
      });
      continue;
    }
    const text = `${textHeader(source)}${normalizeText(await loadSource(source))}\n`;
    const targetDir = join(coursewareRoot, source.course, "texts", source.textId);
    mkdirSync(targetDir, { recursive: true });
    const targetPath = join(targetDir, source.filename);
    writeFileSync(targetPath, text, "utf8");
    report.imports.push({
      course: source.course,
      textId: source.textId,
      filename: source.filename,
      path: toPosix(`texts/${source.textId}/${source.filename}`),
      bytes: Buffer.byteLength(text, "utf8"),
      sourceUrl: source.sourceUrl,
      sourceLabel: source.sourceLabel,
      rights: source.rights,
    });
    console.log(`Imported ${source.course} ${source.textId}`);
  } catch (error) {
    const existing = existingImport(source);
    if (existing) {
      report.imports.push(existing);
      console.warn(`Reused existing ${source.course} ${source.textId}: ${error.message || error}`);
      continue;
    }
    report.failures.push({
      course: source.course,
      textId: source.textId,
      sourceUrl: source.sourceUrl,
      error: String(error.message || error),
    });
    console.error(`Failed ${source.course} ${source.textId}: ${error.message || error}`);
  }
}

if (!dryRun) {
  for (const course of new Set(report.imports.map((item) => item.course))) {
    patchManifest(course, report.imports.filter((item) => item.course === course));
  }
}

mkdirSync(deploymentRoot, { recursive: true });
const suffix = courseArg ? `-${courseArg}` : "";
writeFileSync(join(deploymentRoot, `public-domain-text-import-report${suffix}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(join(deploymentRoot, `public-domain-text-import-report${suffix}.md`), renderMarkdown(report), "utf8");

if (report.failures.length) process.exitCode = 1;
