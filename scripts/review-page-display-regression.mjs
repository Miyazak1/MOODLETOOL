import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(projectRoot, "..");
const coursewareRoot = resolve(workspaceRoot, "courseware");

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

function flowScope(value) {
  return text(value)
    .toLowerCase()
    .replace(/home[\s_-]*work/g, "homework");
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

function listCourses() {
  const requested = text(readArg("--courses"))
    .split(",")
    .map(safeCourse)
    .filter(Boolean);
  const excluded = new Set(
    text(readArg("--exclude-courses") || readArg("--exclude"))
      .split(",")
      .map(safeCourse)
      .filter(Boolean),
  );
  if (requested.length) return requested.filter((course) => !excluded.has(course));
  return readdirSync(coursewareRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^[A-Z]{3,4}\d[A-Z]?$/.test(name))
    .filter((name) => !excluded.has(name))
    .filter((name) => existsSync(join(coursewareRoot, name, "course-manifest.json")))
    .sort();
}

function classifyFlowValue(value, fallback = "") {
  const scope = flowScope(value);
  if (!scope) return fallback;
  if (scope.includes("learning goal") || scope.includes("success criteria")) return "expectations";
  if (scope.includes("expectation")) return "expectations";
  if (scope.includes("handson") || scope.includes("hands_on") || scope.includes("hands on") || scope.includes("hands-on") || scope.includes("hands")) return "hands_on";
  if (scope.includes("consolidation") || scope.includes("consoldation")) return "consolidation";
  if (scope.includes("homework")) return "homework";
  if (scope.includes("lesson")) return "lesson";
  return fallback;
}

function flowKey(section) {
  const structured = classifyFlowValue(section?.sectionLabel)
    || classifyFlowValue(section?.role)
    || classifyFlowValue(section?.category);
  if (structured) return structured;
  const value = [section?.label, section?.path]
    .map((part) => flowScope(part))
    .join(" ");
  if (value.includes("expectation")) return "expectations";
  if (value.includes("hands")) return "hands_on";
  if (value.includes("consolidation") || value.includes("consoldation")) return "consolidation";
  if (value.includes("homework")) return "homework";
  if (value.includes("lesson")) return "lesson";
  return "resources";
}

function htmlShell(html) {
  const content = text(html);
  if (/data-course-shell=["']eng3u-course-shell-v2["']/i.test(content)
    && /class=["']page-title["']/i.test(content)
    && /class=["']moodle-section["']/i.test(content)
    && /class=["']moodle-content["']/i.test(content)) {
    return "eng3u";
  }
  if (/<article\b[^>]*class=["'][^"']*\bcontent\b[^"']*["']/i.test(content)
    || /<style\b[\s\S]*?\b\.content\b[\s\S]*?<\/style>/i.test(content)) {
    return "legacy-inline";
  }
  if (/<main\b/i.test(content)) return "plain-main";
  return "unknown";
}

function filesSections(html) {
  return [...text(html).matchAll(/<section\b(?=[^>]*class=["'][^"']*\bfiles\b)[^>]*>[\s\S]*?<\/section>/gi)].map((match) => ({
    index: match.index,
    html: match[0],
  }));
}

function attachmentDisplaySections(html) {
  return [
    ...text(html).matchAll(
      /<section\b(?=[^>]*class=["'][^"']*\b(?:files|attachments)\b)[^>]*>[\s\S]*?<h2>\s*Files\s*<\/h2>[\s\S]*?<\/section>/gi,
    ),
  ].map((match) => ({
    index: match.index,
    html: match[0],
  }));
}

function filesInsideMoodleSection(html, filesIndex) {
  const stack = [];
  const before = text(html).slice(0, filesIndex);
  for (const match of before.matchAll(/<\/section\s*>|<section\b[^>]*>/gi)) {
    const token = match[0];
    if (/^<\//.test(token)) {
      stack.pop();
    } else {
      stack.push(/\bclass=["'][^"']*\bmoodle-section\b/i.test(token) ? "moodle-section" : "section");
    }
  }
  return stack.includes("moodle-section");
}

function markerKinds(html) {
  const content = text(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const kinds = [];
  if (/<iframe\b[^>]*(?:localized-h5p|h5p_embed|h5p-player|h5p-content|\/h5p\/|\/h5p-external\/|\.h5p)[^>]*>/i.test(content)
    || /<div\b[^>]*\bh5p-(?:player|content)\b[^>]*>/i.test(content)) kinds.push("h5p");
  if (/<(?:video|source|a)\b[^>]*(?:src|href|data-src)=["'][^"']*(?:\.mp4|\.webm|embed\/video|video\/)[^"']*["']/i.test(content)) kinds.push("video");
  if (/<(?:iframe|object|embed|div)\b[^>]*(?:localized-ispring|ispring|presentation\.html|html5-package)/i.test(content)) kinds.push("ispring");
  return kinds;
}

function isExpectedIspringForFlow(item, flow) {
  const scope = [item?.label, item?.role, item?.category, item?.path, item?.packagePath]
    .map((value) => flowScope(value))
    .join(" ");
  if (!(scope.includes("ispring") || scope.includes("presentation.html") || scope.includes("lesson_ispring"))) return false;
  if (flow === "hands_on") return scope.includes("hands");
  if (flow === "consolidation") return scope.includes("consolidation") || scope.includes("consoldation");
  if (flow === "homework") return scope.includes("homework");
  if (flow === "lesson") return !(scope.includes("hands") || scope.includes("consolidation") || scope.includes("consoldation") || scope.includes("homework"));
  return false;
}

function isExpectedH5pForFlow(item, flow) {
  const type = text(item?.type).toLowerCase();
  const category = text(item?.category).toLowerCase();
  const scope = [item?.label, item?.role, item?.parentSection, item?.category, item?.path, item?.previewPath, item?.localizedPackagePath, item?.localizedPreviewPath]
    .map((value) => flowScope(value))
    .join(" ");
  const isH5p = type === "h5p" || category.includes("h5p") || /(?:\/h5p\/|\/h5p-external\/|\.h5p(?:$|[?#]))/i.test(scope);
  if (!isH5p) return false;
  if (flow === "hands_on") return scope.includes("hands");
  if (flow === "consolidation") return scope.includes("consolidation") || scope.includes("consoldation") || scope.includes("exit");
  if (flow === "homework") return scope.includes("homework");
  if (flow === "lesson") return !(scope.includes("hands") || scope.includes("consolidation") || scope.includes("consoldation") || scope.includes("homework"));
  return false;
}

function playableMarkers(html) {
  const content = text(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const markers = [];
  const addMatches = (kind, pattern) => {
    for (const match of content.matchAll(pattern)) {
      markers.push({ kind, index: match.index || 0 });
    }
  };
  addMatches("ispring", /(?:\blocalized-ispring\b|<iframe\b[^>]*(?:ispring-localized|presentation\.html|html5-package)[^>]*>)/gi);
  addMatches("h5p", /(?:\bembedded-h5p(?:-frame)?\b|<iframe\b[^>]*(?:\/h5p\/|\/h5p-external\/|\.h5p)[^>]*>)/gi);
  addMatches("video", /(?:\bembedded-video\b|<video\b|<source\b[^>]*(?:\.mp4|\.webm)|<iframe\b[^>]*(?:embed\/video|video\/)[^>]*>)/gi);
  return markers.sort((a, b) => a.index - b.index);
}

function reviewInlinePlayablePlacement(html, context, issues) {
  const content = text(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const playableIndexes = playableMarkers(content);
  if (!playableIndexes.length) return;

  const firstFiles = content.search(/<section\b[^>]*class=["'][^"']*\b(?:attachments|files)\b[^"']*["'][^>]*>[\s\S]*?<h2>\s*Files\s*<\/h2>/i);
  const latePlayable = playableIndexes.find((marker) => firstFiles >= 0 && marker.index > firstFiles);
  if (latePlayable) {
    addIssue(
      issues,
      "error",
      "inline-playable-after-files",
      "Inline localized H5P/video/iSpring appears after the Files block; playable lesson content should render before ordinary attachments.",
      { ...context, playableKind: latePlayable.kind },
    );
  }

  const mainClose = content.indexOf("</main>");
  const outsideMain = playableIndexes.find((marker) => mainClose >= 0 && marker.index > mainClose);
  if (outsideMain) {
    addIssue(
      issues,
      "error",
      "inline-playable-outside-main",
      "Inline localized H5P/video/iSpring appears outside the ENG3U page shell main area.",
      { ...context, playableKind: outsideMain.kind },
    );
  }
}

function reviewExitSlipHeadingPlacement(html, context, issues) {
  const content = text(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const headingMatch = /Exit\s+Slip\s*-\s*Record\s+Your\s+Work/i.exec(stripHtml(content));
  const rawHeadingMatch = /Exit\s+Slip\s*-\s*Record\s+Your\s+Work/i.exec(content);
  if (!headingMatch && !rawHeadingMatch) return;
  const headingIndex = rawHeadingMatch?.index ?? content.search(/Exit\s+Slip\s*-\s*Record\s+Your\s+Work/i);
  const exitSlipH5p = content.search(/<div\b[^>]*class=["'][^"']*\bembedded-h5p(?:-frame)?\b[^"']*["'][^>]*>\s*<iframe\b[^>]*(?:exit[-_\s]*slip|title=["'][^"']*exit\s+slip)[^>]*>/i);
  const h5pMarkers = [...content.matchAll(/<div\b[^>]*class=["'][^"']*\bembedded-h5p(?:-frame)?\b[^"']*["'][^>]*>|<iframe\b[^>]*(?:\/h5p\/|\/h5p-external\/|\.h5p)/gi)];
  const firstH5p = h5pMarkers[0]?.index ?? -1;
  const targetH5p = exitSlipH5p >= 0 ? exitSlipH5p : (h5pMarkers.length === 1 ? firstH5p : -1);
  if (targetH5p >= 0 && targetH5p < headingIndex) {
    addIssue(
      issues,
      "error",
      "exit-slip-heading-after-h5p",
      "Exit Slip heading appears after the H5P player; it should introduce the activity before the player.",
      context,
    );
  }
}

function reviewMoodlePlatformResidue(html, context, issues) {
  const content = text(html);
  if (/<iframe\b(?:(?!\bsrc\s*=|\bdata-src\s*=)[^>])*>\s*<\/iframe>/i.test(content)) {
    addIssue(
      issues,
      "error",
      "empty-iframe-src-missing",
      "Localized page contains an iframe with no src/data-src; this usually means a Moodle/external activity source was stripped instead of localized or converted to an external activity card.",
      context,
    );
  }
  if (/\bsubmissionlinks\b|>\s*View all submissions\s*<|fileuploadsubmissiontime|gradingtable/i.test(content)) {
    addIssue(
      issues,
      "error",
      "moodle-platform-controls-visible",
      "Localized page still contains Moodle platform controls such as submission/grade links.",
      context,
    );
  }
  if (/<h([1-6])\b[^>]*>\s*(?:<strong>\s*)?(?:<br\s*\/?>|&nbsp;|\s)*(?:<\/strong>\s*)?<\/h\1>/i.test(content)) {
    addIssue(
      issues,
      "error",
      "empty-heading-visible",
      "Localized page contains an empty heading left over from Moodle cleanup.",
      context,
    );
  }
  if (/<h([1-6])\b[^>]*>\s*<strong\b[^>]*>\s*<h\1\b/i.test(content)) {
    addIssue(
      issues,
      "error",
      "nested-heading-visible",
      "Localized page contains malformed nested headings left over from Moodle cleanup.",
      context,
    );
  }
}

function isOrdinaryFileAttachment(item) {
  const type = text(item?.type).toLowerCase();
  const scope = [item?.label, item?.path, item?.downloadPath, item?.previewPath, item?.category]
    .map((value) => text(value).toLowerCase())
    .join(" ");
  if (type === "h5p" || type === "video" || type === "ispring") return false;
  if (scope.includes("/h5p/") || scope.includes("/h5p-external/") || scope.includes("ispring-localized/")) return false;
  if (/\.(h5p|mp4|webm|mov)(?:$|[?#])/i.test(scope)) return false;
  return /^(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|txt|rtf|gif|png|jpg|jpeg)$/i.test(type)
    || /\.(pdf|docx?|pptx?|xlsx?|zip|txt|rtf|gif|png|jpe?g)(?:$|[?#])/i.test(scope);
}

function attachmentList(value) {
  return Array.isArray(value) ? value : [];
}

function attachmentIdentity(item) {
  return item?.path || item?.downloadPath || item?.previewPath || item?.source || item?.label || "";
}

function downloadFlowKey(item) {
  const structured = classifyFlowValue(item?.role)
    || classifyFlowValue(item?.sectionLabel)
    || classifyFlowValue(item?.category);
  if (structured) return structured;
  return classifyFlowValue([item?.label, item?.path].join(" "));
}

function sourceBookChapterId(value) {
  const source = text(value?.source || value?.url);
  return source.match(/[?&]chapterid=(\d+)/i)?.[1]
    || source.match(/\/mod_book\/chapter\/(\d+)\//i)?.[1]
    || "";
}

function downloadSectionStem(item) {
  return text(item?.path)
    .replaceAll("\\", "/")
    .toLowerCase()
    .match(/\/book_sections\/files\/([^/]+)\//)?.[1];
}

function positionKey(unit, lesson) {
  const unitNumber = Number(unit?.unit || unit);
  const lessonNumber = Number(lesson?.lesson || lesson);
  return unitNumber && lessonNumber ? `${unitNumber}:${lessonNumber}` : "";
}

function isHomeworkSubmissionResource(item) {
  const role = text(item?.role).toLowerCase();
  const parentSection = text(item?.parentSection).toLowerCase();
  const sourceGroup = text(item?.sourceGroup).toLowerCase();
  if (role === "homework_answer_page" || /answer/.test(role)) return false;
  if (role === "homework_submission_page" || role === "homework_submission") return true;
  return /homework[\s_-]*submission[\s_-]*folder/.test(`${parentSection} ${sourceGroup}`);
}

function homeworkSubmissionAttachmentsForLesson(manifest, unit, lesson) {
  const key = positionKey(unit, lesson);
  if (!key) return [];
  return attachmentList(manifest?.courseDownloads)
    .filter((item) => isHomeworkSubmissionResource(item) && positionKey(item.unit, item.lesson) === key)
    .flatMap((item) => attachmentList(item.attachments));
}

function sectionStem(section) {
  return text(section?.path)
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.replace(/\.html$/i, "")
    .toLowerCase();
}

function expectedBookSectionAttachments(courseRoot, manifest, unit, lesson, section) {
  const flow = flowKey(section);
  const stem = sectionStem(section);
  const sectionChapterId = sourceBookChapterId(section);
  const byKey = new Map();
  const add = (item) => {
    if (!isOrdinaryFileAttachment(item)) return;
    if (item?.path && !existsSync(join(courseRoot, item.path))) return;
    const key = attachmentIdentity(item);
    if (!key || byKey.has(key)) return;
    byKey.set(key, item);
  };

  attachmentList(section.attachments).forEach(add);
  attachmentList(lesson.downloads)
    .filter((item) => {
      const itemStem = downloadSectionStem(item);
      if (itemStem && stem && itemStem === stem) return true;
      const itemChapterId = sourceBookChapterId(item);
      if (itemChapterId && sectionChapterId && itemChapterId === sectionChapterId) return true;
      if (!itemStem && !itemChapterId && flow && downloadFlowKey(item) === flow) return true;
      return false;
    })
    .forEach(add);
  if (flow === "homework") {
    homeworkSubmissionAttachmentsForLesson(manifest, unit, lesson).forEach(add);
  }

  return [...byKey.values()];
}

function addIssue(issues, severity, rule, message, context = {}) {
  issues.push({ severity, rule, message, context });
}

function reviewEng3uFileDisplay(courseRoot, html, sections, context, issues) {
  const cssLink = html.match(/<link\b(?=[^>]*course-page-shell\.css)(?=[^>]*data-course-shell=["']eng3u-course-shell-v2["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  if (!cssLink) {
    addIssue(issues, "error", "eng3u-shell-css-link-missing", "ENG3U shell page is missing the shared course-page-shell.css link.", context);
  } else if (context.path) {
    const cssPath = join(courseRoot, dirname(context.path), cssLink[1]);
    if (!existsSync(cssPath)) {
      addIssue(issues, "error", "eng3u-shell-css-target-missing", "ENG3U shell page links to course-page-shell.css, but the resolved CSS file is missing.", {
        ...context,
        cssHref: cssLink[1],
      });
    }
  }
  for (const fileSection of sections) {
    if (!/\battachments\b/i.test(fileSection.html)) {
      addIssue(issues, "error", "eng3u-files-section-class-mismatch", "ENG3U shell Files block must use attachments styling.", context);
    }
    if (!/\bfiles\b/i.test(fileSection.html)) {
      addIssue(issues, "error", "eng3u-files-section-class-mismatch", "ENG3U shell Files block must use the shared attachments files class.", context);
    }
    if (!filesInsideMoodleSection(html, fileSection.index)) {
      addIssue(issues, "error", "eng3u-files-outside-card", "ENG3U shell Files block is outside the white moodle-section card.", context);
    }
    if (/>View<\/a>|>Download<\/a>/i.test(fileSection.html)) {
      addIssue(issues, "error", "eng3u-files-action-text-mismatch", "ENG3U shell Files buttons must use 查看 / 下载.", context);
    }
    if (!/>查看<\/a>/i.test(fileSection.html) && /href=/i.test(fileSection.html)) {
      addIssue(issues, "warn", "eng3u-files-view-action-missing", "ENG3U shell Files block has links but no 查看 action.", context);
    }
    if (/download/i.test(fileSection.html) && !/>下载<\/a>/i.test(fileSection.html)) {
      addIssue(issues, "warn", "eng3u-files-download-action-missing", "ENG3U shell Files block has download links but no 下载 action.", context);
    }
    if (/\bfile-row\b|\bclass=["'][^"']*\bbutton\b/i.test(fileSection.html)) {
      addIssue(issues, "error", "eng3u-files-legacy-row-mixed-in", "ENG3U shell Files block contains legacy file-row/button markup.", context);
    }
  }
}

function reviewBookSection(courseRoot, course, manifest, unit, lesson, section) {
  const issues = [];
  const sectionPath = join(courseRoot, section.path || "");
  const context = {
    course,
    unit: unit.unit,
    lesson: lesson.lesson,
    lessonTitle: lesson.title || "",
    sectionLabel: section.sectionLabel || section.label || "",
    flow: flowKey(section),
    path: section.path || "",
  };
  if (!section.path || !existsSync(sectionPath)) {
    addIssue(issues, "error", "book-section-page-missing", "Book section page is missing.", context);
    return {
      ...context,
      shell: "missing",
      readableChars: 0,
      attachments: expectedBookSectionAttachments(courseRoot, manifest, unit, lesson, section).length,
      markers: [],
      issues,
    };
  }

  const html = readFileSync(sectionPath, "utf8");
  const shell = htmlShell(html);
  const files = filesSections(html);
  const displaySections = files.length ? files : attachmentDisplaySections(html);
  const attachments = expectedBookSectionAttachments(courseRoot, manifest, unit, lesson, section);
  const markers = markerKinds(html);
  const sectionFlow = flowKey(section);
  const expectedSectionIspring = ["lesson", "hands_on", "consolidation", "homework"].includes(sectionFlow)
    ? attachmentList(lesson.ispring).filter((item) => isExpectedIspringForFlow(item, sectionFlow) && item?.path && existsSync(join(courseRoot, item.path)))
    : [];
  const expectedSectionH5p = ["lesson", "hands_on", "consolidation", "homework"].includes(sectionFlow)
    ? [
      ...attachmentList(lesson.handsOn),
      ...attachmentList(lesson.downloads),
      ...attachmentList(section.attachments),
    ].filter((item) => isExpectedH5pForFlow(item, sectionFlow) && item?.previewPath && existsSync(join(courseRoot, item.previewPath)))
    : [];
  const readableChars = stripHtml(html).length;

  if (shell !== "eng3u") {
    addIssue(issues, "error", "book-section-non-eng3u-shell", "Book section page must use the ENG3U page shell.", context);
  } else {
    reviewEng3uFileDisplay(courseRoot, html, displaySections, context, issues);
  }
  reviewInlinePlayablePlacement(html, context, issues);
  reviewExitSlipHeadingPlacement(html, context, issues);
  reviewMoodlePlatformResidue(html, context, issues);

  if (expectedSectionIspring.length && !markers.includes("ispring")) {
    addIssue(
      issues,
      "error",
      "section-ispring-not-rendered-inline",
      "Book section has localized iSpring in the manifest but the page does not render it inline.",
      { ...context, expectedIspring: expectedSectionIspring.map((item) => item.path) },
    );
  }

  if (expectedSectionH5p.length && !markers.includes("h5p")) {
    addIssue(
      issues,
      "error",
      "section-h5p-not-rendered-inline",
      "Book section has localized H5P in the manifest but the page does not render it inline.",
      { ...context, expectedH5p: expectedSectionH5p.map((item) => item.previewPath) },
    );
  }

  if (shell !== "eng3u" && files.some((fileSection) => /\battachments\b|\bfile-action\b|>查看<\/a>|>下载<\/a>/i.test(fileSection.html))) {
    addIssue(issues, "warn", "legacy-page-uses-eng3u-file-markup", "Legacy/plain page appears to use ENG3U Files markup; check that old shell styling is not being mixed in.", context);
  }

  if (attachments.length && !displaySections.length) {
    addIssue(issues, "error", "attachments-not-rendered-in-page", "Book section has attachments in the manifest but no Files block in the page.", context);
  }

  if (readableChars < 40 && !attachments.length && !markers.length) {
    addIssue(issues, "warn", "thin-page-no-resource-display", "Page has very little readable text and no visible resource marker.", context);
  }

  return {
    ...context,
    shell,
    readableChars,
    attachments: attachments.length,
    filesSections: displaySections.length,
    markers,
    expectedLessonIspring: expectedSectionIspring.length,
    issues,
  };
}

function collectStandaloneCourseShellItems(manifest) {
  const byPath = new Map();
  const itemCompletenessScore = (item) => {
    const attachments = attachmentList(item?.attachments).length;
    const label = item?.label || item?.title ? 1 : 0;
    const preview = item?.textPreview ? 1 : 0;
    return attachments * 100 + label * 10 + preview;
  };
  const mergeAttachments = (target, source) => {
    const merged = new Map();
    for (const attachment of [...attachmentList(target.attachments), ...attachmentList(source.attachments)]) {
      const key = text(attachment?.path || attachment?.href || attachment?.label).replaceAll("\\", "/");
      if (!key) continue;
      if (!merged.has(key)) merged.set(key, attachment);
    }
    if (merged.size) target.attachments = [...merged.values()];
  };
  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const rel = text(value.path).replaceAll("\\", "/");
    const shouldReview = /^localized-moodle-activities\/[^/]+\/[^/]+\/index\.html$/i.test(rel)
      || /^course-sections\/[^/]+\/index\.html$/i.test(rel);
    if (shouldReview) {
      const existing = byPath.get(rel);
      if (!existing) {
        byPath.set(rel, value);
      } else {
        const best = itemCompletenessScore(value) > itemCompletenessScore(existing) ? value : existing;
        const other = best === value ? existing : value;
        mergeAttachments(best, other);
        byPath.set(rel, best);
      }
    }
    for (const nested of Object.values(value)) visit(nested);
  }
  visit(manifest);
  return [...byPath.values()];
}

function standaloneScope(rel) {
  if (/^course-sections\//i.test(rel)) return "course-section";
  if (/^localized-moodle-activities\/assign\//i.test(rel)) return "localized-assign-activity";
  if (/^localized-moodle-activities\/quiz\//i.test(rel)) return "localized-quiz-activity";
  if (/^localized-moodle-activities\/url\//i.test(rel)) return "localized-url-activity";
  if (/^localized-moodle-activities\/folder\//i.test(rel)) return "localized-folder-activity";
  if (/^localized-moodle-activities\/forum\//i.test(rel)) return "localized-forum-activity";
  if (/^localized-moodle-activities\/resource\//i.test(rel)) return "localized-resource-activity";
  return "localized-page-activity";
}

function reviewStandaloneCourseShellPage(courseRoot, course, item) {
  const issues = [];
  const rel = text(item.path).replaceAll("\\", "/");
  const pagePath = join(courseRoot, rel);
  const context = {
    course,
    scope: standaloneScope(rel),
    sectionLabel: item.label || item.title || "",
    path: rel,
  };
  if (!rel || !existsSync(pagePath)) {
    addIssue(issues, "error", "standalone-course-page-missing", "Standalone course HTML page is missing.", context);
    return { ...context, shell: "missing", readableChars: 0, attachments: attachmentList(item.attachments).filter(isOrdinaryFileAttachment).length, issues };
  }
  const html = readFileSync(pagePath, "utf8");
  const shell = htmlShell(html);
  const displaySections = attachmentDisplaySections(html);
  const attachments = attachmentList(item.attachments).filter(isOrdinaryFileAttachment);
  const ispring = attachmentList(item.ispring).filter((entry) => entry?.path && existsSync(join(courseRoot, entry.path)));
  const readableChars = stripHtml(html).length;
  if (shell !== "eng3u") {
    addIssue(issues, "error", "standalone-page-non-eng3u-shell", "Standalone course page must use the ENG3U page shell.", context);
  } else {
    reviewEng3uFileDisplay(courseRoot, html, displaySections, context, issues);
  }
  reviewInlinePlayablePlacement(html, context, issues);
  reviewExitSlipHeadingPlacement(html, context, issues);
  reviewMoodlePlatformResidue(html, context, issues);
  if (attachments.length && !displaySections.length) {
    addIssue(issues, "error", "standalone-page-attachments-not-rendered", "Standalone course page has attachments in the manifest but no ENG3U Files block in the page.", context);
  }
  return {
    ...context,
    shell,
    readableChars,
    attachments: attachments.length,
    ispring: ispring.length,
    filesSections: displaySections.length,
    issues,
  };
}

function reviewCourseSectionPlayableCards(course, manifest) {
  const issues = [];
  const frontendPath = join(projectRoot, "src", "main.tsx");
  const frontend = existsSync(frontendPath) ? readFileSync(frontendPath, "utf8") : "";
  const rendersCourseSectionIspring = /visibleCourseSectionISpring\(item\)\.map[\s\S]*?<ISpringActions\b/.test(frontend);
  for (const item of manifest.courseSections || []) {
    const ispring = attachmentList(item.ispring);
    if (!ispring.length) continue;
    if (!item.path || !/^course-sections\//i.test(text(item.path).replaceAll("\\", "/"))) continue;
    for (const entry of ispring) {
      const context = {
        course,
        sectionLabel: item.label || item.title || "",
        path: item.path || "",
        ispringPath: entry.path || entry.url || "",
      };
      if (!entry.path && !entry.url) {
        addIssue(issues, "error", "course-section-ispring-path-missing", "Course section iSpring is missing a playable path or URL.", context);
      }
      if (!rendersCourseSectionIspring) {
        addIssue(issues, "error", "course-section-ispring-standalone-card-missing", "Portal overview renderer does not expose course section iSpring as a standalone card for Moodle embedding.", context);
      }
    }
  }
  return issues;
}

function reviewCourse(course) {
  const courseRoot = join(coursewareRoot, course);
  const manifestPath = join(courseRoot, "course-manifest.json");
  const manifest = readJson(manifestPath);
  const pages = [];
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      for (const section of lesson.bookSections || []) {
        pages.push(reviewBookSection(courseRoot, course, manifest, unit, lesson, section));
      }
    }
  }
  for (const item of collectStandaloneCourseShellItems(manifest)) {
    pages.push(reviewStandaloneCourseShellPage(courseRoot, course, item));
  }
  const courseSectionPlayableIssues = reviewCourseSectionPlayableCards(course, manifest);
  const issues = pages.flatMap((page) => page.issues);
  issues.push(...courseSectionPlayableIssues);
  const shellCounts = pages.reduce((acc, page) => {
    acc[page.shell] = (acc[page.shell] || 0) + 1;
    return acc;
  }, {});
  return {
    course,
    title: manifest.title || manifest.fullname || "",
    status: issues.some((issue) => issue.severity === "error") ? "fail" : issues.some((issue) => issue.severity === "warn") ? "review" : "pass",
    pages: pages.length,
    shellCounts,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warn").length,
    issues,
    samples: pages.filter((page) => page.issues.length).slice(0, 12),
  };
}

function markdown(report) {
  const lines = [];
  lines.push("# Page Display Regression Review");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Courses: ${report.summary.courses}`);
  lines.push(`- Pages: ${report.summary.pages}`);
  lines.push(`- Pass: ${report.summary.pass}`);
  lines.push(`- Review: ${report.summary.review}`);
  lines.push(`- Fail: ${report.summary.fail}`);
  lines.push(`- Errors: ${report.summary.errors}`);
  lines.push(`- Warnings: ${report.summary.warnings}`);
  lines.push("");
  lines.push("## Courses");
  lines.push("");
  lines.push("| Course | Status | Pages | Shells | Errors | Warnings | First Issues |");
  lines.push("| --- | --- | ---: | --- | ---: | ---: | --- |");
  for (const course of report.courses) {
    const shells = Object.entries(course.shellCounts).map(([key, count]) => `${key}:${count}`).join(", ");
    const firstIssues = course.issues
      .slice(0, 4)
      .map((issue) => `${issue.rule} ${issue.context.unit ? `U${issue.context.unit}` : ""}${issue.context.lesson ? `L${issue.context.lesson}` : ""} ${issue.context.sectionLabel || ""}`.trim())
      .join("; ")
      .replaceAll("|", "\\|");
    lines.push(`| ${course.course} | ${course.status.toUpperCase()} | ${course.pages} | ${shells || "-"} | ${course.errors} | ${course.warnings} | ${firstIssues || "-"} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const courses = listCourses();
const rows = courses.map(reviewCourse);
const report = {
  generatedAt: new Date().toISOString(),
  coursewareRoot,
  summary: {
    courses: rows.length,
    pages: rows.reduce((sum, row) => sum + row.pages, 0),
    pass: rows.filter((row) => row.status === "pass").length,
    review: rows.filter((row) => row.status === "review").length,
    fail: rows.filter((row) => row.status === "fail").length,
    errors: rows.reduce((sum, row) => sum + row.errors, 0),
    warnings: rows.reduce((sum, row) => sum + row.warnings, 0),
  },
  courses: rows,
};

const outPath = resolve(projectRoot, readArg("--out") || "deployment/page-display-regression.json");
const mdOutPath = resolve(projectRoot, readArg("--md-out") || "deployment/page-display-regression.md");
if (!hasFlag("--json")) {
  for (const row of rows) {
    console.log(`${row.status.toUpperCase()} ${row.course}: ${row.pages} pages; ${row.errors}E/${row.warnings}W; shells ${JSON.stringify(row.shellCounts)}`);
  }
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(mdOutPath, markdown(report), "utf8");

if (hasFlag("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\nWrote ${outPath}`);
  console.log(`Wrote ${mdOutPath}`);
}
process.exit(report.summary.errors ? 1 : 0);
