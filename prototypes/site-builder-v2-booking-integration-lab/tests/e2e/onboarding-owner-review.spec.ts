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
const LOGO_PATH = fileURLToPath(new URL(
  '../../../../public/assets/images/clerk-logo-dark.png',
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
  await page.goto('/?audit=1');
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

async function expectRepeatedPreviewScaleRecovery(page: Page, dialog: Locator): Promise<void> {
  const stage = dialog.locator('.onboarding-preview-stage');
  const chooseDevice = async (device: 'Desktop' | 'Phone' | 'Tablet') => {
    await dialog.getByRole('button', { exact: true, name: device }).click();
    await expect(dialog.getByRole('button', { exact: true, name: device }))
      .toHaveAttribute('aria-pressed', 'true');
  };

  await chooseDevice('Phone');
  const initial = await stage.boundingBox();
  expect(initial).not.toBeNull();
  for (let cycle = 0; cycle < 10; cycle += 1) {
    await chooseDevice('Desktop');
    await chooseDevice('Phone');
    await chooseDevice('Tablet');
    await chooseDevice('Phone');
    await expect.poll(async () => {
      const recovered = await stage.boundingBox();
      return Math.max(
        Math.abs((recovered?.height ?? 0) - (initial?.height ?? 0)),
        Math.abs((recovered?.width ?? 0) - (initial?.width ?? 0)),
      );
    }).toBeLessThanOrEqual(2);
  }

  await page.setViewportSize({ height: 390, width: 844 });
  await expect(stage).toBeVisible();
  await page.setViewportSize({ height: 844, width: 390 });
  await expect.poll(async () => {
    const recovered = await stage.boundingBox();
    return Math.max(
      Math.abs((recovered?.height ?? 0) - (initial?.height ?? 0)),
      Math.abs((recovered?.width ?? 0) - (initial?.width ?? 0)),
    );
  }).toBeLessThanOrEqual(2);
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
  await page.getByLabel('Instagram handle').fill('@mias_nails');
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
    await expect(page.getByText('Tell us about your nail business once. Luster turns your details into a polished website where clients can learn about you and book online.'))
      .toBeVisible();
    await expect(page.getByText('Add your details once')).toBeVisible();
    await expect(page.getByText('Start with a ready-made service menu')).toBeVisible();
    await expect(page.getByText('Switch designs without starting over')).toBeVisible();
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
    await page.getByRole('button', { name: /^Contact/u }).click();
    await expect(page.locator('.onboarding-shared-instagram')).toContainText('@mias_nails');

    const bookingOnly = page.getByRole('switch', { name: 'Clients should use online booking only' });
    await bookingOnly.check();
    await expect(page.getByText('Your website will guide clients to Booking and keep your personal contact details private.'))
      .toBeVisible();
    await capture(page, '04-contact-booking-only');
    await bookingOnly.uncheck();

    await page.getByLabel('Phone number clients can use').fill('416-555-0134');
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
    await expect(page.locator('.onboarding-service-menu-card')).toContainText(/\d+ services on your menu/u);
    await page.getByRole('button', { name: 'Review services' }).click();
    const library = page.getByRole('dialog', { name: 'Choose your services' });
    await expect(library).toBeVisible();
    await expect(library.getByText(/\$\d+/u).first()).toBeVisible();
    await expect(library.getByText(/min/u).first()).toBeVisible();
    const selectedBefore = await library.getByRole('button', { name: /^Remove/u }).count();
    expect(selectedBefore).toBeGreaterThan(0);
    await library.getByRole('button', { name: /^Remove/u }).first().click();
    await library.getByRole('button', { name: /^Add /u }).first().click();
    await library.getByRole('button', { name: 'Done' }).click();
    await capture(page, '09-service-library-review');

    await page.getByLabel('How much notice do you need before an appointment?')
      .selectOption('preset:1440');
    await expect(page.getByText('Clients must book at least 1 day before the appointment starts.').first())
      .toBeVisible();
    await expect(page.getByLabel('Booking connection status'))
      .toContainText('Booking cutoffAt least 1 day before the appointment starts');
    await expect(page.getByLabel('Customer booking information preview'))
      .toContainText('Book at least 1 day before your appointment.');
    await expect(page.locator('[data-bookable-time]')).toHaveCount(0);
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
    expect(saved.profile?.instagram).toBe('mias_nails');
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
    await expectRepeatedPreviewScaleRecovery(page, dialog);
    await capture(page, '16-screen-7-working-full-preview');
    await dialog.getByRole('button', { name: 'Close Preview your starting site' }).click();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await expect(startingTrigger).toBeFocused();

    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await page.getByRole('button', { name: 'Open interactive preview' }).click();
    dialog = page.getByRole('dialog', { name: 'Preview your About section' });
    await expectCustomerPreview(dialog, 'about');
    await expectRepeatedPreviewScaleRecovery(page, dialog);
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
    await expectRepeatedPreviewScaleRecovery(page, dialog);
    await expect(dialog.locator('.onboarding-customer-about.is-before-booking')).toBeVisible();
    await capture(page, '20-about-design-preview-positioned');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();

    await applyFixture(page, 'Policies Off', 'Choose your website style');
    await page.getByRole('button', { name: 'View full preview' }).click();
    dialog = page.getByRole('dialog', { name: 'Preview your look' });
    await expectCustomerPreview(dialog, 'top');
    await expectRepeatedPreviewScaleRecovery(page, dialog);
    await capture(page, '23-website-style-full-preview');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();

    await applyFixture(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Open interactive preview' }).click();
    dialog = page.getByRole('dialog', { name: 'Preview your site' });
    await expectCustomerPreview(dialog, 'top');
    await expectRepeatedPreviewScaleRecovery(page, dialog);
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
      .toContainText('Nothing is charged now');
    await planSheet.getByRole('button', { name: 'Continue free' }).click();

    const tour = page.getByRole('dialog', { name: 'A quick look around Luster' });
    await expect(tour).toHaveCount(0);
    const dashboardHeading = heading(page, 'Your Luster site is ready');
    await expect(dashboardHeading).toBeVisible();
    await expect(dashboardHeading).toBeFocused();
    const destinations = page.getByRole('navigation', { name: 'Dashboard destinations' });
    await expect(destinations.getByRole('button', { name: 'Today' }))
      .toHaveAttribute('aria-current', 'page');
    const checklist = page.getByRole('complementary').filter({
      has: page.getByRole('heading', { name: 'What’s next' }),
    });
    await expect(checklist).toContainText('Website created');
    await expect(checklist).toContainText('Booking page ready');
    await expect(checklist).toContainText('Services added');
    await expect(checklist).toContainText('Connect Google Calendar');
    await expect(checklist).toContainText('Not connected');
    await expect(checklist).toContainText('Not shared yet');
    await capture(page, '38-dashboard-checklist');

    await page.locator('.lab-dashboard-preview__welcome')
      .getByRole('button', { name: 'Take a quick tour' })
      .click();
    await expect(tour).toBeVisible();
    await expect(tour.getByLabel('Tour step 1 of 5')).toBeVisible();
    await expect(tour.getByRole('button', { name: 'Skip tour' })).toBeVisible();
    await capture(page, '33-dashboard-tour-1');
    for (let step = 2; step <= 5; step += 1) {
      await tour.getByRole('button', { name: 'Next' }).click();
      await expect(tour.getByLabel(`Tour step ${step} of 5`)).toBeVisible();
      await capture(page, `3${step + 2}-dashboard-tour-${step}`);
    }
    await tour.getByRole('button', { name: 'Done' }).click();
    await expect(tour).toBeHidden();

    await destinations.getByRole('button', { name: 'Website & Booking Page' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Website & Booking Page' }))
      .toBeVisible();
    await page.getByRole('button', { name: 'Edit my website', exact: true }).last().click();
    await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to dashboard' }))
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
    await page.getByLabel('Profile photo', { exact: true }).setInputFiles(PORTRAIT_PATH);
    await page.getByLabel('Logo', { exact: true }).setInputFiles(LOGO_PATH);
    await expect(page.getByLabel('Profile preview').getByRole('img')).toBeVisible();

    await applyFixture(page, 'Canva intent', 'Add something extra');
    await page.getByRole('button', { name: 'Add Gallery' }).click();
    let dialog = page.getByRole('dialog', { name: 'Add Gallery' });
    await dialog.locator('input[type="file"]').setInputFiles(PORTRAIT_PATH);
    await expect(dialog.getByRole('list', { name: 'Gallery image order' }).locator('img'))
      .toBeVisible();
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
