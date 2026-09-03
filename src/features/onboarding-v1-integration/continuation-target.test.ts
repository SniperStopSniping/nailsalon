import { describe, expect, it } from 'vitest';

import { continuationTargetForSavedSite } from './continuation-target';

describe('continuationTargetForSavedSite', () => {
  it('updates the exact saved draft revision after the early account gate', () => {
    expect(continuationTargetForSavedSite({
      claimId: 'claim-1',
      created: true,
      dashboardUrl: '/en/admin',
      media: { failed: 0, pending: 0, ready: 0 },
      ownerCreatedServiceIds: [],
      payloadFingerprint: '0123456789abcdef',
      revision: 3,
      revisionId: 'revision-3',
      salonId: 'salon-1',
      salonSlug: 'isla-nail',
      serviceMappingIssues: [],
      serviceMenuApplied: true,
      siteId: '11111111-1111-4111-8111-111111111111',
    })).toEqual({
      continuationClaimId: 'claim-1',
      existingSiteStrategy: 'continue_onboarding_draft',
      expectedRevision: 3,
      expectedSiteId: '11111111-1111-4111-8111-111111111111',
      mode: 'existing_business',
      salonId: 'salon-1',
    });
  });

  it('leaves the initial anonymous claim untargeted', () => {
    expect(continuationTargetForSavedSite(null)).toBeUndefined();
  });
});
