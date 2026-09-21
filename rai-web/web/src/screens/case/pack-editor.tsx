// The nine-slot draft editor (W0-02 7.5; W1-06). Changes are held locally until "Save draft" sends one
// PackDraftUpdateRequest with the draft's ExpectedVersion (W0-06 5.1); the server's answer replaces the draft.
// "Submit pack" (7.6) is offered only once nothing is unsaved, with a fresh Idempotency-Key per press. Every
// action is a button or a native control, so the whole editor is keyboard-operable (section 9, item 5).
// Nothing here decides who may save or submit: the API answers, and its envelope is rendered as received.

import { useCallback, useState, type JSX } from 'react';
import { CURRENT_LANE_MAPPING } from '@rai/shared/constants';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { ConfigurationView } from '@rai/shared/schemas/cases';
import {
  STAGE_CONTEXTS,
  type PackDraft,
  type SlotNumber,
  type SlotState,
  type StageContext,
} from '@rai/shared/schemas/pack';
import { ErrorNotice, describeError } from '../../components/error-notice.js';
import { translateApiKey, useLocale } from '../../i18n/locale-provider.js';
import { SlotDialog } from './slot-dialog.js';
import { SlotRows, type ArtifactLookup, type SlotRowData } from './slot-rows.js';
import {
  SLOT_NUMBERS,
  mergedSlots,
  pendingCount,
  slotCounts,
  slotNameKey,
  slotOfFieldPath,
  stageKey,
  type PendingSlots,
} from './view-model.js';

export interface PendingSettings {
  checklistTemplateVersion?: string;
  stageContext?: StageContext;
}

export interface PackEditorProps {
  caseId: string;
  draft: PackDraft;
  configuration: ConfigurationView;
  artifacts: ReadonlyMap<string, ArtifactLookup>;
  pendingSlots: PendingSlots;
  pendingSettings: PendingSettings;
  busy: 'idle' | 'saving' | 'submitting';
  error: unknown;
  notice: { key: 'pack.saved' | 'pack.submitted'; params: Record<string, string | number> } | null;
  onSlotChange: (slot: SlotNumber, next: SlotState, artifact: ArtifactRef | undefined) => void;
  onSettingsChange: (next: PendingSettings) => void;
  onSave: () => void;
  onDiscard: () => void;
  onSubmit: () => void;
  onReload: () => void;
  onDismissError: () => void;
}

export function PackEditor(props: PackEditorProps): JSX.Element {
  const { t } = useLocale();
  const { draft, configuration, pendingSlots, pendingSettings, busy } = props;
  const [dialogSlot, setDialogSlot] = useState<SlotNumber | null>(null);
  const closeDialog = useCallback(() => setDialogSlot(null), []);

  const slots = mergedSlots(draft.slots, pendingSlots);
  const unsaved = pendingCount(pendingSlots) + Object.keys(pendingSettings).length;
  const error = props.error === null || props.error === undefined ? null : describeError(props.error);
  const fieldErrorBySlot = new Map<SlotNumber, string>();
  for (const field of error?.fields ?? []) {
    const slot = slotOfFieldPath(field.path);
    if (slot !== null) fieldErrorBySlot.set(slot, translateApiKey(t, field.messageKey, field.params));
  }
  const rows: SlotRowData[] = SLOT_NUMBERS.map((slot) => {
    const state = slots[slot];
    return {
      slot,
      state: state.state,
      artifact: state.state === 'attached' ? props.artifacts.get(state.artifactId) : undefined,
      reason: state.state === 'not_applicable' ? state.reason : undefined,
      pending: pendingSlots[slot] !== undefined,
      fieldError: fieldErrorBySlot.get(slot) ?? null,
    };
  });
  const counts = slotCounts(slots);
  const templateValue = pendingSettings.checklistTemplateVersion ?? draft.checklistTemplateVersion;
  const stageValue = pendingSettings.stageContext ?? draft.stageContext;
  const templateOptions = configuration.checklistTemplateVersions.includes(draft.checklistTemplateVersion)
    ? configuration.checklistTemplateVersions
    : [draft.checklistTemplateVersion, ...configuration.checklistTemplateVersions];

  const current = dialogSlot === null ? null : slots[dialogSlot];
  const currentArtifact =
    current !== null && current.state === 'attached' ? props.artifacts.get(current.artifactId) : undefined;

  return (
    <section className={'card'} aria-labelledby={'pack-heading'}>
      <div className={'panel-head'}>
        <div>
          <h2 id={'pack-heading'}>{t('pack.heading')}</h2>
          <p className={'muted'}>{t('pack.intro')}</p>
        </div>
        <p className={'muted panel-summary'}>
          {t('pack.draft_revision', { number: draft.versionNumber, revision: draft.draftRevision })}
          <br />
          {t('pack.summary', { ...counts })}
        </p>
      </div>

      <fieldset className={'field pack-settings'} disabled={busy !== 'idle'}>
        <legend>{t('pack.settings_heading')}</legend>
        <div className={'field'}>
          <label htmlFor={'pack-template'}>{t('pack.template_version')}</label>
          <select
            id={'pack-template'}
            value={templateValue}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const next = { ...pendingSettings };
              if (value === draft.checklistTemplateVersion) delete next.checklistTemplateVersion;
              else next.checklistTemplateVersion = value;
              props.onSettingsChange(next);
            }}
          >
            {templateOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className={'field'}>
          <label htmlFor={'pack-stage'}>{t('pack.stage_context')}</label>
          <select
            id={'pack-stage'}
            value={stageValue}
            aria-describedby={'pack-stage-hint'}
            onChange={(event) => {
              const value = event.currentTarget.value as StageContext;
              const next = { ...pendingSettings };
              if (value === draft.stageContext) delete next.stageContext;
              else next.stageContext = value;
              props.onSettingsChange(next);
            }}
          >
            {STAGE_CONTEXTS.map((option) => (
              <option key={option} value={option}>
                {t(stageKey(option))}
              </option>
            ))}
          </select>
          <p className={'field-hint'} id={'pack-stage-hint'}>
            {t('pack.stage_context_hint')}
          </p>
        </div>
      </fieldset>

      <SlotRows
        rows={rows}
        mapping={CURRENT_LANE_MAPPING}
        action={(row) => (
          <button
            type={'button'}
            className={'btn btn-secondary btn-small'}
            aria-label={t('pack.change_slot', { number: row.slot, name: t(slotNameKey(row.slot)) })}
            disabled={busy !== 'idle'}
            onClick={() => setDialogSlot(row.slot)}
          >
            {t('pack.action.change')}
          </button>
        )}
      />

      {error !== null ? (
        <ErrorNotice error={props.error}>
          {error.refreshPath !== undefined ? (
            <button type={'button'} className={'btn btn-secondary'} onClick={props.onReload}>
              {t('action.reload')}
            </button>
          ) : null}
          <button type={'button'} className={'btn btn-ghost'} onClick={props.onDismissError}>
            {t('action.dismiss')}
          </button>
        </ErrorNotice>
      ) : null}
      {props.notice !== null ? (
        <p className={'notice notice-success'} role={'status'}>
          {t(props.notice.key, props.notice.params)}
        </p>
      ) : null}

      <div className={'form-actions'}>
        <button
          type={'button'}
          className={'btn btn-primary'}
          disabled={busy !== 'idle' || unsaved === 0}
          onClick={props.onSave}
        >
          {busy === 'saving' ? t('pack.saving') : t('pack.action.save')}
        </button>
        <button
          type={'button'}
          className={'btn btn-secondary'}
          disabled={busy !== 'idle' || unsaved === 0}
          onClick={props.onDiscard}
        >
          {t('pack.action.discard')}
        </button>
        <button
          type={'button'}
          className={'btn btn-secondary'}
          disabled={busy !== 'idle' || unsaved > 0}
          aria-describedby={'pack-submit-hint'}
          onClick={props.onSubmit}
        >
          {busy === 'submitting' ? t('pack.submitting') : t('pack.action.submit')}
        </button>
        <span className={'muted small'} id={'pack-submit-hint'}>
          {unsaved > 0 ? t('pack.pending_changes', { count: unsaved }) : t('pack.no_pending_changes')}
          {' · '}
          {unsaved > 0 ? t('pack.submit_save_first') : t('pack.submit_hint')}
        </span>
      </div>

      {/* Always mounted: the shared Dialog opens with showModal(), traps Tab, and returns focus to the Change
          button on close (section 9 item 3); the form inside remounts per slot. */}
      <SlotDialog
        caseId={props.caseId}
        slot={dialogSlot}
        current={current}
        currentArtifact={
          currentArtifact === 'loading' || currentArtifact === 'unavailable' ? undefined : currentArtifact
        }
        onApply={(slot, next, artifact) => {
          props.onSlotChange(slot, next, artifact);
          setDialogSlot(null);
        }}
        onClose={closeDialog}
      />
    </section>
  );
}
