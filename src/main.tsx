import { StrictMode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { SUPPORTED_LOCALES, detectInitialLocale, storeLocale, translate } from "./i18n";
import type { PortalLocale } from "./i18n";
import type { ReactNode } from "react";
import type {
  CourseCatalog,
  CourseCatalogEntry,
  CourseManifest,
  FileResource,
  Lesson,
  MoodleEmbedRow,
  TextRegistryEntry,
  Unit,
} from "./types";

const CATALOG_URL = import.meta.env.VITE_COURSE_CATALOG_URL || "/course-catalog.json";
type TFunction = (key: string, params?: Record<string, string | number>) => string;
type PortalI18nValue = {
  locale: PortalLocale;
  setLocale: (locale: PortalLocale) => void;
  t: TFunction;
};

const PortalI18nContext = createContext<PortalI18nValue>({
  locale: "en",
  setLocale: () => {},
  t: (key) => translate("en", key),
});

function usePortalI18n(): PortalI18nValue {
  return useContext(PortalI18nContext);
}

function PortalI18nProvider({
  children,
  locale,
  setLocale,
}: {
  children: ReactNode;
  locale: PortalLocale;
  setLocale: (locale: PortalLocale) => void;
}) {
  const value = useMemo<PortalI18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
    }),
    [locale, setLocale],
  );
  return <PortalI18nContext.Provider value={value}>{children}</PortalI18nContext.Provider>;
}

function LanguageSwitcher() {
  const { locale, setLocale, t } = usePortalI18n();
  const handleChange = (nextLocale: PortalLocale) => {
    setLocale(nextLocale);
    const params = new URLSearchParams(window.location.search);
    params.set("lang", nextLocale);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };
  return (
    <label className="language-switcher">
      <span>{t("language.label")}</span>
      <select onChange={(event) => handleChange(event.target.value as PortalLocale)} value={locale}>
        {SUPPORTED_LOCALES.map((item) => (
          <option key={item} value={item}>
            {item === "zh-CN" ? t("language.chinese") : t("language.english")}
          </option>
        ))}
      </select>
    </label>
  );
}

type PortalSession = {
  authenticated: boolean;
  username: string | null;
  displayName?: string | null;
  role: string | null;
  courses: string[];
};

type MoodleEmbedMap = Map<string, MoodleEmbedRow>;
type ShareLinkResponse = {
  ok: boolean;
  shareUrl?: string;
  expiresAt?: string;
  error?: string;
};

const FALLBACK_COURSE: CourseCatalogEntry = {
  code: "ENG3U",
  title: "English, Grade 11, University",
  manifestUrl: import.meta.env.VITE_COURSE_MANIFEST_URL || "/courseware/ENG3U/course-manifest.json",
  baseUrl: import.meta.env.VITE_COURSE_BASE_URL || "/courseware/ENG3U/",
  status: "ready",
};

function courseCodeSortKey(course: Pick<CourseCatalogEntry, "code">): string {
  return course.code.toUpperCase();
}

function sortCatalogCourses(courses: CourseCatalogEntry[]): CourseCatalogEntry[] {
  return [...courses].sort((left, right) =>
    courseCodeSortKey(left).localeCompare(courseCodeSortKey(right), "en", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

function requestedCourseCodeFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get("course")?.trim().toUpperCase();
  return value || null;
}

function canGenerateMoodleEmbeds(session: PortalSession | null): boolean {
  return Boolean(session && (session.role === "admin" || session.role === "superadmin" || session.courses.includes("*")));
}

function canOpenAdminBackend(session: PortalSession | null): boolean {
  return canGenerateMoodleEmbeds(session);
}

function resourceUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) {
    return path;
  }
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${path.split("/").map(encodeURIComponent).join("/")}`;
}

type LinkableResource = {
  label: string;
  type?: string;
  category?: string;
  role?: string;
  path?: string;
  url?: string;
  previewPath?: string;
  previewUrl?: string;
  downloadPath?: string;
  downloadUrl?: string;
  source?: string;
  bytes?: number;
  attachments?: LinkableResource[];
  unit?: number;
  lesson?: number;
  parentSection?: string;
  sourceGroup?: string;
  teacherOnly?: boolean;
  teacherUse?: string;
  textPreview?: string;
  mode?: string;
};

function courseCodeFromBaseUrl(baseUrl: string): string {
  const match = /\/courseware\/([^/]+)/i.exec(baseUrl);
  return match ? decodeURIComponent(match[1]).toUpperCase() : FALLBACK_COURSE.code;
}

function shareKindForItem(item: LinkableResource): MoodleEmbedRow["kind"] {
  if (isISpringResource(item)) return "ispring";
  if (isVideoResource(item)) return "video";
  if (isH5PResource(item)) return "h5p";
  return "file";
}

function resourceHref(item: LinkableResource, baseUrl: string): string {
  if (item.path) return resourceUrl(item.path, baseUrl);
  if (item.url) return item.url;
  return "#";
}

function resourcePreviewHref(item: LinkableResource, baseUrl: string): string {
  if (item.previewPath) return resourceUrl(item.previewPath, baseUrl);
  if (item.previewUrl) return item.previewUrl;
  const type = (item.type || "").toLowerCase();
  if (item.path && OFFICE_PREVIEW_TYPES.has(type)) return resourceUrl(`previews-html/${item.path}.html`, baseUrl);
  return resourceHref(item, baseUrl);
}

function resourceDownloadHref(item: LinkableResource, baseUrl: string): string {
  if (item.downloadPath) return resourceUrl(item.downloadPath, baseUrl);
  if (item.downloadUrl) return item.downloadUrl;
  return resourceHref(item, baseUrl);
}

function resourceKey(item: LinkableResource): string {
  return item.path || item.url || item.previewPath || item.previewUrl || item.label;
}

function moodleEmbedForResource(rowsByPath: MoodleEmbedMap | undefined, item: LinkableResource): MoodleEmbedRow | undefined {
  if (!rowsByPath) return undefined;
  return [item.path, item.previewPath, item.url, item.previewUrl, item.downloadPath, item.downloadUrl]
    .filter((value): value is string => Boolean(value))
    .map((value) => rowsByPath.get(value))
    .find(Boolean);
}

const BROWSER_PREVIEW_TYPES = new Set([
  "html",
  "htm",
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "tif",
  "tiff",
  "txt",
  "md",
  "csv",
  "json",
  "mp4",
  "webm",
]);

const OFFICE_PREVIEW_TYPES = new Set(["doc", "docx", "ppt", "pptx", "xls", "xlsx"]);

function isVideoResource(item: LinkableResource): boolean {
  const type = (item.type || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  const path = `${item.path || ""} ${item.previewPath || ""} ${item.downloadPath || ""} ${item.url || ""} ${item.previewUrl || ""} ${item.downloadUrl || ""}`.toLowerCase();
  return (
    type === "mp4" ||
    type === "webm" ||
    type === "mov" ||
    type === "m4v" ||
    type === "video" ||
    category.includes("video") ||
    /\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i.test(path)
  );
}

function isISpringResource(item: LinkableResource): boolean {
  const type = (item.type || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  const path = `${item.path || ""} ${item.previewPath || ""} ${item.downloadPath || ""} ${item.url || ""} ${item.previewUrl || ""} ${item.downloadUrl || ""}`.toLowerCase();
  return type === "ispring" || category.includes("ispring") || path.includes("ispring-localized/");
}

function isH5PResource(item: LinkableResource): boolean {
  const type = (item.type || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  const path = `${item.path || ""} ${item.previewPath || ""} ${item.downloadPath || ""} ${item.url || ""} ${item.previewUrl || ""} ${item.downloadUrl || ""}`.toLowerCase();
  return type === "h5p" || type === "h5pactivity" || category.includes("h5p") || path.includes("/h5p/") || /\.(?:h5p)(?:$|[?#])/i.test(path);
}

function isPlayableOnlyResource(item: LinkableResource): boolean {
  return isVideoResource(item) || isISpringResource(item) || isH5PResource(item);
}

function isExternalInteractiveResource(item: LinkableResource): boolean {
  const category = (item.category || "").toLowerCase();
  const role = (item.role || "").toLowerCase();
  const source = (item.source || "").toLowerCase();
  const path = `${item.url || ""} ${item.previewUrl || ""}`.toLowerCase();
  return (
    category === "external_interactive" ||
    role === "external_interactive" ||
    source === "external_interactive" ||
    /(?:quizlet\.com\/|wordwall\.net\/embed\/|genially\.com\/|youtube(?:-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/i.test(path)
  );
}

function hasLocalResource(item: LinkableResource): boolean {
  const trustedRemote = item.source === "cdn" || item.source === "oss";
  return Boolean(item.path || item.previewPath || item.downloadPath || isExternalInteractiveResource(item) || (trustedRemote && (item.url || item.previewUrl)));
}

function hasWebPreview(item: LinkableResource, moodleEmbed?: MoodleEmbedRow): boolean {
  if (moodleEmbed?.kind === "video" && Boolean(moodleEmbed.embedUrl)) return true;
  if (item.previewPath || item.previewUrl) return true;
  if (!item.path && !item.url) return false;
  const type = (item.type || "").toLowerCase();
  if (OFFICE_PREVIEW_TYPES.has(type)) return false;
  if (BROWSER_PREVIEW_TYPES.has(type)) return true;
  return hasLocalResource(item) && !isPlayableOnlyResource(item);
}

function isDownloadableFile(item: LinkableResource): boolean {
  const type = (item.type || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  if (isExternalInteractiveResource(item)) return false;
  if (type === "html" || type === "htm") return category === "moodle_resource" && Boolean(item.path || item.downloadPath);
  if (isPlayableOnlyResource(item)) return false;
  return Boolean(item.path || item.url || item.downloadPath || item.downloadUrl);
}

function isShareableResource(item: LinkableResource): boolean {
  if (isExternalInteractiveResource(item)) return false;
  return isPlayableOnlyResource(item) && Boolean(item.path || item.previewPath || item.url || item.previewUrl || item.downloadPath || item.downloadUrl);
}

function isShareableMoodleEmbedRow(row?: MoodleEmbedRow): boolean {
  return row?.kind === "ispring" || row?.kind === "video" || row?.kind === "h5p";
}

function isVisibleISpringEntry(item: Lesson["ispring"][number]): boolean {
  const trustedRemote = item.source === "cdn" || item.source === "oss";
  return Boolean(item.path || item.url) && (item.mode !== "external" || trustedRemote);
}

function isEmptyMoodleActivityShell(item: LinkableResource): boolean {
  const category = (item.category || "").toLowerCase();
  if (!category.startsWith("moodle_") || category === "moodle_course_section") return false;
  const role = (item.role || "").toLowerCase();
  if ((category === "moodle_book_section" || role === "lesson_book_section") && (item.path || item.previewPath)) return false;
  const type = (item.type || "").toLowerCase();
  if ((item.path || item.previewPath || item.downloadPath) && type && type !== "html" && type !== "htm") return false;
  return !hasMeaningfulTextContent(item) && !visibleAttachments(item).length;
}

function isStandaloneNumberedLessonActivity(item: LinkableResource): boolean {
  if (!roleIn(item, ["lesson"])) return false;
  const label = String(item.label || "").trim();
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+$/i.test(label);
}

function isExternalOnlyResource(item: LinkableResource): boolean {
  return !hasLocalResource(item) && Boolean(item.url || item.previewUrl);
}

function isTeacherVisibleResource(item: LinkableResource): boolean {
  return hasLocalResource(item) && !isEmptyMoodleActivityShell(item);
}

function isCourseLevelResource(item: LinkableResource): boolean {
  const role = (item.role || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  return (
    role === "course_outline" ||
    role === "course_outline_copy" ||
    role === "course_document" ||
    role === "course_resource" ||
    role === "folder" ||
    role === "unit_plan_bundle" ||
    category === "course_document" ||
    category === "course_resource" ||
    category === "moodle_folder"
  );
}

function resourceIdentity(item: LinkableResource): string {
  return item.path || item.previewPath || item.downloadPath || item.url || item.previewUrl || `${item.role || ""}|${item.category || ""}|${item.label}`;
}

function resourceSourceIdentity(item: LinkableResource): string {
  const source = item.source || item.url || "";
  if (!source) return "";
  try {
    const parsed = new URL(source);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().toLowerCase();
  } catch {
    return source.replace(/[?#].*$/, "").toLowerCase();
  }
}

function addResourceKeys(keys: Set<string>, item: LinkableResource) {
  keys.add(resourceIdentity(item));
  const sourceKey = resourceSourceIdentity(item);
  if (sourceKey) keys.add(sourceKey);
}

function addUniqueResource(items: LinkableResource[], item?: LinkableResource | null) {
  if (!item || !isTeacherVisibleResource(item)) return;
  if (items.some((current) => resourceIdentity(current) === resourceIdentity(item))) return;
  items.push(item);
}

function addUniqueResources(items: LinkableResource[], resources: LinkableResource[] = []) {
  resources.forEach((item) => addUniqueResource(items, item));
}

function roleIn(item: LinkableResource, roles: string[]): boolean {
  return roles.includes((item.role || "").toLowerCase());
}

function answerResourcesForLesson(teacherResources: LinkableResource[], unit: Unit, lesson: Lesson): LinkableResource[] {
  const unitNumber = Number(unit.unit);
  const lessonNumber = Number(lesson.lesson);
  return teacherResources.filter((item) => {
    if (!roleIn(item, ["answer_key", "answer_keys"])) return false;
    return Number(item.unit) === unitNumber && Number(item.lesson) === lessonNumber;
  });
}

function lessonActivityPagesForLesson(lesson: Lesson): LinkableResource[] {
  return dedupeResources((lesson.downloads || []).filter((item) => roleIn(item, ["lesson"]) && !isHomeworkSubmissionResource(item) && hasMoodleActivityPage(item)));
}

function isNumberedLessonActivity(item: LinkableResource): boolean {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+$/i.test(String(item.label || "").trim());
}

function isNumberedLessonAnswerActivity(item: LinkableResource): boolean {
  return /^Unit\s+\d+\s*-\s*Lesson\s+\d+\s*\(Answer\)$/i.test(String(item.label || "").trim());
}

function isHomeworkSubmissionResource(item: LinkableResource): boolean {
  const role = (item.role || "").toLowerCase();
  const parentSection = (item.parentSection || "").toLowerCase();
  const sourceGroup = (item.sourceGroup || "").toLowerCase();
  const teacherUse = (item.teacherUse || "").toLowerCase();
  const scope = `${parentSection} ${sourceGroup} ${teacherUse} ${role}`;
  if (["homework_submission_page", "homework_answer_page", "homework_submission", "homework_submission_answer"].includes(role)) return true;
  if (/homework[\s_-]*submission[\s_-]*folder/.test(`${parentSection} ${sourceGroup}`)) return true;
  if (/homework[\s_-]*(?:submission|answer)/.test(role)) return true;
  return (isNumberedLessonActivity(item) || isNumberedLessonAnswerActivity(item)) && /(?:student[\s_-]*submission|homework)/.test(scope);
}

function homeworkSubmissionResourcesForManifest(manifest: CourseManifest): LinkableResource[] {
  const items: LinkableResource[] = [];
  const addCandidate = (item?: LinkableResource | null) => {
    if (item && isHomeworkSubmissionResource(item)) addUniqueResource(items, item);
  };
  (manifest.courseDownloads || []).forEach(addCandidate);
  (manifest.courseSections || []).forEach(addCandidate);
  (manifest.teacherResources || []).forEach(addCandidate);
  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      (lesson.downloads || []).forEach(addCandidate);
    }
  }
  return items.sort((a, b) => {
    const unitDelta = Number(a.unit || 0) - Number(b.unit || 0);
    if (unitDelta) return unitDelta;
    const lessonDelta = Number(a.lesson || 0) - Number(b.lesson || 0);
    if (lessonDelta) return lessonDelta;
    const aAnswer = isNumberedLessonAnswerActivity(a) ? 1 : 0;
    const bAnswer = isNumberedLessonAnswerActivity(b) ? 1 : 0;
    if (aAnswer !== bAnswer) return aAnswer - bAnswer;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });
}

function teacherPacketResourcesForManifest(manifest: CourseManifest): LinkableResource[] {
  const items: LinkableResource[] = [];
  const teacherResources = (manifest.teacherResources || []).filter((item) => !isHomeworkSubmissionResource(item));
  const answerResources = teacherResources.filter((item) => roleIn(item, ["answer_key", "answer_keys"]));
  const teacherPacketResources = teacherResources.filter((item) => {
    const scope = `${item.parentSection || ""} ${item.sourceGroup || ""} ${item.role || ""}`.toLowerCase();
    return /teacher[\s_-]*packet/.test(scope) || roleIn(item, ["teacher_resource", "teacher_reference"]);
  });
  const usedAnswerKeys = new Set<string>();

  for (const unit of manifest.units || []) {
    for (const lesson of unit.lessons || []) {
      lessonActivityPagesForLesson(lesson).forEach((item) => addUniqueResource(items, item));
      answerResourcesForLesson(answerResources, unit, lesson).forEach((item) => {
        addUniqueResource(items, item);
        addResourceKeys(usedAnswerKeys, item);
      });
    }
  }

  answerResources.forEach((item) => {
    const itemKey = resourceIdentity(item);
    const sourceKey = resourceSourceIdentity(item);
    if (usedAnswerKeys.has(itemKey) || (sourceKey && usedAnswerKeys.has(sourceKey))) return;
    addUniqueResource(items, item);
  });
  addUniqueResources(items, teacherPacketResources);
  addUniqueResources(items, (manifest.courseDownloads || []).filter((item) => !isHomeworkSubmissionResource(item) && roleIn(item, ["answer_keys", "answer_key"])));
  return items;
}

function resourceList(value: unknown): LinkableResource[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item): item is LinkableResource => Boolean(item && typeof item === "object" && "label" in item));
  if (typeof value === "object" && "label" in value) return [value as LinkableResource];
  return [];
}

function unitResourcesFor(unit: Unit, key: string): LinkableResource[] {
  return resourceList(unit.unitResources?.[key]);
}

function visibleAttachments(item: LinkableResource): LinkableResource[] {
  return (item.attachments || []).filter(hasLocalResource);
}

function hasMeaningfulTextContent(item: LinkableResource): boolean {
  return Boolean((item.textPreview || "").trim());
}

function hasMoodleActivityPage(item: LinkableResource): boolean {
  const type = (item.type || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  const role = (item.role || "").toLowerCase();
  if (!item.path || !["html", "htm"].includes(type)) return false;
  if (!category.startsWith("moodle_") || category === "moodle_course_section") return false;
  if (["moodle_file", "moodle_resource"].includes(category)) return false;
  if (["file", "document", "download"].includes(role)) return false;
  return true;
}

type MoodleSectionGroup = {
  key: string;
  title: string;
  description: string;
  items: LinkableResource[];
};

function buildCourseMoodleSectionGroups(manifest: CourseManifest, t: TFunction): MoodleSectionGroup[] {
  const downloads = manifest.courseDownloads || [];
  const courseSections = manifest.courseSections || [];
  const teacherResources = manifest.teacherResources || [];
  const groups: MoodleSectionGroup[] = [];
  const courseOutlineDownloads = downloads.filter((item) => roleIn(item, ["course_outline", "course_outline_copy"]));
  const moodleCourseOutlineDownloads = courseOutlineDownloads.filter((item) => (item.category || "").toLowerCase().startsWith("moodle_"));
  const fallbackCourseOutlineDownloads = moodleCourseOutlineDownloads.length ? [] : courseOutlineDownloads;

  const makeGroup = (key: string, title: string, description: string, items: LinkableResource[]) => {
    const unique: LinkableResource[] = [];
    const embeddedFileSources = new Set<string>();
    for (const item of items) {
      const itemSource = resourceSourceIdentity(item);
      if (itemSource && embeddedFileSources.has(itemSource)) continue;
      addUniqueResource(unique, item);
      visibleAttachments(item).forEach((attachment) => {
        const attachmentSource = resourceSourceIdentity(attachment);
        if (attachmentSource) embeddedFileSources.add(attachmentSource);
      });
    }
    if (unique.length) groups.push({ key, title, description, items: unique });
  };

  makeGroup("introduction", "Introduction", t("moodle.group.introduction.description"), [
    ...courseSections.filter((item) => roleIn(item, ["introduction"])),
    ...downloads.filter((item) => roleIn(item, ["introduction"])),
  ]);

  makeGroup("course-overview", "Course Overview", t("moodle.group.courseOverview.description"), [
    ...courseSections.filter((item) => roleIn(item, ["course_overview"])),
    ...moodleCourseOutlineDownloads,
    ...fallbackCourseOutlineDownloads,
    ...downloads.filter((item) => roleIn(item, ["learning_log"])),
  ]);

  makeGroup("final", "Final Examination & Culminating", t("moodle.group.final.description"), [
    ...courseSections.filter((item) => roleIn(item, ["final_examination", "final_examination_culminating"])),
    ...downloads.filter((item) => roleIn(item, ["final_exam_submission", "culminating_submission", "culminating_assignment", "exam_review"])),
    ...teacherResources.filter((item) => roleIn(item, ["final_exam_submission", "culminating_submission", "culminating_assignment", "exam_review"])),
  ]);

  makeGroup("teacher-packet", "Teacher Packet", t("moodle.group.teacherPacket.description"), teacherPacketResourcesForManifest(manifest));

  makeGroup("homework-submission", "Homework Submission Folder", t("moodle.group.homeworkSubmission.description"), homeworkSubmissionResourcesForManifest(manifest));

  return groups;
}

function groupedResourceIdentitySet(groups: MoodleSectionGroup[]): Set<string> {
  const keys = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      addResourceKeys(keys, item);
      visibleAttachments(item).forEach((attachment) => addResourceKeys(keys, attachment));
    }
  }
  return keys;
}

function isGroupedResource(item: LinkableResource, keys: Set<string>): boolean {
  return keys.has(resourceIdentity(item)) || Boolean(resourceSourceIdentity(item) && keys.has(resourceSourceIdentity(item)));
}

function isLegacyCourseShellResource(item: LinkableResource, groups: MoodleSectionGroup[]): boolean {
  const path = (item.path || "").toLowerCase();
  const role = (item.role || "").toLowerCase();
  if (!path.startsWith("plans/course/")) return false;
  if (role === "course_outline") {
    return groups.some((group) => group.items.some((resource) => (resource.category || "").toLowerCase().startsWith("moodle_") && roleIn(resource, ["course_outline"])));
  }
  if (role === "introduction") {
    return groups.some((group) => group.key === "course-overview");
  }
  return false;
}

function resourcesByUnit(items: LinkableResource[]): { unit: number; items: LinkableResource[] }[] {
  const grouped = new Map<number, LinkableResource[]>();
  for (const item of items) {
    if (!item.unit) continue;
    const resources = grouped.get(item.unit) || [];
    resources.push(item);
    grouped.set(item.unit, resources);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([unit, resources]) => ({ unit, items: resources }));
}

function localDownloadCount(items: LinkableResource[] = []): number {
  return items.filter(isTeacherVisibleResource).length;
}

function lessonLocalDownloadCount(lesson: Lesson): number {
  const downloads = dedupeResources(visibleLessonDownloadsForLesson(lesson));
  return localDownloadCount([...downloads, ...visibleBookSectionsForLesson(lesson)]);
}

function unitMoodleResourceItems(unit: Unit): LinkableResource[] {
  return dedupeResources([...unitResourcesFor(unit, "evaluations"), ...unitResourcesFor(unit, "reflectionAndLogs")]);
}

function unitLocalDownloadCount(unit: Unit): number {
  return unit.lessons.reduce((sum, lesson) => sum + lessonLocalDownloadCount(lesson), 0) + localDownloadCount(unitMoodleResourceItems(unit));
}

function localOpenProps(item: LinkableResource, baseUrl: string, moodleEmbed?: MoodleEmbedRow) {
  if (moodleEmbed?.kind === "video" && moodleEmbed.embedUrl) {
    return { href: moodleEmbed.embedUrl, rel: "noopener", target: "_blank" };
  }
  return { href: resourcePreviewHref(item, baseUrl), rel: "noopener", target: "_blank" };
}

function localDownloadProps(item: LinkableResource, baseUrl: string) {
  const href = resourceDownloadHref(item, baseUrl);
  return item.path || item.downloadPath ? { download: true, href } : { href, rel: "noopener", target: "_blank" };
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function MoodleEmbedButton({ row }: { row?: MoodleEmbedRow }) {
  const [copied, setCopied] = useState(false);
  const { t } = usePortalI18n();
  const moodleCode = row?.moodleShortcode || row?.moodleHtml;
  if (!isShareableMoodleEmbedRow(row)) return null;
  if (!moodleCode) return null;

  const copy = async () => {
    await copyText(moodleCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button className="button-link moodle-copy" onClick={copy} title={t("action.copyShortcode")} type="button">
      <span className="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="m9 18-6-6 6-6" />
          <path d="m15 6 6 6-6 6" />
          <path d="m13 4-2 16" />
        </svg>
      </span>
      <span>{copied ? t("action.copied") : t("action.copyShortcode")}</span>
    </button>
  );
}

function PublicShareButton({
  courseCode,
  item,
  kind,
}: {
  courseCode: string;
  item: LinkableResource;
  kind?: MoodleEmbedRow["kind"];
}) {
  const [status, setStatus] = useState<"idle" | "working" | "copied" | "failed">("idle");
  const { t } = usePortalI18n();
  if (!isShareableResource(item)) return null;
  if (!item.path && !item.previewPath && !item.url && !item.previewUrl) return null;

  const createShare = async () => {
    const input = window.prompt(t("prompt.shareDays"), "30");
    if (input === null) return;
    const days = Number(input.trim() || "30");
    if (!Number.isFinite(days) || days <= 0) {
      window.alert(t("prompt.shareDaysInvalid"));
      return;
    }
    setStatus("working");
    try {
      const response = await fetch("/api/portal/share-link", {
        body: JSON.stringify({
          course: courseCode,
          expiresInDays: days,
          kind: kind || shareKindForItem(item),
          label: item.label,
          path: item.path,
          url: item.url,
          previewPath: item.previewPath,
          previewUrl: item.previewUrl,
          downloadUrl: item.downloadUrl,
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as ShareLinkResponse;
      if (!response.ok || !data.ok || !data.shareUrl) throw new Error(data.error || "Share link request failed.");
      await copyText(data.shareUrl);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch (error) {
      setStatus("failed");
      window.alert(error instanceof Error ? error.message : t("prompt.shareFailed"));
      window.setTimeout(() => setStatus("idle"), 1800);
    }
  };

  const label = status === "working" ? t("action.working") : status === "copied" ? t("action.copied") : status === "failed" ? t("action.failed") : t("action.share");
  return (
    <button className="button-link share-copy" disabled={status === "working"} onClick={createShare} title={t("action.share")} type="button">
      <span className="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 10.7 6.8-4.4" />
          <path d="m8.6 13.3 6.8 4.4" />
        </svg>
      </span>
      <span>{label}</span>
    </button>
  );
}

function ResourceActions({
  item,
  courseBaseUrl,
  courseCode,
  canShare = false,
  displayLabel,
  labelPrefix,
  variant,
  moodleEmbed,
  showDownload = true,
  showAttachmentDownload = true,
  showPlayableAttachments = true,
}: {
  item: LinkableResource;
  courseBaseUrl: string;
  courseCode?: string;
  canShare?: boolean;
  displayLabel?: string;
  labelPrefix?: string;
  variant?: string;
  moodleEmbed?: MoodleEmbedRow;
  showDownload?: boolean;
  showAttachmentDownload?: boolean;
  showPlayableAttachments?: boolean;
}) {
  const { t } = usePortalI18n();
  if (!isTeacherVisibleResource(item)) return null;

  const title = displayLabel
    ? displayLabel
    : labelPrefix && !item.label.toLowerCase().startsWith(`${labelPrefix.toLowerCase()} -`) && item.label.toLowerCase() !== labelPrefix.toLowerCase()
      ? `${labelPrefix} · ${item.label}`
      : item.label;
  const attachments = visibleAttachments(item).filter((attachment) => showPlayableAttachments || !isPlayableOnlyResource(attachment));
  const hasMediaAttachments = attachments.some(isPlayableOnlyResource);
  const hasNonMediaAttachments = attachments.some((attachment) => !isPlayableOnlyResource(attachment));
  const attachmentHeading = hasMediaAttachments && !hasNonMediaAttachments ? t("attachment.media") : hasMediaAttachments ? t("attachment.mediaAttachments") : t("attachment.attachments");
  const category = (item.category || "").toLowerCase();
  const isMoodleFileOnlyContainer =
    attachments.length > 0 &&
    category.startsWith("moodle_") &&
    category !== "moodle_course_section" &&
    !hasMeaningfulTextContent(item) &&
    !hasMoodleActivityPage(item);
  const primaryActionItem = item;
  const primaryActionEmbed = moodleEmbed;
  const displayType = primaryActionItem.type || item.type;
  const canViewPrimary = hasWebPreview(primaryActionItem, primaryActionEmbed);
  const canDownloadPrimary = showDownload && isDownloadableFile(primaryActionItem);
  const canSharePrimary = canShare && isShareableResource(primaryActionItem);
  const primaryViewLabel = isVideoResource(primaryActionItem) ? t("action.play") : t("action.view");

  return (
    <span className={`resource-actions resource-card ${variant || ""}`}>
      <span className="resource-card-main">
        <span className="resource-card-label">{title}</span>
        {displayType ? <span className="resource-card-meta">{displayType.toUpperCase()}</span> : null}
      </span>
      {!isMoodleFileOnlyContainer ? (
        <span className="resource-card-actions">
          {canViewPrimary ? (
            <a className="button-link view" {...localOpenProps(primaryActionItem, courseBaseUrl, primaryActionEmbed)}>
              {primaryViewLabel}
            </a>
          ) : null}
          {canDownloadPrimary && (
            <a className="button-link download" {...localDownloadProps(primaryActionItem, courseBaseUrl)}>
              {t("action.download")}
            </a>
          )}
          <MoodleEmbedButton row={moodleEmbed} />
          {canSharePrimary ? <PublicShareButton courseCode={courseCode || courseCodeFromBaseUrl(courseBaseUrl)} item={primaryActionItem} /> : null}
        </span>
      ) : null}
      {attachments.length ? (
        <span className="resource-card-attachments">
          <span className="attachment-heading">{attachmentHeading}</span>
          {attachments.map((attachment) => (
            <span className="attachment-row" key={resourceKey(attachment)}>
              <span className="attachment-label">{attachment.label}</span>
              <span className="attachment-actions">
                {hasWebPreview(attachment) ? (
                  <a className="attachment-link" {...localOpenProps(attachment, courseBaseUrl)}>
                    {isVideoResource(attachment) ? t("action.play") : t("action.view")}
                  </a>
                ) : null}
                {showAttachmentDownload && isDownloadableFile(attachment) ? (
                  <a className="attachment-link" {...localDownloadProps(attachment, courseBaseUrl)}>
                    {t("action.download")}
                  </a>
                ) : null}
                {canShare && isShareableResource(attachment) ? (
                  <PublicShareButton courseCode={courseCode || courseCodeFromBaseUrl(courseBaseUrl)} item={attachment} />
                ) : null}
              </span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function ISpringActions({
  item,
  courseBaseUrl,
  courseCode,
  canShare = false,
  label,
  moodleEmbed,
}: {
  item: Lesson["ispring"][number];
  courseBaseUrl: string;
  courseCode?: string;
  canShare?: boolean;
  label: string;
  moodleEmbed?: MoodleEmbedRow;
}) {
  const { t } = usePortalI18n();
  const externalOnly = item.mode === "external" || Boolean(item.url && !item.path);
  const trustedRemote = item.source === "cdn" || item.source === "oss";
  if (externalOnly && !trustedRemote) return null;
  const downloadItem = item.downloadUrl || item.downloadPath
    ? {
        label,
        path: item.downloadPath,
        url: item.downloadUrl,
      }
    : null;

  const playItem = item.path || item.url
    ? {
        label,
        path: trustedRemote && item.url ? undefined : item.path,
        url: item.url,
      }
    : null;

  if (!playItem && !downloadItem) return null;
  const shareItem: LinkableResource = {
    label,
    path: item.downloadPath || item.path,
    url: item.downloadUrl || item.url,
    previewPath: item.path,
    previewUrl: item.url,
    type: "ispring",
  };

  return (
    <span className="resource-actions resource-card featured ispring-card">
      <span className="resource-card-main">
        <span className="resource-card-label">
          {label}
          {item.slideCount ? ` · ${item.slideCount} ${t("label.slides")}` : ""}
          {item.videoSegmentCount ? ` · ${item.videoSegmentCount} videos` : ""}
        </span>
        <span className="resource-card-meta">iSpring</span>
      </span>
      <span className="resource-card-actions">
      {playItem ? (
        <a className="button-link ispring" {...localOpenProps(playItem, courseBaseUrl)}>
          {t("action.playCourseware")}
        </a>
      ) : null}
      {downloadItem ? (
        <a className="button-link download" {...localDownloadProps(downloadItem, courseBaseUrl)}>
          {t("action.downloadPackage")}
        </a>
      ) : null}
      <MoodleEmbedButton row={moodleEmbed} />
      {canShare ? (
        <PublicShareButton courseCode={courseCode || courseCodeFromBaseUrl(courseBaseUrl)} item={shareItem} kind="ispring" />
      ) : null}
      </span>
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function roleLabel(role: string, t: TFunction): string {
  const labels: Record<string, string> = {
    overview: t("label.lessonExpectations"),
    lesson: t("label.lesson"),
    handsOn: t("label.handsOn"),
    hands_on: t("label.handsOn"),
    homework: t("label.homework"),
    consolidation: t("label.consolidation"),
    teacher_notes: "Teacher Notes",
    lesson_book: t("label.lessonBook"),
    lesson_book_section: t("label.lessonBookSection"),
    course_outline: t("label.courseOutline"),
    introduction: t("label.lessonExpectations"),
    course_document: t("label.courseDocument"),
    core_text: t("label.coreText"),
    plan: t("label.plan"),
    download: t("label.downloads"),
    h5p: t("label.h5p"),
    video: t("label.video"),
    other: t("label.other"),
  };
  return labels[role] || role.replaceAll("_", " ");
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function itemMatches(value: unknown, query: string): boolean {
  return String(value ?? "").toLowerCase().includes(query);
}

function lessonMatches(lesson: Lesson, query: string): boolean {
  if (!query) return true;
  if (itemMatches(lesson.title, query) || itemMatches(lesson.id, query)) return true;
  const files: LinkableResource[] = [
    ...lesson.downloads,
    ...lesson.textExports,
    ...(lesson.bookSections || []),
    ...lesson.lessonText.map(lessonTextResource),
    ...(lesson.lessonPlan ? [lesson.lessonPlan] : []),
  ];
  const fileMatch = files.some(
    (item) =>
      itemMatches(item.label, query) ||
      itemMatches(item.type, query) ||
      itemMatches(item.role, query) ||
      itemMatches(item.path, query) ||
      itemMatches(item.url, query),
  );
  const ispringMatch = lesson.ispring.some((item) => itemMatches(item.label, query) || itemMatches(item.path, query) || itemMatches(item.url, query));
  return fileMatch || ispringMatch;
}

const LESSON_FLOW = [
  { key: "expectations", labelKey: "label.lessonExpectations", roles: ["expectations", "introduction", "overview"] },
  { key: "lesson", labelKey: "label.lesson", roles: ["lesson"] },
  { key: "resources", labelKey: "label.resources", roles: ["resource", "resources", "activity", "activities", "download"] },
  { key: "handsOn", labelKey: "label.handsOn", roles: ["handsOn", "hands_on"] },
  { key: "consolidation", labelKey: "label.consolidation", roles: ["consolidation"] },
  { key: "homework", labelKey: "label.homework", roles: ["homework"] },
] as const;

function flowKeyForRole(role?: string): string {
  const normalized = role || "other";
  const match = LESSON_FLOW.find((section) => (section.roles as readonly string[]).includes(normalized));
  return match?.key || "other";
}

function downloadFlowKey(item: LinkableResource): string {
  const role = item.role || "download";
  const type = (item.type || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  const roleFlowKey = flowKeyForRole(role);
  if (role === "lesson") return "lesson";
  if (type === "mp4" || type === "webm" || type === "video" || category.includes("video")) {
    return roleFlowKey === "other" ? "resources" : roleFlowKey;
  }
  if (role === "other" || role === "download") return "resources";
  if (
    role === "lesson_resource" ||
    role === "external_resource" ||
    role === "course_resource" ||
    role === "assignment" ||
    role === "folder" ||
    category === "moodle_resource" ||
    category === "moodle_assign" ||
    category === "moodle_folder" ||
    category === "moodle_url"
  ) {
    return "resources";
  }
  return roleFlowKey;
}

function flowLabelForKey(key: string, t: TFunction): string {
  const labelKey = LESSON_FLOW.find((section) => section.key === key)?.labelKey;
  return labelKey ? t(labelKey) : roleLabel(key, t);
}

function flowGuideForKey(key: string, t: TFunction): string {
  const guides: Record<string, string> = {
    expectations: t("flow.expectations.guide"),
    lesson: t("flow.lesson.guide"),
    resources: t("flow.resources.guide"),
    handsOn: t("flow.handsOn.guide"),
    consolidation: t("flow.consolidation.guide"),
    homework: t("flow.homework.guide"),
  };
  return guides[key] || t("flow.other.guide");
}

function ispringFlowKey(item: Lesson["ispring"][number]): string {
  const value = `${item.label || ""} ${item.path || ""}`.toLowerCase();
  if (value.includes("consolidation")) return "consolidation";
  if (value.includes("homework")) return "homework";
  if (value.includes("hands")) return "handsOn";
  return "lesson";
}

function bookSectionFlowKey(item: NonNullable<Lesson["bookSections"]>[number]): string {
  const value = `${item.sectionLabel || item.label || ""}`.toLowerCase();
  if (value.includes("overview") || value.includes("expectation") || value.includes("introduction")) return "expectations";
  if (value.includes("hands")) return "handsOn";
  if (value.includes("consolidation")) return "consolidation";
  if (value.includes("homework")) return "homework";
  return "lesson";
}

function visibleBookSectionsForLesson(lesson: Lesson): NonNullable<Lesson["bookSections"]> {
  return (lesson.bookSections || []).filter(isTeacherVisibleResource);
}

function visibleLessonDownloadsForLesson(lesson: Lesson): FileResource[] {
  return (lesson.downloads || []).filter((item) => isTeacherVisibleResource(item) && !isStandaloneNumberedLessonActivity(item));
}

function normalizedResourceName(item: LinkableResource): string {
  const name = item.label || item.path?.split(/[\\/]/).pop() || item.url || "";
  return name.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "");
}

function dedupeResources<T extends LinkableResource>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = [item.role || "", item.type || "", item.bytes || "", normalizedResourceName(item)].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function lessonTextResource(item: Lesson["lessonText"][number]): LinkableResource {
  return {
    label: item.label,
    type: item.type,
    category: "lesson_text",
    role: "lesson_book",
    path: item.path,
  };
}

function LessonFlowPanel({
  lesson,
  courseBaseUrl,
  courseCode,
  canShare,
  moodleEmbedByPath,
  visibleDownloads,
  visibleTextExports,
  visibleISpring,
}: {
  lesson: Lesson;
  courseBaseUrl: string;
  courseCode: string;
  canShare: boolean;
  moodleEmbedByPath?: MoodleEmbedMap;
  visibleDownloads: FileResource[];
  visibleTextExports: FileResource[];
  visibleISpring: Lesson["ispring"];
}) {
  const { t } = usePortalI18n();
  const bookSections = visibleBookSectionsForLesson(lesson);
  const bookSectionAttachmentKeys = new Set<string>();
  const playableAttachmentFlowByKey = new Map<string, string>();
  bookSections.forEach((section) => {
    const sectionFlowKey = bookSectionFlowKey(section);
    visibleAttachments(section).forEach((attachment) => {
      if (isPlayableOnlyResource(attachment)) {
        playableAttachmentFlowByKey.set(resourceIdentity(attachment), sectionFlowKey);
        const sourceKey = resourceSourceIdentity(attachment);
        if (sourceKey) playableAttachmentFlowByKey.set(sourceKey, sectionFlowKey);
        return;
      }
      addResourceKeys(bookSectionAttachmentKeys, attachment);
    });
  });
  const flowKeyForDownload = (item: LinkableResource) =>
    playableAttachmentFlowByKey.get(resourceIdentity(item)) ||
    (resourceSourceIdentity(item) ? playableAttachmentFlowByKey.get(resourceSourceIdentity(item)) : undefined) ||
    downloadFlowKey(item);
  const regularDownloads = dedupeResources(
    [...visibleDownloads, ...visibleTextExports].filter((item) => {
      if (item.role === "lesson_book" || item.role === "lesson_book_section") return false;
      if (isStandaloneNumberedLessonActivity(item)) return false;
      if (isGroupedResource(item, bookSectionAttachmentKeys)) return false;
      return true;
    }),
  );
  const orderedKeys = LESSON_FLOW.map((section) => section.key);

  const sectionHasContent = (key: string) => {
    if (bookSections.some((item) => bookSectionFlowKey(item) === key)) return true;
    if (regularDownloads.some((item) => flowKeyForDownload(item) === key)) return true;
    if (visibleISpring.some((item) => ispringFlowKey(item) === key)) return true;
    return false;
  };

  const keys = orderedKeys.filter(sectionHasContent);

  if (!keys.length) {
    return <div className="empty-state">{t("empty.lessonResources")}</div>;
  }

  return (
    <div className="lesson-flow">
      {keys.map((key) => {
        const sectionBookPages = bookSections.filter((item) => bookSectionFlowKey(item) === key);
        const sectionDownloads = regularDownloads.filter((item) => flowKeyForDownload(item) === key);
        const sectionISpring = visibleISpring.filter((item) => ispringFlowKey(item) === key);
        const sectionItemCount = sectionBookPages.length + sectionDownloads.length + sectionISpring.length;
        return (
          <section className="lesson-flow-section" key={key}>
            <header>
              <div>
                <span>{flowLabelForKey(key, t)}</span>
                <p>{flowGuideForKey(key, t)}</p>
              </div>
              <strong>
                {sectionItemCount} {sectionItemCount === 1 ? t("label.item") : t("label.items")}
              </strong>
            </header>
            <div className="lesson-flow-items">
              {sectionBookPages.map((item) => (
                <ResourceActions
                  courseBaseUrl={courseBaseUrl}
                  courseCode={courseCode}
                  canShare={canShare}
                  displayLabel={item.label || item.sectionLabel || flowLabelForKey(bookSectionFlowKey(item), t)}
                  item={item}
                  key={resourceKey(item)}
                  moodleEmbed={moodleEmbedForResource(moodleEmbedByPath, item)}
                  showDownload={false}
                  showPlayableAttachments={false}
                />
              ))}
              {sectionISpring.map((item, index) => {
                const label = sectionISpring.length > 1 ? t("lesson.lessonNumber", { number: index + 1 }) : t("label.lesson");
                return (
                  <ISpringActions
                    courseBaseUrl={courseBaseUrl}
                    courseCode={courseCode}
                    canShare={canShare}
                    item={item}
                    key={resourceKey(item)}
                    label={label}
                    moodleEmbed={moodleEmbedForResource(moodleEmbedByPath, item)}
                  />
                );
              })}
              {sectionDownloads.map((item) => (
                <ResourceActions
                  courseBaseUrl={courseBaseUrl}
                  courseCode={courseCode}
                  canShare={canShare}
                  item={item}
                  key={resourceKey(item)}
                  labelPrefix={isPlayableOnlyResource(item) || flowKeyForDownload(item) === "resources" ? undefined : roleLabel(item.role, t)}
                  moodleEmbed={moodleEmbedForResource(moodleEmbedByPath, item)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ActivityResourcePanel({
  lesson,
  courseBaseUrl,
  courseCode,
  canShare,
  moodleEmbedByPath,
  visibleDownloads,
  visibleTextExports,
  visibleISpring,
}: {
  lesson: Lesson;
  courseBaseUrl: string;
  courseCode: string;
  canShare: boolean;
  moodleEmbedByPath?: MoodleEmbedMap;
  visibleDownloads: FileResource[];
  visibleTextExports: FileResource[];
  visibleISpring: Lesson["ispring"];
}) {
  const { t } = usePortalI18n();
  const bookSections = visibleBookSectionsForLesson(lesson);
  const files = dedupeResources([...bookSections, ...visibleDownloads, ...visibleTextExports]);
  const totalItems = files.length + visibleISpring.length;

  if (!totalItems) {
    return <div className="empty-state">{t("empty.activityResources")}</div>;
  }

  return (
    <div className="activity-resource-list">
      {visibleISpring.map((item, index) => (
        <ISpringActions
          courseBaseUrl={courseBaseUrl}
          courseCode={courseCode}
          canShare={canShare}
          item={item}
          key={resourceKey(item)}
          label={visibleISpring.length > 1 ? t("lesson.activityPackageNumber", { number: index + 1 }) : t("lesson.activityPackage")}
          moodleEmbed={moodleEmbedForResource(moodleEmbedByPath, item)}
        />
      ))}
      {files.map((item) => (
        <ResourceActions
          courseBaseUrl={courseBaseUrl}
          courseCode={courseCode}
          canShare={canShare}
          item={item}
          key={resourceKey(item)}
          moodleEmbed={moodleEmbedForResource(moodleEmbedByPath, item)}
          showDownload={(item.type || "").toLowerCase() !== "html"}
        />
      ))}
    </div>
  );
}

function courseTitleLabel(course: CourseCatalogEntry): string {
  return course.title.startsWith(`${course.code} `) || course.title.startsWith(`${course.code} ·`)
    ? course.title
    : `${course.code} · ${course.title}`;
}

function courseStatusLabel(status: string | undefined, t: TFunction): string {
  const labels: Record<string, string> = {
    ready: t("course.status.ready"),
    "planning-only": t("course.status.planning-only"),
    "moodle-shell": t("course.status.moodle-shell"),
    "textbook-shell": t("course.status.textbook-shell"),
  };
  return labels[status || ""] || status || t("course.status.draft");
}

type CourseStructureLabels = {
  secondarySingular: string;
  secondaryPlural: string;
  secondaryPluralLower: string;
  secondaryKind: "lesson" | "activity";
  displayMode: "lesson" | "activity" | "hybrid";
};

function courseStructureLabels(manifest: CourseManifest, t: TFunction): CourseStructureLabels {
  const secondary = manifest.navigation?.secondary?.toLowerCase();
  const note = manifest.sourceAudit?.structureNote?.toLowerCase() || "";
  const activityBased = secondary === "activity" || note.includes("moodle course sections");
  const hasEnhancedUnitResources = manifest.units.some((unit) =>
    ["evaluations", "reflectionAndLogs"].some((key) => unitResourcesFor(unit, key).some(isTeacherVisibleResource)),
  );
  if (activityBased) {
    return {
      secondarySingular: t("label.activity"),
      secondaryPlural: t("label.activities"),
      secondaryPluralLower: t("label.activitiesLower"),
      secondaryKind: "activity",
      displayMode: "activity",
    };
  }
  return {
    secondarySingular: t("label.lesson"),
    secondaryPlural: t("label.lessons"),
    secondaryPluralLower: t("label.lessonsLower"),
    secondaryKind: "lesson",
    displayMode: hasEnhancedUnitResources ? "hybrid" : "lesson",
  };
}

function countLessons(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unit.lessons.length, 0);
}

function countIspringEntries(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unit.lessons.reduce((lessonSum, lesson) => lessonSum + lesson.ispring.length, 0), 0);
}

function countLocalResources(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unitLocalDownloadCount(unit), 0);
}

function isUnitOverviewLesson(lesson: Lesson): boolean {
  return lesson.planningStatus === "unit_overview";
}

function displayLessonId(id: string): string {
  return id.replace(/-\d+$/, "").replace(/^U0*(\d+)L0*(\d+)$/i, "U$1L$2");
}

function CourseMoodleSections({
  groups,
  courseBaseUrl,
  courseCode,
  canShare,
  units,
}: {
  groups: MoodleSectionGroup[];
  courseBaseUrl: string;
  courseCode: string;
  canShare: boolean;
  units: Unit[];
}) {
  const { t } = usePortalI18n();
  if (!groups.length) return null;
  const unitTitle = (unitNumber: number) => units.find((unit) => unit.unit === unitNumber)?.title || `Unit ${unitNumber}`;
  return (
    <section className="moodle-section-map" id="course-resources" aria-label="Course resource entry points">
      <div className="moodle-section-map-header">
        <div>
          <p className="eyebrow dark">{t("course.resources")}</p>
          <h3>{t("course.resourceEntry")}</h3>
        </div>
        <span>{groups.reduce((sum, group) => sum + group.items.length, 0)} {t("label.items")}</span>
      </div>
      <div className="moodle-section-groups">
        {groups.map((group) => (
          <article className="moodle-section-group" id={`moodle-${group.key}`} key={group.key}>
            <header>
              <div>
                <h4>{group.title}</h4>
                <p>{group.description}</p>
              </div>
              <strong>{group.items.length}</strong>
            </header>
            {group.key === "evaluation" ? (
              <div className="moodle-unit-subgroups">
                {resourcesByUnit(group.items).map((unitGroup) => (
                  <section className="moodle-unit-subgroup" key={unitGroup.unit}>
                    <div className="moodle-unit-subgroup-header">
                      <span>Unit {unitGroup.unit}</span>
                      <strong>{unitTitle(unitGroup.unit)}</strong>
                      <em>{unitGroup.items.length} {t("label.items")}</em>
                    </div>
                    <div className="moodle-section-items">
                      {unitGroup.items.map((item) => (
                        <ResourceActions
                          courseBaseUrl={courseBaseUrl}
                          courseCode={courseCode}
                          canShare={canShare}
                          item={item}
                          key={resourceKey(item)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="moodle-section-items">
                {group.items.map((item) => (
                  <ResourceActions
                    courseBaseUrl={courseBaseUrl}
                    courseCode={courseCode}
                    canShare={canShare}
                    item={item}
                    key={resourceKey(item)}
                  />
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function TeacherStartPanel({
  groups,
  manifest,
  structureLabels,
}: {
  groups: MoodleSectionGroup[];
  manifest: CourseManifest;
  structureLabels: CourseStructureLabels;
}) {
  const { t } = usePortalI18n();
  const groupedKeys = groupedResourceIdentitySet(groups);
  const visibleUngroupedCourseDownloads = manifest.courseDownloads.filter(
    (item) =>
      isTeacherVisibleResource(item) &&
      isCourseLevelResource(item) &&
      !isGroupedResource(item, groupedKeys) &&
      !isLegacyCourseShellResource(item, groups),
  );
  const courseResourceCount = groups.reduce((sum, group) => sum + group.items.length, 0) + visibleUngroupedCourseDownloads.length;
  const textCount = manifest.texts.length;
  const firstUnit = manifest.units[0];
  const actions = [
    {
      href: "#course-resources",
      short: t("course.quick.courseResources.short"),
      label: t("course.quick.courseResources.label"),
      meta: `${courseResourceCount} ${t("label.items")}`,
      detail: t("course.quick.courseResources.detail"),
    },
    {
      href: "#unit-roadmap",
      short: t("course.quick.units.short"),
      label: t("course.quick.units.label"),
      meta: `${manifest.units.length} ${t("label.units")}`,
      detail: t("course.quick.units.detail", {
        firstUnit: firstUnit ? `Unit ${firstUnit.unit}: ${firstUnit.title}` : "",
        secondaryPlural: structureLabels.secondaryPlural,
      }),
    },
    ...(textCount
      ? [
          {
            href: "#text-index",
            short: t("course.quick.texts.short"),
            label: t("course.quick.texts.label"),
            meta: `${textCount} ${t("label.items")}`,
            detail: t("course.quick.texts.detail"),
          },
        ]
      : []),
  ];
  return (
    <div className="teacher-start-panel" aria-label="Course quick navigation">
      {actions.map((action) => (
        <a className="teacher-start-action" href={action.href} key={action.label}>
          <span>{action.short}</span>
          <strong>{action.label}</strong>
          <em>{action.meta}</em>
          <p>{action.detail}</p>
        </a>
      ))}
    </div>
  );
}

function Overview({
  course,
  manifest,
  courseBaseUrl,
  canShare,
  structureLabels,
}: {
  course: CourseCatalogEntry;
  manifest: CourseManifest;
  courseBaseUrl: string;
  canShare: boolean;
  structureLabels: CourseStructureLabels;
}) {
  const { t } = usePortalI18n();
  const audit = manifest.sourceAudit || {};
  const moodleSectionGroups = buildCourseMoodleSectionGroups(manifest, t);
  const groupedKeys = groupedResourceIdentitySet(moodleSectionGroups);
  const visibleCourseDownloads = manifest.courseDownloads.filter(
    (item) =>
      isTeacherVisibleResource(item) &&
      isCourseLevelResource(item) &&
      !isGroupedResource(item, groupedKeys) &&
      !isLegacyCourseShellResource(item, moodleSectionGroups),
  );
  return (
    <section className="course-overview panel">
      <div className="overview-header">
        <div>
          <p className="eyebrow">{manifest.course.code}</p>
          <h2>{manifest.course.title}</h2>
          <p>{t("course.summary", { audience: manifest.course.audience, secondarySingular: structureLabels.secondarySingular })}</p>
          <p className="course-note">
            {course.level ? `${course.level} · ` : ""}
            {course.notes || manifest.course.source}
          </p>
        </div>
        <div className="overview-tags">
          <div className="tag text">Unit-first</div>
          <div className={`tag ${course.status === "ready" ? "text" : "warn"}`}>{courseStatusLabel(course.status, t)}</div>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <span>{t("label.units")}</span>
          <strong>{manifest.units.length}</strong>
        </div>
        <div className="stat">
          <span>{structureLabels.secondaryPlural}</span>
          <strong>{audit.lessonCount || 0}</strong>
        </div>
        <div className="stat">
          <span>iSpring</span>
          <strong>
            {audit.ispringComplete || 0}/{audit.ispringExpected || 0}
          </strong>
        </div>
        <div className="stat">
          <span>{t("label.resources")}</span>
          <strong>
            {audit.resourceCoverage?.uniqueCovered || 0}/{audit.resourceCoverage?.uniqueTotal || 0}
          </strong>
        </div>
        <div className="stat">
          <span>Validation</span>
          <strong>
            {audit.resourceValidation?.okCount || 0}/{audit.resourceValidation?.checkedCount || 0}
          </strong>
        </div>
      </div>
      <TeacherStartPanel groups={moodleSectionGroups} manifest={manifest} structureLabels={structureLabels} />
      <CourseMoodleSections
        canShare={canShare}
        courseBaseUrl={courseBaseUrl}
        courseCode={manifest.course.code}
        groups={moodleSectionGroups}
        units={manifest.units}
      />
      {visibleCourseDownloads.length ? (
        <div className="course-downloads">
          <h3>{t("course.otherFiles")}</h3>
          <div className="lesson-tools">
            {visibleCourseDownloads.map((item) => (
              <ResourceActions
                courseBaseUrl={courseBaseUrl}
                courseCode={manifest.course.code}
                canShare={canShare}
                item={item}
                key={resourceKey(item)}
                labelPrefix={roleLabel(item.role, t)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CourseSelector({
  catalog,
  selectedCourseCode,
  onSelect,
}: {
  catalog: CourseCatalog;
  selectedCourseCode: string;
  onSelect: (courseCode: string) => void;
}) {
  const { t } = usePortalI18n();
  return (
    <section className="course-selector">
      <label htmlFor="courseSelect">{t("course.label")}</label>
      <select id="courseSelect" onChange={(event) => onSelect(event.target.value)} value={selectedCourseCode}>
        {catalog.courses.map((course) => (
          <option key={course.code} value={course.code}>
            {courseTitleLabel(course)}
          </option>
        ))}
      </select>
    </section>
  );
}

function CurrentCourseCard({ course, manifest }: { course: CourseCatalogEntry; manifest?: CourseManifest | null }) {
  const { t } = usePortalI18n();
  return (
    <section className="current-course-card">
      <span>{t("course.current")}</span>
      <strong>{course.code}</strong>
      <p>{course.title}</p>
      {manifest ? (
        <div className="current-course-stats">
          <span>{manifest.units.length} {t("label.units")}</span>
          <span>{countLessons(manifest.units)} {t("label.lessons")}</span>
          <span>{countIspringEntries(manifest.units)} iSpring</span>
          <span>{countLocalResources(manifest.units)} {t("label.files")}</span>
        </div>
      ) : null}
    </section>
  );
}

function UnitRoadmap({
  units,
  selectedUnit,
  query,
  onSelect,
  structureLabels,
}: {
  units: Unit[];
  selectedUnit: number;
  query: string;
  onSelect: (unit: number) => void;
  structureLabels: CourseStructureLabels;
}) {
  const { t } = usePortalI18n();
  return (
    <section className="unit-roadmap panel" id="unit-roadmap" aria-label="Course unit roadmap">
      <div className="unit-roadmap-header">
        <div>
          <p className="eyebrow dark">{t("unit.roadmap")}</p>
          <h2>{t("unit.roadmapTitle")}</h2>
          <p>
            {structureLabels.secondaryKind === "activity"
              ? t("unit.roadmapActivityHelp")
              : t("unit.roadmapLessonHelp")}
          </p>
        </div>
        <span>{units.length} {t("label.units")}</span>
      </div>
      <div className="unit-roadmap-grid">
        {units.map((unit) => {
          const visibleCount = unit.lessons.filter((lesson) => lessonMatches(lesson, query)).length;
          return (
            <button
              className={`unit-roadmap-card ${unit.unit === selectedUnit ? "active" : ""}`}
              key={unit.unit}
              onClick={() => onSelect(unit.unit)}
              type="button"
            >
              <span>U{unit.unit}</span>
              <strong>{unit.title}</strong>
              <p>
                {visibleCount}/{unit.lessons.length} {structureLabels.secondaryPluralLower} · {unit.summary.ispring} iSpring ·{" "}
                {unitLocalDownloadCount(unit)} {t("label.files")}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function UnitNav({
  units,
  selectedUnit,
  query,
  onSelect,
  structureLabels,
}: {
  units: Unit[];
  selectedUnit: number;
  query: string;
  onSelect: (unit: number) => void;
  structureLabels: CourseStructureLabels;
}) {
  const { t } = usePortalI18n();
  return (
    <nav className="unit-nav" aria-label="Unit navigation">
      {units.map((unit) => {
        const visibleCount = unit.lessons.filter((lesson) => lessonMatches(lesson, query)).length;
        return (
          <button
            className={`unit-button ${unit.unit === selectedUnit ? "active" : ""}`}
            key={unit.unit}
            onClick={() => onSelect(unit.unit)}
            type="button"
          >
            <span className="unit-number">U{unit.unit}</span>
            <span>
              <span className="unit-title">{unit.title}</span>
              <span className="unit-meta">
                {visibleCount}/{unit.lessons.length} {structureLabels.secondaryPluralLower} · {unitLocalDownloadCount(unit)} {t("label.files")}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function LessonRow({
  lesson,
  defaultOpen,
  courseBaseUrl,
  courseCode,
  canShare,
  moodleEmbedByPath,
  structureLabels,
}: {
  lesson: Lesson;
  defaultOpen: boolean;
  courseBaseUrl: string;
  courseCode: string;
  canShare: boolean;
  moodleEmbedByPath?: MoodleEmbedMap;
  structureLabels: CourseStructureLabels;
}) {
  const { t } = usePortalI18n();
  const [open, setOpen] = useState(defaultOpen);
  const visibleDownloads = visibleLessonDownloadsForLesson(lesson);
  const visibleTextExports = lesson.textExports.filter(isTeacherVisibleResource);
  const visibleISpring = lesson.ispring.filter(isVisibleISpringEntry);
  const visibleBookPageCount = lesson.bookSections?.length ? visibleBookSectionsForLesson(lesson).length : lesson.bookPageCount;
  const unitOverview = isUnitOverviewLesson(lesson);

  return (
    <article className={`lesson-row ${open ? "open" : ""}`}>
      <button className="lesson-summary" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="lesson-code">
          {structureLabels.secondaryKind === "activity" ? `A${lesson.lesson}` : displayLessonId(lesson.id)}
        </span>
        <span className="lesson-summary-content">
          <span className="lesson-title">{lesson.title}</span>
          <span className="lesson-counts">
            {structureLabels.secondaryKind === "lesson" ? <span className="count-chip">{visibleBookPageCount} {t("label.bookPages")}</span> : null}
            {visibleISpring.length ? <span className="count-chip">{visibleISpring.length} iSpring</span> : null}
            <span className="count-chip">{lessonLocalDownloadCount(lesson)} {t("label.resources")}</span>
            {structureLabels.secondaryKind === "lesson" ? (
              <span className={`count-chip ${lesson.lessonPlan ? "ready" : unitOverview ? "" : "pending"}`}>
                {lesson.lessonPlan ? t("label.planReady") : unitOverview ? t("label.unitSlot") : t("label.planPending")}
              </span>
            ) : null}
          </span>
        </span>
        <span className="expand-icon">{open ? "-" : "+"}</span>
      </button>
      <div className="lesson-body">
        <div className="lesson-tools">
          {structureLabels.secondaryKind === "activity" ? (
            <span className="tag text">{t("label.moodleActivity")}</span>
          ) : lesson.lessonPlan ? (
            <ResourceActions
              courseBaseUrl={courseBaseUrl}
              courseCode={courseCode}
              canShare={canShare}
              item={lesson.lessonPlan}
              labelPrefix={t("label.lessonPlan")}
              variant="plan"
            />
          ) : unitOverview ? (
            <span className="tag text">{t("label.unitLevelISpringSlot")}</span>
          ) : (
            <span className="tag warn">{t("label.planPending")}</span>
          )}
        </div>
        {structureLabels.displayMode === "activity" ? (
          <ActivityResourcePanel
            courseBaseUrl={courseBaseUrl}
            courseCode={courseCode}
            canShare={canShare}
            lesson={lesson}
            moodleEmbedByPath={moodleEmbedByPath}
            visibleDownloads={visibleDownloads}
            visibleISpring={visibleISpring}
            visibleTextExports={visibleTextExports}
          />
        ) : (
          <LessonFlowPanel
            courseBaseUrl={courseBaseUrl}
            courseCode={courseCode}
            canShare={canShare}
            lesson={lesson}
            moodleEmbedByPath={moodleEmbedByPath}
            visibleDownloads={visibleDownloads}
            visibleISpring={visibleISpring}
            visibleTextExports={visibleTextExports}
          />
        )}
      </div>
    </article>
  );
}

function UnitMoodleResources({
  unit,
  courseBaseUrl,
  courseCode,
  canShare,
}: {
  unit: Unit;
  courseBaseUrl: string;
  courseCode: string;
  canShare: boolean;
}) {
  const { t } = usePortalI18n();
  const groups = [
    {
      key: "evaluations",
      title: "Evaluation",
      description: t("unit.resources.evaluations.description"),
      items: unitResourcesFor(unit, "evaluations"),
    },
    {
      key: "reflectionAndLogs",
      title: "Reflection / Learning Log",
      description: t("unit.resources.reflection.description"),
      items: unitResourcesFor(unit, "reflectionAndLogs"),
    },
  ].filter((group) => group.items.some(isTeacherVisibleResource));

  if (!groups.length) return null;

  return (
    <div className="unit-moodle-resources">
      {groups.map((group) => (
        <section className="unit-moodle-resource-group" key={group.key}>
          <header>
            <div>
              <span>{group.title}</span>
              <p>{group.description}</p>
            </div>
            <strong>{group.items.length}</strong>
          </header>
          <div className="moodle-section-items">
            {group.items.filter(isTeacherVisibleResource).map((item) => (
              <ResourceActions
                courseBaseUrl={courseBaseUrl}
                courseCode={courseCode}
                canShare={canShare}
                item={item}
                key={resourceKey(item)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function UnitDetail({
  unit,
  texts,
  query,
  courseBaseUrl,
  courseCode,
  canShare,
  moodleEmbedByPath,
  structureLabels,
}: {
  unit: Unit;
  texts: TextRegistryEntry[];
  query: string;
  courseBaseUrl: string;
  courseCode: string;
  canShare: boolean;
  moodleEmbedByPath?: MoodleEmbedMap;
  structureLabels: CourseStructureLabels;
}) {
  const { t } = usePortalI18n();
  const visibleLessons = unit.lessons.filter((lesson) => lessonMatches(lesson, query));
  const textTags = unit.coreTexts
    .map((id) => texts.find((text) => text.id === id))
    .filter((text): text is TextRegistryEntry => Boolean(text));
  const structuredUnit = structureLabels.displayMode !== "activity";
  const enhancedUnitResources = structureLabels.displayMode === "hybrid";
  const hasUnitActions = textTags.length > 0 || Boolean(unit.unitPlan) || structuredUnit;

  return (
    <section className="unit-detail panel">
      <div className="unit-heading">
        <p className="eyebrow">Unit {unit.unit}</p>
        <h2>{unit.title}</h2>
        <p>
          {unit.lessons.length} {structureLabels.secondaryPluralLower} · {unit.summary.ispring} {t("label.iSpringModules")} ·{" "}
          {unitLocalDownloadCount(unit)} {t("label.downloadableResources")}
        </p>
        {hasUnitActions ? (
          <div className="unit-actions">
            {textTags.length ? textTags.map((text) => <span className="tag text" key={text.id}>{text.title}</span>) : structuredUnit ? <span className="tag warn">{t("label.noCoreText")}</span> : null}
            {unit.unitPlan ? (
              <ResourceActions
                courseBaseUrl={courseBaseUrl}
                courseCode={courseCode}
                canShare={canShare}
                item={unit.unitPlan}
                labelPrefix={t("label.unitPlan")}
                variant="plan"
              />
            ) : structuredUnit ? (
              <span className="tag warn">{t("label.unitPlanPending")}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      {enhancedUnitResources ? <UnitMoodleResources courseBaseUrl={courseBaseUrl} courseCode={courseCode} canShare={canShare} unit={unit} /> : null}
      <div className="lesson-list">
        {visibleLessons.length ? (
          visibleLessons.map((lesson, index) => (
            <LessonRow
              courseBaseUrl={courseBaseUrl}
              courseCode={courseCode}
              canShare={canShare}
              defaultOpen={index === 0}
              key={lesson.id}
              lesson={lesson}
              moodleEmbedByPath={moodleEmbedByPath}
              structureLabels={structureLabels}
            />
          ))
        ) : (
          <div className="empty-state">
            {query
              ? t("empty.unitSearch", { secondaryPluralLower: structureLabels.secondaryPluralLower })
              : t("empty.unitNoResources", { secondarySingular: structureLabels.secondarySingular })}
          </div>
        )}
      </div>
    </section>
  );
}

function TextIndex({
  courseBaseUrl,
  courseCode,
  canShare,
  texts,
}: {
  courseBaseUrl: string;
  courseCode: string;
  canShare: boolean;
  texts: TextRegistryEntry[];
}) {
  const { t } = usePortalI18n();
  if (!texts.length) return null;
  return (
    <section className="text-index panel" id="text-index">
      <h2>{t("text.index")}</h2>
      <div className="text-grid">
        {texts.map((text) => (
          <article className="text-row" key={text.id}>
            <h3>{text.title}</h3>
            <p>
              {text.author} · Unit {text.units.join(", ")}
            </p>
            <p>{text.notes}</p>
            {text.materials.length > 0 && (
              <div className="text-materials">
                {text.materials.map((item) => (
                  <ResourceActions
                    courseBaseUrl={courseBaseUrl}
                    courseCode={courseCode}
                    canShare={canShare}
                    item={item}
                    key={resourceKey(item)}
                  />
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function CompactTextIndex({ texts }: { texts: TextRegistryEntry[] }) {
  const { t } = usePortalI18n();
  if (!texts.length) return null;
  return (
    <section className="text-index-compact">
      <h2>{t("text.core")}</h2>
      {texts.map((text) => (
        <div className="compact-text" key={text.id}>
          <strong>{text.title}</strong>
          {text.materials.length > 0 && (
            <span>
              {text.materials.length} {text.materials.length === 1 ? t("label.file") : t("label.files")}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

function App() {
  const [locale, setLocale] = useState<PortalLocale>(() => detectInitialLocale());
  const [catalog, setCatalog] = useState<CourseCatalog | null>(null);
  const [portalSession, setPortalSession] = useState<PortalSession | null>(null);
  const [selectedCourseCode, setSelectedCourseCode] = useState(FALLBACK_COURSE.code);
  const [manifest, setManifest] = useState<CourseManifest | null>(null);
  const [moodleEmbedRows, setMoodleEmbedRows] = useState<MoodleEmbedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState(1);
  const [query, setQuery] = useState("");
  const t = useMemo<TFunction>(() => (key, params) => translate(locale, key, params), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "zh-CN" ? "OSSD 课程资源门户" : "OSSD Course Portal";
    storeLocale(locale);
  }, [locale]);

  useEffect(() => {
    fetch("/api/portal/session", { credentials: "same-origin" })
      .then((response) => response.json() as Promise<{ loginEnabled: boolean } & PortalSession>)
      .then((data) => {
        if (data.loginEnabled && !data.authenticated) {
          window.location.href = "/login";
          return;
        }
        setPortalSession({
          authenticated: data.authenticated,
          username: data.username,
          displayName: data.displayName,
          role: data.role,
          courses: data.courses || [],
        });
      })
      .catch(() => setPortalSession(null));
  }, []);

  useEffect(() => {
    fetch(CATALOG_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
        return response.json() as Promise<CourseCatalog>;
      })
      .then((data) => {
        const courses = sortCatalogCourses(data.courses || []);
        const requestedCourseCode = requestedCourseCodeFromUrl();
        const initialCourseCode =
          requestedCourseCode && courses.some((course) => course.code === requestedCourseCode)
            ? requestedCourseCode
            : data.defaultCourse || courses[0]?.code || FALLBACK_COURSE.code;
        setCatalog({ ...data, courses });
        setSelectedCourseCode(initialCourseCode);
      })
      .catch(() => {
        setCatalog({
          schemaVersion: 1,
          defaultCourse: FALLBACK_COURSE.code,
          courses: [FALLBACK_COURSE],
        });
        setSelectedCourseCode(FALLBACK_COURSE.code);
      });
  }, []);

  const selectedCourse = useMemo(() => {
    return catalog?.courses.find((course) => course.code === selectedCourseCode) || catalog?.courses[0] || FALLBACK_COURSE;
  }, [catalog, selectedCourseCode]);

  useEffect(() => {
    if (!catalog || !selectedCourse) return;
    const controller = new AbortController();
    setManifest(null);
    setMoodleEmbedRows([]);
    setError(null);
    fetch(selectedCourse.manifestUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
        return response.json() as Promise<CourseManifest>;
      })
      .then((data) => {
        setManifest(data);
        setSelectedUnit(data.units[0]?.unit ?? 1);
        setQuery("");
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "Unknown manifest error");
      });

    return () => controller.abort();
  }, [catalog, selectedCourse]);

  useEffect(() => {
    if (!manifest || !canGenerateMoodleEmbeds(portalSession)) {
      setMoodleEmbedRows([]);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ course: manifest.course.code });
    fetch(`/api/portal/moodle-embeds?${params.toString()}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Moodle embed request failed: ${response.status}`);
        return response.json() as Promise<{ ok: boolean; rows?: MoodleEmbedRow[] }>;
      })
      .then((data) => {
        setMoodleEmbedRows(data.ok ? data.rows || [] : []);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setMoodleEmbedRows([]);
      });

    return () => controller.abort();
  }, [manifest, portalSession]);

  const normalizedQuery = useMemo(() => normalizeQuery(query), [query]);
  const unit = manifest?.units.find((item) => item.unit === selectedUnit) ?? manifest?.units[0];
  const structureLabels = manifest ? courseStructureLabels(manifest, t) : null;
  const adminCanShare = canGenerateMoodleEmbeds(portalSession);
  const moodleEmbedByPath = useMemo(() => {
    const rowsByPath: MoodleEmbedMap = new Map();
    for (const row of moodleEmbedRows) {
      if (row.path) rowsByPath.set(row.path, row);
      if (row.fileUrl) rowsByPath.set(row.fileUrl, row);
      if (row.embedUrl) rowsByPath.set(row.embedUrl, row);
    }
    return rowsByPath;
  }, [moodleEmbedRows]);

  const handleCourseSelect = (courseCode: string) => {
    const normalizedCourseCode = courseCode.trim().toUpperCase();
    setSelectedCourseCode(normalizedCourseCode);
    const params = new URLSearchParams(window.location.search);
    params.set("course", normalizedCourseCode);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  const handleLogout = async () => {
    await fetch("/api/portal/logout", { credentials: "same-origin", method: "POST" });
    window.location.href = "/login";
  };

  return (
    <PortalI18nProvider locale={locale} setLocale={setLocale}>
      <header className="topbar">
        <div>
          <p className="eyebrow">SunnyBrook OSSD</p>
          <h1>{t("app.title")}</h1>
        </div>
        <div className="topbar-actions">
          <LanguageSwitcher />
          {portalSession?.authenticated ? (
            <>
              <span className="user-chip">
                {portalSession.displayName || portalSession.username}
                {portalSession.displayName && portalSession.username ? ` · ${portalSession.username}` : ""}
                {portalSession.role ? ` · ${portalSession.role}` : ""}
              </span>
              <button className="admin-entry logout-button" onClick={handleLogout} type="button">
                {t("action.logout")}
              </button>
            </>
          ) : null}
          {canOpenAdminBackend(portalSession) ? (
            <a className="admin-entry" href="/teacher-admin" rel="noopener" target="_blank">
              {t("action.admin")}
            </a>
          ) : null}
          <div className={`status-pill ${error ? "error" : ""}`}>
            {error ? t("status.manifestError") : manifest ? t("status.loaded", { course: manifest.course.code }) : t("status.loadingCourse")}
          </div>
        </div>
      </header>
      <main className="shell">
        <aside className="sidebar" aria-label="Course navigation">
          {catalog ? (
            <CourseSelector
              catalog={catalog}
              onSelect={handleCourseSelect}
              selectedCourseCode={selectedCourse.code}
            />
          ) : null}
          <CurrentCourseCard course={selectedCourse} manifest={manifest} />
          <div className="search-box">
            <label htmlFor="searchInput">{t("search.label")}</label>
            <input
              id="searchInput"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search.placeholder")}
              type="search"
              value={query}
            />
          </div>
          {manifest ? (
            <>
              <UnitNav
                onSelect={setSelectedUnit}
                query={normalizedQuery}
                selectedUnit={selectedUnit}
                structureLabels={structureLabels || courseStructureLabels(manifest, t)}
                units={manifest.units}
              />
              <CompactTextIndex texts={manifest.texts} />
            </>
          ) : null}
        </aside>
        <section className="content">
          {error ? (
            <section className="course-overview panel error">
              <div className="empty-state">{t("empty.manifest")}</div>
            </section>
          ) : null}
          {manifest && unit && structureLabels ? (
            <>
              <Overview
                canShare={adminCanShare}
                course={selectedCourse}
                courseBaseUrl={selectedCourse.baseUrl}
                manifest={manifest}
                structureLabels={structureLabels}
              />
              <UnitRoadmap
                onSelect={setSelectedUnit}
                query={normalizedQuery}
                selectedUnit={selectedUnit}
                structureLabels={structureLabels}
                units={manifest.units}
              />
              <UnitDetail
                canShare={adminCanShare}
                courseBaseUrl={selectedCourse.baseUrl}
                courseCode={manifest.course.code}
                moodleEmbedByPath={moodleEmbedByPath}
                query={normalizedQuery}
                structureLabels={structureLabels}
                texts={manifest.texts}
                unit={unit}
              />
              <TextIndex
                canShare={adminCanShare}
                courseBaseUrl={selectedCourse.baseUrl}
                courseCode={manifest.course.code}
                texts={manifest.texts}
              />
            </>
          ) : null}
          {manifest && !unit ? (
            <section className="course-overview panel">
              <div className="empty-state">{t("empty.courseEstablished")}</div>
            </section>
          ) : null}
        </section>
      </main>
    </PortalI18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
