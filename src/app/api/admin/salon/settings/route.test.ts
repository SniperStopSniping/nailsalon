import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  BOOKING_EXPERIENCE_DEFAULTS,
  bookingExperienceUpdateSchema,
  getAccessibleBookingForeground,
  getBookingExperienceCssVariables,
  getColorContrastRatio,
  resolveBookingExperience,
} from '@/libs/bookingExperience';

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

describe('/api/admin/salon/settings salon appointment email notifications', () => {
  const salonRow = {
    id: 'salon_1',
    slug: 'salon-a',
    ownerPhone: '4169021427',
    ownerEmail: 'owner@example.com',
    email: 'hello@example.com',
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
    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });
    getBookingConfigForSalon.mockResolvedValue({});
    resolveBookingConfigFromSettings.mockReturnValue({});
    getDefaultLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
    resolveSalonLoyaltyPoints.mockReturnValue({ welcomeBonus: 0 });
  });

  it('defaults every notification type to on and resolves the owner email', async () => {
    getSalonBySlug.mockResolvedValue(salonRow);

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(body.salonEmailNotifications).toEqual({
      newBooking: true,
      rescheduled: true,
      cancelled: true,
      recipientEmail: null,
    });
    expect(body.salonNotificationRecipient).toEqual({
      email: 'owner@example.com',
      source: 'owner',
    });
    expect(body.salonNotificationRecipientMissing).toBe(false);
  });

  it('flags a missing recipient so the owner can be told', async () => {
    getSalonBySlug.mockResolvedValue({
      ...salonRow,
      ownerEmail: null,
      email: null,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(body.salonNotificationRecipient).toBeNull();
    expect(body.salonNotificationRecipientMissing).toBe(true);
  });

  it('persists the toggles and recipient without dropping the SMS notification block', async () => {
    getSalonBySlug.mockResolvedValue({
      ...salonRow,
      settings: {
        notifications: {
          newBooking: {
            technicianEnabled: true,
            ownerEnabled: true,
            technicianChannel: 'sms',
            ownerChannel: 'sms',
          },
        },
      },
    });
    updatedRows.push({
      ...salonRow,
      settings: {
        notifications: {
          newBooking: {
            technicianEnabled: true,
            ownerEnabled: true,
            technicianChannel: 'sms',
            ownerChannel: 'sms',
          },
          salonEmail: {
            newBooking: true,
            rescheduled: true,
            cancelled: false,
            recipientEmail: 'frontdesk@example.com',
          },
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonEmailNotifications: {
            cancelled: false,
            recipientEmail: 'FrontDesk@Example.com',
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.salonEmailNotifications).toEqual({
      newBooking: true,
      rescheduled: true,
      cancelled: false,
      recipientEmail: 'frontdesk@example.com',
    });
    expect(body.salonNotificationRecipient).toEqual({
      email: 'frontdesk@example.com',
      source: 'configured',
    });
    // The SMS notification block must survive a salon-email-only save.
    expect(body.bookingNotifications.newBooking.ownerEnabled).toBe(true);
    expect(logAuditEvent).toHaveBeenCalled();
  });

  it('rejects an invalid notification email and leaves settings untouched', async () => {
    getSalonBySlug.mockResolvedValue(salonRow);

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonEmailNotifications: { recipientEmail: 'not-an-email' },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
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

  it('chains targeted writes when merchandising is saved alongside booking config', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...BOOKING_EXPERIENCE_DEFAULTS,
          bookingMessage: 'Keep this concurrent value',
        },
      },
    });
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

    expect(setPayload.settings.booking).toBeUndefined();
    expect(setPayload.settings.merchandising).toBeUndefined();

    const sqlChunks = (setPayload.settings as { queryChunks?: unknown[] }).queryChunks ?? [];
    const paramValues = sqlChunks.filter(
      (chunk): chunk is string => typeof chunk === 'string',
    );

    expect(paramValues.some(value => value.includes('"featureLusterManicure":false'))).toBe(true);
    // The expression starts from the live settings column and never serializes
    // a stale bookingExperience value, so a concurrent customization save is
    // preserved.
    expect(paramValues.some(value => value.includes('Keep this concurrent value'))).toBe(false);
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

function createBookingExperience() {
  return {
    primaryColor: '#123456',
    bookingMessage: 'Welcome to our booking page.',
    policy: {
      enabled: true,
      title: 'Before you book',
      text: 'Please arrive five minutes early.',
    },
    appointmentOnly: true,
    socialLinks: {
      instagram: 'https://www.instagram.com/lusterstudio',
      facebook: 'https://facebook.com/lusterstudio',
      tiktok: 'https://www.tiktok.com/@lusterstudio',
    },
    confirmationMessage: 'We look forward to seeing you.',
  };
}

function collectSqlStringChunks(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectSqlStringChunks);
  }
  if (
    typeof value === 'object'
    && value !== null
    && 'queryChunks' in value
  ) {
    return collectSqlStringChunks(
      (value as { queryChunks?: unknown[] }).queryChunks ?? [],
    );
  }
  if (
    typeof value === 'object'
    && value !== null
    && 'value' in value
  ) {
    return collectSqlStringChunks(
      (value as { value?: unknown }).value,
    );
  }
  return [];
}

describe('booking experience validation and safe resolution', () => {
  it('normalizes colour, whitespace, and CRLF while preserving safe line breaks', () => {
    const result = bookingExperienceUpdateSchema.parse({
      ...createBookingExperience(),
      primaryColor: '  #abcdef  ',
      bookingMessage: '  First line\r\nSecond line  ',
      policy: {
        enabled: true,
        title: '  Booking policy  ',
        text: '  Policy line one\r\nPolicy line two  ',
      },
      confirmationMessage: '  Confirmed\r\nSee you soon  ',
    });

    expect(result.primaryColor).toBe('#ABCDEF');
    expect(result.bookingMessage).toBe('First line\nSecond line');
    expect(result.policy).toEqual({
      enabled: true,
      title: 'Booking policy',
      text: 'Policy line one\nPolicy line two',
    });
    expect(result.confirmationMessage).toBe('Confirmed\nSee you soon');
  });

  it('enforces every text limit after trimming and requires enabled policy text', () => {
    const bookingMessage = bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      bookingMessage: `  ${'a'.repeat(161)}  `,
    });
    const policyTitle = bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
        title: 'a'.repeat(61),
      },
    });
    const policyText = bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
        text: 'a'.repeat(1_501),
      },
    });
    const confirmationMessage = bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      confirmationMessage: 'a'.repeat(501),
    });
    const enabledWithoutText = bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      policy: {
        enabled: true,
        title: null,
        text: '   ',
      },
    });
    const disabledDraft = bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      policy: {
        enabled: false,
        title: 'Draft',
        text: 'Unpublished draft text',
      },
    });

    expect(bookingMessage.success).toBe(false);
    expect(policyTitle.success).toBe(false);
    expect(policyText.success).toBe(false);
    expect(confirmationMessage.success).toBe(false);
    expect(enabledWithoutText.success).toBe(false);
    expect(disabledDraft.success).toBe(true);
  });

  it('rejects disallowed controls, arbitrary CSS colours, and noncanonical colour shapes', () => {
    for (const primaryColor of [
      '#FFF',
      '#FFFFFFFF',
      'red',
      'rgb(0, 0, 0)',
      'var(--brand)',
      '#123456; color: red',
    ]) {
      expect(bookingExperienceUpdateSchema.safeParse({
        ...createBookingExperience(),
        primaryColor,
      }).success).toBe(false);
    }

    for (const bookingMessage of [
      'before\u0000after',
      'before\tafter',
      'before\rafter',
      'before\u007Fafter',
    ]) {
      expect(bookingExperienceUpdateSchema.safeParse({
        ...createBookingExperience(),
        bookingMessage,
      }).success).toBe(false);
    }
  });

  it('allows only absolute approved HTTPS profile URLs', () => {
    const valid = bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      socialLinks: {
        instagram: 'https://instagram.com/luster.studio',
        facebook: 'https://www.facebook.com/luster.studio/',
        tiktok: 'https://tiktok.com/@luster.studio?lang=en',
      },
    });

    expect(valid.success).toBe(true);

    if (valid.success) {
      expect(valid.data.socialLinks.instagram).toBe(
        'https://instagram.com/luster.studio',
      );
    }

    const invalidInstagramUrls = [
      'http://instagram.com/luster',
      'https://instagram.com',
      'https://instagram.com/',
      'https://instagram.com.evil.example/luster',
      'https://facebook.com/luster',
      'https://user:password@instagram.com/luster',
      'https://instagram.com:444/luster',
      'https://instagram.com/%E0%A4%A',
      'https://instagram.com/luster%00studio',
      'https://instagram.com/luster%0Astudio',
      'https://instagram.com/luster\nstudio',
      'https://instagram.com/%2F',
      'https://instagram.com/%20',
      'https://instagram.com/%5C',
      'instagram.com/luster',
    ];
    for (const instagram of invalidInstagramUrls) {
      expect(bookingExperienceUpdateSchema.safeParse({
        ...createBookingExperience(),
        socialLinks: {
          ...createBookingExperience().socialLinks,
          instagram,
        },
      }).success).toBe(false);
    }
  });

  it('normalizes blank links to null and rejects overlong URLs', () => {
    const normalized = bookingExperienceUpdateSchema.parse({
      ...createBookingExperience(),
      socialLinks: {
        instagram: '   ',
        facebook: null,
        tiktok: 'https://tiktok.com/@luster',
      },
    });

    expect(normalized.socialLinks.instagram).toBeNull();
    expect(normalized.socialLinks.facebook).toBeNull();

    const overlong = `https://instagram.com/${'a'.repeat(480)}?${'b'.repeat(20)}`;

    expect(bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      socialLinks: {
        ...createBookingExperience().socialLinks,
        instagram: overlong,
      },
    }).success).toBe(false);

    expect(bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      socialLinks: {
        ...createBookingExperience().socialLinks,
        instagram: `https://instagram.com/${'é'.repeat(200)}`,
      },
    }).success).toBe(false);
  });

  it('falls back field-by-field for missing or invalid stored JSON', () => {
    expect(resolveBookingExperience(null)).toEqual(
      BOOKING_EXPERIENCE_DEFAULTS,
    );

    const resolved = resolveBookingExperience({
      bookingExperience: {
        primaryColor: 'not-css',
        bookingMessage: '  A valid stored message  ',
        policy: {
          enabled: true,
          title: 'Draft title',
          text: 'bad\u0000text',
        },
        appointmentOnly: 'yes',
        socialLinks: {
          instagram: 'https://instagram.com/valid',
          facebook: 'https://evil.example/facebook',
        },
        confirmationMessage: '  Valid confirmation  ',
      },
    } as unknown as Parameters<typeof resolveBookingExperience>[0]);

    expect(resolved).toEqual({
      ...BOOKING_EXPERIENCE_DEFAULTS,
      bookingMessage: 'A valid stored message',
      policy: {
        enabled: false,
        title: 'Draft title',
        text: null,
      },
      socialLinks: {
        instagram: 'https://instagram.com/valid',
        facebook: null,
        tiktok: null,
      },
      confirmationMessage: 'Valid confirmation',
    });
  });

  it('chooses a WCAG-compliant foreground for light and dark colours', () => {
    const darkForeground = getAccessibleBookingForeground('#123456');
    const lightForeground = getAccessibleBookingForeground('#F5D000');

    expect(darkForeground).toBe('#FFFFFF');
    expect(lightForeground).toBe('#000000');
    expect(getColorContrastRatio('#123456', darkForeground)).toBeGreaterThanOrEqual(4.5);
    expect(getColorContrastRatio('#F5D000', lightForeground)).toBeGreaterThanOrEqual(4.5);

    const variables = getBookingExperienceCssVariables('#F5D000');

    expect(variables['--booking-brand-foreground']).toBe('#000000');
    expect(getColorContrastRatio(
      variables['--booking-brand-state-border'] ?? '#FFFFFF',
      '#FFFFFF',
    )).toBeGreaterThanOrEqual(3);

    const boundaryVariables = getBookingExperienceCssVariables('#898989');

    expect(boundaryVariables['--booking-brand-state-border']).toBe('#000000');
    expect(getColorContrastRatio(
      boundaryVariables['--booking-brand-state-border'] ?? '#FFFFFF',
      '#EDEDED',
    )).toBeGreaterThanOrEqual(3);
    expect(getBookingExperienceCssVariables(null)).toEqual({});
  });
});

describe('/api/admin/salon/settings booking experience', () => {
  const baseSalon = {
    id: 'salon_1',
    slug: 'salon-a',
    ownerPhone: '4169021427',
    ownerEmail: 'owner@example.com',
    email: 'salon@example.com',
    reviewsEnabled: true,
    rewardsEnabled: true,
    billingMode: 'NONE',
    stripeSubscriptionStatus: null,
    plan: 'single_salon',
    features: {},
    settings: {},
  };

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

  it('returns defaults for an unconfigured salon and safely resolves invalid stored data', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperience(),
          primaryColor: '<style>',
          bookingMessage: 'Valid stored message',
          socialLinks: {
            ...createBookingExperience().socialLinks,
            instagram: 'javascript:alert(1)',
          },
        },
      },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.primaryColor).toBeNull();
    expect(body.bookingExperience.bookingMessage).toBe('Valid stored message');
    expect(body.bookingExperience.socialLinks.instagram).toBeNull();
    expect(body.bookingExperienceEntitlement).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: true,
      source: 'plan',
      planKey: 'tier_1',
      storedPlan: 'single_salon',
      lockedReason: null,
    });

    getSalonBySlug.mockResolvedValue({ ...baseSalon, settings: null });
    const defaultsResponse = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const defaultsBody = await defaultsResponse.json();

    expect(defaultsBody.bookingExperience).toEqual(
      BOOKING_EXPERIENCE_DEFAULTS,
    );
  });

  it('authorizes against the trusted salon resolved from the slug', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      id: 'salon_2',
      slug: 'salon-b',
    });
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403 },
      ),
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-b', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonId: 'salon_1',
          bookingExperience: createBookingExperience(),
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(requireAdmin).toHaveBeenCalledWith('salon_2');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects invalid customization before writing settings', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingExperience: {
            ...createBookingExperience(),
            policy: {
              enabled: true,
              title: null,
              text: null,
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('persists only bookingExperience with jsonb_set and preserves unrelated settings', async () => {
    const bookingExperience = {
      ...createBookingExperience(),
      primaryColor: '#f5d000',
      bookingMessage: '  A private welcome message  ',
    };
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        booking: { bufferMinutes: 20 },
        notifications: { salonEmail: { newBooking: false } },
        unrelatedFutureKey: { keep: true },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        booking: { bufferMinutes: 20 },
        notifications: { salonEmail: { newBooking: false } },
        unrelatedFutureKey: { keep: true },
        bookingExperience: {
          ...bookingExperience,
          primaryColor: '#F5D000',
          bookingMessage: 'A private welcome message',
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingExperience }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.primaryColor).toBe('#F5D000');
    expect(body.bookingExperience.bookingMessage).toBe(
      'A private welcome message',
    );
    expect(body.bookingExperienceEntitlement).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: true,
      source: 'plan',
      planKey: 'tier_1',
      storedPlan: 'single_salon',
      lockedReason: null,
    });

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];

    expect(setPayload.settings).toBeDefined();
    expect(setPayload.settings.bookingExperience).toBeUndefined();

    const sqlChunks = (setPayload.settings as { queryChunks?: unknown[] }).queryChunks ?? [];
    const paramValues = sqlChunks.filter(
      (chunk): chunk is string => typeof chunk === 'string',
    );

    expect(paramValues.some(value => value.includes('"primaryColor":"#F5D000"'))).toBe(true);
    expect(paramValues.some(value => value.includes('unrelatedFutureKey'))).toBe(false);
    expect(paramValues.some(value => value.includes('bufferMinutes'))).toBe(false);

    const settingsSql = collectSqlStringChunks(setPayload.settings).join(' ');

    expect(settingsSql).toContain('jsonb_typeof');
    expect(settingsSql).toContain(`= 'object'`);

    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_1',
      actorId: 'admin_1',
      metadata: {
        before: {
          bookingExperience: expect.objectContaining({
            bookingMessagePresent: false,
            bookingMessageLength: 0,
          }),
        },
        after: {
          bookingExperience: expect.objectContaining({
            primaryColor: '#F5D000',
            bookingMessagePresent: true,
            bookingMessageLength: 25,
          }),
        },
      },
    }));
    expect(JSON.stringify(logAuditEvent.mock.calls[0]?.[0])).not.toContain(
      'A private welcome message',
    );
  });

  it('returns saved customization with locked entitlement metadata for a free salon', async () => {
    const savedBookingExperience = createBookingExperience();
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      plan: 'free',
      settings: {
        bookingExperience: savedBookingExperience,
      },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience).toEqual(savedBookingExperience);
    expect(body.bookingExperienceEntitlement).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: false,
      source: 'plan',
      planKey: 'free',
      storedPlan: 'free',
      lockedReason: 'upgrade_required',
    });
  });

  it('rejects a direct locked customization PATCH without mutating saved settings', async () => {
    const savedBookingExperience = {
      ...createBookingExperience(),
      bookingMessage: 'Keep this saved message.',
    };
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      plan: 'free',
      settings: {
        bookingExperience: savedBookingExperience,
        unrelatedFutureKey: { keep: true },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingExperience: {
            ...savedBookingExperience,
            bookingMessage: 'Attempted replacement.',
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: {
        code: 'UPGRADE_REQUIRED',
        message: 'Booking Experience Customization requires an eligible plan.',
      },
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('chains booking and customization writes without serializing unrelated settings', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        unrelatedFutureKey: { keep: true },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        booking: {
          bufferMinutes: 10,
          slotIntervalMinutes: 15,
          currency: 'CAD',
          timezone: 'America/Toronto',
          introPriceDefaultLabel: null,
          firstVisitDiscountEnabled: false,
        },
        bookingExperience: createBookingExperience(),
        unrelatedFutureKey: { keep: true },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingConfig: {},
          bookingExperience: createBookingExperience(),
        }),
      }),
    );

    expect(response.status).toBe(200);

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];

    expect(setPayload.settings.booking).toBeUndefined();
    expect(setPayload.settings.bookingExperience).toBeUndefined();
    expect(
      collectSqlStringChunks(setPayload.settings)
        .some(value => value.includes('unrelatedFutureKey')),
    ).toBe(false);
  });

  it('safely writes bookingExperience over null and non-object JSONB settings', async () => {
    const database = new PGlite();

    try {
      await database.exec(`
        CREATE TABLE salon_settings_legacy_values (
          id text PRIMARY KEY,
          settings jsonb
        );
        INSERT INTO salon_settings_legacy_values (id, settings)
        VALUES
          ('sql_null', NULL),
          ('json_null', 'null'::jsonb),
          ('json_string', '"legacy"'::jsonb),
          ('json_number', '42'::jsonb),
          ('json_boolean', 'true'::jsonb),
          ('json_array', '["legacy"]'::jsonb),
          (
            'valid_object',
            '{"unrelatedFutureKey":{"keep":true}}'::jsonb
          );

        UPDATE salon_settings_legacy_values
        SET settings = jsonb_set(
          CASE
            WHEN jsonb_typeof(settings) = 'object' THEN settings
            ELSE '{}'::jsonb
          END,
          '{bookingExperience}',
          '{"bookingMessage":"Saved customization"}'::jsonb
        );
      `);

      const result = await database.query<{
        id: string;
        settings: Record<string, unknown>;
      }>(`
        SELECT id, settings
        FROM salon_settings_legacy_values
        ORDER BY id
      `);

      const savedCustomization = {
        bookingExperience: { bookingMessage: 'Saved customization' },
      };

      expect(
        Object.fromEntries(
          result.rows.map(row => [row.id, row.settings]),
        ),
      ).toEqual({
        json_array: savedCustomization,
        json_boolean: savedCustomization,
        json_null: savedCustomization,
        json_number: savedCustomization,
        json_string: savedCustomization,
        sql_null: savedCustomization,
        valid_object: {
          ...savedCustomization,
          unrelatedFutureKey: { keep: true },
        },
      });
      expect(result.rows).toHaveLength(7);
    } finally {
      await database.close();
    }
  });

  it('preserves concurrent unrelated settings with real PostgreSQL JSONB updates', async () => {
    const database = new PGlite();

    try {
      await database.exec(`
        CREATE TABLE salon_settings_concurrency (
          id text PRIMARY KEY,
          settings jsonb
        );
        INSERT INTO salon_settings_concurrency (id, settings)
        VALUES (
          'salon_1',
          '{
            "booking":{"bufferMinutes":10},
            "bookingExperience":{"bookingMessage":"Original"},
            "unrelatedFutureKey":{"keep":true}
          }'::jsonb
        );
      `);

      await Promise.all([
        database.exec(`
          UPDATE salon_settings_concurrency
          SET settings = jsonb_set(
            CASE
              WHEN jsonb_typeof(settings) = 'object' THEN settings
              ELSE '{}'::jsonb
            END,
            '{bookingExperience}',
            '{"bookingMessage":"Saved customization"}'::jsonb
          )
          WHERE id = 'salon_1'
        `),
        database.exec(`
          UPDATE salon_settings_concurrency
          SET settings = jsonb_set(
            CASE
              WHEN jsonb_typeof(settings) = 'object' THEN settings
              ELSE '{}'::jsonb
            END,
            '{booking}',
            '{"bufferMinutes":30}'::jsonb
          )
          WHERE id = 'salon_1'
        `),
      ]);

      const result = await database.query<{
        settings: Record<string, unknown>;
      }>(`
        SELECT settings
        FROM salon_settings_concurrency
        WHERE id = 'salon_1'
      `);

      expect(result.rows[0]?.settings).toEqual({
        booking: { bufferMinutes: 30 },
        bookingExperience: {
          bookingMessage: 'Saved customization',
        },
        unrelatedFutureKey: { keep: true },
      });
    } finally {
      await database.close();
    }
  });
});
