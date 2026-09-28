// W6-05 (W6 plan section 9): presentation helpers of the Admin configuration screens. They name kinds and owners and
// check a change note before a request; they never decide access (the server answers 403 to a non-Admin, and a kind
// outside `CONFIGURATION_KINDS` is its 404).

import type { LocaleKey } from '@rai/shared/locales/keys';
import { CONFIGURATION_KINDS, type ConfigurationKind } from '@rai/shared/schemas/cases';
import {
  CHANGE_NOTE_MAX_LENGTH,
  type ConfigurationValuesOwner,
} from '@rai/shared/schemas/configuration-admin';

const KIND_LABEL: Readonly<Record<ConfigurationKind, LocaleKey>> = Object.freeze({
  checklist_templates: 'admin.config.kind.checklist_templates',
  qc_rules: 'admin.config.kind.qc_rules',
  sla: 'admin.config.kind.sla',
  calendar: 'admin.config.kind.calendar',
  operator_recipients: 'admin.config.kind.operator_recipients',
  use_case_groups: 'admin.config.kind.use_case_groups',
  risk_rubric: 'admin.config.kind.risk_rubric',
  group_role_mapping: 'admin.config.kind.group_role_mapping',
  desk_controls: 'admin.config.kind.desk_controls',
});

const OWNER_LABEL: Readonly<Record<ConfigurationValuesOwner, LocaleKey>> = Object.freeze({
  admin: 'admin.config.values_owner.admin',
  D07: 'admin.config.values_owner.d07',
  D09: 'admin.config.values_owner.d09',
  D10: 'admin.config.values_owner.d10',
});

export function isConfigurationKind(value: string): value is ConfigurationKind {
  return (CONFIGURATION_KINDS as readonly string[]).includes(value);
}

/** The kind's name, or undefined for a path segment that is not a kind (the page then shows the server's 404). */
export function kindLabelKey(kind: string): LocaleKey | undefined {
  return isConfigurationKind(kind) ? KIND_LABEL[kind] : undefined;
}

/** The badge of whose decision a kind's values are: Admin, or "provisional until D07/D09/D10". */
export function ownerLabelKey(owner: ConfigurationValuesOwner): LocaleKey {
  return OWNER_LABEL[owner];
}

/** The note a restore sends: trimmed, 1-500 characters (W6 plan section 2.3); undefined means refuse in the dialog. */
export function changeNoteOf(input: string): string | undefined {
  const note = input.trim();
  return note.length >= 1 && note.length <= CHANGE_NOTE_MAX_LENGTH ? note : undefined;
}
