import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';

import type { OnboardingClaimSuccess } from '../src/features/onboarding-v1-integration/contracts';
import { cleanupRunIdentity } from './cleanup-test-identities';
import { assertLocalAcceptanceEnvironment, runScopedEmail } from './safety';

const scope = assertLocalAcceptanceEnvironment(process.env);

async function expectHeading(page: Page, name: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function expandPanel(page: Page, panelId: string) {
  const toggle = page.locator(`[aria-controls="${panelId}"]`);
  if (await toggle.getAttribute('aria-expanded') === 'false') {
    await toggle.click();
  }
}

async function expectSavedPortrait(page: Page) {
  const portrait = page.getByRole('img', { name: 'Acceptance Owner profile photo', exact: true });

  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

test('Clerk setup propagates to the browser worker', async ({ page }, testInfo) => {
  const presence = {
    frontendApiPresent: Boolean(process.env.CLERK_FAPI),
    testingTokenPresent: Boolean(process.env.CLERK_TESTING_TOKEN),
  };

  expect(presence).toEqual({ frontendApiPresent: true, testingTokenPresent: true });

  await setupClerkTestingToken({ page });
  const evidencePath = testInfo.outputPath('clerk-worker-presence.json');
  await writeFile(evidencePath, JSON.stringify(presence));
  await testInfo.attach('clerk-worker-presence', { contentType: 'application/json', path: evidencePath });
});

test('Quick Book owner can verify, save media, finish setup, and return to the same workspace', async ({ page, browser }, testInfo) => {
  test.setTimeout(420_000);

  page.setDefaultTimeout(30_000);
  const startedAt = Date.now();
  const email = runScopedEmail(scope.runId, testInfo.project.name);
  const password = randomUUID().concat('!aA9');
  const businessName = `Acceptance Studio ${scope.runId.slice(-8)}`;
  const organizationIds = new Set<string>();
  const pendingResponses: Promise<void>[] = [];
  const pageErrors: string[] = [];
  const failedApiResponses: Array<{ path: string; status: number }> = [];
  const clerkResponses: Array<{ path: string; status: number; testingToken: boolean }> = [];
  let userId: string | undefined;
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname === process.env.CLERK_FAPI && url.pathname.startsWith('/v1/')) {
      clerkResponses.push({ path: url.pathname, status: response.status(), testingToken: url.searchParams.has('__clerk_testing_token') });
    }
    if (url.origin !== scope.baseURL || !url.pathname.startsWith('/api/')) {
      return;
    }
    if (response.status() >= 500) {
      failedApiResponses.push({ path: url.pathname, status: response.status() });
    }
    if (url.pathname === '/api/onboarding/v1/organization') {
      pendingResponses.push((async () => {
        const body = await response.json().catch(() => null);
        if (body?.data?.created) {
          for (const organization of body.data.organizations ?? []) {
            organizationIds.add(organization.id);
          }
        }
      })());
    }
  });

  try {
    await setupClerkTestingToken({ page });
    await page.goto('/onboarding-v1');
    await page.getByRole('button', { name: /Start with Quick Book$/ }).click();
    await expectHeading(page, 'Let’s start with your business');
    await page.getByLabel('Salon or studio name *', { exact: true }).fill(businessName);
    await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Independent nail tech/ }) }).click();
    await page.getByLabel('Your name *', { exact: true }).fill('Acceptance Owner');
    await expandPanel(page, 'onboarding-profile-photo-editor');
    const portrait = await sharp({ create: { background: '#9b3658', channels: 3, height: 80, width: 80 } }).png().toBuffer();
    await page.locator('#onboarding-profile-photo-editor input[type="file"]').setInputFiles({
      buffer: portrait,
      mimeType: 'image/png',
      name: 'acceptance-portrait.png',
    });

    await expect(page.locator('#onboarding-profile-photo-editor').getByText('Profile photo ready', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Show me my site →', exact: true }).click();
    await expectHeading(page, 'Your starting site is ready');
    await page.getByRole('button', { name: 'Continue setting up my site', exact: true }).click();

    await expectHeading(page, 'Where can clients find you?');
    await page.getByLabel('City *', { exact: true }).fill('Toronto');
    await page.getByLabel('Full address *', { exact: true }).fill('100 Test Street');
    await page.locator('label').filter({ has: page.getByRole('radio', { name: /Show my full address after they book/ }) }).click();
    await expandPanel(page, 'onboarding-contact-card-panel');
    await page.locator('label').filter({ has: page.getByRole('radio', { name: /^Online booking only/ }) }).click();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expectHeading(page, 'When are you open?');
    await page.getByRole('button', { name: 'Apply to selected days', exact: true }).click();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expectHeading(page, 'Make it feel like yours');
    await page.getByRole('button', { name: 'Use this look', exact: true }).click();
    await expectHeading(page, /Your site is coming together/);
    await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expectHeading(page, 'Create your password');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account and continue', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible({ timeout: 120_000 });

    await page.getByLabel('Verification code', { exact: true }).fill('424242');
    const earlyClaimResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/onboarding/v1/claim');
    await page.getByRole('button', { name: /Verify and save/ }).click();
    const earlyResponse = await earlyClaimResponse;

    expect(earlyResponse.status()).toBe(200);

    const earlyClaim = (await earlyResponse.json()).data as OnboardingClaimSuccess;
    await expectHeading(page, 'Your progress is saved');
    userId = await page.evaluate(() => (window as any).Clerk.user.id as string);
    await page.screenshot({ path: testInfo.outputPath('early-save.png') });
    await page.getByRole('button', { name: 'Continue setting up', exact: true }).click();

    await expectHeading(page, 'Let’s get you ready to take bookings');
    await page.getByRole('button', { name: 'Review services & add-ons', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Choose your services', exact: true });

    await expect(library).toBeVisible();

    await library.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: /^Use these \d+ services$/ }).click();
    await expandPanel(page, 'booking-task-clients');
    await page.locator('label').filter({ has: page.getByRole('radio', { name: 'Appointment only', exact: true }) }).click();
    await page.locator('label').filter({ has: page.getByRole('radio', { name: 'Yes', exact: true }) }).click();
    await page.getByLabel('How much notice do you need before an appointment?', { exact: true }).selectOption('preset:0');
    await page.locator('label').filter({ has: page.getByRole('radio', { name: 'No deposit', exact: true }) }).click();
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expectHeading(page, 'Tell clients a little about you');
    await page.getByLabel('Short introduction', { exact: true }).fill('Thoughtful, detailed nail appointments in a calm studio.');
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await expectHeading(page, 'Choose your Quick Book layout');
    await page.getByRole('button', { name: 'Use this layout', exact: true }).click();
    await page.getByRole('button', { name: 'Save policies', exact: true }).click();
    await expectHeading(page, 'Choose how clients browse your services');
    await page.getByRole('button', { name: 'Use this booking layout', exact: true }).click();

    await expect(page.locator('[data-screen="final_preview"]')).toBeVisible();

    const finalClaimResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/onboarding/v1/claim');
    await page.getByRole('button', { name: 'Save my site', exact: true }).click();
    const finalResponse = await finalClaimResponse;

    expect(finalResponse.status()).toBe(200);

    const finalClaim = (await finalResponse.json()).data as OnboardingClaimSuccess;

    expect(finalClaim.siteId).toBe(earlyClaim.siteId);
    expect(finalClaim.revision).toBeGreaterThan(earlyClaim.revision);
    expect(finalClaim.serviceMenuApplied).toBe(true);
    expect(finalClaim.media.ready).toBeGreaterThan(0);
    expect(finalClaim.media.failed).toBe(0);
    expect(finalClaim.media.pending).toBe(0);

    await expectHeading(page, 'Your Luster site is saved');
    await page.getByRole('button', { name: 'Choose how to start', exact: true }).click();
    await page.getByRole('button', { name: 'Continue free', exact: true }).click();
    await page.waitForURL(/\/admin\?/);

    await expect(page.getByTestId('owner-today-workspace')).toBeVisible();

    const dashboardURL = page.url();
    await page.reload();

    await expect(page.getByTestId('owner-today-workspace')).toBeVisible();

    const handoffResponse = await page.request.get(`/api/admin/onboarding-site?salonSlug=${encodeURIComponent(finalClaim.salonSlug)}`);

    expect(handoffResponse.status()).toBe(200);

    const handoff = (await handoffResponse.json()).data;

    expect(handoff.site.id).toBe(finalClaim.siteId);
    expect(handoff.setup.servicesAdded).toBe(true);

    await page.goto(handoff.site.previewUrl);

    await expect(page.getByText(businessName).first()).toBeVisible();

    await expectSavedPortrait(page);

    await page.screenshot({ path: testInfo.outputPath('saved-preview.png') });

    await page.goto(dashboardURL);
    await page.getByRole('button', { name: /log ?out|sign ?out/i }).first().click();

    await expect(page).not.toHaveURL(/\/admin(?:[/?]|$)/);

    const freshContext = await browser.newContext();
    try {
      const fresh = await freshContext.newPage();
      await setupClerkTestingToken({ page: fresh });
      await fresh.goto(`${scope.baseURL}/en/owner-sign-in`);
      await fresh.getByLabel(/email/i).first().fill(email);
      await fresh.getByRole('button', { name: /^continue$/i }).click();
      await fresh.getByLabel(/password/i).first().fill(password);
      await fresh.getByRole('button', { name: /^continue$/i }).click();
      await fresh.waitForURL(/\/admin/, { timeout: 60_000 });

      await expect(fresh.getByTestId('owner-today-workspace')).toBeVisible();

      await fresh.goto(`${scope.baseURL}${handoff.site.previewUrl}`);

      await expect(fresh.getByText(businessName).first()).toBeVisible();

      await expectSavedPortrait(fresh);

      await fresh.screenshot({ path: testInfo.outputPath('fresh-login-preview.png') });

      await fresh.goto(`${scope.baseURL}/en/admin/booking-page?salon=${encodeURIComponent(finalClaim.salonSlug)}`);
      const layoutPublished = fresh.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/booking-page' && response.request().method() === 'POST');
      await fresh.getByTestId('booking-page-publish').click();

      expect((await layoutPublished).status()).toBe(200);

      const salonPublished = fresh.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/salon/publish' && response.request().method() === 'POST');
      await fresh.getByTestId('salon-publish-button').click();
      const publication = await salonPublished;

      expect(publication.status()).toBe(200);

      const publicLinks = (await publication.json()).data as { bookingUrl: string; publicUrl: string };

      expect(new URL(publicLinks.publicUrl).origin).toBe(scope.baseURL);
      expect(new URL(publicLinks.bookingUrl).origin).toBe(scope.baseURL);

      const guestContext = await browser.newContext();
      try {
        const guest = await guestContext.newPage();
        const publicPage = await guest.goto(publicLinks.publicUrl);

        expect(publicPage?.status()).toBe(200);
        await expect(guest.getByText(businessName).first()).toBeVisible();

        const bookingPage = await guest.goto(publicLinks.bookingUrl);

        expect(bookingPage?.status()).toBe(200);

        await guest.locator('button[data-testid^="service-card-"]').first().click();
        await guest.getByTestId('service-continue-button').click();
        await guest.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);
        await guest.screenshot({ path: testInfo.outputPath('public-guest-booking-start.png') });
      } finally {
        await guestContext.close();
      }
    } finally {
      await freshContext.close();
    }

    expect(pageErrors).toEqual([]);
    expect(failedApiResponses).toEqual([]);

    const evidencePath = testInfo.outputPath('acceptance-result.json');
    await writeFile(evidencePath, JSON.stringify({ freshBrowserPreview: true, mediaReady: true, publicGuestBookingStart: true, revision: finalClaim.revision, serviceMenuApplied: finalClaim.serviceMenuApplied }));
    await testInfo.attach('acceptance-result', { contentType: 'application/json', path: evidencePath });
  } finally {
    try {
      await Promise.all(pendingResponses);
      const state = await page.evaluate(() => {
        const clerk = (window as any).Clerk;
        return {
          captchaBypass: clerk?.client?.captchaBypass,
          headings: Array.from(document.querySelectorAll('h1')).map(item => item.textContent),
          sessionStatus: clerk?.session?.status,
          sessionTask: clerk?.session?.currentTask?.key,
          signUpStatus: clerk?.client?.signUp?.status,
          userPresent: Boolean(clerk?.user),
        };
      }).catch(() => null);
      const diagnosticsPath = testInfo.outputPath('sanitized-provider-diagnostics.json');
      await writeFile(diagnosticsPath, JSON.stringify({ clerkResponses, failedApiResponses, pageErrors, state }));
      await testInfo.attach('sanitized-provider-diagnostics', { contentType: 'application/json', path: diagnosticsPath });
    } finally {
      const cleanup = await cleanupRunIdentity({
        organizationIds: [...organizationIds],
        projectName: testInfo.project.name,
        startedAt,
        userId,
      });
      const cleanupPath = testInfo.outputPath('run-scoped-cleanup.json');
      await writeFile(cleanupPath, JSON.stringify(cleanup));
      await testInfo.attach('run-scoped-cleanup', { contentType: 'application/json', path: cleanupPath });
    }
  }
});
