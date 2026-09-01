import fs from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const courseRoot = path.join(workspaceRoot, "courseware", "SBI4U");
const reportPath = path.join(workspaceRoot, "ossd-course-portal", "deployment", "SBI4U-package-asset-repair-report.json");

function toPosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function assertInside(parent, target) {
  const parentResolved = path.resolve(parent);
  const targetResolved = path.resolve(target);
  if (targetResolved !== parentResolved && !targetResolved.startsWith(parentResolved + path.sep)) {
    throw new Error(`Unsafe path outside ${parentResolved}: ${targetResolved}`);
  }
  return targetResolved;
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_backups") continue;
      walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function sanitizeSegment(value) {
  return toPosix(value).trim().replace(/[^A-Za-z0-9._/\- ]+/g, "_");
}

function htmlReferenceToCoursePath(htmlPath, rawValue) {
  const value = String(rawValue || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
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
      return path.posix.normalize(courseRootCandidate).replace(/^\/+/, "");
    }
  }
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(htmlPath), toPosix(decodedPath))).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) return "";
  return normalized;
}

function copyAlias(sourceRel, targetRel, copiedAliases) {
  const source = assertInside(courseRoot, path.join(courseRoot, sourceRel));
  const target = assertInside(courseRoot, path.join(courseRoot, targetRel));
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copiedAliases.push({ from: toPosix(sourceRel), to: toPosix(targetRel) });
  return true;
}

function findPreviewAlias(missingRel) {
  if (!missingRel.startsWith("previews-html/")) return "";
  const suffix = missingRel.slice("previews-html/".length);
  const sanitized = `previews-html/${sanitizeSegment(suffix)}`;
  if (fs.existsSync(path.join(courseRoot, sanitized))) return sanitized;

  const basename = path.basename(sanitized);
  const prefix = basename.slice(0, Math.min(10, basename.length));
  const allPreviewFiles = walkFiles(path.join(courseRoot, "previews-html"));
  const found = allPreviewFiles.find((file) => path.basename(file).startsWith(prefix) && path.basename(file).endsWith(".html"));
  return found ? toPosix(path.relative(courseRoot, found)) : "";
}

function repairPreviewAliases() {
  const copiedAliases = [];
  const htmlFiles = walkFiles(courseRoot).filter((file) => file.toLowerCase().endsWith(".html"));
  const attrPattern = /\b(?:href|src|poster)\s*=\s*(["'])([^"']+)\1/gi;
  for (const file of htmlFiles) {
    const htmlRel = toPosix(path.relative(courseRoot, file));
    if (htmlRel.startsWith("_backups/")) continue;
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(attrPattern)) {
      const rel = htmlReferenceToCoursePath(htmlRel, match[2]);
      if (!rel || !rel.startsWith("previews-html/")) continue;
      if (fs.existsSync(path.join(courseRoot, rel))) continue;
      const aliasSource = findPreviewAlias(rel);
      if (aliasSource) copyAlias(aliasSource, rel, copiedAliases);
    }
  }
  return copiedAliases;
}

function repairExamViewHtml() {
  const examPath = path.join(courseRoot, "course-sections/course-resources/files/c9ab3dffbd-sbi4u_mt_exam_review_chpt_3.html");
  const assetsDir = path.join(courseRoot, "course-sections/course-resources/files/sbi4u_chpt_3_mt_exa_files");
  const tinyGif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  const requiredGifs = ["chkwork.gif", "restart.gif", "correct.gif", "wrong.gif", "nograde.gif", "retake.gif", "header.gif"];
  fs.mkdirSync(assetsDir, { recursive: true });
  const created = [];
  for (const name of requiredGifs) {
    const target = path.join(assetsDir, name);
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, tinyGif);
      created.push(toPosix(path.relative(courseRoot, target)));
    }
  }
  if (!fs.existsSync(examPath)) return { created, updated: false };
  let html = fs.readFileSync(examPath, "utf8");
  const before = html;
  html = html
    .replaceAll("file:///C:/Users/086903/Downloads/sbi4u_chpt_3_mt_exa_files/", "sbi4u_chpt_3_mt_exa_files/")
    .replaceAll("file:///C:/Users/086903/Downloads/sbi4u_chpt_3_mt_exam_review.htm#", "c9ab3dffbd-sbi4u_mt_exam_review_chpt_3.html#")
    .replaceAll("file:///C:/Users/086903/Downloads/sbi4u_chpt_3_mt_exam_review.htm", "c9ab3dffbd-sbi4u_mt_exam_review_chpt_3.html");
  if (html !== before) fs.writeFileSync(examPath, html, "utf8");
  return { created, updated: html !== before };
}

function writeCourseResourcesIndex() {
  const indexPath = path.join(courseRoot, "course-sections/course-resources/index.html");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SBI4U - Course Resources - Course Content</title>
  <link rel="stylesheet" href="../../_assets/course-page-shell.css" data-course-shell="eng3u-course-shell-v2">
</head>
<body>
  <main>
    <div class="page-title"><p>SBI4U</p><h1>Course Resources</h1></div>
    <section class="moodle-section">
      <header><p>Course Content</p><h2>Course Resources</h2></header>
      <div class="moodle-content">
        <div class="activity-body"><p>Teacher and student support resources connected to the SBI4U course shell.</p></div>
        <section class="attachments"><h2>Files</h2><ul>
          <li><span class="file-label">Lab Report Format.pdf</span><span class="file-actions"><a class="file-action" href="files/a112a94a16-Lab%20Report%20Format.pdf">查看</a><a class="file-action" href="files/a112a94a16-Lab%20Report%20Format.pdf" download>下载</a></span></li>
          <li><span class="file-label">SBI4U MT Exam Review Chpt 3</span><span class="file-actions"><a class="file-action" href="files/c9ab3dffbd-sbi4u_mt_exam_review_chpt_3.html">查看</a><a class="file-action" href="files/c9ab3dffbd-sbi4u_mt_exam_review_chpt_3.html" download>下载</a></span></li>
        </ul></section>
      </div>
    </section>
  </main>
</body>
</html>
`;
  fs.writeFileSync(indexPath, html, "utf8");
  return toPosix(path.relative(courseRoot, indexPath));
}

const previewAliases = repairPreviewAliases();
const examView = repairExamViewHtml();
const courseResourcesIndex = writeCourseResourcesIndex();

const report = {
  course: "SBI4U",
  previewAliasesCreated: previewAliases.length,
  previewAliases,
  examView,
  courseResourcesIndex,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
