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

const EVIDENCE_ROOT = '/tmp/luster-onboarding-daniela-final-polish';
const EVIDENCE_DIRECTORY = `${EVIDENCE_ROOT}/evidence`;
const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';
const PORTRAIT_PATH = fileURLToPath(new URL(
  '../../src/onboarding/fixtures/assets/daniela-placeholder.jpg',
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
  await expect(heading(page, 'Let’s build your website')).toBeVisible();
}

async function openAuditFresh(page: Page): Promise<void> {
  await page.goto('/?audit=1');
  await expect(heading(page, 'Let’s build your website')).toBeVisible();
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

async function completeBasicsToBooking(page: Page): Promise<void> {
  await page.getByLabel('Salon or studio name').fill('Daniela Test Studio');
  await page.getByLabel('Your name').fill('Daniela');
  await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
    .getByRole('radio', { name: 'Solo nail tech' })
    .check();
  await page.getByRole('button', { exact: true, name: 'Continue' }).click();
  await expect(heading(page, 'Add your photo and Instagram')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(heading(page, 'Where can clients find you?')).toBeVisible();
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
    await page.getByRole('button', { name: 'Build my website' }).click();
    await expect(heading(page, 'Tell us about your nail business')).toBeVisible();

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

  test('V01 complete Daniela onboarding journey with truthful setup states', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await page.getByLabel('Salon or studio name').fill('Isla Nail Studio');
    await page.getByLabel('Your name').fill('Daniela');
    await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
      .getByRole('radio', { name: 'Solo nail tech' })
      .check();
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await page.getByLabel('Profile photo', { exact: true }).setInputFiles(PORTRAIT_PATH);
    await page.getByLabel('Instagram handle').fill('@islanail.studio');
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
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
    await capture(page, '04-contact-setup-complete');

    await page.locator('button[aria-controls="onboarding-hours-card-panel"]').click();
    await captureViewport(page, '05a-hours-set-up-supporting');
    await page.getByLabel('Monday opens').fill('09:00');
    await page.getByLabel('Monday closes').fill('17:00');
    await page.getByRole('button', { name: 'Copy Monday to weekdays' }).click();
    await page.getByRole('group', { name: 'Saturday' }).getByRole('checkbox', { name: 'Closed' }).check();
    await page.getByRole('group', { name: 'Sunday' }).getByRole('checkbox', { name: 'Closed' }).check();
    await capture(page, '05b-hours-complete-supporting');
    const showHours = page.getByRole('switch', { name: 'Show hours on my website' });
    await showHours.uncheck();
    await capture(page, '05-hours-setup-not-shown-complete');
    await showHours.check();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await page.getByRole('group', { name: 'How do you accept clients?' })
      .getByRole('radio', { name: 'Appointment only' })
      .check();
    await page.getByRole('group', { name: 'Are you accepting new clients?' })
      .getByRole('radio', { name: 'Yes' })
      .check();
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

    await page.locator('[data-starter-id="one_page"]').click();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
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
    await page.getByLabel('What happens if they cancel late?').selectOption('deposit_lost');
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
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expect(heading(page, 'Review your site')).toBeVisible();
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await page.getByRole('dialog', { name: 'Your site is saved' })
      .getByRole('button', { name: 'Continue free' })
      .click();
    await expect(heading(page, 'You’re ready')).toBeVisible();
  });

  test('V02 service library is visual, searchable, and changes one canonical selection', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
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
    const services = dialog.getByRole('list', { name: 'Library services' });
    await expect(services.locator('img').first()).toBeVisible();
    const imageMetrics = await services.locator('img').first().evaluate((image) => ({
      complete: (image as HTMLImageElement).complete,
      naturalHeight: (image as HTMLImageElement).naturalHeight,
      naturalWidth: (image as HTMLImageElement).naturalWidth,
    }));
    expect(imageMetrics.complete).toBe(true);
    expect(imageMetrics.naturalWidth).toBeGreaterThan(0);
    expect(imageMetrics.naturalHeight).toBeGreaterThan(0);

    const russianRow = services.getByRole('listitem').filter({ hasText: 'Russian Manicure' });
    await expect(russianRow).toContainText('1 hr 30 min');
    await expect(russianRow).toContainText('From $65');
    await captureLocator(russianRow, '09-selected-service-row');
    await russianRow.getByRole('button', { name: 'Remove Russian Manicure' }).click();
    await expect(russianRow.getByRole('button', { name: 'Add Russian Manicure' })).toBeVisible();
    await captureLocator(russianRow, '10-unselected-service-row');

    await dialog.getByPlaceholder('Search services').pressSequentially('Russian', { delay: 35 });
    await expect(services.getByRole('listitem')).toHaveCount(1);
    await captureViewport(page, '08-service-search-categories');
    await services.getByRole('button', { name: 'Add Russian Manicure' }).click();
    await dialog.getByPlaceholder('Search services').fill('');

    await dialog.getByRole('tab', { name: 'Add-ons' }).click();
    const addOns = dialog.getByRole('list', { name: 'Library add-ons' });
    const frenchRow = addOns.getByRole('listitem').filter({ hasText: 'French' });
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
    await captureViewport(page, '11-service-library-add-ons');
    await addOns.getByRole('listitem').last().scrollIntoViewIfNeeded();
    await expect(dialog.locator('.onboarding-service-library__footer')).toBeVisible();
    await captureViewport(page, '12-service-library-sticky-footer');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await waitForSaved(page);

    const state = await readState(page);
    expect(state.profile.serviceMenu.selectedServiceIds).toContain('svc-manicure-russian');
    expect(new Set(state.profile.serviceMenu.selectedServiceIds).size)
      .toBe(state.profile.serviceMenu.selectedServiceIds.length);
    const timePreview = page.getByLabel('Bookable appointment times after minimum notice');
    await timePreview.scrollIntoViewIfNeeded();
    await expect(timePreview.locator('[data-bookable-time]').first()).toBeVisible();
    await captureLocator(timePreview, '13-plausible-appointment-times');
    const bookingStatus = page.getByLabel('Booking connection status');
    await bookingStatus.scrollIntoViewIfNeeded();
    await captureViewport(page, '14-booking-summary-above-footer');
    await expectNoHorizontalOverflow(page);
  });

  test('V03 all four About designs render Daniela’s same content in distinct presets', async ({ page }) => {
    await page.setViewportSize({ height: 800, width: 1180 });
    await openAuditFresh(page);
    await applyFixture(page, 'Multi-page starter', 'Your starting site is ready');
    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expect(heading(page, 'Choose your About design')).toBeVisible();

    const presets = [
      ['Photo Right', 'is-photo-right', '15-about-photo-right-mobile', '16-about-photo-right-desktop'],
      ['Editorial Portrait', 'is-editorial', '17-about-editorial-mobile', '18-about-editorial-desktop'],
      ['Profile + Quick Facts', 'is-quick-facts', '19-about-quick-facts-mobile', '20-about-quick-facts-desktop'],
      ['About + Before You Book', 'is-before-booking', '21-about-before-you-book-mobile', '22-about-before-you-book-desktop'],
    ] as const;
    const group = page.getByRole('group', { name: 'About design presets' });
    const preview = page.getByLabel('Selected About design preview');
    const measurements: Array<Record<string, unknown>> = [];

    const measurePreset = async (
      label: string,
      className: string,
      viewport: { height: number; width: number },
    ): Promise<void> => {
      const section = preview.locator(`.onboarding-customer-about.${className}`);
      const book = section.getByRole('link', { name: 'Book now' });
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
      const tokens = await preview.locator('.onboarding-site-preview').evaluate((element) => {
        const styles = getComputedStyle(element);
        return [
          styles.getPropertyValue('--customer-ground'),
          styles.getPropertyValue('--customer-ink'),
          styles.getPropertyValue('--customer-accent'),
          styles.fontFamily,
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

  test('V06 plan cards preserve one selected intent and a usable short-phone layout', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openAuditFresh(page);
    await applyFixture(page, 'All essentials complete', 'Review your site');
    await page.getByRole('button', { name: 'Finish setup' }).click();
    const plan = page.getByRole('dialog', { name: 'Your site is saved' });
    const free = plan.getByRole('radio', { name: /^Free/u });
    const founding = plan.getByRole('radio', { name: /^Founding offer/u });
    const monthly = plan.getByRole('radio', { name: /^Monthly plan/u });
    await expect(free).toBeChecked();
    await captureViewport(page, '39-plan-free-initial');

    await founding.locator('xpath=..').click();
    await expect(founding).toBeChecked();
    await expect(plan.getByRole('button', { name: 'Reserve founding offer' })).toBeVisible();
    await captureViewport(page, '40-plan-founding-selected');

    await monthly.locator('xpath=..').click();
    await expect(monthly).toBeChecked();
    await expect(plan.getByRole('button', { name: 'I’m interested in monthly' })).toBeVisible();
    await captureViewport(page, '41-plan-monthly-selected');
    await plan.getByText('Compare what’s included', { exact: true }).click();
    await capture(page, '42-plan-comparison');

    await page.setViewportSize({ height: 568, width: 320 });
    await free.locator('xpath=..').click();
    await expect(plan.getByRole('button', { name: 'Continue free' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await captureViewport(page, '43-plan-short-phone');
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
    await expect(plan.getByRole('radio', { name: /^Monthly plan/u })).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Continue free' })).toBeVisible();
    await expect(plan).toContainText('There is no payment or plan access change today.');
    await captureLocator(plan, '39-plan-free-initial');
    await plan.getByRole('button', { name: 'Continue free' }).click();

    await expect(heading(page, 'You’re ready')).toBeVisible();
    await expect(page.getByText(/Daniela, your website, booking page and service menu are set up/u))
      .toBeVisible();
    await captureViewport(page, 'dashboard-audit-arrival-supporting');

    await page.goto('/');
    await expect(heading(page, 'You’re ready')).toBeVisible();
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
    await expect(heading(page, 'You’re ready')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'A quick look around Luster' })).toHaveCount(0);
    await page.locator('.lab-dashboard-preview__welcome')
      .getByRole('button', { name: 'Take a quick tour' })
      .click();
    const tour = page.getByRole('dialog', { name: 'A quick look around Luster' });
    for (let step = 1; step <= 5; step += 1) {
      await expect(tour.getByLabel(`Tour step ${step} of 5`)).toBeVisible();
      await expect(page.locator('.lab-dashboard-storyboard'))
        .toHaveAttribute('data-tour-highlighted', 'true');
      if (step < 5) await tour.getByRole('button', { name: 'Next' }).click();
    }
    await tour.getByRole('button', { name: 'Done' }).click();
    await expect(tour).toBeHidden();
  });

  test('live Start over and reload restore a clean Welcome', async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await openNormalFresh(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await page.getByLabel('Salon or studio name').fill('Temporary Studio');
    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Start over' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Start over?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { exact: true, name: 'Start over' }).click();
    await expect(heading(page, 'Let’s build your website')).toBeVisible();
    await page.reload();
    await expect(heading(page, 'Let’s build your website')).toBeVisible();
    await expect(page.getByText('Temporary Studio')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await captureViewport(page, '50-clean-welcome');
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
    await page.getByRole('button', { name: 'Build my website' }).click();
    await page.getByLabel('Salon or studio name').fill('WebKit Nail Studio');
    await page.getByLabel('Your name').fill('Avery');
    await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
      .getByRole('radio', { name: 'Solo nail tech' })
      .check();
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await page.getByLabel('Profile photo', { exact: true }).setInputFiles(PORTRAIT_PATH);
    await page.getByLabel('Logo', { exact: true }).setInputFiles(PORTRAIT_PATH);
    await expect(page.getByLabel('Profile preview').getByRole('img').first()).toBeVisible();
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
