import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

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
  planOffer: { planIntent: 'free' | 'lifetime' | 'monthly' | null };
  profile: {
    about: { shortBio: string };
    bookingOnlyContact: boolean;
    businessName: string;
  };
  progress: {
    currentScreen: string;
    sessionStatus: 'active' | 'builder' | 'paused';
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
  await expect(heading(page, 'Let’s build your website')).toBeVisible();
  await expect(page.getByText('Your progress saves automatically on this device.')).toBeVisible();
}

async function waitForOnboardingSave(page: Page): Promise<void> {
  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');
}

async function readOnboardingState(page: Page): Promise<StoredOnboardingState> {
  return page.evaluate((key) => {
    const saved = window.localStorage.getItem(key);
    if (!saved) throw new Error('The browser-local onboarding draft was not saved.');
    return JSON.parse(saved) as StoredOnboardingState;
  }, ONBOARDING_STORAGE_KEY);
}

async function openLabReviewOptions(page: Page): Promise<void> {
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('button', { name: 'Lab review options' }).click();
  await expect(page.getByRole('dialog', { name: 'Lab review options' })).toBeVisible();
}

async function applyFixture(page: Page, fixtureLabel: string): Promise<void> {
  await openLabReviewOptions(page);
  const dialog = page.getByRole('dialog', { name: 'Lab review options' });
  await dialog.getByRole('button', { name: fixtureLabel, exact: true }).click();
  await expect(dialog).toBeHidden();
  await waitForOnboardingSave(page);
}

async function completeBusinessScreen(page: Page): Promise<void> {
  await page.getByLabel('Business or salon name').fill('Isla Nail Studio');
  await page.getByLabel('Your name').fill('Daniela');
  await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
    .getByRole('radio', { name: 'Solo nail tech' })
    .check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(heading(page, 'Add your photo and social presence')).toBeVisible();
}

async function addDanielaPortraitAndSocial(page: Page): Promise<void> {
  await page.getByLabel('Profile photo (optional)').setInputFiles(DANIELA_PORTRAIT_PATH);
  await expect(page.getByLabel('Profile preview').getByRole('img')).toBeVisible();
  await page.getByLabel('Instagram handle (optional)').fill('@islanail.studio');
  await page.getByRole('group', { name: 'Preferred contact method' })
    .getByRole('radio', { name: 'Instagram' })
    .check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(heading(page, 'Where can clients find you?')).toBeVisible();
}

async function completeBookingPreferences(page: Page): Promise<void> {
  await page.getByRole('group', { name: 'How do clients visit you?' })
    .getByRole('radio', { name: 'Appointment only' })
    .check();
  await page.getByRole('group', { name: 'Accepting new clients' })
    .getByRole('radio', { name: 'Yes' })
    .check();
  await page.getByRole('group', { name: 'Preferred advance notice' })
    .getByRole('radio', { name: '24 hours' })
    .check();
  await page.getByRole('group', { name: 'Do you generally require a deposit?' })
    .getByRole('radio', { name: 'Yes' })
    .check();
  await page.getByRole('button', { name: 'Save booking information' }).click();
  await expect(heading(page, 'Choose your starting point')).toBeVisible();
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
  test('real form fast path reaches the personalized starting preview without exposing Builder or plans', async ({ page }) => {
    await openFreshOnboarding(page);
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Build my website' }).click();
    await expect(heading(page, 'Tell us about your business')).toBeVisible();
    await completeBusinessScreen(page);

    await page.getByRole('button', { name: 'Skip photo for now' }).click();
    await expect(heading(page, 'Where can clients find you?')).toBeVisible();
    await page.getByLabel('City or general service area').fill('Scarborough, Ontario');
    await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
    await page.getByRole('switch', { name: 'Clients should use Booking only' }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();

    await expect(heading(page, 'How can clients book with you?')).toBeVisible();
    await page.getByRole('group', { name: 'How do clients visit you?' })
      .getByRole('radio', { name: 'Appointment only' })
      .check();
    await page.getByRole('group', { name: 'Accepting new clients' })
      .getByRole('radio', { name: 'Yes' })
      .check();
    await page.getByRole('button', { name: 'Save booking information' }).click();

    await expect(heading(page, 'Choose your starting point')).toBeVisible();
    await page.getByRole('button', { name: /^One-page website/ }).click();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await expect(page.getByLabel('Isla Nail Studio starting website preview')).toBeVisible();
    await waitForOnboardingSave(page);

    const saved = await readOnboardingState(page);
    expect(saved.profile.businessName).toBe('Isla Nail Studio');
    expect(saved.recipe.starter).toBe('one_page');
    expect(saved.recipe.starterDocumentSiteId).toBeTruthy();

    await expect(page.getByRole('button', { name: 'Open my Builder' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue free' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview my site' }).click();

    const preview = page.getByRole('dialog', { name: 'Preview your starting site' });
    await expect(preview).toBeVisible();
    await expect(preview.getByText('This is the customer experience. Builder controls and plan choices are not available here.')).toBeVisible();
    await expect(preview.getByRole('button', { name: 'Open my Builder' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
    await expect(preview.getByRole('button', { name: 'Continue setup' })).toBeVisible();

    await preview.getByRole('button', { name: 'Continue setup' }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
  });

  test('Journey B follows the Canva-intent Quick Book path and saves a lifetime intent after the real Builder handoff', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'I already have a Canva design' }).click();
    await expect(heading(page, 'Tell us about your business')).toBeVisible();
    await completeBusinessScreen(page);
    await addDanielaPortraitAndSocial(page);

    await page.getByLabel('City or general service area').fill('Scarborough, Ontario');
    await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
    await page.getByRole('switch', { name: 'Clients should use Booking only' }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(heading(page, 'How can clients book with you?')).toBeVisible();
    await completeBookingPreferences(page);

    await page.getByRole('button', { name: /^Quick Book/ }).click();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await expect(page.getByLabel('Isla Nail Studio starting website preview')).toBeVisible();
    await page.getByRole('button', { name: 'Preview my site' }).click();
    const startingPreview = page.getByRole('dialog', { name: 'Preview your starting site' });
    await expect(startingPreview).toBeVisible();
    await expect(startingPreview.getByRole('button', { name: 'Open my Builder' })).toHaveCount(0);
    await startingPreview.getByRole('button', { name: 'Continue setup' }).click();

    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await page.getByRole('switch', { name: 'Include an About section' }).uncheck();
    await expect(page.getByLabel('Short bio')).toBeDisabled();
    await page.getByRole('button', { name: 'Continue without About' }).click();
    await expect(heading(page, 'Set clear expectations')).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(heading(page, 'Choose your look')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Modern/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Keep current style' }).click();
    await expect(heading(page, 'Add something extra')).toBeVisible();
    await expect(page.getByText('Recommended from your welcome choice')).toBeVisible();
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

    await page.getByRole('button', { name: 'Open my Builder' }).click();
    const planSheet = page.getByRole('dialog', { name: 'Your site is saved' });
    await expect(planSheet).toBeVisible();
    await planSheet.getByRole('button', { name: 'Unlock lifetime access' }).click();
    await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to onboarding review · Lab' })).toBeVisible();

    saved = await readOnboardingState(page);
    expect(saved.planOffer.planIntent).toBe('lifetime');
    expect(saved.progress.sessionStatus).toBe('builder');
  });

  test('Journey C completes Daniela setup with About, policies, Gallery, Canva, device review, and monthly intent', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await completeBusinessScreen(page);
    await addDanielaPortraitAndSocial(page);

    await page.getByLabel('City or general service area').fill('Scarborough, Ontario');
    await page.getByLabel('Exact address (optional)').fill('123 Studio Lane');
    await page.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Salon suite' })
      .check();
    await page.getByRole('group', { name: 'Address visibility' })
      .getByRole('radio', { name: 'Show after booking' })
      .check();
    await page.getByLabel('Parking (optional)').fill('Free visitor parking behind the building');
    await page.getByLabel('Entrance instructions (optional)').fill('Use the east entrance and ring suite 204.');
    await page.getByLabel('Transit information (optional)').fill('Five minutes from the Scarborough Centre bus stop.');

    await page.locator('button[aria-controls="onboarding-contact-card-panel"]').click();
    await page.getByLabel('Client contact number').fill('416-555-0134');
    await page.getByRole('switch', { name: 'Call this number' }).check();
    await page.getByLabel('Email (optional)').fill('hello@islanail.example');
    await page.getByRole('group', { name: 'Preferred public contact method' })
      .getByRole('radio', { name: 'Instagram' })
      .check();

    await page.locator('button[aria-controls="onboarding-hours-card-panel"]').click();
    await page.getByLabel('Monday opens').fill('10:00');
    await page.getByLabel('Monday closes').fill('18:00');
    await page.getByRole('button', { name: 'Copy Monday to weekdays' }).click();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(heading(page, 'How can clients book with you?')).toBeVisible();
    await completeBookingPreferences(page);

    await page.getByRole('button', { name: /^One-page website/ }).click();
    await expect(heading(page, 'Your starting site is ready')).toBeVisible();
    await page.getByRole('button', { name: 'Continue setting up my site' }).click();
    await expect(heading(page, 'Would you like an About section?')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Include an About section' })).toBeChecked();
    await page.getByLabel('Short bio').fill('I create detailed, long-lasting nail appointments in a calm private studio.');
    await page.getByLabel('Full bio — optional').fill('Daniela specializes in structured manicures and thoughtful appointments designed around natural nail health.');
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
    await page.getByLabel('Required notice').selectOption('24_hours');
    await page.getByLabel('After deadline').selectOption('deposit_lost');
    await page.getByLabel('Fixed amount or percentage?').selectOption('fixed');
    await page.getByLabel('Deposit amount').fill('50');
    await page.getByLabel('Refundable?').selectOption('no');
    await page.getByLabel('Transferable?').selectOption('yes');
    await page.getByLabel('Grace period (minutes)').fill('15');
    await page.getByLabel('Shorten service?').selectOption('yes');
    await page.getByLabel('Reschedule after limit?').selectOption('yes');
    await page.getByRole('switch', { name: 'Lose deposit' }).check();
    await page.getByLabel('Free repair window (days)').fill('5');
    await page.getByLabel('Conditions').fill('Repairs cover product issues, not accidental damage.');
    await expect(page.getByText(/Please cancel or reschedule at least 24 hours before your appointment/).first()).toBeVisible();
    await expect(page.getByText(/A \$50 deposit is required and is applied to your appointment/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Save policies' }).click();

    await expect(heading(page, 'Choose your look')).toBeVisible();
    await page.getByRole('button', { name: /^Luxury/ }).click();
    await expect(page.getByLabel('Live personalized style preview')).toHaveAttribute('data-style-preset', 'luxury');
    await page.getByRole('button', { name: 'Use this style' }).click();
    await expect(heading(page, 'Add something extra')).toBeVisible();

    await page.getByRole('button', { name: 'Add Gallery' }).click();
    const galleryDialog = page.getByRole('dialog', { name: 'Add Gallery' });
    await expect(galleryDialog).toBeVisible();
    await galleryDialog.getByRole('button', { name: /Use Luster sample portfolio/ }).click();
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

    const phoneButton = page.getByRole('button', { name: 'Phone' });
    const tabletButton = page.getByRole('button', { name: 'Tablet' });
    const desktopButton = page.getByRole('button', { name: 'Desktop' });
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

    await page.getByRole('button', { name: 'Open my Builder' }).click();
    const planSheet = page.getByRole('dialog', { name: 'Your site is saved' });
    await expect(planSheet).toBeVisible();
    await planSheet.getByRole('button', { name: 'Choose monthly' }).click();
    await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to onboarding review · Lab' })).toBeVisible();

    saved = await readOnboardingState(page);
    expect(saved.planOffer.planIntent).toBe('monthly');
    expect(saved.progress.sessionStatus).toBe('builder');
  });

  test('About Off skips its design screen and conditional Back preserves entered content through reload', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
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

  test('final review routes an incomplete essential back to setup instead of opening a plan or Builder', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await applyFixture(page, 'One essential missing');

    await expect(heading(page, 'Review your site')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish 1 essential' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
    await expect(page.getByTestId('final-hybrid-editor')).toHaveCount(0);

    await page.getByRole('button', { name: 'Finish 1 essential' }).click();
    await expect(heading(page, 'Choose your look')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);
    await expect(page.getByTestId('final-hybrid-editor')).toHaveCount(0);
  });

  test('autosave survives pause and reload, resume returns to the active screen, and confirmed reset is scoped', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await completeBusinessScreen(page);
    await page.getByLabel('Instagram handle (optional)').fill('@islanail.studio');
    await waitForOnboardingSave(page);

    await page.getByLabel('More onboarding options').click();
    await page.getByRole('button', { name: 'Save and finish later' }).click();
    await expect(heading(page, 'Setup saved')).toBeVisible();

    await page.reload();
    await expect(heading(page, 'Setup saved')).toBeVisible();
    await page.getByRole('button', { name: 'Resume setup' }).click();
    await expect(heading(page, 'Add your photo and social presence')).toBeVisible();
    await expect(page.getByLabel('Instagram handle (optional)')).toHaveValue('@islanail.studio');

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(heading(page, 'Tell us about your business')).toBeVisible();
    await expect(page.getByLabel('Business or salon name')).toHaveValue('Isla Nail Studio');
    await expect(page.getByLabel('Your name')).toHaveValue('Daniela');

    await page.getByLabel('More onboarding options').click();
    await page.getByRole('button', { name: 'Restart onboarding' }).click();
    const confirmation = page.getByRole('dialog', { name: 'Restart onboarding?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Restart onboarding', exact: true }).click();

    await expect(heading(page, 'Let’s build your website')).toBeVisible();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), ONBOARDING_STORAGE_KEY)).toBeNull();
    await page.reload();
    await expect(heading(page, 'Let’s build your website')).toBeVisible();
  });

  test('the plan sheet appears only after Open my Builder and Continue free enters the existing Builder', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
    await applyFixture(page, 'All essentials complete');

    await expect(heading(page, 'Review your site')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open my Builder' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue free' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Your site is saved' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Open my Builder' }).click();
    const planSheet = page.getByRole('dialog', { name: 'Your site is saved' });
    await expect(planSheet).toBeVisible();
    await expect(planSheet.getByRole('button', { name: 'Unlock lifetime access' })).toBeVisible();
    await expect(planSheet.getByRole('button', { name: 'Choose monthly' })).toBeVisible();
    const continueFree = planSheet.getByRole('button', { name: 'Continue free' });
    await expect(continueFree).toBeVisible();
    await expect(continueFree).toBeFocused();
    await expect(planSheet).toContainText('You won’t be charged today.');

    await continueFree.click();
    await expect(page.getByTestId('final-hybrid-editor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to onboarding review · Lab' })).toBeVisible();

    const saved = await readOnboardingState(page);
    expect(saved.planOffer.planIntent).toBe('free');
    expect(saved.progress.sessionStatus).toBe('builder');
  });

  test('required mobile, tablet, desktop, and landscape viewports contain the final preview and sticky action', async ({ page }) => {
    await openFreshOnboarding(page);
    await page.getByRole('button', { name: 'Build my website' }).click();
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
      await expect(page.getByRole('button', { name: 'Open my Builder' })).toBeVisible();
      await expect(page.getByLabel('Onboarding progress')).toBeVisible();
      const layout = await page.evaluate(() => {
        const primary = document.querySelector<HTMLElement>('.sticky-onboarding-actions__primary');
        const frame = document.querySelector<HTMLElement>('.onboarding-preview-frame');
        const primaryBox = primary?.getBoundingClientRect();
        const frameBox = frame?.getBoundingClientRect();
        return {
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          frameOverflow: frameBox ? frameBox.right - document.documentElement.clientWidth : 0,
          primaryHeight: primaryBox?.height ?? 0,
          primaryOverflow: primaryBox ? primaryBox.right - document.documentElement.clientWidth : 0,
        };
      });
      expect(layout.documentOverflow, `${viewport.width}×${viewport.height} document overflow`).toBeLessThanOrEqual(1);
      expect(layout.frameOverflow, `${viewport.width}×${viewport.height} preview overflow`).toBeLessThanOrEqual(1);
      expect(layout.primaryOverflow, `${viewport.width}×${viewport.height} primary overflow`).toBeLessThanOrEqual(1);
      expect(layout.primaryHeight, `${viewport.width}×${viewport.height} primary target`).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole('button', { name: 'Edit setup' }).click();
    await expect(heading(page, 'Tell us about your business')).toBeVisible();
    await page.setViewportSize({ height: 360, width: 320 });
    await page.getByLabel('Business or salon name').focus();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    const keyboardState = await page.getByRole('button', { name: 'Continue', exact: true }).evaluate((button) => {
      const box = button.getBoundingClientRect();
      return { bottom: box.bottom, height: box.height, viewportHeight: window.innerHeight };
    });
    expect(keyboardState.height).toBeGreaterThanOrEqual(44);
    expect(keyboardState.bottom).toBeLessThanOrEqual(keyboardState.viewportHeight + 1);
  });
});
