import { createHash } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  BOOKING_EXPERIENCE_DEFAULTS,
  bookingExperienceAppearanceUpdateSchema,
  bookingExperienceUpdateSchema,
  bookingPolicyUpdateSchema,
  DEFAULT_BOOKING_POLICY_TITLE,
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
  refreshAccountReadiness,
  getDepositPolicyForSalon,
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
    refreshAccountReadiness: vi.fn(),
    // A safe default so every OTHER describe block's GET keeps working: this
    // mock stands in for a module the settings GET always calls.
    getDepositPolicyForSalon: vi.fn(async (): Promise<Record<string, unknown>> => ({
      active: false,
      reason: 'not_configured',
      amountCents: null,
      readinessStale: false,
      readinessAgeMs: null,
    })),
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

// D3: the decision-time readiness gate and the deposit policy reader are
// module-mocked here. The real readiness module imports the Stripe SDK, and the
// real policy reader would need a database.
vi.mock('@/libs/stripeConnect/readiness', () => ({
  refreshAccountReadiness,
}));

vi.mock('@/libs/depositPolicy.server', () => ({
  getDepositPolicyForSalon,
  EXPECTED_LIVEMODE: false,
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
      refundFailed: true,
      refundAccountDisconnected: true,
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
      refundFailed: true,
      refundAccountDisconnected: true,
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

  it('defaults service images and Feature Luster Manicure to enabled on GET when settings are empty', async () => {
    getSalonBySlug.mockResolvedValue({ ...baseSalon, settings: null });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.merchandising).toEqual({
      featureLusterManicure: true,
      showServiceImages: true,
      lusterPromoDismissed: false,
      serviceLibraryIntroDismissed: false,
    });
  });

  it('persists a service-image opt-out without touching services or other merchandising settings', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        merchandising: {
          featureLusterManicure: false,
          showServiceImages: null,
          lusterPromoDismissed: true,
          serviceLibraryIntroDismissed: true,
        },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        merchandising: {
          featureLusterManicure: false,
          showServiceImages: false,
          lusterPromoDismissed: true,
          serviceLibraryIntroDismissed: true,
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchandising: { showServiceImages: false },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.merchandising).toEqual({
      featureLusterManicure: false,
      showServiceImages: false,
      lusterPromoDismissed: true,
      serviceLibraryIntroDismissed: true,
    });

    // The null legacy/corrupt value fails open without resetting valid sibling
    // settings. Hiding images still never edits service rows or removes their
    // stored image URLs.
    expect(db.update).toHaveBeenCalledTimes(1);

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];

    // Merchandising-only updates go through a targeted jsonb_set SQL
    // expression (not a full settings-object replace) so a concurrent
    // booking/notification save can never be clobbered by this writer.
    expect(setPayload.settings).toBeDefined();
    expect(setPayload.settings.merchandising).toBeUndefined();

    const rendered = new PgDialect().sqlToQuery(setPayload.settings as SQL);

    expect(rendered.sql).toContain('{merchandising,showServiceImages}');
    expect(rendered.sql).not.toContain('{merchandising,featureLusterManicure}');
    expect(rendered.sql).not.toContain('{merchandising,lusterPromoDismissed}');
    expect(rendered.sql).not.toContain('{merchandising,serviceLibraryIntroDismissed}');
    expect(rendered.params).toContain('false');
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
          showServiceImages: true,
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

    const rendered = new PgDialect().sqlToQuery(setPayload.settings as SQL);

    expect(rendered.sql).toContain('{merchandising,featureLusterManicure}');
    expect(rendered.sql).not.toContain('{merchandising,showServiceImages}');
    expect(rendered.params).toContain('false');
    // The expression starts from the live settings column and never serializes
    // a stale bookingExperience value, so a concurrent customization save is
    // preserved.
    expect(JSON.stringify(rendered.params)).not.toContain('Keep this concurrent value');
  });

  it('preserves concurrent sibling merchandising writes with the generated PostgreSQL expression', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        merchandising: {
          featureLusterManicure: false,
          showServiceImages: true,
          lusterPromoDismissed: false,
          serviceLibraryIntroDismissed: false,
          futurePreference: 'keep',
        },
        unrelatedFutureKey: { keep: true },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        merchandising: {
          featureLusterManicure: false,
          showServiceImages: false,
          lusterPromoDismissed: true,
          serviceLibraryIntroDismissed: true,
          futurePreference: 'keep',
        },
        unrelatedFutureKey: { keep: true },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchandising: { showServiceImages: false },
        }),
      }),
    );

    expect(response.status).toBe(200);

    const responseBody = await response.json();

    expect(responseBody.merchandising).toEqual({
      featureLusterManicure: false,
      showServiceImages: false,
      lusterPromoDismissed: true,
      serviceLibraryIntroDismissed: true,
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        before: {
          merchandising: { showServiceImages: true },
        },
        after: {
          merchandising: { showServiceImages: false },
        },
      },
    }));

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const rendered = new PgDialect().sqlToQuery(setPayload.settings as SQL);
    const database = new PGlite();

    try {
      await database.exec(`
        CREATE TABLE "salon" (
          id text PRIMARY KEY,
          settings jsonb
        );
        INSERT INTO "salon" (id, settings)
        VALUES
          (
            'salon_1',
            '{
              "merchandising":{
                "featureLusterManicure":false,
                "showServiceImages":true,
                "lusterPromoDismissed":false,
                "serviceLibraryIntroDismissed":false,
                "futurePreference":"keep"
              },
              "unrelatedFutureKey":{"keep":true}
            }'::jsonb
          ),
          ('merchandising_null', '{"merchandising":null,"keep":true}'::jsonb),
          ('merchandising_scalar', '{"merchandising":"legacy","keep":true}'::jsonb),
          ('settings_null', NULL);

        UPDATE "salon"
        SET settings = jsonb_set(
          jsonb_set(
            settings,
            '{merchandising,lusterPromoDismissed}',
            'true'::jsonb
          ),
          '{merchandising,serviceLibraryIntroDismissed}',
          'true'::jsonb
        )
        WHERE id = 'salon_1';
      `);

      await database.query(
        `UPDATE "salon" SET settings = ${rendered.sql}`,
        rendered.params,
      );

      const result = await database.query<{
        id: string;
        settings: Record<string, unknown>;
      }>('SELECT id, settings FROM "salon" ORDER BY id');

      expect(Object.fromEntries(result.rows.map(row => [row.id, row.settings]))).toEqual({
        merchandising_null: {
          keep: true,
          merchandising: { showServiceImages: false },
        },
        merchandising_scalar: {
          keep: true,
          merchandising: { showServiceImages: false },
        },
        salon_1: {
          merchandising: {
            featureLusterManicure: false,
            futurePreference: 'keep',
            lusterPromoDismissed: true,
            serviceLibraryIntroDismissed: true,
            showServiceImages: false,
          },
          unrelatedFutureKey: { keep: true },
        },
        settings_null: {
          merchandising: { showServiceImages: false },
        },
      });
    } finally {
      await database.close();
    }
  });

  it('rejects a merchandising write when the trusted salon admin guard fails', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);
    requireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchandising: { showServiceImages: false },
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(requireAdmin).toHaveBeenCalledWith('salon_1');
    expect(db.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects invalid merchandising payloads', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchandising: { showServiceImages: 'nope' },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
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

    // Payments is now written at SUB-PATH granularity, so a tax-only save emits
    // `{payments,tax}` and NOTHING for e-Transfer. Re-persisting the untouched
    // sibling from the request-start snapshot is exactly the lost update this
    // change closes: it would silently revert a concurrent e-Transfer save.
    // The stored sibling still survives — it is preserved by the database, not
    // by being rewritten. (See the deposit-vs-tax integration cases.)
    expect(setPayload.settings).toBeDefined();
    expect(setPayload.settings.payments).toBeUndefined();

    const sqlChunks = (setPayload.settings as { queryChunks?: unknown[] }).queryChunks ?? [];
    const paramValues = sqlChunks.filter(
      (chunk): chunk is string => typeof chunk === 'string',
    );

    expect(paramValues.some(value => value.includes('"rateBps":1300'))).toBe(true);
    expect(paramValues.some(value => value.includes('"recipient":"pay@salon.ca"'))).toBe(false);
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
      showOnServicePage: true,
      showBeforeConfirmation: true,
      showAfterConfirmation: true,
      showInConfirmationEmail: true,
    },
    quickFacts: {
      appointmentOnly: {
        enabled: true,
        label: 'Appointment only',
      },
      depositNotice: {
        enabled: false,
        label: null,
      },
      cancellationNotice: {
        enabled: true,
        label: '24-hour cancellation policy',
      },
    },
    socialLinks: {
      instagram: 'https://www.instagram.com/lusterstudio',
      facebook: 'https://facebook.com/lusterstudio',
      tiktok: 'https://www.tiktok.com/@lusterstudio',
    },
    confirmationMessage: 'We look forward to seeing you.',
  };
}

function createBookingExperienceAppearance() {
  const bookingExperience = createBookingExperience();

  return {
    primaryColor: bookingExperience.primaryColor,
    bookingMessage: bookingExperience.bookingMessage,
    socialLinks: bookingExperience.socialLinks,
    confirmationMessage: bookingExperience.confirmationMessage,
  };
}

function createBookingPolicy() {
  const bookingExperience = createBookingExperience();

  return {
    policy: bookingExperience.policy,
    quickFacts: bookingExperience.quickFacts,
  };
}

const acknowledgmentText
  = 'I understand this appointment reserves the technician’s time.';

function createBookingPolicyWithAcknowledgment(
  acknowledgment: {
    required: boolean;
    text: string | null;
  } = {
    required: false,
    text: acknowledgmentText,
  },
) {
  const bookingPolicy = createBookingPolicy();

  return {
    ...bookingPolicy,
    policy: {
      ...bookingPolicy.policy,
      acknowledgment,
    },
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
  it('keeps appearance and policy writes on strict independent contracts', () => {
    expect(bookingExperienceAppearanceUpdateSchema.safeParse({
      ...createBookingExperienceAppearance(),
      policy: createBookingExperience().policy,
    }).success).toBe(false);
    expect(bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicy(),
      primaryColor: '#123456',
    }).success).toBe(false);
  });

  it('normalizes colour, whitespace, and CRLF while preserving safe line breaks', () => {
    const result = bookingExperienceUpdateSchema.parse({
      ...createBookingExperience(),
      primaryColor: '  #abcdef  ',
      bookingMessage: '  First line\r\nSecond line  ',
      policy: {
        ...createBookingExperience().policy,
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
      showOnServicePage: true,
      showBeforeConfirmation: true,
      showAfterConfirmation: true,
      showInConfirmationEmail: true,
    });
    expect(result.confirmationMessage).toBe('Confirmed\nSee you soon');
  });

  it('conservatively normalizes policy copy without collapsing internal spaces', () => {
    const result = bookingPolicyUpdateSchema.parse({
      ...createBookingPolicy(),
      policy: {
        ...createBookingExperience().policy,
        text:
          '  Keep   intentional spaces.  \r\nSecond line.   \r\n   \r\n\r\n\r\nLast line.  ',
      },
    });

    expect(result.policy.text).toBe(
      'Keep   intentional spaces.\nSecond line.\n\nLast line.',
    );
  });

  it('normalizes acknowledgment wording conservatively and counts Unicode code points', () => {
    const normalized = bookingPolicyUpdateSchema.parse({
      ...createBookingPolicyWithAcknowledgment(),
      policy: {
        ...createBookingPolicyWithAcknowledgment().policy,
        acknowledgment: {
          required: false,
          text:
            '  Keep   intentional spaces.  \r\nSecond line.   \r\n\r\n\r\n\r\nLast line.  ',
        },
      },
    });
    const acceptedUnicode = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicyWithAcknowledgment(),
      policy: {
        ...createBookingPolicyWithAcknowledgment().policy,
        acknowledgment: {
          required: false,
          text: `  ${'💅'.repeat(220)}  `,
        },
      },
    });
    const rejectedUnicode = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicyWithAcknowledgment(),
      policy: {
        ...createBookingPolicyWithAcknowledgment().policy,
        acknowledgment: {
          required: false,
          text: '💅'.repeat(221),
        },
      },
    });
    const nullableDraft = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicyWithAcknowledgment(),
      policy: {
        ...createBookingPolicyWithAcknowledgment().policy,
        acknowledgment: {
          required: false,
          text: null,
        },
      },
    });
    const controlCharacter = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicyWithAcknowledgment(),
      policy: {
        ...createBookingPolicyWithAcknowledgment().policy,
        acknowledgment: {
          required: false,
          text: 'Before\u0000after',
        },
      },
    });

    expect(normalized.policy.acknowledgment?.text).toBe(
      'Keep   intentional spaces.\nSecond line.\n\nLast line.',
    );
    expect(acceptedUnicode.success).toBe(true);
    expect(rejectedUnicode.success).toBe(false);
    expect(nullableDraft.success).toBe(true);
    expect(controlCharacter.success).toBe(false);
  });

  it('rejects invisible and bidirectional acknowledgment formatting characters', () => {
    const unsafeCharacters = [
      '\u00AD',
      '\u061C',
      '\u180E',
      '\u200B',
      '\u200C',
      '\u200D',
      '\u200E',
      '\u200F',
      '\u202A',
      '\u202E',
      '\u2060',
      '\u2063',
      '\u2066',
      '\u2069',
      '\uFEFF',
    ];

    for (const unsafeCharacter of unsafeCharacters) {
      const result = bookingPolicyUpdateSchema.safeParse({
        ...createBookingPolicyWithAcknowledgment(),
        policy: {
          ...createBookingPolicyWithAcknowledgment().policy,
          acknowledgment: {
            required: false,
            text: `Review${unsafeCharacter}this policy`,
          },
        },
      });

      expect(result.success).toBe(false);
    }

    const corrected = resolveBookingExperience(
      {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            acknowledgment: {
              required: false,
              text: acknowledgmentText,
            },
          },
        },
      },
      { includeAcknowledgmentConfiguration: true },
    );
    const unsafeStored = resolveBookingExperience(
      {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            acknowledgment: {
              required: true,
              text: `Review\u202Ethis policy`,
            },
          },
        },
      },
      { includeAcknowledgmentConfiguration: true },
    );

    expect(corrected.policy.version).toMatch(
      /^policy-v1:[a-f0-9]{64}$/u,
    );
    expect(unsafeStored.policy.acknowledgment).toEqual({
      required: false,
      text: null,
    });
    expect(unsafeStored.policy.version).toBeNull();
  });

  it('forces required acknowledgment policy visibility and validates both texts', () => {
    const forced = bookingPolicyUpdateSchema.parse({
      ...createBookingPolicyWithAcknowledgment({
        required: true,
        text: acknowledgmentText,
      }),
      policy: {
        ...createBookingPolicyWithAcknowledgment().policy,
        enabled: false,
        showBeforeConfirmation: false,
        acknowledgment: {
          required: true,
          text: acknowledgmentText,
        },
      },
    });
    const missingPolicyText = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicyWithAcknowledgment({
        required: true,
        text: acknowledgmentText,
      }),
      policy: {
        ...createBookingPolicyWithAcknowledgment().policy,
        enabled: false,
        text: null,
        acknowledgment: {
          required: true,
          text: acknowledgmentText,
        },
      },
    });
    const missingAcknowledgmentText = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicyWithAcknowledgment({
        required: true,
        text: null,
      }),
    });

    expect(forced.policy.enabled).toBe(true);
    expect(forced.policy.showBeforeConfirmation).toBe(true);
    expect(missingPolicyText.success).toBe(false);
    expect(missingAcknowledgmentText.success).toBe(false);
  });

  it('exposes only fully valid required acknowledgment on the customer projection', () => {
    const requiredStoredPolicy = {
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
        enabled: false,
        showBeforeConfirmation: false,
        acknowledgment: {
          required: true,
          text: acknowledgmentText,
        },
      },
    };
    const customerRequired = resolveBookingExperience({
      bookingExperience: requiredStoredPolicy,
    });
    const customerDraft = resolveBookingExperience({
      bookingExperience: {
        ...requiredStoredPolicy,
        policy: {
          ...requiredStoredPolicy.policy,
          acknowledgment: {
            required: false,
            text: acknowledgmentText,
          },
        },
      },
    });

    expect(customerRequired.policy.enabled).toBe(true);
    expect(customerRequired.policy.showBeforeConfirmation).toBe(true);
    expect(customerRequired.policy.acknowledgment).toEqual({
      required: true,
      text: acknowledgmentText,
    });
    expect(customerRequired.policy.version).toMatch(
      /^policy-v1:[a-f0-9]{64}$/u,
    );
    expect(customerDraft.policy).not.toHaveProperty('acknowledgment');
    expect(customerDraft.policy).not.toHaveProperty('version');
  });

  it('generates the exact deterministic policy fingerprint from normalized visible content', () => {
    const resolved = resolveBookingExperience({
      bookingExperience: {
        ...createBookingExperience(),
        policy: {
          ...createBookingExperience().policy,
          title: '   ',
          text: '  Give   24 hours notice.  \r\nThank you.   ',
          acknowledgment: {
            required: false,
            text: '  I understand.  \r\n\r\n\r\nPlease contact the salon.   ',
          },
          version: 'policy-v1:not-trusted',
        },
      },
    } as unknown as Parameters<typeof resolveBookingExperience>[0], {
      includeAcknowledgmentConfiguration: true,
    });
    const canonicalPayload = JSON.stringify({
      schemaVersion: 1,
      title: DEFAULT_BOOKING_POLICY_TITLE,
      text: 'Give   24 hours notice.\nThank you.',
      acknowledgmentText: 'I understand.\n\nPlease contact the salon.',
    });
    const expectedVersion = `policy-v1:${
      createHash('sha256').update(canonicalPayload, 'utf8').digest('hex')
    }`;

    expect(resolved.policy.title).toBeNull();
    expect(resolved.policy.text).toBe(
      'Give   24 hours notice.\nThank you.',
    );
    expect(resolved.policy.acknowledgment.text).toBe(
      'I understand.\n\nPlease contact the salon.',
    );
    expect(resolved.policy.version).toBe(expectedVersion);
    expect(resolved.policy.version).toMatch(/^policy-v1:[a-f0-9]{64}$/u);
    expect(
      resolveBookingExperience(
        {
          bookingExperience: {
            ...createBookingExperience(),
            policy: {
              ...createBookingExperience().policy,
              title: null,
              text: 'Give   24 hours notice.\nThank you.',
              acknowledgment: {
                required: false,
                text: 'I understand.\n\nPlease contact the salon.',
              },
            },
          },
        },
        { includeAcknowledgmentConfiguration: true },
      ).policy.version,
    ).toBe(expectedVersion);
  });

  it('versions accepted wording only and ignores placement, badge, appearance, and message changes', () => {
    const canonical = {
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
        title: 'Deposit and cancellation policy',
        text: 'Please provide 24 hours notice.',
        acknowledgment: {
          required: false,
          text: acknowledgmentText,
        },
      },
    };
    const versionFor = (bookingExperience: unknown) =>
      resolveBookingExperience(
        {
          bookingExperience,
        } as Parameters<typeof resolveBookingExperience>[0],
        { includeAcknowledgmentConfiguration: true },
      ).policy.version;
    const originalVersion = versionFor(canonical);

    expect(originalVersion).toMatch(/^policy-v1:[a-f0-9]{64}$/u);
    expect(versionFor(canonical)).toBe(originalVersion);
    expect(versionFor({
      ...canonical,
      policy: {
        ...canonical.policy,
        title: 'Updated title',
      },
    })).not.toBe(originalVersion);
    expect(versionFor({
      ...canonical,
      policy: {
        ...canonical.policy,
        text: 'Please provide 48 hours notice.',
      },
    })).not.toBe(originalVersion);
    expect(versionFor({
      ...canonical,
      policy: {
        ...canonical.policy,
        acknowledgment: {
          required: false,
          text: `${acknowledgmentText} Thank you.`,
        },
      },
    })).not.toBe(originalVersion);

    expect(versionFor({
      ...canonical,
      primaryColor: '#ABCDEF',
      bookingMessage: 'Different booking message',
      confirmationMessage: 'Different confirmation message',
      socialLinks: {
        instagram: null,
        facebook: null,
        tiktok: null,
      },
      policy: {
        ...canonical.policy,
        showOnServicePage: false,
        showBeforeConfirmation: false,
        showAfterConfirmation: false,
        showInConfirmationEmail: false,
      },
      quickFacts: {
        ...canonical.quickFacts,
        depositNotice: {
          enabled: true,
          label: '$15 deposit required',
        },
      },
    })).toBe(originalVersion);
  });

  it('fails malformed stored acknowledgment data closed without hiding valid policy fields', () => {
    const resolveAcknowledgment = (acknowledgment: unknown) =>
      resolveBookingExperience(
        {
          bookingExperience: {
            ...createBookingExperience(),
            policy: {
              ...createBookingExperience().policy,
              acknowledgment,
            },
          },
        } as unknown as Parameters<typeof resolveBookingExperience>[0],
        { includeAcknowledgmentConfiguration: true },
      );

    for (const acknowledgment of [
      undefined,
      'invalid',
      [],
      { required: true },
      { required: true, text: 'a'.repeat(221) },
      { required: true, text: 'bad\u0000text' },
      { required: true, text: 'misleading\u202Etext' },
    ]) {
      const resolved = resolveAcknowledgment(acknowledgment);

      expect(resolved.policy.enabled).toBe(true);
      expect(resolved.policy.title).toBe('Before you book');
      expect(resolved.policy.text).toBe(
        'Please arrive five minutes early.',
      );
      expect(resolved.quickFacts.appointmentOnly.enabled).toBe(true);
      expect(resolved.policy.acknowledgment).toEqual({
        required: false,
        text: null,
      });
      expect(resolved.policy.version).toBeNull();
    }

    const invalidRequired = resolveAcknowledgment({
      required: 'true',
      text: 'Valid draft wording',
    });
    const partialText = resolveAcknowledgment({
      text: 'Valid draft wording',
    });
    const validRequired = resolveAcknowledgment({
      required: true,
      text: 'Valid draft wording',
    });

    expect(invalidRequired.policy.acknowledgment).toEqual({
      required: false,
      text: 'Valid draft wording',
    });
    expect(partialText.policy.acknowledgment).toEqual({
      required: false,
      text: 'Valid draft wording',
    });
    expect(validRequired.policy.acknowledgment).toEqual({
      required: true,
      text: 'Valid draft wording',
    });
    expect(invalidRequired.policy.version).toMatch(
      /^policy-v1:[a-f0-9]{64}$/u,
    );
  });

  it('does not version an unavailable canonical policy or acknowledgment', () => {
    const missingPolicy = resolveBookingExperience(
      {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            enabled: false,
            text: null,
            acknowledgment: {
              required: false,
              text: acknowledgmentText,
            },
          },
        },
      } as unknown as Parameters<typeof resolveBookingExperience>[0],
      { includeAcknowledgmentConfiguration: true },
    );
    const missingAcknowledgment = resolveBookingExperience(
      {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            acknowledgment: {
              required: false,
              text: null,
            },
          },
        },
      } as unknown as Parameters<typeof resolveBookingExperience>[0],
      { includeAcknowledgmentConfiguration: true },
    );

    expect(missingPolicy.policy.version).toBeNull();
    expect(missingAcknowledgment.policy.version).toBeNull();
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
        ...createBookingExperience().policy,
        enabled: true,
        title: null,
        text: '   ',
      },
    });
    const disabledDraft = bookingExperienceUpdateSchema.safeParse({
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
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

  it('requires explicit enabled quick-fact labels and enforces the 40-character limit', () => {
    const enabledWithoutLabel = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicy(),
      quickFacts: {
        ...createBookingExperience().quickFacts,
        depositNotice: {
          enabled: true,
          label: '   ',
        },
      },
    });
    const overlongLabel = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicy(),
      quickFacts: {
        ...createBookingExperience().quickFacts,
        cancellationNotice: {
          enabled: true,
          label: 'a'.repeat(41),
        },
      },
    });
    const disabledDraft = bookingPolicyUpdateSchema.safeParse({
      ...createBookingPolicy(),
      quickFacts: {
        ...createBookingExperience().quickFacts,
        depositNotice: {
          enabled: false,
          label: 'Deposit may be required',
        },
      },
    });

    expect(enabledWithoutLabel.success).toBe(false);
    expect(overlongLabel.success).toBe(false);
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

    const resolved = resolveBookingExperience(
      {
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
      } as unknown as Parameters<typeof resolveBookingExperience>[0],
      { includeAcknowledgmentConfiguration: true },
    );

    expect(resolved).toEqual({
      ...BOOKING_EXPERIENCE_DEFAULTS,
      bookingMessage: 'A valid stored message',
      policy: {
        enabled: false,
        title: 'Draft title',
        text: null,
        showOnServicePage: true,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: true,
        acknowledgment: {
          required: false,
          text: null,
        },
        version: null,
      },
      socialLinks: {
        instagram: 'https://instagram.com/valid',
        facebook: null,
        tiktok: null,
      },
      confirmationMessage: 'Valid confirmation',
    });
  });

  it('uses the legacy Appointment Only boolean only when no explicit replacement exists', () => {
    const legacy = resolveBookingExperience({
      bookingExperience: {
        appointmentOnly: true,
      },
    } as Parameters<typeof resolveBookingExperience>[0]);
    const explicit = resolveBookingExperience({
      bookingExperience: {
        appointmentOnly: true,
        quickFacts: {
          appointmentOnly: {
            enabled: false,
            label: null,
          },
        },
      },
    } as unknown as Parameters<typeof resolveBookingExperience>[0]);
    const malformedExplicit = resolveBookingExperience({
      bookingExperience: {
        appointmentOnly: true,
        quickFacts: {
          appointmentOnly: 'invalid',
        },
      },
    } as unknown as Parameters<typeof resolveBookingExperience>[0]);

    expect(legacy.quickFacts.appointmentOnly).toEqual({
      enabled: true,
      label: 'Appointment only',
    });
    expect(explicit.quickFacts.appointmentOnly).toEqual({
      enabled: false,
      label: null,
    });
    expect(malformedExplicit.quickFacts.appointmentOnly).toEqual({
      enabled: false,
      label: null,
    });
    expect(legacy).not.toHaveProperty('appointmentOnly');
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

    expect(defaultsBody.bookingExperience).toEqual({
      ...BOOKING_EXPERIENCE_DEFAULTS,
      policy: {
        ...BOOKING_EXPERIENCE_DEFAULTS.policy,
        acknowledgment: {
          required: false,
          text: null,
        },
        version: null,
      },
    });
  });

  it('returns a server-generated version and ignores a stored fake version', async () => {
    const storedBookingExperience = {
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
        acknowledgment: {
          required: false,
          text: acknowledgmentText,
        },
        version: 'policy-v1:client-controlled',
      },
    };
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: storedBookingExperience,
      },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.policy.version).toMatch(
      /^policy-v1:[a-f0-9]{64}$/u,
    );
    expect(body.bookingExperience.policy.version).not.toBe(
      'policy-v1:client-controlled',
    );
    expect(body.bookingExperience.policy.version).toBe(
      resolveBookingExperience(
        {
          bookingExperience: storedBookingExperience,
        } as unknown as Parameters<typeof resolveBookingExperience>[0],
        { includeAcknowledgmentConfiguration: true },
      )
        .policy.version,
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
    const legacySettings = {
      bookingExperience: {
        appointmentOnly: true,
      },
    };
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: legacySettings,
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingPolicy: {
            ...createBookingPolicy(),
            policy: {
              ...createBookingExperience().policy,
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
    expect(legacySettings.bookingExperience.appointmentOnly).toBe(true);
  });

  it('rejects malformed and unknown request fields without writing', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);
    const invalidBodies: Array<string> = [
      '{',
      'null',
      '[]',
      '"primitive"',
      JSON.stringify({
        version: 'policy-v1:client-controlled',
      }),
      JSON.stringify({
        fingerprint: 'client-controlled',
      }),
      JSON.stringify({
        bookingPolicy: {
          ...createBookingPolicyWithAcknowledgment(),
          version: 'policy-v1:client-controlled',
        },
      }),
      JSON.stringify({
        bookingPolicy: {
          ...createBookingPolicyWithAcknowledgment(),
          policy: {
            ...createBookingPolicyWithAcknowledgment().policy,
            version: 'policy-v1:client-controlled',
          },
        },
      }),
      JSON.stringify({
        bookingPolicy: {
          ...createBookingPolicyWithAcknowledgment(),
          policy: {
            ...createBookingPolicyWithAcknowledgment().policy,
            acknowledgment: {
              required: false,
              text: acknowledgmentText,
              fingerprint: 'client-controlled',
            },
          },
        },
      }),
    ];

    for (const body of invalidBodies) {
      const response = await PATCH(
        new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: 'Invalid request data',
      });
    }

    expect(db.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects the legacy full-object PATCH with a typed refresh response', async () => {
    getSalonBySlug.mockResolvedValue(baseSalon);

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingExperience: createBookingExperience(),
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'BOOKING_EXPERIENCE_REFRESH_REQUIRED',
      message:
        'Booking Experience settings changed. Refresh Settings and try again.',
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('persists only appearance subpaths with jsonb_set and preserves unrelated settings', async () => {
    const bookingExperienceAppearance = {
      ...createBookingExperienceAppearance(),
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
          ...createBookingExperience(),
          ...bookingExperienceAppearance,
          primaryColor: '#F5D000',
          bookingMessage: 'A private welcome message',
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingExperienceAppearance }),
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

    const paramValues = collectSqlStringChunks(setPayload.settings);

    expect(paramValues.some(value => value.includes('"#F5D000"'))).toBe(true);
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
          bookingExperienceAppearance: expect.objectContaining({
            bookingMessagePresent: false,
            bookingMessageLength: 0,
          }),
        },
        after: {
          bookingExperienceAppearance: expect.objectContaining({
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

  it('atomically writes explicit quick facts before removing legacy Appointment Only', async () => {
    const bookingPolicy = createBookingPolicy();
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperienceAppearance(),
          appointmentOnly: true,
        },
        unrelatedFutureKey: { keep: true },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperienceAppearance(),
          ...bookingPolicy,
        },
        unrelatedFutureKey: { keep: true },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingPolicy }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.quickFacts.appointmentOnly).toEqual({
      enabled: true,
      label: 'Appointment only',
    });

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const settingsSql = collectSqlStringChunks(setPayload.settings).join(' ');

    expect(settingsSql).toContain('{bookingExperience,policy}');
    expect(settingsSql).toContain('{bookingExperience,quickFacts}');
    expect(settingsSql).toContain(
      `#- '{bookingExperience,appointmentOnly}'`,
    );
    expect(settingsSql.indexOf('{bookingExperience,quickFacts}')).toBeLessThan(
      settingsSql.indexOf(`'{bookingExperience,appointmentOnly}'`),
    );
    expect(JSON.stringify(logAuditEvent.mock.calls[0]?.[0])).not.toContain(
      'Please arrive five minutes early.',
    );
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        before: {
          bookingPolicy: expect.objectContaining({
            quickFacts: expect.objectContaining({
              appointmentOnly: expect.objectContaining({
                enabled: true,
              }),
            }),
          }),
        },
        after: {
          bookingPolicy: expect.objectContaining({
            placements: {
              servicePage: true,
              beforeConfirmation: true,
              afterConfirmation: true,
              confirmationEmail: true,
            },
          }),
        },
      },
    }));
  });

  it('stores a normalized acknowledgment draft with a server-generated version', async () => {
    const bookingPolicy = createBookingPolicyWithAcknowledgment({
      required: false,
      text:
        '  Keep   intentional spaces.  \r\nSecond line.   \r\n\r\n\r\n\r\nLast line.  ',
    });
    const normalizedAcknowledgment
      = 'Keep   intentional spaces.\nSecond line.\n\nLast line.';
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: createBookingExperience(),
        unrelatedFutureKey: { keep: true },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            acknowledgment: {
              required: false,
              text: normalizedAcknowledgment,
            },
          },
        },
        unrelatedFutureKey: { keep: true },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingPolicy }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.policy.acknowledgment).toEqual({
      required: false,
      text: normalizedAcknowledgment,
    });
    expect(body.bookingExperience.policy.version).toMatch(
      /^policy-v1:[a-f0-9]{64}$/u,
    );
    expect(body.bookingExperience.primaryColor).toBe('#123456');
    expect(body.bookingExperience.quickFacts).toEqual(
      createBookingExperience().quickFacts,
    );

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const settingsSql = collectSqlStringChunks(setPayload.settings).join(' ');

    expect(settingsSql).toContain(
      '{bookingExperience,policy,acknowledgment}',
    );
    expect(settingsSql).toContain(
      `#- '{bookingExperience,policy,version}'`,
    );
    expect(settingsSql).not.toContain('policy-v1:');
    expect(settingsSql).not.toContain('unrelatedFutureKey');

    const auditCall = logAuditEvent.mock.calls[0]?.[0];

    expect(auditCall).toEqual(expect.objectContaining({
      metadata: {
        before: {
          bookingPolicy: expect.objectContaining({
            acknowledgment: {
              required: false,
              textConfigured: false,
              textLength: 0,
              versionAvailable: false,
            },
          }),
        },
        after: {
          bookingPolicy: expect.objectContaining({
            acknowledgment: {
              required: false,
              textConfigured: true,
              textLength: Array.from(normalizedAcknowledgment).length,
              versionAvailable: true,
            },
          }),
        },
      },
    }));
    expect(JSON.stringify(auditCall)).not.toContain(
      normalizedAcknowledgment,
    );
    expect(JSON.stringify(auditCall)).not.toContain('policy-v1:');
  });

  it('accepts an explicit disabled acknowledgment with null draft wording', async () => {
    const bookingPolicy = createBookingPolicyWithAcknowledgment({
      required: false,
      text: null,
    });
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            acknowledgment: {
              required: false,
              text: 'Remove this draft.',
            },
          },
        },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            acknowledgment: {
              required: false,
              text: null,
            },
          },
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingPolicy }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.policy.acknowledgment).toEqual({
      required: false,
      text: null,
    });
    expect(body.bookingExperience.policy.version).toBeNull();
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('preserves acknowledgment atomically when a v1.39 policy editor omits it', async () => {
    const savedAcknowledgment = {
      required: false,
      text: 'Preserve this draft wording.',
    };
    const storedBookingExperience = {
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
        acknowledgment: savedAcknowledgment,
      },
    };
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: storedBookingExperience,
        unrelatedFutureKey: { keep: true },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        bookingExperience: storedBookingExperience,
        unrelatedFutureKey: { keep: true },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingPolicy: createBookingPolicy(),
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.policy.acknowledgment).toEqual(
      savedAcknowledgment,
    );
    expect(body.bookingExperience.policy.version).toMatch(
      /^policy-v1:[a-f0-9]{64}$/u,
    );

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const settingsSql = collectSqlStringChunks(setPayload.settings).join(' ');

    expect(settingsSql).not.toContain(
      '{bookingExperience,policy,acknowledgment}',
    );
    expect(settingsSql).not.toContain(savedAcknowledgment.text);
    expect(settingsSql).toContain('{bookingExperience,policy,title}');
    expect(settingsSql).toContain('{bookingExperience,quickFacts}');
  });

  it('prevents an older editor from disabling a saved required policy', async () => {
    const savedAcknowledgment = {
      required: true,
      text: acknowledgmentText,
    };
    const storedBookingExperience = {
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
        acknowledgment: savedAcknowledgment,
      },
    };
    const legacyPolicyUpdate = {
      ...createBookingPolicy(),
      policy: {
        ...createBookingPolicy().policy,
        enabled: false,
        showBeforeConfirmation: false,
      },
    };
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: storedBookingExperience,
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...storedBookingExperience,
          policy: {
            ...legacyPolicyUpdate.policy,
            enabled: true,
            showBeforeConfirmation: true,
            acknowledgment: savedAcknowledgment,
          },
          quickFacts: legacyPolicyUpdate.quickFacts,
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingPolicy: legacyPolicyUpdate,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.policy).toEqual(expect.objectContaining({
      enabled: true,
      showBeforeConfirmation: true,
      acknowledgment: savedAcknowledgment,
    }));

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const settingsSql = collectSqlStringChunks(setPayload.settings).join(' ');

    expect(settingsSql).toContain(
      `#>'{bookingExperience,policy,acknowledgment,required}'`,
    );
    expect(settingsSql).not.toContain(
      '{bookingExperience,policy,acknowledgment}',
    );
  });

  it('preserves concurrently-required policy text from a stale null update', async () => {
    const stalePolicyUpdate = {
      ...createBookingPolicy(),
      policy: {
        ...createBookingPolicy().policy,
        enabled: false,
        text: null,
        showBeforeConfirmation: false,
      },
    };
    const concurrentPolicyText = 'Keep this concurrently required policy.';
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            enabled: false,
            acknowledgment: {
              required: false,
              text: null,
            },
          },
        },
      },
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...createBookingExperience().policy,
            enabled: true,
            text: concurrentPolicyText,
            showBeforeConfirmation: true,
            acknowledgment: {
              required: true,
              text: acknowledgmentText,
            },
          },
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingPolicy: stalePolicyUpdate,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.policy).toEqual(expect.objectContaining({
      enabled: true,
      text: concurrentPolicyText,
      showBeforeConfirmation: true,
      acknowledgment: {
        required: true,
        text: acknowledgmentText,
      },
    }));

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const settingsSql = collectSqlStringChunks(setPayload.settings).join(' ');

    expect(settingsSql).toContain('COALESCE');
    expect(settingsSql).toContain(
      `#>'{bookingExperience,policy,text}'`,
    );
    expect(settingsSql).toContain(
      `#>'{bookingExperience,policy,acknowledgment,required}'`,
    );
  });

  it('enables required acknowledgment and persists forced policy visibility', async () => {
    const savedSettings = {
      bookingExperience: {
        ...createBookingExperience(),
        policy: {
          ...createBookingExperience().policy,
          acknowledgment: {
            required: false,
            text: 'Keep this saved draft.',
          },
        },
      },
    };
    const requestedBookingPolicy = {
      ...createBookingPolicyWithAcknowledgment({
        required: true,
        text: acknowledgmentText,
      }),
      policy: {
        ...createBookingPolicyWithAcknowledgment().policy,
        enabled: false,
        showBeforeConfirmation: false,
        acknowledgment: {
          required: true,
          text: acknowledgmentText,
        },
      },
    };
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: savedSettings,
    });
    updatedRows.push({
      ...baseSalon,
      settings: {
        bookingExperience: {
          ...createBookingExperience(),
          policy: {
            ...requestedBookingPolicy.policy,
            enabled: true,
            showBeforeConfirmation: true,
          },
        },
      },
    });

    const response = await PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingPolicy: requestedBookingPolicy,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bookingExperience.policy).toEqual(expect.objectContaining({
      enabled: true,
      showBeforeConfirmation: true,
      acknowledgment: {
        required: true,
        text: acknowledgmentText,
      },
    }));
    expect(body.bookingExperience.policy.version).toMatch(
      /^policy-v1:[a-f0-9]{64}$/u,
    );
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {
        before: {
          bookingPolicy: expect.objectContaining({
            acknowledgment: expect.objectContaining({
              required: false,
            }),
          }),
        },
        after: {
          bookingPolicy: expect.objectContaining({
            acknowledgment: expect.objectContaining({
              required: true,
              versionAvailable: true,
            }),
            placements: expect.objectContaining({
              beforeConfirmation: true,
            }),
          }),
        },
      },
    }));
    expect(JSON.stringify(logAuditEvent.mock.calls[0]?.[0])).not.toContain(
      acknowledgmentText,
    );
  });

  it('rejects incomplete or unsafe required acknowledgment with zero mutation', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        bookingExperience: createBookingExperience(),
      },
    });

    const invalidPolicies = [
      createBookingPolicyWithAcknowledgment({
        required: true,
        text: null,
      }),
      {
        ...createBookingPolicyWithAcknowledgment({
          required: true,
          text: acknowledgmentText,
        }),
        policy: {
          ...createBookingPolicyWithAcknowledgment().policy,
          text: null,
          acknowledgment: {
            required: true,
            text: acknowledgmentText,
          },
        },
      },
      createBookingPolicyWithAcknowledgment({
        required: true,
        text: 'Review\u2066this policy',
      }),
    ];

    for (const bookingPolicy of invalidPolicies) {
      const response = await PATCH(
        new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingPolicy }),
        }),
      );

      expect(response.status).toBe(400);
    }

    expect(db.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('returns saved customization with locked entitlement metadata for a free salon', async () => {
    const savedBookingExperience = {
      ...createBookingExperience(),
      policy: {
        ...createBookingExperience().policy,
        acknowledgment: {
          required: false,
          text: acknowledgmentText,
        },
      },
    };
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
    expect(body.bookingExperience).toEqual(
      resolveBookingExperience(
        {
          bookingExperience: savedBookingExperience,
        },
        { includeAcknowledgmentConfiguration: true },
      ),
    );
    expect(body.bookingExperience.policy.acknowledgment.text).toBe(
      acknowledgmentText,
    );
    expect(body.bookingExperience.policy.version).toMatch(
      /^policy-v1:[a-f0-9]{64}$/u,
    );
    expect(body.bookingExperienceEntitlement).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: false,
      source: 'plan',
      planKey: 'free',
      storedPlan: 'free',
      lockedReason: 'upgrade_required',
    });
  });

  it('rejects targeted customization PATCHes before required acknowledgment validation when locked', async () => {
    const savedBookingExperience = {
      ...createBookingExperience(),
      bookingMessage: 'Keep this saved message.',
      policy: {
        ...createBookingExperience().policy,
        acknowledgment: {
          required: false,
          text: 'Keep this saved acknowledgment draft.',
        },
      },
    };
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      plan: 'free',
      settings: {
        bookingExperience: savedBookingExperience,
        unrelatedFutureKey: { keep: true },
      },
    });

    for (const update of [
      {
        bookingExperienceAppearance: {
          ...createBookingExperienceAppearance(),
          bookingMessage: 'Attempted replacement.',
        },
      },
      {
        bookingPolicy: createBookingPolicy(),
      },
      {
        bookingPolicy: createBookingPolicyWithAcknowledgment({
          required: true,
          text: acknowledgmentText,
        }),
      },
    ]) {
      const response = await PATCH(
        new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
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
    }

    expect(db.update).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(savedBookingExperience.policy.acknowledgment.text).toBe(
      'Keep this saved acknowledgment draft.',
    );
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
          bookingExperienceAppearance: createBookingExperienceAppearance(),
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

  it('safely writes targeted appearance fields over null and non-object JSONB settings', async () => {
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
          jsonb_set(
            CASE
              WHEN jsonb_typeof(settings) = 'object' THEN settings
              ELSE '{}'::jsonb
            END,
            '{bookingExperience}',
            CASE
              WHEN jsonb_typeof(settings->'bookingExperience') = 'object'
                THEN settings->'bookingExperience'
              ELSE '{}'::jsonb
            END
          ),
          '{bookingExperience,bookingMessage}',
          '"Saved customization"'::jsonb
        )
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

  it('preserves concurrent appearance and policy saves with PostgreSQL JSONB updates', async () => {
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
            "bookingExperience":{
              "bookingMessage":"Original",
              "appointmentOnly":true,
              "policy":{
                "enabled":false,
                "title":null,
                "text":null,
                "showOnServicePage":true,
                "showBeforeConfirmation":true,
                "showAfterConfirmation":true,
                "showInConfirmationEmail":true,
                "acknowledgment":{
                  "required":false,
                  "text":"Original acknowledgment draft."
                },
                "version":"policy-v1:stored-fake"
              }
            },
            "unrelatedFutureKey":{"keep":true}
          }'::jsonb
        );
      `);

      await Promise.all([
        database.exec(`
          UPDATE salon_settings_concurrency
          SET settings = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  CASE
                    WHEN jsonb_typeof(settings) = 'object' THEN settings
                    ELSE '{}'::jsonb
                  END,
                  '{bookingExperience}',
                  CASE
                    WHEN jsonb_typeof(settings->'bookingExperience') = 'object'
                      THEN settings->'bookingExperience'
                    ELSE '{}'::jsonb
                  END
                ),
                '{bookingExperience,bookingMessage}',
                '"Saved appearance"'::jsonb
              ),
              '{bookingExperience,primaryColor}',
              '"#AABBCC"'::jsonb
            ),
            '{bookingExperience,socialLinks}',
            '{"instagram":"https://instagram.com/new","facebook":null,"tiktok":null}'::jsonb
          )
          WHERE id = 'salon_1'
        `),
        database.exec(`
          UPDATE salon_settings_concurrency
          SET settings = (
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        CASE
                          WHEN jsonb_typeof(settings) = 'object' THEN settings
                          ELSE '{}'::jsonb
                        END,
                        '{bookingExperience,policy,enabled}',
                        'true'::jsonb
                      ),
                      '{bookingExperience,policy,title}',
                      '"Booking policy"'::jsonb
                    ),
                    '{bookingExperience,policy,text}',
                    '"Give 24 hours notice."'::jsonb
                  ),
                  '{bookingExperience,policy,showBeforeConfirmation}',
                  'false'::jsonb
                ),
                '{bookingExperience,quickFacts}',
                '{
                  "appointmentOnly":{"enabled":true,"label":"Appointment only"},
                  "depositNotice":{"enabled":false,"label":null},
                  "cancellationNotice":{"enabled":true,"label":"24-hour policy"}
                }'::jsonb
              ),
              '{bookingExperience,policy,showAfterConfirmation}',
              'true'::jsonb
            )
              #- '{bookingExperience,policy,version}'
              #- '{bookingExperience,appointmentOnly}'
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
            '{bookingExperience,policy,acknowledgment}',
            '{
              "required":false,
              "text":"Concurrently saved acknowledgment draft."
            }'::jsonb
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
        booking: { bufferMinutes: 10 },
        bookingExperience: {
          bookingMessage: 'Saved appearance',
          primaryColor: '#AABBCC',
          policy: {
            enabled: true,
            title: 'Booking policy',
            text: 'Give 24 hours notice.',
            showOnServicePage: true,
            showBeforeConfirmation: false,
            showAfterConfirmation: true,
            showInConfirmationEmail: true,
            acknowledgment: {
              required: false,
              text: 'Concurrently saved acknowledgment draft.',
            },
          },
          quickFacts: {
            appointmentOnly: {
              enabled: true,
              label: 'Appointment only',
            },
            cancellationNotice: {
              enabled: true,
              label: '24-hour policy',
            },
            depositNotice: {
              enabled: false,
              label: null,
            },
          },
          socialLinks: {
            facebook: null,
            instagram: 'https://instagram.com/new',
            tiktok: null,
          },
        },
        unrelatedFutureKey: { keep: true },
      });
    } finally {
      await database.close();
    }
  });

  it('keeps required policy visibility when a stale editor omits acknowledgment', async () => {
    const database = new PGlite();

    try {
      await database.exec(`
        CREATE TABLE salon_required_policy_concurrency (
          id text PRIMARY KEY,
          settings jsonb NOT NULL
        );
        INSERT INTO salon_required_policy_concurrency (id, settings)
        VALUES (
          'salon_1',
          '{
            "bookingExperience":{
              "policy":{
                "enabled":false,
                "text":"Give 24 hours notice.",
                "showBeforeConfirmation":false,
                "acknowledgment":{
                  "required":false,
                  "text":"I understand."
                }
              }
            }
          }'::jsonb
        );

        UPDATE salon_required_policy_concurrency
        SET settings = jsonb_set(
          jsonb_set(
            jsonb_set(
              settings,
              '{bookingExperience,policy,acknowledgment}',
              '{"required":true,"text":"I understand."}'::jsonb
            ),
            '{bookingExperience,policy,enabled}',
            'true'::jsonb
          ),
          '{bookingExperience,policy,showBeforeConfirmation}',
          'true'::jsonb
        )
        WHERE id = 'salon_1';

        UPDATE salon_required_policy_concurrency
        SET settings = jsonb_set(
          jsonb_set(
            jsonb_set(
              settings,
              '{bookingExperience,policy,enabled}',
              CASE
                WHEN settings#>'{bookingExperience,policy,acknowledgment,required}' = 'true'::jsonb
                  THEN 'true'::jsonb
                ELSE 'false'::jsonb
              END
            ),
            '{bookingExperience,policy,text}',
            CASE
              WHEN settings#>'{bookingExperience,policy,acknowledgment,required}' = 'true'::jsonb
                THEN COALESCE(
                  settings#>'{bookingExperience,policy,text}',
                  'null'::jsonb
                )
              ELSE 'null'::jsonb
            END
          ),
          '{bookingExperience,policy,showBeforeConfirmation}',
          CASE
            WHEN settings#>'{bookingExperience,policy,acknowledgment,required}' = 'true'::jsonb
              THEN 'true'::jsonb
            ELSE 'false'::jsonb
          END
        )
        WHERE id = 'salon_1';
      `);

      const result = await database.query<{
        enabled: boolean;
        policyText: string;
        required: boolean;
        showBeforeConfirmation: boolean;
      }>(`
        SELECT
          (settings#>>'{bookingExperience,policy,enabled}')::boolean AS enabled,
          settings#>>'{bookingExperience,policy,text}' AS "policyText",
          (settings#>>'{bookingExperience,policy,acknowledgment,required}')::boolean AS required,
          (settings#>>'{bookingExperience,policy,showBeforeConfirmation}')::boolean
            AS "showBeforeConfirmation"
        FROM salon_required_policy_concurrency
        WHERE id = 'salon_1'
      `);

      expect(result.rows).toEqual([{
        enabled: true,
        policyText: 'Give 24 hours notice.',
        required: true,
        showBeforeConfirmation: true,
      }]);
    } finally {
      await database.close();
    }
  });
});

// =============================================================================
// D3 — deposits (Group C)
// =============================================================================

describe('/api/admin/salon/settings deposits', () => {
  const baseSalon = {
    id: 'salon_1',
    slug: 'salon-a',
    ownerPhone: '4169021427',
    ownerEmail: 'owner@example.com',
    reviewsEnabled: true,
    rewardsEnabled: true,
    billingMode: 'NONE',
    stripeSubscriptionStatus: null,
    features: { money: { deposits: true } },
    settings: {},
  };

  const chargeReadyBinding = {
    id: 'ssa_1',
    salonId: 'salon_1',
    stripeAccountId: 'acct_1',
    livemode: false,
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    requirements: {
      currentlyDue: [],
      eventuallyDue: [],
      pastDue: [],
      pendingVerification: [],
      currentDeadline: null,
      futureCurrentDeadline: null,
    },
    disabledReason: null,
    connectedAt: new Date(),
    revokedAt: null,
    revocationCause: null,
    lastSyncedAt: new Date(),
  };

  function patch(body: unknown) {
    return PATCH(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  function settingsSqlFor(callIndex = 0) {
    const setPayload = db.update.mock.results[callIndex]!.value.set.mock.calls[0]![0];
    // MUST be `collectSqlStringChunks`: the `queryChunks.filter(typeof ===
    // 'string')` idiom keeps only interpolated JSON parameter VALUES, so a
    // `'{payments,deposit,…}'` assertion would fail against correct code and a
    // `.not.toContain` assertion would pass vacuously.
    return collectSqlStringChunks(setPayload.settings).join(' ');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    updatedRows.length = 0;
    selectResults.length = 0;

    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });
    getBookingConfigForSalon.mockResolvedValue({});
    resolveBookingConfigFromSettings.mockReturnValue({ currency: 'CAD' });
    getDefaultLoyaltyPoints.mockReturnValue({});
    resolveSalonLoyaltyPoints.mockReturnValue({});
    getSalonBySlug.mockResolvedValue(baseSalon);
    refreshAccountReadiness.mockResolvedValue({
      chargeReady: true,
      status: 'charge_ready',
      payoutsPending: false,
      binding: chargeReadyBinding,
    });
    getDepositPolicyForSalon.mockResolvedValue({
      active: false,
      reason: 'not_configured',
      amountCents: null,
      readinessStale: false,
      readinessAgeMs: null,
    });
    updatedRows.push({ ...baseSalon });
  });

  // ---------------------------------------------------------------------------
  // 1c — the route validates against the WRITE schema
  // ---------------------------------------------------------------------------
  it('test 1c — rejects every out-of-window amount with a 400 and never writes', async () => {
    for (const amountCents of [0, 49, 25.5, 99_999_999]) {
      vi.clearAllMocks();
      getSalonBySlug.mockResolvedValue(baseSalon);
      requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });

      const response = await patch({ payments: { deposit: { enabled: false, amountCents } } });

      expect(response.status).toBe(400);
      expect((await response.json()).details).toBeDefined();
      expect(db.update).not.toHaveBeenCalled();
    }

    vi.clearAllMocks();
    getSalonBySlug.mockResolvedValue(baseSalon);
    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });
    const stringAmount = await patch({ payments: { deposit: { amountCents: '50' } } });

    expect(stringAmount.status).toBe(400);
  });

  it('test 1c — accepts the minimum', async () => {
    const response = await patch({ payments: { deposit: { amountCents: 50 } } });

    expect(response.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // 14 / 15 / 16 / 16b — the enable gate
  // ---------------------------------------------------------------------------
  it('test 14 — no binding row refuses STRIPE_ACCOUNT_NOT_CONNECTED and never writes', async () => {
    refreshAccountReadiness.mockResolvedValue({
      chargeReady: false,
      status: 'not_connected',
      binding: null,
    });

    const response = await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('STRIPE_ACCOUNT_NOT_CONNECTED');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('test 15 — a non-charge-ready account refuses with the disabled reason', async () => {
    refreshAccountReadiness.mockResolvedValue({
      chargeReady: false,
      status: 'restricted',
      binding: { ...chargeReadyBinding, chargesEnabled: false, disabledReason: 'requirements.past_due' },
    });

    const response = await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe('STRIPE_ACCOUNT_NOT_CHARGE_READY');
    expect(body.details.disabledReason).toBe('requirements.past_due');
    expect(body.details.requirements).toBeDefined();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('test 16 — a throwing readiness proof is a retryable 503 with nothing persisted', async () => {
    refreshAccountReadiness.mockRejectedValue(new Error('PROVIDER_UNREACHABLE'));

    const response = await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('DEPOSIT_ENABLE_RETRY');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('test 16b — the readiness proof is called with EXACTLY ONE argument', async () => {
    await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });

    expect(refreshAccountReadiness).toHaveBeenCalledTimes(1);
    expect(refreshAccountReadiness.mock.calls[0]).toEqual(['salon_1']);
  });

  // ---------------------------------------------------------------------------
  // 17 / 17b / 17c / 17d — currency, and the fail-open resolver it must not use
  // ---------------------------------------------------------------------------
  it('test 17 / 17b — setting a foreign currency and enabling together is refused', async () => {
    const response = await patch({
      bookingConfig: { currency: 'USD' },
      payments: { deposit: { enabled: true, amountCents: 2500 } },
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('DEPOSIT_CURRENCY_UNSUPPORTED');
    expect(refreshAccountReadiness).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('test 17c — a currency-only PATCH is refused when deposits are ENABLED, with zero provider calls', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });

    const response = await patch({ bookingConfig: { currency: 'USD' } });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('DEPOSIT_CURRENCY_UNSUPPORTED');
    expect(refreshAccountReadiness).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('test 17c — and it stays 200 when deposits are stored DISABLED', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: false, amountCents: 2500 } } },
    });

    const response = await patch({ bookingConfig: { currency: 'USD' } });

    expect(response.status).toBe(200);
    expect(refreshAccountReadiness).not.toHaveBeenCalled();
  });

  it('test 17d — a corrupt stored booking block must NOT pass by falling back to CAD defaults', async () => {
    // This, not the pure-resolver test, is what makes the fail-open mutation
    // detectable: the resolver would return CAD defaults for this settings blob.
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        booking: { currency: 'USD', slotIntervalMinutes: 7 },
        payments: { deposit: { enabled: false, amountCents: 2500 } },
      },
    });
    resolveBookingConfigFromSettings.mockReturnValue({ currency: 'CAD' });

    // The body carries a bookingConfig key but NOT a currency, which is exactly
    // when the route builds `nextSettings.booking` from the fail-open resolver.
    // Reading the gate's currency from either that or the resolver directly
    // would hand back CAD defaults and let this enable through.
    const response = await patch({
      bookingConfig: { bufferMinutes: 15 },
      payments: { deposit: { enabled: true, amountCents: 2500 } },
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('DEPOSIT_CURRENCY_UNSUPPORTED');
    expect(refreshAccountReadiness).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 18 / 18b / 18c / 18d — the write
  // ---------------------------------------------------------------------------
  it('test 18 / 18b — a happy enable writes FIELD-granular sub-paths', async () => {
    const response = await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });

    expect(response.status).toBe(200);

    const sql = settingsSqlFor();

    expect(sql).toContain('{payments}');
    expect(sql).toContain('{payments,deposit}');
    // Field granularity. Reverting to a whole-object value write at
    // `{payments,deposit}` deletes both of these.
    expect(sql).toContain('{payments,deposit,enabled}');
    expect(sql).toContain('{payments,deposit,amountCents}');
  });

  it('test 18c — the enable edge carries a NULL-safe CAS, and both zero-row branches resolve', async () => {
    updatedRows.length = 0;
    selectResults.push([{ id: 'salon_1' }]);

    const conflict = await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });

    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toBe('DEPOSIT_STATE_CHANGED');

    const wherePayload = db.update.mock.results[0]!.value.set.mock.results[0]!.value.where.mock.calls[0]![0];

    // Snapshot EQUALITY, not `IS DISTINCT FROM 'true'::jsonb`: the latter only
    // asserts "not currently enabled", which passes after a concurrent
    // enable-then-disable and lets a slow enable overwrite a committed disable.
    expect(collectSqlStringChunks(wherePayload).join(' ')).toContain('IS NOT DISTINCT FROM');

    vi.clearAllMocks();
    getSalonBySlug.mockResolvedValue(baseSalon);
    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1' } });
    refreshAccountReadiness.mockResolvedValue({
      chargeReady: true,
      status: 'charge_ready',
      payoutsPending: false,
      binding: chargeReadyBinding,
    });
    updatedRows.length = 0;
    selectResults.length = 0;
    selectResults.push([]);

    const deleted = await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });

    expect(deleted.status).toBe(404);
  });

  it('test 18c — a snapshot of stored FALSE compares against that value, not against NULL', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: false, amountCents: 2500 } } },
    });

    const response = await patch({ payments: { deposit: { enabled: true } } });

    expect(response.status).toBe(200);

    const wherePayload = db.update.mock.results[0]!.value.set.mock.results[0]!.value.where.mock.calls[0]![0];
    const chunks = collectSqlStringChunks(wherePayload).join(' ');

    expect(chunks).toContain('IS NOT DISTINCT FROM');
    expect(chunks).toContain('false');
  });

  it('test 18d — an UNGATED patch may not RAISE enabled', async () => {
    // Stored `true`, so no transition, so no gate — and the write must be a
    // live-row-evaluated CASE that can only preserve or lower.
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });

    const response = await patch({ payments: { deposit: { enabled: true, amountCents: 4000 } } });

    expect(response.status).toBe(200);

    const sql = settingsSqlFor();

    expect(sql).toContain('CASE');
    expect(sql).toContain(`#>'{payments,deposit,enabled}' = 'true'::jsonb`);
    expect(sql).toContain(`ELSE 'false'::jsonb`);
  });

  // ---------------------------------------------------------------------------
  // 19 / 20 / 20b / 22 — the remaining gate cases
  // ---------------------------------------------------------------------------
  it('test 19 — enabling without an amount is a 400', async () => {
    const response = await patch({ payments: { deposit: { enabled: true } } });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('DEPOSIT_AMOUNT_REQUIRED');
    expect(refreshAccountReadiness).not.toHaveBeenCalled();
  });

  it('test 20 — disabling is NEVER gated, even with no account row', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });

    const response = await patch({ payments: { deposit: { enabled: false } } });

    expect(response.status).toBe(200);
    expect(refreshAccountReadiness).not.toHaveBeenCalled();
  });

  it('test 20b — ROLE SCOPE PINNED: a plain admin membership may enable deposits today', async () => {
    // `requireAdmin` does not distinguish owner from admin, and super admins
    // short-circuit it. Pinned so a later decision has a test to flip.
    requireAdmin.mockResolvedValue({ ok: true, admin: { id: 'admin_1', role: 'admin' } });

    const response = await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });

    expect(response.status).toBe(200);
  });

  it('test 22 — an idempotent re-save of an identical enabled body makes ZERO provider calls', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });

    const response = await patch({ payments: { deposit: { enabled: true, amountCents: 2500 } } });

    expect(response.status).toBe(200);
    expect(refreshAccountReadiness).toHaveBeenCalledTimes(0);
  });

  // ---------------------------------------------------------------------------
  // 21 / 21b — sub-path isolation
  // ---------------------------------------------------------------------------
  it('test 21 — a tax-only save makes zero provider calls and emits NO deposit path', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });

    const response = await patch({ payments: { tax: { rateBps: 500 } } });

    expect(response.status).toBe(200);
    expect(refreshAccountReadiness).toHaveBeenCalledTimes(0);
    // No trailing comma in the needle: it also catches an unconditional deposit
    // object guard, which would materialise `payments.deposit: {}` into every
    // tenant's settings column on every tax-only save.
    expect(settingsSqlFor()).not.toContain(`'{payments,deposit`);
  });

  it('test 21b — a deposit-only save emits neither the tax nor the e-Transfer path', async () => {
    const response = await patch({ payments: { deposit: { amountCents: 4000 } } });

    expect(response.status).toBe(200);

    const sql = settingsSqlFor();

    expect(sql).not.toContain('{payments,tax}');
    expect(sql).not.toContain('{payments,etransfer}');
    expect(sql).toContain('{payments,deposit,amountCents}');
  });

  // ---------------------------------------------------------------------------
  // 21c / 21d — proved by EXECUTING the generated SQL
  // ---------------------------------------------------------------------------
  it('test 21c — the deposit write preserves merchandising and every unrelated subtree', async () => {
    await patch({ payments: { deposit: { enabled: false, amountCents: 4000 } } });

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const rendered = new PgDialect().sqlToQuery(setPayload.settings as SQL);
    const database = new PGlite();

    try {
      await database.exec(`
        CREATE TABLE "salon" (id text PRIMARY KEY, settings jsonb);
        INSERT INTO "salon" (id, settings) VALUES
          ('full', '{"merchandising":{"featureLusterManicure":false,"showServiceImages":true,"lusterPromoDismissed":false,"serviceLibraryIntroDismissed":false,"futurePreference":"keep"},"payments":{"tax":{"rateBps":1300},"etransfer":{"recipient":"pay@salon.test"},"deposit":{"enabled":true,"amountCents":2500}},"booking":{"currency":"CAD"},"bookingExperience":{"policy":{"enabled":true}},"notifications":{"x":1},"smartFit":{"y":2},"modules":{"z":3},"unrelatedFutureKey":{"keep":true}}'::jsonb),
          ('merchandising_null', '{"merchandising":null,"keep":true}'::jsonb),
          ('merchandising_scalar', '{"merchandising":"legacy","keep":true}'::jsonb),
          ('payments_scalar', '{"payments":"legacy","merchandising":{"showServiceImages":true}}'::jsonb),
          ('settings_null', NULL);
      `);
      await database.query(`UPDATE "salon" SET settings = ${rendered.sql}`, rendered.params);

      const result = await database.query<{ id: string; settings: Record<string, unknown> }>(
        'SELECT id, settings FROM "salon" ORDER BY id',
      );
      const rows = Object.fromEntries(result.rows.map(row => [row.id, row.settings]));

      // `settings` is a non-null OBJECT on every row — the jsonb_set-STRICT
      // guard, proved against real SQL rather than asserted.
      for (const row of result.rows) {
        expect(row.settings).toBeTypeOf('object');
        expect(row.settings).not.toBeNull();
      }

      expect(rows.full).toEqual({
        merchandising: {
          featureLusterManicure: false,
          showServiceImages: true,
          lusterPromoDismissed: false,
          serviceLibraryIntroDismissed: false,
          // A key no schema in this repo knows about, byte-identical.
          futurePreference: 'keep',
        },
        payments: {
          tax: { rateBps: 1300 },
          etransfer: { recipient: 'pay@salon.test' },
          deposit: { enabled: false, amountCents: 4000 },
        },
        booking: { currency: 'CAD' },
        bookingExperience: { policy: { enabled: true } },
        notifications: { x: 1 },
        smartFit: { y: 2 },
        modules: { z: 3 },
        unrelatedFutureKey: { keep: true },
      });
      expect(rows.merchandising_null).toEqual({
        merchandising: null,
        keep: true,
        payments: { deposit: { enabled: false, amountCents: 4000 } },
      });
      expect(rows.merchandising_scalar).toEqual({
        merchandising: 'legacy',
        keep: true,
        payments: { deposit: { enabled: false, amountCents: 4000 } },
      });
      expect(rows.payments_scalar).toEqual({
        merchandising: { showServiceImages: true },
        payments: { deposit: { enabled: false, amountCents: 4000 } },
      });
      expect(rows.settings_null).toEqual({
        payments: { deposit: { enabled: false, amountCents: 4000 } },
      });
    } finally {
      await database.close();
    }
  });

  it('test 21d — the REVERSE: the untouched merchandising write still preserves payments.deposit', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });

    await patch({ merchandising: { showServiceImages: false } });

    const setPayload = db.update.mock.results[0]!.value.set.mock.calls[0]![0];
    const sql = collectSqlStringChunks(setPayload.settings).join(' ');

    expect(sql).toContain('{merchandising,showServiceImages}');
    // Nothing under `payments` may be touched by the merchandising path.
    expect(sql).not.toContain(`'{payments`);
    // The untouched sibling assertions of the service-image PR still hold.
    expect(sql).not.toContain('{merchandising,featureLusterManicure}');
    expect(sql).not.toContain('{merchandising,lusterPromoDismissed}');
    expect(sql).not.toContain('{merchandising,serviceLibraryIntroDismissed}');

    const rendered = new PgDialect().sqlToQuery(setPayload.settings as SQL);
    const database = new PGlite();

    try {
      await database.exec(`
        CREATE TABLE "salon" (id text PRIMARY KEY, settings jsonb);
        INSERT INTO "salon" (id, settings) VALUES
          ('salon_1', '{"merchandising":{"showServiceImages":true,"futurePreference":"keep"},"payments":{"tax":{"rateBps":1300},"deposit":{"enabled":true,"amountCents":2500}}}'::jsonb);
      `);
      await database.query(`UPDATE "salon" SET settings = ${rendered.sql}`, rendered.params);

      const result = await database.query<{ settings: Record<string, any> }>(
        'SELECT settings FROM "salon"',
      );
      const settings = result.rows[0]!.settings;

      expect(settings.merchandising.showServiceImages).toBe(false);
      expect(settings.merchandising.futurePreference).toBe('keep');
      expect(settings.payments.deposit).toEqual({ enabled: true, amountCents: 2500 });
      expect(settings.payments.tax).toEqual({ rateBps: 1300 });
    } finally {
      await database.close();
    }
  });

  // ---------------------------------------------------------------------------
  // 23 / 23b / 23d / 23e — the GET block and the copy warning
  // ---------------------------------------------------------------------------
  it('test 23 / 23b — the GET returns the stored block plus the two gates and the reason', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });
    getDepositPolicyForSalon.mockResolvedValue({
      active: false,
      reason: 'account_not_charge_ready',
      amountCents: 2500,
      readinessStale: true,
      readinessAgeMs: 90_000_000,
    });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(body.payments.deposit).toEqual({ enabled: true, amountCents: 2500 });
    // `collectionLive` mirrors the SHIPPED constant, which the
    // payment-confirmation PR flipped. The owner-facing surface still reports
    // `active: false` for the account reason, which is the point of exposing
    // both gates separately: an owner can see which one is closed.
    expect(body.depositPolicy).toEqual({
      collectionLive: true,
      entitled: true,
      active: false,
      reason: 'account_not_charge_ready',
      readinessStale: true,
      readinessAgeMs: 90_000_000,
    });
    // The overrides are passed explicitly rather than left to the constant, so
    // this assertion keeps meaning the same thing after the flip.
    expect(getDepositPolicyForSalon).toHaveBeenCalledWith(
      expect.objectContaining({ collectionLive: true, entitled: true }),
    );
    // No readiness/account fields, and NEVER the Stripe account id.
    expect(JSON.stringify(body)).not.toContain('acct_');
    expect(body.depositPolicy.chargesEnabled).toBeUndefined();
    expect(body.depositPolicy.disabledReason).toBeUndefined();
  });

  it('test 23e — readinessStale is decoupled from the verdict', async () => {
    getDepositPolicyForSalon.mockResolvedValue({
      active: true,
      amountCents: 2500,
      currency: 'cad',
      readinessStale: true,
      readinessAgeMs: 90_000_000,
    });
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });

    const response = await GET(
      new Request('http://localhost/api/admin/salon/settings?salonSlug=salon-a'),
    );
    const body = await response.json();

    expect(body.depositPolicy.reason).toBeNull();
    expect(body.depositPolicy.readinessStale).toBe(true);
  });

  it('test 23d — the /deposit/i warning sees the acknowledgment text and the confirmation message', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: {
        payments: { deposit: { enabled: true, amountCents: 2500 } },
        bookingExperience: {
          confirmationMessage: 'Your $50 deposit is non-refundable.',
          policy: {
            enabled: true,
            title: 'Booking policy',
            text: 'Please arrive early.',
            acknowledgment: { required: true, text: 'I agree to the $50 deposit terms.' },
          },
        },
      },
    });

    const response = await patch({ payments: { deposit: { amountCents: 2500 } } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.depositCopyWarning).toMatch(/mentions a deposit/i);
  });

  it('test 23d — and it stays silent when no owner copy mentions one', async () => {
    getSalonBySlug.mockResolvedValue({
      ...baseSalon,
      settings: { payments: { deposit: { enabled: true, amountCents: 2500 } } },
    });

    const response = await patch({ payments: { deposit: { amountCents: 2500 } } });

    expect((await response.json()).depositCopyWarning).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 24 — the deposit branch AWAITS the audit write
  // ---------------------------------------------------------------------------
  it('test 24 — a rejected audit write on a deposit change surfaces as a 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    logAuditEvent.mockRejectedValue(new Error('audit sink down'));

    const response = await patch({ payments: { deposit: { amountCents: 4000 } } });

    expect(response.status).toBe(500);

    consoleError.mockRestore();
  });
});
