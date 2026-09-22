import test from 'node:test';
import assert from 'node:assert/strict';
import { DeskHealthReportSchema } from '@rai/shared/schemas/observability';
import { t, type LocaleKey } from '@rai/shared/locales/keys';
import {
  OPERATOR_VALUE_KEYS,
  OPERATOR_IDENTITY_REASON_KEYS,
  OPERATOR_LANE_KEYS,
  OPERATOR_MAIL_EVENT_KEYS,
} from './operator-labels.js';

// Discover the actual JSON-schema enum values rather than maintaining a second list of report enums.
function literals(schema: unknown): string[] {
  if (schema === null || typeof schema !== 'object') return [];
  if (Array.isArray(schema)) return schema.flatMap((part: unknown) => literals(part));
  const node = schema as Record<string, unknown>;
  const own = typeof node.const === 'string' ? [node.const] : [];
  if (Array.isArray(node.enum))
    own.push(...node.enum.filter((value: unknown): value is string => typeof value === 'string'));
  return [...own, ...Object.values(node).flatMap(literals)];
}

test('every report enum has a nonempty Thai and English label from the prerequisite contract', () => {
  const keys: Record<string, LocaleKey> = {
    ...OPERATOR_VALUE_KEYS,
    ...OPERATOR_IDENTITY_REASON_KEYS,
    ...OPERATOR_LANE_KEYS,
    ...OPERATOR_MAIL_EVENT_KEYS,
  };
  const values = new Set(literals(DeskHealthReportSchema));
  assert.ok(values.size > 50, 'check the complete report schema, including nested enums');
  for (const value of values) {
    const key = keys[value];
    assert.ok(key, `missing operator label for ${value}`);
    for (const locale of ['th', 'en'] as const) {
      assert.ok(t(locale, key).trim());
      assert.notEqual(t(locale, key), key);
    }
  }
});

test('Ready mail describes desk completion without reusing service-readiness copy', () => {
  assert.notEqual(OPERATOR_MAIL_EVENT_KEYS.ready, OPERATOR_VALUE_KEYS.ready);
  assert.equal(t('en', OPERATOR_MAIL_EVENT_KEYS.ready), 'Desk review complete');
});
