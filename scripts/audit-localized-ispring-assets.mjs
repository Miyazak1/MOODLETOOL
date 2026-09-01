import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const course = readArg("--course")?.toUpperCase();
const outPath = readArg("--out");

if (!course) {
  console.error("Usage: node scripts/audit-localized-ispring-assets.mjs --course COURSE [--out path]");
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function toPosix(path) {
  return String(path || "").replaceAll("\\", "/");
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
  if (!raw || /^([a-z]+:|#|data:|blob:|javascript:)/i.test(raw)) return "";
  const clean = String(raw).replaceAll("\\/", "/").split("#")[0].split("?")[0];
  if (!clean || /[<>"'{}[\]+^$]/.test(clean)) return "";
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
      const raw = match[2] || match[1];
      const ref = likelyAssetRef(raw);
      if (ref) refs.add(ref);
    }
  }
  return [...refs];
}

function resolveRef(packageRoot, sourceFile, ref) {
  if (ref.startsWith("/")) return join(packageRoot, ref.replace(/^\/+/, ""));
  const relativeTarget = join(dirname(sourceFile), ref);
  if (existsSync(relativeTarget)) return relativeTarget;
  if (ref.startsWith("data/") || ref.startsWith("assets/") || ref.startsWith("content/") || ref.startsWith("fonts/") || ref.startsWith("res/") || ref.startsWith("skin/")) {
    const packageTarget = join(packageRoot, ref);
    if (existsSync(packageTarget)) return packageTarget;
  }
  return relativeTarget;
}

const ispringRoot = join(workspaceRoot, "courseware", course, "ispring-localized");
const presentationFiles = walk(ispringRoot, (path) => path.endsWith("presentation.html"));
const packages = [];
let checkedRefs = 0;
let missingRefs = 0;

for (const presentationPath of presentationFiles.sort()) {
  const packageRoot = dirname(presentationPath);
  const textFiles = walk(packageRoot, (path) => [".html", ".js", ".css", ".json", ".xml"].includes(extname(path).toLowerCase()));
  const refs = [];
  const missing = [];
  for (const file of textFiles) {
    const text = readFileSync(file, "utf8");
    for (const ref of refsFromText(text)) {
      const target = resolveRef(packageRoot, file, ref);
      const record = {
        source: toPosix(relative(packageRoot, file)),
        ref,
        target: toPosix(relative(packageRoot, target)),
      };
      refs.push(record);
      if (!existsSync(target)) missing.push(record);
    }
  }
  const uniqueMissing = [...new Map(missing.map((item) => [`${item.source}|${item.ref}`, item])).values()];
  packages.push({
    packagePath: toPosix(relative(join(workspaceRoot, "courseware", course), packageRoot)),
    checkedRefs: refs.length,
    missingRefs: uniqueMissing.length,
    missing: uniqueMissing,
  });
  checkedRefs += refs.length;
  missingRefs += uniqueMissing.length;
}

const report = {
  generatedAt: new Date().toISOString(),
  course,
  packages: packages.length,
  checkedRefs,
  missingRefs,
  packagesWithMissing: packages.filter((item) => item.missingRefs > 0),
};

if (outPath) {
  writeFileSync(resolve(projectRoot, outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  course,
  packages: report.packages,
  checkedRefs: report.checkedRefs,
  missingRefs: report.missingRefs,
  packagesWithMissing: report.packagesWithMissing.map((item) => ({ packagePath: item.packagePath, missingRefs: item.missingRefs })),
}, null, 2));

if (report.missingRefs > 0) process.exitCode = 1;
