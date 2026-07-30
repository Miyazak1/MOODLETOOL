import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

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

function localCourseRoot(course) {
  if (!course.baseUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.baseUrl.slice(1)));
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return normalize(join(workspaceRoot, course.manifestUrl.slice(1)));
}

function addManifestFiles(course, manifest, courseRoot) {
  const files = new Map();

  function addFile(relativePath, role) {
    if (!relativePath) return;
    const absolutePath = join(courseRoot, relativePath);
    if (!existsSync(absolutePath)) return;
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return;
    const normalizedRelative = relativePath.replaceAll("\\", "/");
    const current = files.get(normalizedRelative);
    if (current) {
      current.roles = Array.from(new Set([...current.roles, role])).sort();
      return;
    }
    files.set(normalizedRelative, {
      key: `${course.code}/${normalizedRelative}`,
      path: absolutePath,
      relativePath: normalizedRelative,
      bytes: stat.size,
      roles: [role],
    });
  }

  function addResource(item, role) {
    if (!item) return;
    addFile(item.path, role);
    addFile(item.previewPath, `${role}:preview`);
    addFile(item.downloadPath, `${role}:download`);
    addFile(item.packagePath, `${role}:package`);
    for (const attachment of item.attachments || []) {
      addResource(attachment, `${role}:attachment`);
    }
  }

  addFile("course-manifest.json", "manifest");
  for (const item of manifest.courseDownloads || []) addResource(item, item.role || "course-document");
  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) addResource(item, "text-material");
  }

  for (const unit of manifest.units || []) {
    if (unit.unitPlan) addResource(unit.unitPlan, "unit-plan");
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) addResource(lesson.lessonPlan, "lesson-plan");
      for (const item of lesson.ispring || []) addResource(item, "ispring-entry");
      for (const item of lesson.downloads || []) addResource(item, item.role || item.category || "download");
      for (const item of lesson.textExports || []) addResource(item, "lesson-text");
    }
  }

  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.ispring || []) {
        const packageDir = join(courseRoot, item.packagePath);
        if (!existsSync(packageDir)) continue;
        const stack = [packageDir];
        while (stack.length) {
          const dir = stack.pop();
          for (const entry of statSync(dir).isDirectory() ? readdirSync(dir, { withFileTypes: true }) : []) {
            const absolute = join(dir, entry.name);
            const entryStat = statSync(absolute);
            if (entryStat.isDirectory()) {
              stack.push(absolute);
            } else {
              const relativePath = relative(courseRoot, absolute).replaceAll("\\", "/");
              addFile(relativePath, "ispring-package");
            }
          }
        }
      }
    }
  }

  return Array.from(files.values()).sort((a, b) => a.key.localeCompare(b.key));
}

if (!existsSync(catalogPath)) {
  console.error(`Missing course catalog: ${catalogPath}`);
  process.exit(1);
}

const catalog = readJson(catalogPath);
const courses = requestedCourse
  ? catalog.courses.filter((course) => course.code.toLowerCase() === requestedCourse.toLowerCase())
  : catalog.courses;

if (!courses.length) {
  console.error(`No course found for --course ${requestedCourse}`);
  process.exit(1);
}

for (const course of courses) {
  const courseRoot = localCourseRoot(course);
  const manifestPath = localManifestPath(course);
  if (!courseRoot || !manifestPath) {
    console.log(`${course.code}: remote courseware, upload list skipped`);
    continue;
  }
  if (!existsSync(manifestPath)) {
    console.error(`Missing manifest for ${course.code}: ${manifestPath}`);
    process.exit(1);
  }

  const manifest = readJson(manifestPath);
  const uploadList = addManifestFiles(course, manifest, courseRoot);
  const totalBytes = uploadList.reduce((sum, item) => sum + item.bytes, 0);
  const outputPath = join(projectRoot, "deployment", `${course.code}-courseware-upload-list.json`);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        course: course.code,
        fileCount: uploadList.length,
        totalBytes,
        totalGB: Number((totalBytes / 1024 / 1024 / 1024).toFixed(2)),
        targetKeyPrefix: `${course.code}/`,
        files: uploadList,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Wrote ${outputPath}`);
  console.log(`${course.code}: Files ${uploadList.length}; Total GB ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)}`);
}
