import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..");
const COURSE = "MCV4U";
const COURSE_ROOT = join(WORKSPACE_ROOT, "courseware", COURSE);
const MANIFEST_PATH = join(COURSE_ROOT, "course-manifest.json");
const INBOX_FILES = [
  join(REPO_ROOT, "inbox", "moodle-book-raw-MCV4U-U01.json"),
  join(REPO_ROOT, "inbox", "moodle-book-raw-MCV4U-U02.json"),
  join(REPO_ROOT, "inbox", "moodle-book-raw-MCV4U-U03.json")
];
const OUT_ROOT = join(COURSE_ROOT, "localized-moodle", "external-labs", "hands-on");
const REPORT_PATH = join(REPO_ROOT, "deployment", "MCV4U-hands-on-lab-localization-report.json");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function escapeHtml(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function slugify(value) {
  return (
    String(value || "lab")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "lab"
  );
}

function relativeHref(fromRel, targetRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(targetRel)))
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function iframeSrc(html) {
  return String(html || "").match(/<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2]?.replaceAll("&amp;", "&") || "";
}

function iframeTitle(html) {
  return String(html || "").match(/<iframe\b[^>]*\btitle\s*=\s*(["'])(.*?)\1/i)?.[2]?.replaceAll("&amp;", "&") || "";
}

function geogebraId(url) {
  return String(url || "").match(/\/material\/iframe\/id\/([^/]+)/i)?.[1] || "";
}

function isShipLab(url) {
  return /^https:\/\/webspace\.ship\.edu\/msrenault\/GeoGebraCalculus\/[^?#]+\.html/i.test(String(url || ""));
}

function isGeoGebraMaterial(url) {
  return /^https:\/\/(?:www\.|stage\.)?geogebra\.org\/material\/iframe\/id\//i.test(String(url || ""));
}

function collectRawHandsOn() {
  const rows = [];
  for (const file of INBOX_FILES) {
    const raw = readJson(file);
    for (const lesson of raw.lessons || []) {
      for (const section of lesson.sections || []) {
        if (!/hands/i.test(`${section.normalizedLabel || ""} ${section.label || ""}`)) continue;
        const html = section.page?.html || "";
        const url = iframeSrc(html);
        rows.push({
          unit: Number(raw.unit),
          lesson: Number(lesson.lesson),
          lessonTitle: lesson.title,
          sectionLabel: section.normalizedLabel || section.label || "Hands On",
          title: iframeTitle(html),
          url
        });
      }
    }
  }
  return rows;
}

function lessonCode(unit, lesson) {
  return `u${unit}l${lesson}`;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { text, finalUrl: response.url || url, contentType: response.headers.get("content-type") || "" };
}

async function fetchBytes(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { buffer, finalUrl: response.url || url, contentType: response.headers.get("content-type") || "" };
}

function absolutizeHtml(html, baseUrl) {
  return String(html || "")
    .replace(/\b(href|src|poster)\s*=\s*(["'])(.*?)\2/gi, (match, attr, quote, value) => {
      if (/^(?:https?:|data:|mailto:|tel:|#)/i.test(value)) return match;
      try {
        return `${attr}=${quote}${escapeHtml(new URL(value, baseUrl).toString(), true)}${quote}`;
      } catch {
        return match;
      }
    })
    .replace(/url\((["']?)(?!https?:|data:)([^"')]+)\1\)/gi, (match, quote, value) => {
      try {
        return `url("${escapeHtml(new URL(value, baseUrl).toString(), true)}")`;
      } catch {
        return match;
      }
    });
}

function labShell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #001f3f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body { display: grid; place-items: start center; padding: 18px; }
    main { width: min(100%, 1240px); margin: 0 auto; }
    .ggb-shell { display: grid; place-items: center; width: min(100%, 1240px); margin: 0 auto; }
    #ggb-element { width: 100%; min-height: 640px; overflow: hidden; }
    iframe, applet, object, embed, canvas, svg { max-width: 100%; }
  </style>
</head>
<body>
  <main>
${body}
  </main>
</body>
</html>
`;
}

async function localizeShip(row) {
  const fetched = await fetchText(row.url);
  if (!/text\/html|application\/xhtml/i.test(fetched.contentType) && !/<html|<applet|GeoGebra/i.test(fetched.text)) {
    throw new Error(`unexpected content type: ${fetched.contentType}`);
  }
  const relDir = `localized-moodle/external-labs/hands-on/${lessonCode(row.unit, row.lesson)}-${slugify(row.lessonTitle)}`;
  const absDir = join(COURSE_ROOT, ...relDir.split("/"));
  mkdirSync(absDir, { recursive: true });
  const body = absolutizeHtml(fetched.text, fetched.finalUrl);
  const html = labShell({
    title: `${COURSE} Unit ${row.unit} Lesson ${row.lesson} Hands On Lab`,
    body,
    sourceUrl: row.url,
    note: "Static lab page mirrored locally; third-party runtime/library URLs inside the lab are preserved when they are required for the applet to run."
  });
  const absPath = join(absDir, "index.html");
  writeFileSync(absPath, html, "utf8");
  return {
    mode: "localized_static_html",
    path: toPosix(relative(COURSE_ROOT, absPath)),
    bytes: statSync(absPath).size
  };
}

async function localizeGeoGebra(row) {
  const id = geogebraId(row.url);
  if (!id) throw new Error("missing geogebra id");
  const relDir = `localized-moodle/external-labs/hands-on/${lessonCode(row.unit, row.lesson)}-${slugify(row.lessonTitle)}`;
  const absDir = join(COURSE_ROOT, ...relDir.split("/"));
  const ggbPath = join(absDir, `${id}.ggb`);
  if (existsSync(ggbPath)) {
    const relGgbPath = toPosix(relative(COURSE_ROOT, ggbPath));
    const htmlPath = join(absDir, "index.html");
    mkdirSync(absDir, { recursive: true });
    writeGeoGebraLabHtml(row, id, relGgbPath, htmlPath);
    return {
      mode: "localized_geogebra_ggb",
      path: toPosix(relative(COURSE_ROOT, htmlPath)),
      bytes: statSync(htmlPath).size,
      ggbPath: relGgbPath,
      ggbBytes: statSync(ggbPath).size,
      reusedLocalPackage: true
    };
  }
  const tried = [];
  const candidates = [
    `https://www.geogebra.org/material/download/format/file/id/${id}`,
    `https://www.geogebra.org/material/download/format/ggb/id/${id}`,
    `https://www.geogebra.org/m/${id}`
  ];
  let packageInfo = null;
  for (const url of candidates.slice(0, 2)) {
    tried.push(url);
    try {
      const file = await fetchBytes(url);
      const isZip = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
      if (!isZip) throw new Error(`not a .ggb zip (${file.contentType || "unknown content type"})`);
      mkdirSync(absDir, { recursive: true });
      writeFileSync(ggbPath, file.buffer);
      packageInfo = {
        ggbPath: toPosix(relative(COURSE_ROOT, ggbPath)),
        ggbBytes: statSync(ggbPath).size,
        downloadUrl: url
      };
      break;
    } catch (error) {
      tried.push(`failed: ${error.message}`);
    }
  }

  if (!packageInfo) {
    throw new Error(`no downloadable .ggb package; tried ${tried.join(" | ")}`);
  }

  const packageRelDir = posix.dirname(packageInfo.ggbPath);
  const packageAbsDir = join(COURSE_ROOT, ...packageRelDir.split("/"));
  const absPath = join(packageAbsDir, "index.html");
  writeGeoGebraLabHtml(row, id, packageInfo.ggbPath, absPath);
  return {
    mode: "localized_geogebra_ggb",
    path: toPosix(relative(COURSE_ROOT, absPath)),
    bytes: statSync(absPath).size,
    ...packageInfo
  };
}

function writeGeoGebraLabHtml(row, id, ggbPath, absPath) {
  const ggbName = posix.basename(ggbPath);
  const title = row.title || `${COURSE} Unit ${row.unit} Lesson ${row.lesson} GeoGebra Lab`;
  const html = labShell({
    title,
    sourceUrl: row.url,
    note: "The GeoGebra worksheet package (.ggb) is stored locally. The page uses GeoGebra's official web runtime to open the local worksheet file.",
    body: `    <div class="ggb-shell"><div id="ggb-element"></div></div>
    <script src="https://www.geogebra.org/apps/deployggb.js"></script>
    <script>
      const width = Math.max(760, Math.min(1240, window.innerWidth - 36));
      const height = Math.max(560, Math.min(760, window.innerHeight - 36));
      const params = {
        appName: "classic",
        width,
        height,
        showToolBar: false,
        showAlgebraInput: false,
        showMenuBar: false,
        enableShiftDragZoom: true,
        filename: ${JSON.stringify(ggbName)}
      };
      new GGBApplet(params, true).inject("ggb-element");
    </script>
`
  });
  writeFileSync(absPath, html, "utf8");
}

function ensureEmbeddedExternalCss(html) {
  if (html.includes(".embedded-external-frame")) return html;
  return html.replace(
    "</style>",
    `    .embedded-external-frame { display: block; margin: 16px auto 24px; max-width: 100%; width: 100%; }
    .embedded-external-frame iframe { border: 1px solid #d6e2f0; display: block; min-height: 640px; width: 100%; }
    .embedded-fallback { margin: 8px 0 0; text-align: center; }
    .embedded-fallback a { color: #00396f; font-weight: 700; }
  </style>`
  );
}

function renderLocalizedIframe(pageRel, labRel) {
  const href = escapeHtml(relativeHref(pageRel, labRel), true);
  return `<div class="embedded-external-frame" data-localized-lab="true"><iframe src="${href}" title="Localized Hands On Lab" loading="lazy" allowfullscreen="allowfullscreen"></iframe><p class="embedded-fallback"><a href="${href}" target="_blank" rel="noopener noreferrer">Open localized lab in a new tab</a></p></div>`;
}

function updateHandsOnPage(section, labRel) {
  const absPath = join(COURSE_ROOT, ...toPosix(section.path).split("/"));
  let html = readFileSync(absPath, "utf8");
  html = ensureEmbeddedExternalCss(html);
  html = html.replace(/<div class="embedded-external-card"[\s\S]*?<\/div>|<div class="embedded-external-frame"[\s\S]*?<\/div>/i, renderLocalizedIframe(section.path, labRel));
  writeFileSync(absPath, html, "utf8");
}

function findLesson(manifest, unitNo, lessonNo) {
  const unit = (manifest.units || []).find((item) => Number(item.unit) === Number(unitNo));
  const lesson = (unit?.lessons || []).find((item) => Number(item.lesson) === Number(lessonNo));
  return { unit, lesson };
}

function findHandsOnSection(lesson) {
  return (lesson?.bookSections || []).find((section) => /03-hands-on\.html$/i.test(section.path || ""));
}

function upsertHandsOnRecord(lesson, row, localized) {
  lesson.handsOn ||= [];
  const record = {
    label: `Hands On Lab - ${row.title || row.lessonTitle}`,
    type: "interactive_lab",
    category: "localized_external_lab",
    role: "handsOn",
    parentSection: "Hands On",
    mode: localized.mode,
    path: localized.path,
    previewPath: localized.path,
    bytes: localized.bytes,
    source: row.url,
    textPreview: `${COURSE} Unit ${row.unit} Lesson ${row.lesson} Hands On Lab`
  };
  if (localized.ggbPath) record.localizedPackagePath = localized.ggbPath;
  const index = lesson.handsOn.findIndex((item) => item.source === row.url || item.path === localized.path);
  if (index >= 0) lesson.handsOn[index] = { ...lesson.handsOn[index], ...record };
  else lesson.handsOn.push(record);

  lesson.downloads ||= [];
  const downloadIndex = lesson.downloads.findIndex((item) => item.source === row.url || item.path === localized.path);
  if (downloadIndex >= 0) lesson.downloads[downloadIndex] = { ...lesson.downloads[downloadIndex], ...record };
  else lesson.downloads.push(record);
}

const manifest = readJson(MANIFEST_PATH);
const rawRows = collectRawHandsOn();
const localized = [];
const external = [];
const failures = [];

mkdirSync(OUT_ROOT, { recursive: true });

for (const row of rawRows) {
  try {
    let result;
    if (isShipLab(row.url)) result = await localizeShip(row);
    else if (isGeoGebraMaterial(row.url)) result = await localizeGeoGebra(row);
    else throw new Error("unrecognized Hands On lab provider");

    const { lesson } = findLesson(manifest, row.unit, row.lesson);
    const section = findHandsOnSection(lesson);
    if (!lesson || !section) throw new Error("missing manifest lesson or Hands On section");
    updateHandsOnPage(section, result.path);
    upsertHandsOnRecord(lesson, row, result);
    lesson.resourceCounts ||= {};
    lesson.resourceCounts.handsOn = (lesson.handsOn || []).length;
    lesson.resourceCounts.downloads = (lesson.downloads || []).length;
    lesson.resourceCounts.interactiveLabs = (lesson.downloads || []).filter((item) => item.type === "interactive_lab").length;
    localized.push({ ...row, ...result });
  } catch (error) {
    const reason = String(error?.message || error);
    failures.push({ ...row, reason });
    external.push({ ...row, mode: "external", reason });
  }
}

for (const unit of manifest.units || []) {
  unit.summary ||= {};
  const downloads = (unit.lessons || []).flatMap((lesson) => lesson.downloads || []);
  unit.summary.downloads = downloads.length;
  unit.summary.h5p = downloads.filter((item) => item.type === "h5p").length;
  unit.summary.video = downloads.filter((item) => ["mp4", "mov", "webm", "m4v", "video"].includes(String(item.type || "").toLowerCase())).length;
  unit.summary.interactiveLabs = downloads.filter((item) => item.type === "interactive_lab").length;
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.mcv4uHandsOnLabLocalization = {
  patchedAt: new Date().toISOString(),
  totalHandsOnLabs: rawRows.length,
  localized: localized.length,
  external: external.length,
  localizedShipStaticHtml: localized.filter((item) => item.mode === "localized_static_html").length,
  localizedGeoGebraGgb: localized.filter((item) => item.mode === "localized_geogebra_ggb").length,
  failures,
  note: "Each MCV4U Hands On lab was checked individually. Static Ship GeoGebraCalculus pages and downloadable GeoGebra worksheets are localized; only failures remain as external activities."
};
manifest.generatedAt = new Date().toISOString();
writeJson(MANIFEST_PATH, manifest);
writeJson(REPORT_PATH, {
  generatedAt: new Date().toISOString(),
  course: COURSE,
  localized,
  external,
  failures
});

console.log(JSON.stringify({
  total: rawRows.length,
  localized: localized.length,
  external: external.length,
  localizedShipStaticHtml: localized.filter((item) => item.mode === "localized_static_html").length,
  localizedGeoGebraGgb: localized.filter((item) => item.mode === "localized_geogebra_ggb").length,
  failures: failures.length,
  reportPath: toPosix(relative(REPO_ROOT, REPORT_PATH))
}, null, 2));
