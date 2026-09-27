import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_LANE_MAPPING, LANE_MAPPING_V1 } from '@rai/shared/constants';
import { NON_VENDOR_DEFAULT_REASON_KEY } from '@rai/shared/schemas/pack';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import {
  NoConfigurationInForce,
  UNFROZEN_KINDS,
  VersionNotSubmitted,
  frozenSlotsOf,
  laneMappingContent,
  resolveFrozenConfiguration,
  submitSlotErrors,
  submittedVersionView,
  type RevisionInForce,
  type SlotColumnsIn,
} from './freeze.js';

const at = (iso: string) => new Date(iso);
const rows = (patch: Partial<Record<number, Partial<SlotColumnsIn>>> = {}): SlotColumnsIn[] =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => ({
    slot,
    state: 'missing',
    reason: null,
    artifactId: null,
    ...patch[slot],
  }));

describe('W1-05 submit slot precondition (W0-06 4.3)', () => {
  it('accepts missing and not-yet slots: soft QC, never an error (L7, A02)', () => {
    assert.deepEqual(submitSlotErrors(rows({ 2: { state: 'not_yet' } })), []);
  });
  it('accepts not_applicable with the server default or a typed reason', () => {
    assert.deepEqual(
      submitSlotErrors(
        rows({
          3: { state: 'not_applicable', reason: NON_VENDOR_DEFAULT_REASON_KEY },
          7: { state: 'not_applicable', reason: 'ไม่มีการเชื่อมต่อภายนอก' },
        }),
      ),
      [],
    );
  });
  it('rejects not_applicable without a reason at slots[n].reason with validation.reason_required', () => {
    const errors = submitSlotErrors(
      rows({ 4: { state: 'not_applicable', reason: null }, 6: { state: 'not_applicable', reason: '   ' } }),
    );
    assert.deepEqual(errors, [
      { path: 'slots[4].reason', messageKey: 'validation.reason_required' },
      { path: 'slots[6].reason', messageKey: 'validation.reason_required' },
    ]);
  });
  it('rejects a version with fewer than nine slot rows', () => {
    const errors = submitSlotErrors(rows().filter((r) => r.slot !== 9));
    assert.deepEqual(errors, [{ path: 'slots[9].state', messageKey: 'validation.required' }]);
  });
});

describe('W1-05 frozen configuration (W0-04 frozen_configuration / configuration_revision_id)', () => {
  const inForce: RevisionInForce[] = [
    { kind: 'checklist_templates', id: 'rev-templates', publishedAt: at('2026-01-01T00:00:00Z') },
    { kind: 'sla', id: 'rev-sla', publishedAt: at('2026-01-03T00:00:00Z') },
    { kind: 'calendar', id: 'rev-calendar', publishedAt: at('2026-01-04T00:00:00Z') },
    { kind: 'operator_recipients', id: 'rev-ops', publishedAt: at('2026-01-05T00:00:00Z') },
    { kind: 'use_case_groups', id: 'rev-groups', publishedAt: at('2026-01-02T00:00:00Z') },
  ];
  it('records every kind in force and, without qc_rules, the ConfigurationView.revisionId rule for the FK', () => {
    const frozen = resolveFrozenConfiguration(inForce);
    assert.deepEqual(frozen.byKind, {
      checklist_templates: 'rev-templates',
      sla: 'rev-sla',
      calendar: 'rev-calendar',
      operator_recipients: 'rev-ops',
      use_case_groups: 'rev-groups',
    });
    assert.equal(frozen.configurationRevisionId, 'rev-sla'); // latest of groups/templates/sla, not calendar or ops
  });
  it('prefers the qc_rules revision for the FK once one is in force (W0-04)', () => {
    const frozen = resolveFrozenConfiguration([
      ...inForce,
      { kind: 'qc_rules', id: 'rev-qc', publishedAt: at('2025-12-01T00:00:00Z') },
    ]);
    assert.equal(frozen.configurationRevisionId, 'rev-qc');
    assert.equal(frozen.byKind.qc_rules, 'rev-qc');
  });
  it('skips the kinds that are not evidence about a case: desk_controls and group_role_mapping (W6-02)', () => {
    assert.deepEqual([...UNFROZEN_KINDS].sort(), ['desk_controls', 'group_role_mapping']);
    const frozen = resolveFrozenConfiguration([
      ...inForce,
      { kind: 'desk_controls', id: 'rev-desk', publishedAt: at('2026-01-06T00:00:00Z') },
      { kind: 'group_role_mapping', id: 'rev-map', publishedAt: at('2026-01-07T00:00:00Z') },
    ]);
    assert.deepEqual(Object.keys(frozen.byKind).sort(), [
      'calendar',
      'checklist_templates',
      'operator_recipients',
      'sla',
      'use_case_groups',
    ]);
    assert.equal(frozen.configurationRevisionId, 'rev-sla', 'an unfrozen kind never becomes the FK');
  });
  it('refuses to freeze when no view kind is in force', () => {
    assert.throws(
      () => resolveFrozenConfiguration([inForce[2]!]),
      (e: unknown) => e instanceof NoConfigurationInForce,
    );
  });
  it('refuses to freeze without an sla or a calendar revision: the due-date clock needs both (D06)', () => {
    for (const kind of ['sla', 'calendar'] as const) {
      assert.throws(
        () => resolveFrozenConfiguration(inForce.filter((r) => r.kind !== kind)),
        (e: unknown) => e instanceof NoConfigurationInForce,
      );
    }
  });
});

describe('W1-05 lane mapping content and the SubmittedVersion view', () => {
  it('serialises the D02 constant with its version string (lane-mapping/v1)', () => {
    assert.deepEqual(laneMappingContent(), {
      version: 'lane-mapping/v1',
      decision: 'D02',
      slotsByLane: { ai_coe: [1, 5], dpo: [2, 3, 4, 5], it_security: [5, 6, 7, 8] },
      noLaneGate: [9],
    });
    assert.equal(CURRENT_LANE_MAPPING, LANE_MAPPING_V1);
  });
  it('embeds an immutable copy of the artifact reference and maps every other state', () => {
    const ref: ArtifactRef = {
      artifactId: 'art-1',
      caseId: 'case-1',
      sha256: 'c'.repeat(64),
      filename: 'brd.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 10,
      uploadedBy: 'fixture:owner',
      uploadedAt: '2026-09-22T03:00:00.000Z',
    };
    const slots = frozenSlotsOf(
      rows({
        1: { state: 'attached', artifactId: 'art-1' },
        2: { state: 'not_yet' },
        3: { state: 'not_applicable', reason: NON_VENDOR_DEFAULT_REASON_KEY },
        4: { state: 'not_applicable', reason: 'typed' },
      }),
      new Map([['art-1', ref]]),
    );
    assert.deepEqual(slots[1], { state: 'attached', artifact: ref });
    assert.notEqual((slots[1] as { artifact: ArtifactRef }).artifact, ref); // a copy, not the same object
    assert.deepEqual(slots[2], { state: 'not_yet' });
    assert.deepEqual(slots[3], { state: 'not_applicable', reason: { kind: 'default_non_vendor' } });
    assert.deepEqual(slots[4], { state: 'not_applicable', reason: { kind: 'text', text: 'typed' } });
    assert.deepEqual(slots[5], { state: 'missing' });
  });
  it('refuses to render a row that is not submitted', () => {
    assert.throws(
      () =>
        submittedVersionView(
          {
            id: 'v1',
            caseId: 'c',
            versionNumber: 1,
            parentVersionId: null,
            submittedBy: null,
            submittedAt: null,
            checklistTemplateVersion: 'v1.0',
            stageContext: 'idea',
            configurationRevisionId: null,
            laneMappingVersion: null,
          },
          frozenSlotsOf(rows(), new Map()),
          true,
          [],
        ),
      (e: unknown) => e instanceof VersionNotSubmitted,
    );
  });
});
