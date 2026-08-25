import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, posix, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");
const packageRoot = resolve(projectRoot, "deployment", "course-packages");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function safeCourse(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "");
}

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function normalizeEntry(value) {
  return toPosix(value).replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isLocalReference(value) {
  const stringValue = String(value || "");
  return Boolean(stringValue) && !isHttpUrl(stringValue) && !stringValue.startsWith("data:");
}

function assertSafeRelative(relativePath) {
  const clean = normalizeEntry(relativePath);
  if (!clean || clean.includes("../") || clean.startsWith("../")) throw new Error(`Unsafe package path: ${relativePath}`);
  return clean;
}

function addFile(files, relativePath, owner = "") {
  if (!isLocalReference(relativePath)) return;
  const clean = assertSafeRelative(relativePath);
  if (!files.has(clean)) files.set(clean, new Set());
  if (owner) files.get(clean).add(owner);
}

function addDir(dirs, relativePath, owner = "") {
  if (!isLocalReference(relativePath)) return;
  const clean = assertSafeRelative(relativePath);
  if (!dirs.has(clean)) dirs.set(clean, new Set());
  if (owner) dirs.get(clean).add(owner);
}

function collectResource(files, dirs, resource, owner) {
  if (!resource || typeof resource !== "object") return;
  const label = owner || resource.label || resource.path || resource.previewPath || "";
  addFile(files, resource.path, label);
  addFile(files, resource.previewPath, label);
  addFile(files, resource.downloadPath, label);
  addFile(files, resource.localizedPackagePath, label);
  addFile(files, resource.packageFilePath, label);
  if (resource.packagePath) addDir(dirs, resource.packagePath, label);
  if (String(resource.previewPath || "").endsWith("/index.html")) addDir(dirs, posix.dirname(toPosix(resource.previewPath)), label);
  for (const attachment of resource.attachments || []) collectResource(files, dirs, attachment, `${label} attachment`);
}

function collectCourseSectionPages(courseRoot, files) {
  const sectionsRoot = join(courseRoot, "course-sections");
  if (!existsSync(sectionsRoot) || !statSync(sectionsRoot).isDirectory()) return;
  for (const entry of readdirSync(sectionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    addFile(files, toPosix(join("course-sections", entry.name, "index.html")), "course section index");
  }
}

function htmlReferenceToCoursePath(htmlPath, rawValue) {
  const value = String(rawValue || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
  if (!value || value.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(value)) return "";
  if (value.startsWith("/")) return "";
  const rawPath = value.replace(/[?#].*$/, "");
  if (!rawPath) return "";
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return "";
  }
  if (htmlPath.startsWith("previews-html/") && decodedPath.startsWith("../")) {
    const courseRootCandidate = toPosix(decodedPath).replace(/^(?:\.\.\/)+/, "");
    if (courseRootCandidate && !courseRootCandidate.startsWith("../") && !courseRootCandidate.includes("/../")) {
      return posix.normalize(courseRootCandidate).replace(/^\/+/, "");
    }
  }
  const normalized = posix.normalize(posix.join(posix.dirname(htmlPath), toPosix(decodedPath))).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

function collectHtmlDependencies(courseRoot, files, dirs) {
  let changed = true;
  while (changed) {
    changed = false;
    const htmlFiles = [...files.keys()].filter((item) => /\.html?$/i.test(item));
    for (const htmlPath of htmlFiles) {
      const absolutePath = join(courseRoot, htmlPath);
      if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;
      const html = readFileSync(absolutePath, "utf8");
      html.replace(/\b(?:href|src|poster)\s*=\s*(["'])([^"']+)\1/gi, (_match, _quote, rawValue) => {
        const coursePath = htmlReferenceToCoursePath(htmlPath, rawValue);
        if (!coursePath) return _match;
        const before = files.size;
        addFile(files, coursePath, `html dependency of ${htmlPath}`);
        if (coursePath.endsWith("/index.html")) addDir(dirs, posix.dirname(coursePath), `html dependency of ${htmlPath}`);
        changed = files.size !== before || changed;
        return _match;
      });
    }
  }
}

function collectExpectedPackageEntries(courseRoot, manifest) {
  const files = new Map();
  const dirs = new Map();
  addFile(files, "course-manifest.json", "manifest");
  if (existsSync(join(courseRoot, "package-manifest.json"))) addFile(files, "package-manifest.json", "package manifest");
  if (existsSync(join(courseRoot, "validation-report.json"))) addFile(files, "validation-report.json", "validation report");

  for (const section of manifest.courseSections || []) {
    collectResource(files, dirs, section, section.label);
    collectResource(files, dirs, section.unitPlan, `${section.label || "course section"} unit plan`);
    for (const resource of section.ispring || []) collectResource(files, dirs, resource, `${section.label || "course section"} iSpring`);
    for (const resource of section.media || []) collectResource(files, dirs, resource, `${section.label || "course section"} media`);
    for (const resource of section.downloads || []) collectResource(files, dirs, resource, `${section.label || "course section"} download`);
  }
  for (const resource of manifest.courseDownloads || []) collectResource(files, dirs, resource, resource.label);
  for (const resource of manifest.teacherResources || []) collectResource(files, dirs, resource, resource.label);
  for (const resource of manifest.evaluations || []) collectResource(files, dirs, resource, resource.label);
  for (const text of manifest.texts || []) {
    collectResource(files, dirs, text, text.title);
    for (const material of text.materials || []) collectResource(files, dirs, material, `${text.title || "text"} material`);
  }
  for (const unit of manifest.units || []) {
    collectResource(files, dirs, unit.unitPlan, `Unit ${unit.unit} plan`);
    for (const [key, value] of Object.entries(unit.unitResources || {})) {
      if (Array.isArray(value)) {
        for (const resource of value) collectResource(files, dirs, resource, `Unit ${unit.unit} ${key}`);
      } else {
        collectResource(files, dirs, value, `Unit ${unit.unit} ${key}`);
      }
    }
    for (const lesson of unit.lessons || []) {
      const owner = `U${String(unit.unit).padStart(2, "0")}L${String(lesson.lesson).padStart(2, "0")} ${lesson.title || ""}`;
      collectResource(files, dirs, lesson.lessonPlan, `${owner} lesson plan`);
      for (const resource of lesson.lessonText || []) collectResource(files, dirs, resource, `${owner} lesson text`);
      for (const resource of lesson.textExports || []) collectResource(files, dirs, resource, `${owner} text export`);
      for (const resource of lesson.downloads || []) collectResource(files, dirs, resource, `${owner} download`);
      for (const resource of lesson.handsOn || []) collectResource(files, dirs, resource, `${owner} hands on`);
      for (const resource of lesson.ispring || []) collectResource(files, dirs, resource, `${owner} iSpring`);
      for (const resource of lesson.bookSections || []) collectResource(files, dirs, resource, `${owner} book section`);
    }
  }

  collectCourseSectionPages(courseRoot, files);
  collectHtmlDependencies(courseRoot, files, dirs);
  return { files, dirs };
}

function addIssue(issues, severity, rule, message, context = {}) {
  issues.push({ severity, rule, message, context });
}

function findLatestZip(course) {
  if (!existsSync(packageRoot)) return "";
  const candidates = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toUpperCase().startsWith(course) && /\.zip$/i.test(entry.name))
    .map((entry) => {
      const path = join(packageRoot, entry.name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path || "";
}

async function readZipEntries(zipPath) {
  const unzipper = await import("unzipper");
  const directory = await unzipper.Open.file(zipPath);
  const entries = new Map();
  for (const entry of directory.files) {
    const name = normalizeEntry(entry.path);
    if (!name) continue;
    entries.set(name, entry);
  }
  return { directory, entries };
}

async function readZipText(directory, entryName) {
  const normalized = normalizeEntry(entryName);
  const entry = directory.files.find((item) => normalizeEntry(item.path) === normalized);
  if (!entry) return "";
  const buffer = await entry.buffer();
  return buffer.toString("utf8");
}

function entryExists(entries, relativePath) {
  const clean = normalizeEntry(relativePath);
  return entries.has(clean);
}

function dirExists(entries, relativeDir) {
  const clean = normalizeEntry(relativeDir);
  return entries.has(clean) || [...entries.keys()].some((entry) => entry.startsWith(`${clean}/`));
}

function validatePackageShape(entries, course, issues) {
  const names = [...entries.keys()];
  const hasRootManifest = names.includes("course-manifest.json");
  const hasNestedManifest = names.includes(`${course}/course-manifest.json`);
  if (!hasRootManifest) {
    addIssue(
      issues,
      "error",
      "zip-missing-root-manifest",
      hasNestedManifest
        ? `Package has ${course}/course-manifest.json but upload expects course-manifest.json at zip root.`
        : "Package is missing course-manifest.json at zip root.",
      { course },
    );
  }
  const firstSegments = new Set(names.filter(Boolean).map((entry) => entry.split("/")[0]));
  if (firstSegments.size === 1 && firstSegments.has(course)) {
    addIssue(issues, "error", "zip-nested-course-root", `Package appears nested under ${course}/. Current uploader expects fixed root with course-manifest.json at zip root.`, {
      course,
    });
  }
}

async function validateZipPackage({ zipPath, course, courseRoot, manifestPath, localManifest, expected }) {
  const issues = [];
  const localManifestText = readFileSync(manifestPath, "utf8");
  const { directory, entries } = await readZipEntries(zipPath);
  validatePackageShape(entries, course, issues);

  const zipManifestText = await readZipText(directory, "course-manifest.json");
  let zipManifest = null;
  if (zipManifestText) {
    try {
      zipManifest = JSON.parse(zipManifestText);
    } catch (error) {
      addIssue(issues, "error", "zip-manifest-invalid-json", `course-manifest.json in zip is not valid JSON: ${error.message}`, {});
    }
    if (zipManifest?.course?.code && String(zipManifest.course.code).toUpperCase() !== course) {
      addIssue(issues, "error", "zip-manifest-course-mismatch", `Zip manifest course code is ${zipManifest.course.code}, expected ${course}.`, {
        zipCourse: zipManifest.course.code,
        expectedCourse: course,
      });
    }
    if (sha256Text(zipManifestText) !== sha256Text(localManifestText)) {
      addIssue(issues, "warn", "zip-manifest-differs-from-local", "Zip course-manifest.json differs from the current local manifest.", {
        localManifest: manifestPath,
        zipPath,
      });
    }
  }

  const missingLocalFiles = [];
  const missingZipFiles = [];
  for (const [relativePath, owners] of expected.files.entries()) {
    const absolute = join(courseRoot, relativePath);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      missingLocalFiles.push({ path: relativePath, owners: [...owners].slice(0, 5) });
      continue;
    }
    if (!entryExists(entries, relativePath)) {
      missingZipFiles.push({ path: relativePath, owners: [...owners].slice(0, 5) });
    }
  }
  for (const item of missingLocalFiles.slice(0, 200)) {
    addIssue(issues, "error", "expected-file-missing-locally", `Expected package file is missing locally: ${item.path}`, item);
  }
  for (const item of missingZipFiles.slice(0, 300)) {
    addIssue(issues, "error", "expected-file-missing-from-zip", `Expected package file is missing from zip: ${item.path}`, item);
  }
  if (missingLocalFiles.length > 200) {
    addIssue(issues, "error", "expected-file-missing-locally-overflow", `${missingLocalFiles.length - 200} additional local missing files omitted.`, {});
  }
  if (missingZipFiles.length > 300) {
    addIssue(issues, "error", "expected-file-missing-from-zip-overflow", `${missingZipFiles.length - 300} additional zip missing files omitted.`, {});
  }

  for (const [relativeDir, owners] of expected.dirs.entries()) {
    const absolute = join(courseRoot, relativeDir);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      addIssue(issues, "error", "expected-dir-missing-locally", `Expected package directory is missing locally: ${relativeDir}`, {
        path: relativeDir,
        owners: [...owners].slice(0, 5),
      });
      continue;
    }
    if (!dirExists(entries, relativeDir)) {
      addIssue(issues, "error", "expected-dir-missing-from-zip", `Expected package directory is missing from zip: ${relativeDir}`, {
        path: relativeDir,
        owners: [...owners].slice(0, 5),
      });
    }
  }

  const rootEntries = [...new Set([...entries.keys()].map((entry) => entry.split("/")[0]))].filter(Boolean);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  return {
    zipPath,
    entries: entries.size,
    rootEntries: rootEntries.slice(0, 50),
    manifestInZip: Boolean(zipManifestText),
    expectedFiles: expected.files.size,
    expectedDirs: expected.dirs.size,
    issues,
    summary: {
      status: errors ? "fail" : warnings ? "review" : "pass",
      errors,
      warnings,
      missingZipFiles: missingZipFiles.length,
      missingLocalFiles: missingLocalFiles.length,
    },
  };
}

function validateLocalPreflight({ courseRoot, expected }) {
  const issues = [];
  for (const [relativePath, owners] of expected.files.entries()) {
    const absolute = join(courseRoot, relativePath);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      addIssue(issues, "error", "expected-file-missing-locally", `Expected package file is missing locally: ${relativePath}`, {
        path: relativePath,
        owners: [...owners].slice(0, 5),
      });
    }
  }
  for (const [relativeDir, owners] of expected.dirs.entries()) {
    const absolute = join(courseRoot, relativeDir);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      addIssue(issues, "error", "expected-dir-missing-locally", `Expected package directory is missing locally: ${relativeDir}`, {
        path: relativeDir,
        owners: [...owners].slice(0, 5),
      });
    }
  }
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  return {
    expectedFiles: expected.files.size,
    expectedDirs: expected.dirs.size,
    issues,
    summary: {
      status: errors ? "fail" : warnings ? "review" : "pass",
      errors,
      warnings,
      missingLocalFiles: issues.filter((issue) => issue.rule === "expected-file-missing-locally").length,
    },
  };
}

function printHuman(report) {
  console.log(`${report.course} package QA: ${report.summary.status.toUpperCase()}`);
  console.log(`Mode ${report.mode}; Expected files ${report.expectedFiles}; Expected dirs ${report.expectedDirs}`);
  if (report.zipPath) console.log(`Zip ${report.zipPath}`);
  if (typeof report.entries === "number") console.log(`Zip entries ${report.entries}`);
  console.log(`Errors ${report.summary.errors}; Warnings ${report.summary.warnings}`);
  const grouped = new Map();
  for (const issue of report.issues) {
    const key = `${issue.severity}:${issue.rule}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(issue);
  }
  for (const [key, issues] of grouped) {
    const [severity, rule] = key.split(":");
    console.log(`\n[${severity.toUpperCase()}] ${rule} (${issues.length})`);
    for (const issue of issues.slice(0, 10)) console.log(`- ${issue.message}`);
    if (issues.length > 10) console.log(`- ... ${issues.length - 10} more`);
  }
}

const course = safeCourse(readArg("--course") || process.argv.find((arg) => /^[A-Za-z]{3,4}\d[A-Za-z]?$/.test(arg)));
const explicitCourseRoot = readArg("--course-root");
const explicitZip = readArg("--zip");
const outPath = readArg("--out");
const jsonMode = hasFlag("--json");
const noAutoZip = hasFlag("--no-auto-zip");

if (!course && !explicitCourseRoot) {
  console.error("Usage: npm run qa:package -- --course ICS3U [--zip deployment/course-packages/ICS3U-course-package.zip] [--json]");
  process.exit(2);
}

try {
  const courseRoot = resolve(explicitCourseRoot || join(coursewareRoot, course));
  const manifestPath = join(courseRoot, "course-manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing local manifest: ${manifestPath}`);
  const localManifest = readJson(manifestPath);
  const courseCode = safeCourse(localManifest.course?.code || course);
  const expected = collectExpectedPackageEntries(courseRoot, localManifest);
  const zipPath = explicitZip ? resolve(explicitZip) : noAutoZip ? "" : findLatestZip(courseCode);

  const base = {
    generatedAt: new Date().toISOString(),
    course: courseCode,
    courseRoot,
    manifestPath,
  };
  let result;
  if (zipPath) {
    if (!existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);
    result = await validateZipPackage({ zipPath, course: courseCode, courseRoot, manifestPath, localManifest, expected });
    result = { ...base, mode: "zip", ...result };
  } else {
    result = validateLocalPreflight({ courseRoot, expected });
    result = { ...base, mode: "local-preflight", ...result };
    addIssue(result.issues, "warn", "zip-not-checked", "No zip was provided or found; only local package preflight was checked.", {});
    result.summary.warnings += 1;
    result.summary.status = result.summary.errors ? "fail" : "review";
  }
  if (outPath) writeFileSync(resolve(outPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (jsonMode) console.log(JSON.stringify(result, null, 2));
  else {
    printHuman(result);
    if (outPath) console.log(`\nWrote ${resolve(outPath)}`);
  }
  process.exit(result.summary.errors ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(2);
}

