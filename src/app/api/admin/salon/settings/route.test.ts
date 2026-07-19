import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { GET, PATCH } from './route';

vi.mock('server-only', () => ({}));

const {
  requireAdmin,
  logAuditEvent,
  getBookingConfigForSalon,
  resolveBookingConfigFromSettings,
  getDefaultLoyaltyPoints,
  resolveSalonLoyaltyPoints,
  getSalonBySlug,
  updatedRows,
  selectResults,
  db,
} = vi.hoisted(() => {
  const updatedRows: unknown[] = [];
  // FIFO queue of result sets for db.select(...).from(...).where(...) calls
  // (smart fit id-ownership checks: services first, then technicians).
  const selectResults: unknown[][] = [];
  return {
    requireAdmin: vi.fn(),
    logAuditEvent: vi.fn(),
    getBookingConfigForSalon: vi.fn(),
    resolveBookingConfigFromSettings: vi.fn(),
    getDefaultLoyaltyPoints: vi.fn(),
    resolveSalonLoyaltyPoints: vi.fn(),
    getSalonBySlug: vi.fn(),
    updatedRows,
    selectResults,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => updatedRows.splice(0, updatedRows.length)),
          })),
        })),
      })),
    },
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin,
}));

vi.mock('@/libs/auditLog', () => ({
  logAuditEvent,
}));

vi.mock('@/libs/bookingConfig', () => ({
  bookingConfigSchema: z.object({
    bufferMinutes: z.number().int().min(0).max(60).default(10),
    slotIntervalMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]).default(15),
    currency: z.union([z.literal('CAD'), z.literal('USD')]).default('CAD'),
    timezone: z.string().default('America/Toronto'),
    introPriceDefaultLabel: z.string().nullable().default(null),
    firstVisitDiscountEnabled: z.boolean().default(false),
  }),
  getBookingConfigForSalon,
  resolveBookingConfigFromSettings,
}));

vi.mock('@/libs/loyalty', () => ({
  getDefaultLoyaltyPoints,
  resolveSalonLoyaltyPoints,
}));

vi.mock('@/libs/queries', () => ({
  getSalonBySlug,
}));

vi.mock('@/libs/Env', () => ({
  Env: {
    TWILIO_ACCOUNT_SID: 'twilio_sid',
    TWILIO_AUTH_TOKEN: 'twilio_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
    RESEND_API_KEY: 'resend_key',
    RESEND_FROM_EMAIL: 'bookings@example.com',
  },
}));

vi.mock('@/libs/featureGating', () => ({
  getEffectiveModuleEnabled: vi.fn(() => true),
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

describe('/api/admin/salon/settings notification settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatedRows.length = 0;

    requireAdmin.mockResolvedValue({
      ok: true,
      admin: { id: 'admin_1' },
    });
    getBookingConfigForSalon.mockResolvedValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: false,
    });
    resolveBookingConfigFromSettings.mockReturnValue({
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: null,
      firstVisitDiscountEnabled: false,
    });
    getDefaultLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
    resolveSalonLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
  });

  it('returns booking notification settings and channel availability metadata', async () => {
    getSalonBySlug.mockResolvedValue({
      id: 'salon_1',
      slug: 'salon-a',
      ownerPhone: '4169021427',
      ownerEmail: 'owner@example.com',
      reviewsEnabled: true,
      rewardsEnabled: true,
      billingMode: 'NONE',
      stripeSubscriptionStatus: null,
      features: {
        marketing: {
          smsReminders: true,
        },
      },
      settings: {
        modules: {
          smsReminders: true,
        },
        notifications: {
          newBooking: {
            technicianEnabled: true,
            ownerEnabled: true,
            technicianChannel: 'sms',
            ownerChannel: 'both',
          },
        },
      },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingNotifications).toEqual({
      newBooking: {
        technicianEnabled: true,
        ownerEnabled: true,
        technicianChannel: 'sms',
        ownerChannel: 'both',
      },
      appointmentCancelled: {
        technicianEnabled: true,
        ownerEnabled: false,
        technicianChannel: 'sms',
        ownerChannel: 'both',
      },
    });
    expect(body.ownerPhonePresent).toBe(true);
    expect(body.ownerEmailPresent).toBe(true);
  });

  it('persists booking notification settings into salon.settings and returns the merged result', async () => {
    getSalonBySlug.mockResolvedValue({
      id: 'salon_1',
      slug: 'salon-a',
      ownerPhone: '4169021427',
      ownerEmail: 'owner@example.com',
      reviewsEnabled: true,
      rewardsEnabled: true,
      billingMode: 'NONE',
      stripeSubscriptionStatus: null,
      features: {
        marketing: {
          smsReminders: true,
        },
      },
      settings: {
        booking: {
          bufferMinutes: 10,
          slotIntervalMinutes: 15,
          currency: 'CAD',
          timezone: 'America/Toronto',
          introPriceDefaultLabel: null,
          firstVisitDiscountEnabled: false,
        },
      },
    });
    updatedRows.push({
      id: 'salon_1',
      slug: 'salon-a',
      ownerPhone: '4169021427',
      ownerEmail: 'owner@example.com',
      reviewsEnabled: true,
      rewardsEnabled: true,
      billingMode: 'NONE',
      stripeSubscriptionStatus: null,
      features: {
        marketing: {
          smsReminders: true,
        },
      },
      settings: {
        booking: {
          bufferMinutes: 10,
          slotIntervalMinutes: 15,
          currency: 'CAD',
          timezone: 'America/Toronto',
          introPriceDefaultLabel: null,
          firstVisitDiscountEnabled: false,
        },
        notifications: {
          newBooking: {
            technicianEnabled: true,
            ownerEnabled: true,
            technicianChannel: 'sms',
            ownerChannel: 'both',
          },
          appointmentCancelled: {
            technicianEnabled: true,
            ownerEnabled: false,
            technicianChannel: 'sms',
            ownerChannel: 'both',
          },
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingNotifications: {
            newBooking: {
              ownerEnabled: true,
              ownerChannel: 'both',
            },
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingNotifications.newBooking.ownerEnabled).toBe(true);
    expect(body.bookingNotifications.newBooking.ownerChannel).toBe('both');
    expect(body.bookingNotifications.appointmentCancelled.ownerEnabled).toBe(false);
    expect(logAuditEvent).toHaveBeenCalled();
  });

  it('rejects invalid booking notification channels', async () => {
    getSalonBySlug.mockResolvedValue({
      id: 'salon_1',
      slug: 'salon-a',
      ownerPhone: '4169021427',
      ownerEmail: 'owner@example.com',
      reviewsEnabled: true,
      rewardsEnabled: true,
      billingMode: 'NONE',
      stripeSubscriptionStatus: null,
      features: {},
      settings: {},
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingNotifications: {
            newBooking: {
              ownerChannel: 'push',
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe('/api/admin/salon/settings merchandising settings', () => {
  const baseSalon = {
    id: 'salon_1',
    slug: 'salon-a',
    ownerPhone: '4169021427',
    ownerEmail: 'owner@example.com',
    reviewsEnabled: true,
    rewardsEnabled: true,
    billingMode: 'NONE',
    stripeSubscriptionStatus: null,
    features: {},
    settings: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    updatedRows.length = 0;

    requireAdmin.mockResolvedValue({
      ok: true,
      admin: { id: 'admin_1' },
    });
    getBookingConfigForSalon.mockResolvedValue({});
    resolveBookingConfigFromSettings.mockReturnValue({});
    getDefaultLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
    resolveSalonLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
  });

  it('defaults Feature Luster Manicure to enabled on GET when settings are empty', async () => {
    getSalonBySlug.mockResolvedValue({ ...baseSalon, settings: null });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.merchandising).toEqual({
      featureLusterManicure: true,
      lusterPromoDismissed: false,
      serviceLibraryIntroDismissed: false,
    });
  });

  it('persists a merchandising update into salon.settings without touching services', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);
    updatedRows.push({
      ...baseSalon,
      settings: {
        merchandising: {
          featureLusterManicure: false,
          lusterPromoDismissed: false,
          serviceLibraryIntroDismissed: false,
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchandising: { featureLusterManicure: false },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.merchandising.featureLusterManicure).toBe(false);

    // Only the salon row is updated; disabling never deactivates the service.
    expect(db.update).toHaveBeenCalledTimes(1);

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];

    // Merchandising-only updates go through a targeted jsonb_set SQL
    // expression (not a full settings-object replace) so a concurrent
    // booking/notification save can never be clobbered by this writer.
    expect(setPayload.settings).toBeDefined();
    expect(setPayload.settings.merchandising).toBeUndefined();

    const sqlChunks = (setPayload.settings as { queryChunks?: unknown[] }).queryChunks ?? [];
    const paramValues = sqlChunks.filter(
      (chunk): chunk is string => typeof chunk === 'string',
    );

    expect(paramValues.some(value => value.includes('"featureLusterManicure":false'))).toBe(true);
    expect(logAuditEvent).toHaveBeenCalled();
  });

  it('writes the full settings object when merchandising is saved alongside booking config', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);
    updatedRows.push({
      ...baseSalon,
      settings: {
        booking: {},
        merchandising: {
          featureLusterManicure: false,
          lusterPromoDismissed: false,
          serviceLibraryIntroDismissed: false,
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingConfig: {},
          merchandising: { featureLusterManicure: false },
        }),
      }),
    );

    expect(response.status).toBe(200);

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];

    expect(setPayload.settings.merchandising).toEqual({
      featureLusterManicure: false,
      lusterPromoDismissed: false,
      serviceLibraryIntroDismissed: false,
    });
  });

  it('rejects invalid merchandising payloads', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchandising: { featureLusterManicure: 'nope' },
        }),
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe('/api/admin/salon/settings payments settings', () => {
  const baseSalon = {
    id: 'salon_1',
    slug: 'salon-a',
    ownerPhone: '4169021427',
    ownerEmail: 'owner@example.com',
    reviewsEnabled: true,
    rewardsEnabled: true,
    billingMode: 'NONE',
    stripeSubscriptionStatus: null,
    features: {},
    settings: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    updatedRows.length = 0;

    requireAdmin.mockResolvedValue({
      ok: true,
      admin: { id: 'admin_1' },
    });
    getBookingConfigForSalon.mockResolvedValue({});
    resolveBookingConfigFromSettings.mockReturnValue({});
    getDefaultLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
    resolveSalonLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
  });

  it('returns empty payments settings by default (tax off, nothing inferred)', async () => {
    getSalonBySlug.mockResolvedValue({ ...baseSalon, settings: null });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.payments).toEqual({});
  });

  it('persists a payments-only update through a targeted jsonb_set write', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        payments: {
          etransfer: { enabled: true, recipient: 'pay@salon.ca' },
        },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        payments: {
          tax: { enabled: true, name: 'HST', rateBps: 1300 },
          etransfer: { enabled: true, recipient: 'pay@salon.ca' },
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: { tax: { enabled: true, name: 'HST', rateBps: 1300 } },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.payments.tax).toMatchObject({ enabled: true, name: 'HST', rateBps: 1300 });

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];

    // Payments-only updates use the same single-key jsonb_set pattern as
    // merchandising so a concurrent booking/notification save is never
    // clobbered — and the merge preserves the untouched etransfer sub-object.
    expect(setPayload.settings).toBeDefined();
    expect(setPayload.settings.payments).toBeUndefined();

    const sqlChunks = (setPayload.settings as { queryChunks?: unknown[] }).queryChunks ?? [];
    const paramValues = sqlChunks.filter(
      (chunk): chunk is string => typeof chunk === 'string',
    );

    expect(paramValues.some(value => value.includes('"rateBps":1300'))).toBe(true);
    expect(paramValues.some(value => value.includes('"recipient":"pay@salon.ca"'))).toBe(true);
    expect(logAuditEvent).toHaveBeenCalled();
  });

  it('rejects an out-of-range tax rate', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: { tax: { enabled: true, rateBps: 99999 } },
        }),
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe('/api/admin/salon/settings smart fit settings (P7.4)', () => {
  const baseSalon = {
    id: 'salon_1',
    slug: 'salon-a',
    ownerPhone: '4169021427',
    ownerEmail: 'owner@example.com',
    reviewsEnabled: true,
    rewardsEnabled: true,
    billingMode: 'NONE',
    stripeSubscriptionStatus: null,
    features: {},
    settings: {},
  };

  const patchSmartFit = (payload: unknown) =>
    PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ smartFit: payload }),
      }),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    updatedRows.length = 0;
    selectResults.length = 0;

    requireAdmin.mockResolvedValue({
      ok: true,
      admin: { id: 'admin_1' },
    });
    getBookingConfigForSalon.mockResolvedValue({});
    resolveBookingConfigFromSettings.mockReturnValue({});
    getDefaultLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
    resolveSalonLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
  });

  it('GET returns empty smart fit settings when nothing is configured (feature dark)', async () => {
    getSalonBySlug.mockResolvedValue({ ...baseSalon, settings: null });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.smartFit).toEqual({});
  });

  it('GET returns the stored smart fit configuration', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        smartFit: {
          enabled: true,
          discountType: 'percent',
          value: 10,
          eligibleServiceIds: ['svc_1'],
        },
      },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(body.smartFit).toEqual({
      enabled: true,
      discountType: 'percent',
      value: 10,
      eligibleServiceIds: ['svc_1'],
    });
  });

  it('rejects unauthenticated and cross-salon callers via the admin guard', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });

    const response = await patchSmartFit({ enabled: true });

    expect(response.status).toBe(403);
    expect(db.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('persists a smart-fit-only update through a targeted jsonb_set write, preserving other keys', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        payments: { tax: { enabled: true, rateBps: 1300 } },
        smartFit: { enabled: false, value: 5 },
      },
    });
    selectResults.push([{ id: 'svc_1' }], [{ id: 'tech_1' }]);
    updatedRows.push({
      ...baseSalon,
      settings: {
        payments: { tax: { enabled: true, rateBps: 1300 } },
        smartFit: {
          enabled: true,
          discountType: 'percent',
          value: 10,
          maxRemainingGapMinutes: 30,
          minImprovementMinutes: 30,
          eligibleServiceIds: ['svc_1'],
          eligibleTechnicianIds: ['tech_1'],
        },
      },
    });

    const response = await patchSmartFit({
      enabled: true,
      discountType: 'percent',
      value: 10,
      maxRemainingGapMinutes: 30,
      minImprovementMinutes: 30,
      eligibleServiceIds: ['svc_1'],
      eligibleTechnicianIds: ['tech_1'],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    // Read back through the shared parser from the persisted row.
    expect(body.smartFit).toMatchObject({ enabled: true, value: 10 });

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];

    expect(setPayload.settings).toBeDefined();
    expect(setPayload.settings.smartFit).toBeUndefined();

    const sqlChunks = (setPayload.settings as { queryChunks?: unknown[] }).queryChunks ?? [];
    const paramValues = sqlChunks.filter(
      (chunk): chunk is string => typeof chunk === 'string',
    );

    // jsonb_set targets ONLY the smartFit key — the payments subtree is never
    // rewritten by this save.
    expect(paramValues.some(value => value.includes('"value":10'))).toBe(true);
    expect(paramValues.some(value => value.includes('rateBps'))).toBe(false);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'settings_updated',
      metadata: expect.objectContaining({
        before: expect.objectContaining({ smartFit: { enabled: false, value: 5 } }),
        after: expect.objectContaining({
          smartFit: expect.objectContaining({ enabled: true, value: 10 }),
        }),
      }),
    }));
  });

  it('a disable-only save preserves the other stored smart fit fields', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        smartFit: {
          enabled: true,
          discountType: 'fixed',
          value: 500,
          eligibleServiceIds: ['svc_1'],
        },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        smartFit: {
          enabled: false,
          discountType: 'fixed',
          value: 500,
          eligibleServiceIds: ['svc_1'],
        },
      },
    });

    const response = await patchSmartFit({ enabled: false });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.smartFit).toEqual({
      enabled: false,
      discountType: 'fixed',
      value: 500,
      eligibleServiceIds: ['svc_1'],
    });

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const sqlChunks = (setPayload.settings as { queryChunks?: unknown[] }).queryChunks ?? [];
    const paramValues = sqlChunks.filter(
      (chunk): chunk is string => typeof chunk === 'string',
    );

    expect(paramValues.some(value => value.includes('"value":500'))).toBe(true);
  });

  it('rejects out-of-bounds and malformed values with 400', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);

    for (const payload of [
      { value: 0 },
      { value: -5 },
      { value: 10.5 },
      { discountType: 'percent', value: 101 },
      { maxRemainingGapMinutes: 61 },
      { maxRemainingGapMinutes: -1 },
      { minImprovementMinutes: 241 },
      { minImprovementMinutes: 12.5 },
      { enabled: 'yes' },
      { eligibleServiceIds: [''] },
    ]) {
      const response = await patchSmartFit(payload);

      expect(response.status).toBe(400);
    }

    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects a percent value that only exceeds the cap after merging with the stored type', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { smartFit: { discountType: 'fixed', value: 500 } },
    });

    // Switching to percent while the stored value is 500 (cents) must not
    // silently persist a 500% discount.
    const response = await patchSmartFit({ discountType: 'percent' });

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects service ids that do not belong to this salon', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);
    selectResults.push([{ id: 'svc_mine' }]);

    const response = await patchSmartFit({
      eligibleServiceIds: ['svc_mine', 'svc_other_salon'],
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('INVALID_SERVICE');
    expect(body.details.serviceIds).toEqual(['svc_other_salon']);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects technician ids that do not belong to this salon', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);
    selectResults.push([{ id: 'tech_mine' }]);

    const response = await patchSmartFit({
      eligibleTechnicianIds: ['tech_mine', 'tech_other_salon'],
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('INVALID_TECHNICIAN');
    expect(body.details.technicianIds).toEqual(['tech_other_salon']);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('accepts owned ids without re-validating stale stored ids from earlier saves', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        smartFit: { eligibleServiceIds: ['svc_deleted_long_ago'] },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        smartFit: { enabled: true, eligibleServiceIds: ['svc_deleted_long_ago'] },
      },
    });

    // enabled-only save: no ids in the update, so no ownership queries run and
    // the stale stored id cannot brick the save.
    const response = await patchSmartFit({ enabled: true });

    expect(response.status).toBe(200);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('persists explicit empty arrays (= all services/technicians eligible per the parser)', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { smartFit: { enabled: true, eligibleServiceIds: ['svc_1'] } },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        smartFit: { enabled: true, eligibleServiceIds: [], eligibleTechnicianIds: [] },
      },
    });

    const response = await patchSmartFit({
      eligibleServiceIds: [],
      eligibleTechnicianIds: [],
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.smartFit.eligibleServiceIds).toEqual([]);
    expect(body.smartFit.eligibleTechnicianIds).toEqual([]);
    // Empty arrays trigger no ownership queries.
    expect(db.select).not.toHaveBeenCalled();
  });
});
