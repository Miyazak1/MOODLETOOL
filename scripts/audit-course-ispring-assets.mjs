import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course")?.toUpperCase();

if (!course) {
  console.error("Usage: node scripts/audit-course-ispring-assets.mjs --course COURSE");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, predicate, out);
    else if (!predicate || predicate(path)) out.push(path);
  }
  return out;
}

function likelyAssetRef(raw) {
  if (!raw || /^([a-z]+:|#|data:|blob:|javascript:|mailto:)/i.test(raw)) return "";
  const clean = String(raw).replaceAll("\\/", "/").split("#")[0].split("?")[0];
  if (!clean || clean.startsWith("/") || /[<>"'{}[\]+^$]/.test(clean)) return "";
  if (!/\.(html?|js|css|json|xml|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp3|mp4|webm|wav|ogg|vtt|cur)$/i.test(clean)) return "";
  return clean;
}

function refsFromText(text) {
  const refs = new Set();
  const normalized = String(text || "").replaceAll('\\"', '"').replaceAll("\\/", "/");
  const patterns = [
    /\b(?:src|href|poster|data)=["']([^"']+)["']/gi,
    /url\((["']?)([^"')]+)\1\)/gi,
    /["']((?:\.\/)?(?:data|assets|content|fonts|res|skin)\/[^"'<>+[\]{}()]+\.(?:html?|js|css|json|xml|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp3|mp4|webm|wav|ogg|vtt|cur)(?:[#?][^"'<>+[\]{}()]*)?)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const ref = likelyAssetRef(match[2] || match[1]);
      if (ref) refs.add(ref);
    }
  }
  return [...refs];
}

function resolveRef(packageRoot, sourceFile, ref) {
  if (/^(?:data|assets|content|fonts|res|skin)\//i.test(ref)) return join(packageRoot, ref);
  return join(dirname(sourceFile), ref);
}

function isIgnoredMissingRef(source, ref) {
  return source === "data/html5-unsupported.html" && ref === "html5.png";
}

function manifestIspringItems(manifest) {
  const items = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.ispring || []) {
        items.push({ unit: unit.unit, lesson: lesson.id || lesson.title || "", item });
      }
    }
  }
  return items;
}

const courseRoot = join(workspaceRoot, "courseware", course);
const manifestPath = join(courseRoot, "course-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Missing manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packages = [];
let checkedRefs = 0;
let missingRefs = 0;

for (const owner of manifestIspringItems(manifest)) {
  const item = owner.item;
  const presentationPath = item.path ? join(courseRoot, item.path) : "";
  const packageRoot = item.packagePath ? join(courseRoot, item.packagePath) : dirname(presentationPath);
  const packageRecord = {
    unit: owner.unit,
    lesson: owner.lesson,
    label: item.label || "",
    path: item.path || "",
    packagePath: item.packagePath || "",
    downloadPath: item.downloadPath || "",
    presentationExists: Boolean(presentationPath && existsSync(presentationPath)),
    packageExists: Boolean(packageRoot && existsSync(packageRoot)),
    downloadExists: item.downloadPath ? existsSync(join(courseRoot, item.downloadPath)) : false,
    checkedRefs: 0,
    missingRefs: 0,
    ignoredMissingRefs: 0,
    missing: [],
    ignoredMissing: [],
  };
  if (packageRecord.presentationExists && packageRecord.packageExists) {
    const textFiles = walk(packageRoot, (file) => [".html", ".js", ".css", ".json", ".xml"].includes(extname(file).toLowerCase()));
    const missing = [];
    for (const file of textFiles) {
      const text = readFileSync(file, "utf8");
      for (const ref of refsFromText(text)) {
        const target = resolveRef(packageRoot, file, ref);
        packageRecord.checkedRefs += 1;
        if (!existsSync(target)) {
          const missingEntry = {
            source: toPosix(relative(packageRoot, file)),
            ref,
            target: toPosix(relative(packageRoot, target)),
          };
          if (isIgnoredMissingRef(missingEntry.source, missingEntry.ref)) {
            packageRecord.ignoredMissing.push(missingEntry);
          } else {
            missing.push(missingEntry);
          }
        }
      }
    }
    packageRecord.missing = [...new Map(missing.map((entry) => [`${entry.source}|${entry.ref}`, entry])).values()];
    packageRecord.missingRefs = packageRecord.missing.length;
    packageRecord.ignoredMissing = [...new Map(packageRecord.ignoredMissing.map((entry) => [`${entry.source}|${entry.ref}`, entry])).values()];
    packageRecord.ignoredMissingRefs = packageRecord.ignoredMissing.length;
  }
  checkedRefs += packageRecord.checkedRefs;
  missingRefs += packageRecord.missingRefs;
  packages.push(packageRecord);
}

const missingPackages = packages.filter((item) => !item.presentationExists || !item.packageExists || !item.downloadExists || item.missingRefs);
console.log(JSON.stringify({
  course,
  packages: packages.length,
  checkedRefs,
  missingRefs,
  ignoredMissingRefs: packages.reduce((sum, item) => sum + item.ignoredMissingRefs, 0),
  packagesWithIssues: missingPackages.map((item) => ({
    unit: item.unit,
    lesson: item.lesson,
    path: item.path,
    presentationExists: item.presentationExists,
    packageExists: item.packageExists,
    downloadPath: item.downloadPath,
    downloadExists: item.downloadExists,
    missingRefs: item.missingRefs,
    missing: item.missing.slice(0, 10),
  })),
}, null, 2));

if (missingPackages.length) process.exitCode = 1;
