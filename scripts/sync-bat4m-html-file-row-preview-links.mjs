import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const courseRoot = join(workspaceRoot, "courseware", "BAT4M");
const manifestPath = join(courseRoot, "course-manifest.json");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function href(fromRel, toRel) {
  const fromDir = posix.dirname(toPosix(fromRel));
  return toPosix(posix.relative(fromDir === "." ? "" : fromDir, toPosix(toRel))).split("/").map(encodeURIComponent).join("/");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walk(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, out));
  } else if (value && typeof value === "object") {
    if (typeof value.path === "string" && typeof value.label === "string") out.push(value);
    Object.values(value).forEach((item) => walk(item, out));
  }
  return out;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const resources = walk(manifest).filter((item) => item.path && (item.previewPath || item.downloadPath));
const htmlPages = [...new Set(walk(manifest).map((item) => item.path).filter((path) => /\.html?$/i.test(path || "")))];
let pagesPatched = 0;
let linksPatched = 0;

for (const pageRel of htmlPages) {
  const pagePath = join(courseRoot, pageRel);
  if (!existsSync(pagePath)) continue;
  let html = readFileSync(pagePath, "utf8");
  const before = html;

  for (const resource of resources) {
    if (!resource.path || !resource.label) continue;
    const currentDownload = resource.downloadPath || resource.path;
    const viewTarget = resource.previewPath || resource.path;
    const downloadTarget = resource.downloadPath || resource.path;
    const currentHref = href(pageRel, currentDownload);
    const currentPathHref = href(pageRel, resource.path);
    const viewHref = href(pageRel, viewTarget);
    const downloadHref = href(pageRel, downloadTarget);

    for (const candidate of new Set([currentHref, currentPathHref])) {
      if (!candidate) continue;
      const viewPattern = new RegExp(`(<a class="button" href=")${escapeRegExp(candidate)}(">)View(<\\/a>)`, "g");
      html = html.replace(viewPattern, (_, prefix, suffix, tail) => {
        linksPatched += 1;
        return `${prefix}${viewHref}${suffix}View${tail}`;
      });
      const downloadPattern = new RegExp(`(<a class="button" href=")${escapeRegExp(candidate)}(" download>)Download(<\\/a>)`, "g");
      html = html.replace(downloadPattern, (_, prefix, suffix, tail) => `${prefix}${downloadHref}${suffix}Download${tail}`);
    }
  }

  if (html !== before) {
    writeFileSync(pagePath, html, "utf8");
    pagesPatched += 1;
  }
}

console.log(JSON.stringify({ pagesPatched, linksPatched }, null, 2));
