import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ENG2D");

function walk(dir, out = []) {
  const entries = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) out.push(path);
  }
  return out;
}

function patchHtml(html) {
  let next = String(html || "");
  next = next.replace(
    /    \.content img, \.content video \{ display: block; height: auto; max-width: 100%; \}\n/g,
    [
      "    .content img { display: block; height: auto; max-width: 100%; }",
      "    .content video { display: block; height: auto; margin-left: auto; margin-right: auto; max-width: 100%; width: min(100%, 1000px); }",
      "    .content .mediaplugin, .content .mediaplugin > div, .content .video-js { margin-left: auto !important; margin-right: auto !important; text-align: center; }",
      "",
    ].join("\n"),
  );
  if (!next.includes(".content .mediaplugin")) {
    next = next.replace(
      /(\s+\.content video \{[^}]+\}\n)/,
      "$1    .content .mediaplugin, .content .mediaplugin > div, .content .video-js { margin-left: auto !important; margin-right: auto !important; text-align: center; }\n",
    );
  }
  return next;
}

let scanned = 0;
let patched = 0;
for (const file of walk(courseRoot)) {
  scanned += 1;
  const html = readFileSync(file, "utf8");
  const next = patchHtml(html);
  if (next === html) continue;
  writeFileSync(file, next, "utf8");
  patched += 1;
}

console.log(JSON.stringify({ course: "ENG2D", scanned, patched }, null, 2));
