import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAppointmentManageUrl, buildAppointmentRescheduleUrl } from './appointmentManageUrl';

// Never a real capability. Anything that looks like one in a snapshot or a log
// is a bug, so the fixture is deliberately obvious.
const PLACEHOLDER_TOKEN = 'TEST_TOKEN_NOT_A_REAL_CAPABILITY';

describe('buildAppointmentManageUrl', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://booking.example.com';
    delete process.env.LUSTER_ROOT_DOMAIN;
    delete process.env.TENANT_SUBDOMAINS_ENABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds the locale/slug route on the configured public origin', () => {
    expect(buildAppointmentManageUrl({ slug: 'isla-nail-studio1' }, PLACEHOLDER_TOKEN))
      .toBe(`https://booking.example.com/en/isla-nail-studio1/manage/${PLACEHOLDER_TOKEN}`);
  });

  it('uses the salon custom domain host-relatively when one is configured', () => {
    expect(buildAppointmentManageUrl(
      { slug: 'isla-nail-studio1', customDomain: 'islanailsalon.com' },
      PLACEHOLDER_TOKEN,
    )).toBe(`https://islanailsalon.com/manage/${PLACEHOLDER_TOKEN}`);
  });

  it('uses the tenant subdomain host when subdomains are enabled', () => {
    process.env.LUSTER_ROOT_DOMAIN = 'lusterstudio.ca';
    process.env.TENANT_SUBDOMAINS_ENABLED = 'true';

    expect(buildAppointmentManageUrl({ slug: 'isla-nail-studio1' }, PLACEHOLDER_TOKEN))
      .toBe(`https://isla-nail-studio1.lusterstudio.ca/manage/${PLACEHOLDER_TOKEN}`);
  });

  it('percent-encodes the token so no link can be truncated by a stray character', () => {
    expect(buildAppointmentManageUrl({ slug: 'salon-a' }, 'abc/def+ghi'))
      .toBe('https://booking.example.com/en/salon-a/manage/abc%2Fdef%2Bghi');
  });

  it('honors a non-default locale', () => {
    expect(buildAppointmentManageUrl({ slug: 'salon-a' }, PLACEHOLDER_TOKEN, 'fr'))
      .toBe(`https://booking.example.com/fr/salon-a/manage/${PLACEHOLDER_TOKEN}`);
  });

  it('derives the reschedule deep-link from the same shape', () => {
    expect(buildAppointmentRescheduleUrl({ slug: 'salon-a' }, PLACEHOLDER_TOKEN))
      .toBe(`https://booking.example.com/en/salon-a/manage/${PLACEHOLDER_TOKEN}/reschedule`);
  });

  it('never falls back to the public booking homepage', () => {
    const url = buildAppointmentManageUrl({ slug: 'salon-a' }, PLACEHOLDER_TOKEN);

    expect(url).toContain('/manage/');
    expect(url).not.toMatch(/\/book(\/|$)/);
  });
});
