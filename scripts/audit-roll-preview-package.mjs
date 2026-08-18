import { existsSync, readFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

const rootArg = process.argv[2];
if (!rootArg) {
  console.error("Usage: node scripts/audit-roll-preview-package.mjs <package-root>");
  process.exit(1);
}

const root = resolve(rootArg);
const presentationPath = join(root, "presentation.html");
if (!existsSync(presentationPath)) {
  console.error(`Missing presentation.html under ${root}`);
  process.exit(1);
}

const html = readFileSync(presentationPath, "utf8");
const refs = new Set();
for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
  const ref = match[1];
  if (!ref || /^(https?:|data:|blob:|#)/i.test(ref)) continue;
  refs.add(ref.split("#")[0]);
}

const playerDataMatch = html.match(/const playerData = (.*?);\s*\n/s);
if (playerDataMatch) {
  const playerData = JSON.parse(JSON.parse(playerDataMatch[1]));
  function walk(value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.s === "string" && value.s) refs.add(`resources/${value.s}`);
    Object.values(value).forEach(walk);
  }
  walk(playerData);
}

const rootNormalized = normalize(root);
const missing = [];
for (const ref of refs) {
  const target = normalize(join(root, ref));
  if (!target.startsWith(rootNormalized) || !existsSync(target)) missing.push(ref);
}

console.log(JSON.stringify({ root, refs: refs.size, missingRefs: missing.length, missing }, null, 2));
if (missing.length) process.exit(1);
