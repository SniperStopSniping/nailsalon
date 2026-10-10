import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

for (const screen of ['offer', 'salons', 'sign-in-recovery']) {
  test(`${screen} keeps owner entry copy readable`, async ({ page }) => {
    await page.goto(`/?screen=${screen}`);

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await expectReadableText(page);
  });
}

test('sign-in input edges survive later provider styles without masking errors', async ({ page }) => {
  await page.goto('/?screen=sign-in-recovery');
  await page.evaluate(() => {
    const providerStyles = document.createElement('style');
    providerStyles.textContent = '.provider-field { border: 0 solid rgb(227, 225, 225); } .provider-field[aria-invalid="true"] { border: 1px solid rgb(180, 35, 67); }';
    document.head.append(providerStyles);
    const input = document.createElement('input');
    input.className = 'luster-auth-input provider-field';
    input.setAttribute('aria-label', 'Provider input contrast fixture');
    input.setAttribute('aria-invalid', 'false');
    document.querySelector('.luster-entry')!.append(input);
  });
  const field = page.getByRole('textbox', { name: 'Provider input contrast fixture' });

  await expect(field).toHaveCSS('border-color', 'rgb(157, 122, 136)');
  await expect(field).toHaveCSS('border-width', '1px');
  await expect(field).toHaveCSS('border-style', 'solid');

  await field.focus();

  await expect(field).toHaveCSS('border-color', 'rgb(157, 122, 136)');
  await expect(field).toHaveCSS('border-width', '1px');
  await expect(field).toHaveCSS('border-style', 'solid');

  await field.evaluate(input => input.setAttribute('aria-invalid', 'true'));

  await expect(field).toHaveCSS('border-color', 'rgb(180, 35, 67)');
  await expect(field).toHaveCSS('border-width', '1px');
});
