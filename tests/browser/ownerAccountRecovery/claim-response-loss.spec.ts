import { expect, test } from '@playwright/test';

import type { OnboardingClaimSuccess, OnboardingDraftClaimRequest } from '@/features/onboarding-v1-integration/contracts';
import { ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY } from '@/features/onboarding-v1-integration/flow-storage';
import { fingerprintOnboardingPayload } from '@/features/onboarding-v1-integration/payload-fingerprint';

for (const outcome of ['saved', 'missing', 'other-owner'] as const) {
  test(`lost claim response reconciles only its saved resource: ${outcome}`, async ({ page }) => {
    const requests: string[] = [];
    let submitted: OnboardingDraftClaimRequest | null = null;
    let saved: OnboardingClaimSuccess | null = null;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:3186') {
        await route.abort();
        return;
      }
      if (url.pathname.startsWith('/en/admin/website/preview/')) {
        // The saved-site iframe is a separate page, not another harness mount.
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
        // Synthetic server-side state is recorded before the reply is lost.
        // This exercises real browser fetch, not real database persistence.
        saved = outcome === 'missing'
          ? null
          : {
              claimId: 'fixture-claim',
              created: true,
              dashboardUrl: '/en/admin',
              media: { failed: 0, pending: 0, ready: 0 },
              ownerCreatedServiceIds: [],
              payloadFingerprint: fingerprintOnboardingPayload(submitted.snapshot),
              revision: 1,
              revisionId: 'fixture-revision',
              salonId: 'fixture-salon',
              salonSlug: 'fixture-salon',
              serviceMappingIssues: [],
              serviceMenuApplied: true,
              siteId: '11111111-1111-4111-8111-111111111111',
            };
        await route.abort('failed');
        return;
      }
      if (url.pathname === '/api/onboarding/v1/status') {
        expect(submitted).not.toBeNull();
        expect(route.request().postDataJSON()).toEqual({ anonymousDraftToken: submitted!.anonymousDraftToken });

        await route.fulfill(outcome === 'other-owner'
          ? { status: 409, json: { error: { code: 'DRAFT_ALREADY_CLAIMED', message: 'This draft belongs to a different account.' } } }
          : { json: { data: { claim: saved } } });
        return;
      }
      if (url.pathname === '/api/onboarding/v1/media/verify') {
        expect(outcome).toBe('saved');
        expect(route.request().postDataJSON()).toEqual({ expected: [], siteId: saved!.siteId, siteRevision: 1 });

        await route.fulfill({ json: { data: { revision: 1 } } });
        return;
      }
      throw new Error(`Unexpected synthetic API path: ${url.pathname}`);
    });
    await page.goto('/en/onboarding-v1?account=1&scenario=claim-response-loss');

    if (outcome === 'saved') {
      await expect(page.getByRole('heading', { name: 'Your progress is saved' })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', {
        name: outcome === 'missing' ? 'We couldn’t finish saving your site' : 'This setup is connected to another account',
      })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your progress is saved' })).toHaveCount(0);
    }

    expect(requests).toEqual([
      '/api/onboarding/v1/claim',
      '/api/onboarding/v1/status',
      ...(outcome === 'saved' ? ['/api/onboarding/v1/media/verify'] : []),
    ]);

    const flow = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), ONBOARDING_INTEGRATION_FLOW_STORAGE_KEY);

    expect(flow.claimIdempotencyKey).toBe(submitted!.idempotencyKey);
    expect(flow.savedSite?.siteId ?? null).toBe(outcome === 'saved' ? saved!.siteId : null);

    if (outcome === 'saved') {
      await page.getByRole('button', { name: 'Continue setting up', exact: true }).click();

      await expect(page.locator('#booking-preferences-heading')).toBeVisible();
      expect(requests).toEqual([
        '/api/onboarding/v1/claim',
        '/api/onboarding/v1/status',
        '/api/onboarding/v1/media/verify',
      ]);
    }
  });
}
