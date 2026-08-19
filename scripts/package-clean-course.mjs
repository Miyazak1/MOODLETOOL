import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const coursewareRoot = path.join(workspaceRoot, 'courseware');
const deploymentRoot = path.join(projectRoot, 'deployment');
const stagingRoot = path.join(deploymentRoot, 'course-package-staging');
const packagesRoot = path.join(deploymentRoot, 'course-packages');
const course = safeCourse(readArg('--course'));

if (!course) {
  console.error('Usage: node scripts/package-clean-course.mjs --course COURSE');
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function safeCourse(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '');
}

function toPosix(value) {
  return String(value || '').replaceAll('\\', '/');
}

function assertInside(parent, target) {
  const parentResolved = path.resolve(parent);
  const targetResolved = path.resolve(target);
  if (targetResolved !== parentResolved && !targetResolved.startsWith(parentResolved + path.sep)) {
    throw new Error(`Unsafe path outside ${parentResolved}: ${targetResolved}`);
  }
  return targetResolved;
}

function addFile(files, relativePath) {
  if (!relativePath) return;
  const clean = toPosix(relativePath);
  if (clean.includes('../') || path.isAbsolute(clean)) throw new Error(`Unsafe relative path: ${relativePath}`);
  files.add(clean);
}

function collectResource(files, dirs, resource) {
  if (!resource) return;
  addFile(files, resource.path);
  addFile(files, resource.previewPath);
  addFile(files, resource.downloadPath);
  for (const attachment of resource.attachments ?? []) {
    addFile(files, attachment.path);
    addFile(files, attachment.previewPath);
    addFile(files, attachment.downloadPath);
  }
  if (resource.packagePath) dirs.add(toPosix(resource.packagePath));
  if (String(resource.previewPath || '').endsWith('/index.html')) dirs.add(toPosix(path.posix.dirname(resource.previewPath)));
}

function copyFileFromCourse(courseRoot, stagingCourse, relativePath) {
  const source = assertInside(courseRoot, path.join(courseRoot, relativePath));
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  const target = assertInside(stagingCourse, path.join(stagingCourse, relativePath));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

function copyDirFromCourse(courseRoot, stagingCourse, relativeDir) {
  const source = assertInside(courseRoot, path.join(courseRoot, relativeDir));
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return false;
  const target = assertInside(stagingCourse, path.join(stagingCourse, relativeDir));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return true;
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

const courseRoot = assertInside(coursewareRoot, path.join(coursewareRoot, course));
const manifestPath = path.join(courseRoot, 'course-manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const files = new Set(['course-manifest.json']);
const dirs = new Set();

for (const section of manifest.courseSections ?? []) collectResource(files, dirs, section);
for (const resource of manifest.courseDownloads ?? []) collectResource(files, dirs, resource);
for (const resource of manifest.teacherResources ?? []) collectResource(files, dirs, resource);
for (const text of manifest.texts ?? []) {
  collectResource(files, dirs, text);
  for (const material of text.materials ?? []) collectResource(files, dirs, material);
}
for (const unit of manifest.units ?? []) {
  collectResource(files, dirs, unit.unitPlan);
  for (const resource of Object.values(unit.unitResources ?? {})) {
    if (Array.isArray(resource)) {
      for (const item of resource) collectResource(files, dirs, item);
    } else {
      collectResource(files, dirs, resource);
    }
  }
  for (const lesson of unit.lessons ?? []) {
    collectResource(files, dirs, lesson.lessonPlan);
    for (const resource of lesson.lessonText ?? []) collectResource(files, dirs, resource);
    for (const resource of lesson.textExports ?? []) collectResource(files, dirs, resource);
    for (const resource of lesson.downloads ?? []) collectResource(files, dirs, resource);
    for (const resource of lesson.ispring ?? []) collectResource(files, dirs, resource);
    for (const resource of lesson.bookSections ?? []) collectResource(files, dirs, resource);
  }
}

const stagingCourse = assertInside(stagingRoot, path.join(stagingRoot, course));
fs.rmSync(stagingCourse, { recursive: true, force: true });
fs.mkdirSync(stagingCourse, { recursive: true });

const missingFiles = [];
for (const relativePath of [...files].sort()) {
  if (!copyFileFromCourse(courseRoot, stagingCourse, relativePath)) missingFiles.push(relativePath);
}
const missingDirs = [];
for (const relativeDir of [...dirs].sort()) {
  if (!copyDirFromCourse(courseRoot, stagingCourse, relativeDir)) missingDirs.push(relativeDir);
}

fs.mkdirSync(packagesRoot, { recursive: true });
const zipPath = path.join(packagesRoot, `${course}-course-package-fixed-root-${timestamp()}.zip`);
const tar = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
const result = await new Promise((resolve) => {
  const child = spawn(tar, ['-acf', zipPath, '-C', stagingCourse, '.'], { stdio: 'inherit' });
  child.on('exit', (code) => resolve(code ?? 1));
});
if (result !== 0) throw new Error(`tar exited with ${result}`);

console.log(JSON.stringify({
  course,
  stagingCourse,
  zipPath,
  filesCopied: files.size - missingFiles.length,
  dirsCopied: dirs.size - missingDirs.length,
  missingFiles,
  missingDirs,
  bytes: fs.statSync(zipPath).size,
}, null, 2));
