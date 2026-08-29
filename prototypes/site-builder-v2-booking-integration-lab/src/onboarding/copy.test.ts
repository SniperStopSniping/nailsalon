import { describe, expect, it } from 'vitest';

import {
  CORE_SCREEN_ORDER,
  ONBOARDING_STAGE_ORDER,
  SCREEN_METADATA,
} from './copy';

describe('centralized onboarding metadata', () => {
  it('maps all thirteen screens to four ordered stages', () => {
    expect(CORE_SCREEN_ORDER).toHaveLength(13);
    expect(ONBOARDING_STAGE_ORDER).toEqual([
      'basics',
      'booking',
      'design',
      'review',
    ]);
    expect(CORE_SCREEN_ORDER.map((screen) => SCREEN_METADATA[screen].stage)).toEqual([
      'basics',
      'basics',
      'basics',
      'basics',
      'booking',
      'booking',
      'booking',
      'design',
      'design',
      'design',
      'design',
      'design',
      'review',
    ]);
  });

  it('marks optional and recommended screens independently from essentials', () => {
    expect(SCREEN_METADATA.photo_social.status).toBe('optional');
    expect(SCREEN_METADATA.about.status).toBe('optional');
    expect(SCREEN_METADATA.policies.status).toBe('recommended');
    expect(SCREEN_METADATA.extras.status).toBe('optional');
    expect(SCREEN_METADATA.site_style.status).toBe('essential');
  });

  it('uses the owner-reviewed nail-business copy and dashboard handoff language', () => {
    expect(SCREEN_METADATA.welcome.supportingCopy).toBe(
      'Tell us about your nail business once. Luster will use your details to create a polished site with booking, policies, contact information, and more.',
    );
    expect(SCREEN_METADATA.business.heading).toBe('Tell us about your nail business');
    expect(SCREEN_METADATA.photo_social.heading).toBe('Add your photo and Instagram');
    expect(SCREEN_METADATA.site_style.heading).toBe('Choose your website style');
    expect(SCREEN_METADATA.final_preview).toMatchObject({
      primaryAction: 'Finish setup',
      secondaryAction: 'Change setup',
      supportingCopy: 'Your website is saved. You can edit it anytime from your dashboard.',
    });
  });
});
