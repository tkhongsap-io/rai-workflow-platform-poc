// W1-07 (Lane B): pure form model for the new-case screen (W0-02 7.3 CaseCreateRequest). The screen collects
// what the contract needs and sends it; the server validates (422 invalid_input with field paths) and decides
// scope (403). This module only shapes the request and maps the server's field errors back onto the inputs.

import type { Principal } from '@rai/shared/schemas/auth';
import type { CaseCreateRequest, ModelType } from '@rai/shared/schemas/cases';
import type { FieldError } from '@rai/shared/errors';
import type { LocaleKey } from '@rai/shared/locales/keys';

export interface NewCaseForm {
  useCaseName: string;
  businessUnitId: string;
  businessUnit: string;
  businessOwner: string;
  technicalOwner: string;
  sourceKind: 'known' | 'unknown';
  sourceValue: string;
  useCaseGroup: string;
  vendorInvolved: 'yes' | 'no';
  modelType: ModelType;
}

export type NewCaseField = keyof NewCaseForm;

export const NEW_CASE_FIELDS: readonly NewCaseField[] = Object.freeze([
  'useCaseName',
  'businessUnitId',
  'businessUnit',
  'businessOwner',
  'technicalOwner',
  'sourceKind',
  'sourceValue',
  'useCaseGroup',
  'vendorInvolved',
  'modelType',
]);

/** The BU keys the server listed in the principal's `business_unit` grants: offered as suggestions, never enforced. */
export function suggestedBusinessUnits(principal: Principal): string[] {
  const seen = new Set<string>();
  for (const r of principal.roles) if (r.scope.kind === 'business_unit') seen.add(r.scope.businessUnit);
  return [...seen];
}

export function initialForm(principal: Principal): NewCaseForm {
  const units = suggestedBusinessUnits(principal);
  return {
    useCaseName: '',
    businessUnitId: units.length === 1 ? (units[0] ?? '') : '',
    businessUnit: '',
    businessOwner: principal.subjectId, // W0-02 7.3: defaults to the actor; a BU SPOC may name an owner in its BU
    technicalOwner: '',
    sourceKind: 'unknown',
    sourceValue: '',
    useCaseGroup: '',
    vendorInvolved: 'no',
    modelType: 'llm',
  };
}

export function toCreateRequest(form: NewCaseForm): CaseCreateRequest {
  return {
    useCaseName: form.useCaseName.trim(),
    businessUnitId: form.businessUnitId.trim(),
    businessUnit: form.businessUnit.trim(),
    businessOwner: form.businessOwner.trim(),
    technicalOwner: form.technicalOwner.trim(),
    sourceRecordId:
      form.sourceKind === 'known' ? { kind: 'known', value: form.sourceValue.trim() } : { kind: 'unknown' },
    useCaseGroup: form.useCaseGroup,
    vendorInvolved: form.vendorInvolved === 'yes',
    modelType: form.modelType,
  };
}

export type FieldMessages = Partial<Record<NewCaseField, LocaleKey>>;

/** The text fields the form sent blank: the server's 422 on one of them is rendered as "required". */
export function blankFields(form: NewCaseForm): Set<NewCaseField> {
  const blank = new Set<NewCaseField>();
  for (const field of NEW_CASE_FIELDS) {
    const value = form[field];
    if (typeof value === 'string' && value.trim() === '') blank.add(field);
  }
  if (form.sourceKind === 'unknown') blank.delete('sourceValue'); // not sent at all
  return blank;
}

/**
 * Maps W0-06 8.2 field paths (`body.useCaseName`, `sourceRecordId.value`, ...) onto the form's inputs. The
 * server's key is kept, except that a field the form sent blank reads `validation.required` (the server reports a
 * failed length rule as `validation.not_in_configured_list`, which misleads for an empty box); the server's 422
 * remains the decision.
 */
export function fieldMessagesFrom(
  errors: readonly FieldError[],
  blank: ReadonlySet<NewCaseField> = new Set(),
): { fields: FieldMessages; other: FieldError[] } {
  const fields: FieldMessages = {};
  const other: FieldError[] = [];
  for (const error of errors) {
    const path = error.path.replace(/^body\./, '');
    const asField = path === 'sourceRecordId.value' ? 'sourceValue' : (path as NewCaseField);
    const key: LocaleKey = blank.has(asField) ? 'validation.required' : (error.messageKey as LocaleKey);
    if (path === 'sourceRecordId' || path === 'sourceRecordId.kind') fields.sourceKind ??= key;
    else if (path === 'sourceRecordId.value') fields.sourceValue ??= key;
    else if ((NEW_CASE_FIELDS as readonly string[]).includes(path)) fields[path as NewCaseField] ??= key;
    else other.push(error);
  }
  return { fields, other };
}
