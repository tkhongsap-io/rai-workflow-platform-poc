// @rai/fixtures — Lane C synthetic data and substitutes. Dev and test only; never in the production build.
export * from './data/users.js';
export * from './data/ids.js';
export * from './data/cases/index.js';
export * from './data/documents/index.js';
export { SUBSTITUTE_MARKER } from './substitute-marker.js';
export * as qcSubstitute from './substitutes/qc/index.js';
export * from './substitutes/mail-sink/index.js';
