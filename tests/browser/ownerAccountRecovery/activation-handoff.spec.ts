import { expect, type Page, test } from '@playwright/test';

import type { OnboardingClaimSuccess, OnboardingDraftClaimRequest } from '@/features/onboarding-v1-integration/contracts';
import { fingerprintOnboardingPayload } from '@/features/onboarding-v1-integration/payload-fingerprint';

import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { ONBOARDING_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

// Real application components and document navigation; reactive identity and all
// HTTP outcomes are simulated. This complements the separate real-SDK repro.
type FixtureWindow = Window & { activationHandoffFixture: {
  inspect: () => { password: number; finalize: number; activation: number; navigationReady: boolean; currentSessionId: string | undefined; events: string[] };
  completeActivation: () => void;
  replaceSession: () => void;
  invokeStaleNavigate: () => void;
}; };

async function readDraft(page: Page) {
  return page.evaluate(({ stateKey, documentKey }) => {
    const { eventJournal: _journal, progress: _progress, ...content } = JSON.parse(localStorage.getItem(stateKey)!);
    return { content, document: JSON.parse(localStorage.getItem(documentKey)!) };
  }, { stateKey: ONBOARDING_STORAGE_KEY, documentKey: SITE_BUILDER_STORAGE_KEY });
}

async function flushReactiveAuth(page: Page) {
  // Let React commit both the external-store update and its parent effects
  // while SDK navigation remains explicitly blocked by the fixture.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function prepare(page: Page) {
  const requests: { path: string; document: number }[] = [];
  let submitted: OnboardingDraftClaimRequest | null = null;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3186') {
      await route.abort();
      return;
    }
    if (url.pathname.startsWith('/en/admin/website/preview/')) {
      await route.fulfill({ contentType: 'text/html', body: '<p>Simulated saved website preview</p>' });
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    requests.push({ path: url.pathname, document: Number(route.request().headers()['x-fixture-document']) });

    expect(route.request().method()).toBe('POST');

    if (url.pathname === '/api/onboarding/v1/organization') {
      expect(route.request().postDataJSON()).toEqual({ businessName: 'Recovery test studio' });

      await route.fulfill({ json: { data: { created: false, organizations: [{ id: 'fixture-resolved-org', name: 'Recovery test studio' }] } } });
      return;
    }
    if (url.pathname === '/api/onboarding/v1/claim') {
      submitted = route.request().postDataJSON() as OnboardingDraftClaimRequest;
      const saved: OnboardingClaimSuccess = {
        claimId: 'fixture-activation-claim',
        created: true,
        dashboardUrl: '/en/admin',
        media: { failed: 0, pending: 0, ready: 0 },
        ownerCreatedServiceIds: [],
        payloadFingerprint: fingerprintOnboardingPayload(submitted.snapshot),
        revision: 1,
        revisionId: 'fixture-activation-revision',
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
    throw new Error(`Unexpected simulated activation-handoff API path: ${url.pathname}`);
  });
  await page.goto('/en/onboarding-v1?account=1&scenario=activation-handoff');

  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();

  const draft = await readDraft(page);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByLabel('Email address').fill('activation-handoff@example.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('simulated-activation-password');
  await page.getByRole('button', { name: 'Create account and continue' }).click();

  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).activationHandoffFixture.inspect().navigationReady)).toBe(true);

  await flushReactiveAuth(page);

  return { requests, draft, submitted: () => submitted };
}

test('active auth waits for the controlled SDK handoff and the destination saves exactly once', async ({ page }) => {
  const { requests, draft, submitted } = await prepare(page);

  expect(await page.evaluate(() => (window as FixtureWindow).activationHandoffFixture.inspect())).toMatchObject({
    password: 1,
    finalize: 1,
    activation: 1,
    currentSessionId: 'fixture-recovery-session',
  });
  // This assertion failed against 10b947c6: reactive active auth started a
  // parent claim in document 1 before the SDK navigation callback fired.
  expect(requests).toEqual([{ path: '/api/onboarding/v1/organization', document: 1 }]);

  await expect(page).toHaveURL(/\?account=1&scenario=activation-handoff$/u);
  expect(await readDraft(page)).toEqual(draft);

  await page.evaluate(() => (window as FixtureWindow).activationHandoffFixture.completeActivation());

  await expect(page).toHaveURL(/\?claim=1&scenario=activation-handoff&fixtureDecorated=1$/u);
  await expect(page.getByRole('heading', { name: 'Your progress is saved' })).toBeVisible();

  expect(await page.evaluate(() => Number(sessionStorage.getItem('fixture-activation-document')))).toBe(2);
  expect(requests).toEqual([
    { path: '/api/onboarding/v1/organization', document: 1 },
    { path: '/api/onboarding/v1/claim', document: 2 },
    { path: '/api/onboarding/v1/media/verify', document: 2 },
  ]);
  expect(await page.evaluate(() => (window as FixtureWindow).activationHandoffFixture.inspect().events)).toEqual([
    'session:pending:fixture-recovery-session',
    'session:active:fixture-recovery-session',
    'session:undefined:',
    'navigate:active',
    'session:active:fixture-recovery-session',
  ]);
  expect(submitted()?.snapshot.profile.businessName).toBe(draft.content.profile.businessName);
  expect(submitted()?.snapshot.site.builderDocument?.siteId).toBe(draft.document.siteId);
  expect(await readDraft(page)).toEqual(draft);
});

test('session replacement rejects late SDK navigation and preserves the unclaimed draft', async ({ page }) => {
  const { requests, draft } = await prepare(page);

  expect(requests).toEqual([{ path: '/api/onboarding/v1/organization', document: 1 }]);

  await page.evaluate(() => {
    (window as FixtureWindow).activationHandoffFixture.replaceSession();
    (window as FixtureWindow).activationHandoffFixture.invokeStaleNavigate();
    (window as FixtureWindow).activationHandoffFixture.completeActivation();
    (window as FixtureWindow).activationHandoffFixture.invokeStaleNavigate();
  });
  await flushReactiveAuth(page);

  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  await expect(page).toHaveURL(/\?account=1&scenario=activation-handoff$/u);

  expect(await page.evaluate(() => Number(sessionStorage.getItem('fixture-activation-document')))).toBe(1);
  expect(await page.evaluate(() => (window as FixtureWindow).activationHandoffFixture.inspect())).toMatchObject({
    password: 1,
    finalize: 1,
    activation: 1,
    currentSessionId: 'fixture-replacement-session',
  });
  expect(requests).toEqual([{ path: '/api/onboarding/v1/organization', document: 1 }]);
  expect(await readDraft(page)).toEqual(draft);
});

const cancellations = [
  {
    name: 'Back button',
    cancel: (page: Page) => page.getByRole('button', { name: 'Back', exact: true }).click(),
  },
  {
    name: 'browser Back',
    cancel: async (page: Page) => {
      // Reproduce the same-document history entry created when opening the
      // account gate, then use actual browser Back to dispatch popstate.
      await page.evaluate(() => {
        const gateUrl = window.location.href;
        window.history.replaceState({}, '', '/en/onboarding-v1');
        window.history.pushState({}, '', gateUrl);
      });
      await page.goBack();
    },
  },
];

for (const { name, cancel } of cancellations) {
  test(`${name} cancels the pending handoff before delayed SDK callbacks`, async ({ page }) => {
    const { requests, draft } = await prepare(page);

    expect(requests).toEqual([{ path: '/api/onboarding/v1/organization', document: 1 }]);

    await cancel(page);

    await expect(page).toHaveURL('http://127.0.0.1:3186/en/onboarding-v1');

    await flushReactiveAuth(page);
    await page.evaluate(() => {
      (window as FixtureWindow).activationHandoffFixture.invokeStaleNavigate();
      (window as FixtureWindow).activationHandoffFixture.completeActivation();
      (window as FixtureWindow).activationHandoffFixture.invokeStaleNavigate();
    });
    await flushReactiveAuth(page);

    await expect(page).toHaveURL('http://127.0.0.1:3186/en/onboarding-v1');

    expect(await page.evaluate(() => Number(sessionStorage.getItem('fixture-activation-document')))).toBe(1);
    expect(requests).toEqual([{ path: '/api/onboarding/v1/organization', document: 1 }]);
    expect(await readDraft(page)).toEqual(draft);
  });
}
