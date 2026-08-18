import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course")?.toUpperCase();

if (!course) {
  console.error("Usage: node scripts/audit-course-ispring-local-refs.mjs --course COURSE");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifest = readJson(join(courseRoot, "course-manifest.json"));
const attrPattern = /\b(?:src|href)=["']([^"']+)["']/gi;
const localStringPattern = /["']((?:css|data|fonts|html5|js|lng|res|resources)\/[^"']+)["']/gi;
const missing = [];
const missingKeys = new Set();
let presentations = 0;

function isExternalOrSpecial(url) {
  return !url || /^(?:https?:|data:|mailto:|javascript:|#)/i.test(url);
}

function auditLocalRef(item, file, url) {
  if (isExternalOrSpecial(url)) return;
  const clean = decodeURIComponent(url.split("#")[0].split("?")[0]);
  if (!clean || clean.startsWith("/")) return;
  if (clean.startsWith("lng/") && !/^lng\/en-US\.[^/]+\.json$/i.test(clean)) return;
  const full = resolve(dirname(file), clean);
  if (!existsSync(full)) {
    const key = `${item.path}\0${url}`;
    if (!missingKeys.has(key)) {
      missingKeys.add(key);
      missing.push({ presentation: item.path, ref: url });
    }
  }
}

function auditIspringItem(item) {
  presentations += 1;
  const file = join(courseRoot, item.path || "");
  if (!item.path || !existsSync(file)) {
    missing.push({ presentation: item.path || "", ref: "presentation missing" });
    return;
  }
  const html = readFileSync(file, "utf8");
  let match;
  while ((match = attrPattern.exec(html))) {
    auditLocalRef(item, file, match[1]);
  }
  while ((match = localStringPattern.exec(html))) {
    auditLocalRef(item, file, match[1]);
  }
}

for (const section of manifest.courseSections || []) {
  for (const item of section.ispring || []) {
    auditIspringItem(item);
  }
}

for (const unit of manifest.units || []) {
  for (const lesson of unit.lessons || []) {
    for (const item of lesson.ispring || []) {
      auditIspringItem(item);
    }
  }
}

console.log(JSON.stringify({ course, presentations, missingRefs: missing.length, missing: missing.slice(0, 50) }, null, 2));
if (missing.length) process.exitCode = 1;
