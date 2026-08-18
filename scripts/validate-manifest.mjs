import { existsSync, readFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const requestedCourse = readArg("--course");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function localPathFromUrl(url) {
  if (!url?.startsWith("/")) return null;
  return normalize(join(projectRoot, "dist", url));
}

function localCourseRoot(course) {
  if (!course.baseUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.baseUrl.slice(1)));
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.manifestUrl.slice(1)));
}

function validateCatalog(catalog) {
  const errors = [];
  if (!Array.isArray(catalog.courses) || !catalog.courses.length) {
    errors.push("Catalog has no courses.");
  }
  if (!catalog.courses?.some((course) => course.code === catalog.defaultCourse)) {
    errors.push(`Default course is not listed: ${catalog.defaultCourse}`);
  }
  for (const course of catalog.courses || []) {
    if (!course.code || !course.title || !course.manifestUrl || !course.baseUrl) {
      errors.push(`Course entry is incomplete: ${JSON.stringify(course)}`);
    }
    const manifestPath = localManifestPath(course);
    if (manifestPath && !existsSync(manifestPath)) {
      errors.push(`Local manifest is missing for ${course.code}: ${manifestPath}`);
    }
  }
  return errors;
}

function validateManifest(course, manifest) {
  const missing = [];
  const errors = [];
  const courseRoot = localCourseRoot(course);
  if (!courseRoot) {
    return { missing, errors, skippedLocalPathValidation: true };
  }

  function check(relativePath, label) {
    if (!relativePath || typeof relativePath !== "string") {
      errors.push(`${label} is missing a path.`);
      return;
    }
    const path = join(courseRoot, relativePath);
    if (!existsSync(path)) missing.push(path);
  }

  function checkFileRecord(item, label) {
    if (!item || typeof item !== "object") {
      errors.push(`${label} is not an object.`);
      return;
    }
    for (const field of ["label", "type", "category", "role"]) {
      if (!item[field] || typeof item[field] !== "string") {
        errors.push(`${label} is missing string field ${field}.`);
      }
    }
    const hasPath = item.path && typeof item.path === "string";
    const hasUrl = item.url && typeof item.url === "string";
    if (!hasPath && !hasUrl) {
      errors.push(`${label} is missing either path or url.`);
      return;
    }
    if (hasUrl && !/^https?:\/\//i.test(item.url)) {
      errors.push(`${label} url must start with http:// or https://.`);
    }
    if (hasPath) {
      if (typeof item.bytes !== "number" || item.bytes < 0) {
        errors.push(`${label} has invalid bytes.`);
      }
      check(item.path, label);
    }
    if (item.previewUrl && !/^https?:\/\//i.test(item.previewUrl)) {
      errors.push(`${label} previewUrl must start with http:// or https://.`);
    }
    if (item.previewPath) {
      check(item.previewPath, `${label} preview`);
    }
    for (const [index, attachment] of (item.attachments || []).entries()) {
      checkAttachmentRecord(attachment, `${label} attachment ${index + 1}`);
    }
  }

  function checkAttachmentRecord(item, label) {
    if (!item || typeof item !== "object") {
      errors.push(`${label} is not an object.`);
      return;
    }
    for (const field of ["label", "type", "path"]) {
      if (!item[field] || typeof item[field] !== "string") {
        errors.push(`${label} is missing string field ${field}.`);
      }
    }
    if (typeof item.bytes !== "number" || item.bytes < 0) {
      errors.push(`${label} has invalid bytes.`);
    }
    if (item.path) check(item.path, label);
    if (item.previewPath) check(item.previewPath, `${label} preview`);
  }

  function checkExternalLinkRecord(item, label) {
    if (!item || typeof item !== "object") {
      errors.push(`${label} is not an object.`);
      return;
    }
    for (const field of ["label", "type", "category", "role", "url"]) {
      if (!item[field] || typeof item[field] !== "string") {
        errors.push(`${label} is missing string field ${field}.`);
      }
    }
    if (item.url && !/^https?:\/\//i.test(item.url)) {
      errors.push(`${label} url must start with http:// or https://.`);
    }
  }

  function checkIspringRecord(item, label) {
    if (!["page", "external"].includes(item.mode)) errors.push(`${label} iSpring entry must use page or external mode.`);
    if (item.url) {
      if (!/^https?:\/\//i.test(item.url)) errors.push(`${label} iSpring url must start with http:// or https://.`);
    } else {
      if (!item.path || !item.packagePath) errors.push(`${label} iSpring entry is missing path or packagePath.`);
      check(item.path, `${label} iSpring page`);
    }
    if (item.downloadUrl && !/^https?:\/\//i.test(item.downloadUrl)) {
      errors.push(`${label} iSpring downloadUrl must start with http:// or https://.`);
    }
    if (item.downloadPath) {
      check(item.downloadPath, `${label} iSpring download`);
    }
  }

  if (manifest.navigation?.primary !== "unit" || manifest.navigation?.secondary !== "lesson") {
    errors.push(`${course.code} navigation must be unit-first with lesson as secondary.`);
  }
  if (!Array.isArray(manifest.units) || !manifest.units.length) {
    errors.push(`${course.code} manifest has no units.`);
  }
  if (!Array.isArray(manifest.texts)) {
    errors.push(`${course.code} texts must be an array.`);
  }

  for (const item of manifest.courseDownloads || []) checkFileRecord(item, "course download");
  for (const item of manifest.courseSections || []) checkFileRecord(item, "course section");
  for (const section of manifest.courseSections || []) {
    for (const item of section.ispring || []) checkIspringRecord(item, `course section ${section.label || section.role || "section"}`);
  }
  for (const item of manifest.evaluations || []) checkFileRecord(item, "evaluation resource");
  for (const item of manifest.teacherResources || []) checkFileRecord(item, "teacher resource");
  for (const text of manifest.texts || []) {
    if (!text.id || !text.title || !Array.isArray(text.units)) {
      errors.push(`Text entry is incomplete: ${JSON.stringify(text)}`);
    }
    for (const item of text.materials || []) checkFileRecord(item, `text material ${text.id}`);
    for (const item of text.externalLinks || []) checkExternalLinkRecord(item, `text external link ${text.id}`);
  }
  for (const unit of manifest.units || []) {
    if (typeof unit.unit !== "number" || !unit.title || !Array.isArray(unit.lessons)) {
      errors.push(`Unit entry is incomplete: ${JSON.stringify({ unit: unit.unit, title: unit.title })}`);
    }
    if (unit.unitPlan) checkFileRecord(unit.unitPlan, `unit ${unit.unit} plan`);
    for (const [key, value] of Object.entries(unit.unitResources || {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object") checkFileRecord(item, `unit ${unit.unit} resource ${key}`);
        }
      } else if (value && typeof value === "object") {
        checkFileRecord(value, `unit ${unit.unit} resource ${key}`);
      }
    }
    for (const lesson of unit.lessons || []) {
      if (!lesson.id || typeof lesson.unit !== "number" || typeof lesson.lesson !== "number" || !lesson.title) {
        errors.push(`Lesson entry is incomplete: ${JSON.stringify({ id: lesson.id, title: lesson.title })}`);
      }
      if (lesson.unit !== unit.unit) {
        errors.push(`${lesson.id} unit number does not match parent unit ${unit.unit}.`);
      }
      if (lesson.lessonPlan) checkFileRecord(lesson.lessonPlan, `${lesson.id} lesson plan`);
      for (const item of lesson.ispring || []) {
        checkIspringRecord(item, lesson.id);
      }
      for (const item of lesson.bookSections || []) checkFileRecord(item, `${lesson.id} book section`);
      for (const item of lesson.downloads || []) checkFileRecord(item, `${lesson.id} download`);
      for (const item of lesson.textExports || []) checkFileRecord(item, `${lesson.id} text export`);
    }
  }
  return { missing, errors, skippedLocalPathValidation: false };
}

if (!existsSync(catalogPath)) {
  console.error(`Missing course catalog: ${catalogPath}`);
  process.exit(1);
}

const catalog = readJson(catalogPath);
const catalogErrors = validateCatalog(catalog);
if (catalogErrors.length) {
  for (const error of catalogErrors) console.error(`- ${error}`);
  process.exit(1);
}

let courses = requestedCourse
  ? catalog.courses.filter((course) => course.code.toLowerCase() === requestedCourse.toLowerCase())
  : catalog.courses;

if (!courses.length) {
  const manifestPath = normalize(join(workspaceRoot, "courseware", requestedCourse, "course-manifest.json"));
  if (!existsSync(manifestPath)) {
    console.error(`No course found for --course ${requestedCourse}`);
    process.exit(1);
  }
  courses = [
    {
      code: requestedCourse,
      title: requestedCourse,
      baseUrl: `/courseware/${requestedCourse}/`,
      manifestUrl: `/courseware/${requestedCourse}/course-manifest.json`,
    },
  ];
}

let failed = false;
console.log(`Catalog courses: ${catalog.courses.length}`);

for (const course of courses) {
  const manifestPath = localManifestPath(course);
  if (!manifestPath) {
    console.log(`${course.code}: remote manifest, local path validation skipped`);
    continue;
  }

  const manifest = readJson(manifestPath);
  const lessonCount = (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0);
  const { missing, errors, skippedLocalPathValidation } = validateManifest(course, manifest);

  console.log(`${course.code}: Units ${manifest.units?.length || 0}; Lessons ${lessonCount}; Missing paths ${missing.length}; Rule errors ${errors.length}`);
  if (skippedLocalPathValidation) {
    console.log(`${course.code}: local resource validation skipped`);
  }
  if (errors.length) {
    failed = true;
    for (const error of errors.slice(0, 30)) console.error(`- ${error}`);
    if (errors.length > 30) console.error(`... ${errors.length - 30} more`);
  }
  if (missing.length) {
    failed = true;
    for (const path of missing.slice(0, 20)) console.error(`- ${path}`);
    if (missing.length > 20) console.error(`... ${missing.length - 20} more`);
  }
}

if (failed) process.exit(1);
