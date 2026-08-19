export interface FileResource {
  label: string;
  type: string;
  category: string;
  role: string;
  path?: string;
  url?: string;
  previewPath?: string;
  previewUrl?: string;
  source?: string;
  bytes?: number;
  attachments?: FileResource[];
  unit?: number;
  lesson?: number;
  moodleActivityId?: string;
  parentSection?: string;
  sourceGroup?: string;
  teacherOnly?: boolean;
  teacherUse?: string;
  textPreview?: string;
  sortOrder?: number;
}

export interface MoodleEmbedRow {
  course: string;
  unit: number;
  lesson: number;
  lessonId: string;
  lessonTitle: string;
  kind: "ispring" | "video" | "h5p" | "book-section" | "file";
  label: string;
  path: string;
  status: string;
  embedUrl?: string;
  fileUrl?: string;
  moodleShortcode?: string;
  moodleIframeHtml?: string;
  moodleHtml: string;
}

export interface BookSectionResource extends FileResource {
  sectionLabel: string;
  sectionIndex: number;
}

export interface ExternalLinkResource {
  label: string;
  type: string;
  category: string;
  role: string;
  url: string;
  source?: string;
}

export interface LessonText {
  label: string;
  path: string;
  type: string;
}

export interface ISpringEntry {
  label: string;
  mode: "page" | "external";
  path?: string;
  packagePath?: string;
  url?: string;
  downloadPath?: string;
  downloadUrl?: string;
  source?: string;
  slideCount?: number;
  videoSegmentCount?: number;
}

export interface Lesson {
  id: string;
  unit: number;
  lesson: number;
  title: string;
  path: string;
  planningStatus?: "unit_overview";
  bookPageCount: number;
  lessonText: LessonText[];
  textExports: FileResource[];
  lessonPlan: FileResource | null;
  ispring: ISpringEntry[];
  downloads: FileResource[];
  bookSections?: BookSectionResource[];
  resourceCounts: Record<string, number>;
}

export interface UnitSummary {
  downloads: number;
  ispring: number;
  docx: number;
  pdf: number;
  video: number;
  h5p: number;
}

export interface Unit {
  unit: number;
  title: string;
  coreTexts: string[];
  unitPlan: FileResource | null;
  unitResources: Record<string, string | FileResource | FileResource[]>;
  summary: UnitSummary;
  lessons: Lesson[];
}

export interface TextRegistryEntry {
  id: string;
  title: string;
  author: string;
  type: string;
  units: number[];
  lessons?: string[];
  copyrightStatus: string;
  sourceStatus: string;
  notes: string;
  materials: FileResource[];
  externalLinks?: ExternalLinkResource[];
}

export interface CourseManifest {
  schemaVersion: number;
  generatedAt: string;
  course: {
    code: string;
    title: string;
    audience: string;
    source: string;
  };
  sourceAudit: {
    lessonCount?: number;
    ispringExpected?: number;
    ispringComplete?: number;
    resourceCoverage?: {
      uniqueCovered?: number;
      uniqueTotal?: number;
    };
    resourceValidation?: {
      okCount?: number;
      checkedCount?: number;
    };
    structureNote?: string;
  };
  navigation: {
    primary: string;
    secondary: string;
  };
  courseDownloads: FileResource[];
  courseSections?: FileResource[];
  evaluations?: FileResource[];
  teacherResources?: FileResource[];
  texts: TextRegistryEntry[];
  units: Unit[];
}

export interface CourseCatalogEntry {
  code: string;
  title: string;
  level?: string;
  status?: string;
  manifestUrl: string;
  baseUrl: string;
  notes?: string;
}

export interface CourseCatalog {
  schemaVersion: number;
  defaultCourse: string;
  courses: CourseCatalogEntry[];
}

export interface MoodleCourseResourceIndexEntry {
  course: string;
  moodleCourseId?: number;
  coursePage: string;
  outlineStatus: "ready" | "needs-url";
  outlineUrl?: string;
  bookCount: number;
  bookIds: number[];
  books?: {
    id: number;
    url: string;
    chapterLinkCount: number;
    numberedLessonCount: number;
  }[];
  numberedLessonCount: number;
  notes: string;
}

export interface MoodleCourseResourceIndex {
  schemaVersion: number;
  generatedAt: string;
  source: string;
  courses: MoodleCourseResourceIndexEntry[];
}
