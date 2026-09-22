import assert from 'node:assert/strict';
export const ACTORS = [
  'fx-user-owner-cm',
  'fx-user-owner-cm-2',
  'fx-user-spoc-cm',
  'fx-user-dpo',
  'fx-user-admin',
] as const;
export function recipe(index: number) {
  assert(Number.isInteger(index) && index >= 0 && index < 995);
  const rank = (index * 37) % 995;
  const status =
    rank < 195 ? 'draft' : rank < 695 ? 'in_review' : rank < 845 ? 'sent_back' : 'ready_for_launch';
  return {
    rank,
    sourceRecordId: { kind: 'known' as const, value: `TPM-SYNTHETIC-PERF-${rank}` },
    status,
    resubmit: rank >= 195 && rank < 245,
    owner: ACTORS[rank % 2]!,
    bu: rank % 3 === 0 ? 'HR' : 'CM',
    name: `SYNTHETIC-PERF-${rank} ทดสอบ ${rank % 2 ? 'cafe\u0301' : 'café'}${rank % 10 === 0 ? ' %_!\\' : ''}`,
  };
}
