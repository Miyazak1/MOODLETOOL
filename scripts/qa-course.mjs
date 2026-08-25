import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeRole(value = "") {
  return String(value)
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function text(value) {
  return String(value ?? "");
}

function lowerResourceScope(item) {
  return [
    item?.label,
    item?.type,
    item?.category,
    item?.role,
    item?.path,
    item?.previewPath,
    item?.downloadPath,
    item?.url,
    item?.previewUrl,
    item?.downloadUrl,
    item?.source,
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

function isVideoResource(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerResourceScope(item);
  return type === "video" || type === "mp4" || type === "webm" || category.includes("video") || /\.(mp4|webm|mov)(?:$|[?#])/i.test(scope);
}

function isH5PResource(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerResourceScope(item);
  return type === "h5p" || type === "h5pactivity" || category.includes("h5p") || /(?:\/h5p\/|\/h5p-external\/|\.h5p(?:$|[?#]))/i.test(scope);
}

function isISpringResource(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = lowerResourceScope(item);
  return type === "ispring" || category.includes("ispring") || scope.includes("ispring-localized/");
}

function isPlayableResource(item) {
  return isVideoResource(item) || isH5PResource(item) || isISpringResource(item);
}

function playableKind(item) {
  if (isH5PResource(item)) return "h5p";
  if (isVideoResource(item)) return "video";
  if (isISpringResource(item)) return "ispring";
  return "";
}

function isDocumentLikeResource(item) {
  const type = text(item?.type).toLowerCase();
  const scope = lowerResourceScope(item);
  return /^(pdf|doc|docx|ppt|pptx|xls|xlsx|zip)$/i.test(type) || /\.(pdf|docx?|pptx?|xlsx?|zip)(?:$|[?#])/i.test(scope);
}

function hasLocalResource(item) {
  return ["path", "previewPath", "downloadPath", "packagePath"].some((field) => isLocalReference(item?.[field]));
}

function hasMoodleActivityPage(item) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const role = text(item?.role).toLowerCase();
  if (!item?.path || !["html", "htm"].includes(type)) return false;
  if (!category.startsWith("moodle_") || category === "moodle_course_section") return false;
  if (["moodle_file", "moodle_resource"].includes(category)) return false;
  if (["file", "document", "download"].includes(role)) return false;
  return true;
}

function isNumberedLessonActivity(item) {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+$/i.test(text(item?.label).trim());
}

function isNumberedLessonAnswerActivity(item) {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+\s*\(Answer\)$/i.test(text(item?.label).trim());
}

function numberedLessonPosition(item) {
  const match = /^Unit\s+(\d+)\s*-\s*Lesson\s+(\d+)/i.exec(text(item?.label).trim());
  return {
    unit: Number(item?.unit || match?.[1] || 0),
    lesson: Number(item?.lesson || match?.[2] || 0),
  };
}

function isHomeworkSubmissionResource(item) {
  const role = normalizeRole(item?.role);
  const scope = lowerResourceScope(item);
  if (["homework_submission_page", "homework_answer_page", "homework_submission", "homework_submission_answer"].includes(role)) return true;
  if (/homework[\s_-]*submission[\s_-]*folder/.test(scope)) return true;
  if (/homework[\s_-]*(?:submission|answer)/.test(role)) return true;
  return (isNumberedLessonActivity(item) || isNumberedLessonAnswerActivity(item)) && /(?:student[\s_-]*submission|homework)/.test(scope);
}

function flowKeyForResource(item) {
  const role = normalizeRole(item?.role);
  const scope = lowerResourceScope(item);
  if (role.includes("hands") || scope.includes("hands on")) return "hands_on";
  if (role.includes("consolidation") || scope.includes("consolidation")) return "consolidation";
  if (role.includes("homework") || scope.includes("homework")) return "homework";
  if (role === "lesson" || role.includes("lesson")) return "lesson";
  return "resources";
}

function flowKeyForISpring(item) {
  const scope = lowerResourceScope(item);
  if (scope.includes("consolidation")) return "consolidation";
  if (scope.includes("homework")) return "homework";
  if (scope.includes("hands")) return "hands_on";
  return "lesson";
}

function resourceIdentity(item) {
  return item?.path || item?.previewPath || item?.downloadPath || item?.packagePath || item?.url || item?.previewUrl || item?.downloadUrl || `${item?.type || ""}|${item?.role || ""}|${item?.label || ""}`;
}

function localPath(courseRoot, relativePath) {
  return normalize(join(courseRoot, relativePath));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function stripHtml(value) {
  return text(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlHasPlayableMarker(html, kind) {
  if (kind === "h5p") return /<(?:iframe|div|script)\b[^>]*(?:localized-h5p|h5p_embed|h5p-player|h5p-content|\/h5p\/|\/h5p-external\/|\.h5p)/i.test(html);
  if (kind === "video") return /<(?:video|source)\b[^>]*(?:\.mp4|\.webm|embed\/video|video\/)/i.test(html);
  if (kind === "ispring") return /<(?:iframe|object|embed)\b[^>]*(?:ispring|presentation\.html|html5-package)/i.test(html);
  return false;
}

function addIssue(issues, severity, rule, message, context = {}) {
  issues.push({ severity, rule, message, context });
}

function addResource(resources, item, context) {
  if (!item || typeof item !== "object") return;
  resources.push({ item, context });
  for (const [index, attachment] of (item.attachments || []).entries()) {
    addResource(resources, attachment, { ...context, attachmentOf: item.label || resourceIdentity(item), attachmentIndex: index + 1 });
  }
}

function collectResources(manifest) {
  const resources = [];
  const add = (item, context) => addResource(resources, item, context);

  for (const [index, item] of (manifest.courseDownloads || []).entries()) add(item, { scope: "courseDownloads", index });
  for (const [index, item] of (manifest.courseSections || []).entries()) {
    add(item, { scope: "courseSections", index });
    for (const [ispringIndex, ispring] of (item.ispring || []).entries()) add(ispring, { scope: "courseSections.ispring", index, ispringIndex });
  }
  for (const [index, item] of (manifest.teacherResources || []).entries()) add(item, { scope: "teacherResources", index });
  for (const [index, item] of (manifest.evaluations || []).entries()) add(item, { scope: "evaluations", index });
  for (const [textIndex, textItem] of (manifest.texts || []).entries()) {
    for (const [index, item] of (textItem.materials || []).entries()) add(item, { scope: "texts.materials", text: textItem.title, textIndex, index });
  }

  for (const unit of manifest.units || []) {
    if (unit.unitPlan) add(unit.unitPlan, { scope: "unit.unitPlan", unit: unit.unit });
    for (const [key, value] of Object.entries(unit.unitResources || {})) {
      if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) add(item, { scope: `unit.unitResources.${key}`, unit: unit.unit, index });
      } else if (value && typeof value === "object") {
        add(value, { scope: `unit.unitResources.${key}`, unit: unit.unit });
      }
    }
    for (const lesson of unit.lessons || []) {
      const baseContext = { unit: unit.unit, lesson: lesson.lesson, lessonTitle: lesson.title, lessonId: lesson.id };
      if (lesson.lessonPlan) add(lesson.lessonPlan, { ...baseContext, scope: "lesson.lessonPlan" });
      for (const [index, item] of (lesson.ispring || []).entries()) add(item, { ...baseContext, scope: "lesson.ispring", index });
      for (const [index, item] of (lesson.bookSections || []).entries()) add(item, { ...baseContext, scope: "lesson.bookSections", index, sectionLabel: item.sectionLabel });
      for (const [index, item] of (lesson.downloads || []).entries()) add(item, { ...baseContext, scope: "lesson.downloads", index });
      for (const [index, item] of (lesson.handsOn || []).entries()) add(item, { ...baseContext, scope: "lesson.handsOn", index });
      for (const [index, item] of (lesson.textExports || []).entries()) add(item, { ...baseContext, scope: "lesson.textExports", index });
    }
  }
  return resources;
}

function resolveCourse(courseCode, explicitRoot) {
  const course = courseCode.toUpperCase();
  const roots = [
    explicitRoot ? resolve(explicitRoot) : null,
    resolve(workspaceRoot, "courseware", course),
    resolve(projectRoot, "courseware", course),
  ].filter(Boolean);
  for (const root of roots) {
    const manifestPath = join(root, "course-manifest.json");
    if (existsSync(manifestPath)) return { course, courseRoot: root, manifestPath };
  }
  throw new Error(`Cannot find ${course}/course-manifest.json. Checked: ${roots.join(", ")}`);
}

function validatePaths(courseRoot, resourceRows, issues) {
  for (const { item, context } of resourceRows) {
    for (const field of ["path", "previewPath", "downloadPath", "packagePath"]) {
      const value = item[field];
      if (!isLocalReference(value)) continue;
      const absolute = localPath(courseRoot, value);
      if (!existsSync(absolute)) {
        addIssue(issues, "error", "missing-local-path", `${item.label || resourceIdentity(item)} references missing ${field}: ${value}`, {
          ...context,
          label: item.label,
          type: item.type,
          role: item.role,
          field,
          path: value,
        });
      }
    }

    if (isH5PResource(item) && hasLocalResource(item) && !item.previewPath) {
      addIssue(issues, "error", "h5p-missing-preview-path", `${item.label || "H5P"} is localized but has no previewPath for standalone display.`, context);
    }
    if (isISpringResource(item) && !item.path && !item.url) {
      addIssue(issues, "error", "ispring-missing-play-path", `${item.label || "iSpring"} has no direct play path/url.`, context);
    }
  }
}

function validateLessonDisplay(courseRoot, manifest, issues) {
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      const lessonContext = { unit: unit.unit, lesson: lesson.lesson, lessonTitle: lesson.title, lessonId: lesson.id };
      const playableDownloads = [
        ...(lesson.downloads || []),
        ...(lesson.handsOn || []),
        ...(lesson.textExports || []),
      ].filter((item) => isPlayableResource(item) && hasLocalResource(item));
      const playableByFlow = new Map();
      for (const item of playableDownloads) {
        const key = `${flowKeyForResource(item)}:${playableKind(item)}`;
        playableByFlow.set(key, (playableByFlow.get(key) || 0) + 1);
      }
      for (const item of (lesson.ispring || []).filter((entry) => hasLocalResource(entry))) {
        const key = `${flowKeyForISpring(item)}:ispring`;
        playableByFlow.set(key, (playableByFlow.get(key) || 0) + 1);
      }

      for (const [index, section] of (lesson.bookSections || []).entries()) {
        if (!section.path || !isLocalReference(section.path)) continue;
        const sectionPath = localPath(courseRoot, section.path);
        if (!existsSync(sectionPath)) continue;
        const html = readFileSync(sectionPath, "utf8");
        const readableText = stripHtml(html);
        const sectionFlow = flowKeyForResource({ ...section, role: section.role, sectionLabel: section.sectionLabel });
        const sectionContext = { ...lessonContext, scope: "lesson.bookSections", index, sectionLabel: section.sectionLabel, path: section.path };

        if (/Moodle activity (?:not indexed|暂未索引)|暂无已索引的本地资源|External Quizlet activity omitted/i.test(html)) {
          addIssue(issues, "warn", "moodle-page-placeholder", `${section.label || section.path} contains a placeholder instead of recovered Moodle content.`, sectionContext);
        }
        if (readableText.length < 40 && !(section.attachments || []).length) {
          addIssue(issues, "warn", "thin-html-page", `${section.label || section.path} has very little readable text and no attachments.`, {
            ...sectionContext,
            readableChars: readableText.length,
          });
        }

        for (const kind of ["h5p", "video", "ispring"]) {
          if (!htmlHasPlayableMarker(html, kind)) continue;
          const count = playableByFlow.get(`${sectionFlow}:${kind}`) || 0;
          if (!count) {
            addIssue(
              issues,
              "error",
              "embedded-playable-missing-standalone",
              `${section.label || section.path} appears to contain embedded ${kind}, but no localized standalone ${kind} resource is registered for the same lesson flow.`,
              { ...sectionContext, kind, flow: sectionFlow },
            );
          }
        }
      }

      for (const item of lesson.downloads || []) {
        if (isDocumentLikeResource(item) && !hasMoodleActivityPage(item) && isPlayableResource(item)) {
          addIssue(issues, "error", "document-misclassified-as-playable", `${item.label || resourceIdentity(item)} is document-like but also classified as playable.`, {
            ...lessonContext,
            label: item.label,
            type: item.type,
            category: item.category,
            role: item.role,
          });
        }
        if (isDocumentLikeResource(item) && normalizeRole(item.role) === "hands_on") {
          addIssue(issues, "warn", "document-in-playable-flow", `${item.label || resourceIdentity(item)} is a document in Hands On. It should remain an attachment, not a standalone playable card.`, {
            ...lessonContext,
            label: item.label,
            type: item.type,
            role: item.role,
          });
        }
      }
    }
  }
}

function validateHomeworkPairing(manifest, issues) {
  const candidates = [];
  const resources = collectResources(manifest);
  for (const { item, context } of resources) {
    if (isHomeworkSubmissionResource(item)) candidates.push({ item, context });
  }

  const byPosition = new Map();
  for (const row of candidates) {
    const position = numberedLessonPosition(row.item);
    if (!position.unit || !position.lesson) continue;
    const key = `${position.unit}.${position.lesson}`;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(row);
    if (Number(row.item.unit || 0) && Number(row.item.unit) !== position.unit) {
      addIssue(issues, "error", "homework-unit-mismatch", `${row.item.label} label unit does not match manifest unit field.`, {
        ...row.context,
        label: row.item.label,
        labelUnit: position.unit,
        manifestUnit: row.item.unit,
      });
    }
    if (Number(row.item.lesson || 0) && Number(row.item.lesson) !== position.lesson) {
      addIssue(issues, "error", "homework-lesson-mismatch", `${row.item.label} label lesson does not match manifest lesson field.`, {
        ...row.context,
        label: row.item.label,
        labelLesson: position.lesson,
        manifestLesson: row.item.lesson,
      });
    }
  }

  for (const [key, rows] of byPosition) {
    const answers = rows.filter((row) => isNumberedLessonAnswerActivity(row.item) || /answer/i.test(text(row.item.role)));
    const dropboxes = rows.filter((row) => !answers.includes(row));
    if (answers.length > 1) {
      addIssue(issues, "warn", "homework-duplicate-answer", `Multiple Homework Submission answer pages are registered for U${key.replace(".", "L")}.`, {
        key,
        answers: answers.map((row) => row.item.label),
      });
    }
    if (dropboxes.length > 1) {
      addIssue(issues, "warn", "homework-duplicate-dropbox", `Multiple Homework Submission dropboxes are registered for U${key.replace(".", "L")}.`, {
        key,
        dropboxes: dropboxes.map((row) => row.item.label),
      });
    }
    if (answers.length && !dropboxes.length) {
      addIssue(issues, "warn", "homework-answer-without-dropbox", `Answer page exists without a matching Homework Submission dropbox for U${key.replace(".", "L")}.`, {
        key,
        answers: answers.map((row) => row.item.label),
      });
    }
  }
}

function validateCourseStructure(manifest, issues) {
  if (manifest.navigation?.primary !== "unit" || manifest.navigation?.secondary !== "lesson") {
    addIssue(issues, "warn", "unexpected-navigation-model", "Manifest navigation is not unit-first / lesson-second.", {
      navigation: manifest.navigation,
    });
  }
  if (!Array.isArray(manifest.units) || !manifest.units.length) {
    addIssue(issues, "error", "missing-units", "Manifest has no units.");
  }
  for (const unit of manifest.units || []) {
    if (!Array.isArray(unit.lessons) || !unit.lessons.length) {
      addIssue(issues, "warn", "unit-without-lessons", `Unit ${unit.unit}: ${unit.title || ""} has no lessons.`, {
        unit: unit.unit,
        title: unit.title,
      });
    }
    for (const lesson of unit.lessons || []) {
      const flows = new Set((lesson.bookSections || []).map((item) => flowKeyForResource({ ...item, role: item.sectionLabel || item.role })));
      for (const required of ["lesson", "hands_on", "consolidation"]) {
        if (!flows.has(required)) {
          addIssue(issues, "warn", "missing-lesson-flow-section", `${lesson.id || `U${unit.unit}L${lesson.lesson}`} is missing ${required} book section.`, {
            unit: unit.unit,
            lesson: lesson.lesson,
            lessonTitle: lesson.title,
            missingFlow: required,
          });
        }
      }
    }
  }
}

function buildReport(course, courseRoot, manifestPath, manifest) {
  const issues = [];
  const resources = collectResources(manifest);
  validateCourseStructure(manifest, issues);
  validatePaths(courseRoot, resources, issues);
  validateLessonDisplay(courseRoot, manifest, issues);
  validateHomeworkPairing(manifest, issues);

  const counts = {
    resources: resources.length,
    playable: resources.filter(({ item }) => isPlayableResource(item)).length,
    h5p: resources.filter(({ item }) => isH5PResource(item)).length,
    video: resources.filter(({ item }) => isVideoResource(item)).length,
    ispring: resources.filter(({ item }) => isISpringResource(item)).length,
    documents: resources.filter(({ item }) => isDocumentLikeResource(item)).length,
    localPlayable: resources.filter(({ item }) => isPlayableResource(item) && hasLocalResource(item)).length,
  };
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warn").length;

  return {
    generatedAt: new Date().toISOString(),
    course,
    courseRoot,
    manifestPath,
    summary: {
      status: errors ? "fail" : warnings ? "review" : "pass",
      units: (manifest.units || []).length,
      lessons: (manifest.units || []).reduce((sum, unit) => sum + (unit.lessons?.length || 0), 0),
      errors,
      warnings,
      counts,
    },
    issues,
  };
}

function printHumanReport(report) {
  const { summary } = report;
  console.log(`${report.course} QA: ${summary.status.toUpperCase()}`);
  console.log(`Units ${summary.units}; Lessons ${summary.lessons}; Resources ${summary.counts.resources}; Playable ${summary.counts.playable}`);
  console.log(`Errors ${summary.errors}; Warnings ${summary.warnings}`);
  const grouped = new Map();
  for (const issue of report.issues) {
    const key = `${issue.severity}:${issue.rule}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(issue);
  }
  for (const [key, issues] of grouped) {
    const [severity, rule] = key.split(":");
    console.log(`\n[${severity.toUpperCase()}] ${rule} (${issues.length})`);
    for (const issue of issues.slice(0, 8)) {
      const context = issue.context || {};
      const where = [context.unit ? `U${context.unit}` : "", context.lesson ? `L${context.lesson}` : "", context.sectionLabel || "", context.scope || ""]
        .filter(Boolean)
        .join(" ");
      console.log(`- ${where ? `${where}: ` : ""}${issue.message}`);
    }
    if (issues.length > 8) console.log(`- ... ${issues.length - 8} more`);
  }
}

const requestedCourse = (readArg("--course") || process.argv.find((arg) => /^[A-Za-z]{3,4}\d[A-Za-z]?$/.test(arg)) || "").toUpperCase();
const explicitRoot = readArg("--course-root");
const outPath = readArg("--out");
const jsonMode = hasFlag("--json");

if (!requestedCourse && !explicitRoot) {
  console.error("Usage: npm run qa:course -- --course ICS3U [--json] [--out deployment/qa-ICS3U.json]");
  process.exit(2);
}

try {
  const resolved = resolveCourse(requestedCourse || "COURSE", explicitRoot);
  const manifest = readJson(resolved.manifestPath);
  const courseCode = manifest.course?.code || resolved.course;
  const report = buildReport(courseCode, resolved.courseRoot, resolved.manifestPath, manifest);
  if (outPath) writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
    if (outPath) console.log(`\nWrote ${resolve(outPath)}`);
  }
  process.exit(report.summary.errors ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
