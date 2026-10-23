import { expect, type Page, test } from '@playwright/test';

import type { OnboardingClaimSuccess, OnboardingDraftClaimRequest } from '@/features/onboarding-v1-integration/contracts';
import { fingerprintOnboardingPayload } from '@/features/onboarding-v1-integration/payload-fingerprint';

import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { ONBOARDING_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

// Real AccountGate/Integration; focus, Clerk session and all API responses are simulated.
type FixtureWindow = Window & { organizationFocusFixture: {
  inspect: () => { tokens: number; activation: number; password: number; finalize: number; activationSession: string | null; activationOrganization: string | null; currentSessionId: string };
  focus: () => void;
  replaceSession: () => void;
}; };

async function readDraft(page: Page) {
  return page.evaluate(({ stateKey, documentKey }) => {
    const { eventJournal: _journal, progress: _progress, ...content } = JSON.parse(localStorage.getItem(stateKey)!);
    return { content, document: JSON.parse(localStorage.getItem(documentKey)!) };
  }, { stateKey: ONBOARDING_STORAGE_KEY, documentKey: SITE_BUILDER_STORAGE_KEY });
}

async function prepare(page: Page) {
  const requests: string[] = [];
  let submitted: OnboardingDraftClaimRequest | null = null;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3186') {
      await route.abort();
      return;
    }
    if (url.pathname.startsWith('/en/admin/website/preview/')) {
      await route.fulfill({ contentType: 'text/html', body: '<p>Synthetic saved website preview</p>' });
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    requests.push(url.pathname);

    expect(route.request().method()).toBe('POST');

    if (url.pathname === '/api/onboarding/v1/organization') {
      expect(route.request().postDataJSON()).toEqual({ businessName: 'Recovery test studio' });

      await route.fulfill({ json: { data: { created: false, organizations: [{ id: 'fixture-resolved-org', name: 'Recovery test studio' }] } } });
      return;
    }
    if (url.pathname === '/api/onboarding/v1/claim') {
      submitted = route.request().postDataJSON() as OnboardingDraftClaimRequest;
      const saved: OnboardingClaimSuccess = {
        claimId: 'fixture-focus-claim',
        created: true,
        dashboardUrl: '/en/admin',
        media: { failed: 0, pending: 0, ready: 0 },
        ownerCreatedServiceIds: [],
        payloadFingerprint: fingerprintOnboardingPayload(submitted.snapshot),
        revision: 1,
        revisionId: 'fixture-focus-revision',
        salonId: 'fixture-salon',
        salonSlug: 'fixture-salon',
        serviceMappingIssues: [],
        serviceMenuApplied: true,
        siteId: '11111111-1111-4111-8111-111111111111',
      };
      await route.fulfill({ json: { data: saved } });
      return;
    }
    if (url.pathname === '/api/onboarding/v1/media/verify') {
      await route.fulfill({ json: { data: { revision: 1 } } });
      return;
    }
    throw new Error(`Unexpected simulated focus API path: ${url.pathname}`);
  });
  const organizationResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/onboarding/v1/organization');
  await page.goto('/en/onboarding-v1?account=1&scenario=organization-focus');
  await (await organizationResponse).finished();

  expect(requests).toEqual(['/api/onboarding/v1/organization']);

  return { requests, submitted: () => submitted };
}

test('resolved organization waits through the deadline, then focus activates once and saves the same draft', async ({ page }) => {
  test.setTimeout(75_000);

  const { requests, submitted } = await prepare(page);
  const draft = await readDraft(page);

  await expect(page.getByRole('heading', { name: 'Connecting is taking longer than expected' })).toBeVisible({ timeout: 35_000 });
  await expect(page.getByRole('button', { name: 'Retry business setup' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue securely' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as FixtureWindow).organizationFocusFixture.inspect())).toMatchObject({ tokens: 1, activation: 0, password: 0, finalize: 0 });
  expect(requests).toEqual(['/api/onboarding/v1/organization']);

  await page.evaluate(() => {
    (window as FixtureWindow).organizationFocusFixture.focus();
    (window as FixtureWindow).organizationFocusFixture.focus();
  });

  await expect(page).toHaveURL(/\?claim=1&scenario=organization-focus&fixtureDecorated=1$/u);
  await expect(page.getByRole('heading', { name: 'Your progress is saved' })).toBeVisible();

  expect(await page.evaluate(() => (window as FixtureWindow).organizationFocusFixture.inspect())).toMatchObject({
    tokens: 1,
    activation: 1,
    password: 0,
    finalize: 0,
    activationSession: 'fixture-recovery-session',
    activationOrganization: 'fixture-resolved-org',
    currentSessionId: 'fixture-recovery-session',
  });
  expect(requests).toEqual(['/api/onboarding/v1/organization', '/api/onboarding/v1/claim', '/api/onboarding/v1/media/verify']);
  expect(submitted()?.snapshot.profile.businessName).toBe(draft.content.profile.businessName);
  expect(submitted()?.snapshot.site.builderDocument?.siteId).toBe(draft.document.siteId);
  expect(await readDraft(page)).toEqual(draft);
});

test('replacement before focus cancels resolved activation without another organization request or claim', async ({ page }) => {
  const { requests } = await prepare(page);
  const draft = await readDraft(page);
  await page.evaluate(() => {
    (window as FixtureWindow).organizationFocusFixture.replaceSession();
    (window as FixtureWindow).organizationFocusFixture.focus();
    (window as FixtureWindow).organizationFocusFixture.focus();
  });

  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  await expect(page).toHaveURL(/\?account=1&scenario=organization-focus$/u);

  expect(await page.evaluate(() => (window as FixtureWindow).organizationFocusFixture.inspect())).toMatchObject({ tokens: 1, activation: 0, currentSessionId: 'fixture-replacement-session' });
  expect(requests).toEqual(['/api/onboarding/v1/organization']);
  expect(await readDraft(page)).toEqual(draft);
});
