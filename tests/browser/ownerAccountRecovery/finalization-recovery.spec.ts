import { expect, type Page, test } from '@playwright/test';

import type { OnboardingClaimSuccess, OnboardingDraftClaimRequest } from '@/features/onboarding-v1-integration/contracts';
import { fingerprintOnboardingPayload } from '@/features/onboarding-v1-integration/payload-fingerprint';

import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { ONBOARDING_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

type Fixture = {
  counts: () => { password: number; finalize: number; activation: number; activationKeys: string[]; activationSession: string | null; currentSessionId: string; currentOrganizationId: string };
  settleFinalize: () => void;
  completeActivation: () => void;
  replaceSession: () => void;
  invokeStaleNavigate: () => void;
};
type FixtureWindow = Window & { accountRecoveryFixture: Fixture };

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

    if (url.pathname === '/api/onboarding/v1/claim') {
      submitted = route.request().postDataJSON() as OnboardingDraftClaimRequest;
      const saved: OnboardingClaimSuccess = {
        claimId: 'fixture-recovery-claim',
        created: true,
        dashboardUrl: '/en/admin',
        media: { failed: 0, pending: 0, ready: 0 },
        ownerCreatedServiceIds: [],
        payloadFingerprint: fingerprintOnboardingPayload(submitted.snapshot),
        revision: 1,
        revisionId: 'fixture-recovery-revision',
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
    throw new Error(`Unexpected isolated recovery API path: ${url.pathname}`);
  });
  await page.goto('/en/onboarding-v1?account=1&scenario=finalization-recovery');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByLabel('Email address').fill('recovery@example.test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill('synthetic-fixture-password');
  await page.getByRole('button', { name: 'Create account and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Setting up your account…' })).toBeVisible();

  return { requests, submitted: () => submitted };
}

test('pending finalization exposes bounded recovery, then securely resumes the same draft', async ({ page }) => {
  test.setTimeout(75_000);

  const { requests, submitted } = await prepare(page);
  const draft = await readDraft(page);

  // Real browser time exercises the production 30s deadline without changing it.
  await expect(page.getByRole('heading', { name: 'Connecting is taking longer than expected' })).toBeVisible({ timeout: 35_000 });
  await expect(page.locator('.onboarding-gate__panel[aria-live]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('link', { name: 'Contact Luster support' })).toHaveAttribute('href', 'mailto:support@lustergel.app');
  await expect(page.getByRole('button', { name: 'Continue securely' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry business setup' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as FixtureWindow).accountRecoveryFixture.counts())).toMatchObject({ password: 1, finalize: 1, activation: 0 });
  expect(requests).toEqual([]);

  await page.evaluate(() => (window as FixtureWindow).accountRecoveryFixture.settleFinalize());
  const action = page.getByRole('button', { name: 'Continue securely' });

  await expect(action).toBeEnabled();

  await action.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  expect(await page.evaluate(() => (window as FixtureWindow).accountRecoveryFixture.counts())).toMatchObject({
    password: 1,
    finalize: 1,
    activation: 1,
    activationKeys: ['navigate', 'session'],
    activationSession: 'fixture-recovery-session',
    currentSessionId: 'fixture-recovery-session',
    currentOrganizationId: 'fixture-existing-org',
  });
  expect(requests).toEqual([]);

  await page.evaluate(() => (window as FixtureWindow).accountRecoveryFixture.completeActivation());

  await expect(page).toHaveURL(/\?claim=1&scenario=finalization-recovery&fixtureDecorated=1$/u);
  await expect(page.getByRole('heading', { name: 'Your progress is saved' })).toBeVisible();

  expect(requests).toEqual(['/api/onboarding/v1/claim', '/api/onboarding/v1/media/verify']);
  expect(submitted()).not.toBeNull();
  expect(submitted()!.snapshot.profile.businessName).toBe(draft.content.profile.businessName);
  expect(submitted()!.snapshot.site.builderDocument?.siteId).toBe(draft.document.siteId);
  expect(submitted()!.snapshot.site.builderDocument?.pages.map(({ id, sections }) => ({ id, sections: sections.map(({ id, sectionType }) => ({ id, sectionType })) })))
    .toEqual(draft.document.pages.map(({ id, sections }: { id: string; sections: { id: string; sectionType: string }[] }) => ({ id, sections: sections.map(({ id, sectionType }) => ({ id, sectionType })) })));
  expect(await readDraft(page)).toEqual(draft);
  expect(await page.evaluate(() => (window as FixtureWindow).accountRecoveryFixture.counts())).toMatchObject({ password: 1, finalize: 1, activation: 1 });
});

test('replacement session fences a late finalization callback without provisioning', async ({ page }) => {
  const { requests } = await prepare(page);
  const draft = await readDraft(page);
  await page.evaluate(() => {
    (window as FixtureWindow).accountRecoveryFixture.replaceSession();
    (window as FixtureWindow).accountRecoveryFixture.invokeStaleNavigate();
    (window as FixtureWindow).accountRecoveryFixture.settleFinalize();
  });
  await page.evaluate(() => (window as FixtureWindow).accountRecoveryFixture.invokeStaleNavigate());

  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  await expect(page).toHaveURL(/\?account=1&scenario=finalization-recovery$/u);
  expect(await page.evaluate(() => (window as FixtureWindow).accountRecoveryFixture.counts())).toMatchObject({ password: 1, finalize: 1, activation: 0, currentSessionId: 'fixture-replacement-session' });
  expect(requests).toEqual([]);
  expect(await readDraft(page)).toEqual(draft);
});
