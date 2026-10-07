import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1280]) {
  test(`current onboarding reaches one founding claim at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? route.continue() : route.abort();
    });
    await page.goto('/?audit=1');
    await page.getByRole('button', { name: 'Start with Quick Book' }).click();
    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Lab review options' }).click();
    await page.getByRole('dialog', { name: 'Lab review options' })
      .getByRole('button', { name: 'All essentials complete', exact: true }).click();
    const finish = page.getByRole('button', { name: 'Finish setup' });
    await finish.click();
    const dialog = page.getByRole('dialog', { name: 'Your site is ready' });

    await expect(dialog.getByRole('heading', { name: 'Your site is ready', exact: true })).toBeFocused();
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await expect(dialog.getByText('100 free texts included')).toBeVisible();
    await expect(dialog.getByText('Unlimited emails')).toBeVisible();

    const action = dialog.getByRole('button', { name: 'Claim my free lifetime plan' });

    await expect(action).toHaveCount(1);
    await expect(action).toBeInViewport();

    const geometry = await dialog.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));

    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);

    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    await expect(finish).toBeFocused();

    await finish.click();
    await action.click();

    await expect(page.getByRole('heading', { name: 'Your Luster site is ready', exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('luster:onboarding-v1-lab')!).planOffer.planIntent)).toBe('founding');
  });
}
