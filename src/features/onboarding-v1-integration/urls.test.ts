import { describe, expect, it } from 'vitest';

import { getOnboardingDashboardHandoffUrl } from './urls';

describe('onboarding publication handoff', () => {
  it.each(['en', 'fr'])('opens the dashboard after verified publication (%s)', (locale) => {
    const destination = new URL(getOnboardingDashboardHandoffUrl({ locale, salonSlug: 'my-studio', siteId: 'saved-site', planIntent: 'founding_interest' }), 'https://www.lustergel.app');

    expect(destination.pathname).toBe(`/${locale}/admin`);
    expect(Object.fromEntries(destination.searchParams)).toEqual({ onboarding: 'complete', salon: 'my-studio', site: 'saved-site', planIntent: 'founding_interest' });
  });

  it('encodes the saved site and salon without accepting a different destination', () => {
    const destination = new URL(getOnboardingDashboardHandoffUrl({ locale: '//elsewhere', salonSlug: 'studio&salon=other', siteId: 'site?private', planIntent: 'founding_interest' }), 'https://www.lustergel.app');

    expect(destination.pathname).toBe('/en/admin');
    expect(destination.searchParams.getAll('salon')).toEqual(['studio&salon=other']);
    expect(destination.searchParams.get('site')).toBe('site?private');
  });
});
