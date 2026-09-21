// Keyboard-only helpers for the browser layer (W0-02 section 9, items 4 and 5; Lane C, W1-12). Every UI spec
// drives its journey once with the keyboard alone and asserts that the focused element shows a focus ring: a
// non-zero computed outline width or a box-shadow (section 9, item 4).

import { expect, type Page } from '@playwright/test';

export interface FocusedElementInfo {
  tag: string;
  role: string | null;
  text: string;
  outlineWidth: string;
  outlineStyle: string;
  boxShadow: string;
}

/** Reads the active element and the computed styles the focus rule cares about. */
export async function focusedElement(page: Page): Promise<FocusedElementInfo | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || active === document.documentElement) return null;
    const style = getComputedStyle(active);
    return {
      tag: active.tagName.toLowerCase(),
      role: active.getAttribute('role'),
      text: (active as HTMLElement).innerText?.trim() ?? '',
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
    };
  });
}

export function hasVisibleFocusRing(info: FocusedElementInfo): boolean {
  const outlineWidthPx = Number.parseFloat(info.outlineWidth);
  const outline = Number.isFinite(outlineWidthPx) && outlineWidthPx > 0 && info.outlineStyle !== 'none';
  const shadow = info.boxShadow !== 'none' && info.boxShadow !== '';
  return outline || shadow;
}

/** Presses Tab `times` times (Shift+Tab when `backwards`). */
export async function pressTab(page: Page, times = 1, backwards = false): Promise<void> {
  for (let i = 0; i < times; i += 1) await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
}

/** Asserts that something other than the body is focused and that it shows a focus ring. */
export async function expectVisibleFocus(page: Page): Promise<FocusedElementInfo> {
  const info = await focusedElement(page);
  expect(info, 'no element is focused (focus is on the body)').not.toBeNull();
  const focused = info as FocusedElementInfo;
  expect(
    hasVisibleFocusRing(focused),
    `focused <${focused.tag}> "${focused.text}" has no visible focus ring: ${JSON.stringify(focused)}`,
  ).toBe(true);
  return focused;
}

/** Tabs until the element matching `predicate` is focused or `maxSteps` is exhausted; every stop is checked for a ring. */
export async function tabUntil(
  page: Page,
  predicate: (info: FocusedElementInfo) => boolean,
  maxSteps = 50,
): Promise<FocusedElementInfo> {
  for (let step = 0; step < maxSteps; step += 1) {
    await pressTab(page);
    const info = await expectVisibleFocus(page);
    if (predicate(info)) return info;
  }
  throw new Error(`no focusable element matched within ${maxSteps} Tab presses`);
}
