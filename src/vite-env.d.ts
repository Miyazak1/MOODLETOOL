/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COURSE_MANIFEST_URL?: string;
  readonly VITE_COURSE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
