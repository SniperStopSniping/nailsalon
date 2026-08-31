import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import { startRuntimeMonitor } from './helpers';

const EVIDENCE_ROOT = process.env.LUSTER_EVIDENCE_DIRECTORY
  ?? '/tmp/luster-onboarding-final-owner-iphone-corrections';
const EVIDENCE_DIRECTORY = join(EVIDENCE_ROOT, 'evidence');
const VIDEO_DIRECTORY = join(EVIDENCE_ROOT, 'videos');
const CAPTURE_EVIDENCE = process.env.LUSTER_CAPTURE_EVIDENCE === '1';
const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';
const PORTRAIT_PATH = fileURLToPath(new URL(
  '../../src/onboarding/fixtures/assets/daniela-placeholder.jpg',
  import.meta.url,
));
const LOGO_PATH = fileURLToPath(new URL(
  '../../../../public/assets/images/clerk-logo-dark.png',
  import.meta.url,
));

type StoredMediaReference = {
  id: string;
  storageId?: string;
};

type StoredOnboardingState = {
  profile: {
    logo?: StoredMediaReference;
    profilePhoto?: StoredMediaReference;
  };
};

type StarterCta =
  | 'Start with Quick Book'
  | 'Start with One-page'
  | 'Start with Multi-page';

const runtimeMonitors = new WeakMap<
  Page,
  ReturnType<typeof startRuntimeMonitor>
>();

const heading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name });

/**
 * The photo, logo and Instagram fields now live in the collapsible Branding
 * card on "Make it yours" instead of the removed photo_social screen.
 */
const brandingCard = (page: Page): Locator => page.locator(
  'button[aria-controls="onboarding-branding-card-panel"]',
);

const safeFileName = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, '-')
  .replace(/^-|-$/gu, '')
  .slice(0, 80);

async function capture(
  page: Page,
  fileName: string,
  locator?: Locator,
): Promise<void> {
  if (!CAPTURE_EVIDENCE) return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  if (locator) {
    await locator.screenshot({
      animations: 'disabled',
      path: join(EVIDENCE_DIRECTORY, `${fileName}.png`),
    });
    return;
  }
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: join(EVIDENCE_DIRECTORY, `${fileName}.png`),
  });
}

async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');
}

async function openNormalFresh(page: Page): Promise<void> {
  await page.goto('/');
  await expect(heading(page, 'Choose your starting point')).toBeVisible();
}

async function openAuditFresh(page: Page): Promise<void> {
  await page.goto('/?audit=1');
  await expect(heading(page, 'Choose your starting point')).toBeVisible();
}

async function chooseStartingPoint(
  page: Page,
  starter: StarterCta,
): Promise<void> {
  await page.getByRole('button', { name: starter }).click();
  await expect(heading(page, 'Make it yours')).toBeVisible();
}

async function applyFixture(
  page: Page,
  fixtureName: string,
  destinationHeading: string,
): Promise<void> {
  // The starting point screen renders outside the shell, so the Lab menu only
  // exists once a starting point has been chosen.
  if (await heading(page, 'Choose your starting point').isVisible()) {
    await chooseStartingPoint(page, 'Start with One-page');
  }
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lab review options' });
  await dialog.getByRole('button', { exact: true, name: fixtureName }).click();
  await expect(dialog).toBeHidden();
  await expect(heading(page, destinationHeading)).toBeVisible();
  await waitForSaved(page);
}

async function reachBooking(page: Page): Promise<void> {
  await chooseStartingPoint(page, 'Start with One-page');
  await page.getByLabel('Salon or studio name').fill('Isla Cutoff Studio');
  await page.getByLabel('Your name').fill('Daniela');
  await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
    .getByRole('radio', { name: 'Solo nail tech' })
    .check();
  await page.getByRole('button', { exact: true, name: 'Continue' }).click();
  await expect(heading(page, 'Your starting site is ready')).toBeVisible();
  await page.getByRole('button', { name: 'Continue setting up my site' }).click();
  await expect(heading(page, 'Where can clients find you?')).toBeVisible();
  await page.getByLabel('City or general service area').fill('Toronto, Ontario');
  await page.getByRole('group', { name: 'Where do you see clients?' })
    .getByRole('radio', { name: 'Salon suite' })
    .check();
  await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
  await expect(page.getByRole('switch', {
    name: 'Clients should use online booking only',
  })).toBeChecked();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(heading(page, 'How do clients book with you?')).toBeVisible();
  await page.getByRole('group', { name: 'How do you accept clients?' })
    .getByRole('radio', { name: 'Appointment only' })
    .check();
  await page.getByRole('group', { name: 'Are you accepting new clients?' })
    .getByRole('radio', { name: 'Yes' })
    .check();
}

async function reachBrandingCard(page: Page): Promise<Locator> {
  await chooseStartingPoint(page, 'Start with One-page');
  await page.getByLabel('Salon or studio name').fill('Isla Role Studio');
  await page.getByLabel('Your name').fill('Daniela');
  await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
    .getByRole('radio', { name: 'Solo nail tech' })
    .check();
  const branding = brandingCard(page);
  await expect(branding).toContainText('Photo, logo and Instagram · Optional');
  await expect(branding).toHaveAttribute('aria-expanded', 'false');
  await branding.click();
  await expect(branding).toHaveAttribute('aria-expanded', 'true');
  return branding;
}

async function continueToAboutDesign(page: Page): Promise<void> {
  await page.getByRole('button', { exact: true, name: 'Continue' }).click();
  await expect(heading(page, 'Your starting site is ready')).toBeVisible();
  await page.getByRole('button', { name: 'Continue setting up my site' }).click();
  await expect(heading(page, 'Where can clients find you?')).toBeVisible();
  await page.getByLabel('City or general service area').fill('Toronto, Ontario');
  await page.getByRole('group', { name: 'Where do you see clients?' })
    .getByRole('radio', { name: 'Salon suite' })
    .check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('group', { name: 'How do you accept clients?' })
    .getByRole('radio', { name: 'Appointment only' })
    .check();
  await page.getByRole('group', { name: 'Are you accepting new clients?' })
    .getByRole('radio', { name: 'Yes' })
    .check();
  await page.getByRole('button', { name: 'Save booking setup' }).click();
  await expect(heading(page, 'Would you like an About section?')).toBeVisible();
  await page.getByLabel('Short bio').fill(
    'I create thoughtful, durable nail appointments in a calm studio.',
  );
  await page.getByRole('button', { name: 'Choose an About design' }).click();
  await expect(heading(page, 'Choose your About design')).toBeVisible();
}

async function readStoredState(page: Page): Promise<StoredOnboardingState> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Missing onboarding state.');
    return JSON.parse(raw) as StoredOnboardingState;
  }, ONBOARDING_STORAGE_KEY);
}

async function writeStoredMediaRoles(
  page: Page,
  media: StoredOnboardingState['profile'],
): Promise<void> {
  const patchKey = 'luster:test:media-role-patch';
  await page.addInitScript(({ key, requestedPatchKey }) => {
    const patch = window.sessionStorage.getItem(requestedPatchKey);
    if (!patch) return;
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Missing onboarding state.');
    const state = JSON.parse(raw) as StoredOnboardingState;
    const nextMedia = JSON.parse(patch) as StoredOnboardingState['profile'];
    state.profile.profilePhoto = nextMedia.profilePhoto;
    state.profile.logo = nextMedia.logo;
    window.localStorage.setItem(key, JSON.stringify(state));
    window.sessionStorage.removeItem(requestedPatchKey);
  }, { key: ONBOARDING_STORAGE_KEY, requestedPatchKey: patchKey });
  await page.evaluate(({ nextMedia, requestedPatchKey }) => {
    window.sessionStorage.setItem(requestedPatchKey, JSON.stringify(nextMedia));
  }, { nextMedia: media, requestedPatchKey: patchKey });
  await page.reload();
  await expect(heading(page, 'Choose your About design')).toBeVisible();
}

async function preparePolicyState(
  page: Page,
  depositMode: 'fixed' | 'none',
): Promise<void> {
  const patchKey = 'luster:test:policy-mode-patch';
  await page.addInitScript(({ key, requestedModeKey }) => {
    const mode = window.sessionStorage.getItem(requestedModeKey);
    if (mode !== 'fixed' && mode !== 'none') return;
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Missing onboarding state.');
    const state = JSON.parse(raw) as {
      profile: {
        policies: {
          cancellations: {
            consequence: string | null;
            customConsequence: string;
            customNotice: string;
            notice: string | null;
          };
          copy: Record<'cancellations' | 'deposits', {
            useSuggestedWording: boolean;
            visible: boolean;
            wordingOverride: string;
          }>;
          deposits: {
            amountCents: number | null;
            mode: 'fixed' | 'none';
            refundable: boolean | null;
            transferable: boolean | null;
            wordingOverride: string;
          };
          noShows: {
            loseDeposit: boolean;
          };
        };
      };
      progress: {
        currentScreen: string;
        lastActiveScreen: string;
        sessionStatus: string;
      };
      recipe: {
        policiesEnabled: boolean;
      };
    };
    state.profile.policies.cancellations = {
      ...state.profile.policies.cancellations,
      consequence: null,
      customConsequence: '',
      customNotice: '',
      notice: null,
    };
    state.profile.policies.deposits = {
      ...state.profile.policies.deposits,
      amountCents: mode === 'fixed' ? 1_500 : null,
      mode,
      refundable: null,
      transferable: null,
      wordingOverride: '',
    };
    state.profile.policies.noShows.loseDeposit = false;
    for (const id of ['cancellations', 'deposits'] as const) {
      state.profile.policies.copy[id] = {
        ...state.profile.policies.copy[id],
        useSuggestedWording: true,
        visible: true,
        wordingOverride: '',
      };
    }
    state.recipe.policiesEnabled = true;
    state.progress.currentScreen = 'policies';
    state.progress.lastActiveScreen = 'policies';
    state.progress.sessionStatus = 'active';
    window.localStorage.setItem(key, JSON.stringify(state));
    window.sessionStorage.removeItem(requestedModeKey);
  }, { key: ONBOARDING_STORAGE_KEY, requestedModeKey: patchKey });
  await page.evaluate(({ mode, requestedModeKey }) => {
    window.sessionStorage.setItem(requestedModeKey, mode);
  }, { mode: depositMode, requestedModeKey: patchKey });
  await page.reload();
  await expect(heading(page, 'Set clear expectations')).toBeVisible();
}

async function continuePoliciesToReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save policies' }).click();
  await expect(heading(page, 'Choose your website style')).toBeVisible();
  await page.getByRole('button', { name: /^(?:Continue with|Use) Soft$/u }).click();
  await expect(heading(page, 'Add something extra')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await expect(heading(page, 'Review your site')).toBeVisible();
}

async function wheelDownOver(page: Page, locator: Locator): Promise<number> {
  await locator.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    const scrolling = document.scrollingElement;
    const maxScroll = Math.max(
      0,
      (scrolling?.scrollHeight ?? document.body.scrollHeight) - window.innerHeight,
    );
    window.scrollTo(0, Math.min(Math.max(0, top - 100), Math.max(0, maxScroll - 260)));
  });
  const box = await locator.boundingBox();
  if (!box) throw new Error('The inline About preview has no rendered bounds.');
  const outerScrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(
    box.x + (box.width / 2),
    Math.min(
      (page.viewportSize()?.height ?? 844) - 24,
      box.y + (box.height / 2),
    ),
  );
  await page.mouse.wheel(0, 220);
  return outerScrollBefore;
}

test.use({
  video: CAPTURE_EVIDENCE ? 'on' : 'retain-on-failure',
});

test.describe('final Owner iPhone corrections', () => {
  test.beforeEach(async ({ page }) => {
    runtimeMonitors.set(page, startRuntimeMonitor(page));
  });

  test.afterEach(async ({ page }, testInfo) => {
    const monitor = runtimeMonitors.get(page);
    try {
      monitor?.assertClean();
    } finally {
      monitor?.stop();
      runtimeMonitors.delete(page);
    }
    if (!CAPTURE_EVIDENCE) return;
    await mkdir(VIDEO_DIRECTORY, { recursive: true });
    const video = page.video();
    await page.close();
    if (video) {
      await video.saveAs(join(
        VIDEO_DIRECTORY,
        `${safeFileName(testInfo.title)}.webm`,
      ));
    }
  });

  test('minimum notice is a cutoff everywhere and normal mode exposes no seeded times', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await reachBooking(page);

    const notice = page.getByRole('combobox', {
      name: 'How much notice do you need before an appointment?',
    });
    const bookingSummary = page.getByLabel('Booking connection status');
    const customerPreview = page.getByLabel('Customer booking information preview');

    await notice.selectOption('preset:120');
    await expect(page.getByText(
      'Clients must book at least 2 hours before the appointment starts.',
    ).first()).toBeVisible();
    await expect(bookingSummary).toContainText('Minimum notice2 hours');
    await expect(bookingSummary).toContainText(
      'Clients must book at least 2 hours before the appointment starts.',
    );
    await expect(customerPreview).toContainText('Minimum booking notice');
    await expect(customerPreview).toContainText(
      'Book at least 2 hours before your appointment.',
    );
    await capture(page, '01-booking-minimum-notice-helper');
    await capture(page, '02-booking-summary-without-fake-times', bookingSummary);
    await capture(page, '03-customer-preview-minimum-notice-fact', customerPreview);

    await notice.selectOption('preset:1440');
    await expect(page.getByText(
      'Clients must book at least 1 day before the appointment starts.',
    ).first()).toBeVisible();
    await expect(bookingSummary).toContainText('Minimum notice1 day');
    await expect(customerPreview).toContainText(
      'Book at least 1 day before your appointment.',
    );
    await expect(page.getByText(/Available times after your notice/iu)).toHaveCount(0);
    await expect(page.getByText(/Earliest bookable time/iu)).toHaveCount(0);
    await expect(page.locator('[data-bookable-time]')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save booking setup' }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    // The starting site preview now sits ahead of booking, so walk back to it
    // to confirm the saved cutoff reaches the customer-facing full preview.
    const back = page.getByRole('button', { exact: true, name: 'Back' });
    await back.click();
    await expect(heading(page, 'How do clients book with you?')).toBeVisible();
    await back.click();
    await expect(heading(page, 'Where can clients find you?')).toBeVisible();
    await back.click();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await page.getByRole('button', { name: 'Preview my site' }).click();
    const fullPreview = page.getByRole('dialog', { name: 'Preview your starting site' });
    await expect(fullPreview).toContainText('Minimum booking notice');
    await expect(fullPreview).toContainText('Book at least 1 day before your appointment.');
    await expect(fullPreview.getByText(/Available times after your notice/iu)).toHaveCount(0);
    await expect(fullPreview.getByText(/Earliest bookable time/iu)).toHaveCount(0);
    await expect(fullPreview.locator('[data-bookable-time]')).toHaveCount(0);
  });

  test('About choices precede one inert preview and a centre wheel gesture scrolls the outer page', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openAuditFresh(page);
    await applyFixture(page, 'Multi-page starter', 'Your starting site is ready');
    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    // Location and booking now sit between the starting site preview and
    // About; the fixture already satisfies both, so they only need saving.
    await expect(heading(page, 'Where can clients find you?')).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(heading(page, 'How do clients book with you?')).toBeVisible();
    await page.getByRole('button', { name: 'Save booking setup' }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expect(heading(page, 'Choose your About design')).toBeVisible();

    const group = page.getByRole('group', { name: 'About design presets' });
    const cards = group.getByRole('button');
    const preview = page.getByLabel(/Selected About design preview:/u);
    const frame = preview.locator('.onboarding-preview-frame');
    await expect(cards).toHaveCount(4);
    await expect(page.getByRole('heading', { name: 'See it on your site' })).toBeVisible();
    await expect(frame).toHaveAttribute('tabindex', '-1');
    await expect(frame).toHaveAttribute('inert', '');
    expect(await frame.evaluate((element) => ({
      overflowX: getComputedStyle(element).overflowX,
      overflowY: getComputedStyle(element).overflowY,
      pointerEvents: getComputedStyle(element).pointerEvents,
    }))).toEqual({
      overflowX: 'hidden',
      overflowY: 'hidden',
      pointerEvents: 'none',
    });

    const [groupBox, previewBox] = await Promise.all([
      group.boundingBox(),
      preview.boundingBox(),
    ]);
    expect(groupBox).not.toBeNull();
    expect(previewBox).not.toBeNull();
    expect((groupBox?.y ?? 0) + (groupBox?.height ?? 0))
      .toBeLessThanOrEqual(previewBox?.y ?? 0);
    await capture(page, '04-about-chooser-four-cards-first');
    await capture(page, '05-about-inline-preview-below-cards', preview);

    for (const viewport of [
      { height: 568, width: 320 },
      { height: 844, width: 390 },
      { height: 390, width: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const columns = await group.evaluate((element) =>
        getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length);
      expect(columns).toBe(2);
      const frameScrollBefore = await frame.evaluate((element) => ({
        left: element.scrollLeft,
        top: element.scrollTop,
      }));
      const outerScrollBefore = await wheelDownOver(page, preview);
      await expect.poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(outerScrollBefore + 20);
      expect(await frame.evaluate((element) => ({
        left: element.scrollLeft,
        top: element.scrollTop,
      }))).toEqual(frameScrollBefore);
    }
    await capture(page, '06-about-outer-scroll-from-preview-centre');

    await page.setViewportSize({ height: 844, width: 390 });
    const openInteractive = page.getByRole('button', { name: 'Open interactive preview' });
    await cards.last().focus();
    await page.keyboard.press('Tab');
    await expect(openInteractive).toBeFocused();
    await openInteractive.click();
    const fullPreview = page.getByRole('dialog', { name: 'Preview your About section' });
    await expect(fullPreview).toBeVisible();
    const interactiveFrame = fullPreview.locator('.onboarding-preview-frame');
    await expect(interactiveFrame).toHaveAttribute('tabindex', '0');
    await expect(interactiveFrame).not.toHaveAttribute('inert', '');
    await expect(fullPreview.getByRole('link', { name: /Book/u }).first()).toBeVisible();
    await capture(page, '07-interactive-about-preview');
  });

  test('profile photo and logo retain distinct roles and asset identities after reload', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    const branding = await reachBrandingCard(page);

    const profileField = page.locator('.onboarding-image-upload').filter({
      has: page.getByText('Profile photo', { exact: true }),
    });
    const logoField = page.locator('.onboarding-image-upload').filter({
      has: page.getByText('Logo', { exact: true }),
    });
    await page.getByLabel('Profile photo', { exact: true }).setInputFiles(PORTRAIT_PATH);
    await page.getByLabel('Logo', { exact: true }).setInputFiles(LOGO_PATH);
    await expect(profileField.getByRole('status')).toContainText('Profile photo ready');
    await expect(logoField.getByRole('status')).toContainText('Logo ready');
    await expect(profileField.locator('img')).toBeVisible();
    await expect(logoField.locator('img')).toBeVisible();
    await expect(branding).toContainText('Photo · Logo');
    await expect(branding).toContainText('Complete');
    await waitForSaved(page);
    await capture(page, '08-both-profile-and-logo-uploaded');

    const beforeReload = await readStoredState(page);
    expect(beforeReload.profile.profilePhoto?.id).toBeTruthy();
    expect(beforeReload.profile.logo?.id).toBeTruthy();
    expect(beforeReload.profile.profilePhoto?.id).not.toBe(beforeReload.profile.logo?.id);
    expect(beforeReload.profile.profilePhoto?.storageId).not.toBe(
      beforeReload.profile.logo?.storageId,
    );

    await page.reload();
    await expect(heading(page, 'Make it yours')).toBeVisible();
    await expect(branding).toHaveAttribute('aria-expanded', 'true');
    await expect(profileField.getByRole('status')).toContainText('Profile photo ready');
    await expect(logoField.getByRole('status')).toContainText('Logo ready');
    const afterReload = await readStoredState(page);
    expect(afterReload.profile.profilePhoto?.id).toBe(beforeReload.profile.profilePhoto?.id);
    expect(afterReload.profile.logo?.id).toBe(beforeReload.profile.logo?.id);
    expect(afterReload.profile.profilePhoto?.storageId)
      .toBe(beforeReload.profile.profilePhoto?.storageId);
    expect(afterReload.profile.logo?.storageId).toBe(beforeReload.profile.logo?.storageId);

    await continueToAboutDesign(page);
    const preview = page.getByLabel(/Selected About design preview:/u);
    const logo = preview.locator('[data-media-role="logo"]');
    const portrait = preview.locator('[data-media-role="profile"]').first();
    await expect(logo).toHaveCount(1);
    await expect(logo).toHaveAttribute('alt', 'Isla Role Studio logo');
    await expect(portrait).toHaveAttribute('alt', 'Daniela profile photo');
    await expect(logo).toHaveCSS('object-fit', 'contain');
    await expect(portrait).toHaveCSS('object-fit', 'cover');
    expect(await logo.getAttribute('src')).not.toBe(await portrait.getAttribute('src'));
    await capture(page, '09-customer-header-showing-logo', preview);
    await capture(
      page,
      '10-about-showing-profile',
      preview.getByRole('region', { name: 'About' }),
    );

    const bothMedia = beforeReload.profile;
    await writeStoredMediaRoles(page, {
      profilePhoto: bothMedia.profilePhoto,
    });
    const profileOnlyPreview = page.getByLabel(/Selected About design preview:/u);
    await expect(profileOnlyPreview.locator('.onboarding-customer-brand img')).toHaveCount(0);
    await expect(profileOnlyPreview.locator('.onboarding-customer-brand i')).toBeVisible();
    await expect(profileOnlyPreview.locator('img[data-media-role="profile"]').first())
      .toBeVisible();
    await capture(page, '11-profile-only-fallback-state', profileOnlyPreview);

    await writeStoredMediaRoles(page, {
      logo: bothMedia.logo,
    });
    const logoOnlyPreview = page.getByLabel(/Selected About design preview:/u);
    await expect(logoOnlyPreview.locator('img[data-media-role="logo"]')).toBeVisible();
    await expect(logoOnlyPreview.locator('img[data-media-role="profile"]')).toHaveCount(0);
    await expect(logoOnlyPreview.getByRole('img', {
      name: 'Daniela portrait placeholder',
    }).first()).toBeVisible();
    await capture(page, '12-logo-only-fallback-state', logoOnlyPreview);

    await writeStoredMediaRoles(page, {});
    const neitherPreview = page.getByLabel(/Selected About design preview:/u);
    await expect(neitherPreview.locator('.onboarding-customer-brand img')).toHaveCount(0);
    await expect(neitherPreview.locator('.onboarding-customer-brand i')).toBeVisible();
    await expect(neitherPreview.locator('img[data-media-role="profile"]')).toHaveCount(0);
    await expect(neitherPreview.getByRole('img', {
      name: 'Daniela portrait placeholder',
    }).first()).toBeVisible();
    await capture(page, '13-neither-media-fallback-state', neitherPreview);
  });

  test('one combined policy stays coherent for fixed and no-deposit modes and yields one readiness item', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openAuditFresh(page);
    await applyFixture(page, 'About Off', 'Set clear expectations');
    await preparePolicyState(page, 'fixed');

    const combinedTrigger = page.locator(
      'button[aria-controls="onboarding-policy-deposits-cancellations-panel"]',
    );
    await expect(combinedTrigger).toContainText('Deposits & cancellations');
    await expect(combinedTrigger).toContainText('Finish your deposit and cancellation rules');
    await combinedTrigger.click();
    await expect(combinedTrigger).toHaveAttribute('aria-expanded', 'false');
    await capture(page, '14-combined-policy-collapsed', combinedTrigger);
    await combinedTrigger.click();
    await expect(page.getByText('From your Booking settings')).toBeVisible();
    await expect(page.getByText('$15 deposit', { exact: true })).toBeVisible();

    await page.getByLabel('How much notice do clients need to cancel?')
      .selectOption('24_hours');
    await page.getByLabel('What happens to the deposit if they cancel late?')
      .selectOption('deposit_lost');
    await page.getByLabel('Can clients get their deposit back?').selectOption('no');
    await page.getByLabel('Can clients move it to another appointment?').selectOption('no');
    await expect(combinedTrigger).toContainText('Complete');
    await expect(combinedTrigger).toContainText(
      '$15 deposit · 24 hours’ notice · deposit kept after late cancellation',
    );
    const policyCopy = page.locator('.onboarding-policy-copy-card').filter({
      hasText: 'Deposits & cancellations',
    });
    await policyCopy.locator('summary').click();
    await expect(policyCopy).toContainText('A $15 deposit is required to book.');
    await expect(policyCopy).toContainText(
      'Please provide at least 24 hours’ notice when cancelling or rescheduling.',
    );
    await expect(policyCopy).toContainText('Deposits are kept after late cancellations.');
    await expect(policyCopy).toContainText(
      'Before the deadline, deposits are non-refundable.',
    );
    await expect(policyCopy).toContainText(
      'Before the deadline, deposits cannot be moved to another appointment.',
    );
    await capture(page, '15-combined-policy-fixed-deposit-expanded');
    await capture(page, '17-combined-policy-complete', combinedTrigger);
    await capture(page, '18-combined-customer-wording', policyCopy);

    await continuePoliciesToReview(page);
    const readiness = page.getByRole('complementary', { name: 'Site readiness' });
    await readiness.getByRole('button', { name: /View checklist/u }).click();
    await expect(readiness.getByText('Deposits & cancellation policy', { exact: true }))
      .toHaveCount(1);
    // Schema v2: the Deposits & cancellations section defaults to
    // `wordingMode: 'summary'` (src/model/section-library/registry.ts), so once
    // the rules are complete the customer site publishes the same one-line
    // summary the owner's trigger shows, not the long-form wording that stays
    // on the owner's policy copy card above.
    await expect(page.getByLabel('Final phone customer preview')
      .locator('.customer-lib-deposits .customer-lib-policy-body'))
      .toHaveText('$15 deposit · 24 hours’ notice · deposit kept after late cancellation');
    await capture(page, '19-review-combined-readiness-item', readiness);

    await preparePolicyState(page, 'none');
    await expect(page.getByText('No deposit', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Can clients get their deposit back?')).toHaveCount(0);
    await expect(page.getByLabel('Can clients move it to another appointment?')).toHaveCount(0);
    await expect(page.getByText(/keep the deposit/iu)).toHaveCount(0);
    await page.getByLabel('How much notice do clients need to cancel?')
      .selectOption('24_hours');
    await page.getByLabel('What happens if they cancel late?')
      .selectOption('cancellation_fee');
    await expect(combinedTrigger).toContainText('Complete');
    await expect(combinedTrigger).toContainText('No deposit · 24 hours’ notice');
    const noDepositCopy = page.locator('.onboarding-policy-copy-card').filter({
      hasText: 'Deposits & cancellations',
    });
    await noDepositCopy.locator('summary').click();
    await expect(noDepositCopy).toContainText('No deposit is required.');
    await expect(noDepositCopy).toContainText(
      'Please provide at least 24 hours’ notice when cancelling or rescheduling.',
    );
    await expect(noDepositCopy).toContainText(
      'Late cancellations incur a cancellation fee.',
    );
    await expect(noDepositCopy).not.toContainText(/non-refundable|cannot be transferred/iu);
    await capture(page, '16-combined-policy-no-deposit-expanded');

    await continuePoliciesToReview(page);
    const noDepositReadiness = page.getByRole('complementary', { name: 'Site readiness' });
    await noDepositReadiness.getByRole('button', { name: /View checklist/u }).click();
    await expect(noDepositReadiness.getByText(
      'Deposits & cancellation policy',
      { exact: true },
    )).toHaveCount(1);
    const finalPreview = page.getByLabel('Final phone customer preview');
    await expect(finalPreview.locator('.customer-lib-deposits .customer-lib-policy-body'))
      .toHaveText('No deposit · 24 hours’ notice');
    await expect(finalPreview).not.toContainText(
      /A (?:\$\d+(?:\.\d{2})? )?deposit is required|deposits are non-refundable/iu,
    );
  });
});
