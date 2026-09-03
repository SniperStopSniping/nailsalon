import { expect, type Locator, type Page, test } from '@playwright/test';

const APP_URL = process.env.LUSTER_MOBILE_APP_URL ?? 'http://127.0.0.1:4201/onboarding-v1';
const STORAGE_KEY = 'luster:onboarding-v1-lab';
const sizes = [[320, 568], [375, 667], [390, 844], [430, 932]] as const;

async function unobscured(control: Locator) {
  await control.scrollIntoViewIfNeeded();

  await expect.poll(() => control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function revealInstagramInput(page: Page) {
  const disclosure = page.getByRole('button', { name: 'Add Instagram', exact: true });
  if (await disclosure.isVisible()) {
    await disclosure.click();
  }
}

async function openFixture(page: Page, screen: string) {
  await page.goto('/?audit=1');
  await page.getByRole('button', { name: 'Start with Quick Book' }).click();
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('menuitem', { name: 'Lab review options' }).click();
  await page.getByRole('dialog', { name: 'Lab review options' })
    .getByRole('button', { name: 'Daniela / Isla Nail Studio', exact: true }).click();

  await expect(page.getByLabel('Autosave status')).toHaveText('Saved');

  await page.evaluate(({ key, destination }) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    state.progress.currentScreen = destination;
    state.progress.lastActiveScreen = destination;
    state.profile.ownerName = 'Maya';
    state.profile.businessName = 'Maya Nail Atelier';
    state.profile.logo = undefined;
    state.profile.profilePhoto = undefined;
    state.profile.instagram = '@maya_nail_atelier';
    state.profile.serviceMenu.reviewed = false;
    state.profile.about.shortBio = '';
    state.profile.about.fullBio = '';
    state.recipe.starter = 'quick_book';
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: STORAGE_KEY, destination: screen });
  await page.reload();
}

for (const [width, height] of sizes) {
  test(`mobile audit fixes: real app identity through account reward ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);

    page.setDefaultTimeout(10_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto(APP_URL);
    await page.getByRole('button', { name: 'Start with Quick Book' }).click();

    await expect(page.getByRole('heading', { name: 'Let’s start with your business' })).toBeVisible();

    await page.getByLabel('Salon or studio name *', { exact: true }).fill('Maya Nail Atelier');

    expect((await page.getByRole('link', { name: 'Luster onboarding', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByRole('button', { name: 'Change URL', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Independent nail tech/ }) }).click();
    await page.getByLabel('Your name *', { exact: true }).fill('Maya');
    await revealInstagramInput(page);
    await page.getByLabel('Instagram handle', { exact: true }).fill('@maya_nail_atelier');
    const inputTabIndexes = await page.locator('input[type="file"]').evaluateAll(inputs => inputs.map(input => input.tabIndex));

    expect(inputTabIndexes.every(value => value === -1)).toBe(true);

    const businessHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await noOverflow(page);
    await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Your starting site is ready' })).toBeVisible();

    await page.getByRole('button', { name: 'Continue setting up my site', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Where can clients find you?' })).toBeVisible();

    const contact = page.locator('[aria-controls="onboarding-contact-card-panel"]');

    await expect(contact).not.toContainText('Complete');

    await contact.screenshot({ animations: 'disabled', path: `/tmp/luster-mobile-ux-contact-unconfirmed-${width}.png` });
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    const city = page.getByLabel('City *', { exact: true });
    await unobscured(city);

    await expect(page.locator('.onboarding-validation-summary')).toHaveCSS('position', 'static');

    const cityBox = await city.boundingBox();
    await city.fill('Toronto');
    await page.getByLabel('Full address *', { exact: true }).fill('880 Ellesmere Rd, Unit 2');
    await page.locator('label').filter({ has: page.getByRole('radio', { name: /Show my full address after they book/ }) }).click();
    await unobscured(contact);
    await contact.click();
    await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Online booking only/ }) }).click();

    await expect(contact).toContainText('Complete');

    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'When are you open?' })).toBeVisible();

    await page.getByRole('button', { name: 'Apply to selected days', exact: true }).click();
    const sunday = page.getByRole('button', { name: 'Edit Sunday hours', exact: true });
    await unobscured(sunday);

    expect((await sunday.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await sunday.click();
    await page.getByRole('dialog', { name: 'Edit Sunday', exact: true }).getByRole('button', { name: 'Save Sunday', exact: true }).click();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Make it feel like yours' })).toBeVisible();

    const styleHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    await noOverflow(page);
    const previewButton = page.getByRole('button', { name: 'View full preview', exact: true });
    await unobscured(previewButton);
    await previewButton.click();
    const preview = page.getByRole('dialog').filter({ has: page.getByText('This is the customer experience. Builder controls and plan choices are not available here.') });

    await expect(preview).toBeVisible();

    const inner = preview.locator('[data-preview-scroll-container="true"]').first();
    await inner.hover();
    await page.mouse.wheel(0, 700);

    await expect.poll(() => inner.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

    await unobscured(preview.getByRole('button', { name: /Return to setup|Continue setup/ }));
    await preview.getByRole('button', { name: /Return to setup|Continue setup/ }).click();
    await page.getByRole('button', { name: 'Use this look', exact: true }).click();
    const rewardHeading = page.getByRole('heading', { name: /Your site is coming together/ });

    await expect(rewardHeading).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBeLessThanOrEqual(2);
    expect((await rewardHeading.boundingBox())!.y).toBeGreaterThanOrEqual(0);

    const rewardPreview = page.locator('[data-preview-scroll-container="true"]').first();

    await expect(rewardPreview).toBeVisible();
    expect((await rewardPreview.boundingBox())!.width).toBeGreaterThan(width * 0.6);

    await page.screenshot({ animations: 'disabled', path: `/tmp/luster-mobile-ux-screen6-${width}.png` });
    await rewardPreview.hover();
    await page.mouse.wheel(0, 700);

    await expect.poll(() => rewardPreview.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

    await page.mouse.move(width - 3, height / 2);
    await page.mouse.wheel(0, 650);

    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollHeight <= innerHeight || scrollY > 0
    ))).toBe(true);

    const email = page.getByRole('button', { name: 'Continue with email', exact: true });
    await unobscured(email);

    expect((await email.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await noOverflow(page);

    await test.info().attach('mobile-geometry', {
      body: JSON.stringify({ width, height, businessHeight, styleHeight, cityBox, rewardHeading: await rewardHeading.boundingBox(), rewardPreview: await rewardPreview.boundingBox(), email: await email.boundingBox() }),
      contentType: 'application/json',
    });

    expect(pageErrors).toEqual([]);
  });

  test(`mobile audit fixes: service library through final preview ${width}x${height}`, async ({ page }) => {
    test.setTimeout(120_000);

    page.setDefaultTimeout(10_000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewportSize({ width, height });
    await openFixture(page, 'booking_preferences');

    await expect(page.getByRole('heading', { name: 'Let’s get you ready to take bookings' })).toBeVisible();

    await page.getByRole('button', { name: 'Review services & add-ons', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Choose your services', exact: true });
    const list = library.locator('.onboarding-service-library__list');
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await library.getByRole('tab', { name: 'Add-ons', exact: true }).click();

    expect(await list.evaluate(element => element.scrollTop)).toBe(0);

    await unobscured(library.getByRole('button', { name: 'Done', exact: true }));
    await library.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Use these 6 services', exact: true }).click();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Tell clients a little about you' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Daniela|Isla Nail/);

    const introduction = page.getByLabel('Short introduction', { exact: true });

    await expect(introduction).not.toHaveAttribute('placeholder', /Daniela|Isla/);

    await introduction.fill('I create thoughtful, detailed nail appointments in a calm studio.');
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Choose your Quick Book layout' })).toBeVisible();

    await page.getByRole('button', { name: 'Use this layout', exact: true }).click();

    await expect(page.locator('[data-screen="policies"]')).toBeVisible();

    await page.getByRole('button', { name: 'Save policies', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Choose how clients browse your services' })).toBeVisible();

    const primary = page.getByRole('button', { name: 'Use this booking layout', exact: true });
    const back = page.getByRole('button', { name: 'Back', exact: true });
    const primaryBox = (await primary.boundingBox())!;
    const backBox = (await back.boundingBox())!;

    expect(primaryBox.y).toBeLessThan(backBox.y);
    expect(primaryBox.width).toBeGreaterThan(backBox.width);

    await page.screenshot({ animations: 'disabled', path: `/tmp/luster-mobile-ux-booking-layout-${width}.png` });
    await unobscured(primary);
    await primary.click();

    await expect(page.locator('[data-screen="final_preview"]')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Daniela|Isla Nail/);

    await page.getByRole('button', { name: 'Open interactive preview', exact: true }).click();
    const preview = page.getByRole('dialog').filter({ has: page.getByText('This is the customer experience. Builder controls and plan choices are not available here.') });
    const service = preview.getByRole('button', { name: /View details for Russian Manicure/ }).first();
    await service.scrollIntoViewIfNeeded();
    await service.click();
    const detail = page.getByTestId('service-detail-dialog');

    await expect(detail).toBeVisible();

    const detailBody = detail.getByTestId('service-detail-scroll-body');
    await detailBody.hover();
    await page.mouse.wheel(0, 500);

    await expect.poll(() => detailBody.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

    await unobscured(detail.getByRole('button', { name: 'Keep browsing', exact: true }));
    await unobscured(detail.getByRole('button', { name: 'Continue', exact: true }));
    await detail.getByRole('button', { name: 'Keep browsing', exact: true }).click();

    await expect(detail).toBeHidden();

    await preview.getByRole('button', { name: /Return to setup|Continue setup/ }).click();
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Continue free', exact: true })).toBeVisible();

    await noOverflow(page);

    expect(pageErrors).toEqual([]);
  });
}
