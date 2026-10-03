import { expect, test } from '@playwright/test';

test('owner can configure the immediate confirmation prompt and the switch stays inside its track', async ({ page }) => {
  const updates: unknown[] = [];
  let savedSettings = {
    enabled: false,
    intervalWeeks: 3,
    message: 'Secure your next spot now.',
  };
  await page.route('**/api/admin/rebooking-prompt?*', async (route) => {
    if (route.request().method() === 'PATCH') {
      savedSettings = route.request().postDataJSON();
      updates.push(savedSettings);
    }
    return route.fulfill({ json: { data: { settings: savedSettings } } });
  });
  await page.goto('/?rebooking-settings');
  const toggle = page.getByRole('switch', { name: 'Turn on Rebooking Prompt' });
  const thumb = toggle.locator('> span > span');

  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 720 });
    const contained = await toggle.evaluate((switchElement) => {
      const track = switchElement.querySelector('span')!.getBoundingClientRect();
      const knob = switchElement.querySelector('span > span')!.getBoundingClientRect();
      return knob.left >= track.left && knob.right <= track.right;
    });

    expect(contained).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await expect(page.getByText('Why not book your next visit now?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Rebooking Prompt' })).toBeDisabled();
  expect(await toggle.evaluate(el => el.getBoundingClientRect().height >= 44)).toBe(true);

  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 720 });
    const contained = await toggle.evaluate((switchElement) => {
      const track = switchElement.querySelector('span')!.getBoundingClientRect();
      const knob = switchElement.querySelector('span > span')!.getBoundingClientRect();
      return knob.left >= track.left && knob.right <= track.right;
    });

    expect(contained).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await expect(thumb).toBeVisible();

  await page.getByLabel('Recommended visit interval').fill('4');
  await page.getByLabel('Encouragement message').fill('x'.repeat(300));
  await page.setViewportSize({ width: 320, height: 720 });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByLabel('Encouragement message').fill('Reserve your preferred time today.');
  await page.getByRole('button', { name: 'Save Rebooking Prompt' }).click();

  await expect(page.getByText('Rebooking Prompt saved.')).toBeVisible();
  expect(updates).toEqual([{
    enabled: true,
    intervalWeeks: 4,
    message: 'Reserve your preferred time today.',
  }]);

  await page.reload();

  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Recommended visit interval')).toHaveValue('4');
  await expect(page.getByLabel('Encouragement message')).toHaveValue('Reserve your preferred time today.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
