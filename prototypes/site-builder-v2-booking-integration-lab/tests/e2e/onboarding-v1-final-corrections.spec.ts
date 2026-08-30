import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  LAB_STORAGE_KEY,
  readCustomDesignAssetRecordCounts,
  startRuntimeMonitor,
} from './helpers';

const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';
const EVIDENCE_DIRECTORY = process.env.LUSTER_EVIDENCE_DIRECTORY
  ?? '/tmp/luster-onboarding-final-corrections';
const DANIELA_PORTRAIT_PATH = fileURLToPath(new URL(
  '../../src/onboarding/fixtures/assets/daniela-placeholder.jpg',
  import.meta.url,
));

type StarterId = 'multi_page' | 'one_page' | 'quick_book';

type StoredOnboardingState = {
  canva: {
    customDesignSectionId: string | null;
    displayMode: string;
    images: Array<{ fileName: string; storageId?: string }>;
    placement: string;
    status: string;
  };
  eventJournal: Array<Record<string, unknown>>;
  gallery: {
    images: Array<{ fileName: string }>;
    layout: string;
    source: string | null;
  };
  profile: {
    about: {
      certifications: string[];
      languages: string[];
      shortBio: string;
    };
    businessName: string;
    businessStructure: string | null;
    clientContact: {
      callEnabled: boolean;
      differentTextNumber: string;
      primaryNumber: string;
      textEnabled: boolean;
      useDifferentTextNumber: boolean;
    };
    hours: {
      setupState: string;
      showOnSite: boolean;
    };
    instagram: string;
    location: {
      addressVisibility: string;
      cityOrArea: string;
      exactAddress: string;
      locationType: string | null;
    };
    ownerName: string;
    policies: {
      cancellations: Record<string, unknown>;
      deposits: {
        amountCents: number | null;
        mode: 'fixed' | 'none';
      };
    };
    preferredContact: string | null;
  };
  progress: {
    currentScreen: string;
    sessionStatus: string;
  };
  recipe: {
    aboutEnabled: boolean;
    aboutPreset: string;
    canvaEnabled: boolean;
    galleryEnabled: boolean;
    policiesEnabled: boolean;
    starter: StarterId | null;
    styleConfirmed: boolean;
    stylePreset: string;
    wantsCanvaFromWelcome: boolean;
  };
};

type StoredBuilderDocument = {
  originStarter: StarterId;
  pages: Array<{
    sections: Array<{ sectionType: string }>;
  }>;
  siteName: string;
};

type BusinessDetails = {
  businessName?: string;
  ownerName?: string;
  structure?: 'Solo nail tech' | 'Team or multi-tech salon';
};

type LocationDetails = {
  addressVisibility?: 'Do not show' | 'Show after booking' | 'Show publicly';
  bookingOnly?: boolean;
  callEnabled?: boolean;
  city?: string;
  differentTextNumber?: string;
  exactAddress?: string;
  instagram?: string;
  locationType?: 'Home studio' | 'Mobile service' | 'Salon suite' | 'Traditional salon';
  phone?: string;
  textEnabled?: boolean;
};

type BookingDetails = {
  deposit?: 'No deposit' | 'Same deposit for every service';
  newClients?: 'Ask me first' | 'No' | 'Waitlist only' | 'Yes';
  visitMode?: 'Appointment only' | 'Appointments and walk-ins' | 'Walk-ins only';
};

const screenHeading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name });

const starterCard = (page: Page, starter: StarterId): Locator =>
  page.locator(`[data-starter-id="${starter}"]`);

const runtimeMonitors = new WeakMap<
  Page,
  ReturnType<typeof startRuntimeMonitor>
>();

async function captureEvidence(page: Page, fileName: string): Promise<void> {
  if (process.env.LUSTER_CAPTURE_EVIDENCE !== '1') return;
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: join(EVIDENCE_DIRECTORY, `${fileName}.png`),
  });
}

async function openFreshOnboarding(page: Page): Promise<void> {
  await page.goto('/?audit=1');
  await expect(screenHeading(page, 'Let’s build your website')).toBeVisible();
}

async function expectScreenAtTop(page: Page, name: string): Promise<void> {
  const heading = screenHeading(page, name);
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBe(0);
  const box = await heading.boundingBox();
  expect(box, `${name} heading must have a layout box`).not.toBeNull();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
}

async function waitForAutosave(page: Page): Promise<void> {
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved', { timeout: 30_000 });
}

async function readOnboardingState(page: Page): Promise<StoredOnboardingState> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Missing browser-local onboarding state.');
    return JSON.parse(raw) as StoredOnboardingState;
  }, ONBOARDING_STORAGE_KEY);
}

async function readBuilderDocument(page: Page): Promise<StoredBuilderDocument> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('Missing browser-local Builder document.');
    return JSON.parse(raw) as StoredBuilderDocument;
  }, LAB_STORAGE_KEY);
}

async function completeBusiness(
  page: Page,
  {
    businessName = 'Mia’s Nail Studio',
    ownerName = 'Mia Torres',
    structure = 'Solo nail tech',
  }: BusinessDetails = {},
): Promise<void> {
  await page.getByLabel('Salon or studio name').fill(businessName);
  await page.getByLabel('Your name').fill(ownerName);
  await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
    .getByRole('radio', { name: structure })
    .check();
  await captureEvidence(page, '15-business-structure');
  await page.getByRole('button', { exact: true, name: 'Continue' }).click();
  await expectScreenAtTop(page, 'Add your photo and Instagram');
  await captureEvidence(page, '26-neutral-instagram-example');
}

async function completePhotoSocial(
  page: Page,
  instagram = '@mias_nails',
): Promise<void> {
  if (instagram) {
    await page.getByLabel('Instagram handle').fill(instagram);
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
  } else {
    await page.getByRole('button', { name: 'Skip for now' }).click();
  }
  await expectScreenAtTop(page, 'Where can clients find you?');
}

async function completeLocation(
  page: Page,
  {
    addressVisibility = 'Show after booking',
    bookingOnly = false,
    callEnabled = true,
    city = 'Kingston, Ontario',
    differentTextNumber = '',
    exactAddress = '',
    locationType = 'Home studio',
    phone = '613-555-0114',
    textEnabled = true,
  }: LocationDetails = {},
): Promise<void> {
  await page.getByLabel('City or general service area').fill(city);
  if (exactAddress) await page.getByLabel('Exact address (optional)').fill(exactAddress);
  await page.getByRole('group', { name: 'Where do you see clients?' })
    .getByRole('radio', { name: locationType })
    .check();
  await page.getByRole('group', { name: 'Who can see your address?' })
    .getByRole('radio', { name: addressVisibility })
    .check();
  await captureEvidence(page, '16-location-type');

  await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
  const bookingOnlyControl = page.getByRole('switch', {
    name: 'Clients should use online booking only',
  });
  if (bookingOnly) {
    await bookingOnlyControl.check();
  } else {
    await bookingOnlyControl.uncheck();
    await page.getByLabel('Phone number clients can use').fill(phone);
    if (callEnabled) await page.getByRole('switch', { name: 'Call this number' }).check();
    if (textEnabled) await page.getByRole('switch', { name: 'Text this number' }).check();
    if (textEnabled && differentTextNumber) {
      await page.getByRole('switch', { name: 'Use a different number for text messages' }).check();
      await page.getByLabel('Text message number').fill(differentTextNumber);
    }
    const preferred = textEnabled ? 'Text' : 'Call';
    await page.getByRole('group', { name: 'Which contact option should we show first?' })
      .getByRole('radio', { name: preferred })
      .check();
    await captureEvidence(page, '21-one-number-call-text-ui');
  }

  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expectScreenAtTop(page, 'How do clients book with you?');
}

async function completeBooking(
  page: Page,
  {
    deposit = 'Same deposit for every service',
    newClients = 'Yes',
    visitMode = 'Appointment only',
  }: BookingDetails = {},
): Promise<void> {
  await page.getByRole('group', { name: 'How do you accept clients?' })
    .getByRole('radio', { name: visitMode })
    .check();
  await page.getByRole('group', { name: 'Are you accepting new clients?' })
    .getByRole('radio', { name: newClients })
    .check();
  await page.getByRole('group', { name: 'How do you handle booking deposits?' })
    .getByRole('radio', { name: deposit })
    .check();
  if (deposit === 'Same deposit for every service') {
    await page.getByRole('group', { name: 'Deposit amount' })
      .getByRole('radio', { name: '$20' })
      .check();
  }
  await page.getByRole('button', { name: 'Save booking setup' }).click();
  await expectScreenAtTop(page, 'Choose your starting point');
}

async function reachStarter(
  page: Page,
  business: BusinessDetails = {},
  location: LocationDetails = {},
  booking: BookingDetails = {},
): Promise<void> {
  await openFreshOnboarding(page);
  await page.getByRole('button', { name: 'Build my website' }).click();
  await expectScreenAtTop(page, 'Tell us about your nail business');
  await completeBusiness(page, business);
  await completePhotoSocial(page, location.instagram ?? '@mias_nails');
  await completeLocation(page, location);
  await completeBooking(page, booking);
}

async function chooseStarter(page: Page, starter: StarterId): Promise<void> {
  await starterCard(page, starter).click();
  await expectScreenAtTop(page, 'Your starting site is ready');
  await waitForAutosave(page);
}

async function switchStarter(page: Page, starter: StarterId): Promise<void> {
  await starterCard(page, starter).click();
  const target = starter === 'quick_book'
    ? 'Quick Book'
    : starter === 'one_page'
      ? 'One-page website'
      : 'Multi-page website';
  const dialog = page.getByRole('dialog', { name: `Switch to ${target}?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep current' })).toBeVisible();
  await dialog.getByRole('button', { exact: true, name: `Switch to ${target}` }).click();
  await expect(dialog).toBeHidden();
  await expectScreenAtTop(page, 'Your starting site is ready');
  await waitForAutosave(page);
}

async function expectStarterDocumentShape(
  page: Page,
  starter: StarterId,
): Promise<void> {
  await waitForAutosave(page);
  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return (JSON.parse(raw) as StoredBuilderDocument).originStarter;
  }, LAB_STORAGE_KEY)).toBe(starter);
  const document = await readBuilderDocument(page);
  expect(document.originStarter).toBe(starter);
  const sectionCount = document.pages.reduce(
    (total, current) => total + current.sections.length,
    0,
  );
  if (starter === 'quick_book') {
    expect(document.pages).toHaveLength(1);
    expect(sectionCount).toBe(3);
  } else if (starter === 'one_page') {
    expect(document.pages).toHaveLength(1);
    expect(sectionCount).toBe(6);
  } else {
    expect(document.pages).toHaveLength(5);
  }
}

async function reachAbout(page: Page): Promise<void> {
  await reachStarter(page);
  await chooseStarter(page, 'one_page');
  await page.getByRole('button', { name: 'Continue setting up my site' }).click();
  await expectScreenAtTop(page, 'Would you like an About section?');
}

async function openLabReviewOptions(page: Page): Promise<Locator> {
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lab review options' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function applyFixture(
  page: Page,
  label: string,
  destinationHeading: string,
): Promise<void> {
  const dialog = await openLabReviewOptions(page);
  await dialog.getByRole('button', { exact: true, name: label }).click();
  await expect(dialog).toBeHidden();
  await expectScreenAtTop(page, destinationHeading);
  await waitForAutosave(page);
}

async function applyFixtureFromFresh(
  page: Page,
  label: string,
  destinationHeading: string,
): Promise<void> {
  await openFreshOnboarding(page);
  await page.getByRole('button', { name: 'Build my website' }).click();
  await expectScreenAtTop(page, 'Tell us about your nail business');
  await applyFixture(page, label, destinationHeading);
}

async function addSampleGallery(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add Gallery' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Gallery' });
  await dialog.getByRole('button', { name: /Use example nail photos/u }).click();
  await dialog.getByRole('button', { exact: true, name: 'Add Gallery' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Added: .*Gallery/u)).toBeVisible();
}

async function addCanva(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Upload Canva design|Edit design/u }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload a Canva design' });
  await dialog.locator('input[type="file"]').setInputFiles(DANIELA_PORTRAIT_PATH);
  const selected = dialog.getByRole('list', { name: 'Selected Canva pages' });
  await expect(selected.locator('img')).toBeVisible();
  await expect(selected.getByText(/\d+ × \d+px · Ready to add/u)).toBeVisible();
  await dialog.getByRole('radio', { name: 'Contained' }).check();
  await dialog.getByRole('radio', { name: 'After Booking' }).check();
  await dialog.getByRole('button', { name: 'Add Canva design' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Added: .*Canva/u)).toBeVisible();
}

test.describe('Onboarding V1 final correction matrix', () => {
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

  test('OB-04, OB-11, OB-14, and OB-20 keep transitions, validation, More, and switches accessible', async ({ page }) => {
    await page.setViewportSize({ height: 568, width: 320 });
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await expectScreenAtTop(page, 'Tell us about your nail business');

    const more = page.getByLabel('More onboarding options');
    await more.click();
    await expect(page.getByRole('menuitem', { name: 'Save and finish later' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Save and finish later' })).toBeHidden();
    await expect(more).toBeFocused();
    await captureEvidence(page, '24-more-closed-on-escape');

    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    const firstInvalid = page.getByLabel('Salon or studio name');
    await expect(firstInvalid).toBeFocused();
    await expect(firstInvalid).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Add your salon or studio name.').first()).toBeVisible();
    await captureEvidence(page, '12-first-invalid-field-focused');

    await firstInvalid.fill('North Shore Nails');
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await expect(page.getByLabel('Your name')).toBeFocused();

    await page.getByLabel('Your name').fill('Nora Singh');
    await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
      .getByRole('radio', { name: 'Solo nail tech' })
      .check();
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await expectScreenAtTop(page, 'Add your photo and Instagram');
    await captureEvidence(page, '11-screen-title-after-transition');
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expectScreenAtTop(page, 'Where can clients find you?');

    await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
    const bookingOnly = page.getByRole('switch', { name: 'Clients should use online booking only' });
    const hitTarget = bookingOnly.locator('xpath=..');
    const targetBox = await hitTarget.boundingBox();
    expect(targetBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(targetBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await captureEvidence(page, '28-44px-switch-target');
    await expect(bookingOnly).toBeChecked();
    await bookingOnly.focus();
    await page.keyboard.press('Space');
    await expect(bookingOnly).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(bookingOnly).toBeChecked();

    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByLabel('City or general service area')).toBeFocused();
    await expect(page.getByText('Add a city or general service area.').last()).toBeVisible();
  });

  test('Journey F switches Quick Book → One-page → Multi-page → Quick Book without losing the entered profile', async ({ page }) => {
    await reachStarter(page, {
      businessName: 'North Shore Nails',
      ownerName: 'Nora Singh',
      structure: 'Team or multi-tech salon',
    }, {
      city: 'North Vancouver, British Columbia',
      instagram: '@northshore_nails',
      locationType: 'Traditional salon',
      phone: '604-555-0191',
    }, {
      deposit: 'Same deposit for every service',
      visitMode: 'Appointments and walk-ins',
    });

    await starterCard(page, 'quick_book').focus();
    await page.keyboard.press('Enter');
    await expectScreenAtTop(page, 'Your starting site is ready');
    await waitForAutosave(page);
    await expectStarterDocumentShape(page, 'quick_book');
    const original = await readOnboardingState(page);
    const profileFingerprint = JSON.stringify(original.profile);

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectScreenAtTop(page, 'Choose your starting point');
    await expect(starterCard(page, 'quick_book')).toHaveAttribute('aria-pressed', 'true');
    await expect(starterCard(page, 'quick_book').getByText('Current starting point')).toBeVisible();
    await captureEvidence(page, '01-active-starter-marker');

    await starterCard(page, 'one_page').click();
    const confirmation = page.getByRole('dialog', { name: 'Switch to One-page website?' });
    await expect(confirmation).toContainText('keeps your business information, About details, policies, style choices, photos, Gallery draft, Canva design, and onboarding progress saved');
    await captureEvidence(page, '02-starter-switch-confirmation');
    await confirmation.getByRole('button', { exact: true, name: 'Switch to One-page website' }).click();
    await expectScreenAtTop(page, 'Your starting site is ready');
    await expectStarterDocumentShape(page, 'one_page');
    expect(JSON.stringify((await readOnboardingState(page)).profile)).toBe(profileFingerprint);
    await captureEvidence(page, '03-starter-switch-information-preserved');

    await page.reload();
    await expect(screenHeading(page, 'Your starting site is ready')).toBeVisible();
    await expect(page.getByLabel('Personalized starting site')
      .getByText('One-page website', { exact: true })).toBeVisible();
    expect(JSON.stringify((await readOnboardingState(page)).profile)).toBe(profileFingerprint);

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expect(starterCard(page, 'one_page')).toHaveAttribute('aria-pressed', 'true');
    await switchStarter(page, 'multi_page');
    await expectStarterDocumentShape(page, 'multi_page');
    expect(JSON.stringify((await readOnboardingState(page)).profile)).toBe(profileFingerprint);

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await switchStarter(page, 'quick_book');
    await expectStarterDocumentShape(page, 'quick_book');
    expect(JSON.stringify((await readOnboardingState(page)).profile)).toBe(profileFingerprint);

    await page.goBack();
    await expectScreenAtTop(page, 'Choose your starting point');
    await expect(starterCard(page, 'quick_book')).toHaveAttribute('aria-pressed', 'true');
    await captureEvidence(page, '13-browser-back');
    await page.goForward();
    await expectScreenAtTop(page, 'Your starting site is ready');
    await captureEvidence(page, '14-browser-forward');
  });

  test('OB-01 preserves About, policies, style, Gallery, and uploaded Canva data through a starter change', async ({ page }) => {
    await reachAbout(page);
    await page.getByLabel('Short bio').fill('I create careful, natural-looking nail appointments.');
    await page.getByText('More about you', { exact: true }).click();
    await page.getByLabel('Certifications — optional').fill('Structured gel course, Nail art certification');
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expectScreenAtTop(page, 'Choose your About design');
    await page.getByRole('button', { name: /About \+ Before You Book/u }).click();
    await page.getByRole('button', { name: 'Use this design' }).click();
    await expectScreenAtTop(page, 'Set clear expectations');
    await page.getByLabel('How much notice do clients need to cancel?').selectOption('24_hours');
    await page.getByRole('button', { name: 'Save policies' }).click();
    await expectScreenAtTop(page, 'Choose your website style');
    await page.getByRole('button', { name: /^Luxury/u }).click();
    await page.getByRole('button', { name: 'Use Luxury' }).click();
    await expectScreenAtTop(page, 'Add something extra');
    await addSampleGallery(page);
    await addCanva(page);
    await waitForAutosave(page);

    const before = await readOnboardingState(page);
    const preserved = {
      about: before.profile.about,
      canva: {
        displayMode: before.canva.displayMode,
        images: before.canva.images,
        placement: before.canva.placement,
        status: before.canva.status,
      },
      gallery: before.gallery,
      policies: before.profile.policies,
      recipe: {
        aboutEnabled: before.recipe.aboutEnabled,
        aboutPreset: before.recipe.aboutPreset,
        canvaEnabled: before.recipe.canvaEnabled,
        galleryEnabled: before.recipe.galleryEnabled,
        policiesEnabled: before.recipe.policiesEnabled,
        styleConfirmed: before.recipe.styleConfirmed,
        stylePreset: before.recipe.stylePreset,
      },
    };

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectScreenAtTop(page, 'Choose your website style');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectScreenAtTop(page, 'Set clear expectations');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectScreenAtTop(page, 'Choose your About design');
    await page.getByRole('button', { name: 'Back to edit About' }).click();
    await expectScreenAtTop(page, 'Would you like an About section?');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectScreenAtTop(page, 'Your starting site is ready');
    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await expectScreenAtTop(page, 'Choose your starting point');
    await switchStarter(page, 'multi_page');

    const after = await readOnboardingState(page);
    expect({
      about: after.profile.about,
      canva: {
        displayMode: after.canva.displayMode,
        images: after.canva.images,
        placement: after.canva.placement,
        status: after.canva.status,
      },
      gallery: after.gallery,
      policies: after.profile.policies,
      recipe: {
        aboutEnabled: after.recipe.aboutEnabled,
        aboutPreset: after.recipe.aboutPreset,
        canvaEnabled: after.recipe.canvaEnabled,
        galleryEnabled: after.recipe.galleryEnabled,
        policiesEnabled: after.recipe.policiesEnabled,
        styleConfirmed: after.recipe.styleConfirmed,
        stylePreset: after.recipe.stylePreset,
      },
    }).toEqual(preserved);
    expect(after.canva.images).toHaveLength(before.canva.images.length);
    expect(after.canva.customDesignSectionId).toBeTruthy();

    const document = await readBuilderDocument(page);
    const customDesignCount = document.pages.flatMap((item) => item.sections)
      .filter((section) => section.sectionType === 'custom_design').length;
    const bookingCount = document.pages.flatMap((item) => item.sections)
      .filter((section) => section.sectionType === 'booking').length;
    expect(customDesignCount).toBe(1);
    expect(bookingCount).toBe(1);
  });

  test('Journey I keeps character-by-character list editing intact and makes the writing helper confirmable and undoable', async ({ page }) => {
    await reachAbout(page);
    await page.getByText('More about you', { exact: true }).click();
    const certifications = page.getByLabel('Certifications — optional');
    const languages = page.getByLabel('Languages — optional');

    await certifications.pressSequentially('Russian manicure certification, BIAB certification', { delay: 8 });
    await expect(certifications).toHaveValue('Russian manicure certification, BIAB certification');
    await captureEvidence(page, '04-certifications-typed-with-commas');
    await certifications.press('ControlOrMeta+ArrowLeft');
    await certifications.press('End');
    await languages.pressSequentially('Eng, Fr', { delay: 12 });
    await expect(languages).toHaveValue('Eng, Fr');
    await languages.press('ControlOrMeta+A');
    await languages.pressSequentially('English, Spanish', { delay: 8 });
    await expect(languages).toHaveValue('English, Spanish');
    await captureEvidence(page, '05-languages-typed-with-commas');

    const bio = page.getByLabel('Short bio');
    await bio.fill('My own carefully written bio.');
    await page.getByRole('button', { name: /Help me with wording/u }).click();
    const suggestion = page.getByRole('dialog', { name: 'Use this suggested bio?' });
    await expect(suggestion).toContainText('Current bio');
    await expect(suggestion).toContainText('My own carefully written bio.');
    await expect(suggestion).toContainText('Suggested bio');
    await expect(bio).toHaveValue('My own carefully written bio.');
    await captureEvidence(page, '22-wording-suggestion-confirmation');
    await suggestion.getByRole('button', { name: 'Keep my bio' }).click();
    await expect(bio).toHaveValue('My own carefully written bio.');

    await page.getByRole('button', { name: /Help me with wording/u }).click();
    await page.getByRole('dialog', { name: 'Use this suggested bio?' })
      .getByRole('button', { name: 'Use suggestion' })
      .click();
    await expect(bio).toHaveValue(/^I’m Mia Torres/u);
    await page.getByRole('button', { exact: true, name: 'Undo suggestion' }).click();
    await expect(bio).toHaveValue('My own carefully written bio.');
    await captureEvidence(page, '23-wording-helper-undo');

    const aboutSwitch = page.getByRole('switch', { name: 'Include an About section' });
    await aboutSwitch.focus();
    await page.keyboard.press('Space');
    await expect(aboutSwitch).not.toBeChecked();
    await expect(page.getByText('About section is not shown on your site. Your information is still saved.')).toBeVisible();
    await expect(bio).toBeDisabled();
    await expect(certifications).toBeDisabled();
    const accessibility = await page.context().newCDPSession(page);
    const { nodes } = await accessibility.send('Accessibility.getFullAXTree');
    const shortBioNode = nodes.find((node) =>
      node.name?.value === 'Short bio' && node.role?.value === 'textbox');
    expect(shortBioNode?.properties?.some((property) =>
      property.name === 'disabled' && property.value?.value === true)).toBe(true);
    await accessibility.detach();
    await captureEvidence(page, '27-about-disabled-semantics');
    await aboutSwitch.focus();
    await page.keyboard.press('Space');
    await expect(aboutSwitch).toBeChecked();
    await expect(bio).toBeEnabled();
    await expect(bio).toBeFocused();
    await expect(certifications).toHaveValue('Russian manicure certification, BIAB certification');
    await expect(languages).toHaveValue('English, Spanish');

    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expectScreenAtTop(page, 'Choose your About design');
    await waitForAutosave(page);
    const state = await readOnboardingState(page);
    expect(state.profile.about.certifications).toEqual([
      'Russian manicure certification',
      'BIAB certification',
    ]);
    expect(state.profile.about.languages).toEqual(['English', 'Spanish']);
    expect(state.eventJournal.some((event) => Object.values(event).includes('My own carefully written bio.'))).toBe(false);

    await waitForAutosave(page);
    await page.reload();
    await expect(screenHeading(page, 'Choose your About design')).toBeVisible();
    await page.getByRole('button', { name: 'Back to edit About' }).click();
    await expect(certifications).toHaveValue('Russian manicure certification, BIAB certification');
    await expect(languages).toHaveValue('English, Spanish');
  });

  test('Journey H keeps hours honest, derives open/closed status, and never leaks a private address through Directions', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await completeBusiness(page);
    await completePhotoSocial(page);

    const hoursTrigger = page.locator('button[aria-controls="onboarding-hours-card-panel"]');
    await expect(hoursTrigger).toContainText('Add your business hours');
    await expect(hoursTrigger).toContainText('Set up');
    await expect(hoursTrigger).not.toContainText('Complete');
    await captureEvidence(page, '06-untouched-hours-state');

    await page.getByLabel('City or general service area').fill('Ottawa, Ontario');
    await page.getByLabel('Exact address (optional)').fill('123 Private Studio Lane');
    await page.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Home studio' })
      .check();
    await page.getByRole('group', { name: 'Who can see your address?' })
      .getByRole('radio', { name: 'Show after booking' })
      .check();
    const locationPreview = page.getByRole('img', {
      name: /Location and contact visual preview/u,
    });
    await expect(locationPreview).toContainText('Exact address shared after booking.');
    await expect(locationPreview).not.toContainText('123 Private Studio Lane');
    await expect(locationPreview).not.toContainText('Directions');
    await captureEvidence(page, '25-directions-hidden-private-address');

    await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
    await page.getByRole('switch', { name: 'Clients should use online booking only' }).check();
    await hoursTrigger.click();
    await page.getByRole('radio', { name: 'Monday–Friday' }).check();
    await page.getByRole('combobox', { name: 'Opens' }).selectOption('09:00');
    await page.getByRole('combobox', { name: 'Closes' }).selectOption('');
    await page.getByRole('button', { name: 'Apply to selected days' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Choose both an opening and closing time.',
    );
    await expect(hoursTrigger).toContainText('Add your business hours');
    await expect(hoursTrigger).not.toContainText('Complete');
    await expect(locationPreview.locator('[aria-label="Weekly hours"]')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Closes' }).selectOption('17:00');
    await page.getByRole('button', { name: 'Apply to selected days' }).click();
    await expect(hoursTrigger).toContainText('Mon–Fri · 9:00 AM–5:00 PM');
    await expect(hoursTrigger).toContainText('Complete');
    const compactWeeklyHours = locationPreview.locator('[aria-label="Weekly hours"]');
    await expect(compactWeeklyHours).toContainText('Monday');
    await expect(compactWeeklyHours).toContainText('Sunday');
    await expect(locationPreview).toContainText('Opens Monday at 9:00 AM');
    await captureEvidence(page, '07-configured-hours-preview');
    await captureEvidence(page, '09-open-state');

    const showHours = page.getByRole('switch', { name: 'Show hours on my website' });
    await showHours.uncheck();
    await expect(locationPreview.locator('[aria-label="Weekly hours"]')).toHaveCount(0);
    await expect(locationPreview).not.toContainText(/Open until|Closed/u);
    await expect(hoursTrigger).toContainText('Not shown on your website');
    await captureEvidence(page, '08-hidden-hours-preview');
    await showHours.check();

    await page.getByRole('button', { name: 'Save and continue' }).click();
    await completeBooking(page);
    await chooseStarter(page, 'one_page');
    const startingPreview = page.getByLabel('Mia’s Nail Studio starting website preview');
    await expect(startingPreview.getByRole('group', { name: 'Weekly hours' })).toContainText('Monday');
    await expect(startingPreview).not.toContainText('123 Private Studio Lane');
    await expect(startingPreview.getByRole('button', { name: 'Directions' })).toHaveCount(0);

    await page.getByRole('button', { exact: true, name: 'Back' }).click();
    await applyFixture(page, 'Preview time · Closed', 'Review your site');
    const finalPreview = page.getByLabel('Final phone customer preview');
    await expect(finalPreview.locator('[data-hours-status="closed"]'))
      .toContainText('Opens tomorrow at 10:00 AM');
    await expect(finalPreview.getByRole('group', { name: 'Weekly hours' })).toContainText('Sunday');
    await captureEvidence(page, '10-closed-state');
  });

  test('Journey G uses distinct business/location/contact/deposit concepts and carries Mia identity through Continue free', async ({ page }) => {
    const longBusinessName = 'Mia’s Nail Studio & Natural Nail Care Collective';
    await reachStarter(page, {
      businessName: longBusinessName,
      ownerName: 'Mia Torres',
      structure: 'Solo nail tech',
    }, {
      bookingOnly: false,
      callEnabled: true,
      city: 'Hamilton, Ontario',
      differentTextNumber: '905-555-0179',
      exactAddress: '88 James Street North',
      instagram: '@mias_hamilton_nails',
      locationType: 'Salon suite',
      phone: '905-555-0168',
      textEnabled: true,
    }, {
      deposit: 'Same deposit for every service',
      newClients: 'Ask me first',
      visitMode: 'Appointment only',
    });
    await chooseStarter(page, 'quick_book');
    await expect(page.getByLabel(`${longBusinessName} starting website preview`)).toContainText(longBusinessName);
    await captureEvidence(page, '19-mia-business-identity-preview');
    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    await page.getByRole('switch', { name: 'Include an About section' }).uncheck();
    await page.getByRole('button', { name: 'Continue without About' }).click();
    await expectScreenAtTop(page, 'Set clear expectations');

    await page.getByRole('button', { name: /^Deposits/u }).click();
    await expect(page.getByText('From your Booking settings')).toBeVisible();
    await expect(page.locator('#onboarding-policy-deposits-panel')
      .getByText('$20 deposit', { exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: 'How do you handle booking deposits?' })).toHaveCount(0);
    await captureEvidence(page, '17-shared-deposit-state');
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expectScreenAtTop(page, 'Choose your website style');
    await page.getByRole('button', { name: 'Use Modern' }).click();
    await expectScreenAtTop(page, 'Add something extra');
    await page.getByRole('button', { name: 'Continue to review' }).click();
    await expectScreenAtTop(page, 'Review your site');

    for (const device of ['Phone', 'Tablet', 'Desktop'] as const) {
      await page.getByRole('group', { name: 'Customer preview device size' })
        .getByRole('button', { name: device })
        .click();
      const preview = page.getByLabel(`Final ${device.toLowerCase()} customer preview`);
      await expect(preview).toContainText(longBusinessName);
      await expect(preview).not.toContainText('Isla Nail Studio');
      await expect(preview).toContainText('Hamilton, Ontario');
      const evidenceNumber = device === 'Phone' ? '30' : device === 'Tablet' ? '31' : '32';
      await captureEvidence(page, `${evidenceNumber}-final-${device.toLowerCase()}-preview`);
    }

    const state = await readOnboardingState(page);
    expect(state.profile.businessStructure).toBe('solo');
    expect(state.profile.location.locationType).toBe('salon_suite');
    expect(state.profile.clientContact).toMatchObject({
      callEnabled: true,
      primaryNumber: '905-555-0168',
      textEnabled: true,
      useDifferentTextNumber: true,
    });
    expect(state.profile.clientContact.differentTextNumber).toBe('905-555-0179');
    expect(state.profile.policies.deposits.mode).toBe('fixed');

    await page.getByRole('button', { name: 'Finish setup' }).click();
    const offer = page.getByRole('dialog', { name: 'Your site is saved' });
    const continueFree = offer.getByRole('button', { name: 'Continue free' });
    await expect(continueFree).toBeVisible();
    await captureEvidence(page, '33-continue-free');
    await continueFree.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Welcome to your Luster workspace' }))
      .toHaveCount(0);
    const dashboard = page.getByRole('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Your Luster site is ready' }))
      .toBeFocused();
    await expect(dashboard).toContainText('Mia Torres');
    await expect(dashboard).toContainText(longBusinessName);
    await expect(dashboard).not.toContainText('Isla Nail Studio');
    await captureEvidence(page, '20-mia-builder-handoff');
    await expect((await readBuilderDocument(page)).siteName).toBe(longBusinessName);
    expect((await readOnboardingState(page)).progress.sessionStatus).toBe('dashboard');
  });

  test('Journey J makes browser Back and Forward direction-aware across About Off and Preview history', async ({ page }) => {
    await reachStarter(page);
    await chooseStarter(page, 'one_page');
    await page.getByRole('button', { name: 'Preview my site' }).click();
    await expect(page.getByRole('dialog', { name: 'Preview your starting site' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog', { name: 'Preview your starting site' })).toBeHidden();
    await expect(screenHeading(page, 'Your starting site is ready')).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('dialog', { name: 'Preview your starting site' })).toBeVisible();
    await page.goBack();

    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    await expectScreenAtTop(page, 'Would you like an About section?');
    await page.getByRole('switch', { name: 'Include an About section' }).uncheck();
    await page.getByRole('button', { name: 'Continue without About' }).click();
    await expectScreenAtTop(page, 'Set clear expectations');

    await page.getByLabel('More onboarding options').click();
    await expect(page.getByRole('menuitem', { name: 'Save and finish later' })).toBeVisible();
    await page.goBack();
    await expectScreenAtTop(page, 'Would you like an About section?');
    await captureEvidence(page, '13-browser-back-conditional');
    await expect(page.getByRole('menuitem', { name: 'Save and finish later' })).toBeHidden();
    await expect(page.getByLabel('Short bio')).toBeDisabled();
    await page.goForward();
    await expectScreenAtTop(page, 'Set clear expectations');
    await captureEvidence(page, '14-browser-forward-conditional');
    await page.goBack();
    await expectScreenAtTop(page, 'Would you like an About section?');
    await page.goForward();
    await expectScreenAtTop(page, 'Set clear expectations');

    await page.goBack();
    await page.getByRole('switch', { name: 'Include an About section' }).check();
    await page.getByRole('button', { name: 'Choose an About design' }).click();
    await expectScreenAtTop(page, 'Choose your About design');
    await page.getByRole('button', { name: 'Use this design' }).click();
    await expectScreenAtTop(page, 'Set clear expectations');
    await page.goBack();
    await expectScreenAtTop(page, 'Choose your About design');
    await page.goBack();
    await expectScreenAtTop(page, 'Would you like an About section?');
    await page.goForward();
    await expectScreenAtTop(page, 'Choose your About design');
    await page.goForward();
    await expectScreenAtTop(page, 'Set clear expectations');
  });

  test('OB-07 rejects corrupt profile and Gallery bytes without discarding the prior valid image', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await completeBusiness(page);

    const profileInput = page.getByLabel('Profile photo', { exact: true });
    await profileInput.setInputFiles(DANIELA_PORTRAIT_PATH);
    const preview = page.getByLabel('Profile preview');
    await expect(preview.getByRole('img')).toBeVisible();
    await profileInput.setInputFiles({
      buffer: Buffer.from('not a decodable png'),
      mimeType: 'image/png',
      name: 'corrupt-profile.png',
    });
    await expect(page.getByRole('alert')).toContainText(
      'This photo couldn’t be read. Try selecting it again or choose another copy.',
    );
    await expect(preview.getByRole('img')).toBeVisible();
    await expect(page.getByText('daniela-placeholder.jpg')).toBeVisible();
    await captureEvidence(page, '18-corrupt-image-error');

    await applyFixture(page, 'Canva intent', 'Add something extra');
    await page.getByRole('button', { name: 'Add Gallery' }).click();
    const gallery = page.getByRole('dialog', { name: 'Add Gallery' });
    const validJpeg = await readFile(DANIELA_PORTRAIT_PATH);
    await gallery.locator('input[type="file"]').setInputFiles([
      {
        buffer: validJpeg,
        mimeType: 'image/jpeg',
        name: 'daniela-placeholder.jpg',
      },
      {
        buffer: Buffer.from('broken'),
        mimeType: 'image/png',
        name: 'corrupt-gallery.png',
      },
    ]);
    await expect(gallery.getByRole('alert')).toContainText('1 image was added and 1 was skipped.');
    await expect(gallery.getByRole('img')).toHaveCount(1);
  });

  test('@webkit-smoke Canva upload shows decoded thumbnails before and after shared IndexedDB storage', async ({ page }) => {
    await applyFixtureFromFresh(page, 'Canva intent', 'Add something extra');
    await addCanva(page);
    await waitForAutosave(page);

    const saved = await readOnboardingState(page);
    expect(saved.recipe.canvaEnabled).toBe(true);
    expect(saved.canva.status).toBe('ready');
    expect(saved.canva.images).toHaveLength(1);
    expect(saved.canva.images[0]?.storageId).toBeTruthy();
    const counts = await readCustomDesignAssetRecordCounts(page);
    expect(Object.values(counts).some((count) => count > 0)).toBe(true);

    await page.getByRole('button', { name: 'Edit design' }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload a Canva design' });
    const savedPages = dialog.locator('[data-image-item-id]');
    await expect(savedPages.locator('img')).toBeVisible();
    await expect(savedPages).toContainText('daniela-placeholder.jpg');
    await expect(savedPages).toContainText('Saved');
    await captureEvidence(page, '29-canva-thumbnails-after-rebase');
  });

  test('Reset clears only onboarding-owned state and restores a clean Welcome', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.evaluate(() => window.localStorage.setItem('luster:unrelated-sentinel', 'preserve-me'));
    await page.getByRole('button', { name: 'Build my website' }).click();
    await completeBusiness(page);
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expectScreenAtTop(page, 'Where can clients find you?');
    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Start over' }).click();
    const reset = page.getByRole('dialog', { name: 'Start over?' });
    await reset.getByRole('button', { exact: true, name: 'Start over' }).click();
    await expect(screenHeading(page, 'Let’s build your website')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('luster:unrelated-sentinel'))).toBe('preserve-me');
    expect(await page.evaluate((key) => window.localStorage.getItem(key), ONBOARDING_STORAGE_KEY)).toBeNull();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), LAB_STORAGE_KEY)).toBeNull();
    await page.reload();
    await expect(screenHeading(page, 'Let’s build your website')).toBeVisible();
    await captureEvidence(page, '34-clean-welcome-restoration');
  });
});
