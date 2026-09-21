/// <reference types="vite/client" />

// web/vite.config.ts defines VITE_API_SUBSTITUTE as a boolean literal at build time (W0-02 section 5); the
// production build forces false and check-substitute-absent verifies the bundle.
interface ImportMetaEnv {
  readonly VITE_API_SUBSTITUTE: boolean;
}
