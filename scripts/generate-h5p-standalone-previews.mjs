import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultWorkspaceRoot = resolve(projectRoot, "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const course = String(readArg("--course") || "").toUpperCase();
const workspaceRoot = readArg("--workspace-root") || defaultWorkspaceRoot;
const courseRoot = readArg("--course-root") || join(workspaceRoot, "courseware", course);
if (!course) {
  console.error("Usage: node scripts/generate-h5p-standalone-previews.mjs --course COURSE [--workspace-root ROOT] [--course-root ROOT/courseware/COURSE]");
  process.exit(1);
}

const manifestPath = join(courseRoot, "course-manifest.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function htmlEscape(value, quote = false) {
  let text = String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  if (quote) text = text.replaceAll('"', "&quot;");
  return text;
}

function collectH5pItems(value, out = [], seen = new Set()) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item) => collectH5pItems(item, out, seen));
    return out;
  }
  const path = toPosix(value.path || "");
  const type = String(value.type || "").toLowerCase();
  if ((type === "h5p" || /\.h5p$/i.test(path)) && path && !seen.has(path)) {
    seen.add(path);
    out.push(value);
  }
  for (const nested of Object.values(value)) collectH5pItems(nested, out, seen);
  return out;
}

function relativeFromPreview(previewRel, targetRel) {
  return posix.relative(posix.dirname(toPosix(previewRel)), toPosix(targetRel)) || ".";
}

function renderPreview({ title, h5pRel, previewRel, contentType = "" }) {
  const packageHref = relativeFromPreview(previewRel, h5pRel);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <link rel="stylesheet" href="/vendor/h5p-standalone/styles/h5p.css">
  <style>
    :root { color: #10233f; background: #f3f6fa; font-family: Inter, "Segoe UI", Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.5; }
    body { margin: 0; padding: 28px 18px 42px; }
    body.is-embedded { background: #fff; padding: 0; }
    main { max-width: 1120px; margin: 0 auto; }
    body.is-embedded main { max-width: none; padding: 0; width: 100%; }
    header { background: #fff; border: 1px solid #d8e2ef; border-radius: 8px; margin-bottom: 14px; padding: 18px 22px; }
    h1 { font-size: 24px; line-height: 1.25; margin: 0 0 6px; }
    .meta { color: #526681; font-size: 13px; overflow-wrap: anywhere; }
    .player-shell { background: #fff; border: 1px solid #d8e2ef; border-radius: 8px; min-height: 220px; overflow: hidden; }
    body.is-embedded header { display: none; }
    body.is-embedded .player-shell { border: 0; border-radius: 0; min-height: 220px; width: 100%; }
    #h5p-container { min-height: 220px; width: 100%; }
    #h5p-container .h5p-content, #h5p-container .h5p-container { max-width: none; width: 100%; }
    .fallback { background: #fff3f3; border: 1px solid #f0bbbb; border-radius: 8px; color: #7f1d1d; display: none; margin-top: 14px; padding: 12px 14px; }
    .fallback a { color: #0b4f71; font-weight: 700; }
    @media (max-width: 720px) {
      body { padding: 0; }
      header, .player-shell, .fallback { border-left: 0; border-radius: 0; border-right: 0; }
      h1 { font-size: 20px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${htmlEscape(title)}</h1>
      <div class="meta">${htmlEscape(h5pRel)}</div>
      ${contentType ? `<div class="meta">H5P content type: ${htmlEscape(contentType)}</div>` : ""}
    </header>
    <div class="player-shell"><div id="h5p-container"></div></div>
    <div class="fallback" id="h5p-fallback">
      H5P playback failed. The package may be missing a required H5P library. You can still download the original file:
      <a href="${htmlEscape(packageHref, true)}">${htmlEscape(basename(h5pRel))}</a>
    </div>
  </main>
  <script src="/vendor/h5p-standalone/main.bundle.js" charset="UTF-8"></script>
  <script>
    if (new URLSearchParams(window.location.search).get("embed") === "1") {
      document.body.classList.add("is-embedded");
    }
    document.addEventListener("DOMContentLoaded", function () {
      const el = document.getElementById("h5p-container");
      const fallback = document.getElementById("h5p-fallback");
      const measurePlayerHeight = () => {
        const shell = document.querySelector(".player-shell");
        const content = el.querySelector(".h5p-content") || el.querySelector(".h5p-container") || el.firstElementChild || el;
        const shellRect = shell ? shell.getBoundingClientRect() : { top: 0 };
        const contentRect = content.getBoundingClientRect();
        const measured = Math.max(contentRect.bottom - shellRect.top, contentRect.height);
        return Math.min(Math.max(Math.ceil(measured) + 10, 220), 900);
      };
      const notifyParent = () => {
        const height = measurePlayerHeight();
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "ossd:h5p-height", height }, "*");
        }
      };
      const options = {
        h5pJsonPath: ".",
        librariesPath: ".",
        contentJsonPath: "./content",
        frameJs: "/vendor/h5p-standalone/frame.bundle.js",
        frameCss: "/vendor/h5p-standalone/styles/h5p.css",
        frame: true,
        export: true,
        downloadUrl: "${htmlEscape(packageHref, true)}",
        fullScreen: true
      };
      try {
        const player = new H5PStandalone.H5P(el, options);
        setTimeout(notifyParent, 500);
        setTimeout(notifyParent, 1500);
        setTimeout(notifyParent, 3000);
        if ("ResizeObserver" in window) {
          const resizeObserver = new ResizeObserver(notifyParent);
          resizeObserver.observe(el);
        }
        if (player && typeof player.catch === "function") {
          player.catch(function (error) {
            console.error(error);
            fallback.style.display = "block";
            notifyParent();
          });
        }
      } catch (error) {
        console.error(error);
        fallback.style.display = "block";
        notifyParent();
      }
      window.addEventListener("resize", notifyParent);
      document.addEventListener("click", function () {
        setTimeout(notifyParent, 250);
      }, true);
    });
  </script>
</body>
</html>
`;
}

const manifest = readJson(manifestPath);
const items = collectH5pItems(manifest);
const generated = [];
const failures = [];

for (const item of items) {
  const h5pRel = toPosix(item.path);
  const h5pAbs = join(courseRoot, h5pRel);
  if (!existsSync(h5pAbs)) {
    failures.push({ label: item.label, path: h5pRel, error: "missing h5p package" });
    continue;
  }
  const previewRel = toPosix(item.previewPath || h5pRel.replace(/\.h5p$/i, "/index.html"));
  const previewDir = join(courseRoot, dirname(previewRel));
  try {
    mkdirSync(previewDir, { recursive: true });
    if (!existsSync(join(previewDir, "h5p.json"))) {
      execFileSync("tar", ["-xf", h5pAbs, "-C", previewDir], { stdio: "pipe" });
    }
    let contentType = "";
    const h5pJsonPath = join(previewDir, "h5p.json");
    if (existsSync(h5pJsonPath)) {
      try {
        const h5pJson = JSON.parse(readFileSync(h5pJsonPath, "utf8"));
        contentType = h5pJson.mainLibrary || "";
      } catch {
        // The package will still be represented by the fallback.
      }
    }
    writeFileSync(
      join(courseRoot, previewRel),
      renderPreview({ title: item.label || basename(h5pRel), h5pRel, previewRel, contentType }),
      "utf8",
    );
    item.previewPath = previewRel;
    item.bytes = statSync(h5pAbs).size;
    generated.push({ label: item.label, path: h5pRel, previewPath: previewRel, contentType });
  } catch (error) {
    failures.push({ label: item.label, path: h5pRel, error: error?.message || String(error) });
  }
}

manifest.sourceAudit ||= {};
manifest.sourceAudit.h5pStandalonePreviews = {
  generatedAt: new Date().toISOString(),
  expected: items.length,
  generated: generated.length,
  failures,
};
manifest.generatedAt = new Date().toISOString();
writeJson(manifestPath, manifest);

console.log(JSON.stringify({ course, expected: items.length, generated: generated.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
