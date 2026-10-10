import { describe, expect, it } from 'vitest';

import { getOnboardingPublishReviewUrl } from './urls';

describe('onboarding publication handoff', () => {
  it.each(['en', 'fr'])('opens the website hub directly after plan claim (%s)', (locale) => {
    const destination = new URL(getOnboardingPublishReviewUrl({ locale, salonSlug: 'my-studio', siteId: 'saved-site', planIntent: 'founding_interest' }), 'https://www.lustergel.app');

    expect(destination.pathname).toBe(`/${locale}/admin/website`);
    expect(Object.fromEntries(destination.searchParams)).toEqual({ onboarding: 'complete', salon: 'my-studio', site: 'saved-site', planIntent: 'founding_interest' });
    expect(destination.searchParams.has('publish')).toBe(false);
  });

  it('encodes the saved site and salon without accepting a different destination', () => {
    const destination = new URL(getOnboardingPublishReviewUrl({ locale: '//elsewhere', salonSlug: 'studio&salon=other', siteId: 'site?private', planIntent: 'founding_interest' }), 'https://www.lustergel.app');

    expect(destination.pathname).toBe('/en/admin/website');
    expect(destination.searchParams.getAll('salon')).toEqual(['studio&salon=other']);
    expect(destination.searchParams.get('site')).toBe('site?private');
  });
});
