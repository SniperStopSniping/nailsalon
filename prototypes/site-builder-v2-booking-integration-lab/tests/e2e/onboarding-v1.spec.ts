import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

const ONBOARDING_STORAGE_KEY = 'luster:onboarding-v1-lab';
const DANIELA_PORTRAIT_PATH = fileURLToPath(new URL(
  '../../src/onboarding/fixtures/assets/daniela-placeholder.jpg',
  import.meta.url,
));

type StoredOnboardingState = {
  canva: {
    customDesignSectionId: string | null;
    displayMode: 'contained' | 'full_width' | 'poster';
    images: Array<{ fileName: string }>;
    placement: 'after_booking' | 'before_booking';
    status: 'empty' | 'invalid' | 'ready';
  };
  gallery: {
    images: Array<{ fileName: string }>;
    layout: 'carousel' | 'editorial' | 'grid';
    source: 'mock_luster' | 'uploads' | null;
  };
  planOffer: { planIntent: 'founding' | 'free' | 'monthly' | null };
  profile: {
    about: { shortBio: string };
    bookingOnlyContact: boolean;
    businessName: string;
    clientContact: { primaryNumber: string };
    instagram: string;
    preferredContact: 'call' | 'email' | 'instagram' | 'text' | null;
  };
  progress: {
    currentScreen: string;
    sessionStatus: 'active' | 'builder' | 'dashboard' | 'paused';
  };
  recipe: {
    aboutEnabled: boolean;
    aboutPreset: string;
    canvaEnabled: boolean;
    galleryEnabled: boolean;
    policiesEnabled: boolean;
    starter: string | null;
    starterDocumentSiteId: string | null;
    styleConfirmed: boolean;
    stylePreset: string;
    wantsCanvaFromWelcome: boolean;
  };
};

const heading = (page: Page, name: string) => page.getByRole('heading', { name, level: 1 });

async function openFreshOnboarding(page: Page): Promise<void> {
  await page.goto('/');

  await expect(heading(page, 'Choose your starting point')).toBeVisible();
  await expect(page.getByText('Your progress saves automatically on this device.')).toBeVisible();
  // The starting point is the entry screen and renders outside the setup shell.
  await expect(page.getByLabel('Autosave status')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Onboarding progress' })).toHaveCount(0);
  await expect(page.getByLabel('More onboarding options')).toHaveCount(0);
}

async function chooseStarter(page: Page, action: string): Promise<void> {
  await page.getByRole('button', { name: action }).click();

  await expect(heading(page, 'Make it yours')).toBeVisible();
}

async function waitForOnboardingSave(page: Page): Promise<void> {
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');
}

/**
 * Lab options live in the shell, which the starting point screen deliberately
 * does not render, so fixtures are always applied from inside setup.
 */
async function enterSetupFromStarter(page: Page): Promise<void> {
  await openFreshOnboarding(page);
  await chooseStarter(page, 'Start with One-page');
  await waitForOnboardingSave(page);
}

async function readOnboardingState(page: Page): Promise<StoredOnboardingState> {
  return page.evaluate((key) => {
    const saved = window.localStorage.getItem(key);
    if (!saved) {
      throw new Error('The browser-local onboarding draft was not saved.');
    }
    return JSON.parse(saved) as StoredOnboardingState;
  }, ONBOARDING_STORAGE_KEY);
}

async function openLabReviewOptions(page: Page): Promise<void> {
  if (!new URL(page.url()).searchParams.has('audit')) {
    await page.goto('/?audit=1');
  }
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();

  await expect(page.getByRole('dialog', { name: 'Lab review options' })).toBeVisible();
}

async function applyFixture(page: Page, fixtureLabel: string): Promise<void> {
  await openLabReviewOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Lab review options' });
  await dialog.getByRole('button', { name: fixtureLabel, exact: true }).click();

  await expect(dialog).toBeHidden();

  await waitForOnboardingSave(page);
}

async function fillBusinessBasics(page: Page): Promise<void> {
  await page.getByLabel('Salon or studio name').fill('Isla Nail Studio');
  await page.getByLabel('Your name').fill('Daniela');
  await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
    .getByRole('radio', { name: 'Solo nail tech' })
    .check();
}

async function continueFromBusinessScreen(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(heading(page, 'Your starting site is ready')).toBeVisible();
}

async function completeBusinessScreen(page: Page): Promise<void> {
  await fillBusinessBasics(page);
  await continueFromBusinessScreen(page);
}

async function openBrandingCard(page: Page): Promise<void> {
  const branding = page.getByRole('button', { name: /Branding/ });
  const expanded = await branding.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await branding.click();
  }

  await expect(branding).toHaveAttribute('aria-expanded', 'true');
}

async function addDanielaPortraitAndSocial(page: Page): Promise<void> {
  await openBrandingCard(page);
  await page.getByLabel('Profile photo', { exact: true }).setInputFiles(DANIELA_PORTRAIT_PATH);

  await expect(page.getByRole('group', { name: 'Your site so far' }).getByRole('img')).toBeVisible();

  await page.getByLabel('Instagram handle').fill('@islanail.studio');
}

async function completeBookingPreferences(page: Page): Promise<void> {
  await page.getByRole('group', { name: 'How do you accept clients?' })
    .getByRole('radio', { name: 'Appointment only' })
    .check();
  await page.getByRole('group', { name: 'Are you accepting new clients?' })
    .getByRole('radio', { name: 'Yes' })
    .check();
  await page.getByRole('combobox', {
    name: 'How much notice do you need before an appointment?',
  }).selectOption('preset:1440');
  await page.getByRole('group', { name: 'How do you handle booking deposits?' })
    .getByRole('radio', { name: 'Same deposit for every service' })
    .check();
  await page.getByRole('group', { name: 'Deposit amount' })
    .getByRole('radio', { name: '$50', exact: true })
    .check();
  await page.getByRole('button', { name: 'Save booking setup' }).click();

  await expect(heading(page, 'Would you like an About section?')).toBeVisible();
}

async function addCanvaThroughCustomDesign(
  page: Page,
  options: {
    display: 'Contained' | 'Full width' | 'Poster';
    placement: 'After Booking' | 'Before Booking';
  },
): Promise<void> {
  await page.getByRole('button', { name: 'Upload Canva design' }).click();
  const canvaDialog = page.getByRole('dialog', { name: 'Upload a Canva design' });

  await expect(canvaDialog).toBeVisible();

  await canvaDialog.locator('input[type="file"]').setInputFiles(DANIELA_PORTRAIT_PATH);

  await expect(canvaDialog.getByText('daniela-placeholder.jpg')).toBeVisible();

  await canvaDialog.getByRole('radio', { name: options.display }).check();
  await canvaDialog.getByRole('radio', { name: options.placement }).check();
  await canvaDialog.getByRole('button', { name: 'Add Canva design' }).click();

  await expect(canvaDialog).toBeHidden();
  await expect(page.getByText(/Added: .*Canva/)).toBeVisible();
}

test.describe('Onboarding V1 UX Lab', () => {
  test('real form fast path reaches the personalized starting preview without exposing final setup or plans', async ({ page }) => {
    await openFreshOnboarding(page);

    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
    await expect(page.getByLabel('Luster', { exact: true })).toBeVisible();
    await expect(page.getByText('Your website starts here')).toBeVisible();
    await expect(page.getByText('Start simple or with a full website. You can add or change pages and sections anytime.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start with Quick Book' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start with One-page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start with Multi-page' })).toBeVisible();
    await expect(page.getByText('Nothing is permanent.')).toBeVisible();
    await expect(page.getByText('You’ll preview your site before choosing a plan.')).toBeVisible();
    await expect(page.getByText('Required step', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);

    await chooseStarter(page, 'Start with One-page');

    await expect(page.getByText('One-page website · Change it anytime')).toBeVisible();
    // Branding stays optional: the fast path continues without opening it.
    await expect(page.getByRole('button', { name: /Branding/ }))
      .toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Photo, logo and Instagram · Optional')).toBeVisible();

    await completeBusinessScreen(page);

    await expect(page.getByLabel('Isla Nail Studio starting website preview')).toBeVisible();

    await waitForOnboardingSave(page);

    const saved = await readOnboardingState(page);

    expect(saved.profile.businessName).toBe('Isla Nail Studio');
    expect(saved.recipe.starter).toBe('one_page');
    expect(saved.recipe.starterDocumentSiteId).toBeTruthy();

    await expect(page.getByRole('button', { name: 'Finish setup' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue free' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Preview my site' }).click();

    const preview = page.getByRole('dialog', { name: 'Preview your starting site' });

    await expect(preview).toBeVisible();
    await expect(preview.getByText('This is the customer experience. Builder controls and plan choices are not available here.')).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Finish setup' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
    await expect(preview.getByRole('button', { name: 'Continue setup' })).toBeVisible();

    await preview.getByRole('button', { name: 'Continue setup' }).click();

    await expect(heading(page, 'Where can clients find you?')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);

    await page.getByLabel('City or general service area').fill('Scarborough, Ontario');
    await page.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Home studio' })
      .check();
    await page.getByRole('button', { name: /^Contact/ }).click();
    await page.getByRole('switch', { name: 'Clients should use online booking only' }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(heading(page, 'How do clients book with you?')).toBeVisible();

    await page.getByRole('group', { name: 'How do you accept clients?' })
      .getByRole('radio', { name: 'Appointment only' })
      .check();
    await page.getByRole('group', { name: 'Are you accepting new clients?' })
      .getByRole('radio', { name: 'Yes' })
      .check();
    await page.getByRole('button', { name: 'Save booking setup' }).click();

    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
  });

  test('Journey B follows the Canva-intent Quick Book path and saves founding interest before the dashboard handoff', async ({ page }) => {
    await openFreshOnboarding(page);
    const canvaIntent = page.getByRole('button', { name: 'I want to use a Canva design' });

    await expect(canvaIntent).toHaveAttribute('aria-pressed', 'false');

    await canvaIntent.click();

    await expect(canvaIntent).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Noted — we’ll bring your Canva design in at the Extras step.'))
      .toBeVisible();

    await chooseStarter(page, 'Start with Quick Book');

    await expect(page.getByText('Quick Book · Change it anytime')).toBeVisible();

    await fillBusinessBasics(page);
    await addDanielaPortraitAndSocial(page);
    await continueFromBusinessScreen(page);

    await expect(page.getByLabel('Isla Nail Studio starting website preview')).toBeVisible();

    await page.getByRole('button', { name: 'Preview my site' }).click();
    const startingPreview = page.getByRole('dialog', { name: 'Preview your starting site' });

    await expect(startingPreview).toBeVisible();
    await expect(startingPreview.getByRole('button', { name: 'Finish setup' })).toHaveCount(0);

    await startingPreview.getByRole('button', { name: 'Continue setup' }).click();

    await expect(heading(page, 'Where can clients find you?')).toBeVisible();

    await page.getByLabel('City or general service area').fill('Scarborough, Ontario');
    await page.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Home studio' })
      .check();
    await page.getByRole('button', { name: /^Contact/ }).click();
    await page.getByRole('switch', { name: 'Clients should use online booking only' }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(heading(page, 'How do clients book with you?')).toBeVisible();

    await completeBookingPreferences(page);

    await page.getByRole('switch', { name: 'Include an About section' }).uncheck();

    await expect(page.getByLabel('Short bio')).toBeDisabled();

    await page.getByRole('button', { name: 'Continue without About' }).click();

    await expect(heading(page, 'Set clear expectations')).toBeVisible();

    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(heading(page, 'Choose your website style')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Modern/ })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Use Modern' }).click();

    await expect(heading(page, 'Add something extra')).toBeVisible();
    await expect(page.getByText('Recommended for you')).toBeVisible();

    await addCanvaThroughCustomDesign(page, {
      display: 'Poster',
      placement: 'After Booking',
    });

    await page.getByRole('button', { name: 'Continue to review' }).click();

    await expect(heading(page, 'Review your site')).toBeVisible();

    const finalPhonePreview = page.getByLabel('Final phone customer preview');

    await expect(finalPhonePreview).toBeVisible();
    await expect(finalPhonePreview.locator('[data-section-type="custom_design"]')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);

    await waitForOnboardingSave(page);
    let saved = await readOnboardingState(page);

    expect(saved.profile.bookingOnlyContact).toBe(true);
    expect(saved.profile.instagram).toBe('islanail.studio');
    expect(saved.recipe.aboutEnabled).toBe(false);
    expect(saved.recipe.policiesEnabled).toBe(false);
    expect(saved.recipe.starter).toBe('quick_book');
    expect(saved.recipe.styleConfirmed).toBe(true);
    expect(saved.recipe.stylePreset).toBe('modern');
    expect(saved.recipe.wantsCanvaFromWelcome).toBe(true);
    expect(saved.recipe.canvaEnabled).toBe(true);
    expect(saved.canva.customDesignSectionId).toBeTruthy();
    expect(saved.canva.displayMode).toBe('poster');
    expect(saved.canva.placement).toBe('after_booking');
    expect(saved.canva.status).toBe('ready');
    expect(saved.canva.images).toHaveLength(1);

    await page.getByRole('button', { name: 'Finish setup' }).click();
    const planSheet = page.getByRole('dialog', { name: 'Your site is saved' });

    await expect(planSheet).toBeVisible();

    const founding = planSheet.getByRole('radio', { name: /^Founding offer/ });
    await founding.press('Space');

    await expect(founding).toBeChecked();

    await planSheet.getByRole('button', { name: 'Reserve founding offer' }).click();

    await expect(heading(page, 'Your Luster site is ready')).toBeVisible();
    await expect(page.getByText('Founding offer reserved — we’ll let you know when details are ready'))
      .toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard destinations' })).toBeVisible();

    saved = await readOnboardingState(page);

    expect(saved.planOffer.planIntent).toBe('founding');
    expect(saved.progress.sessionStatus).toBe('dashboard');
  });

  test('Journey C completes Daniela setup with About, policies, Gallery, Canva, device review, and monthly intent', async ({ page }) => {
    await openFreshOnboarding(page);
    await chooseStarter(page, 'Start with One-page');
    await fillBusinessBasics(page);
    await addDanielaPortraitAndSocial(page);
    await continueFromBusinessScreen(page);

    await page.getByRole('button', { name: 'Continue setting up my site' }).click();

    await expect(heading(page, 'Where can clients find you?')).toBeVisible();

    await page.getByLabel('City or general service area').fill('Scarborough, Ontario');
    await page.getByLabel('Exact address (optional)').fill('123 Studio Lane');
    await page.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Salon suite' })
      .check();
    await page.getByRole('group', { name: 'Who can see your address?' })
      .getByRole('radio', { name: 'Show after booking' })
      .check();
    await page.getByText('Arrival details · Optional', { exact: true }).click();
    await page.getByLabel('Parking').fill('Free visitor parking behind the building');
    await page.getByLabel('Entrance instructions').fill('Use the east entrance and ring suite 204.');
    await page.getByLabel('Transit information').fill('Five minutes from the Scarborough Centre bus stop.');

    await page.getByRole('button', { name: /^Contact/ }).click();
    await page.getByRole('switch', { name: 'Clients should use online booking only' }).uncheck();
    await page.getByLabel('Phone number clients can use').fill('416-555-0134');
    await page.getByRole('switch', { name: 'Call this number' }).check();
    await page.getByLabel('Email (optional)').fill('hello@islanail.example');
    await page.getByRole('group', { name: 'Which contact option should we show first?' })
      .getByRole('radio', { name: 'Instagram' })
      .check();

    await page.getByRole('button', { name: /^Hours/ }).click();
    await page.getByRole('radio', { name: 'Monday–Friday' }).check();
    await page.getByRole('combobox', { name: 'Opens' }).selectOption('10:00');
    await page.getByRole('combobox', { name: 'Closes' }).selectOption('18:00');
    await page.getByRole('button', { name: 'Apply to selected days' }).click();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(heading(page, 'How do clients book with you?')).toBeVisible();

    await completeBookingPreferences(page);

    await expect(page.getByRole('switch', { name: 'Include an About section' })).toBeChecked();

    await page.getByLabel('Short bio').fill('I create detailed, long-lasting nail appointments in a calm private studio.');
    await page.getByText('More about you', { exact: true }).click();
    await page.getByLabel('Full bio').fill('Daniela specializes in structured manicures and thoughtful appointments designed around natural nail health.');
    for (const specialty of ['Russian Manicure', 'BIAB', 'Gel-X', 'Hard Gel']) {
      await page.getByRole('checkbox', { name: specialty }).check();
    }
    await page.getByLabel('Years of experience — optional').fill('8');
    await page.getByLabel('Certifications — optional').fill('Advanced Russian Manicure, Structured Gel');
    await page.getByLabel('Languages — optional').fill('English, Spanish');
    await page.getByLabel('What do clients appreciate about appointments with you? — optional')
      .fill('A calm pace, careful prep, and honest recommendations.');
    await page.getByRole('button', { name: 'Choose an About design' }).click();

    await expect(heading(page, 'Choose your About design')).toBeVisible();

    await page.getByRole('button', { name: /^About \+ Before You Book/ }).click();

    await expect(page.getByRole('button', { name: /^About \+ Before You Book/ })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Use this design' }).click();

    await expect(heading(page, 'Set clear expectations')).toBeVisible();

    await expect(page.getByRole('switch', { name: 'Show policies on my website' })).toBeChecked();

    await page.getByLabel('How much notice do clients need to cancel?').selectOption('24_hours');
    await page.getByLabel('What happens to the deposit if they cancel late?')
      .selectOption('deposit_lost');
    await page.getByLabel('Can clients get their deposit back?').selectOption('no');
    await page.getByLabel('Can clients move it to another appointment?').selectOption('yes');
    await page.getByRole('button', { name: /^Late arrivals/ }).click();
    await page.getByLabel('How late can a client be?').selectOption('15');
    await page.getByLabel('Shorten the service when needed?').selectOption('yes');
    await page.getByLabel('Reschedule if they arrive after the limit?').selectOption('yes');
    await page.getByRole('button', { name: /^No-shows/ }).click();
    await page.getByLabel('What happens if a client misses their appointment?')
      .selectOption('deposit_lost');
    await page.getByRole('button', { name: /^Repairs/ }).click();
    await page.getByLabel('Free repair window').selectOption('5');
    await page.getByLabel('Repair conditions — optional')
      .fill('Repairs cover product issues, not accidental damage.');
    const policyCopyCards = page.locator('.onboarding-policy-copy-card');
    await policyCopyCards.filter({ hasText: 'Deposits & cancellations' }).locator('summary').click();

    await expect(page.getByText(/Please provide at least 24 hours’ notice when cancelling or rescheduling/).first()).toBeVisible();
    await expect(page.getByText(/A \$50 deposit is required to book/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Save policies' }).click();

    await expect(heading(page, 'Choose your website style')).toBeVisible();

    await page.getByRole('button', { name: /^Luxury/ }).click();

    await expect(page.getByLabel('Live personalized style preview').locator('[data-style-preset]'))
      .toHaveAttribute('data-style-preset', 'luxury');

    await page.getByRole('button', { name: 'Use Luxury' }).click();

    await expect(heading(page, 'Add something extra')).toBeVisible();

    await page.getByRole('button', { name: 'Add Gallery' }).click();
    const galleryDialog = page.getByRole('dialog', { name: 'Add Gallery' });

    await expect(galleryDialog).toBeVisible();

    await galleryDialog.getByRole('button', { name: /Use example nail photos/ }).click();
    await galleryDialog.getByRole('radio', { name: 'editorial' }).check();
    await galleryDialog.getByRole('button', { exact: true, name: 'Add Gallery' }).click();

    await expect(galleryDialog).toBeHidden();
    await expect(page.getByText('Added: Gallery')).toBeVisible();

    await addCanvaThroughCustomDesign(page, {
      display: 'Full width',
      placement: 'Before Booking',
    });

    await expect(page.getByText('Added: Gallery and Canva')).toBeVisible();

    await page.getByRole('button', { name: 'Continue to review' }).click();

    await expect(heading(page, 'Review your site')).toBeVisible();

    const deviceGroup = page.getByRole('group', { name: 'Customer preview device size' });
    const phoneButton = deviceGroup.getByRole('button', { exact: true, name: 'Phone' });
    const tabletButton = deviceGroup.getByRole('button', { exact: true, name: 'Tablet' });
    const desktopButton = deviceGroup.getByRole('button', { exact: true, name: 'Desktop' });

    await expect(phoneButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Final phone customer preview').getByLabel('Gallery')).toBeVisible();

    await tabletButton.click();

    await expect(tabletButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Final tablet customer preview')).toBeVisible();

    await desktopButton.click();

    await expect(desktopButton).toHaveAttribute('aria-pressed', 'true');

    const finalDesktopPreview = page.getByLabel('Final desktop customer preview');

    await expect(finalDesktopPreview).toBeVisible();
    await expect(finalDesktopPreview.locator('[data-section-type="custom_design"]')).toHaveCount(1);

    await waitForOnboardingSave(page);
    let saved = await readOnboardingState(page);

    expect(saved.recipe.starter).toBe('one_page');
    expect(saved.profile.clientContact.primaryNumber).toBe('416-555-0134');
    expect(saved.profile.instagram).toBe('islanail.studio');
    expect(saved.profile.preferredContact).toBe('instagram');
    expect(saved.recipe.aboutEnabled).toBe(true);
    expect(saved.recipe.aboutPreset).toBe('about_before_you_book');
    expect(saved.recipe.policiesEnabled).toBe(true);
    expect(saved.recipe.stylePreset).toBe('luxury');
    expect(saved.recipe.styleConfirmed).toBe(true);
    expect(saved.recipe.galleryEnabled).toBe(true);
    expect(saved.gallery.source).toBe('mock_luster');
    expect(saved.gallery.layout).toBe('editorial');
    expect(saved.gallery.images).toHaveLength(4);
    expect(saved.recipe.canvaEnabled).toBe(true);
    expect(saved.canva.customDesignSectionId).toBeTruthy();
    expect(saved.canva.displayMode).toBe('full_width');
    expect(saved.canva.placement).toBe('before_booking');
    expect(saved.canva.status).toBe('ready');

    await page.getByRole('button', { name: 'Finish setup' }).click();
    const planSheet = page.getByRole('dialog', { name: 'Your site is saved' });

    await expect(planSheet).toBeVisible();

    const monthly = planSheet.getByRole('radio', { name: /^Monthly/ });
    await monthly.press('Space');

    await expect(monthly).toBeChecked();

    await planSheet.getByRole('button', { name: 'I’m interested in monthly' }).click();

    await expect(heading(page, 'Your Luster site is ready')).toBeVisible();
    await expect(page.getByText('Monthly interest saved — we’ll let you know when details are ready'))
      .toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard destinations' })).toBeVisible();

    saved = await readOnboardingState(page);

    expect(saved.planOffer.planIntent).toBe('monthly');
    expect(saved.progress.sessionStatus).toBe('dashboard');
  });

  test('About Off skips its design screen and conditional Back preserves entered content through reload', async ({ page }) => {
    await enterSetupFromStarter(page);
    await applyFixture(page, 'About Off');

    await expect(heading(page, 'Set clear expectations')).toBeVisible();

    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await expect(heading(page, 'Would you like an About section?')).toBeVisible();

    const aboutSwitch = page.getByRole('switch', { name: 'Include an About section' });
    const shortBio = page.getByLabel('Short bio');

    await expect(aboutSwitch).not.toBeChecked();
    await expect(shortBio).toBeDisabled();
    await expect(shortBio).toHaveValue('I create thoughtful, detailed nail appointments in a calm private studio.');

    await waitForOnboardingSave(page);
    await page.reload();

    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Include an About section' })).not.toBeChecked();
    await expect(page.getByLabel('Short bio')).toHaveValue('I create thoughtful, detailed nail appointments in a calm private studio.');

    await page.getByRole('switch', { name: 'Include an About section' }).check();

    await expect(page.getByLabel('Short bio')).toBeEnabled();

    await page.getByRole('button', { name: 'Choose an About design' }).click();

    await expect(heading(page, 'Choose your About design')).toBeVisible();

    await page.getByRole('button', { name: 'Back to edit About' }).click();

    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await expect(page.getByLabel('Short bio')).toHaveValue('I create thoughtful, detailed nail appointments in a calm private studio.');

    await page.getByRole('switch', { name: 'Include an About section' }).uncheck();
    await page.getByRole('button', { name: 'Continue without About' }).click();

    await expect(heading(page, 'Set clear expectations')).toBeVisible();

    await page.goBack();

    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await expect(heading(page, 'Choose your About design')).toHaveCount(0);
    await expect(page.getByLabel('Short bio')).toBeDisabled();
    await expect(page.getByLabel('Short bio')).toHaveValue('I create thoughtful, detailed nail appointments in a calm private studio.');
  });

  test('final review routes an incomplete essential back to setup instead of opening a plan or dashboard', async ({ page }) => {
    await enterSetupFromStarter(page);
    await applyFixture(page, 'One essential missing');

    await expect(heading(page, 'Review your site')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish 1 required step' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
    await expect(heading(page, 'Your Luster site is ready')).toHaveCount(0);

    await page.getByRole('button', { name: 'Finish 1 required step' }).click();

    await expect(heading(page, 'Choose your website style')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
    await expect(heading(page, 'Your Luster site is ready')).toHaveCount(0);
  });

  test('autosave survives pause and reload, resume returns to the active screen, and confirmed reset is scoped', async ({ page }) => {
    await openFreshOnboarding(page);
    await chooseStarter(page, 'Start with One-page');

    await expect(page.getByText('4 required steps left')).toBeVisible();

    await fillBusinessBasics(page);
    await openBrandingCard(page);
    await page.getByLabel('Instagram handle').fill('@islanail.studio');
    await waitForOnboardingSave(page);

    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Save and finish later' }).click();

    await expect(heading(page, 'Setup saved')).toBeVisible();

    await page.reload();

    await expect(heading(page, 'Setup saved')).toBeVisible();

    await page.getByRole('button', { name: 'Resume setup' }).click();

    await expect(heading(page, 'Make it yours')).toBeVisible();
    await expect(page.getByLabel('Salon or studio name')).toHaveValue('Isla Nail Studio');
    await expect(page.getByLabel('Your name')).toHaveValue('Daniela');

    await openBrandingCard(page);

    await expect(page.getByLabel('Instagram handle')).toHaveValue('islanail.studio');

    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await expect(heading(page, 'Choose your starting point')).toBeVisible();

    const currentStarter = page.getByRole('button', { name: 'Continue with this starting point' });

    await expect(currentStarter).toHaveAttribute('aria-pressed', 'true');
    await expect(currentStarter.getByText('Current starting point')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to Quick Book' })).toBeVisible();

    await currentStarter.click();

    await expect(heading(page, 'Make it yours')).toBeVisible();

    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Start over' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Start over?' });

    await expect(confirmation).toBeVisible();

    await confirmation.getByRole('button', { name: 'Start over', exact: true }).click();

    await expect(heading(page, 'Choose your starting point')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start with One-page' })).toBeVisible();
    await expect.poll(() => page.evaluate(key => window.localStorage.getItem(key), ONBOARDING_STORAGE_KEY)).toBeNull();

    await page.reload();

    await expect(heading(page, 'Choose your starting point')).toBeVisible();
  });

  test('Finish setup opens the configured plan choices and Continue free enters the dashboard', async ({ page }) => {
    await enterSetupFromStarter(page);
    await applyFixture(page, 'All essentials complete');

    await expect(heading(page, 'Review your site')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish setup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue free' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Finish setup' }).click();
    const planSheet = page.getByRole('dialog', { name: 'Your site is saved' });

    await expect(planSheet).toBeVisible();

    const free = planSheet.getByRole('radio', { name: /^Free/ });
    const founding = planSheet.getByRole('radio', { name: /^Founding offer/ });
    const monthly = planSheet.getByRole('radio', { name: /^Monthly/ });

    await expect(free).toBeChecked();
    await expect(founding).toBeVisible();
    await expect(monthly).toBeVisible();
    await expect(planSheet.getByRole('radio')).toHaveCount(3);

    const continueFree = planSheet.getByRole('button', { name: 'Continue free' });

    await expect(continueFree).toBeVisible();
    await expect(planSheet.getByRole('button', {
      name: /Continue free|Reserve founding offer|I’m interested in monthly/,
    })).toHaveCount(1);
    await expect(planSheet.getByRole('heading', { level: 2, name: 'Your site is saved' }))
      .toBeFocused();
    await expect(planSheet).toContainText('Final paid-plan pricing and features are still being confirmed.');
    await expect(planSheet).toContainText('There is no payment or plan access change today.');

    await continueFree.click();

    await expect(heading(page, 'Your Luster site is ready')).toBeVisible();
    await expect(page.getByText('Free selected')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Dashboard destinations' })).toBeVisible();

    const saved = await readOnboardingState(page);

    expect(saved.planOffer.planIntent).toBe('free');
    expect(saved.progress.sessionStatus).toBe('dashboard');
  });

  test('required mobile, tablet, desktop, and landscape viewports contain the final preview and sticky action', async ({ page }) => {
    await enterSetupFromStarter(page);
    await applyFixture(page, 'All essentials complete');

    await expect(heading(page, 'Review your site')).toBeVisible();

    const viewports = [
      { height: 568, width: 320 },
      { height: 600, width: 320 },
      { height: 500, width: 375 },
      { height: 600, width: 375 },
      { height: 844, width: 390 },
      { height: 932, width: 430 },
      { height: 1024, width: 768 },
      { height: 800, width: 920 },
      { height: 800, width: 1180 },
      { height: 900, width: 1440 },
      { height: 390, width: 844 },
      { height: 430, width: 932 },
    ] as const;

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const finishSetup = page.getByRole('button', { name: 'Finish setup' });
      const finalPreview = page.getByLabel('Final phone customer preview');

      await expect(finishSetup).toBeVisible();
      await expect(finalPreview).toBeVisible();
      await expect(page.getByLabel('Onboarding progress')).toBeVisible();

      const [documentOverflow, previewBox, primaryBox] = await Promise.all([
        page.evaluate(() => document.documentElement.scrollWidth
          - document.documentElement.clientWidth),
        finalPreview.boundingBox(),
        finishSetup.boundingBox(),
      ]);
      if (!previewBox || !primaryBox) {
        throw new Error('The final preview and action must be measurable.');
      }

      expect(documentOverflow, `${viewport.width}×${viewport.height} document overflow`)
        .toBeLessThanOrEqual(1);
      expect(previewBox.x + previewBox.width - viewport.width, `${viewport.width}×${viewport.height} preview overflow`)
        .toBeLessThanOrEqual(1);
      expect(primaryBox.x + primaryBox.width - viewport.width, `${viewport.width}×${viewport.height} primary overflow`)
        .toBeLessThanOrEqual(1);
      expect(primaryBox.height, `${viewport.width}×${viewport.height} primary target`)
        .toBeGreaterThanOrEqual(44);
    }

    await page.getByRole('button', { name: 'Change setup' }).click();

    await expect(heading(page, 'Make it yours')).toBeVisible();

    await page.setViewportSize({ height: 360, width: 320 });
    await page.getByLabel('Salon or studio name').focus();

    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();

    const keyboardState = await page.getByRole('button', { name: 'Continue', exact: true }).evaluate((button) => {
      const box = button.getBoundingClientRect();
      return { bottom: box.bottom, height: box.height, viewportHeight: window.innerHeight };
    });

    expect(keyboardState.height).toBeGreaterThanOrEqual(44);
    expect(keyboardState.bottom).toBeLessThanOrEqual(keyboardState.viewportHeight + 1);
  });
});
