import { PGlite } from '@electric-sql/pglite';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PUT } from './route';

vi.mock('server-only', () => ({}));

const {
  requireSuperAdmin,
  logAuditAction,
  db,
  setSelectResults,
  setUpdateResult,
  getLastUpdatePayload,
} = vi.hoisted(() => {
  let selectResults: unknown[][] = [];
  let updateResult: unknown[] = [];
  let lastUpdatePayload: unknown = null;

  const setSelectResults = (next: unknown[][]) => {
    selectResults = [...next];
  };

  const setUpdateResult = (next: unknown[]) => {
    updateResult = [...next];
    lastUpdatePayload = null;
  };

  const getLastUpdatePayload = () => lastUpdatePayload;

  const makeQuery = (result: unknown[]) => {
    const query = {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => result),
      offset: vi.fn(async () => result),
      returning: vi.fn(async () => result),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };

    return query;
  };

  const db = {
    select: vi.fn(() => makeQuery(selectResults.shift() ?? [])),
    update: vi.fn(() => {
      const query = {
        set: vi.fn((updates: unknown) => {
          lastUpdatePayload = updates;
          return query;
        }),
        where: vi.fn(() => query),
        returning: vi.fn(async () => updateResult),
      };

      return query;
    }),
  };

  return {
    requireSuperAdmin: vi.fn(),
    logAuditAction: vi.fn(),
    db,
    setSelectResults,
    setUpdateResult,
    getLastUpdatePayload,
  };
});

vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdmin,
  getSuperAdminInfo: vi.fn(),
  logAuditAction,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

function renderFeatureUpdateSql(): string {
  const payload = getLastUpdatePayload() as { features?: unknown };
  return new PgDialect().sqlToQuery(payload.features as SQL).sql;
}

function renderSettingsUpdateSql() {
  const payload = getLastUpdatePayload() as { settings?: unknown };
  return new PgDialect().sqlToQuery(payload.settings as SQL);
}

describe('GET/PUT /api/super-admin/organizations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSelectResults([]);
    setUpdateResult([]);
    requireSuperAdmin.mockResolvedValue(null);
    logAuditAction.mockResolvedValue(undefined);
  });

  it('returns feature entitlements in the salon detail response', async () => {
    setSelectResults([
      [{
        id: 'salon_1',
        name: 'Isla Nail Studio',
        slug: 'isla-nail-studio',
        plan: 'single_salon',
        status: 'active',
        maxLocations: 1,
        isMultiLocationEnabled: false,
        features: {
          booking: { customization: false },
          onlineBooking: true,
          rewards: true,
          visibilityControls: true,
        },
        onlineBookingEnabled: true,
        smsRemindersEnabled: false,
        rewardsEnabled: true,
        profilePageEnabled: true,
        bookingFlowCustomizationEnabled: true,
        bookingFlow: ['service', 'tech', 'time', 'confirm'],
        ownerEmail: null,
        ownerClerkUserId: null,
        internalNotes: null,
        deletedAt: null,
        createdAt: new Date('2026-03-24T00:00:00.000Z'),
        updatedAt: new Date('2026-03-24T00:00:00.000Z'),
      }],
      [{ count: 0 }],
      [{ count: 0 }],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    const response = await GET(
      new Request('http://localhost/api/super-admin/organizations/salon_1'),
      { params: Promise.resolve({ id: 'salon_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.salon.features).toEqual({
      booking: { customization: false },
      onlineBooking: true,
      rewards: true,
      visibilityControls: true,
    });
    expect(body.salon.bookingExperienceEntitlement).toEqual({
      featureKey: 'booking_experience_customization',
      entitled: false,
      source: 'override',
      planKey: 'tier_1',
      storedPlan: 'single_salon',
      lockedReason: 'upgrade_required',
      planDefault: true,
      overrideState: 'force_disabled',
      overrideAuditId: null,
      reason: null,
      actor: null,
      updatedAt: null,
      provenanceRecorded: false,
    });
  });

  it('applies unrelated feature changes through the protected database expression', async () => {
    const updatedSalon = {
      id: 'salon_1',
      name: 'Isla Nail Studio',
      slug: 'isla-nail-studio',
      plan: 'single_salon',
      status: 'active',
      maxLocations: 1,
      isMultiLocationEnabled: false,
      features: {
        onlineBooking: true,
        rewards: true,
        visibilityControls: true,
      },
      onlineBookingEnabled: true,
      smsRemindersEnabled: false,
      rewardsEnabled: true,
      profilePageEnabled: true,
      bookingFlowCustomizationEnabled: true,
      bookingFlow: ['service', 'tech', 'time', 'confirm'],
      ownerEmail: null,
      ownerClerkUserId: null,
      internalNotes: null,
      deletedAt: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    };

    setSelectResults([[updatedSalon]]);
    setUpdateResult([updatedSalon]);

    const response = await PUT(
      new Request('http://localhost/api/super-admin/organizations/salon_1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features: {
            onlineBooking: true,
            rewards: true,
            visibilityControls: true,
          },
          onlineBookingEnabled: true,
          rewardsEnabled: true,
          bookingFlowCustomizationEnabled: true,
        }),
      }),
      { params: Promise.resolve({ id: 'salon_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(renderFeatureUpdateSql()).toContain(`- 'customization'`);
    expect(renderFeatureUpdateSql()).toContain(`- 'customizationOverrideAuditId'`);
    expect(renderFeatureUpdateSql()).toContain('"salon"."features"');
    expect(body.salon.features).toEqual({
      onlineBooking: true,
      rewards: true,
      visibilityControls: true,
    });
    expect(getLastUpdatePayload()).not.toHaveProperty('settings');
    expect(getLastUpdatePayload()).not.toHaveProperty('smsRemindersEnabled');
  });

  it('synchronizes optional modules without changing live owner SMS preferences', async () => {
    const existingSalon = {
      id: 'salon_1',
      name: 'Luster Nail Studio',
      slug: 'luster-nail-studio',
      plan: 'free',
      status: 'active',
      maxLocations: 1,
      isMultiLocationEnabled: false,
      freeSoloEnabled: true,
      features: {},
      settings: {
        booking: { timezone: 'America/Toronto' },
        modules: { analyticsDashboard: false, rewards: false, smsReminders: false },
        communications: { sms: { enabled: false } },
        bookingPageContent: { draft: { bio: 'must remain current' } },
      },
      onlineBookingEnabled: true,
      smsRemindersEnabled: false,
      rewardsEnabled: false,
      profilePageEnabled: true,
      bookingFlowCustomizationEnabled: false,
      bookingFlow: null,
      ownerEmail: null,
      ownerClerkUserId: null,
      internalNotes: null,
      deletedAt: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:00:00.000Z'),
    };
    const enabledFeatures = {
      analytics: { dashboard: true, utilization: true },
      marketing: { rewards: true, referrals: false, smsReminders: false },
    };

    setSelectResults([[existingSalon]]);
    setUpdateResult([{ ...existingSalon, features: enabledFeatures }]);

    const response = await PUT(
      new Request('http://localhost/api/super-admin/organizations/salon_1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features: enabledFeatures,
          syncFeatureModules: true,
        }),
      }),
      { params: Promise.resolve({ id: 'salon_1' }) },
    );

    expect(response.status).toBe(200);

    const settingsQuery = renderSettingsUpdateSql();

    expect(settingsQuery.sql).toContain('jsonb_set');
    expect(settingsQuery.sql).toContain('\'{modules}\'');
    expect(settingsQuery.sql).toContain('"salon"."settings"');
    expect(settingsQuery.params).toHaveLength(1);
    expect(JSON.parse(String(settingsQuery.params[0]))).toMatchObject({
      analyticsDashboard: true,
      utilization: true,
      rewards: true,
      referrals: false,
    });
    expect(JSON.parse(String(settingsQuery.params[0]))).not.toHaveProperty('smsReminders');
    expect(JSON.stringify(settingsQuery.params)).not.toContain('must remain current');
    expect(JSON.stringify(settingsQuery.params)).not.toContain('bookingPageContent');
    expect(renderFeatureUpdateSql()).toContain(`- 'customization'`);

    // Execute the actual UPDATE expression against live JSONB values. These
    // may differ from the request-start snapshot, so omitting SMS must preserve
    // both an owner's later change and an unconfigured salon's missing key.
    const client = new PGlite();
    try {
      await client.waitReady;
      await client.exec('CREATE TABLE salon (id integer PRIMARY KEY, settings jsonb)');
      const modules = [
        { smsReminders: false },
        { smsReminders: true },
        {},
      ];
      for (const [index, ownerModules] of modules.entries()) {
        await client.query('INSERT INTO salon (id, settings) VALUES ($1, $2::jsonb)', [index, JSON.stringify({
          modules: ownerModules,
          communications: { sms: { enabled: false }, quietHours: { enabled: true, start: '20:00', end: '08:00' } },
        })]);
      }
      await client.query(`UPDATE salon SET settings = ${settingsQuery.sql}`, settingsQuery.params);
      const { rows } = await client.query<{ settings: { modules: Record<string, boolean>; communications: unknown } }>('SELECT settings FROM salon ORDER BY id');

      expect(rows[0]?.settings.modules.smsReminders).toBe(false);
      expect(rows[1]?.settings.modules.smsReminders).toBe(true);
      expect(rows[2]?.settings.modules).not.toHaveProperty('smsReminders');

      for (const row of rows) {
        expect(row.settings.modules).toMatchObject({ analyticsDashboard: true, rewards: true, referrals: false });
        expect(row.settings.communications).toEqual({ sms: { enabled: false }, quietHours: { enabled: true, start: '20:00', end: '08:00' } });
      }
    } finally {
      await client.close();
    }
  });

  it.each([
    {
      label: 'add',
      existingBooking: { onlineBooking: true },
      requestedBooking: {
        onlineBooking: true,
        customization: true,
        customizationOverrideAuditId: 'browser-pointer',
      },
      persistedBooking: { onlineBooking: true },
      audit: null,
    },
    {
      label: 'change',
      existingBooking: {
        onlineBooking: true,
        customization: true,
        customizationOverrideAuditId: 'server-pointer-change',
      },
      requestedBooking: {
        onlineBooking: true,
        customization: false,
        customizationOverrideAuditId: 'browser-pointer',
      },
      persistedBooking: {
        onlineBooking: true,
        customization: true,
        customizationOverrideAuditId: 'server-pointer-change',
      },
      audit: {
        id: 'server-pointer-change',
        salonId: 'salon_1',
        action: 'booking_experience_entitlement_override_changed',
        performedBy: 'admin_1',
        performedByEmail: 'admin@example.test',
        metadata: {
          field: 'booking_experience_customization',
          newValue: {
            overrideState: 'force_enabled',
            reason: 'Server-owned reason',
          },
        },
        createdAt: new Date('2026-07-27T18:00:00.000Z'),
      },
    },
    {
      label: 'remove',
      existingBooking: {
        onlineBooking: true,
        customization: false,
        customizationOverrideAuditId: 'server-pointer-remove',
      },
      requestedBooking: { onlineBooking: true },
      persistedBooking: {
        onlineBooking: true,
        customization: false,
        customizationOverrideAuditId: 'server-pointer-remove',
      },
      audit: {
        id: 'server-pointer-remove',
        salonId: 'salon_1',
        action: 'booking_experience_entitlement_override_changed',
        performedBy: 'admin_1',
        performedByEmail: 'admin@example.test',
        metadata: {
          field: 'booking_experience_customization',
          newValue: {
            overrideState: 'force_disabled',
            reason: 'Server-owned reason',
          },
        },
        createdAt: new Date('2026-07-27T18:00:00.000Z'),
      },
    },
  ])('does not let the general PUT $label protected values', async ({
    existingBooking,
    requestedBooking,
    persistedBooking,
    audit,
  }) => {
    const existingSalon = {
      id: 'salon_1',
      name: 'Protected Salon',
      slug: 'protected-salon',
      plan: 'free',
      status: 'active',
      maxLocations: 1,
      isMultiLocationEnabled: false,
      features: {
        booking: existingBooking,
        analytics: { dashboard: false },
      },
      settings: {},
      onlineBookingEnabled: true,
      smsRemindersEnabled: false,
      rewardsEnabled: false,
      profilePageEnabled: true,
      bookingFlowCustomizationEnabled: false,
      bookingFlow: null,
      ownerEmail: null,
      ownerClerkUserId: null,
      internalNotes: null,
      deletedAt: null,
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-07-27T18:00:00.000Z'),
    };
    const updatedSalon = {
      ...existingSalon,
      features: {
        booking: persistedBooking,
        analytics: { dashboard: true },
      },
    };
    setSelectResults([
      [existingSalon],
      ...(audit ? [[audit]] : []),
    ]);
    setUpdateResult([updatedSalon]);

    const response = await PUT(
      new Request('http://localhost/api/super-admin/organizations/salon_1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features: {
            booking: requestedBooking,
            analytics: { dashboard: true },
          },
        }),
      }),
      { params: Promise.resolve({ id: 'salon_1' }) },
    );
    const body = await response.json();
    const renderedSql = renderFeatureUpdateSql();

    expect(response.status).toBe(200);
    expect(renderedSql).toContain(`- 'customization'`);
    expect(renderedSql).toContain(`- 'customizationOverrideAuditId'`);
    expect(renderedSql).toContain('"salon"."features"');
    expect(body.salon.features).toEqual(updatedSalon.features);
    expect(body.salon.features.booking).toEqual(persistedBooking);
    expect(body.salon.features.analytics).toEqual({ dashboard: true });
  });
});
