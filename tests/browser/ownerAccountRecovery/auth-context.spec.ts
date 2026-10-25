import { expect, type Page, test } from '@playwright/test';

import type { OnboardingClaimSuccess, OnboardingDraftClaimRequest } from '@/features/onboarding-v1-integration/contracts';
import { fingerprintOnboardingPayload } from '@/features/onboarding-v1-integration/payload-fingerprint';

import { SITE_BUILDER_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/model/validation';
import { ONBOARDING_STORAGE_KEY } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/storage/storage';

// Real document boundary and onboarding components; identity and API outcomes are simulated.
// Clerk SDK option retention has a separate real-SDK reproduction.
type InheritedMarker = 'none' | 'loaded' | 'downloading' | 'publishable-key';

async function prepare(page: Page, marker: InheritedMarker) {
  const requests: string[] = [];
  let submitted: OnboardingDraftClaimRequest | null = null;
  await page.addInitScript((inherited: InheritedMarker) => {
    if (window !== window.top || location.origin !== 'http://127.0.0.1:3186') {
      return;
    }
    const generation = Number(sessionStorage.getItem('fixture-auth-context-generation') ?? '0') + 1;
    sessionStorage.setItem('fixture-auth-context-generation', String(generation));
    if (generation !== 1) {
      return;
    }
    if (inherited === 'loaded') {
      Object.assign(window, { Clerk: { loaded: true } });
    } else if (inherited === 'downloading') {
      const script = document.createElement('script');
      script.setAttribute('data-clerk-js-script', 'true');
      // No src: this marker never loads a provider or sends an external request.
      const target = document.head ?? document.documentElement;
      if (target) {
        target.append(script);
      } else {
        const observer = new MutationObserver(() => {
          const parent = document.head ?? document.documentElement;
          if (parent) {
            observer.disconnect();
            parent.append(script);
          }
        });
        observer.observe(document, { childList: true, subtree: true });
      }
    } else if (inherited === 'publishable-key') {
      Object.assign(window, { __clerk_publishable_key: 'pk_test_simulated_context' });
    }
  }, marker);
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
    requests.push(url.pathname);

    expect(route.request().method()).toBe('POST');

    if (url.pathname === '/api/onboarding/v1/claim') {
      submitted = route.request().postDataJSON() as OnboardingDraftClaimRequest;
      const saved: OnboardingClaimSuccess = {
        claimId: 'fixture-auth-context-claim',
        created: true,
        dashboardUrl: '/en/admin',
        media: { failed: 0, pending: 0, ready: 0 },
        ownerCreatedServiceIds: [],
        payloadFingerprint: fingerprintOnboardingPayload(submitted.snapshot),
        revision: 1,
        revisionId: 'fixture-auth-context-revision',
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
    throw new Error(`Unexpected simulated auth-context API path: ${url.pathname}`);
  });
  return { requests, submitted: () => submitted };
}

async function inspect(page: Page) {
  return page.evaluate(({ stateKey, documentKey }) => {
    const original = JSON.parse(sessionStorage.getItem('fixture-auth-context-original-draft')!) as { state: string; document: string };
    const content = (serialized: string) => {
      const { eventJournal: _journal, progress: _progress, ...draft } = JSON.parse(serialized);
      return draft;
    };
    return {
      generation: Number(sessionStorage.getItem('fixture-auth-context-generation')),
      mounts: JSON.parse(sessionStorage.getItem('fixture-auth-context-mounts') ?? '[]') as number[],
      counts: JSON.parse(sessionStorage.getItem('fixture-finalization-counts') ?? '{}'),
      original: { state: content(original.state), document: JSON.parse(original.document) },
      current: { state: content(localStorage.getItem(stateKey)!), document: JSON.parse(localStorage.getItem(documentKey)!) },
    };
  }, { stateKey: ONBOARDING_STORAGE_KEY, documentKey: SITE_BUILDER_STORAGE_KEY });
}

const cases = [
  { marker: 'none', name: 'fresh document enters without reset', readyGeneration: 1 },
  { marker: 'loaded', name: 'loaded inherited context resets once', readyGeneration: 2 },
  { marker: 'downloading', name: 'downloading inherited context resets once', readyGeneration: 2 },
  { marker: 'publishable-key', name: 'publishable-key inherited context resets once', readyGeneration: 2 },
] as const;

for (const { marker, name, readyGeneration } of cases) {
  test(`${name} in StrictMode and saves the preserved draft`, async ({ page }) => {
    const { requests, submitted } = await prepare(page, marker);
    const entry = '/en/onboarding-v1?account=1&scenario=auth-context#preserve-account';
    await page.goto(entry);

    await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
    await expect(page).toHaveURL(`http://127.0.0.1:3186${entry}`);

    const ready = await inspect(page);

    expect(ready.generation).toBe(readyGeneration);
    // StrictMode runs the child mount effect twice, but cannot cause a second reset.
    expect(ready.mounts).toEqual([readyGeneration, readyGeneration]);
    expect(ready.current).toEqual(ready.original);
    expect(requests).toEqual([]);

    await page.getByRole('button', { name: 'Continue with email' }).click();
    await page.getByLabel('Email address').fill('auth-context@example.test');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Password', { exact: true }).fill('simulated-auth-context-password');
    await page.getByRole('button', { name: 'Create account and continue' }).click();

    await expect(page).toHaveURL(/\?claim=1&scenario=auth-context&fixtureDecorated=1$/u);
    await expect(page.getByRole('heading', { name: 'Your progress is saved' })).toBeVisible();

    const saved = await inspect(page);

    // One subsequent document navigation is the normal completed-signup claim handoff.
    expect(saved.generation).toBe(readyGeneration + 1);
    expect(saved.current).toEqual(ready.original);
    expect(saved.counts).toEqual({ password: 1, finalize: 1, activation: 0 });
    expect(requests).toEqual(['/api/onboarding/v1/claim', '/api/onboarding/v1/media/verify']);
    expect(submitted()?.snapshot.profile.businessName).toBe(ready.original.state.profile.businessName);
    expect(submitted()?.snapshot.site.builderDocument?.siteId).toBe(ready.original.document.siteId);
  });
}
