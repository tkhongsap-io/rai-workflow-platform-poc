// W1-13: boundary casts for three fields of the shared W1 contract whose TypeBox schemas are built with
// `LIST.map((v) => Type.Literal(v))` — `ModelTypeSchema` (cases.ts), `StageContextSchema` (slots.ts) and
// `AllowedMediaTypeSchema` (artifacts.ts). TypeBox infers such a mapped union as `never`, so the inferred
// `CaseWritableFields['modelType']`, `PackDraft['stageContext']` and `ArtifactRef['mediaType']` are `never`
// today (auth.ts notes the same trap and spells its tuple out). The runtime JSON is unaffected. Spelling the
// tuples out is a one-line contract fix in shared/src/schemas (Lane A, contract PR); the substitute does not
// edit the contract and instead narrows here, from the exported value lists, at the three construction sites.
// When the contract PR lands these helpers become identity functions and can be deleted.

import type { AllowedMediaType, ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { CaseWritableFields, ModelType } from '@rai/shared/schemas/cases';
import type { PackDraft, StageContext } from '@rai/shared/schemas/pack';

export function asContractModelType(value: ModelType): CaseWritableFields['modelType'] {
  return value as unknown as CaseWritableFields['modelType'];
}

export function asContractStageContext(value: StageContext): PackDraft['stageContext'] {
  return value as unknown as PackDraft['stageContext'];
}

export function asContractMediaType(value: AllowedMediaType): ArtifactRef['mediaType'] {
  return value as unknown as ArtifactRef['mediaType'];
}
