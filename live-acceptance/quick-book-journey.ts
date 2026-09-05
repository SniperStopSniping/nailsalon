import { appendFile, writeFile } from 'node:fs/promises';

import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { type Browser, expect as baseExpect, type Page, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

import type { OnboardingClaimSuccess } from '../src/features/onboarding-v1-integration/contracts';
import { cleanupRunIdentity } from './cleanup-test-identities';
import { clerkResponseShape } from './clerk-diagnostics';
import { assertLocalAcceptanceEnvironment, runScopedEmail } from './safety';

const scope = assertLocalAcceptanceEnvironment(process.env);
const expect = baseExpect.configure({ timeout: 30_000 });

async function expectHeading(page: Page, name: string | RegExp, timeout = 30_000) {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout });
}

async function expandPanel(page: Page, panelId: string) {
  const toggle = page.locator(`[aria-controls="${panelId}"]`);
  if (await toggle.getAttribute('aria-expanded') === 'false') {
    await toggle.click();
  }
}

async function expectSavedPortrait(page: Page) {
  const portrait = page.getByRole('img', { name: 'Business owner portrait', exact: true });

  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect(portrait).toHaveAttribute('src', /\/api\/onboarding\/v1\/media\//);
  expect(await portrait.evaluate(image => new URL((image as HTMLImageElement).currentSrc).origin === window.location.origin)).toBe(true);
}

export type QuickBookJourneySession = {
  keepBrowserContextsOpen?: boolean;
  pages: Page[];
  password: string;
};

/** Real provider journey; interactive callers retain credentials only in memory. */
export async function runQuickBookJourney(
  { page, browser }: { page: Page; browser: Browser },
  testInfo: Pick<TestInfo, 'attach' | 'outputPath' | 'project'>,
  session: QuickBookJourneySession,
) {
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  const startedAt = Date.now();
  const email = runScopedEmail(scope.runId, testInfo.project.name);
  const password = session.password;
  const freshContextOptions = {
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    hasTouch: testInfo.project.use.hasTouch,
    isMobile: testInfo.project.use.isMobile,
    userAgent: testInfo.project.use.userAgent,
    viewport: page.viewportSize(),
  };
  session.pages.push(page);
  const businessName = `Acceptance ${testInfo.project.name.split('-')[0]} Studio ${scope.runId.slice(-8)}`;
  const organizationIds = new Set<string>();
  const pendingResponses: Promise<void>[] = [];
  const pageErrors: string[] = [];
  const failedApiResponses: Array<{ path: string; status: number }> = [];
  const clerkResponses: Array<{ path: string; status: number } & ReturnType<typeof clerkResponseShape>> = [];
  const clerkCheckpoints: Array<{ checkpoint: string; captchaBypass: boolean | null }> = [];
  async function captureClerkCheckpoint(checkpoint: string) {
    const captchaBypass = await page.evaluate(() => {
      const value = (window as any).Clerk?.client?.captchaBypass;
      return typeof value === 'boolean' ? value : null;
    });
    clerkCheckpoints.push({ checkpoint, captchaBypass });
    return captchaBypass;
  }
  let userId: string | undefined;
  async function recordCleanupTargets() {
    await appendFile(testInfo.outputPath('run-scoped-cleanup-targets.jsonl'), `${JSON.stringify({
      organizationIds: [...organizationIds],
      projectName: testInfo.project.name,
      runId: scope.runId,
      startedAt,
      userId,
    })}\n`, { mode: 0o600 });
  }
  await recordCleanupTargets();
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname === process.env.CLERK_FAPI && url.pathname.startsWith('/v1/')) {
      pendingResponses.push((async () => {
        const shape = clerkResponseShape(await response.json().catch(() => null));
        clerkResponses.push({ path: url.pathname, status: response.status(), ...shape });
      })());
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
          await recordCleanupTargets();
        }
      })());
    }
  });

  try {
    await setupClerkTestingToken({ page });
    await page.goto('/onboarding-v1', { waitUntil: 'domcontentloaded' });
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
    await captureClerkCheckpoint('before-email-lookup');
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expectHeading(page, 'Create your password');
    await captureClerkCheckpoint('after-unknown-email-lookup');
    // Failed sign-in lookups can piggyback meta.client, which the official
    // testing helper does not normalize. Reload the public client resource
    // through that unmodified helper; never alter application CAPTCHA state.
    await page.evaluate(async () => {
      await (window as any).Clerk.client.reload();
    });

    expect(await captureClerkCheckpoint('before-signup')).toBe(true);

    process.stdout.write('Live acceptance: official-helper client reload ready; submitting Development signup.\n');
    await page.getByLabel('Password', { exact: true }).fill(password);
    // A real recipient cannot enter the code before Clerk prepares the email.
    // Register before signup so the known test code cannot race that request.
    await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.hostname === process.env.CLERK_FAPI
          && url.pathname.endsWith('/prepare_verification')
          && response.request().method() === 'POST'
          && response.status() === 200;
      }, { timeout: 120_000 }),
      page.getByRole('button', { name: 'Create account and continue', exact: true }).click(),
    ]);

    await expect(page.getByRole('heading', { name: 'Check your email', exact: true })).toBeVisible({ timeout: 120_000 });

    process.stdout.write('Live acceptance: Development signup reached email verification.\n');
    await page.getByLabel('Verification code', { exact: true }).fill('424242');
    const [earlyResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/onboarding/v1/claim' && response.request().method() === 'POST', { timeout: 90_000 }),
      page.getByRole('button', { name: /Verify and save/ }).click(),
    ]);

    expect(earlyResponse.status()).toBe(200);

    process.stdout.write('Live acceptance: authenticated early draft claim returned 200; waiting for media completion.\n');
    const earlyClaim = (await earlyResponse.json()).data as OnboardingClaimSuccess;
    await expectHeading(page, 'Your progress is saved', 90_000);
    process.stdout.write('Live acceptance: verified identity and early draft claim succeeded.\n');
    userId = await page.evaluate(() => (window as any).Clerk.user.id as string);
    await recordCleanupTargets();

    await expect(page.frameLocator('iframe[title^="Saved preview of "]').getByText(businessName).first())
      .toBeVisible({ timeout: 90_000 });

    await page.screenshot({ path: testInfo.outputPath('early-save.png') });
    await page.getByRole('button', { name: 'Continue setting up', exact: true }).click();

    await expectHeading(page, 'Let’s get you ready to take bookings');
    await page.getByRole('button', { name: 'Review services & add-ons', exact: true }).click();
    const library = page.getByRole('dialog', { name: 'Choose your services', exact: true });

    await expect(library).toBeVisible();

    await library.getByRole('button', { name: 'Done', exact: true }).click();

    await expect(library).not.toBeVisible();
    await expect(page.locator('[data-booking-task="services"]')).toHaveClass(/\bis-complete\b/);
    await expect(page.getByRole('button', { name: /^Use these \d+ services$/ })).toHaveCount(0);

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

    const [finalResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/onboarding/v1/claim' && response.request().method() === 'POST', { timeout: 90_000 }),
      page.getByRole('button', { name: 'Finish setup', exact: true }).click(),
    ]);

    expect(finalResponse.status()).toBe(200);

    const finalClaim = (await finalResponse.json()).data as OnboardingClaimSuccess;

    expect(finalClaim.siteId).toBe(earlyClaim.siteId);
    expect(finalClaim.revision).toBeGreaterThan(earlyClaim.revision);
    expect(finalClaim.serviceMenuApplied).toBe(true);

    // A core claim returns before the browser uploads this revision's media.
    // Wait for the real completion screen, then read the persisted revision.
    await expectHeading(page, 'Your Luster site is saved', 90_000);
    const statusResponse = await page.request.post('/api/onboarding/v1/status', {
      data: { anonymousDraftToken: finalResponse.request().postDataJSON().anonymousDraftToken },
    });

    expect(statusResponse.status()).toBe(200);

    const completedClaim = (await statusResponse.json()).data.claim as OnboardingClaimSuccess;

    expect(completedClaim.siteId).toBe(finalClaim.siteId);
    expect(completedClaim.revision).toBeGreaterThanOrEqual(finalClaim.revision);
    expect(completedClaim.media.ready).toBeGreaterThan(0);
    expect(completedClaim.media.failed).toBe(0);
    expect(completedClaim.media.pending).toBe(0);

    process.stdout.write('Live acceptance: same-site final claim, service menu, and saved media verified.\n');
    await page.getByRole('button', { name: 'Choose how to start', exact: true }).click();
    await expectHeading(page, 'Choose how you want to start');
    const [planResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/onboarding/v1/plan' && response.request().method() === 'PATCH', { timeout: 90_000 }),
      page.getByRole('button', { name: 'Continue free', exact: true }).click(),
    ]);

    expect(planResponse.status()).toBe(200);
    // The hard dashboard navigation can release Chrome's response body.
    // Assert the persisted same-site plan through the handoff read below.

    await page.waitForURL(/\/admin\?/, { timeout: 90_000 });

    await expect(page.getByTestId('owner-today-workspace')).toBeVisible();

    const dashboardURL = page.url();
    await page.reload();

    await expect(page.getByTestId('owner-today-workspace')).toBeVisible();

    const handoffResponse = await page.request.get(`/api/admin/onboarding-site?salonSlug=${encodeURIComponent(finalClaim.salonSlug)}`);

    expect(handoffResponse.status()).toBe(200);

    const handoff = (await handoffResponse.json()).data;

    expect(handoff.site.id).toBe(finalClaim.siteId);
    expect(handoff.setup.servicesAdded).toBe(true);
    expect(handoff.handoff.planIntent).toBe('free');

    await page.goto(handoff.site.previewUrl);

    await expect(page.getByText(businessName).first()).toBeVisible();

    await expectSavedPortrait(page);

    await page.screenshot({ path: testInfo.outputPath('saved-preview.png') });

    await page.goto(dashboardURL);
    const signOut = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
    if (!await signOut.isVisible()) {
      await page.getByTestId('owner-nav-more').click();
    }
    const [signOutResponse] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/auth/logout' && response.request().method() === 'POST', { timeout: 90_000 }),
      signOut.click(),
    ]);

    expect(signOutResponse.status()).toBe(200);

    await page.waitForURL(url => !/\/admin(?:[/?]|$)/.test(url.pathname), { timeout: 90_000 });

    const freshContext = await browser.newContext(freshContextOptions);
    try {
      const fresh = await freshContext.newPage();
      session.pages.push(fresh);
      fresh.setDefaultNavigationTimeout(90_000);
      await setupClerkTestingToken({ page: fresh });
      await fresh.goto(`${scope.baseURL}/en/owner-sign-in`);
      // The current Development instance renders email and password together.
      // These are the visible Clerk SignIn form fields, not a ticket shortcut.
      await fresh.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
      await fresh.getByLabel('Password', { exact: true }).fill(password);
      await fresh.getByRole('button', { name: /^continue$/i }).click();
      await fresh.waitForURL(/\/admin/, { timeout: 60_000 });

      await expect(fresh.getByTestId('owner-today-workspace')).toBeVisible();

      process.stdout.write('Live acceptance: fresh-browser owner login reached the dashboard.\n');
      await fresh.goto(`${scope.baseURL}${handoff.site.previewUrl}`);

      await expect(fresh.getByText(businessName).first()).toBeVisible();

      await expectSavedPortrait(fresh);

      await fresh.screenshot({ path: testInfo.outputPath('fresh-login-preview.png') });

      await fresh.goto(`${scope.baseURL}${handoff.site.setupUrl}`);

      await expect(fresh.locator('[data-screen="final_preview"]')).toBeVisible();
      await expect(fresh.getByText(businessName).first()).toBeVisible();

      await expectSavedPortrait(fresh);

      await fresh.screenshot({ path: testInfo.outputPath('fresh-login-resumed-setup.png') });

      const [resumedResponse] = await Promise.all([
        fresh.waitForResponse(response => new URL(response.url()).pathname === '/api/onboarding/v1/claim' && response.request().method() === 'POST', { timeout: 90_000 }),
        fresh.getByRole('button', { name: 'Finish setup', exact: true }).click(),
      ]);

      expect(resumedResponse.status()).toBe(200);

      const resumedClaim = (await resumedResponse.json()).data as OnboardingClaimSuccess;

      expect(resumedClaim.siteId).toBe(finalClaim.siteId);
      expect(resumedClaim.salonSlug).toBe(finalClaim.salonSlug);
      expect(resumedClaim.revision).toBeGreaterThanOrEqual(finalClaim.revision);

      await expectHeading(fresh, 'Your Luster site is saved', 90_000);

      process.stdout.write('Live acceptance: fresh-browser setup resumed and saved the same site and URL.\n');

      await fresh.goto(`${scope.baseURL}/en/admin/booking-page?salon=${encodeURIComponent(finalClaim.salonSlug)}`);
      const [layoutPublished] = await Promise.all([
        fresh.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/booking-page' && response.request().method() === 'POST', { timeout: 90_000 }),
        fresh.getByTestId('booking-page-publish').click(),
      ]);

      expect(layoutPublished.status()).toBe(200);

      const [publication] = await Promise.all([
        fresh.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/salon/publish' && response.request().method() === 'POST', { timeout: 90_000 }),
        fresh.getByTestId('salon-publish-button').click(),
      ]);

      expect(publication.status()).toBe(200);

      const publicLinks = (await publication.json()).data as { bookingUrl: string; publicUrl: string };

      expect(new URL(publicLinks.publicUrl).origin).toBe(scope.baseURL);
      expect(new URL(publicLinks.bookingUrl).origin).toBe(scope.baseURL);

      const guestContext = await browser.newContext(freshContextOptions);
      try {
        const guest = await guestContext.newPage();
        session.pages.push(guest);
        guest.setDefaultNavigationTimeout(90_000);
        const publicPage = await guest.goto(publicLinks.publicUrl);

        expect(publicPage?.status()).toBe(200);
        await expect(guest.getByText(businessName).first()).toBeVisible();
        await expect(guest.getByText('100 Test Street', { exact: false })).toHaveCount(0);

        const bookingPage = await guest.goto(publicLinks.bookingUrl);

        expect(bookingPage?.status()).toBe(200);

        await guest.locator('button[data-testid^="service-card-"]').first().click();
        await guest.getByTestId('service-continue-button').click();
        await guest.waitForURL(/\/book\/(?:tech|time)(?:\?|$)/);
        process.stdout.write('Live acceptance: unauthenticated public booking advanced past service selection.\n');
        await guest.screenshot({ path: testInfo.outputPath('public-guest-booking-start.png') });
      } finally {
        if (!session.keepBrowserContextsOpen) {
          await guestContext.close();
        }
      }
    } finally {
      if (!session.keepBrowserContextsOpen) {
        await freshContext.close();
      }
    }

    expect(pageErrors).toEqual([]);
    expect(failedApiResponses).toEqual([]);

    const result = { freshBrowserPreview: true, mediaReady: true, publicGuestBookingStart: true, revision: completedClaim.revision, serviceMenuApplied: finalClaim.serviceMenuApplied };
    const evidencePath = testInfo.outputPath('acceptance-result.json');
    await writeFile(evidencePath, JSON.stringify(result));
    await testInfo.attach('acceptance-result', { contentType: 'application/json', path: evidencePath });
    return result;
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
      await writeFile(diagnosticsPath, JSON.stringify({ clerkCheckpoints, clerkResponses, failedApiResponses, pageErrors, state }));
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
}
