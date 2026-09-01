import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const courseRoot = resolve(__dirname, "..", "..", "courseware", "ENG4U");
const root = join(courseRoot, "ispring-localized");
const htmls = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name === "presentation.html") htmls.push(p);
  }
}

walk(root);

const missing = [];
const attr = /\b(?:src|href)=["']([^"']+)["']/gi;

for (const file of htmls) {
  const html = readFileSync(file, "utf8");
  let match;
  while ((match = attr.exec(html))) {
    const url = match[1];
    if (!url || /^(?:https?:|data:|mailto:|javascript:|#)/i.test(url)) continue;
    const clean = decodeURIComponent(url.split("#")[0].split("?")[0]);
    if (!clean || clean.startsWith("/")) continue;
    const full = resolve(dirname(file), clean);
    if (!existsSync(full)) {
      missing.push({
        presentation: relative(root, file).replaceAll("\\", "/"),
        ref: url,
      });
    }
  }
}

console.log(JSON.stringify({ presentations: htmls.length, missingRefs: missing.length, missing: missing.slice(0, 50) }, null, 2));
