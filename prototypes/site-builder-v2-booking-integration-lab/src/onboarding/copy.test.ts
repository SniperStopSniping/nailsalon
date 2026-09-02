import { describe, expect, it } from 'vitest';

import {
  CORE_SCREEN_ORDER,
  ONBOARDING_STAGE_ORDER,
  SCREEN_METADATA,
  STARTER_ENTRY_COPY,
} from './copy';

describe('centralized onboarding metadata', () => {
  it('maps all twelve live screens to four ordered stages', () => {
    expect(CORE_SCREEN_ORDER).toHaveLength(12);
    expect(CORE_SCREEN_ORDER[0]).toBe('starter');
    expect(CORE_SCREEN_ORDER[1]).toBe('business');
    expect(CORE_SCREEN_ORDER).not.toContain('welcome');
    expect(CORE_SCREEN_ORDER).not.toContain('photo_social');
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
      'basics',
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
    expect(SCREEN_METADATA.starter.status).toBe('essential');
    expect(SCREEN_METADATA.about.status).toBe('optional');
    expect(SCREEN_METADATA.policies.status).toBe('recommended');
    expect(SCREEN_METADATA.extras.status).toBe('optional');
    expect(SCREEN_METADATA.site_style.status).toBe('essential');
  });

  it('uses the owner-reviewed nail-business copy and dashboard handoff language', () => {
    expect(SCREEN_METADATA.starter.heading).toBe('Choose your starting point');
    expect(SCREEN_METADATA.starter.supportingCopy).toBe(
      'Start simple or with a full website. You can add or change pages and sections anytime.',
    );
    expect(SCREEN_METADATA.business.heading).toBe('Let’s start with your business');
    expect(SCREEN_METADATA.site_style.heading).toBe('Choose your website style');
    expect(SCREEN_METADATA.final_preview).toMatchObject({
      primaryAction: 'Finish setup',
      secondaryAction: 'Change setup',
      supportingCopy: 'Your website is saved. You can edit it anytime from your dashboard.',
    });
    expect(STARTER_ENTRY_COPY.autosaveNote).toBe(
      'Your progress saves automatically on this device.',
    );
    expect(STARTER_ENTRY_COPY.reassurance).toBe(
      'You’ll preview your site before choosing a plan.',
    );
  });
});
