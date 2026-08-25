import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");

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

function text(value) {
  return String(value ?? "");
}

function normalizeRole(value = "") {
  return text(value)
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function lowerScope(item) {
  return [
    item?.label,
    item?.type,
    item?.category,
    item?.role,
    item?.path,
    item?.previewPath,
    item?.downloadPath,
    item?.packagePath,
    item?.sourceGroup,
    item?.parentSection,
    item?.sectionLabel,
  ]
    .map((value) => text(value).toLowerCase())
    .join(" ");
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(text(value));
}

function isLocalReference(value) {
  const stringValue = text(value);
  return Boolean(stringValue) && !isHttpUrl(stringValue) && !stringValue.startsWith("data:");
}

function isVideo(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerScope(item);
  return type === "video" || type === "mp4" || type === "webm" || category.includes("video") || /\.(mp4|webm|mov)(?:$|[?#])/i.test(scope);
}

function isH5P(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerScope(item);
  return type === "h5p" || type === "h5pactivity" || category.includes("h5p") || /(?:\/h5p\/|\/h5p-external\/|\.h5p(?:$|[?#]))/i.test(scope);
}

function isISpring(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerScope(item);
  return type === "ispring" || category.includes("ispring") || scope.includes("ispring-localized/");
}

function isPlayable(item) {
  return isH5P(item) || isVideo(item) || isISpring(item);
}

function playableKind(item) {
  if (isH5P(item)) return "h5p";
  if (isVideo(item)) return "video";
  if (isISpring(item)) return "ispring";
  return "";
}

function isDocumentLike(item) {
  const type = text(item?.type).toLowerCase();
  const scope = lowerScope(item);
  return /^(pdf|doc|docx|ppt|pptx|xls|xlsx|zip)$/i.test(type) || /\.(pdf|docx?|pptx?|xlsx?|zip)(?:$|[?#])/i.test(scope);
}

function hasLocalResource(item) {
  return ["path", "previewPath", "downloadPath", "packagePath"].some((field) => isLocalReference(item?.[field]));
}

function flowKey(item) {
  const role = normalizeRole(item?.role);
  const scope = lowerScope(item);
  const sectionLabel = text(item?.sectionLabel).toLowerCase();
  const label = text(item?.label).toLowerCase();
  if (sectionLabel.includes("expectation")) return "expectations";
  if (sectionLabel.includes("hands on")) return "hands_on";
  if (sectionLabel.includes("consolidation")) return "consolidation";
  if (sectionLabel.includes("homework")) return "homework";
  if (sectionLabel === "lesson") return "lesson";
  if (role.includes("expectation")) return "expectations";
  if (role.includes("hands")) return "hands_on";
  if (role.includes("consolidation")) return "consolidation";
  if (role.includes("homework")) return "homework";
  if (role.includes("lesson") && role !== "lesson_book_section") return "lesson";
  if (label.includes("expectation")) return "expectations";
  if (scope.includes("hands on") || label.includes("hands on")) return "hands_on";
  if (scope.includes("consolidation") || label.includes("consolidation")) return "consolidation";
  if (scope.includes("homework") || label.includes("homework")) return "homework";
  if (label === "lesson" || label.includes(" lesson")) return "lesson";
  return "resources";
}

function ispringFlow(item) {
  const scope = lowerScope(item);
  if (scope.includes("consolidation")) return "consolidation";
  if (scope.includes("homework")) return "homework";
  if (scope.includes("hands")) return "hands_on";
  return "lesson";
}

function localPath(courseRoot, relativePath) {
  return normalize(join(courseRoot, relativePath));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readHtmlIfExists(courseRoot, relativePath) {
  if (!isLocalReference(relativePath)) return "";
  const absolute = localPath(courseRoot, relativePath);
  if (!existsSync(absolute)) return "";
  return readFileSync(absolute, "utf8");
}

function stripHtml(value) {
  return text(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlMarkerKinds(html) {
  const markers = [];
  const iframeLike = [...text(html).matchAll(/<(?:iframe|object|embed)\b[^>]*(?:src|data|data-src)=["']([^"']+)["'][^>]*>/gi)].map((match) => match[0] + " " + match[1]);
  if (iframeLike.some((value) => /(?:\/h5p\/|\/h5p-external\/|\.h5p(?:$|[?#])|h5p_embed|h5p-player|h5p-content)/i.test(value))) markers.push("h5p");
  if (/<(?:video|source)\b[^>]*(?:src|data-src)=["'][^"']*(?:\.mp4|\.webm|embed\/video|video\/)[^"']*["'][^>]*>/i.test(html)) markers.push("video");
  if (iframeLike.some((value) => /(?:ispring|presentation\.html|html5-package)/i.test(value))) markers.push("ispring");
  return markers;
}

function htmlHasEmptyIframe(html) {
  return /<iframe\b(?=[^>]*><\/iframe>)(?![^>]*(?:src|data|data-src)=)/i.test(html)
    || /<iframe\b[^>]*(?:src|data|data-src)=["']\s*["'][^>]*><\/iframe>/i.test(html);
}

function hasLegacyMoodleBookWrapper(html) {
  return /class=["'][^"']*\b(?:generalbox|book_content)\b[^"']*["']/i.test(html);
}

function hasLegacyInlinePageShell(html) {
  return /<style\b[\s\S]*?\b\.content\b[\s\S]*?<\/style>/i.test(html)
    || /<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["']/i.test(html);
}

function hasEng3uPageShell(html) {
  return /data-course-shell=["']eng3u-course-shell-v2["']/i.test(html)
    && /class=["']page-title["']/i.test(html)
    && /class=["']moodle-section["']/i.test(html)
    && /class=["']moodle-content["']/i.test(html);
}

function requiresEng3uBookSectionShell(profile, flow) {
  return profile === "lesson-flow";
}

function addIssue(issues, severity, rule, message, context = {}) {
  issues.push({ severity, rule, message, context });
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function resourceSummary(resources) {
  return {
    total: resources.length,
    playable: resources.filter(isPlayable).length,
    localPlayable: resources.filter((item) => isPlayable(item) && hasLocalResource(item)).length,
    h5p: resources.filter(isH5P).length,
    video: resources.filter(isVideo).length,
    ispring: resources.filter(isISpring).length,
    documents: resources.filter(isDocumentLike).length,
  };
}

function resourceRowsFromActivity(item) {
  const rows = [];
  if (item && typeof item === "object") rows.push(item);
  for (const attachment of item?.attachments || []) rows.push(attachment);
  for (const attachment of item?.downloads || []) rows.push(attachment);
  for (const attachment of item?.media || []) rows.push(attachment);
  for (const attachment of item?.ispring || []) rows.push(attachment);
  return rows;
}

function lessonResources(lesson) {
  return [
    ...(lesson.downloads || []),
    ...(lesson.handsOn || []),
    ...(lesson.textExports || []),
    ...(lesson.ispring || []),
    ...(lesson.bookSections || []).flatMap((section) => section.attachments || []),
  ];
}

function resolveCourse(courseCode, explicitRoot) {
  const course = safeCourse(courseCode);
  const roots = [
    explicitRoot ? resolve(explicitRoot) : null,
    course ? resolve(workspaceRoot, "courseware", course) : null,
    course ? resolve(projectRoot, "courseware", course) : null,
  ].filter(Boolean);
  for (const root of roots) {
    const manifestPath = join(root, "course-manifest.json");
    if (existsSync(manifestPath)) return { course, courseRoot: root, manifestPath };
  }
  throw new Error(`Cannot find ${course || "course"}/course-manifest.json. Checked: ${roots.join(", ")}`);
}

function rawKindToFlow(kind) {
  const value = String(kind || "").toLowerCase();
  if (value === "lesson") return "lesson";
  if (value === "handson" || value === "hands_on" || value === "hands-on") return "hands_on";
  if (value === "consolidation" || value === "consoldation") return "consolidation";
  if (value === "homework") return "homework";
  if (value === "overview" || value === "expectations") return "expectations";
  return "";
}

function rawBookFlowsForLesson(courseRoot, lesson) {
  const firstPath = (lesson.bookSections || []).find((section) => section.path)?.path;
  if (!firstPath) return null;
  const lessonDir = String(firstPath).replace(/[\\/]+book_sections[\\/].*$/i, "");
  if (!lessonDir || lessonDir === firstPath) return null;
  const rawPath = localPath(courseRoot, `${lessonDir}/book_pages_raw.json`);
  if (!existsSync(rawPath)) return null;
  try {
    const rawPages = JSON.parse(readFileSync(rawPath, "utf8"));
    const flows = new Set();
    for (const page of Array.isArray(rawPages) ? rawPages : []) {
      const flow = rawKindToFlow(page?.kind);
      if (flow) flows.add(flow);
    }
    return flows;
  } catch {
    return null;
  }
}

function detectProfile(manifest, requestedProfile) {
  if (requestedProfile && requestedProfile !== "auto") return requestedProfile;
  const lessons = (manifest.units || []).flatMap((unit) => unit.lessons || []);
  const withBookSections = lessons.filter((lesson) => (lesson.bookSections || []).length).length;
  if (!withBookSections) return "legacy";
  return "lesson-flow";
}

function reviewCourseSections(courseRoot, manifest, issues) {
  const courseSections = manifest.courseSections || [];
  const sections = courseSections.map((section, index) => {
    const resources = resourceRowsFromActivity(section);
    const missingPath = section.path && isLocalReference(section.path) && !existsSync(localPath(courseRoot, section.path));
    if (missingPath) {
      addIssue(issues, "error", "course-section-missing-path", `${section.label || section.title || `Course section ${index + 1}`} references a missing page.`, {
        section: section.label || section.title,
        path: section.path,
      });
    }
    return {
      label: section.label || section.title || `Course Section ${index + 1}`,
      path: section.path || "",
      status: missingPath ? "fail" : "pass",
      resources: resourceSummary(resources),
    };
  });
  return {
    status: sections.some((section) => section.status === "fail") ? "fail" : "pass",
    count: sections.length,
    sections,
    courseDownloads: resourceSummary(manifest.courseDownloads || []),
    texts: (manifest.texts || []).length,
    teacherResources: resourceSummary(manifest.teacherResources || []),
  };
}

function reviewLesson(courseRoot, unit, lesson, profile, issues) {
  const resources = lessonResources(lesson);
  const playableByFlow = new Map();
  const ordinaryDocumentsByFlow = new Map();

  for (const item of resources) {
    const flow = isISpring(item) ? ispringFlow(item) : flowKey(item);
    if (isPlayable(item) && hasLocalResource(item)) increment(playableByFlow, `${flow}:${playableKind(item)}`);
    if (isDocumentLike(item)) increment(ordinaryDocumentsByFlow, flow);

    if (isH5P(item) && hasLocalResource(item) && !item.previewPath) {
      addIssue(issues, "error", "h5p-missing-preview-path", `${item.label || "H5P"} is localized but has no previewPath for standalone display.`, {
        unit: unit.unit,
        lesson: lesson.lesson,
        label: item.label,
        role: item.role,
      });
    }
    if (isDocumentLike(item) && isPlayable(item)) {
      addIssue(issues, "error", "document-misclassified-as-playable", `${item.label || "Document"} is document-like but also classified as playable.`, {
        unit: unit.unit,
        lesson: lesson.lesson,
        label: item.label,
        type: item.type,
        role: item.role,
      });
    }
  }

  const sectionReviews = [];
  const presentFlows = new Set();
  for (const [index, section] of (lesson.bookSections || []).entries()) {
    const flow = flowKey(section);
    presentFlows.add(flow);
    const html = readHtmlIfExists(courseRoot, section.path);
    const markers = htmlMarkerKinds(html);
    const readableChars = stripHtml(html).length;
    const attachments = section.attachments || [];
    const sectionIssues = [];
    const sectionContext = {
      unit: unit.unit,
      lesson: lesson.lesson,
      lessonTitle: lesson.title,
      section: section.sectionLabel || section.label,
      path: section.path,
      flow,
    };

    if (section.path && isLocalReference(section.path) && !existsSync(localPath(courseRoot, section.path))) {
      sectionIssues.push("missing-path");
      addIssue(issues, "error", "book-section-missing-path", `${section.label || section.path} references a missing page.`, sectionContext);
    }
    if (htmlHasEmptyIframe(html)) {
      sectionIssues.push("empty-iframe");
      addIssue(issues, "error", "empty-embedded-iframe", `${section.label || section.path} contains an iframe without a source. It likely lost an embedded iSpring/H5P/video URL during repair.`, sectionContext);
    }
    if (requiresEng3uBookSectionShell(profile, flow) && hasLegacyMoodleBookWrapper(html)) {
      sectionIssues.push("legacy-moodle-wrapper");
      addIssue(issues, "error", "lesson-flow-legacy-wrapper", `${section.label || section.path} still contains legacy Moodle book wrapper classes. Lesson-flow pages must use the ENG3U page shell directly.`, sectionContext);
    }
    if (requiresEng3uBookSectionShell(profile, flow) && hasLegacyInlinePageShell(html)) {
      sectionIssues.push("legacy-inline-shell");
      addIssue(issues, "error", "lesson-flow-legacy-inline-shell", `${section.label || section.path} still uses the old inline page template instead of the shared ENG3U shell.`, sectionContext);
    }
    if (requiresEng3uBookSectionShell(profile, flow) && !hasEng3uPageShell(html)) {
      sectionIssues.push("non-eng3u-shell");
      addIssue(issues, "error", "lesson-flow-non-eng3u-shell", `${section.label || section.path} does not use the ENG3U page shell.`, sectionContext);
    }
    if (/Moodle activity (?:not indexed|暂未索引)|暂无已索引的本地资源|External Quizlet activity omitted/i.test(html)) {
      sectionIssues.push("placeholder");
      addIssue(issues, "warn", "moodle-page-placeholder", `${section.label || section.path} contains a placeholder instead of recovered Moodle content.`, sectionContext);
    }
    if (readableChars < 40 && !attachments.length && !markers.length) {
      sectionIssues.push("thin-page");
      addIssue(issues, "warn", "thin-html-page", `${section.label || section.path} has very little readable text and no attachments.`, {
        ...sectionContext,
        readableChars,
      });
    }

    for (const kind of markers) {
      if (!playableByFlow.get(`${flow}:${kind}`)) {
        sectionIssues.push(`missing-standalone-${kind}`);
        addIssue(issues, "error", "embedded-playable-missing-standalone", `${section.label || section.path} contains embedded ${kind}, but no standalone ${kind} card is registered for the same lesson flow.`, {
          ...sectionContext,
          kind,
        });
      }
    }

    sectionReviews.push({
      label: section.sectionLabel || section.label || `Section ${index + 1}`,
      flow,
      path: section.path || "",
      readableChars,
      embedded: markers,
      attachments: attachments.length,
      standalone: {
        h5p: playableByFlow.get(`${flow}:h5p`) || 0,
        video: playableByFlow.get(`${flow}:video`) || 0,
        ispring: playableByFlow.get(`${flow}:ispring`) || 0,
      },
      documents: ordinaryDocumentsByFlow.get(flow) || 0,
      status: sectionIssues.some((item) => item.startsWith("missing")) ? "fail" : sectionIssues.length ? "review" : "pass",
      issues: sectionIssues,
    });
  }

  if (profile === "lesson-flow") {
    const rawFlows = rawBookFlowsForLesson(courseRoot, lesson);
    for (const required of ["lesson", "hands_on", "consolidation"]) {
      if (rawFlows && !rawFlows.has(required)) continue;
      if (!presentFlows.has(required)) {
        addIssue(issues, "warn", "missing-lesson-flow-section", `${lesson.id || `U${unit.unit}L${lesson.lesson}`} is missing ${required} book section.`, {
          unit: unit.unit,
          lesson: lesson.lesson,
          lessonTitle: lesson.title,
          missingFlow: required,
        });
      }
    }
  }

  const status = sectionReviews.some((section) => section.status === "fail")
    ? "fail"
    : sectionReviews.some((section) => section.status === "review")
      ? "review"
      : "pass";

  return {
    id: lesson.id || `U${unit.unit}L${lesson.lesson}`,
    lesson: lesson.lesson,
    title: lesson.title || "",
    status,
    resources: resourceSummary(resources),
    bookSections: sectionReviews,
    flowSummary: ["expectations", "lesson", "hands_on", "consolidation", "homework"].map((flow) => ({
      flow,
      sections: sectionReviews.filter((section) => section.flow === flow).length,
      h5p: playableByFlow.get(`${flow}:h5p`) || 0,
      video: playableByFlow.get(`${flow}:video`) || 0,
      ispring: playableByFlow.get(`${flow}:ispring`) || 0,
      documents: ordinaryDocumentsByFlow.get(flow) || 0,
    })),
  };
}

function reviewUnits(courseRoot, manifest, profile, issues) {
  return (manifest.units || []).map((unit) => {
    const lessons = (unit.lessons || []).map((lesson) => reviewLesson(courseRoot, unit, lesson, profile, issues));
    if (!lessons.length) {
      addIssue(issues, "warn", "unit-without-lessons", `Unit ${unit.unit}: ${unit.title || ""} has no lessons.`, {
        unit: unit.unit,
        title: unit.title,
      });
    }
    return {
      unit: unit.unit,
      title: unit.title || "",
      status: lessons.some((lesson) => lesson.status === "fail") ? "fail" : lessons.some((lesson) => lesson.status === "review") ? "review" : "pass",
      lessons: lessons.length,
      unitPlan: Boolean(unit.unitPlan),
      resources: resourceSummary([
        ...Object.values(unit.unitResources || {}).flatMap((value) => (Array.isArray(value) ? value : value ? [value] : [])),
        ...(unit.unitPlan ? [unit.unitPlan] : []),
      ]),
      lessonReviews: lessons,
    };
  });
}

function buildReport(course, courseRoot, manifestPath, manifest, profile) {
  const issues = [];
  const detectedProfile = detectProfile(manifest, profile);
  const courseResources = reviewCourseSections(courseRoot, manifest, issues);
  const units = reviewUnits(courseRoot, manifest, detectedProfile, issues);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;
  return {
    generatedAt: new Date().toISOString(),
    course,
    courseRoot,
    manifestPath,
    profile: detectedProfile,
    summary: {
      status: errors ? "fail" : warnings ? "review" : "pass",
      units: units.length,
      lessons: units.reduce((sum, unit) => sum + unit.lessons, 0),
      courseSections: courseResources.count,
      errors,
      warnings,
      failingLessons: units.flatMap((unit) => unit.lessonReviews.filter((lesson) => lesson.status === "fail").map((lesson) => `U${unit.unit}L${lesson.lesson}`)),
      reviewLessons: units.flatMap((unit) => unit.lessonReviews.filter((lesson) => lesson.status === "review").map((lesson) => `U${unit.unit}L${lesson.lesson}`)),
    },
    courseResources,
    units,
    issues,
  };
}

function statusIcon(status) {
  if (status === "pass") return "PASS";
  if (status === "fail") return "FAIL";
  return "REVIEW";
}

function markdownReport(report) {
  const lines = [];
  lines.push(`# ${report.course} Course Structure Review`);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Profile: ${report.profile}`);
  lines.push(`Status: **${statusIcon(report.summary.status)}**`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Units: ${report.summary.units}`);
  lines.push(`- Lessons: ${report.summary.lessons}`);
  lines.push(`- Course resource sections: ${report.summary.courseSections}`);
  lines.push(`- Errors: ${report.summary.errors}`);
  lines.push(`- Warnings: ${report.summary.warnings}`);
  lines.push("");
  lines.push("## Course Resources");
  lines.push("");
  if (!report.courseResources.sections.length) {
    lines.push("- No course-level resource sections recorded.");
  } else {
    for (const section of report.courseResources.sections) {
      lines.push(`- ${statusIcon(section.status)} ${section.label}: ${section.resources.total} resources, ${section.resources.playable} playable, ${section.resources.documents} documents`);
    }
  }
  lines.push("");
  lines.push("## Units");
  for (const unit of report.units) {
    lines.push("");
    lines.push(`### ${statusIcon(unit.status)} Unit ${unit.unit}: ${unit.title}`);
    lines.push("");
    lines.push(`Lessons: ${unit.lessons}; Unit plan: ${unit.unitPlan ? "yes" : "no"}; Unit resources: ${unit.resources.total}`);
    lines.push("");
    lines.push("| Lesson | Status | Sections | H5P | Video | iSpring | Docs | Notes |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const lesson of unit.lessonReviews) {
      const totals = lesson.flowSummary.reduce(
        (sum, flow) => ({
          h5p: sum.h5p + flow.h5p,
          video: sum.video + flow.video,
          ispring: sum.ispring + flow.ispring,
          documents: sum.documents + flow.documents,
        }),
        { h5p: 0, video: 0, ispring: 0, documents: 0 },
      );
      const notes = lesson.bookSections
        .filter((section) => section.issues.length)
        .slice(0, 3)
        .map((section) => `${section.label}: ${section.issues.join(", ")}`)
        .join("; ");
      lines.push(`| U${unit.unit}L${lesson.lesson} ${lesson.title.replaceAll("|", "\\|")} | ${statusIcon(lesson.status)} | ${lesson.bookSections.length} | ${totals.h5p} | ${totals.video} | ${totals.ispring} | ${totals.documents} | ${notes.replaceAll("|", "\\|")} |`);
    }
  }
  lines.push("");
  lines.push("## Issues");
  lines.push("");
  if (!report.issues.length) {
    lines.push("- None.");
  } else {
    for (const issue of report.issues.slice(0, 200)) {
      const context = issue.context || {};
      const where = [context.unit ? `U${context.unit}` : "", context.lesson ? `L${context.lesson}` : "", context.section || ""].filter(Boolean).join(" ");
      lines.push(`- [${issue.severity.toUpperCase()}] ${issue.rule}${where ? ` (${where})` : ""}: ${issue.message}`);
    }
    if (report.issues.length > 200) lines.push(`- ... ${report.issues.length - 200} more`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function printHuman(report) {
  console.log(`${report.course} Structure Review: ${statusIcon(report.summary.status)}`);
  console.log(`Profile ${report.profile}; Units ${report.summary.units}; Lessons ${report.summary.lessons}; Errors ${report.summary.errors}; Warnings ${report.summary.warnings}`);
  console.log(`Course sections ${report.summary.courseSections}; Failing lessons ${report.summary.failingLessons.length}; Review lessons ${report.summary.reviewLessons.length}`);
  for (const unit of report.units) {
    console.log(`\n${statusIcon(unit.status)} Unit ${unit.unit}: ${unit.title} (${unit.lessons} lessons)`);
    for (const lesson of unit.lessonReviews.filter((item) => item.status !== "pass").slice(0, 8)) {
      const notes = lesson.bookSections.filter((section) => section.issues.length).map((section) => `${section.label}: ${section.issues.join(", ")}`).join("; ");
      console.log(`- ${statusIcon(lesson.status)} U${unit.unit}L${lesson.lesson} ${lesson.title}${notes ? ` — ${notes}` : ""}`);
    }
  }
}

const requestedCourse = safeCourse(readArg("--course") || process.argv.find((arg) => /^[A-Za-z]{3,4}\d[A-Za-z]?$/.test(arg)));
const explicitRoot = readArg("--course-root");
const profile = readArg("--profile") || "auto";
const jsonMode = hasFlag("--json");
const markdownOnly = hasFlag("--markdown");
const outPath = readArg("--out") || (requestedCourse ? resolve(projectRoot, "deployment", `structure-review-${requestedCourse}.json`) : "");
const mdOutPath = readArg("--md-out") || (requestedCourse ? resolve(projectRoot, "deployment", `structure-review-${requestedCourse}.md`) : "");

if (!requestedCourse && !explicitRoot) {
  console.error("Usage: npm run qa:structure -- --course ICS3U [--json] [--markdown] [--profile auto|lesson-flow|legacy]");
  process.exit(2);
}

try {
  const resolved = resolveCourse(requestedCourse, explicitRoot);
  const manifest = readJson(resolved.manifestPath);
  const course = manifest.course?.code || resolved.course;
  const report = buildReport(course, resolved.courseRoot, resolved.manifestPath, manifest, profile);
  const markdown = markdownReport(report);

  if (outPath && !markdownOnly) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (mdOutPath) {
    mkdirSync(dirname(mdOutPath), { recursive: true });
    writeFileSync(mdOutPath, markdown, "utf8");
  }

  if (jsonMode) console.log(JSON.stringify(report, null, 2));
  else if (markdownOnly) console.log(markdown);
  else {
    printHuman(report);
    if (outPath) console.log(`\nJSON ${outPath}`);
    if (mdOutPath) console.log(`Markdown ${mdOutPath}`);
  }
  process.exit(report.summary.errors ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
