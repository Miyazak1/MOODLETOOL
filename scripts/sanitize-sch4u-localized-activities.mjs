import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const root = join(workspaceRoot, "courseware", "SCH4U", "localized-moodle-activities");

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && entry.name.toLowerCase() === "index.html") files.push(absolute);
  }
  return files;
}

let changed = 0;
let externalH5pNotes = 0;

for (const file of walk(root)) {
  const before = readFileSync(file, "utf8");
  let html = before
    .replace(/\sdata-pageurl="https:\/\/www\.esunnybrook\.com\/[^"]*"/gi, "")
    .replace(/(<input\b[^>]*\bname=["']pageurl["'][^>]*\bvalue=)["']https:\/\/www\.esunnybrook\.com\/[^"']*["']/gi, "$1\"\"");

  html = html.replace(
    /<iframe\b[^>]*\bsrc=["']https:\/\/welcome\.hexstruct\.com\/wp-admin\/admin-ajax\.php\?action=h5p_embed&amp;id=201["'][\s\S]*?<\/iframe>/gi,
    () => {
      externalH5pNotes += 1;
      return '<div class="notice">External H5P interaction was present in Moodle for this lab activity, but no downloadable H5P package was exposed. The lab page and attached files are localized below.</div>';
    },
  );

  if (html !== before) {
    writeFileSync(file, html, "utf8");
    changed += 1;
  }
}

console.log(JSON.stringify({ changed, externalH5pNotes }, null, 2));
