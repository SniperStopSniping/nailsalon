import { expect, test } from '@playwright/test';

const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';

test.use({ viewport: { height: 844, width: 390 } });

test.setTimeout(90_000);

test('Screen 7 keeps setup compact while preserving the canonical service library', async ({ page }) => {
  await page.goto('/?audit=1');
  await page.getByRole('button', { name: 'Start with Quick Book' }).click();
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();
  await page.getByRole('dialog', { name: 'Lab review options' })
    .getByRole('button', { exact: true, name: 'Daniela / Isla Nail Studio' }).click();

  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  await page.evaluate((storageKey) => {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      throw new Error('Expected an onboarding draft.');
    }
    const state = JSON.parse(stored) as {
      profile: { serviceMenu: { reviewed: boolean } };
      progress: {
        currentScreen: string;
        lastActiveScreen: string;
        screenHistory: string[];
        visitedScreens: string[];
      };
    };
    state.profile.serviceMenu.reviewed = false;
    state.progress.currentScreen = 'booking_preferences';
    state.progress.lastActiveScreen = 'booking_preferences';
    if (!state.progress.screenHistory.includes('booking_preferences')) {
      state.progress.screenHistory.push('booking_preferences');
    }
    if (!state.progress.visitedScreens.includes('booking_preferences')) {
      state.progress.visitedScreens.push('booking_preferences');
    }
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, ONBOARDING_STORAGE_KEY);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Let’s get you ready to take bookings' }))
    .toBeVisible();
  await expect(page.locator('[data-booking-task]')).toHaveCount(4);
  await expect(page.getByRole('list', { name: 'Selected services' }).getByRole('listitem'))
    .toHaveCount(3);
  await expect(page.getByRole('button', { name: '+ 3 more services' })).toBeVisible();
  await expect(page.getByText('6 services selected · 4 add-ons ready')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your booking setup is ready' }))
    .toHaveCount(0);

  if (process.env.SCREEN7_INITIAL_EVIDENCE) {
    await page.screenshot({ path: process.env.SCREEN7_INITIAL_EVIDENCE });
  }

  await page.getByRole('button', { name: 'Add-ons · Optional 4 add-ons' }).click();
  const library = page.getByRole('dialog', { name: 'Choose your services' });

  await expect(library.getByRole('tab', { name: 'Add-ons' }))
    .toHaveAttribute('aria-selected', 'true');
  await expect(library.getByText('ADD-ONS ARE OPTIONAL')).toBeVisible();
  await expect(library.getByText('4 add-ons added')).toBeVisible();

  await library.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Use these 6 services' }).click();

  await expect(page.locator('[data-booking-task="services"]')).toHaveClass(/is-complete/);
  await expect(page.locator('[data-booking-task="clients"]')
    .getByRole('button', { name: /Clients/ })).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: /Booking notice/ }).click();
  await page.getByRole('combobox', {
    name: 'How much notice do you need before an appointment?',
  }).selectOption('preset:120');
  await page.getByRole('radio', { name: 'No deposit' }).check();

  const ready = page.locator('.onboarding-booking-ready');

  await expect(ready.getByRole('heading', { name: 'Your booking setup is ready' })).toBeVisible();
  await expect(ready.getByText('Appointment only · Accepting new clients', { exact: true }))
    .toBeVisible();
  await expect(ready.getByText('6 services · 4 add-ons', { exact: true })).toBeVisible();
  await expect(ready.getByText('2 hours', { exact: true })).toBeVisible();
  await expect(ready.getByText('No deposit', { exact: true })).toBeVisible();
  await expect(page.locator('[data-booking-task="deposits"]')
    .getByRole('button', { name: /Deposits/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible();
  await expect(page.getByText('You can change any of this later in your dashboard.'))
    .toBeVisible();

  for (const viewport of [
    { height: 568, width: 320 },
    { height: 800, width: 1_180 },
  ]) {
    await page.setViewportSize(viewport);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Save and continue' })).toBeVisible();
  }
  await page.setViewportSize({ height: 844, width: 390 });

  if (process.env.SCREEN7_EVIDENCE) {
    await page.screenshot({ path: process.env.SCREEN7_EVIDENCE });
  }
});
