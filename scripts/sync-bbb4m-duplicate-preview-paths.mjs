import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const manifestPath = join(workspaceRoot, "courseware", "BBB4M", "course-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const byPath = new Map();
let updated = 0;

function walk(value) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.path && value.previewPath) byPath.set(value.path, value.previewPath);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") walk(child);
  }
}

function applyPreview(value) {
  if (Array.isArray(value)) {
    for (const item of value) applyPreview(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.path && !value.previewPath && byPath.has(value.path)) {
    value.previewPath = byPath.get(value.path);
    updated += 1;
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") applyPreview(child);
  }
}

walk(manifest);
applyPreview(manifest);
manifest.sourceAudit ||= {};
manifest.sourceAudit.duplicatePreviewPathSync = {
  syncedAt: new Date().toISOString(),
  updated,
  note: "Synchronized previewPath values across duplicate manifest records that point to the same localized file path.",
};
manifest.generatedAt = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ course: "BBB4M", updated }, null, 2));
