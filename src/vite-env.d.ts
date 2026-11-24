/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_MODE?: 'mock' | 'live';
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
