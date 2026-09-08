import { describe, expect, it } from 'vitest';

import { ONBOARDING_STYLE_ROLES } from '../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/preview/OnboardingSitePreview';
import { CUSTOMER_SITE_STYLE_PRESETS, CUSTOMER_SITE_STYLE_ROLES } from './customerSitePresentation';

/**
 * Onboarding and the published site each keep a style table, and for a while
 * they disagreed: the published page got six distinct typefaces while setup
 * still described all six in two. An owner choosing "Luxury" during setup saw
 * the same serif as "Modern", then got something else once the site went live.
 *
 * The tables stay separate — onboarding carries its own colours per style,
 * the published site takes colour from a palette — but the typography has one
 * source, and this is what keeps it that way.
 */
describe('onboarding and published typography agree', () => {
  it('uses the published preset typefaces for every style', () => {
    for (const preset of CUSTOMER_SITE_STYLE_PRESETS) {
      const onboarding = ONBOARDING_STYLE_ROLES[preset];
      const published = CUSTOMER_SITE_STYLE_ROLES[preset];

      expect(onboarding.headingFont, `${preset} heading`).toBe(published.headingFont);
      expect(onboarding.bodyFont, `${preset} body`).toBe(published.bodyFont);
    }
  });

  it('still gives every onboarding style its own display face', () => {
    // The defect this whole change exists to prevent: six style cards that
    // describe six looks while spending the same two faces between them.
    const headings = CUSTOMER_SITE_STYLE_PRESETS.map(
      preset => ONBOARDING_STYLE_ROLES[preset].headingFont,
    );

    expect(new Set(headings).size).toBe(CUSTOMER_SITE_STYLE_PRESETS.length);
  });

  it('covers exactly the published preset set, with no extra or missing style', () => {
    expect(Object.keys(ONBOARDING_STYLE_ROLES).sort())
      .toEqual([...CUSTOMER_SITE_STYLE_PRESETS].sort());
  });
});
