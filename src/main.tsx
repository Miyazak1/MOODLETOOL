import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import type {
  CourseCatalog,
  CourseCatalogEntry,
  CourseManifest,
  CourseRoadmap,
  CourseRoadmapEntry,
  FileResource,
  Lesson,
  MoodleEmbedRow,
  TextRegistryEntry,
  Unit,
} from "./types";

const CATALOG_URL = import.meta.env.VITE_COURSE_CATALOG_URL || "/course-catalog.json";
const COURSE_ROADMAP_URL = import.meta.env.VITE_COURSE_ROADMAP_URL || "/course-roadmap.json";
type PortalSession = {
  authenticated: boolean;
  username: string | null;
  role: string | null;
  courses: string[];
};

type MoodleEmbedMap = Map<string, MoodleEmbedRow>;

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
  source?: string;
  bytes?: number;
};

function resourceHref(item: LinkableResource, baseUrl: string): string {
  if (item.path) return resourceUrl(item.path, baseUrl);
  if (item.url) return item.url;
  return "#";
}

function resourcePreviewHref(item: LinkableResource, baseUrl: string): string {
  if (item.previewPath) return resourceUrl(item.previewPath, baseUrl);
  if (item.previewUrl) return item.previewUrl;
  return resourceHref(item, baseUrl);
}

function resourceKey(item: LinkableResource): string {
  return item.path || item.url || item.previewPath || item.previewUrl || item.label;
}

function hasLocalResource(item: LinkableResource): boolean {
  return Boolean(item.path || item.previewPath);
}

function isExternalOnlyResource(item: LinkableResource): boolean {
  return !hasLocalResource(item) && Boolean(item.url || item.previewUrl);
}

function isTeacherVisibleResource(item: LinkableResource): boolean {
  return hasLocalResource(item);
}

function isCourseLevelResource(item: LinkableResource): boolean {
  const role = (item.role || "").toLowerCase();
  const category = (item.category || "").toLowerCase();
  return (
    role === "course_outline" ||
    role === "course_outline_copy" ||
    role === "course_document" ||
    role === "course_resource" ||
    role === "unit_plan_bundle" ||
    category === "course_document" ||
    category === "course_resource"
  );
}

function localDownloadCount(items: LinkableResource[] = []): number {
  return items.filter(isTeacherVisibleResource).length;
}

function lessonLocalDownloadCount(lesson: Lesson): number {
  const downloads = dedupeResources(lesson.downloads || []);
  return localDownloadCount([...downloads, ...visibleBookSectionsForLesson(lesson)]);
}

function unitLocalDownloadCount(unit: Unit): number {
  return unit.lessons.reduce((sum, lesson) => sum + lessonLocalDownloadCount(lesson), 0);
}

function localOpenProps(item: LinkableResource, baseUrl: string) {
  return { href: resourcePreviewHref(item, baseUrl), rel: "noopener", target: "_blank" };
}

function localDownloadProps(item: LinkableResource, baseUrl: string) {
  const href = resourceHref(item, baseUrl);
  return item.path ? { download: true, href } : { href, rel: "noopener", target: "_blank" };
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
  if (!row?.moodleHtml) return null;

  const copy = async () => {
    await copyText(row.moodleHtml);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button className="button-link moodle-copy" onClick={copy} title="复制可粘贴到 Moodle HTML/source 编辑器的代码" type="button">
      {copied ? "已复制" : "代码"}
    </button>
  );
}

function ResourceActions({
  item,
  courseBaseUrl,
  displayLabel,
  labelPrefix,
  variant,
  moodleEmbed,
  showDownload = true,
}: {
  item: LinkableResource;
  courseBaseUrl: string;
  displayLabel?: string;
  labelPrefix?: string;
  variant?: string;
  moodleEmbed?: MoodleEmbedRow;
  showDownload?: boolean;
}) {
  if (!isTeacherVisibleResource(item)) return null;

  const title = displayLabel
    ? displayLabel
    : labelPrefix && !item.label.toLowerCase().startsWith(`${labelPrefix.toLowerCase()} -`) && item.label.toLowerCase() !== labelPrefix.toLowerCase()
      ? `${labelPrefix} · ${item.label}`
      : item.label;

  return (
    <span className={`resource-actions resource-card ${variant || ""}`}>
      <span className="resource-card-main">
        <span className="resource-card-label">{title}</span>
        {item.type ? <span className="resource-card-meta">{item.type.toUpperCase()}</span> : null}
      </span>
      <span className="resource-card-actions">
        <a className="button-link view" {...localOpenProps(item, courseBaseUrl)}>
          查看
        </a>
        {showDownload && (
          <a className="button-link download" {...localDownloadProps(item, courseBaseUrl)}>
            下载
          </a>
        )}
        <MoodleEmbedButton row={moodleEmbed} />
      </span>
    </span>
  );
}

function ISpringActions({
  item,
  courseBaseUrl,
  label,
  moodleEmbed,
}: {
  item: Lesson["ispring"][number];
  courseBaseUrl: string;
  label: string;
  moodleEmbed?: MoodleEmbedRow;
}) {
  const externalOnly = item.mode === "external" || Boolean(item.url && !item.path);
  if (externalOnly) return null;
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
        path: item.path,
        url: item.url,
      }
    : null;

  if (!playItem && !downloadItem) return null;

  return (
    <span className="resource-actions resource-card featured ispring-card">
      <span className="resource-card-main">
        <span className="resource-card-label">
          {label}
          {item.slideCount ? ` · ${item.slideCount} slides` : ""}
          {item.videoSegmentCount ? ` · ${item.videoSegmentCount} videos` : ""}
        </span>
        <span className="resource-card-meta">iSpring</span>
      </span>
      <span className="resource-card-actions">
      {playItem ? (
        <a className="button-link ispring" {...localOpenProps(playItem, courseBaseUrl)}>
          播放课件
        </a>
      ) : null}
      {downloadItem ? (
        <a className="button-link download" {...localDownloadProps(downloadItem, courseBaseUrl)}>
          下载包
        </a>
      ) : null}
      <MoodleEmbedButton row={moodleEmbed} />
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

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    overview: "Lesson Expectations",
    lesson: "Lesson",
    handsOn: "Hands On",
    hands_on: "Hands On",
    homework: "Homework",
    consolidation: "Consolidation",
    teacher_notes: "Teacher Notes",
    lesson_book: "Lesson Book",
    lesson_book_section: "Lesson Book Section",
    course_outline: "Course Outline",
    introduction: "Lesson Expectations",
    course_document: "Course Document",
    core_text: "Core Text",
    plan: "Plan",
    download: "Downloads",
    h5p: "H5P",
    video: "Video",
    other: "Other",
  };
  return labels[role] || role.replaceAll("_", " ");
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    public_domain: "Public domain",
    copyrighted: "Copyrighted",
    downloadable: "Downloadable",
    school_licensed: "School licensed",
    link_only: "Link only",
    needs_review: "Needs review",
    pending_download: "Pending download",
    unavailable: "Unavailable",
  };
  return labels[status] || status || "Unknown";
}

function textMaterialStatus(text: TextRegistryEntry): string {
  if (text.materials.length) return "downloadable";
  return text.sourceStatus || "pending_download";
}

function textMaterialStatusLabel(text: TextRegistryEntry): string {
  if (text.materials.length) return "Downloadable";
  return statusLabel(text.sourceStatus || "pending_download");
}

function missingTextMessage(text: TextRegistryEntry): string {
  if (text.sourceStatus === "unavailable") return "No source-text file available in local/Moodle resources.";
  return "No downloadable text file added yet.";
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
  { key: "expectations", label: "Lesson Expectations", roles: ["expectations", "introduction", "overview"] },
  { key: "lesson", label: "Lesson", roles: ["lesson"] },
  { key: "resources", label: "Files / Activities", roles: ["resource", "resources", "activity", "activities", "download"] },
  { key: "handsOn", label: "Hands On", roles: ["handsOn", "hands_on"] },
  { key: "consolidation", label: "Consolidation", roles: ["consolidation"] },
  { key: "homework", label: "Homework", roles: ["homework"] },
] as const;

function flowKeyForRole(role?: string): string {
  const normalized = role || "other";
  const match = LESSON_FLOW.find((section) => (section.roles as readonly string[]).includes(normalized));
  return match?.key || "other";
}

function downloadFlowKey(item: LinkableResource): string {
  const role = item.role || "download";
  const category = (item.category || "").toLowerCase();
  if (role === "lesson") return "lesson";
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
  return flowKeyForRole(role);
}

function flowLabelForKey(key: string): string {
  return LESSON_FLOW.find((section) => section.key === key)?.label || roleLabel(key);
}

function flowGuideForKey(key: string): string {
  const guides: Record<string, string> = {
    expectations: "先看本节学习目标和成功标准，确认老师备课时要覆盖的重点。",
    lesson: "课堂主体内容。这里通常包含 Moodle lesson 说明、iSpring 课件和直接配套文件。",
    resources: "本节配套文件、活动表、外部资源本地化副本等，适合课前整理。",
    handsOn: "练习、测验或课堂活动。能在线播放的活动会放在这里，文件可下载备用。",
    consolidation: "巩固环节、总结视频、H5P 或 exit activity，适合课尾复盘。",
    homework: "课后作业、提交说明和学生需要完成的材料。",
  };
  return guides[key] || "本节其他可用资源。";
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
  moodleEmbedByPath,
  visibleDownloads,
  visibleTextExports,
  visibleISpring,
}: {
  lesson: Lesson;
  courseBaseUrl: string;
  moodleEmbedByPath?: MoodleEmbedMap;
  visibleDownloads: FileResource[];
  visibleTextExports: FileResource[];
  visibleISpring: Lesson["ispring"];
}) {
  const bookSections = visibleBookSectionsForLesson(lesson);
  const regularDownloads = dedupeResources(
    visibleDownloads.filter((item) => {
      if (item.role === "lesson_book" || item.role === "lesson_book_section") return false;
      return true;
    }),
  );
  const orderedKeys = LESSON_FLOW.map((section) => section.key);

  const sectionHasContent = (key: string) => {
    if (bookSections.some((item) => bookSectionFlowKey(item) === key)) return true;
    if (regularDownloads.some((item) => downloadFlowKey(item) === key)) return true;
    if (visibleISpring.some((item) => ispringFlowKey(item) === key)) return true;
    return false;
  };

  const keys = orderedKeys.filter(sectionHasContent);

  if (!keys.length) {
    return <div className="empty-state">No local downloadable resources indexed for this lesson yet.</div>;
  }

  return (
    <div className="lesson-flow">
      {keys.map((key) => {
        const sectionBookPages = bookSections.filter((item) => bookSectionFlowKey(item) === key);
        const sectionDownloads = regularDownloads.filter((item) => downloadFlowKey(item) === key);
        const sectionISpring = visibleISpring.filter((item) => ispringFlowKey(item) === key);
        return (
          <section className="lesson-flow-section" key={key}>
            <header>
              <div>
                <span>{flowLabelForKey(key)}</span>
                <p>{flowGuideForKey(key)}</p>
              </div>
              <strong>
                {sectionBookPages.length + sectionDownloads.length + sectionISpring.length} item
                {sectionBookPages.length + sectionDownloads.length + sectionISpring.length === 1 ? "" : "s"}
              </strong>
            </header>
            <div className="lesson-flow-items">
              {sectionBookPages.map((item) => (
                <ResourceActions
                  courseBaseUrl={courseBaseUrl}
                  displayLabel={item.label || item.sectionLabel || flowLabelForKey(bookSectionFlowKey(item))}
                  item={item}
                  key={resourceKey(item)}
                  moodleEmbed={item.path ? moodleEmbedByPath?.get(item.path) : undefined}
                  showDownload={false}
                />
              ))}
              {sectionISpring.map((item, index) => {
                const label = sectionISpring.length > 1 ? `Lesson ${index + 1}` : "Lesson";
                return (
                  <ISpringActions
                    courseBaseUrl={courseBaseUrl}
                    item={item}
                    key={resourceKey(item)}
                    label={label}
                    moodleEmbed={item.path ? moodleEmbedByPath?.get(item.path) : undefined}
                  />
                );
              })}
              {sectionDownloads.map((item) => (
                <ResourceActions
                  courseBaseUrl={courseBaseUrl}
                  item={item}
                  key={resourceKey(item)}
                  labelPrefix={downloadFlowKey(item) === "resources" ? undefined : roleLabel(item.role)}
                  moodleEmbed={item.path ? moodleEmbedByPath?.get(item.path) : undefined}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function courseTitleLabel(course: CourseCatalogEntry): string {
  return course.title.startsWith(`${course.code} `) || course.title.startsWith(`${course.code} ·`)
    ? course.title
    : `${course.code} · ${course.title}`;
}

function courseStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    ready: "Ready",
    "planning-only": "Planning only",
    "moodle-shell": "Source shell",
    "textbook-shell": "Textbook shell",
  };
  return labels[status || ""] || status || "Draft";
}

function countLessons(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unit.lessons.length, 0);
}

function countLessonPlans(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unit.lessons.filter((lesson) => needsLessonPlan(lesson) && lesson.lessonPlan).length, 0);
}

function countIspringEntries(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unit.lessons.reduce((lessonSum, lesson) => lessonSum + lesson.ispring.length, 0), 0);
}

function countLocalResources(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unitLocalDownloadCount(unit), 0);
}

function needsLessonPlan(lesson: Lesson): boolean {
  return lesson.planningStatus !== "unit_overview";
}

function isUnitOverviewLesson(lesson: Lesson): boolean {
  return lesson.planningStatus === "unit_overview";
}

function countLessonsRequiringPlans(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + unit.lessons.filter(needsLessonPlan).length, 0);
}

function hasCourseDownload(manifest: CourseManifest, role: string): boolean {
  return manifest.courseDownloads.some((item) => item.role === role);
}

function readinessItems(course: CourseCatalogEntry, manifest: CourseManifest) {
  const units = manifest.units.length;
  const unitPlans = manifest.units.filter((unit) => unit.unitPlan).length;
  const lessons = countLessons(manifest.units);
  const lessonsRequiringPlans = countLessonsRequiringPlans(manifest.units);
  const lessonPlans = countLessonPlans(manifest.units);
  const ispring = countIspringEntries(manifest.units);
  const expectedIspring = manifest.sourceAudit?.ispringExpected ?? 0;
  const iSpringRequired = course.status === "ready" || expectedIspring > 0;

  return [
    {
      label: "Course Outline",
      detail: hasCourseDownload(manifest, "course_outline") ? "Ready" : "Missing",
      ready: hasCourseDownload(manifest, "course_outline"),
    },
    {
      label: "Introduction",
      detail: hasCourseDownload(manifest, "introduction") ? "Ready" : "Missing",
      ready: hasCourseDownload(manifest, "introduction"),
    },
    {
      label: "Unit Plans",
      detail: `${unitPlans}/${units}`,
      ready: units > 0 && unitPlans === units,
    },
    {
      label: "Lesson Plans",
      detail: `${lessonPlans}/${lessonsRequiringPlans}`,
      ready: lessonsRequiringPlans === 0 || lessonPlans === lessonsRequiringPlans,
    },
    {
      label: "iSpring",
      detail: iSpringRequired ? `${ispring}/${expectedIspring || ispring}` : "Not connected",
      ready: iSpringRequired ? ispring > 0 && (!expectedIspring || ispring === expectedIspring) : false,
      optional: !iSpringRequired,
    },
  ];
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    "ready-maintenance": "Ready maintenance",
    "planning-course-enrichment": "Planning enrichment",
    "source-discovery": "Source discovery",
    "moodle-shell-fill": "Source shell fill",
    "textbook-shell-fill": "Textbook shell fill",
  };
  return labels[phase] || phase || "Roadmap";
}

function CourseRoadmapPanel({ item }: { item?: CourseRoadmapEntry }) {
  if (!item) return null;
  return (
    <div className="course-roadmap">
      <div className="course-roadmap-header">
        <h3>下一步路线图</h3>
        <span>{phaseLabel(item.phase)}</span>
      </div>
      <div className="roadmap-metrics">
        <div>
          <span>Priority</span>
          <strong>{item.priority}</strong>
        </div>
        <div>
          <span>Outline</span>
          <strong>{item.moodle.outlineStatus || "unknown"}</strong>
        </div>
        <div>
          <span>Queue</span>
          <strong>{item.queue.status || "none"}</strong>
        </div>
        <div>
          <span>Local outline</span>
          <strong>{item.localEvidence.courseOutlines ? `${item.localEvidence.courseOutlines} file(s)` : "missing"}</strong>
        </div>
      </div>
      <ul>
        {item.nextActions.slice(0, 4).map((action) => (
          <li key={action}>{action}</li>
        ))}
      </ul>
    </div>
  );
}

function PrepFlowGuide() {
  const steps = [
    ["1", "Course", "先看大纲、整体说明和课程级文件。"],
    ["2", "Unit", "进入单元，确认 Unit Plan、核心文本和本单元课程序列。"],
    ["3", "Lesson", "按 Lesson Expectations、Lesson、Hands On、Consolidation、Homework 备课。"],
    ["4", "Use", "课件可在线播放，文件可在线查看或下载，管理员可复制 Moodle 嵌入代码。"],
  ];
  return (
    <div className="prep-flow-guide" aria-label="Teacher preparation flow">
      {steps.map(([number, title, detail]) => (
        <div className="prep-step" key={number}>
          <span>{number}</span>
          <strong>{title}</strong>
          <p>{detail}</p>
        </div>
      ))}
    </div>
  );
}

function Overview({
  course,
  manifest,
  courseBaseUrl,
  roadmapItem,
}: {
  course: CourseCatalogEntry;
  manifest: CourseManifest;
  courseBaseUrl: string;
  roadmapItem?: CourseRoadmapEntry;
}) {
  const audit = manifest.sourceAudit || {};
  const checklist = readinessItems(course, manifest);
  const visibleCourseDownloads = manifest.courseDownloads.filter((item) => isTeacherVisibleResource(item) && isCourseLevelResource(item));
  return (
    <section className="course-overview panel">
      <div className="overview-header">
        <div>
          <p className="eyebrow">{manifest.course.code}</p>
          <h2>{manifest.course.title}</h2>
          <p>{manifest.course.audience}. 当前页面按 Unit 和 Lesson 组织所有备课材料。</p>
          <p className="course-note">
            {course.level ? `${course.level} · ` : ""}
            {course.notes || manifest.course.source}
          </p>
        </div>
        <div className="overview-tags">
          <div className="tag text">Unit-first</div>
          <div className={`tag ${course.status === "ready" ? "text" : "warn"}`}>{courseStatusLabel(course.status)}</div>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <span>Units</span>
          <strong>{manifest.units.length}</strong>
        </div>
        <div className="stat">
          <span>Lessons</span>
          <strong>{audit.lessonCount || 0}</strong>
        </div>
        <div className="stat">
          <span>iSpring</span>
          <strong>
            {audit.ispringComplete || 0}/{audit.ispringExpected || 0}
          </strong>
        </div>
        <div className="stat">
          <span>Resources</span>
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
      <div className="readiness-strip" aria-label="Course readiness checklist">
        {checklist.map((item) => (
          <div className={`readiness-item ${item.ready ? "ready" : item.optional ? "optional" : "pending"}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.detail}</strong>
          </div>
        ))}
      </div>
      <PrepFlowGuide />
      <CourseRoadmapPanel item={roadmapItem} />
      {visibleCourseDownloads.length ? (
        <div className="course-downloads">
          <h3>课程级文件</h3>
          <div className="lesson-tools">
            {visibleCourseDownloads.map((item) => (
              <ResourceActions courseBaseUrl={courseBaseUrl} item={item} key={resourceKey(item)} labelPrefix={roleLabel(item.role)} />
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
  return (
    <section className="course-selector">
      <label htmlFor="courseSelect">课程</label>
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
  return (
    <section className="current-course-card">
      <span>当前课程</span>
      <strong>{course.code}</strong>
      <p>{course.title}</p>
      {manifest ? (
        <div className="current-course-stats">
          <span>{manifest.units.length} Units</span>
          <span>{countLessons(manifest.units)} Lessons</span>
          <span>{countIspringEntries(manifest.units)} iSpring</span>
          <span>{countLocalResources(manifest.units)} Files</span>
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
}: {
  units: Unit[];
  selectedUnit: number;
  query: string;
  onSelect: (unit: number) => void;
}) {
  return (
    <section className="unit-roadmap panel" aria-label="Course unit roadmap">
      <div className="unit-roadmap-header">
        <div>
          <p className="eyebrow dark">Unit Roadmap</p>
          <h2>课程备课路径</h2>
          <p>先选 Unit，再展开 Lesson。每个 Lesson 按 Moodle book 的教学环节组织。</p>
        </div>
        <span>{units.length} units</span>
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
                {visibleCount}/{unit.lessons.length} lessons · {unit.summary.ispring} iSpring · {unitLocalDownloadCount(unit)} files
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
}: {
  units: Unit[];
  selectedUnit: number;
  query: string;
  onSelect: (unit: number) => void;
}) {
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
                {visibleCount}/{unit.lessons.length} lessons · {unitLocalDownloadCount(unit)} files
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
  moodleEmbedByPath,
}: {
  lesson: Lesson;
  defaultOpen: boolean;
  courseBaseUrl: string;
  moodleEmbedByPath?: MoodleEmbedMap;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const visibleDownloads = lesson.downloads.filter(isTeacherVisibleResource);
  const visibleTextExports = lesson.textExports.filter(isTeacherVisibleResource);
  const visibleISpring = lesson.ispring.filter((item) => item.path && item.mode !== "external");
  const visibleBookPageCount = lesson.bookSections?.length ? visibleBookSectionsForLesson(lesson).length : lesson.bookPageCount;
  const unitOverview = isUnitOverviewLesson(lesson);

  return (
    <article className={`lesson-row ${open ? "open" : ""}`}>
      <button className="lesson-summary" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="lesson-code">{lesson.id}</span>
        <span>
          <span className="lesson-title">{lesson.title}</span>
          <span className="lesson-counts">
            <span className="count-chip">{visibleBookPageCount} book pages</span>
            <span className="count-chip">{visibleISpring.length} iSpring</span>
            <span className="count-chip">{lessonLocalDownloadCount(lesson)} resources</span>
            <span className={`count-chip ${lesson.lessonPlan ? "ready" : unitOverview ? "" : "pending"}`}>
              {lesson.lessonPlan ? "Plan ready" : unitOverview ? "Unit slot" : "Plan pending"}
            </span>
          </span>
        </span>
        <span className="expand-icon">{open ? "-" : "+"}</span>
      </button>
      <div className="lesson-body">
        <div className="lesson-tools">
          {lesson.lessonPlan ? (
            <ResourceActions courseBaseUrl={courseBaseUrl} item={lesson.lessonPlan} labelPrefix="Lesson Plan" variant="plan" />
          ) : unitOverview ? (
            <span className="tag text">Unit-level iSpring slot</span>
          ) : (
            <span className="tag warn">Lesson plan pending</span>
          )}
        </div>
        <LessonFlowPanel
          courseBaseUrl={courseBaseUrl}
          lesson={lesson}
          moodleEmbedByPath={moodleEmbedByPath}
          visibleDownloads={visibleDownloads}
          visibleISpring={visibleISpring}
          visibleTextExports={visibleTextExports}
        />
      </div>
    </article>
  );
}

function UnitDetail({
  unit,
  texts,
  query,
  courseBaseUrl,
  moodleEmbedByPath,
}: {
  unit: Unit;
  texts: TextRegistryEntry[];
  query: string;
  courseBaseUrl: string;
  moodleEmbedByPath?: MoodleEmbedMap;
}) {
  const visibleLessons = unit.lessons.filter((lesson) => lessonMatches(lesson, query));
  const textTags = unit.coreTexts
    .map((id) => texts.find((text) => text.id === id))
    .filter((text): text is TextRegistryEntry => Boolean(text));

  return (
    <section className="unit-detail panel">
      <div className="unit-heading">
        <p className="eyebrow">Unit {unit.unit}</p>
        <h2>{unit.title}</h2>
        <p>
          {unit.lessons.length} lessons · {unit.summary.ispring} iSpring modules · {unitLocalDownloadCount(unit)} downloadable
          resources
        </p>
        <div className="unit-actions">
          {textTags.length ? textTags.map((text) => <span className="tag text" key={text.id}>{text.title}</span>) : <span className="tag warn">No core text assigned</span>}
          {unit.unitPlan ? (
            <ResourceActions courseBaseUrl={courseBaseUrl} item={unit.unitPlan} labelPrefix="Unit Plan" variant="plan" />
          ) : (
            <span className="tag warn">Unit plan pending</span>
          )}
        </div>
      </div>
      <div className="lesson-list">
        {visibleLessons.length ? (
          visibleLessons.map((lesson, index) => (
            <LessonRow
              courseBaseUrl={courseBaseUrl}
              defaultOpen={index === 0}
              key={lesson.id}
              lesson={lesson}
              moodleEmbedByPath={moodleEmbedByPath}
            />
          ))
        ) : (
          <div className="empty-state">
            {query ? "当前搜索没有匹配这个 Unit 的 lesson。" : "此 Unit 暂无 lesson 级资料，可先使用上方 Unit Plan。"}
          </div>
        )}
      </div>
    </section>
  );
}

function TextIndex({ courseBaseUrl, texts }: { courseBaseUrl: string; texts: TextRegistryEntry[] }) {
  if (!texts.length) return null;
  return (
    <section className="text-index panel">
      <h2>教材与文学作品索引</h2>
      <div className="text-grid">
        {texts.map((text) => (
          <article className="text-row" key={text.id}>
            <h3>{text.title}</h3>
            <p>
              {text.author} · Unit {text.units.join(", ")}
            </p>
            <p>
              <span className={`text-status ${text.copyrightStatus}`}>{statusLabel(text.copyrightStatus)}</span>{" "}
              <span className={`text-status ${textMaterialStatus(text)}`}>
                {textMaterialStatusLabel(text)}
              </span>
            </p>
            <p>{text.notes}</p>
            {text.materials.length ? (
              <div className="text-materials">
                {text.materials.map((item) => (
                  <ResourceActions courseBaseUrl={courseBaseUrl} item={item} key={resourceKey(item)} />
                ))}
              </div>
            ) : (
              <p className="material-pending">{missingTextMessage(text)}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function CompactTextIndex({ texts }: { texts: TextRegistryEntry[] }) {
  if (!texts.length) return null;
  return (
    <section className="text-index-compact">
      <h2>核心文本</h2>
      {texts.map((text) => (
        <div className="compact-text" key={text.id}>
          <strong>{text.title}</strong>
          <span>
            {statusLabel(text.copyrightStatus)} · {text.materials.length} file{text.materials.length === 1 ? "" : "s"}
          </span>
        </div>
      ))}
    </section>
  );
}

function App() {
  const [catalog, setCatalog] = useState<CourseCatalog | null>(null);
  const [courseRoadmap, setCourseRoadmap] = useState<CourseRoadmap | null>(null);
  const [portalSession, setPortalSession] = useState<PortalSession | null>(null);
  const [selectedCourseCode, setSelectedCourseCode] = useState(FALLBACK_COURSE.code);
  const [manifest, setManifest] = useState<CourseManifest | null>(null);
  const [moodleEmbedRows, setMoodleEmbedRows] = useState<MoodleEmbedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState(1);
  const [query, setQuery] = useState("");

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

  useEffect(() => {
    fetch(COURSE_ROADMAP_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Course roadmap request failed: ${response.status}`);
        return response.json() as Promise<CourseRoadmap>;
      })
      .then(setCourseRoadmap)
      .catch(() => setCourseRoadmap(null));
  }, []);

  const selectedCourse = useMemo(() => {
    return catalog?.courses.find((course) => course.code === selectedCourseCode) || catalog?.courses[0] || FALLBACK_COURSE;
  }, [catalog, selectedCourseCode]);

  useEffect(() => {
    if (!catalog || !selectedCourse) return;
    setManifest(null);
    setMoodleEmbedRows([]);
    setError(null);
    fetch(selectedCourse.manifestUrl)
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
        setError(fetchError instanceof Error ? fetchError.message : "Unknown manifest error");
      });
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
  const selectedRoadmapItem = useMemo(() => {
    return courseRoadmap?.courses.find((course) => course.course === selectedCourse.code);
  }, [courseRoadmap, selectedCourse.code]);
  const moodleEmbedByPath = useMemo(() => {
    const rowsByPath: MoodleEmbedMap = new Map();
    for (const row of moodleEmbedRows) {
      if (row.path) rowsByPath.set(row.path, row);
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
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">SunnyBrook OSSD</p>
          <h1>课程备课资源门户</h1>
        </div>
        <div className="topbar-actions">
          {portalSession?.authenticated ? (
            <>
              <span className="user-chip">
                {portalSession.username}
                {portalSession.role ? ` · ${portalSession.role}` : ""}
              </span>
              <button className="admin-entry logout-button" onClick={handleLogout} type="button">
                退出
              </button>
            </>
          ) : null}
          {canOpenAdminBackend(portalSession) ? (
            <a className="admin-entry" href="/teacher-admin" rel="noopener" target="_blank">
              管理后台
            </a>
          ) : null}
          <div className={`status-pill ${error ? "error" : ""}`}>
            {error ? "Manifest error" : manifest ? `${manifest.course.code} loaded` : "Loading course"}
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
            <label htmlFor="searchInput">搜索课程资源</label>
            <input
              id="searchInput"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Unit, lesson, Macbeth, PDF..."
              type="search"
              value={query}
            />
          </div>
          {manifest ? (
            <>
              <UnitNav onSelect={setSelectedUnit} query={normalizedQuery} selectedUnit={selectedUnit} units={manifest.units} />
              <CompactTextIndex texts={manifest.texts} />
            </>
          ) : null}
        </aside>
        <section className="content">
          {error ? (
            <section className="course-overview panel error">
              <div className="empty-state">无法读取课程 manifest。请确认课程目录和资源地址可访问。</div>
            </section>
          ) : null}
          {manifest && unit ? (
            <>
              <Overview
                course={selectedCourse}
                courseBaseUrl={selectedCourse.baseUrl}
                manifest={manifest}
                roadmapItem={selectedRoadmapItem}
              />
              <UnitRoadmap
                onSelect={setSelectedUnit}
                query={normalizedQuery}
                selectedUnit={selectedUnit}
                units={manifest.units}
              />
              <UnitDetail
                courseBaseUrl={selectedCourse.baseUrl}
                moodleEmbedByPath={moodleEmbedByPath}
                query={normalizedQuery}
                texts={manifest.texts}
                unit={unit}
              />
              <TextIndex courseBaseUrl={selectedCourse.baseUrl} texts={manifest.texts} />
            </>
          ) : null}
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
