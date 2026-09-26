/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Liftoff backend base URL (default http://127.0.0.1:8000) */
  readonly VITE_API_URL?: string
  /** Optional bearer token; must match API_AUTH_TOKEN on the backend */
  readonly VITE_API_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
