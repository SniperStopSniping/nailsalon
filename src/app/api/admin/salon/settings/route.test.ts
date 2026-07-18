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
  db,
} = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  logAuditEvent: vi.fn(),
  getBookingConfigForSalon: vi.fn(),
  resolveBookingConfigFromSettings: vi.fn(),
  getDefaultLoyaltyPoints: vi.fn(),
  resolveSalonLoyaltyPoints: vi.fn(),
  getSalonBySlug: vi.fn(),
  updatedRows: [] as unknown[],
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => updatedRows.splice(0, updatedRows.length)),
        })),
      })),
    })),
  },
}));

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
