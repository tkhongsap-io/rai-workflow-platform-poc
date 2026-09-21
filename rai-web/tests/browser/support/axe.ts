// Automated accessibility audit for the browser layer (W0-02 section 9, items 2 and 6; Lane C owns this helper,
// W1-12). axe-core through @axe-core/playwright with the five WCAG tag sets, run at the end of every spec on
// every screen state it reaches. "Done when" for a UI ticket is zero critical and zero serious violations;
// moderate and minor are attached to the report for the PR to list. The full result is attached to the test so
// the CI run carries it (section 9, item 6).

import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;
export const BLOCKING_IMPACTS = ['critical', 'serious'] as const;

export type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
export type AxeViolation = AxeResults['violations'][number];

export interface AuditOptions {
  /** Names the screen state in the attachment (`axe-<name>.json`). */
  name: string;
  /** When given, the `<html lang>` attribute must equal it before the audit runs (section 9, item 8). */
  lang?: 'th' | 'en';
}

/** Runs the audit, attaches the JSON result, and returns it without asserting. */
export async function auditAccessibility(
  page: Page,
  testInfo: TestInfo,
  options: AuditOptions,
): Promise<AxeResults> {
  if (options.lang !== undefined) {
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang, `<html lang> is ${JSON.stringify(lang)}, the spec expects ${options.lang}`).toBe(
      options.lang,
    );
  }
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  await testInfo.attach(`axe-${options.name}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  for (const violation of results.violations) {
    if (!isBlocking(violation)) {
      testInfo.annotations.push({
        type: 'axe-non-blocking',
        description: `${options.name}: ${violation.id} (${violation.impact ?? 'unknown'}) × ${violation.nodes.length}`,
      });
    }
  }
  return results;
}

export function isBlocking(violation: AxeViolation): boolean {
  return (
    violation.impact !== null &&
    violation.impact !== undefined &&
    (BLOCKING_IMPACTS as readonly string[]).includes(violation.impact)
  );
}

export function blockingViolations(results: AxeResults): AxeViolation[] {
  return results.violations.filter(isBlocking);
}

/** One line per blocking violation, for the assertion message. */
export function describeViolations(violations: readonly AxeViolation[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} [${v.impact ?? 'unknown'}] ${v.help}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    )
    .join('\n');
}

/** Audits and fails the test on any critical or serious violation. */
export async function expectAccessible(
  page: Page,
  testInfo: TestInfo,
  options: AuditOptions,
): Promise<AxeResults> {
  const results = await auditAccessibility(page, testInfo, options);
  const blocking = blockingViolations(results);
  expect(
    blocking,
    `blocking accessibility violations on ${options.name}:\n${describeViolations(blocking)}`,
  ).toEqual([]);
  return results;
}

/** Section 9, item 2: status is never colour-only; every `[data-status]` element carries visible text. */
export async function expectStatusElementsHaveText(page: Page): Promise<void> {
  const statuses = page.locator('[data-status]');
  const count = await statuses.count();
  for (let i = 0; i < count; i += 1) {
    const element = statuses.nth(i);
    const status = await element.getAttribute('data-status');
    const text = (await element.innerText()).trim();
    expect(text, `[data-status="${status ?? ''}"] has no visible text`).not.toBe('');
  }
}
