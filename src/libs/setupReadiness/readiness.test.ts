/**
 * A1-3 Piece 1 — the pure derivation matrix.
 *
 * Every code is turned on AND off from a single finished-salon baseline, so a
 * rule that fired unconditionally would break `the finished baseline` case and
 * a rule that never fired would break its own case.
 *
 * `server-only` and `@/libs/DB` are mocked only so the real
 * `bookingPageConfig` / `bookingPageContent` default factories can be
 * imported (the same pattern as `bookingPageConfig.test.ts`); nothing here
 * touches a database, and `deriveSetupReadiness` itself imports neither.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { type BookingPageConfig, createDefaultBookingPageConfig } from '@/libs/bookingPageConfig';
import { type BookingPageContent, createDefaultBookingPageContent } from '@/libs/bookingPageContent';
import type { DepositPolicyInactiveReason } from '@/libs/depositPolicy';
import { getStarterTemplates } from '@/libs/serviceTemplateCatalog';

import { deriveSetupReadiness } from './readiness';
import {
  baseReadinessInput,
  FIXED_NOW,
  OPEN_WEEKDAY_HOURS,
  WORKING_WEEKLY_SCHEDULE,
} from './readinessFixtures';
import {
  READINESS_CODES,
  READINESS_LINK_KEYS,
  type ReadinessCode,
  type SetupReadinessInput,
  type SetupReadinessResult,
} from './types';

/* eslint-enable import/first */

function readyConfig(): BookingPageConfig {
  const config = createDefaultBookingPageConfig();
  config.draft.quickBookProfile.showBio = true;
  config.live.quickBookProfile.showBio = true;
  return config;
}

function readyContent(): BookingPageContent {
  const content = createDefaultBookingPageContent();
  content.draft.bio = 'Builder gel, structured and long-wearing.';
  content.live.bio = 'Builder gel, structured and long-wearing.';
  return content;
}

function input(overrides: Partial<SetupReadinessInput> = {}): SetupReadinessInput {
  return baseReadinessInput(
    {
      bookingConfig: resolveBookingConfigFromSettings(null),
      bookingPageConfig: readyConfig(),
      bookingPageContent: readyContent(),
    },
    overrides,
  );
}

function codes(result: SetupReadinessResult): ReadinessCode[] {
  return result.items.map(item => item.code);
}

function itemFor(result: SetupReadinessResult, code: ReadinessCode) {
  return result.items.find(item => item.code === code);
}

// =============================================================================
// BASELINE
// =============================================================================

describe('deriveSetupReadiness — the finished baseline', () => {
  it('reports nothing for a salon with every rule satisfied', () => {
    const result = deriveSetupReadiness(input());

    expect(result.items).toEqual([]);
  });

  it('projects the salon block and what customers see', () => {
    const result = deriveSetupReadiness(input());

    expect(result.salon).toEqual({
      name: 'Isla Nail Studio',
      publicationStatus: 'published',
      timezone: 'America/Toronto',
      businessMode: 'solo',
      technicianCount: 1,
    });
    expect(result.customersWillSee).toEqual({
      side: 'live',
      layoutId: 'quick_book',
      rendersBio: true,
      activeServiceCount: 2,
      publiclyBookableServiceCount: 2,
      openDays: ['monday', 'tuesday'],
    });
    expect(result.computedAt).toBe(FIXED_NOW.toISOString());
  });

  it('counts every active service as bookable under the legacy unrestricted model', () => {
    const result = deriveSetupReadiness(input({ publiclyBookableServiceIds: null }));

    expect(result.customersWillSee?.publiclyBookableServiceCount).toBe(2);
  });

  it('omits an open day the salon has no staff for from openDays', () => {
    const result = deriveSetupReadiness(input({
      technicians: [{ id: 'tech_1', weeklySchedule: { monday: { start: '09:00', end: '17:00' } } }],
    }));

    expect(result.customersWillSee?.openDays).toEqual(['monday']);
  });

  it('omits a staffed day the salon is closed on from openDays', () => {
    const result = deriveSetupReadiness(input({
      hoursCeiling: {
        locationId: null,
        businessHours: { monday: { open: '09:00', close: '17:00' } },
        source: 'salon',
      },
    }));

    expect(result.customersWillSee?.openDays).toEqual(['monday']);
  });

  it('falls back to the technician schedule alone when there is no hours ceiling', () => {
    const result = deriveSetupReadiness(input({
      hoursCeiling: { locationId: null, businessHours: null, source: 'none' },
    }));

    expect(result.customersWillSee?.openDays).toEqual(['monday', 'tuesday']);
  });
});

// =============================================================================
// PUBLICATION / SERVICES / TECHNICIANS
// =============================================================================

describe('deriveSetupReadiness — publication', () => {
  it('reports not_published for a draft salon', () => {
    const result = deriveSetupReadiness(input({
      salon: { name: 'Isla Nail Studio', publicationStatus: 'draft' },
    }));

    expect(codes(result)).toContain('not_published');
    expect(itemFor(result, 'not_published')?.severity).toBe('required');
    expect(itemFor(result, 'not_published')?.links).toEqual([
      { key: 'page_publish', label: 'Publish' },
    ]);
  });

  it('reads the draft config side for an unpublished salon, and says so', () => {
    const config = readyConfig();
    config.draft.layout = 'editorial';

    const result = deriveSetupReadiness(input({
      salon: { name: 'Isla Nail Studio', publicationStatus: 'draft' },
      bookingPageConfig: config,
    }));

    expect(result.customersWillSee?.layoutId).toBe('editorial');
    // The discriminator is what lets a consumer say "your DRAFT page shows…"
    // instead of claiming a customer can see any of this today.
    expect(result.customersWillSee?.side).toBe('draft');
  });

  it('marks the side live for a published salon and ignores its draft edits', () => {
    const config = readyConfig();
    config.draft.layout = 'editorial';

    const result = deriveSetupReadiness(input({ bookingPageConfig: config }));

    expect(result.customersWillSee?.side).toBe('live');
    expect(result.customersWillSee?.layoutId).toBe('quick_book');
  });
});

describe('deriveSetupReadiness — services', () => {
  it('reports no_active_services when every service is deactivated', () => {
    const result = deriveSetupReadiness(input({
      services: [
        { id: 'svc_1', name: 'Builder gel full set', isActive: false, templateKey: null, price: 9500 },
        { id: 'svc_2', name: 'Gel refill', isActive: null, templateKey: null, price: 7500 },
      ],
      publiclyBookableServiceIds: new Set<string>(),
    }));

    expect(codes(result)).toContain('no_active_services');
    expect(result.customersWillSee?.activeServiceCount).toBe(0);
  });

  it('reports services_not_bookable with a capped, counted name sample', () => {
    const services = Array.from({ length: 12 }, (_, index) => ({
      id: `svc_${index}`,
      name: `Service ${index}`,
      isActive: true,
      templateKey: null,
      price: 5000,
    }));

    const result = deriveSetupReadiness(input({
      services,
      publiclyBookableServiceIds: new Set<string>(['svc_0']),
    }));

    const item = itemFor(result, 'services_not_bookable');

    expect(item?.severity).toBe('required');
    expect(item?.detail?.count).toBe(11);
    expect(item?.detail?.serviceNames).toHaveLength(10);
    expect(item?.detail?.serviceNames?.[0]).toBe('Service 1');
    expect(item?.links).toEqual([{ key: 'team', label: 'Team' }]);
  });

  it('reports nothing when the salon is on the legacy unrestricted model', () => {
    const result = deriveSetupReadiness(input({ publiclyBookableServiceIds: null }));

    expect(codes(result)).not.toContain('services_not_bookable');
  });

  it('reports services_at_library_prices only for a template price left untouched', () => {
    const template = getStarterTemplates()[0]!;
    const result = deriveSetupReadiness(input({
      services: [
        {
          id: 'svc_1',
          name: template.name,
          isActive: true,
          templateKey: template.systemKey,
          price: template.defaultPriceCents,
        },
        {
          id: 'svc_2',
          name: 'Repriced',
          isActive: true,
          templateKey: template.systemKey,
          price: template.defaultPriceCents + 500,
        },
        { id: 'svc_3', name: 'Unknown template', isActive: true, templateKey: 'no_such_template', price: 1 },
      ],
      publiclyBookableServiceIds: new Set(['svc_1', 'svc_2', 'svc_3']),
    }));

    const item = itemFor(result, 'services_at_library_prices');

    expect(item?.severity).toBe('recommended');
    expect(item?.detail).toEqual({ count: 1, serviceNames: [template.name] });
    expect(item?.links).toEqual([{ key: 'services', label: 'Services' }]);
  });
});

describe('deriveSetupReadiness — technicians and the one suppression', () => {
  it('reports no_active_technician and SUPPRESSES services_not_bookable', () => {
    const result = deriveSetupReadiness(input({
      technicians: [],
      // Exactly what getPublicBookableServiceIds returns with no active
      // technician: an empty set, i.e. every service unbookable.
      publiclyBookableServiceIds: new Set<string>(),
    }));

    expect(codes(result)).toContain('no_active_technician');
    expect(codes(result)).not.toContain('services_not_bookable');
  });

  it('still reports services_not_bookable when a technician exists', () => {
    const result = deriveSetupReadiness(input({
      publiclyBookableServiceIds: new Set<string>(),
    }));

    expect(codes(result)).toContain('services_not_bookable');
    expect(codes(result)).not.toContain('no_active_technician');
  });

  it('reports technician_no_weekly_days as required for a technician with no days', () => {
    const result = deriveSetupReadiness(input({
      technicians: [{ id: 'tech_1', weeklySchedule: null }],
    }));

    const item = itemFor(result, 'technician_no_weekly_days');

    expect(item?.severity).toBe('required');
    expect(item?.detail).toEqual({ count: 1 });
  });

  it('accepts the legacy workDays/startTime/endTime shape as a weekly schedule', () => {
    const result = deriveSetupReadiness(input({
      technicians: [{ id: 'tech_1', workDays: [1, 2], startTime: '09:00', endTime: '17:00' }],
    }));

    expect(codes(result)).not.toContain('technician_no_weekly_days');
    expect(result.customersWillSee?.openDays).toEqual(['monday', 'tuesday']);
  });

  it('downgrades to recommended when every schedule-less technician runs on overrides', () => {
    const result = deriveSetupReadiness(input({
      technicians: [{ id: 'tech_1', weeklySchedule: null }],
      scheduleOverridesEntitled: true,
      technicianIdsWithUpcomingHoursOverrides: new Set(['tech_1']),
      hoursCeiling: { locationId: null, businessHours: null, source: 'none' },
    }));

    const item = itemFor(result, 'technician_no_weekly_days');

    expect(item?.severity).toBe('recommended');
    expect(item?.detail).toEqual({ count: 1, reason: 'overrides_present' });
  });

  it('keeps required when the salon lacks the scheduleOverrides entitlement', () => {
    const result = deriveSetupReadiness(input({
      technicians: [{ id: 'tech_1', weeklySchedule: null }],
      scheduleOverridesEntitled: false,
      technicianIdsWithUpcomingHoursOverrides: new Set(['tech_1']),
    }));

    expect(itemFor(result, 'technician_no_weekly_days')?.severity).toBe('required');
  });

  it('keeps required when only SOME schedule-less technicians have overrides', () => {
    const result = deriveSetupReadiness(input({
      technicians: [
        { id: 'tech_1', weeklySchedule: null },
        { id: 'tech_2', weeklySchedule: null },
      ],
      scheduleOverridesEntitled: true,
      technicianIdsWithUpcomingHoursOverrides: new Set(['tech_1']),
    }));

    const item = itemFor(result, 'technician_no_weekly_days');

    expect(item?.severity).toBe('required');
    expect(item?.detail).toEqual({ count: 1 });
  });
});

// =============================================================================
// HOURS AND BOOKING RULES
// =============================================================================

describe('deriveSetupReadiness — hours and booking rules', () => {
  it('reports hours_days_without_staff for every open day nobody works', () => {
    const result = deriveSetupReadiness(input({
      hoursCeiling: {
        locationId: 'loc_1',
        businessHours: {
          ...OPEN_WEEKDAY_HOURS,
          saturday: { open: '10:00', close: '15:00' },
          sunday: { open: '10:00', close: '15:00' },
        },
        source: 'location',
      },
    }));

    const item = itemFor(result, 'hours_days_without_staff');

    expect(item?.severity).toBe('recommended');
    expect(item?.detail).toEqual({ count: 2, days: ['sunday', 'saturday'] });
    expect(item?.links).toEqual([{ key: 'business_hours', label: 'Business hours' }]);
  });

  it('reports no_business_hours when the ceiling resolves to none', () => {
    const result = deriveSetupReadiness(input({
      hoursCeiling: { locationId: null, businessHours: null, source: 'none' },
    }));

    expect(itemFor(result, 'no_business_hours')?.severity).toBe('optional');
    expect(codes(result)).not.toContain('hours_days_without_staff');
  });

  it('does not report minimum_notice_high exactly at the seven-day ceiling', () => {
    const bookingConfig = resolveBookingConfigFromSettings({
      booking: { minimumNoticeMinutes: 7 * 24 * 60 },
    });
    const result = deriveSetupReadiness(input({ bookingConfig }));

    expect(codes(result)).not.toContain('minimum_notice_high');
  });

  it('reports minimum_notice_high one minute past the ceiling', () => {
    const bookingConfig = resolveBookingConfigFromSettings({
      booking: { minimumNoticeMinutes: 7 * 24 * 60 + 1 },
    });
    const result = deriveSetupReadiness(input({ bookingConfig }));

    const item = itemFor(result, 'minimum_notice_high');

    expect(item?.severity).toBe('recommended');
    // No detail: `count` is contractually a count of rows, never a minutes value.
    expect(item?.detail).toBeUndefined();
    expect(item?.links).toEqual([{ key: 'booking_rules', label: 'Booking rules' }]);
  });
});

// =============================================================================
// DEPOSITS
// =============================================================================

describe('deriveSetupReadiness — the deposits reason matrix', () => {
  const blocking: DepositPolicyInactiveReason[] = [
    'account_not_connected',
    'account_not_charge_ready',
    'readiness_never_synced',
    'undetermined',
  ];
  const silent: DepositPolicyInactiveReason[] = [
    'collection_not_live',
    'not_entitled',
    'not_configured',
    'disabled',
    'currency_unsupported',
  ];

  it.each(blocking)('reports deposits_not_ready as required for %s', (reason) => {
    const result = deriveSetupReadiness(input({
      depositPolicy: { active: false, reason, readinessStale: true },
    }));

    const item = itemFor(result, 'deposits_not_ready');

    expect(item?.severity).toBe('required');
    expect(item?.detail).toEqual({ reason, stale: true });
    expect(item?.links).toEqual([{ key: 'payments', label: 'Payments' }]);
  });

  it.each(silent)('reports no deposits item for %s', (reason) => {
    const result = deriveSetupReadiness(input({
      depositPolicy: { active: false, reason, readinessStale: false },
    }));

    expect(codes(result)).not.toContain('deposits_not_ready');
  });

  it('mirrors a non-stale readiness flag', () => {
    const result = deriveSetupReadiness(input({
      depositPolicy: { active: false, reason: 'account_not_connected', readinessStale: false },
    }));

    expect(itemFor(result, 'deposits_not_ready')?.detail).toEqual({
      reason: 'account_not_connected',
      stale: false,
    });
  });

  it('reports severity ready when the policy is active', () => {
    const result = deriveSetupReadiness(input({
      depositPolicy: { active: true, reason: null, readinessStale: false },
    }));

    const item = itemFor(result, 'deposits_not_ready');

    expect(item?.severity).toBe('ready');
    expect(item?.detail).toBeUndefined();
  });

  // The 9-member union is a cross-packet contract; if a member is ever added
  // this test fails rather than letting an unclassified reason fall silent.
  it('classifies every member of the inactive-reason union', () => {
    expect([...blocking, ...silent].sort()).toEqual([
      'account_not_charge_ready',
      'account_not_connected',
      'collection_not_live',
      'currency_unsupported',
      'disabled',
      'not_configured',
      'not_entitled',
      'readiness_never_synced',
      'undetermined',
    ]);
  });
});

// =============================================================================
// INTRO / BIO
// =============================================================================

describe('deriveSetupReadiness — the intro', () => {
  it('reports intro_empty when the draft has neither a bio nor a specialty line', () => {
    const content = readyContent();
    content.draft.bio = null;
    content.live.bio = null;

    const result = deriveSetupReadiness(input({ bookingPageContent: content }));

    expect(itemFor(result, 'intro_empty')?.severity).toBe('recommended');
    expect(itemFor(result, 'intro_empty')?.links).toEqual([
      { key: 'page_text', label: 'Page text' },
    ]);
  });

  it('accepts a specialty line alone as an intro', () => {
    const content = readyContent();
    content.draft.bio = null;
    content.live.bio = null;
    content.draft.specialtyLine = 'Builder gel specialist';
    content.live.specialtyLine = 'Builder gel specialist';

    const result = deriveSetupReadiness(input({ bookingPageContent: content }));

    expect(codes(result)).not.toContain('intro_empty');
  });

  it('treats whitespace as empty', () => {
    const content = readyContent();
    content.draft.bio = '   ';
    content.live.bio = '   ';

    const result = deriveSetupReadiness(input({ bookingPageContent: content }));

    expect(codes(result)).toContain('intro_empty');
    expect(codes(result)).not.toContain('intro_hidden_by_visibility');
  });

  it('reports intro_hidden_by_visibility when Quick Book has showBio off', () => {
    const config = readyConfig();
    config.live.quickBookProfile.showBio = false;

    const result = deriveSetupReadiness(input({ bookingPageConfig: config }));

    const item = itemFor(result, 'intro_hidden_by_visibility');

    expect(item?.severity).toBe('recommended');
    expect(item?.links).toEqual([{ key: 'page_information', label: 'Page information' }]);
    expect(result.customersWillSee?.rendersBio).toBe(false);
  });

  it('reports nothing when Quick Book has showBio on', () => {
    const result = deriveSetupReadiness(input());

    expect(codes(result)).not.toContain('intro_hidden_by_visibility');
    expect(result.customersWillSee?.rendersBio).toBe(true);
  });

  it('reports intro_not_rendered_by_layout for a non-Quick-Book layout', () => {
    const config = readyConfig();
    config.live.layout = 'editorial';

    const result = deriveSetupReadiness(input({ bookingPageConfig: config }));

    const item = itemFor(result, 'intro_not_rendered_by_layout');

    expect(item?.severity).toBe('recommended');
    expect(item?.links).toEqual([
      { key: 'page_layouts', label: 'Page layouts' },
      { key: 'team_members', label: 'Team members' },
    ]);
    expect(result.customersWillSee?.rendersBio).toBe(false);
    expect(codes(result)).not.toContain('intro_hidden_by_visibility');
  });
});

// =============================================================================
// DRAFT VS LIVE
// =============================================================================

describe('deriveSetupReadiness — unpublished draft changes', () => {
  it('reports draft_unpublished_changes when the config sides differ', () => {
    const config = readyConfig();
    config.draft.layout = 'editorial';

    const result = deriveSetupReadiness(input({ bookingPageConfig: config }));

    expect(itemFor(result, 'draft_unpublished_changes')?.severity).toBe('recommended');
    expect(itemFor(result, 'draft_unpublished_changes')?.links).toEqual([
      { key: 'page_publish', label: 'Publish' },
    ]);
  });

  it('reports draft_unpublished_changes when only the content sides differ', () => {
    const content = readyContent();
    content.draft.specialtyLine = 'New copy';

    const result = deriveSetupReadiness(input({ bookingPageContent: content }));

    expect(codes(result)).toContain('draft_unpublished_changes');
  });

  it('reports nothing for an unpublished salon, however different the sides are', () => {
    const config = readyConfig();
    config.draft.layout = 'editorial';

    const result = deriveSetupReadiness(input({
      salon: { name: 'Isla Nail Studio', publicationStatus: 'draft' },
      bookingPageConfig: config,
    }));

    expect(codes(result)).not.toContain('draft_unpublished_changes');
  });
});

// =============================================================================
// INTEGRATIONS
// =============================================================================

describe('deriveSetupReadiness — integrations', () => {
  it('reports google_not_connected only for the not_connected readiness', () => {
    const result = deriveSetupReadiness(input({
      integrations: { googleReadiness: 'not_connected', stripeConnectStatus: 'charge_ready' },
    }));

    expect(itemFor(result, 'google_not_connected')?.severity).toBe('optional');
    expect(itemFor(result, 'google_not_connected')?.links).toEqual([
      { key: 'integrations', label: 'Integrations' },
    ]);
  });

  it('does not treat a reconnect-required Google connection as not connected', () => {
    const result = deriveSetupReadiness(input({
      integrations: { googleReadiness: 'reconnect_required', stripeConnectStatus: 'charge_ready' },
    }));

    expect(codes(result)).not.toContain('google_not_connected');
  });

  it('reports payments_not_connected for an unbound Stripe account', () => {
    const result = deriveSetupReadiness(input({
      integrations: { googleReadiness: 'ready', stripeConnectStatus: 'not_connected' },
    }));

    expect(itemFor(result, 'payments_not_connected')?.severity).toBe('optional');
    expect(itemFor(result, 'payments_not_connected')?.links).toEqual([
      { key: 'payments', label: 'Payments' },
    ]);
  });
});

// =============================================================================
// ORDERING AND LINK KEYS
// =============================================================================

describe('deriveSetupReadiness — ordering and links', () => {
  function worstCase(): SetupReadinessResult {
    const config = readyConfig();
    config.draft.layout = 'editorial';
    config.live.layout = 'editorial';
    const content = readyContent();
    content.draft.specialtyLine = 'New copy';

    return deriveSetupReadiness(input({
      salon: { name: 'Isla Nail Studio', publicationStatus: 'published' },
      bookingPageConfig: config,
      bookingPageContent: content,
      bookingConfig: resolveBookingConfigFromSettings({
        booking: { minimumNoticeMinutes: 20_000 },
      }),
      services: [],
      technicians: [{ id: 'tech_1', weeklySchedule: null }],
      publiclyBookableServiceIds: new Set<string>(),
      hoursCeiling: { locationId: null, businessHours: null, source: 'none' },
      depositPolicy: {
        active: false,
        reason: 'account_not_charge_ready',
        readinessStale: false,
      },
      integrations: { googleReadiness: 'not_connected', stripeConnectStatus: 'not_connected' },
    }));
  }

  it('orders required, then recommended, then optional, then ready', () => {
    const result = worstCase();
    const severities = result.items.map(item => item.severity);
    const rank = ['required', 'recommended', 'optional', 'ready'];

    expect(severities.map(severity => rank.indexOf(severity))).toEqual(
      [...severities.map(severity => rank.indexOf(severity))].sort((a, b) => a - b),
    );
  });

  it('orders codes within a severity band by the declared code order', () => {
    const result = worstCase();
    const seen = codes(result);
    const bySeverity = new Map(result.items.map(item => [item.code, item.severity]));

    for (const severity of ['required', 'recommended', 'optional', 'ready']) {
      const band = seen.filter(code => bySeverity.get(code) === severity);
      const ranks = band.map(code => READINESS_CODES.indexOf(code));

      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('emits at most one item per code', () => {
    const seen = codes(worstCase());

    expect(new Set(seen).size).toBe(seen.length);
  });

  it('emits only registry link keys, on every item', () => {
    const allowed = new Set<string>(READINESS_LINK_KEYS);
    const result = worstCase();

    expect(result.items.length).toBeGreaterThan(0);

    for (const item of result.items) {
      expect(item.links.length).toBeGreaterThan(0);

      for (const link of item.links) {
        expect(allowed.has(link.key)).toBe(true);
        expect(link.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('emits only declared codes', () => {
    const declared = new Set<string>(READINESS_CODES);

    for (const code of codes(worstCase())) {
      expect(declared.has(code)).toBe(true);
    }
  });
});

// =============================================================================
// COVERAGE OF THE CODE LIST
// =============================================================================

describe('deriveSetupReadiness — every declared code is reachable', () => {
  it('produces each code from at least one fixture', () => {
    const produced = new Set<ReadinessCode>();
    const config = readyConfig();
    config.draft.layout = 'editorial';
    config.live.layout = 'editorial';
    const content = readyContent();
    content.draft.specialtyLine = 'New copy';
    const template = getStarterTemplates()[0]!;

    const scenarios: SetupReadinessInput[] = [
      input({ salon: { name: 'Isla', publicationStatus: 'draft' } }),
      input({ services: [], publiclyBookableServiceIds: new Set<string>() }),
      input({ publiclyBookableServiceIds: new Set<string>() }),
      input({ technicians: [], publiclyBookableServiceIds: new Set<string>() }),
      input({ technicians: [{ id: 'tech_1', weeklySchedule: null }] }),
      input({
        technicians: [{ id: 'tech_1', weeklySchedule: { monday: { start: '09:00', end: '17:00' } } }],
      }),
      input({ hoursCeiling: { locationId: null, businessHours: null, source: 'none' } }),
      input({
        bookingConfig: resolveBookingConfigFromSettings({ booking: { minimumNoticeMinutes: 20_000 } }),
      }),
      input({
        depositPolicy: { active: false, reason: 'undetermined', readinessStale: false },
      }),
      input({ depositPolicy: { active: true, reason: null, readinessStale: false } }),
      input({ bookingPageContent: createDefaultBookingPageContent() }),
      input({ bookingPageConfig: createDefaultBookingPageConfig() }),
      input({ bookingPageConfig: config, bookingPageContent: content }),
      input({
        services: [{
          id: 'svc_1',
          name: template.name,
          isActive: true,
          templateKey: template.systemKey,
          price: template.defaultPriceCents,
        }],
        publiclyBookableServiceIds: new Set(['svc_1']),
      }),
      input({
        integrations: { googleReadiness: 'not_connected', stripeConnectStatus: 'not_connected' },
      }),
    ];

    for (const scenario of scenarios) {
      for (const code of codes(deriveSetupReadiness(scenario))) {
        produced.add(code);
      }
    }

    expect([...READINESS_CODES].filter(code => !produced.has(code))).toEqual([]);
  });

  it('keeps the baseline fixture free of every code', () => {
    const baseline = deriveSetupReadiness(input({
      hoursCeiling: { locationId: null, businessHours: OPEN_WEEKDAY_HOURS, source: 'salon' },
      technicians: [{ id: 'tech_1', weeklySchedule: WORKING_WEEKLY_SCHEDULE }],
    }));

    expect(codes(baseline)).toEqual([]);
  });
});
