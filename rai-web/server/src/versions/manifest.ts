// W0-04 `pack_version.manifest_hash`: SHA-256 over the canonical JSON of the nine slot rows (slot, state, reason,
// artifact hash, filename, media type, size). Lets the A07 tests and the W7-00 restore check prove a version
// unchanged without diffing rows. Pure: the rows come in, one lowercase hex digest goes out; order-insensitive
// over slots (canonical order is 1..9) and key-insensitive (keys are emitted in a fixed order).

import { createHash } from 'node:crypto';

/** One slot as the manifest sees it: the slot row plus, for an attached slot, the artifact row's frozen facts. */
export interface ManifestSlot {
  slot: number;
  state: string;
  reason: string | null;
  artifact: { sha256: string; filename: string; mediaType: string; sizeBytes: number } | null;
}

/** The canonical JSON text the hash covers: slots ascending, every key in a fixed order, no whitespace. */
export function canonicalManifest(slots: readonly ManifestSlot[]): string {
  const ordered = [...slots].sort((a, b) => a.slot - b.slot);
  const entries = ordered.map((s) => ({
    slot: s.slot,
    state: s.state,
    reason: s.reason,
    artifact:
      s.artifact === null
        ? null
        : {
            sha256: s.artifact.sha256,
            filename: s.artifact.filename,
            mediaType: s.artifact.mediaType,
            sizeBytes: s.artifact.sizeBytes,
          },
  }));
  return JSON.stringify({ version: 1, slots: entries });
}

/** Lowercase hex SHA-256 of `canonicalManifest(slots)`. */
export function manifestHash(slots: readonly ManifestSlot[]): string {
  return createHash('sha256').update(canonicalManifest(slots), 'utf8').digest('hex');
}
