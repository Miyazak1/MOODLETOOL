import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const requestedCourse = readArg("--course");

const ZIP_TYPES = new Set([".docx", ".pptx", ".xlsx"]);
const CHECKED_TYPES = new Set([".docx", ".pptx", ".xlsx", ".pdf", ".doc"]);

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(path) {
  if (!existsSync(path)) fail(`Missing JSON: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function localCourseRoot(course) {
  if (!course.baseUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.baseUrl.slice(1)));
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.manifestUrl.slice(1)));
}

function collectFileRecords(manifest) {
  const records = [];
  const add = (item, owner) => {
    if (item?.path) records.push({ item, owner });
    if (item?.previewPath) records.push({ item: { ...item, path: item.previewPath, type: extname(item.previewPath).slice(1) }, owner: `${owner} preview` });
    if (item?.downloadPath) records.push({ item: { ...item, path: item.downloadPath, type: extname(item.downloadPath).slice(1) }, owner: `${owner} download` });
    for (const [index, attachment] of (item?.attachments || []).entries()) add(attachment, `${owner} attachment ${index + 1}`);
  };

  for (const item of manifest.courseDownloads || []) add(item, "course download");
  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) add(item, `text material ${text.id}`);
  }
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) add(unit.unitPlan, `unit ${unit.unit} plan`);
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) add(lesson.lessonPlan, `${lesson.id} lesson plan`);
      for (const item of lesson.bookSections || []) add(item, `${lesson.id} book section`);
      for (const item of lesson.downloads || []) add(item, `${lesson.id} download`);
      for (const item of lesson.textExports || []) add(item, `${lesson.id} text export`);
      for (const item of lesson.ispring || []) add(item, `${lesson.id} iSpring`);
    }
  }
  return records;
}

function signatureFor(path) {
  const bytes = readFileSync(path);
  return {
    bytes,
    startsWithPk: bytes[0] === 0x50 && bytes[1] === 0x4b,
    startsWithPdf: bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46,
    startsWithOle: bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0,
    textProbe: Buffer.from(bytes.slice(0, Math.min(bytes.length, 256))).toString("utf8"),
  };
}

function validateSignature(path) {
  const suffix = extname(path).toLowerCase();
  if (!CHECKED_TYPES.has(suffix)) return null;
  const signature = signatureFor(path);
  if (ZIP_TYPES.has(suffix) && !signature.startsWithPk && !(suffix === ".docx" && signature.startsWithOle)) {
    return `${suffix.slice(1).toUpperCase()} file does not start with ZIP/PK signature.`;
  }
  if (suffix === ".pdf" && !signature.startsWithPdf) return "PDF file does not start with %PDF signature.";
  if (suffix === ".doc" && !signature.startsWithOle) return "DOC file does not start with OLE compound document signature.";
  if (/<!doctype html|<html|用户名|密码|登录|password|login/i.test(signature.textProbe)) {
    return "File content looks like HTML/login text.";
  }
  return null;
}

const catalog = readJson(catalogPath);
const courses = requestedCourse
  ? (catalog.courses || []).filter((course) => course.code.toLowerCase() === requestedCourse.toLowerCase())
  : catalog.courses || [];

if (requestedCourse && !courses.length) fail(`No course found for --course ${requestedCourse}`);

const errors = [];
let checkedFiles = 0;
for (const course of courses) {
  const courseRoot = localCourseRoot(course);
  const manifestPath = localManifestPath(course);
  if (!courseRoot || !manifestPath || !existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  for (const record of collectFileRecords(manifest)) {
    const fullPath = normalize(join(courseRoot, record.item.path));
    const suffix = extname(fullPath).toLowerCase();
    if (!CHECKED_TYPES.has(suffix)) continue;
    if (!existsSync(fullPath)) continue;
    checkedFiles += 1;
    const error = validateSignature(fullPath);
    if (error) errors.push(`${course.code} ${record.owner}: ${record.item.path} - ${error}`);
  }
}

if (errors.length) {
  for (const error of errors.slice(0, 50)) console.error(`- ${error}`);
  if (errors.length > 50) console.error(`... ${errors.length - 50} more`);
  process.exit(1);
}

console.log(`Courseware file signatures OK: ${checkedFiles} Office/PDF file(s) checked across ${courses.length} course(s).`);
