import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course")?.toUpperCase();
const dryRun = process.argv.includes("--dry-run");

if (!course) {
  console.error("Usage: node scripts/scrub-localized-main-urls.mjs --course COURSE [--dry-run]");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function isExternalMainUrl(value) {
  return /(^|\/\/)(?:www\.esunnybrook\.com|hexstruct\.ispring\.com)/i.test(String(value || ""));
}

function hasLocalAsset(item) {
  return Boolean(item?.path || item?.previewPath || item?.downloadPath);
}

function shouldScrub(item, key) {
  if (!item?.[key] || !hasLocalAsset(item)) return false;
  if ((item.category || "").toLowerCase() === "ispring") return /^https?:\/\//i.test(String(item[key]));
  return isExternalMainUrl(item[key]);
}

function visit(value, path, removals) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, removals));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const key of ["url", "previewUrl", "downloadUrl"]) {
    if (!shouldScrub(value, key)) continue;
    removals.push({
      path,
      key,
      label: value.label || value.title || "",
      removed: value[key],
      localPath: value.path || value.previewPath || value.downloadPath || "",
    });
    delete value[key];
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "source") continue;
    visit(child, path ? `${path}.${key}` : key, removals);
  }
}

const manifestPath = join(workspaceRoot, "courseware", course, "course-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const removals = [];
visit(manifest, "", removals);

if (!dryRun && removals.length) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ course, dryRun, removed: removals.length, removals: removals.slice(0, 20) }, null, 2));
