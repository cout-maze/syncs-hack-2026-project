/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'msw' | 'prism' | 'real' — see web/.env.example */
  readonly VITE_API_MODE?: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
