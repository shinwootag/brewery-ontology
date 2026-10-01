/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Course-time anchor (ISO string), injected from the repo-root .env. */
  readonly VITE_COURSE_NOW: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
