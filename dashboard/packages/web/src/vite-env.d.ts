/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" for the public build (Vercel). */
  readonly VITE_DEMO?: string;
  /** Base URL of a live backend for the public build, e.g. https://203.0.113.7.sslip.io */
  readonly VITE_API_URL?: string;
}
