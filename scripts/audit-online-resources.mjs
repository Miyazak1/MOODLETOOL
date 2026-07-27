import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = join(workspaceRoot, "courseware");
const catalogPath = join(projectRoot, "public", "course-catalog.json");
const deploymentRoot = join(projectRoot, "deployment");
const reportJsonPath = join(deploymentRoot, "online-resource-readiness.json");
const reportMdPath = join(deploymentRoot, "online-resource-readiness.md");

const officeExtensions = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]);
const browserPreviewExtensions = new Set([
  ".html",
  ".htm",
  ".pdf",
  ".md",
  ".txt",
  ".mp4",
  ".webm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(path) {
  return path.replaceAll("\\", "/");
}

function localManifestPath(course) {
  if (!course.manifestUrl?.startsWith("/courseware/")) return null;
  return join(workspaceRoot, course.manifestUrl.slice(1));
}

function localCourseRoot(course) {
  if (!course.baseUrl?.startsWith("/courseware/")) return null;
  return join(workspaceRoot, course.baseUrl.slice(1));
}

function relProject(path) {
  const rel = relative(projectRoot, path);
  return rel.startsWith("..") ? toPosix(path) : toPosix(rel);
}

function resourceLocation(course, scope, item) {
  return `${course} · ${scope} · ${item.label || item.path || item.url || "resource"}`;
}

function collectFileResources(manifest) {
  const records = [];
  for (const item of manifest.courseDownloads || []) {
    records.push({ scope: `Course ${item.role || "document"}`, item });
  }
  for (const text of manifest.texts || []) {
    for (const item of text.materials || []) {
      records.push({ scope: `Text ${text.title || text.id || ""}`, item });
    }
  }
  for (const unit of manifest.units || []) {
    if (unit.unitPlan) records.push({ scope: `Unit ${unit.unit} plan`, item: unit.unitPlan });
    for (const lesson of unit.lessons || []) {
      if (lesson.lessonPlan) records.push({ scope: `${lesson.id} lesson plan`, item: lesson.lessonPlan });
      for (const item of lesson.downloads || []) records.push({ scope: `${lesson.id} download`, item });
      for (const item of lesson.textExports || []) records.push({ scope: `${lesson.id} text export`, item });
    }
  }
  return records;
}

function collectIspringResources(manifest) {
  const records = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const item of lesson.ispring || []) {
        records.push({ scope: `${lesson.id} iSpring`, item });
      }
    }
  }
  return records;
}

function checkLocalPath(courseRoot, relPath) {
  if (!relPath) return { ok: false, path: "" };
  const path = join(courseRoot, relPath);
  return { ok: existsSync(path), path };
}

function activeMoodleRefsInHtml(path) {
  if (![".html", ".htm"].includes(extname(path).toLowerCase())) return [];
  const html = readFileSync(path, "utf8");
  const refs = [];
  const attrPattern = /\b(?:href|src|poster|action)\s*=\s*["'](https:\/\/www\.esunnybrook\.com\/[^"']+|\/pluginfile\.php[^"']*)/gi;
  const cssPattern = /url\(\s*["']?(https:\/\/www\.esunnybrook\.com\/[^)"']+|\/pluginfile\.php[^)"']*)/gi;
  for (const match of html.matchAll(attrPattern)) refs.push(match[1]);
  for (const match of html.matchAll(cssPattern)) refs.push(match[1]);
  return refs;
}

function auditFileResource(course, courseRoot, scope, item) {
  const ext = extname(item.path || item.url || item.label || "").toLowerCase();
  const location = resourceLocation(course, scope, item);
  const issues = [];
  const notes = [];
  const previewQueue = [];

  if (!item.path && !item.url) {
    issues.push("missing-download-source");
  } else if (item.path) {
    const source = checkLocalPath(courseRoot, item.path);
    if (!source.ok) issues.push(`missing-download-file: ${relProject(source.path)}`);
    if (source.ok) {
      const embeddedRefs = activeMoodleRefsInHtml(source.path);
      if (embeddedRefs.length) {
        issues.push(`embedded-active-moodle-ref: ${embeddedRefs[0]}${embeddedRefs.length > 1 ? ` (+${embeddedRefs.length - 1} more)` : ""}`);
      }
    }
  } else if (item.url) {
    issues.push("external-download-not-localized");
    notes.push("source-url-retained-for-collection");
  }

  if (officeExtensions.has(ext)) {
    if (!item.previewPath && !item.previewUrl) {
      issues.push("office-preview-missing");
      if (item.path) {
        previewQueue.push({
          course,
          sourcePath: item.path,
          expectedPreviewPath: `previews/${item.path.replace(/[\\/]/g, "/")}.pdf`,
        });
      }
    } else if (item.previewPath) {
      const preview = checkLocalPath(courseRoot, item.previewPath);
      if (!preview.ok) issues.push(`missing-preview-file: ${relProject(preview.path)}`);
      if (!preview.ok && item.path) {
        previewQueue.push({
          course,
          sourcePath: item.path,
          expectedPreviewPath: item.previewPath,
        });
      }
    } else if (item.previewUrl) {
      issues.push("external-preview-not-localized");
    }
  } else if (item.previewPath) {
    const preview = checkLocalPath(courseRoot, item.previewPath);
    if (!preview.ok) issues.push(`missing-preview-file: ${relProject(preview.path)}`);
  } else if (item.previewUrl && !item.previewPath) {
    issues.push("external-preview-not-localized");
  } else if (!item.previewUrl && !browserPreviewExtensions.has(ext) && !item.url) {
    notes.push(`preview-type-needs-browser-check: ${ext || "unknown"}`);
  }

  return {
    course,
    scope,
    label: item.label || "",
    type: item.type || ext.replace(".", "") || "",
    path: item.path || "",
    previewPath: item.previewPath || "",
    url: item.url || "",
    issues,
    notes,
    previewQueue,
    location,
  };
}

function auditIspringResource(course, courseRoot, scope, item) {
  const issues = [];
  const notes = [];

  if (item.path) {
    const page = checkLocalPath(courseRoot, item.path);
    if (!page.ok) issues.push(`missing-ispring-page: ${relProject(page.path)}`);
  } else if (item.url) {
    issues.push("external-ispring-not-localized");
  } else {
    issues.push("missing-ispring-play-source");
  }

  if (item.downloadPath) {
    const download = checkLocalPath(courseRoot, item.downloadPath);
    if (!download.ok) issues.push(`missing-ispring-download-file: ${relProject(download.path)}`);
  } else if (item.downloadUrl) {
    issues.push("external-ispring-download-not-localized");
  } else {
    issues.push("ispring-download-missing");
  }

  return {
    course,
    scope,
    label: item.label || "",
    path: item.path || "",
    downloadPath: item.downloadPath || "",
    url: item.url || "",
    downloadUrl: item.downloadUrl || "",
    issues,
    notes,
    location: resourceLocation(course, scope, item),
  };
}

function renderTable(headers, rows) {
  if (!rows.length) return "- None";
  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function renderMarkdown(report) {
  const courseSummaryRows = report.courseSummaries.map((item) => [
    item.course,
    item.fileResources,
    item.fileIssues,
    item.uniqueFileIssues,
    item.previewQueue,
    item.ispringResources,
    item.ispringIssues,
    item.notes,
  ]);
  const previewQueueRows = report.previewQueue
    .slice(0, 120)
    .map((item) => [item.course, item.sourcePath, item.expectedPreviewPath, item.issueCount]);
  const fileIssueRows = report.fileResources
    .filter((item) => item.issues.length)
    .slice(0, 80)
    .map((item) => [item.course, item.scope, item.label || item.path, item.issues.join("; ")]);
  const ispringIssueRows = report.ispringResources
    .filter((item) => item.issues.length)
    .slice(0, 80)
    .map((item) => [item.course, item.scope, item.label || item.path, item.issues.join("; ")]);
  const noteRows = [...report.fileResources, ...report.ispringResources]
    .filter((item) => item.notes.length)
    .slice(0, 80)
    .map((item) => [item.course, item.scope, item.label || item.path, item.notes.join("; ")]);

  return `# Online Resource Readiness

Generated: ${report.generatedAt}

## Summary

| Item | Count |
| --- | ---: |
| Courses checked | ${report.courseCount} |
| File resources | ${report.totals.fileResources} |
| File resources with issues | ${report.totals.fileIssues} |
| Unique file issue targets | ${report.totals.uniqueFileIssues} |
| Unique Office preview queue | ${report.totals.previewQueue} |
| iSpring resources | ${report.totals.ispringResources} |
| iSpring resources with issues | ${report.totals.ispringIssues} |
| Informational notes | ${report.totals.notes} |

## Course Summary

${renderTable(["Course", "Files", "File Issue Entries", "Unique File Issues", "Preview Queue", "iSpring", "iSpring Issues", "Notes"], courseSummaryRows)}

## Office Preview Queue

${renderTable(["Course", "Source", "Expected Preview", "Issue Entries"], previewQueueRows)}

## File Resource Issues

${renderTable(["Course", "Scope", "Resource", "Issue"], fileIssueRows)}

## iSpring Issues

${renderTable(["Course", "Scope", "Resource", "Issue"], ispringIssueRows)}

## Notes

${renderTable(["Course", "Scope", "Resource", "Note"], noteRows)}
`;
}

if (!existsSync(catalogPath)) {
  console.error(`Missing course catalog: ${catalogPath}`);
  process.exit(1);
}

const catalog = readJson(catalogPath);
const fileResources = [];
const ispringResources = [];

for (const course of catalog.courses || []) {
  const manifestPath = localManifestPath(course);
  const courseRoot = localCourseRoot(course);
  if (!manifestPath || !courseRoot || !existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  for (const { scope, item } of collectFileResources(manifest)) {
    fileResources.push(auditFileResource(course.code, courseRoot, scope, item));
  }
  for (const { scope, item } of collectIspringResources(manifest)) {
    ispringResources.push(auditIspringResource(course.code, courseRoot, scope, item));
  }
}

function uniqueIssueKey(item, issue) {
  return [item.course, item.path || item.url || item.label || item.location, issue.split(":", 1)[0]].join("|");
}

function uniquePreviewQueue(fileResources) {
  const byKey = new Map();
  for (const item of fileResources) {
    for (const entry of item.previewQueue || []) {
      const key = `${entry.course}|${entry.sourcePath}|${entry.expectedPreviewPath}`;
      const current = byKey.get(key);
      if (current) {
        current.issueCount += 1;
      } else {
        byKey.set(key, { ...entry, issueCount: 1 });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => `${a.course}|${a.sourcePath}`.localeCompare(`${b.course}|${b.sourcePath}`));
}

function courseSummaries(fileResources, ispringResources, previewQueue) {
  const courses = new Set([...fileResources.map((item) => item.course), ...ispringResources.map((item) => item.course)]);
  return [...courses].sort().map((course) => {
    const courseFiles = fileResources.filter((item) => item.course === course);
    const courseIspring = ispringResources.filter((item) => item.course === course);
    const uniqueIssues = new Set(courseFiles.flatMap((item) => item.issues.map((issue) => uniqueIssueKey(item, issue))));
    return {
      course,
      fileResources: courseFiles.length,
      fileIssues: courseFiles.filter((item) => item.issues.length).length,
      uniqueFileIssues: uniqueIssues.size,
      previewQueue: previewQueue.filter((item) => item.course === course).length,
      ispringResources: courseIspring.length,
      ispringIssues: courseIspring.filter((item) => item.issues.length).length,
      notes: [...courseFiles, ...courseIspring].filter((item) => item.notes.length).length,
    };
  });
}

const fileIssueKeys = new Set(fileResources.flatMap((item) => item.issues.map((issue) => uniqueIssueKey(item, issue))));
const previewQueue = uniquePreviewQueue(fileResources);
const courseSummaryRows = courseSummaries(fileResources, ispringResources, previewQueue);

const report = {
  generatedAt: new Date().toISOString(),
  courseCount: catalog.courses?.length || 0,
  coursewareRoot,
  totals: {
    fileResources: fileResources.length,
    fileIssues: fileResources.filter((item) => item.issues.length).length,
    uniqueFileIssues: fileIssueKeys.size,
    previewQueue: previewQueue.length,
    ispringResources: ispringResources.length,
    ispringIssues: ispringResources.filter((item) => item.issues.length).length,
    notes: [...fileResources, ...ispringResources].filter((item) => item.notes.length).length,
  },
  courseSummaries: courseSummaryRows,
  previewQueue,
  fileResources,
  ispringResources,
};

mkdirSync(deploymentRoot, { recursive: true });
writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(reportMdPath, renderMarkdown(report), "utf8");

console.log(`Wrote ${reportJsonPath}`);
console.log(`Wrote ${reportMdPath}`);
console.log(
  `File issues ${report.totals.fileIssues}/${report.totals.fileResources} (${report.totals.uniqueFileIssues} unique; ${report.totals.previewQueue} previews); iSpring issues ${report.totals.ispringIssues}/${report.totals.ispringResources}; notes ${report.totals.notes}`,
);
