import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  readCustomDesignAssetRecordCounts,
  startRuntimeMonitor,
} from './helpers';

const EVIDENCE_ROOT = process.env.LUSTER_EVIDENCE_DIRECTORY
  ?? '/tmp/luster-onboarding-physical-iphone-final';
const EVIDENCE_DIRECTORY = `${EVIDENCE_ROOT}/evidence`;
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

type StoredOnboardingState = {
  canva: {
    images: Array<{ fileName: string; storageId?: string }>;
  };
  gallery: {
    images: Array<{ fileName: string; id: string; storageId?: string }>;
    layout: 'carousel' | 'editorial' | 'grid';
    source: string | null;
  };
  profile: {
    businessName: string;
    serviceMenu: {
      selectedAddOnIds?: string[];
      selectedServiceIds: string[];
    };
  };
  recipe: {
    canvaEnabled: boolean;
    galleryEnabled: boolean;
  };
  reviewOptions: {
    feedbackMilestones: string[];
  };
};

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

async function captureViewport(page: Page, fileName: string): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: false,
    path: join(EVIDENCE_DIRECTORY, `${fileName}.png`),
  });
}

async function captureLocator(locator: Locator, fileName: string): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await locator.screenshot({
    animations: 'disabled',
    path: join(EVIDENCE_DIRECTORY, `${fileName}.png`),
  });
}

async function captureJson(fileName: string, value: unknown): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await writeFile(
    join(EVIDENCE_DIRECTORY, `${fileName}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

async function captureText(fileName: string, value: string): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await writeFile(join(EVIDENCE_DIRECTORY, fileName), value, 'utf8');
}

async function openNormalFresh(page: Page): Promise<void> {
  await page.goto('/');
  await expect(heading(page, 'Choose your starting point')).toBeVisible();
}

async function openAuditFresh(page: Page): Promise<void> {
  await page.goto('/?audit=1');
  await expect(heading(page, 'Choose your starting point')).toBeVisible();
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

type StarterCta = 'Multi-page' | 'One-page' | 'Quick Book';

/**
 * The starting-point entry is now the first onboarding screen. Choosing a card
 * plays a short selection beat before the flow advances; awaiting the next
 * heading absorbs it without a manual wait.
 */
async function chooseStartingPoint(page: Page, cta: StarterCta): Promise<void> {
  await page.getByRole('button', { name: `Start with ${cta}` }).click();
  await expect(heading(page, 'Make it yours')).toBeVisible();
}

async function applyFixture(
  page: Page,
  fixtureLabel: string,
  destinationHeading: string,
): Promise<void> {
  // Lab review options live in the onboarding shell, and the starting-point
  // entry renders outside that shell, so leave the entry before opening them.
  const entryOrShell = heading(page, 'Choose your starting point')
    .or(page.getByLabel('More onboarding options'));
  await expect(entryOrShell).toBeVisible();
  if (await heading(page, 'Choose your starting point').isVisible()) {
    await chooseStartingPoint(page, 'One-page');
  }
  const dialog = await openReviewOptions(page);
  await dialog.getByRole('button', { exact: true, name: fixtureLabel }).click();
  await expect(dialog).toBeHidden();
  await expect(heading(page, destinationHeading)).toBeVisible();
  await waitForSaved(page);
}

async function readState(page: Page): Promise<StoredOnboardingState> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Missing onboarding state.');
    return JSON.parse(raw) as StoredOnboardingState;
  }, ONBOARDING_STORAGE_KEY);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function delayThumbnailGeneration(page: Page, delayMs = 550): Promise<void> {
  await page.evaluate((delay) => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function delayedToBlob(
      callback,
      type,
      quality,
    ) {
      window.setTimeout(() => original.call(this, callback, type, quality), delay);
    };
  }, delayMs);
}

/**
 * Photo, logo and Instagram moved from the removed photo_social screen into a
 * collapsible Branding card on "Make it yours". The card only starts open when
 * branding data already exists, so open it before touching those fields.
 */
async function openBrandingCard(page: Page): Promise<Locator> {
  const trigger = page.locator('button[aria-controls="onboarding-branding-card-panel"]');
  await expect(trigger).toBeVisible();
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  return trigger;
}

async function fillBrandBasics(page: Page, businessName: string): Promise<void> {
  await page.getByLabel('Salon or studio name').fill(businessName);
  await page.getByLabel('Your name').fill('Daniela');
  await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
    .getByRole('radio', { name: 'Solo nail tech' })
    .check();
}

async function reachBrandBasics(page: Page): Promise<void> {
  await chooseStartingPoint(page, 'One-page');
  await fillBrandBasics(page, 'Daniela Upload Studio');
}

/** "Make it yours" now hands off to the starting-site reveal before Location. */
async function continueToLocationScreen(page: Page): Promise<void> {
  await page.getByRole('button', { exact: true, name: 'Continue' }).click();
  await expect(heading(page, 'Your starting site is ready')).toBeVisible();
  await page.getByRole('button', { name: 'Continue setting up my site' }).click();
  await expect(heading(page, 'Where can clients find you?')).toBeVisible();
}

async function reachLocationScreen(page: Page): Promise<void> {
  await reachBrandBasics(page);
  await continueToLocationScreen(page);
}

async function completeBasicsToBooking(page: Page): Promise<void> {
  await fillBrandBasics(page, 'Daniela Test Studio');
  await continueToLocationScreen(page);
  await page.getByLabel('City or general service area').fill('Toronto, Ontario');
  await page.getByRole('group', { name: 'Where do you see clients?' })
    .getByRole('radio', { name: 'Salon suite' })
    .check();
  await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
  await expect(page.getByRole('switch', { name: 'Clients should use online booking only' }))
    .toBeChecked();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(heading(page, 'How do clients book with you?')).toBeVisible();
}

/**
 * Fixture states that land on the starting-site reveal now sit before Location
 * and Booking, so walk their already-complete essentials to reach About.
 */
async function continueFromStartingPreviewToAbout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue setting up my site' }).click();
  await expect(heading(page, 'Where can clients find you?')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(heading(page, 'How do clients book with you?')).toBeVisible();
  await page.getByRole('button', { name: 'Save booking setup' }).click();
  await expect(heading(page, 'Would you like an About section?')).toBeVisible();
}

test.describe('Daniela-final onboarding acceptance', () => {
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

  test('normal owner mode hides fixture and Lab-only controls', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    // The starting-point entry renders outside the shell: no Lab controls and
    // no shell chrome are available before a starting point is chosen.
    await expect(page.getByLabel('More onboarding options')).toHaveCount(0);
    await expect(page.getByLabel('Autosave status')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Onboarding progress' }))
      .toHaveCount(0);
    await expect(page.getByText('These fixtures affect only this browser-local onboarding Lab.'))
      .toHaveCount(0);
    await chooseStartingPoint(page, 'One-page');

    const more = page.getByLabel('More onboarding options');
    await more.click();
    const menu = page.getByRole('menu', { name: 'More onboarding options' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Save and finish later' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Start over/u })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Lab review options' })).toHaveCount(0);
    await expect(page.getByText('These fixtures affect only this browser-local onboarding Lab.'))
      .toHaveCount(0);
    await captureViewport(page, '01-normal-mode-no-lab-controls');

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
    await expectNoHorizontalOverflow(page);
  });

  test('physical-iPhone proxy shows processing, accepted thumbnails, and a precise photo failure', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await reachBrandBasics(page);
    await openBrandingCard(page);
    await delayThumbnailGeneration(page);

    const profileField = page.locator('.onboarding-image-upload').filter({
      has: page.getByText('Profile photo', { exact: true }),
    });
    const profileUpload = page.getByLabel('Profile photo', { exact: true })
      .setInputFiles(PORTRAIT_PATH);
    await expect(profileField.getByRole('status')).toContainText('Processing photo…');
    await expect(profileField.getByRole('status')).toContainText('daniela-placeholder.jpg');
    await captureLocator(profileField, '01-profile-processing');
    await profileUpload;
    await expect(profileField.getByRole('status')).toContainText('Profile photo ready');
    await expect(profileField.locator('img')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Your site so far' }).getByRole('img'))
      .toBeVisible();
    await captureLocator(profileField, '02-profile-thumbnail-ready');

    const logoField = page.locator('.onboarding-image-upload').filter({
      has: page.getByText('Logo', { exact: true }),
    });
    await page.getByLabel('Logo', { exact: true }).setInputFiles(LOGO_PATH);
    await expect(logoField.getByRole('status')).toContainText('Logo ready');
    await expect(logoField.locator('img')).toBeVisible();
    await captureLocator(logoField, '03-logo-ready');

    await page.getByLabel('Profile photo', { exact: true }).setInputFiles({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]),
      mimeType: 'image/jpeg',
      name: 'IMG_5222.jpeg',
    });
    const failure = profileField.getByRole('alert');
    await expect(failure).toContainText('IMG_5222.jpeg');
    await expect(failure).toContainText(
      'This photo couldn’t be read. Try selecting it again or choose another copy.',
    );
    await expect(failure.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(failure.getByRole('button', { name: 'Choose another image' })).toBeVisible();
    await captureLocator(profileField, '03b-profile-precise-failure');
    await expectNoHorizontalOverflow(page);
  });

  test('a private-storage-style denial keeps the image out of state and explains recovery', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await reachBrandBasics(page);
    await openBrandingCard(page);
    await waitForSaved(page);
    await page.evaluate(() => {
      IDBDatabase.prototype.transaction = function deniedTransaction() {
        throw new DOMException('Private storage is unavailable.', 'SecurityError');
      };
    });

    const profileField = page.locator('.onboarding-image-upload').filter({
      has: page.getByText('Profile photo', { exact: true }),
    });
    await page.getByLabel('Profile photo', { exact: true }).setInputFiles(PORTRAIT_PATH);

    const failure = profileField.getByRole('alert');
    await expect(failure).toContainText('daniela-placeholder.jpg');
    await expect(failure).toContainText(
      'This browser tab isn’t allowing Luster to save images. If you’re using a private tab, open this page in a regular tab and try again.',
    );
    await expect(profileField.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Your site so far' }).getByRole('img'))
      .toHaveCount(0);
    const state = await readState(page);
    expect((state.profile as StoredOnboardingState['profile'] & {
      profileImage?: unknown;
    }).profileImage).toBeUndefined();
    await captureLocator(profileField, '07-private-storage-failure');
    await expectNoHorizontalOverflow(page);
  });

  test('bulk hours apply once, reject inverted times, and distinguish Set up from Complete', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await reachLocationScreen(page);

    const trigger = page.locator('button[aria-controls="onboarding-hours-card-panel"]');
    const card = trigger.locator('..');
    const stateBadge = trigger.locator('.onboarding-collapsible-card__state');
    await expect(stateBadge).toContainText('Set up');
    await expect(card).toHaveClass(/is-set_up/u);
    const setUpTreatment = await stateBadge.evaluate((element) => {
      const styles = getComputedStyle(element);
      return { backgroundColor: styles.backgroundColor, color: styles.color };
    });

    await trigger.click();
    await expect(page.getByRole('heading', { name: 'Set your regular hours' })).toBeVisible();
    await page.getByRole('radio', { name: 'Monday–Saturday' }).check();
    await captureViewport(page, '08-hours-common-presets');
    await page.getByRole('combobox', { name: 'Opens' }).selectOption('10:30');
    const closes = page.getByRole('combobox', { name: 'Closes' });
    await closes.selectOption('09:30');
    await page.getByRole('button', { name: 'Apply to selected days' }).click();
    await expect(page.getByRole('alert')).toHaveText('Closing time must be later than opening time.');
    await expect(closes).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Adjust individual days' })).toHaveCount(0);
    await captureViewport(page, '11-hours-invalid-interval');

    await page.getByRole('combobox', { name: 'Opens' }).selectOption('10:00');
    await closes.selectOption('21:00');
    await page.getByRole('button', { name: 'Apply to selected days' }).click();
    const individualDays = page.locator('.onboarding-individual-hours');
    await expect(page.getByRole('heading', { name: 'Adjust individual days' })).toBeVisible();
    await expect(individualDays.getByText('Monday', { exact: true })).toBeVisible();
    await expect(individualDays.getByText('10:00 AM–9:00 PM', { exact: true }).first())
      .toBeVisible();
    await captureViewport(page, '09-hours-apply-selected');

    await page.getByRole('button', { name: 'Edit Sunday hours' }).click();
    await page.getByRole('checkbox', { name: 'Closed' }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(individualDays.getByText('Sunday', { exact: true })).toBeVisible();
    await expect(individualDays.getByText('Closed', { exact: true })).toBeVisible();
    await capture(page, '10-hours-individual-rows');

    await expect(stateBadge).toContainText('Complete');
    await expect(card).toHaveClass(/is-complete/u);
    const completeTreatment = await stateBadge.evaluate((element) => {
      const styles = getComputedStyle(element);
      return { backgroundColor: styles.backgroundColor, color: styles.color };
    });
    expect(completeTreatment).not.toEqual(setUpTreatment);
    await captureLocator(card, '12-hours-complete');
    await waitForSaved(page);
    await page.reload();
    await expect(heading(page, 'Where can clients find you?')).toBeVisible();
    await expect(page.locator('button[aria-controls="onboarding-hours-card-panel"]')
      .locator('.onboarding-collapsible-card__state')).toContainText('Complete');
  });

  test('V01 complete Daniela onboarding journey with truthful setup states', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await chooseStartingPoint(page, 'One-page');
    // The starting-site milestone now lands on "Make it yours", and the screen
    // tells the owner which starting point it is building on.
    await expect(page.locator('.onboarding-feedback')).toContainText(
      'Your starting site is ready',
      { timeout: 6_000 },
    );
    await expect(page.getByText('One-page website · Change it anytime')).toBeVisible();
    await expect(page.getByText('4 required steps left')).toBeVisible();
    await page.getByLabel('Salon or studio name').fill('Isla Nail Studio');
    await page.getByLabel('Your name').fill('Daniela');
    await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
      .getByRole('radio', { name: 'Solo nail tech' })
      .check();
    // Branding replaces the removed photo screen and stays optional inline.
    const brandingState = page
      .locator('button[aria-controls="onboarding-branding-card-panel"]')
      .locator('.onboarding-collapsible-card__state');
    await expect(page.getByText('Photo, logo and Instagram · Optional')).toBeVisible();
    await expect(brandingState).toContainText('Set up');
    await openBrandingCard(page);
    await page.getByLabel('Profile photo', { exact: true }).setInputFiles(PORTRAIT_PATH);
    await page.getByLabel('Instagram handle').fill('@islanail.studio');
    await expect(brandingState).toContainText('Complete');
    const identity = page.getByRole('group', { name: 'Your site so far' });
    await expect(identity.getByRole('img')).toBeVisible();
    await expect(identity).toContainText('Isla Nail Studio');
    await expect(identity).toContainText('@islanail.studio');
    await expect(page.locator('[data-testid="starter-preview-one_page"]'))
      .toHaveAttribute('data-preview-state', 'poster');
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await captureViewport(page, '36-starting-site-reveal');
    await waitForSaved(page);
    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    await expect(heading(page, 'Where can clients find you?')).toBeVisible();

    await capture(page, '02-location-accordion-states');
    await page.getByLabel('City or general service area').fill('Scarborough, Ontario');
    await page.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Salon suite' })
      .check();
    await captureViewport(page, '02b-location-complete-supporting');
    await page.getByRole('group', { name: 'Who can see your address?' })
      .getByRole('radio', { name: 'Show publicly' })
      .check();
    await page.getByRole('switch', { name: 'Allow directions to my general service area' })
      .check();
    const arrival = page.getByText('Arrival details · Optional', { exact: true });
    await arrival.click();
    await page.getByLabel('Parking').fill('Visitor parking is available beside the entrance.');
    await capture(page, '03-directions-arrival-spacing');

    await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
    const bookingOnly = page.getByRole('switch', { name: 'Clients should use online booking only' });
    await bookingOnly.uncheck();
    await captureViewport(page, '04a-contact-set-up-supporting');
    await page.getByLabel('Phone number clients can use').fill('416-555-0142');
    await page.getByRole('switch', { name: 'Call this number' }).check();
    await page.getByRole('switch', { name: 'Text this number' }).check();
    await page.getByRole('group', { name: 'Which contact option should we show first?' })
      .getByRole('radio', { name: 'Text' })
      .check();
    await expect(page.locator('button[aria-controls="onboarding-contact-card-panel"]')
      .locator('.onboarding-collapsible-card__state')).toContainText('Complete');
    await expect(page.locator('.onboarding-feedback')).toContainText('Basics complete');
    await captureViewport(page, '34-accordion-completion-interaction');
    await capture(page, '04-contact-setup-complete');

    await page.locator('button[aria-controls="onboarding-hours-card-panel"]').click();
    await captureViewport(page, '05a-hours-set-up-supporting');
    await page.getByRole('radio', { name: 'Monday–Friday' }).check();
    await page.getByRole('combobox', { name: 'Opens' }).selectOption('09:00');
    await page.getByRole('combobox', { name: 'Closes' }).selectOption('17:00');
    await page.getByRole('button', { name: 'Apply to selected days' }).click();
    await expect(page.getByRole('button', { name: 'Edit Saturday hours' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Sunday hours' })).toBeVisible();
    await capture(page, '05b-hours-complete-supporting');
    const showHours = page.getByRole('switch', { name: 'Show hours on my website' });
    await showHours.uncheck();
    await capture(page, '05-hours-setup-not-shown-complete');
    await showHours.check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await captureViewport(page, '35-basics-stage-complete');

    await page.getByRole('group', { name: 'How do you accept clients?' })
      .getByRole('radio', { name: 'Appointment only' })
      .check();
    await page.getByRole('group', { name: 'Are you accepting new clients?' })
      .getByRole('radio', { name: 'Yes' })
      .check();
    // Booking is its own stage now that the starting point moved to the front.
    await expect(page.locator('.onboarding-feedback')).toContainText('Booking is ready');
    await page.getByRole('button', { name: /Continue with these/u }).click();
    await page.getByLabel('How much notice do you need before an appointment?')
      .selectOption('preset:1440');
    await page.getByRole('group', { name: 'How do you handle booking deposits?' })
      .getByRole('radio', { name: 'Same deposit for every service' })
      .check();
    await page.getByRole('group', { name: 'Deposit amount' })
      .getByRole('radio', { name: '$50' })
      .check();
    await page.getByRole('button', { name: 'Save booking setup' }).click();

    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await waitForSaved(page);
    expect((await readState(page)).reviewOptions.feedbackMilestones)
      .toContain('stage_booking');
    await captureViewport(page, '35-booking-stage-complete');
    await page.getByLabel('Short bio').fill('Hi, I’m Daniela. I create thoughtful, detailed nail appointments in a calm private studio.');
    await page.getByRole('checkbox', { name: 'Russian Manicure' }).check();
    await page.getByRole('checkbox', { name: 'BIAB' }).check();
    await page.getByText('More about you', { exact: true }).click();
    await page.getByLabel('Full bio').fill('I specialize in structured natural-nail care and take time to make every appointment feel relaxed and personal.');
    await page.getByLabel('Certifications — optional').fill('Russian manicure certification, BIAB certification');
    await page.getByLabel('Languages — optional').fill('English, Spanish');
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await page.getByRole('button', { name: /^About \+ Before You Book/u }).click();
    await page.getByRole('button', { name: 'Use this design' }).click();

    await page.getByLabel('How much notice do clients need to cancel?').selectOption('custom');
    await capture(page, '25-policy-incomplete');
    await page.getByLabel('Custom notice').fill('36 hours');
    await page.getByLabel('What happens to the deposit if they cancel late?')
      .selectOption('deposit_lost');
    await page.getByLabel('Can clients get their deposit back?').selectOption('no');
    await page.getByLabel('Can clients move it to another appointment?').selectOption('no');
    await capture(page, '26-policy-complete');
    await page.locator('button[aria-controls="onboarding-policy-other-panel"]').click();
    const otherPolicyPanel = page.locator('#onboarding-policy-other-panel');
    await otherPolicyPanel.locator('select').nth(0).selectOption('Guests welcome');
    await otherPolicyPanel.locator('select').nth(1).selectOption('Please arrange childcare');
    const guestCopy = page.locator('details.onboarding-policy-copy-card')
      .filter({ hasText: 'Guests & appointment details' });
    await guestCopy.locator('summary').click();
    await expect(guestCopy).toContainText(
      'Guests are welcome. Please arrange childcare before your appointment.',
    );
    await expect(guestCopy).not.toContainText(/Guests:|Children:/u);
    await captureLocator(guestCopy, '27-guests-policy-prose');
    await page.getByRole('button', { name: 'Save policies' }).click();

    const modern = page.getByRole('group', { name: 'Site style presets' })
      .getByRole('button', { name: /^Modern/u });
    await modern.click();
    await page.getByRole('button', { name: /Use Modern|Continue with Modern/u }).click();
    await expect(page.locator('.onboarding-feedback')).toContainText(
      'Your website design is set',
    );
    await captureViewport(page, '35-design-stage-complete');
    await waitForSaved(page);
    expect((await readState(page)).reviewOptions.feedbackMilestones)
      .toContain('all_required_complete');
    await captureViewport(page, '37-all-required-complete');
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(heading(page, 'Review your site')).toBeVisible();
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await page.getByRole('dialog', { name: 'Your site is saved' })
      .getByRole('button', { name: 'Continue free' })
      .click();
    await expect(heading(page, 'Your Luster site is ready')).toBeVisible();
    await expect(page.locator('.onboarding-feedback')).toContainText(
      'Your Luster site is ready',
    );
    await captureViewport(page, '38-dashboard-arrival');
  });

  test('V02 service library is visual, searchable, and changes one canonical selection', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await chooseStartingPoint(page, 'One-page');
    await completeBasicsToBooking(page);

    await page.getByRole('group', { name: 'How do you accept clients?' })
      .getByRole('radio', { name: 'Appointment only' })
      .check();
    await page.getByRole('group', { name: 'Are you accepting new clients?' })
      .getByRole('radio', { name: 'Yes' })
      .check();

    const serviceCard = page.locator('.onboarding-service-menu-card');
    await expect(serviceCard.getByRole('heading', { name: 'Your service menu is ready' }))
      .toBeVisible();
    await expect(serviceCard.getByRole('list', { name: 'Selected services' }))
      .toBeVisible();
    await expect(serviceCard.locator('img').first()).toBeVisible();
    await captureLocator(serviceCard, '06-styled-service-summary');
    await serviceCard.getByRole('button', { name: 'Review services' }).click();

    const dialog = page.getByRole('dialog', { name: 'Choose your services' });
    await expect(dialog).toBeVisible();
    await captureViewport(page, '07-service-library-top');
    const categoryRail = dialog.locator('.onboarding-service-library__category-rail');
    const categoryScroller = dialog.getByLabel('Service categories');
    const resultList = dialog.locator('.onboarding-service-library__list');
    await expect(resultList).toHaveAttribute('aria-label', 'Library services');
    const initialRailGeometry = await Promise.all([
      categoryRail.boundingBox(),
      categoryScroller.boundingBox(),
      resultList.boundingBox(),
    ]);
    const [initialRailBox, initialScrollerBox, initialResultsBox] = initialRailGeometry;
    expect(initialRailBox).not.toBeNull();
    expect(initialScrollerBox).not.toBeNull();
    expect(initialResultsBox).not.toBeNull();
    expect(initialRailBox?.height ?? 0).toBeGreaterThanOrEqual(50);
    expect(initialScrollerBox?.height ?? 0).toBeGreaterThanOrEqual(50);
    expect(initialResultsBox?.y ?? 0)
      .toBeGreaterThanOrEqual((initialRailBox?.y ?? 0) + (initialRailBox?.height ?? 0) - 1);
    await captureLocator(categoryRail, '13-service-rail-top');

    const lastServiceCategory = categoryScroller.getByRole('button').last();
    await lastServiceCategory.click();
    await expect(lastServiceCategory).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => {
      const [scrollerBox, selectedBox] = await Promise.all([
        categoryScroller.boundingBox(),
        lastServiceCategory.boundingBox(),
      ]);
      return Boolean(scrollerBox && selectedBox
        && selectedBox.x >= scrollerBox.x - 1
        && selectedBox.x + selectedBox.width <= scrollerBox.x + scrollerBox.width + 1);
    }).toBe(true);
    await expect(categoryRail).toHaveClass(/has-left-overflow/u);
    await captureLocator(categoryRail, '14-service-rail-horizontal-scroll');
    await categoryScroller.getByRole('button', { name: 'Manicure', exact: true }).click();
    await expect(categoryScroller.getByRole('button', { name: 'Manicure', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(resultList.locator('img').first()).toBeVisible();
    const imageMetrics = await resultList.locator('img').first().evaluate((image) => ({
      complete: (image as HTMLImageElement).complete,
      naturalHeight: (image as HTMLImageElement).naturalHeight,
      naturalWidth: (image as HTMLImageElement).naturalWidth,
    }));
    expect(imageMetrics.complete).toBe(true);
    expect(imageMetrics.naturalWidth).toBeGreaterThan(0);
    expect(imageMetrics.naturalHeight).toBeGreaterThan(0);

    const russianRow = resultList.locator(':scope > li').filter({ hasText: 'Russian Manicure' });
    await expect(russianRow).toContainText('1 hr 30 min');
    await expect(russianRow).toContainText('From $65');
    await captureLocator(russianRow, '09-selected-service-row');
    await russianRow.getByRole('button', { name: 'Remove Russian Manicure' }).click();
    await expect(russianRow.getByRole('button', { name: 'Add Russian Manicure' })).toBeVisible();
    await captureLocator(russianRow, '10-unselected-service-row');

    await dialog.getByPlaceholder('Search services').pressSequentially('Russian', { delay: 35 });
    await expect(resultList.locator(':scope > li')).toHaveCount(1);
    await captureViewport(page, '08-service-search-categories');
    await resultList.getByRole('button', { name: 'Add Russian Manicure' }).click();
    await expect(page.locator('.onboarding-feedback')).toHaveCount(0);
    await expect(page.getByRole('status').filter({
      hasText: 'Russian Manicure added.',
    })).toHaveCount(1);
    await captureViewport(page, '33-service-added-interaction');
    await dialog.getByPlaceholder('Search services').fill('');

    await dialog.getByRole('tab', { name: 'Add-ons' }).click();
    const addOnCategories = dialog.getByLabel('Add-on categories');
    await expect(addOnCategories).toBeVisible();
    await expect(resultList).toHaveAttribute('aria-label', 'Library add-ons');
    const [addOnRailBox, addOnResultsBox] = await Promise.all([
      categoryRail.boundingBox(),
      resultList.boundingBox(),
    ]);
    expect(addOnResultsBox?.y ?? 0)
      .toBeGreaterThanOrEqual((addOnRailBox?.y ?? 0) + (addOnRailBox?.height ?? 0) - 1);
    const frenchRow = resultList.locator(':scope > li').filter({ hasText: 'French' });
    await expect(frenchRow).toBeVisible();
    const frenchAction = frenchRow.getByRole('button', { name: /^(?:Add|Remove) French/u });
    const wasSelected = await frenchAction.getAttribute('aria-pressed') === 'true';
    await frenchAction.click();
    await expect(frenchRow.getByRole('button', {
      name: `${wasSelected ? 'Add' : 'Remove'} French`,
    })).toBeVisible();
    await frenchRow.getByRole('button', {
      name: `${wasSelected ? 'Add' : 'Remove'} French`,
    }).click();
    await captureViewport(page, '15-service-library-add-ons');
    await resultList.locator(':scope > li').last().scrollIntoViewIfNeeded();
    await expect(dialog.locator('.onboarding-service-library__footer')).toBeVisible();
    await captureViewport(page, '12-service-library-sticky-footer');

    await page.setViewportSize({ height: 390, width: 844 });
    await expect(dialog).toBeVisible();
    const [rotatedRailBox, rotatedResultsBox, rotatedFooterBox] = await Promise.all([
      categoryRail.boundingBox(),
      resultList.boundingBox(),
      dialog.locator('.onboarding-service-library__footer').boundingBox(),
    ]);
    expect(rotatedRailBox).not.toBeNull();
    expect(rotatedResultsBox).not.toBeNull();
    expect(rotatedFooterBox).not.toBeNull();
    expect(rotatedRailBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(rotatedResultsBox?.y ?? 0)
      .toBeGreaterThanOrEqual((rotatedRailBox?.y ?? 0) + (rotatedRailBox?.height ?? 0) - 1);
    expect((rotatedResultsBox?.y ?? 0) + (rotatedResultsBox?.height ?? 0))
      .toBeLessThanOrEqual((rotatedFooterBox?.y ?? 0) + 1);
    await captureViewport(page, '16-service-library-rotated');
    await page.setViewportSize({ height: 844, width: 390 });
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);

    const state = await readState(page);
    expect(state.profile.serviceMenu.selectedServiceIds).toContain('svc-manicure-russian');
    expect(new Set(state.profile.serviceMenu.selectedServiceIds).size)
      .toBe(state.profile.serviceMenu.selectedServiceIds.length);
    const noticePreview = page.getByLabel('Customer booking information preview')
      .getByText('Minimum booking notice')
      .locator('..');
    await noticePreview.scrollIntoViewIfNeeded();
    await expect(noticePreview).toContainText(/Book at least .* before your appointment\./u);
    await expect(page.locator('[data-bookable-time]')).toHaveCount(0);
    await captureLocator(noticePreview, '13-minimum-booking-notice');
    const bookingStatus = page.getByLabel('Booking connection status');
    await bookingStatus.scrollIntoViewIfNeeded();
    await captureViewport(page, '14-booking-summary-above-footer');
    await expectNoHorizontalOverflow(page);
  });

  test('V03 all four About designs render Daniela’s same content in distinct presets', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await openAuditFresh(page);
    await applyFixture(page, 'Multi-page starter', 'Your starting site is ready');
    await continueFromStartingPreviewToAbout(page);
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expect(heading(page, 'Choose your About design')).toBeVisible();

    const presets = [
      ['Photo Right', 'is-photo-right', '15-about-photo-right-mobile', '16-about-photo-right-desktop'],
      ['Editorial Portrait', 'is-editorial', '17-about-editorial-mobile', '18-about-editorial-desktop'],
      ['Profile + Quick Facts', 'is-quick-facts', '19-about-quick-facts-mobile', '20-about-quick-facts-desktop'],
      ['About + Before You Book', 'is-before-booking', '21-about-before-you-book-mobile', '22-about-before-you-book-desktop'],
    ] as const;
    const group = page.getByRole('group', { name: 'About design presets' });
    const preview = page.getByLabel(/Selected About design preview:/u);
    const previewFrame = preview.locator('.onboarding-preview-frame');
    const [groupBox, initialPreviewBox] = await Promise.all([
      group.boundingBox(),
      preview.boundingBox(),
    ]);
    expect(groupBox).not.toBeNull();
    expect(initialPreviewBox).not.toBeNull();
    expect((groupBox?.y ?? 0) + (groupBox?.height ?? 0))
      .toBeLessThanOrEqual(initialPreviewBox?.y ?? 0);
    await expect(previewFrame).toHaveAttribute('tabindex', '-1');
    expect(await previewFrame.evaluate((element) => ({
      inert: element instanceof HTMLElement ? element.inert : false,
      overflowX: getComputedStyle(element).overflowX,
      overflowY: getComputedStyle(element).overflowY,
      pointerEvents: getComputedStyle(element).pointerEvents,
    }))).toEqual({
      inert: true,
      overflowX: 'hidden',
      overflowY: 'hidden',
      pointerEvents: 'none',
    });
    const measurements: Array<Record<string, unknown>> = [];

    const measurePreset = async (
      label: string,
      className: string,
      viewport: { height: number; width: number },
    ): Promise<void> => {
      const section = preview.locator(`.onboarding-customer-about.${className}`);
      const book = section.locator('a', { hasText: 'Book now' });
      await expect(section).toBeVisible();
      await expect(book).toBeVisible();
      const sectionBox = await section.boundingBox();
      const bookBox = await book.boundingBox();
      expect(sectionBox).not.toBeNull();
      expect(bookBox).not.toBeNull();
      const bookOffsetFromAboutTop = (bookBox?.y ?? 0) - (sectionBox?.y ?? 0);
      const bookBottomFromAboutTop = bookOffsetFromAboutTop + (bookBox?.height ?? 0);
      measurements.push({
        bookBottomFromAboutTop,
        bookFallsWithinFirst844: bookBottomFromAboutTop <= 844,
        bookOffsetFromAboutTop,
        bookSize: { height: bookBox?.height, width: bookBox?.width },
        preset: label,
        sectionSize: { height: sectionBox?.height, width: sectionBox?.width },
        viewport,
      });
    };

    for (const [label, className, mobileFile, desktopFile] of presets) {
      const option = group.getByRole('button', { name: new RegExp(`^${label.replace('+', '\\+')}`, 'u') });
      await option.click();
      await expect(option).toHaveAttribute('aria-pressed', 'true');
      await expect(preview.locator(`.onboarding-customer-about.${className}`)).toBeVisible();
      await expect(preview).toContainText('Daniela');
      await expect(preview).toContainText('Isla Nail Studio');
      await expect(preview).toContainText('Russian Manicure');
      await page.setViewportSize({ height: 844, width: 390 });
      await option.scrollIntoViewIfNeeded();
      await measurePreset(label, className, { height: 844, width: 390 });
      await capture(page, mobileFile);
      await page.setViewportSize({ height: 800, width: 1180 });
      await option.scrollIntoViewIfNeeded();
      await measurePreset(label, className, { height: 800, width: 1180 });
      await capture(page, desktopFile);
    }
    await captureJson('about-preset-layout-measurements', measurements);
    await captureText(
      'about-preset-layout-measurements.md',
      [
        '# About preset layout measurements',
        '',
        '| Preset | Viewport | Section width | Section height | Book offset | Book within first 844px |',
        '| --- | --- | ---: | ---: | ---: | :---: |',
        ...measurements.map((measurement) => {
          const viewport = measurement.viewport as { height: number; width: number };
          const section = measurement.sectionSize as { height: number; width: number };
          return `| ${measurement.preset} | ${viewport.width}×${viewport.height} | ${section.width.toFixed(1)} | ${section.height.toFixed(1)} | ${(measurement.bookOffsetFromAboutTop as number).toFixed(1)} | ${measurement.bookFallsWithinFirst844 ? 'Yes' : 'No'} |`;
        }),
        '',
      ].join('\n'),
    );
    await captureLocator(group, '23-four-about-selection-cards');
    const aboutSection = preview.locator('.onboarding-customer-about.is-before-booking');
    await expect(aboutSection.locator('summary', { hasText: 'Read more' })).toBeVisible();
    await captureLocator(aboutSection, '24-about-read-more');

    await page.setViewportSize({ height: 568, width: 320 });
    await group.getByRole('button', { name: /^About \+ Before You Book/u })
      .scrollIntoViewIfNeeded();
    await expect(aboutSection.locator('a', { hasText: 'Book now' })).toBeVisible();
    await captureViewport(page, '19-about-spacing-320');
    await page.setViewportSize({ height: 844, width: 390 });
    await captureViewport(page, '20-about-spacing-390');

    await preview.scrollIntoViewIfNeeded();
    const frameScrollBefore = await previewFrame.evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
    }));
    const outerScrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    await preview.hover({ position: { x: 180, y: 200 } });
    await page.mouse.wheel(0, 320);
    await expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollTop ?? 0))
      .toBeGreaterThan(outerScrollBefore);
    expect(await previewFrame.evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
    }))).toEqual(frameScrollBefore);

    await page.getByRole('button', { name: 'Open interactive preview' }).click();
    const fullPreview = page.getByRole('dialog', { name: 'Preview your About section' });
    await expect(fullPreview).toBeVisible();
    await expect(fullPreview.locator('.onboarding-preview-stage')).toBeVisible();
    await captureViewport(page, '18-compact-about-preview');
    await fullPreview.getByRole('button', {
      name: 'Close Preview your About section',
    }).click();
    await expect(fullPreview).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test('V04 all six website styles visibly update the personalized customer preview', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await openAuditFresh(page);
    await applyFixture(page, 'Policies Off', 'Choose your website style');

    const styles = [
      ['Modern', 'modern', '28-style-modern'],
      ['Editorial', 'editorial', '29-style-editorial'],
      ['Soft', 'soft', '30-style-soft'],
      ['Minimal', 'minimal', '31-style-minimal'],
      ['Bold', 'bold', '32-style-bold'],
      ['Luxury', 'luxury', '33-style-luxury'],
    ] as const;
    const group = page.getByRole('group', { name: 'Site style presets' });
    const preview = page.getByLabel('Live personalized style preview');
    const tokenSnapshots = new Map<string, string>();

    for (const [label, id, fileName] of styles) {
      const option = group.getByRole('button', { name: new RegExp(`^${label}`, 'u') });
      await option.click();
      await expect(option).toHaveAttribute('aria-pressed', 'true');
      await expect(preview.locator(`[data-style-preset="${id}"]`)).toBeVisible();
      await expect(preview).toContainText('Isla Nail Studio');
      // Colour roles belong to the palette contract and deliberately do not
      // vary per style; typography and shape mood are what a style owns.
      const tokens = await preview.locator('.onboarding-site-preview').evaluate((element) => {
        const styles = getComputedStyle(element);
        return [
          styles.getPropertyValue('--customer-heading-font'),
          styles.getPropertyValue('--customer-body-font'),
          styles.getPropertyValue('--customer-radius'),
          styles.getPropertyValue('--customer-section-space'),
        ].join('|');
      });
      tokenSnapshots.set(id, tokens);
      if (id === 'modern') {
        await expect(group.getByRole('button', { name: /^Soft/u })).toContainText('On your site now');
        await expect(option).toContainText('Previewing');
        await captureLocator(group, '34-style-current-vs-previewing');
      }
      await capture(page, fileName);
    }
    expect(new Set(tokenSnapshots.values()).size).toBeGreaterThanOrEqual(5);
    await page.setViewportSize({ height: 568, width: 320 });
    await group.scrollIntoViewIfNeeded();
    const cards = group.getByRole('button');
    await expect(cards).toHaveCount(6);
    const gridMeasurement = await group.evaluate((element) => {
      const cardRects = [...element.querySelectorAll<HTMLElement>(':scope > button')]
        .map((card) => card.getBoundingClientRect());
      const rows = [...new Set(cardRects.map((rect) => Math.round(rect.y)))];
      const styles = getComputedStyle(element);
      return {
        columns: styles.gridTemplateColumns.split(' ').filter(Boolean).length,
        groupClientWidth: element.clientWidth,
        groupScrollWidth: element.scrollWidth,
        minimumCardWidth: Math.min(...cardRects.map((rect) => rect.width)),
        rows: rows.length,
      };
    });
    expect(gridMeasurement.columns).toBe(2);
    expect(gridMeasurement.rows).toBe(3);
    expect(gridMeasurement.minimumCardWidth).toBeGreaterThan(130);
    expect(gridMeasurement.groupScrollWidth).toBeLessThanOrEqual(gridMeasurement.groupClientWidth + 1);
    await captureLocator(group, '21-website-styles-2x3');
    await expectNoHorizontalOverflow(page);
  });

  test('V05 Gallery changes are transactional across Cancel and Save', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openAuditFresh(page);
    await applyFixture(page, 'Canva intent', 'Add something extra');
    const baseline = await readState(page);
    expect(baseline.recipe.galleryEnabled).toBe(false);
    expect(baseline.gallery.images).toHaveLength(0);

    await page.getByRole('button', { name: 'Add Gallery' }).click();
    let dialog = page.getByRole('dialog', { name: 'Add Gallery' });
    await dialog.getByRole('button', { name: /Use example nail photos/u }).click();
    await expect(dialog.getByRole('list', { name: 'Gallery image order' }).getByRole('listitem'))
      .toHaveCount(4);
    await dialog.getByRole('radio', { name: 'carousel' }).check();
    await captureLocator(dialog, '35-gallery-example-labels');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    let state = await readState(page);
    expect(state.recipe.galleryEnabled).toBe(false);
    expect(state.gallery.images).toHaveLength(0);
    await expect(page.getByText('✓ Gallery added')).toHaveCount(0);
    await captureViewport(page, '36-gallery-cancel-restored');

    await page.getByRole('button', { name: 'Add Gallery' }).click();
    dialog = page.getByRole('dialog', { name: 'Add Gallery' });
    await dialog.getByRole('button', { name: /Use example nail photos/u }).click();
    await dialog.getByRole('radio', { name: 'carousel' }).check();
    await dialog.getByRole('button', { exact: true, name: 'Add Gallery' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);
    state = await readState(page);
    expect(state.recipe.galleryEnabled).toBe(true);
    expect(state.gallery.images).toHaveLength(4);
    expect(state.gallery.layout).toBe('carousel');
    await expect(page.getByText('✓ Gallery added')).toBeVisible();
    await expect(page.locator('.onboarding-extra-card').filter({ hasText: 'Show off your work' }))
      .toContainText('4 example photos · Carousel');
    await capture(page, 'gallery-saved-carousel-supporting');

    await page.getByRole('button', { name: 'Edit Gallery' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit Gallery' });
    await dialog.getByRole('button', { name: /^Remove /u }).first().click();
    await dialog.getByRole('radio', { name: 'editorial' }).check();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    state = await readState(page);
    expect(state.gallery.images).toHaveLength(4);
    expect(state.gallery.layout).toBe('carousel');

    await page.getByRole('button', { name: 'Edit Gallery' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit Gallery' });
    await dialog.getByRole('button', { name: /^Remove /u }).first().click();
    await dialog.getByRole('radio', { name: 'editorial' }).check();
    await dialog.getByRole('button', { name: 'Save Gallery' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);
    state = await readState(page);
    expect(state.gallery.images).toHaveLength(3);
    expect(state.gallery.layout).toBe('editorial');
    await capture(page, 'gallery-edits-saved-transactionally-supporting');
  });

  test('physical Gallery upload shows processing, accepted thumbnail, precise failure, save, and reload', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openAuditFresh(page);
    await applyFixture(page, 'Canva intent', 'Add something extra');
    await delayThumbnailGeneration(page);

    await page.getByRole('button', { name: 'Add Gallery' }).click();
    let dialog = page.getByRole('dialog', { name: 'Add Gallery' });
    const input = dialog.locator('input[type="file"]');
    const validUpload = input.setInputFiles(PORTRAIT_PATH);
    await expect(dialog.getByRole('status').filter({ hasText: 'Processing photo…' }))
      .toContainText('daniela-placeholder.jpg');
    await captureLocator(dialog, '04-gallery-processing');
    await validUpload;
    await expect(dialog.getByRole('status').filter({ hasText: '1 photo ready' })).toBeVisible();
    const order = dialog.getByRole('list', { name: 'Gallery image order' });
    await expect(order.getByRole('listitem')).toHaveCount(1);
    await expect(order.locator('img')).toBeVisible();
    await expect(dialog.getByRole('button', { exact: true, name: 'Add Gallery' })).toBeEnabled();
    await captureLocator(dialog, '05-gallery-thumbnails-ready');

    await input.setInputFiles({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]),
      mimeType: 'image/jpeg',
      name: 'IMG_5222.jpeg',
    });
    const failure = dialog.getByRole('alert').filter({ hasText: 'IMG_5222.jpeg' });
    await expect(failure).toContainText('No images were added. 1 image was skipped.');
    await expect(failure).toContainText(
      'This photo couldn’t be read. Try selecting it again or choose another copy.',
    );
    await expect(failure.getByRole('button', { name: 'Retry' })).toBeVisible();
    await captureLocator(failure, '06-gallery-precise-failure');
    await expect(order.getByRole('listitem')).toHaveCount(1);

    await dialog.getByRole('radio', { name: 'grid' }).check();
    await dialog.getByRole('button', { exact: true, name: 'Add Gallery' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);
    let state = await readState(page);
    expect(state.recipe.galleryEnabled).toBe(true);
    expect(state.gallery.images).toHaveLength(1);
    expect(state.gallery.images[0]?.storageId).toBeTruthy();
    await captureViewport(page, '22-gallery-accepted-save');

    await page.reload();
    await expect(heading(page, 'Add something extra')).toBeVisible();
    state = await readState(page);
    expect(state.gallery.images).toHaveLength(1);
    await page.getByRole('button', { name: 'Edit Gallery' }).click();
    dialog = page.getByRole('dialog', { name: 'Edit Gallery' });
    await expect(dialog.getByRole('list', { name: 'Gallery image order' }).locator('img'))
      .toBeVisible();
    await captureLocator(dialog, '23-gallery-reload');
  });

  test('preview outline removes About after the owner turns it off', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await openAuditFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Edit About section' }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await page.getByRole('switch', { name: 'Include an About section' }).uncheck();
    await page.getByRole('button', { name: 'Continue without About' }).click();
    await page.getByRole('button', { name: 'Save policies' }).click();
    await page.getByRole('button', { name: /Continue with Soft|Use Soft/u }).click();
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(heading(page, 'Review your site')).toBeVisible();
    const preview = page.getByLabel('Final phone customer preview');
    await expect(preview.locator('.onboarding-customer-about')).toHaveCount(0);
    await expect(preview.locator('[data-preview-outline-section-id]').filter({ hasText: 'About' }))
      .toHaveCount(0);
    await capture(page, '37-preview-outline-about-off');
  });

  test('full customer Preview uses a bounded outer stage and an internally scrollable device', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openAuditFresh(page);
    await applyFixture(page, 'Multi-page starter', 'Your starting site is ready');
    await page.getByRole('button', { name: 'Preview my site' }).click();

    const dialog = page.getByRole('dialog', { name: 'Preview your starting site' });
    const overlay = dialog.locator('.onboarding-preview-overlay');
    const stage = overlay.locator('.onboarding-preview-stage');
    const frame = stage.locator('.onboarding-preview-frame');
    const actions = overlay.locator('.onboarding-overlay-actions');
    await expect(dialog).toBeVisible();
    await expect(stage).toBeVisible();
    await expect(frame).toBeVisible();
    const [overlayBox, stageBox, actionBox] = await Promise.all([
      overlay.boundingBox(),
      stage.boundingBox(),
      actions.boundingBox(),
    ]);
    expect(overlayBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect(stageBox?.height ?? 0).toBeGreaterThanOrEqual(420);
    expect(stageBox?.height ?? 9999).toBeLessThanOrEqual(844 * 0.7);
    expect((actionBox?.y ?? 9999) - ((stageBox?.y ?? 0) + (stageBox?.height ?? 0)))
      .toBeLessThanOrEqual(24);
    expect(overlayBox?.height ?? 9999).toBeLessThanOrEqual(844 * 0.9);
    const initialPhoneBox = await stage.boundingBox();
    expect(initialPhoneBox).not.toBeNull();
    await captureViewport(page, 'tiny-01-preview-phone-initial');

    const scrollGeometry = await frame.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }));
    expect(scrollGeometry.scrollHeight).toBeGreaterThan(scrollGeometry.clientHeight);
    await frame.evaluate((element) => { element.scrollTop = Math.min(240, element.scrollHeight); });
    await expect.poll(() => frame.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await captureViewport(page, '17-compact-starting-site-preview');

    for (let cycle = 0; cycle < 10; cycle += 1) {
      for (const device of ['Desktop', 'Phone', 'Tablet', 'Phone'] as const) {
        await overlay.getByRole('button', { name: device }).click();
        await expect(overlay.getByRole('button', { name: device }))
          .toHaveAttribute('aria-pressed', 'true');
        await expect(stage.locator(`.onboarding-preview-frame.is-${device.toLowerCase()}`))
          .toBeVisible();
        expect((await stage.boundingBox())?.height ?? 9999).toBeLessThanOrEqual(844 * 0.7);
        if (device === 'Phone') {
          const recoveredPhoneBox = await stage.boundingBox();
          expect(Math.abs(
            (recoveredPhoneBox?.height ?? 0) - (initialPhoneBox?.height ?? 0),
          )).toBeLessThanOrEqual(2);
          expect(Math.abs(
            (recoveredPhoneBox?.width ?? 0) - (initialPhoneBox?.width ?? 0),
          )).toBeLessThanOrEqual(2);
        }
      }
    }
    await overlay.getByRole('button', { name: 'Desktop' }).click();
    await captureViewport(page, 'tiny-02-preview-desktop');
    await overlay.getByRole('button', { name: 'Phone' }).click();
    await captureViewport(page, 'tiny-03-preview-phone-recovered');
    await actions.getByRole('button', { name: 'Back' }).click();
    await expect(dialog).toBeHidden();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
  });

  test('Final Review keeps collapsed readiness below the customer website without overlaying it', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openAuditFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');

    const preview = page.locator('.onboarding-review-preview');
    const previewFrame = preview.locator('.onboarding-preview-frame');
    const readiness = page.getByRole('complementary', { name: 'Site readiness' });
    const readinessTrigger = readiness.getByRole('button', { name: /Site readiness/u });
    await expect(preview).toBeVisible();
    await expect(readiness).toBeVisible();
    await expect(readinessTrigger).toHaveAttribute('aria-expanded', 'false');
    const [previewBox, readinessBox] = await Promise.all([
      preview.boundingBox(),
      readiness.boundingBox(),
    ]);
    expect(previewBox).not.toBeNull();
    expect(readinessBox).not.toBeNull();
    expect(readinessBox?.y ?? 0)
      .toBeGreaterThanOrEqual((previewBox?.y ?? 0) + (previewBox?.height ?? 0) - 1);
    expect(await readiness.evaluate((element) => getComputedStyle(element).position))
      .not.toMatch(/absolute|fixed/u);
    const reviewStage = preview.locator('.onboarding-preview-stage');
    const initialReviewPhoneBox = await reviewStage.boundingBox();
    await page.getByRole('group', { name: 'Customer preview device size' })
      .getByRole('button', { name: 'Desktop' })
      .click();
    await page.getByRole('group', { name: 'Customer preview device size' })
      .getByRole('button', { name: 'Phone' })
      .click();
    const recoveredReviewPhoneBox = await reviewStage.boundingBox();
    expect(Math.abs(
      (recoveredReviewPhoneBox?.height ?? 0) - (initialReviewPhoneBox?.height ?? 0),
    )).toBeLessThanOrEqual(2);
    await captureViewport(page, 'tiny-04-final-review-phone-recovered');
    await previewFrame.evaluate((element) => { element.scrollTop = 160; });
    const previewScrollBefore = await previewFrame.evaluate((element) => element.scrollTop);
    await captureViewport(page, '24-review-unobstructed');
    await captureLocator(readiness, '25-readiness-collapsed');

    await readinessTrigger.click();
    await expect(readinessTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(readiness.getByRole('heading', { name: 'Site readiness' })).toBeVisible();
    expect(await previewFrame.evaluate((element) => element.scrollTop)).toBe(previewScrollBefore);
    const [expandedPreviewBox, expandedReadinessBox] = await Promise.all([
      preview.boundingBox(),
      readiness.boundingBox(),
    ]);
    expect(expandedReadinessBox?.y ?? 0)
      .toBeGreaterThanOrEqual((expandedPreviewBox?.y ?? 0) + (expandedPreviewBox?.height ?? 0) - 1);
    await capture(page, '26-readiness-expanded-below-preview');
    await expectNoHorizontalOverflow(page);
  });

  test('V06 plan cards preserve one selected intent and a usable short-phone layout', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openAuditFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Finish setup' }).click();
    const plan = page.getByRole('dialog', { name: 'Your site is saved' });
    const free = plan.getByRole('radio', { name: /^Free/u });
    const founding = plan.getByRole('radio', { name: /^Founding offer/u });
    const monthly = plan.getByRole('radio', { name: /^Monthly/u });
    const planAction = plan.locator('.onboarding-plan-sheet__action');
    await expect(free).toBeChecked();
    await expect(free.locator('xpath=..')).toContainText('$0 to start');
    await expect(founding.locator('xpath=..')).toContainText('Price coming soon');
    await expect(monthly.locator('xpath=..')).toContainText('Price coming soon');
    await expect(planAction.getByRole('button')).toHaveCount(1);
    await expect(planAction.getByRole('button', { name: 'Continue free' })).toBeVisible();
    await expect(plan).not.toContainText(/Lifetime|limited time|countdown|buy now|purchase/u);
    await expect(plan).toContainText('There is no payment or plan access change today.');
    const freeCardBox = await free.locator('xpath=..').boundingBox();
    expect(freeCardBox).not.toBeNull();
    expect((freeCardBox?.y ?? 9999) + (freeCardBox?.height ?? 0)).toBeLessThanOrEqual(844);
    await captureViewport(page, '27-plan-free-initial-viewport');

    await founding.locator('xpath=..').click();
    await expect(founding).toBeChecked();
    await expect(planAction.getByRole('button', { name: 'Reserve founding offer' })).toBeVisible();
    await expect(planAction.getByRole('button')).toHaveCount(1);
    await captureViewport(page, '28-plan-founding-selected');

    await monthly.locator('xpath=..').click();
    await expect(monthly).toBeChecked();
    await expect(planAction.getByRole('button', { name: 'I’m interested in monthly' })).toBeVisible();
    await expect(planAction.getByRole('button')).toHaveCount(1);
    await captureViewport(page, '29-plan-monthly-selected');
    await plan.getByText('Compare options', { exact: true }).click();
    const comparison = plan.locator('.onboarding-plan-comparison');
    await expect(comparison.getByRole('heading', { name: 'Included now' })).toBeVisible();
    await expect(comparison.getByRole('heading', { name: 'Planned for paid options' }))
      .toBeVisible();
    const comparisonGeometry = await comparison.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(comparisonGeometry.scrollWidth).toBeLessThanOrEqual(comparisonGeometry.clientWidth + 1);
    await capture(page, '30-plan-compact-comparison');

    await page.setViewportSize({ height: 568, width: 320 });
    await free.locator('xpath=..').click();
    await expect(planAction.getByRole('button', { name: 'Continue free' })).toBeVisible();
    await expect(planAction.getByRole('button')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await captureViewport(page, '31-plan-short-phone');
  });

  test('V07 Continue free reaches the dashboard directly with normal owner controls', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await openAuditFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Finish setup' }).click();
    const plan = page.getByRole('dialog', { name: 'Your site is saved' });
    await expect(plan).toBeVisible();
    await expect(plan.getByRole('radio', { name: /^Free/u })).toBeChecked();
    await expect(plan.getByRole('radio', { name: /^Founding offer/u })).toBeVisible();
    await expect(plan.getByRole('radio', { name: /^Monthly/u })).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Continue free' })).toBeVisible();
    await expect(plan).toContainText('There is no payment or plan access change today.');
    await captureLocator(plan, '39-plan-free-initial');
    await plan.getByRole('button', { name: 'Continue free' }).click();

    await expect(heading(page, 'Your Luster site is ready')).toBeVisible();
    await expect(page.getByText(/Daniela, your website, booking page and service menu are set up/u))
      .toBeVisible();
    await captureViewport(page, 'dashboard-audit-arrival-supporting');

    await page.goto('/');
    await expect(heading(page, 'Your Luster site is ready')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to onboarding review · Lab only' }))
      .toHaveCount(0);
    await expect(page.getByText(/Integration rows use explicit UX Lab fixture states/u))
      .toHaveCount(0);
    await captureViewport(page, '44-dashboard-direct-arrival');

    const navigation = page.getByRole('navigation', { name: 'Dashboard destinations' });
    await captureLocator(navigation, '45-dashboard-navigation-order');
    await captureViewport(page, '46-optional-tour');

    const welcome = page.locator('.lab-dashboard-preview__welcome');
    await welcome.getByRole('button', { name: 'Take a quick tour' }).click();
    const tour = page.getByRole('dialog', { name: 'A quick look around Luster' });
    await expect(tour).toBeVisible();
    await expect(tour.getByLabel('Tour step 1 of 5')).toBeVisible();
    await captureViewport(page, '47-tour-spotlight');
    for (let step = 2; step <= 5; step += 1) {
      await tour.getByRole('button', { name: 'Next' }).click();
      await expect(tour.getByLabel(`Tour step ${step} of 5`)).toBeVisible();
    }
    await captureLocator(tour, 'tour-step-5-supporting');
    await tour.getByRole('button', { name: 'Done' }).click();
    await expect(tour).toBeHidden();

    await navigation.getByRole('button', { name: 'Services' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Services' })).toBeVisible();
    const servicesPreview = page.getByLabel('Services preview');
    await expect(servicesPreview).toContainText('Russian Manicure');
    await expect(servicesPreview).toContainText(/hr|min/u);
    await expect(servicesPreview).toContainText('$');
    await expect(page.getByRole('heading', { level: 2, name: 'What’s next' })).toBeVisible();
    const checklist = page.locator('.lab-dashboard-checklist');
    await captureLocator(
      checklist.locator('section').filter({ has: page.getByRole('heading', { name: 'Done' }) }),
      '48-checklist-done',
    );
    await captureLocator(
      checklist.locator('section').filter({ has: page.getByRole('heading', { name: 'Whenever you’re ready' }) }),
      '49-checklist-whenever-ready',
    );
    await capture(page, 'dashboard-services-and-checklist-supporting');
    await expectNoHorizontalOverflow(page);
  });

  test('V08 optional five-part tour spotlights real dashboard destinations', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await openAuditFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await page.getByRole('dialog', { name: 'Your site is saved' })
      .getByRole('button', { name: 'Continue free' })
      .click();
    await page.goto('/');
    await expect(heading(page, 'Your Luster site is ready')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'A quick look around Luster' })).toHaveCount(0);
    await captureViewport(page, '39-tour-optional');
    await page.locator('.lab-dashboard-preview__welcome')
      .getByRole('button', { name: 'Take a quick tour' })
      .click();
    const tour = page.getByRole('dialog', { name: 'A quick look around Luster' });
    for (let step = 1; step <= 5; step += 1) {
      await expect(tour.getByLabel(`Tour step ${step} of 5`)).toBeVisible();
      await expect(page.locator('.lab-dashboard-storyboard'))
        .toHaveAttribute('data-tour-highlighted', 'true');
      if (step === 1) await captureViewport(page, '39-tour-spotlight');
      if (step < 5) await tour.getByRole('button', { name: 'Next' }).click();
    }
    await tour.getByRole('button', { name: 'Done' }).click();
    await expect(tour).toBeHidden();
  });

  test('shared completion feedback remains immediate with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ height: 568, width: 320 });
    await openNormalFresh(page);
    await reachLocationScreen(page);

    await page.getByLabel('City or general service area').fill('Toronto');
    await page.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Salon suite' })
      .check();
    const feedback = page.locator('.onboarding-feedback');
    await expect(feedback).toContainText('Basics complete');
    await expect(feedback).toHaveClass(/is-reduced-motion/u);
    await expect(page.locator('button[aria-controls="onboarding-location-card-panel"]')
      .locator('.onboarding-collapsible-card__state')).toContainText('Complete');
    await captureViewport(page, '40-reduced-motion-state');
    await expectNoHorizontalOverflow(page);
  });

  test('Start over waits for an in-flight profile upload before clearing setup', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await reachBrandBasics(page);
    await openBrandingCard(page);
    await delayThumbnailGeneration(page, 1_200);

    await page.getByLabel('Profile photo', { exact: true }).setInputFiles(PORTRAIT_PATH);
    const profileField = page.locator('.onboarding-image-upload').filter({
      has: page.getByText('Profile photo', { exact: true }),
    });
    await expect(profileField.getByRole('status')).toContainText('Processing photo…');

    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Start over' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Start over?' });
    await confirmation.getByRole('button', { exact: true, name: 'Start over' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Finish the current image upload before starting over.',
    );
    await expect(confirmation).toBeVisible();
    await expect(heading(page, 'Make it yours')).toBeVisible();

    await expect.poll(() => page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const stored = JSON.parse(raw) as {
        profile?: { profilePhoto?: { fileName?: string } };
      };
      return stored.profile?.profilePhoto?.fileName ?? null;
    }, ONBOARDING_STORAGE_KEY)).toBe('daniela-placeholder.jpg');

    await confirmation.getByRole('button', { exact: true, name: 'Start over' }).click();
    await expect(heading(page, 'Choose your starting point')).toBeVisible();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key),
      ONBOARDING_STORAGE_KEY)).toBeNull();
    await page.reload();
    await expect(heading(page, 'Choose your starting point')).toBeVisible();
  });

  test('live Start over and reload restore a clean starting point', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await page.evaluate(() => window.localStorage.setItem(
      'luster:physical-iphone-unrelated-sentinel',
      'preserve-me',
    ));
    await chooseStartingPoint(page, 'One-page');
    await page.getByLabel('Salon or studio name').fill('Temporary Studio');
    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Start over' }).click();
    let confirmation = page.getByRole('dialog', { name: 'Start over?' });
    await expect(confirmation).toBeVisible();
    await captureLocator(confirmation, '32-start-over-confirmation');
    await confirmation.getByRole('button', { name: 'Keep my setup' }).click();
    await expect(confirmation).toBeHidden();
    await expect(heading(page, 'Make it yours')).toBeVisible();
    await expect(page.getByLabel('Salon or studio name')).toHaveValue('Temporary Studio');

    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Start over' }).click();
    confirmation = page.getByRole('dialog', { name: 'Start over?' });
    const confirmReset = confirmation.getByRole('button', { exact: true, name: 'Start over' });
    await confirmReset.evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Start over control is not a button.');
      }
      button.click();
      button.click();
    });
    await expect(heading(page, 'Choose your starting point')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem(
      'luster:physical-iphone-unrelated-sentinel',
    ))).toBe('preserve-me');
    await page.reload();
    await expect(heading(page, 'Choose your starting point')).toBeVisible();
    await expect(page.getByText('Temporary Studio')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await captureViewport(page, '50-clean-welcome');
    await page.evaluate(() => window.localStorage.removeItem(
      'luster:physical-iphone-unrelated-sentinel',
    ));
  });

  test('review and customer previews remain contained at key responsive viewports', async ({ page }) => {
    await openAuditFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');
    const viewports = [
      { height: 568, width: 320 },
      { height: 600, width: 320 },
      { height: 360, width: 320 },
      { height: 500, width: 375 },
      { height: 600, width: 375 },
      { height: 844, width: 390 },
      { height: 932, width: 430 },
      { height: 1024, width: 768 },
      { height: 390, width: 844 },
      { height: 430, width: 932 },
      { height: 800, width: 920 },
      { height: 800, width: 1180 },
      { height: 900, width: 1440 },
    ];
    const results: Array<Record<string, unknown>> = [];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo({ behavior: 'instant', left: 0, top: 0 }));
      await expect(heading(page, 'Review your site')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      const titleBox = await heading(page, 'Review your site').boundingBox();
      expect(titleBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((titleBox?.y ?? 9999) + (titleBox?.height ?? 0))
        .toBeLessThanOrEqual(viewport.height);
      const controls = page.getByRole('group', { name: 'Customer preview device size' });
      await expect(controls).toBeVisible();
      await controls.getByRole('button', { name: 'Phone' }).click();
      const preview = page.getByLabel('Final phone customer preview');
      await expect(preview).toBeVisible();
      const previewBox = await preview.boundingBox();
      expect(previewBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((previewBox?.x ?? viewport.width + 1) + (previewBox?.width ?? 0))
        .toBeLessThanOrEqual(viewport.width + 1);
      const stickyActions = page.locator('.sticky-onboarding-actions').last();
      await expect(stickyActions).toBeVisible();
      const stickyBox = await stickyActions.boundingBox();
      expect(stickyBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((stickyBox?.x ?? viewport.width + 1) + (stickyBox?.width ?? 0))
        .toBeLessThanOrEqual(viewport.width + 1);
      expect(stickyBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((stickyBox?.y ?? viewport.height + 1) + (stickyBox?.height ?? 0))
        .toBeLessThanOrEqual(viewport.height + 1);
      const geometry = await page.evaluate(() => ({
        clientHeight: document.documentElement.clientHeight,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      const stickyPosition = await stickyActions.evaluate((node) => (
        window.getComputedStyle(node).position
      ));
      results.push({
        geometry,
        previewBox,
        stickyBox,
        stickyPosition,
        titleBox,
        viewport,
      });
      if (viewport.width === 390) {
        const readiness = page.getByRole('button', { name: /Site readiness/u });
        if (await readiness.isVisible() && await readiness.getAttribute('aria-expanded') !== 'true') {
          await readiness.click();
        }
        const readyRow = page.locator('.onboarding-readiness__content li[data-status="ready"]').first();
        const statusBox = await readyRow.locator('small').boundingBox();
        const readinessTitleBox = await readyRow.locator('strong').boundingBox();
        expect(statusBox).not.toBeNull();
        expect(readinessTitleBox).not.toBeNull();
        expect(readinessTitleBox?.y ?? -1)
          .toBeGreaterThanOrEqual((statusBox?.y ?? 0) + (statusBox?.height ?? 0) - 1);
        await captureViewport(page, '38-final-readiness');
      }
      if (viewport.width === 320 || viewport.width === 844 || viewport.width === 1440) {
        await capture(page, `responsive-${viewport.width}x${viewport.height}`);
      }
    }
    await captureJson('11-responsive-viewport-metrics', results);
  });

  test('@webkit-smoke profile, logo, Gallery, and Canva media decode and persist', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await chooseStartingPoint(page, 'One-page');
    await page.getByLabel('Salon or studio name').fill('WebKit Nail Studio');
    await page.getByLabel('Your name').fill('Avery');
    await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
      .getByRole('radio', { name: 'Solo nail tech' })
      .check();
    await openBrandingCard(page);
    await page.getByLabel('Profile photo', { exact: true }).setInputFiles(PORTRAIT_PATH);
    await page.getByLabel('Logo', { exact: true }).setInputFiles(LOGO_PATH);
    await expect(page.getByRole('group', { name: 'Your site so far' })
      .getByRole('img').first()).toBeVisible();
    await expect.poll(async () => (await readCustomDesignAssetRecordCounts(page))['image-asset-originals-v1'] ?? 0)
      .toBeGreaterThanOrEqual(2);

    await page.goto('/?audit=1');
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
    await dialog.locator('input[type="file"]').first().setInputFiles(PORTRAIT_PATH);
    const pages = dialog.getByRole('list', { name: 'Selected Canva pages' });
    await expect(pages).toContainText('daniela-placeholder.jpg');
    await expect(pages.locator('img')).toBeVisible();
    await dialog.getByRole('button', { name: 'Add Canva design' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);

    let state = await readState(page);
    expect(state.recipe.galleryEnabled).toBe(true);
    expect(state.recipe.canvaEnabled).toBe(true);
    expect(state.gallery.images).toHaveLength(1);
    expect(state.canva.images).toHaveLength(1);
    await page.reload();
    await expect(heading(page, 'Add something extra')).toBeVisible();
    state = await readState(page);
    expect(state.recipe.galleryEnabled).toBe(true);
    expect(state.recipe.canvaEnabled).toBe(true);
    await expect(page.locator('.onboarding-extra-card.is-added')).toHaveCount(2);
    await capture(page, 'webkit-gallery-canva-persisted-supporting');
  });
});
