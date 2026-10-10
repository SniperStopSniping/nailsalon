import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import axe from 'axe-core';

type AxeRuntime = typeof axe;

/**
 * Audit settled production components, including alpha backgrounds.
 * Disabled controls follow axe's WCAG rules; nothing is allowlisted.
 */
export async function expectReadableText(page: Page) {
  await page.addScriptTag({ content: axe.source });
  await page.evaluate(() => document.fonts.ready);

  // Entrance animations and colour transitions can be mid-frame when the
  // content becomes visible. Retry the real audit, without disabling styles.
  await expect(async () => {
    const violations = await page.evaluate(async () => {
      const audit = await (window as typeof window & { axe: AxeRuntime }).axe.run(document.body, {
        runOnly: { type: 'rule', values: ['color-contrast'] },
      });
      return audit.violations.flatMap(violation => violation.nodes.map(node => ({
        target: node.target,
        summary: node.failureSummary,
      })));
    });

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }).toPass({ timeout: 5000, intervals: [250, 500] });
}
