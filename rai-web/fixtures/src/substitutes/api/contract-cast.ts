// W1-13: three helpers at the substitute's construction sites for `modelType`, `stageContext` and `mediaType`.
// They were casts while the shared TypeBox unions were built with `LIST.map((v) => Type.Literal(v))`, which the
// emitted declarations infer as `never`. W1-02 (ModelTypeSchema), W1-03 (AllowedMediaTypeSchema) and #79
// (StageContextSchema) spelled the tuples out, so all three are identity functions now, kept only so the
// construction sites stay uniform; a later tidy-up may inline them.

import type { AllowedMediaType, ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { CaseWritableFields, ModelType } from '@rai/shared/schemas/cases';
import type { PackDraft, StageContext } from '@rai/shared/schemas/pack';

// W1-02 spelled `ModelTypeSchema` out; the cast is gone. All three helpers are now identity functions kept
// only so the construction sites stay uniform; they can be inlined in a later tidy-up.
export function asContractModelType(value: ModelType): CaseWritableFields['modelType'] {
  return value;
}

// `StageContextSchema` spelled out in this PR; identity function, same reason as above.
export function asContractStageContext(value: StageContext): PackDraft['stageContext'] {
  return value;
}

// W1-03 spelled `AllowedMediaTypeSchema` out; identity function, same reason as above.
export function asContractMediaType(value: AllowedMediaType): ArtifactRef['mediaType'] {
  return value;
}
