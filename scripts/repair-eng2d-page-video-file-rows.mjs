import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "ENG2D");

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) out.push(path);
  }
  return out;
}

function removeVideoFileRows(html) {
  let next = String(html || "");
  next = next.replace(
    /<div class="file-row">(?:(?!<div class="file-row">)[\s\S])*?\.(?:mp4|m4v|mov|webm)(?:<|%|&|")(?:(?!<div class="file-row">)[\s\S])*?<\/div><\/div>/gi,
    "",
  );
  next = next.replace(
    /\s*<section class="files"><h2>Files<\/h2>\s*<\/section>/gi,
    "",
  );
  return next;
}

let scanned = 0;
let patched = 0;
for (const file of walk(courseRoot)) {
  scanned += 1;
  const html = readFileSync(file, "utf8");
  const next = removeVideoFileRows(html);
  if (next === html) continue;
  writeFileSync(file, next, "utf8");
  patched += 1;
}

console.log(JSON.stringify({ course: "ENG2D", scanned, patched }, null, 2));
