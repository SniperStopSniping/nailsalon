import { expect, test } from '@playwright/test';

for (const width of [320, 375, 390, 430, 1280]) {
  for (const screen of ['offer', 'salons']) {
    test(`${screen} keeps readable controls within ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/?screen=${screen}`);

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const content = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));

      expect(content.document).toBeLessThanOrEqual(content.viewport);

      for (const button of await page.locator('.luster-entry-button').all()) {
        const box = await button.boundingBox();

        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }
      if (screen === 'offer') {
        await expect(page.getByRole('button', { name: 'Claim my free lifetime plan' })).toBeInViewport();

        await page.getByText('Additional SMS, AI receptionist, phone calls, and other usage-based services are billed separately.').scrollIntoViewIfNeeded();

        await expect(page.getByText('100 free texts included')).toBeVisible();
      }
    });
  }
}

test('salon actions preserve selection, links, cancellation, removal, restoration and logout', async ({ page }) => {
  await page.goto('/?screen=salons');
  const isla = page.getByRole('region', { name: 'Isla Nail Studio', exact: true });

  await expect(isla.getByRole('link', { name: 'Public page' })).toHaveAttribute('href', '/?destination=public');
  await expect(isla.getByRole('link', { name: 'Booking page' })).toHaveAttribute('href', '/?destination=booking');

  await isla.getByRole('button', { name: 'Remove from my list' }).click();

  await expect(isla.getByText(/does not change its booking page/)).toBeVisible();

  await isla.getByRole('button', { name: 'Cancel' }).click();

  await expect(isla.getByRole('button', { name: 'Open dashboard' })).toBeVisible();

  await isla.getByRole('button', { name: 'Remove from my list' }).click();
  await isla.getByRole('button', { name: 'Remove from my list' }).click();

  await expect(isla).toHaveCount(0);

  await page.getByText('Removed salons (2)').click();
  await page.locator('.luster-salon-restore').filter({ hasText: 'Isla Nail Studio' }).getByRole('button', { name: 'Restore' }).click();
  await isla.getByRole('button', { name: 'Open dashboard' }).click();

  await expect(page.getByRole('status')).toHaveText('Opened Isla Nail Studio');

  await page.goto('/?screen=salons');
  await page.getByRole('button', { name: 'Log out' }).click();

  await expect(page.getByRole('status')).toHaveText('Logged out');
});

test('list failure retains the salon and a usable retry', async ({ page }) => {
  await page.goto('/?screen=salons&error=1');
  const isla = page.getByRole('region', { name: 'Isla Nail Studio', exact: true });
  await isla.getByRole('button', { name: 'Remove from my list' }).click();
  await isla.getByRole('button', { name: 'Remove from my list' }).click();

  await expect(page.getByRole('alert')).toHaveText('Could not update the salon list. Try again.');
  await expect(isla.getByRole('button', { name: 'Remove from my list' })).toBeEnabled();
  await expect(isla.getByRole('button', { name: 'Cancel' })).toBeEnabled();
});

test('long names and enlarged text remain usable at narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/?screen=salons&long=1');
  await page.evaluate(() => {
    const sizes = Array.from(document.querySelectorAll<HTMLElement>('.luster-entry :is(h1,h2,p,span,a,button,summary)'))
      .map(element => ({ element, size: Number.parseFloat(getComputedStyle(element).fontSize) }));
    for (const { element, size } of sizes) {
      element.style.fontSize = `${size * 2}px`;
    }
  });
  const overflowingControls = await page.locator('.luster-entry-button').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));

  expect(overflowingControls).toEqual([]);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Open dashboard' }).first().click();

  await expect(page.getByRole('status')).toContainText('Opened Isla Nail Studio');
});

test('offer has one keyboard-accessible action and disables it while saving', async ({ page, browserName }) => {
  await page.goto('/?screen=offer');
  const claim = page.getByRole('button', { name: 'Claim my free lifetime plan' });
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

  await expect(claim).toBeFocused();

  await page.keyboard.press('Enter');

  await expect(page.getByRole('button', { name: 'Saving your claim…' })).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText('Visual review only: no live plan or text credits were changed.');
});

for (const width of [320, 390]) {
  test(`sign-in recovery keeps its notice and retry usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?screen=sign-in-recovery');

    await expect(page.getByRole('alert')).toContainText('Try again.');

    const retry = page.getByRole('button', { name: 'Try again', exact: true });
    const box = await retry.boundingBox();

    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await retry.click();

    await expect(page.getByRole('status')).toHaveText('Opening your workspace…');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
