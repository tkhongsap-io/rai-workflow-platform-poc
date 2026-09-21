// W0-02 section 7.4: artifact upload and download (W1-03a/b serve; W1-06 consumes). Media types: W0-08 section 2.

import { Type, type Static } from 'typebox';
import type { ArtifactId, CaseId, SubjectId } from '../ids.js';

export { UNSAFE_UPLOAD_REASONS, type UnsafeUploadReason } from '../errors.js';

export const ALLOWED_MEDIA_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
] as const;
export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];
// A literal tuple, not a mapped array: TypeBox infers `never` from a Union over `TLiteral<union>[]` (W1-03 fix).
export const AllowedMediaTypeSchema = Type.Union([
  Type.Literal(ALLOWED_MEDIA_TYPES[0]),
  Type.Literal(ALLOWED_MEDIA_TYPES[1]),
  Type.Literal(ALLOWED_MEDIA_TYPES[2]),
  Type.Literal(ALLOWED_MEDIA_TYPES[3]),
  Type.Literal(ALLOWED_MEDIA_TYPES[4]),
]);

export const ArtifactRefSchema = Type.Object({
  artifactId: Type.String(),
  caseId: Type.String(),
  sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }), // the blob key; never a URL
  filename: Type.String({ minLength: 1, maxLength: 200 }), // original name, Unicode NFC, Thai preserved
  mediaType: AllowedMediaTypeSchema, // the sniffed type, not the declared one
  sizeBytes: Type.Integer({ minimum: 1 }),
  uploadedBy: Type.String(),
  uploadedAt: Type.String(),
});

export interface ArtifactRef extends Omit<
  Static<typeof ArtifactRefSchema>,
  'artifactId' | 'caseId' | 'uploadedBy'
> {
  artifactId: ArtifactId;
  caseId: CaseId;
  uploadedBy: SubjectId;
}
