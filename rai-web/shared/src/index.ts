// @rai/shared — the typed contract both halves import (W0-02 section 1). Subpath imports are also supported:
// '@rai/shared/errors', '@rai/shared/schemas/auth', '@rai/shared/locales/keys', ...

export * from './ids.js';
export * from './constants.js';
export type { Lane } from './constants.js'; // also re-exported by schemas/auth.ts; the explicit export resolves the ambiguity
export * from './errors.js';
export * from './schemas/auth.js';
export * from './schemas/cases.js';
export * from './schemas/artifacts.js';
export * from './schemas/pack.js';
export * from './schemas/versions.js';
export * as qc from './qc/types.js';
export * as mail from './mail/types.js';
// The typed key union lives in ./locales/keys.js (import it by subpath); ids.ts keeps the plain string alias.
export { DEFAULT_LOCALE, LOCALE_CATALOGUES, LOCALE_KEYS, isLocaleKey, t } from './locales/keys.js';
