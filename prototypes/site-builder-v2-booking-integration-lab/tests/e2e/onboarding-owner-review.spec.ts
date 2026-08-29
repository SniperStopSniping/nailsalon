import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  startRuntimeMonitor,
} from './helpers';

const EVIDENCE_DIRECTORY = '/tmp/luster-onboarding-owner-review-corrections';
const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';
const PORTRAIT_PATH = fileURLToPath(new URL(
  '../../src/onboarding/fixtures/assets/daniela-placeholder.jpg',
  import.meta.url,
));

const runtimeMonitors = new WeakMap<
  Page,
  ReturnType<typeof startRuntimeMonitor>
>();

const heading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name });

async function capture(page: Page, fileName: string): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: join(EVIDENCE_DIRECTORY, `${fileName}.png`),
  });
}

async function openFresh(page: Page): Promise<void> {
  await page.goto('/');
  await expect(heading(page, 'Let’s build your website')).toBeVisible();
  await expect(page.getByText('Your progress saves automatically on this device.'))
    .toBeVisible();
}

async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');
}

async function openReviewOptions(page: Page): Promise<Locator> {
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lab review options' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function applyFixture(
  page: Page,
  fixtureLabel: string,
  destinationHeading: string,
): Promise<void> {
  if (await heading(page, 'Let’s build your website').isVisible()) {
    await page.getByRole('button', { name: 'Build my website' }).click();
  }
  const dialog = await openReviewOptions(page);
  await dialog.getByRole('button', { exact: true, name: fixtureLabel }).click();
  await expect(dialog).toBeHidden();
  await expect(heading(page, destinationHeading)).toBeVisible();
  await waitForSaved(page);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
}

async function expectCustomerPreview(
  dialog: Locator,
  initialTarget: 'about' | 'top',
): Promise<void> {
  const stage = dialog.locator('[data-preview-interaction="interactive"]');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute('data-preview-initial-target', initialTarget);
  const customer = stage.locator('.onboarding-site-preview');
  await expect(customer).toBeVisible();
  await expect.poll(async () => (await customer.innerText()).trim().length)
    .toBeGreaterThan(100);

  for (const [device, width] of [
    ['Phone', '390px'],
    ['Tablet', '768px'],
    ['Desktop', '1180px'],
  ] as const) {
    await dialog.getByRole('button', { name: device, exact: true }).click();
    await expect(stage).toHaveAttribute('data-preview-device', device.toLowerCase());
    await expect.poll(async () => stage.evaluate((element) =>
      element.style.getPropertyValue('--preview-target-width'))).toBe(width);
  }
}

async function completeBusinessAndPhotoScreens(page: Page): Promise<void> {
  await page.getByLabel('Salon or studio name').fill('Mia’s Nail Studio');
  await page.getByLabel('Your name').fill('Mia Torres');
  await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
    .getByRole('radio', { name: 'Solo nail tech' })
    .check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(heading(page, 'Add your photo and Instagram')).toBeVisible();
  await expect(page.getByRole('group', { name: /Preferred contact/u })).toHaveCount(0);
  await page.getByLabel('Instagram handle (optional)').fill('@mias_nails');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(heading(page, 'Where can clients find you?')).toBeVisible();
}

test.describe('Onboarding owner-review browser acceptance', () => {
  test.beforeEach(async ({ page }) => {
    runtimeMonitors.set(page, startRuntimeMonitor(page));
  });

  test.afterEach(async ({ page }) => {
    const monitor = runtimeMonitors.get(page);
    try {
      monitor?.assertClean();
    } finally {
      monitor?.stop();
      runtimeMonitors.delete(page);
    }
  });

  test('owner copy, shared contact, and bounded Booking adapters form one connected path', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openFresh(page);
    await expect(page.getByText('Tell us about your nail business once. Luster will use your details to create a polished site with booking, policies, contact information, and more.'))
      .toBeVisible();
    await expect(page.getByText('Add your details once')).toBeVisible();
    await expect(page.getByText('Switch designs without starting over')).toBeVisible();
    await expect(page.getByText('Update your whole site from one place')).toBeVisible();
    await capture(page, '01-updated-welcome');

    await page.getByRole('button', { name: 'Build my website' }).click();
    await expect(heading(page, 'Tell us about your nail business')).toBeVisible();
    await expect(page.getByLabel('Business or salon name')).toHaveCount(0);
    await completeBusinessAndPhotoScreens(page);
    await capture(page, '03-photo-instagram-without-contact-choice');

    await page.getByLabel('City or general service area').fill('Hamilton, Ontario');
    await page.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Salon suite' })
      .check();
    await page.getByRole('button', { name: /How should clients contact you/u }).click();
    await expect(page.locator('.onboarding-shared-instagram')).toContainText('@mias_nails');

    const bookingOnly = page.getByRole('switch', { name: 'Clients should use online booking only' });
    await bookingOnly.check();
    await expect(page.getByText('Your website will guide clients to Booking and keep your personal contact details private.'))
      .toBeVisible();
    await capture(page, '04-contact-booking-only');
    await bookingOnly.uncheck();

    await page.getByLabel('Client contact number').fill('416-555-0134');
    await page.getByRole('switch', { name: 'Call this number' }).check();
    await page.getByRole('switch', { name: 'Text this number' }).check();
    const preferred = page.getByRole('group', { name: 'Which contact option should we show first?' });
    await expect(preferred).toBeVisible();
    await preferred.getByRole('radio', { name: 'Text' }).check();
    await capture(page, '05-contact-call-and-text');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(heading(page, 'How do clients book with you?')).toBeVisible();
    await page.getByRole('group', { name: 'How do you accept clients?' })
      .getByRole('radio', { name: 'Appointment only' })
      .check();
    await page.getByRole('group', { name: 'Are you accepting new clients?' })
      .getByRole('radio', { name: 'Yes' })
      .check();
    await expect(page.getByRole('heading', { name: 'Your service menu is ready' })).toBeVisible();
    await expect(page.locator('.onboarding-service-menu-card')).toContainText(/\d+ selected/u);
    await page.getByRole('button', { name: 'Review services' }).click();
    const library = page.getByRole('dialog', { name: 'Service Library' });
    await expect(library).toBeVisible();
    await expect(library.getByText(/\$\d+/u).first()).toBeVisible();
    await expect(library.getByText(/min/u).first()).toBeVisible();
    const selectedBefore = await library.getByRole('button', { name: /^Remove/u }).count();
    expect(selectedBefore).toBeGreaterThan(0);
    await library.getByRole('button', { name: /^Remove/u }).first().click();
    await library.getByRole('button', { name: /^Add service/u }).first().click();
    await library.getByRole('button', { name: 'Done' }).click();
    await capture(page, '09-service-library-review');

    const availableTimes = page.getByLabel(
      'Bookable appointment times after minimum notice',
    );
    await expect(availableTimes.locator('[data-bookable-time="2026-08-27T19:30:00.000Z"]'))
      .toHaveCount(0);
    await expect(availableTimes.locator('[data-bookable-time="2026-08-27T22:30:00.000Z"]'))
      .toBeVisible();
    await page.getByLabel('How much notice do you need before an appointment?')
      .selectOption('preset:1440');
    await expect(availableTimes.locator('[data-bookable-time="2026-08-28T20:30:00.000Z"]'))
      .toBeVisible();
    await expect(availableTimes.locator('[data-bookable-time="2026-08-27T22:30:00.000Z"]'))
      .toHaveCount(0);
    await page.getByRole('group', { name: 'How do you handle booking deposits?' })
      .getByRole('radio', { name: 'Same deposit for every service' })
      .check();
    await page.getByRole('group', { name: 'Deposit amount' })
      .getByRole('radio', { name: '$50' })
      .check();
    await expect(page.getByRole('heading', { name: 'Your Booking settings are connected' }))
      .toBeVisible();
    await expect(page.getByLabel('Booking connection status')).toContainText('1 day');
    await expect(page.getByLabel('Booking connection status')).toContainText('$50');
    await capture(page, '14-booking-connected-summary');
    await page.getByRole('button', { name: /Save booking/u }).click();
    await expect(heading(page, 'Choose your starting point')).toBeVisible();
    await waitForSaved(page);

    const saved = await page.evaluate((key) => JSON.parse(
      window.localStorage.getItem(key) ?? '{}',
    ) as {
      profile?: {
        bookingPreferences?: { minimumNoticeMinutes?: number };
        instagram?: string;
        policies?: { deposits?: { amountCents?: number; mode?: string } };
        serviceMenu?: { selectedServiceIds?: string[] };
      };
    }, ONBOARDING_STORAGE_KEY);
    expect(saved.profile?.instagram).toBe('@mias_nails');
    expect(saved.profile?.bookingPreferences?.minimumNoticeMinutes).toBe(1_440);
    expect(saved.profile?.policies?.deposits).toMatchObject({
      amountCents: 5_000,
      mode: 'fixed',
    });
    expect(new Set(saved.profile?.serviceMenu?.selectedServiceIds).size)
      .toBe(saved.profile?.serviceMenu?.selectedServiceIds?.length);
    await expectNoHorizontalOverflow(page);
  });

  test('Screens 7, 8, 9, 11, and 13 share one non-blank full-customer Preview', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openFresh(page);
    await applyFixture(page, 'Multi-page starter', 'Your starting site is ready');

    const startingTrigger = page.getByRole('button', { name: 'Preview my site' });
    await startingTrigger.click();
    let dialog = page.getByRole('dialog', { name: 'Preview your starting site' });
    await expectCustomerPreview(dialog, 'top');
    await capture(page, '16-screen-7-working-full-preview');
    await dialog.getByRole('button', { name: 'Close Preview your starting site' }).click();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await expect(startingTrigger).toBeFocused();

    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await page.getByRole('button', { name: 'Open interactive preview' }).click();
    dialog = page.getByRole('dialog', { name: 'Preview your About section' });
    await expectCustomerPreview(dialog, 'about');
    await expect(dialog.locator('[data-preview-target="about"]')).toBeVisible();
    await capture(page, '18-about-information-full-preview');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();

    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expect(heading(page, 'Choose your About design')).toBeVisible();
    await page.getByRole('button', { name: /^About \+ Before You Book/u }).click();
    await expect(page.getByRole('button', { name: /^About \+ Before You Book/u }))
      .toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Open interactive preview' }).click();
    dialog = page.getByRole('dialog', { name: 'Preview your About section' });
    await expectCustomerPreview(dialog, 'about');
    await expect(dialog.locator('.onboarding-customer-about.is-before-booking')).toBeVisible();
    await capture(page, '20-about-design-preview-positioned');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();

    await applyFixture(page, 'Policies Off', 'Choose your website style');
    await page.getByRole('button', { name: 'View full preview' }).click();
    dialog = page.getByRole('dialog', { name: 'Preview your look' });
    await expectCustomerPreview(dialog, 'top');
    await capture(page, '23-website-style-full-preview');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();

    await applyFixture(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Open interactive preview' }).click();
    dialog = page.getByRole('dialog', { name: 'Preview your site' });
    await expectCustomerPreview(dialog, 'top');
    await capture(page, '29-final-review-interactive-preview');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(heading(page, 'Review your site')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('Continue free pays off in the isolated dashboard handoff, tour, and state-derived checklist', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await openFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Finish setup' }).click();
    const planSheet = page.getByRole('dialog', { name: 'Your site is saved' });
    await expect(planSheet).toBeVisible();
    await expect(planSheet.locator('.dialog-header p'))
      .toContainText('You won’t be charged today.');
    await planSheet.getByRole('button', { name: 'Continue free' }).click();

    const tour = page.getByRole('dialog', { name: 'Welcome to your Luster workspace' });
    await expect(tour).toBeVisible();
    await expect(tour.getByText('1 of 5')).toBeVisible();
    await expect(tour.getByRole('button', { name: 'Skip tour' })).toBeVisible();
    await capture(page, '33-dashboard-tour-1');
    await tour.getByRole('button', { name: 'Skip tour' }).click();

    const dashboardHeading = heading(page, 'Welcome to Luster, Daniela');
    await expect(dashboardHeading).toBeVisible();
    await expect(dashboardHeading).toBeFocused();
    await expect(page.getByText('Dashboard preview · UX Lab · Changes stay on this device'))
      .toBeVisible();
    const destinations = page.getByRole('navigation', { name: 'Dashboard preview destinations' });
    await expect(destinations.getByRole('button', { name: 'Today' }))
      .toHaveAttribute('aria-current', 'page');
    const checklist = page.getByRole('complementary').filter({
      has: page.getByRole('heading', { name: 'Finish setting up Luster' }),
    });
    await expect(checklist).toContainText('Website created');
    await expect(checklist).toContainText('Booking page ready');
    await expect(checklist).toContainText('Services added');
    await expect(checklist).toContainText('Connect Google Calendar');
    await expect(checklist).toContainText('Not connected');
    await capture(page, '38-dashboard-checklist');

    await page.getByRole('button', { name: 'Replay tour' }).click();
    await expect(tour).toBeVisible();
    for (let step = 2; step <= 5; step += 1) {
      await tour.getByRole('button', { name: 'Next' }).click();
      await expect(tour.getByText(`${step} of 5`)).toBeVisible();
      await capture(page, `3${step + 2}-dashboard-tour-${step}`);
    }
    await tour.getByRole('button', { name: /Go to dashboard|Done/u }).click();
    await expect(tour).toBeHidden();

    await destinations.getByRole('button', { name: 'Website & Booking Page' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Website & Booking Page' }))
      .toBeVisible();
    await page.getByRole('button', { name: 'Edit website', exact: true }).first().click();
    await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to dashboard preview · Lab' }))
      .toBeVisible();
    await capture(page, '39-website-booking-page-destination');
  });

  test('representative phone, short-landscape, tablet, and desktop layouts remain contained', async ({ page }) => {
    await openFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');
    for (const viewport of [
      { height: 568, width: 320 },
      { height: 600, width: 375 },
      { height: 844, width: 390 },
      { height: 932, width: 430 },
      { height: 390, width: 844 },
      { height: 430, width: 932 },
      { height: 1024, width: 768 },
      { height: 800, width: 1180 },
      { height: 900, width: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo({ left: 0, top: 0 }));
      await expect(heading(page, 'Review your site')).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test('@webkit-smoke profile, logo, Gallery, and Canva reuse the shared image paths', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openFresh(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await page.getByLabel('Salon or studio name').fill('WebKit Nail Studio');
    await page.getByLabel('Your name').fill('Avery');
    await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
      .getByRole('radio', { name: 'Solo nail tech' })
      .check();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Profile photo (optional)').setInputFiles(PORTRAIT_PATH);
    await page.getByLabel('Logo (optional)').setInputFiles(PORTRAIT_PATH);
    await expect(page.getByLabel('Profile preview').getByRole('img')).toBeVisible();

    await applyFixture(page, 'Canva intent', 'Add something extra');
    await page.getByRole('button', { name: 'Add Gallery' }).click();
    let dialog = page.getByRole('dialog', { name: 'Add Gallery' });
    await dialog.locator('input[type="file"]').setInputFiles(PORTRAIT_PATH);
    await expect(dialog.locator('.onboarding-upload-thumbnails img')).toBeVisible();
    await dialog.getByRole('button', { exact: true, name: 'Add Gallery' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Upload Canva design' }).click();
    dialog = page.getByRole('dialog', { name: 'Upload a Canva design' });
    await dialog.locator('input[type="file"]').setInputFiles(PORTRAIT_PATH);
    await expect(dialog.getByRole('list', { name: 'Selected Canva pages' }))
      .toContainText('daniela-placeholder.jpg');
    await dialog.getByRole('button', { name: 'Add Canva design' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);

    const localStorageContainsImageBytes = await page.evaluate(() =>
      Object.values(window.localStorage).some((value) =>
        value.includes('data:image') || value.includes('iVBOR')));
    expect(localStorageContainsImageBytes).toBe(false);
    await page.reload();
    await expect(heading(page, 'Add something extra')).toBeVisible();
    const addedCards = page.locator('.onboarding-extra-card.is-added');
    await expect(addedCards.filter({ hasText: 'Show off your work' })).toContainText('Added');
    await expect(addedCards.filter({ hasText: 'Already have a Canva design?' }))
      .toContainText('Added');
  });
});
