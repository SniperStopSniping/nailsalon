import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
const auth = vi.hoisted(() => ({
  result: {
    ok: true as const,
    admin: {
      id: 'super-admin-1',
      email: 'operator@example.test',
      name: 'Operator',
      isSuperAdmin: true,
      salons: [],
    },
  } as {
    ok: true;
    admin: {
      id: string;
      email: string | null;
      name: string | null;
      isSuperAdmin: boolean;
      salons: never[];
    };
  } | {
    ok: false;
    response: Response;
  },
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/superAdmin', () => ({
  requireSuperAdminGuard: vi.fn(async () => auth.result),
}));

const { PATCH } = await import('./route');

const SALON_ID = 'salon-entitlement-a';
const OTHER_SALON_ID = 'salon-entitlement-b';
const ORIGINAL_SETTINGS: SalonSettings = {
  booking: {
    timezone: 'America/Toronto',
    bufferMinutes: 15,
  },
  bookingExperience: {
    primaryColor: '#123456',
    bookingMessage: 'Saved salon message',
    policy: {
      enabled: true,
      title: 'Saved policy',
      text: 'Saved policy contents',
    },
    appointmentOnly: true,
    socialLinks: {
      instagram: 'https://instagram.com/saved',
      facebook: null,
      tiktok: null,
    },
    confirmationMessage: 'Saved confirmation message',
  },
};
const ORIGINAL_FEATURES: SalonFeatures = {
  booking: {
    onlineBooking: true,
    staffDashboard: true,
  },
  marketing: {
    rewards: true,
  },
};

let client: PGlite;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

function request(
  body: unknown,
  salonId = SALON_ID,
): Request {
  return new Request(
    `http://localhost/api/super-admin/organizations/${salonId}/entitlements/booking-experience-customization`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

async function invoke(
  body: unknown,
  salonId = SALON_ID,
): Promise<Response> {
  return PATCH(request(body, salonId), {
    params: Promise.resolve({ id: salonId }),
  });
}

async function getSalon(salonId = SALON_ID) {
  const [salon] = await testDb
    .select()
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.id, salonId));
  return salon;
}

async function getEntitlementAudits(salonId = SALON_ID) {
  return testDb
    .select()
    .from(schema.salonAuditLogSchema)
    .where(and(
      eq(schema.salonAuditLogSchema.salonId, salonId),
      eq(
        schema.salonAuditLogSchema.action,
        'booking_experience_entitlement_override_changed',
      ),
    ));
}

function currentExpected(
  salon: Awaited<ReturnType<typeof getSalon>>,
) {
  const features = (salon?.features ?? {}) as SalonFeatures;
  const customization = features.booking?.customization;
  return {
    expectedOverrideState: customization === true
      ? 'force_enabled'
      : customization === false
        ? 'force_disabled'
        : 'default',
    expectedOverrideAuditId:
      typeof features.booking?.customizationOverrideAuditId === 'string'
        ? features.booking.customizationOverrideAuditId
        : null,
  } as const;
}

beforeEach(async () => {
  auth.result = {
    ok: true,
    admin: {
      id: 'super-admin-1',
      email: 'operator@example.test',
      name: 'Operator',
      isSuperAdmin: true,
      salons: [],
    },
  };

  client = new PGlite();
  await client.waitReady;
  testDb = drizzle(client, { schema });
  await migrate(testDb, {
    migrationsFolder: path.join(process.cwd(), 'migrations'),
  });
  holder.db = testDb;

  await testDb.insert(schema.salonSchema).values([
    {
      id: SALON_ID,
      name: 'Entitlement Salon A',
      slug: 'entitlement-salon-a',
      plan: 'free',
      features: ORIGINAL_FEATURES,
      settings: ORIGINAL_SETTINGS,
    },
    {
      id: OTHER_SALON_ID,
      name: 'Entitlement Salon B',
      slug: 'entitlement-salon-b',
      plan: 'enterprise',
      features: {
        booking: {
          customization: false,
          customizationOverrideAuditId: 'other-existing-pointer',
        },
        analytics: { dashboard: true },
      },
      settings: {
        bookingExperience: {
          ...ORIGINAL_SETTINGS.bookingExperience!,
          bookingMessage: 'Other salon message',
        },
      },
    },
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
});

describe('PATCH Booking Experience entitlement override', () => {
  it('authorizes before database access and performs no mutation when forbidden', async () => {
    auth.result = {
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    };
    const before = await getSalon();

    const response = await invoke({
      overrideState: 'force_enabled',
      reason: 'Should not be applied',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: null,
    });

    expect(response.status).toBe(403);
    expect(await getSalon()).toEqual(before);
    expect(await getEntitlementAudits()).toHaveLength(0);
  });

  it.each([
    {
      label: 'unknown fields',
      body: {
        overrideState: 'force_enabled',
        reason: 'Support exception',
        expectedOverrideState: 'default',
        expectedOverrideAuditId: null,
        salonId: OTHER_SALON_ID,
      },
    },
    {
      label: 'missing force reason',
      body: {
        overrideState: 'force_enabled',
        expectedOverrideState: 'default',
        expectedOverrideAuditId: null,
      },
    },
    {
      label: 'blank force reason',
      body: {
        overrideState: 'force_disabled',
        reason: '   ',
        expectedOverrideState: 'default',
        expectedOverrideAuditId: null,
      },
    },
    {
      label: 'oversized normalized reason',
      body: {
        overrideState: 'force_enabled',
        reason: ` ${'x'.repeat(501)} `,
        expectedOverrideState: 'default',
        expectedOverrideAuditId: null,
      },
    },
  ])('rejects $label without writing', async ({ body }) => {
    const response = await invoke(body);

    expect(response.status).toBe(400);
    expect((await getSalon())?.features).toEqual(ORIGINAL_FEATURES);
    expect(await getEntitlementAudits()).toHaveLength(0);
  });

  it('applies all three states, trims force reasons, and preserves settings and unrelated features', async () => {
    const enabled = await invoke({
      overrideState: 'force_enabled',
      reason: '  Approved support exception  ',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: null,
    });
    const enabledBody = await enabled.json();

    expect(enabled.status).toBe(200);
    expect(enabledBody).toMatchObject({
      changed: true,
      bookingExperienceEntitlement: {
        planKey: 'free',
        planDefault: false,
        overrideState: 'force_enabled',
        entitled: true,
        source: 'override',
        reason: 'Approved support exception',
        actor: {
          id: 'super-admin-1',
          email: 'operator@example.test',
        },
        provenanceRecorded: true,
      },
    });

    const afterEnabled = await getSalon();

    expect(afterEnabled?.settings).toEqual(ORIGINAL_SETTINGS);
    expect(afterEnabled?.features).toMatchObject({
      booking: {
        onlineBooking: true,
        staffDashboard: true,
        customization: true,
        customizationOverrideAuditId: expect.any(String),
      },
      marketing: { rewards: true },
    });

    const disabled = await invoke({
      overrideState: 'force_disabled',
      reason: 'Temporary compliance hold',
      ...currentExpected(afterEnabled),
    });

    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({
      bookingExperienceEntitlement: {
        overrideState: 'force_disabled',
        entitled: false,
        reason: 'Temporary compliance hold',
      },
    });

    const afterDisabled = await getSalon();
    const returnedToDefault = await invoke({
      overrideState: 'default',
      reason: 'This must not be retained',
      ...currentExpected(afterDisabled),
    });
    const defaultBody = await returnedToDefault.json();

    expect(returnedToDefault.status).toBe(200);
    expect(defaultBody.bookingExperienceEntitlement).toMatchObject({
      overrideState: 'default',
      entitled: false,
      source: 'plan',
      reason: null,
      actor: {
        id: 'super-admin-1',
        email: 'operator@example.test',
      },
      provenanceRecorded: true,
    });

    const afterDefault = await getSalon();
    const finalFeatures = afterDefault?.features as SalonFeatures;

    expect(finalFeatures.booking).not.toHaveProperty('customization');
    expect(finalFeatures.booking?.customizationOverrideAuditId).toEqual(
      defaultBody.bookingExperienceEntitlement.overrideAuditId,
    );
    expect(finalFeatures.booking).toMatchObject({
      onlineBooking: true,
      staffDashboard: true,
    });
    expect(finalFeatures.marketing).toEqual({ rewards: true });
    expect(afterDefault?.settings).toEqual(ORIGINAL_SETTINGS);

    const audits = await getEntitlementAudits();

    expect(audits).toHaveLength(3);
    expect(audits.map(audit => audit.id)).toContain(
      finalFeatures.booking?.customizationOverrideAuditId,
    );
    expect(audits[2]).toMatchObject({
      performedBy: 'super-admin-1',
      performedByEmail: 'operator@example.test',
      metadata: {
        field: 'booking_experience_customization',
        newValue: {
          overrideState: 'default',
          reason: null,
          planKey: 'free',
          planDefault: false,
          entitled: false,
          source: 'plan',
        },
      },
    });
    expect(JSON.stringify(audits)).not.toContain('Saved salon message');
    expect(JSON.stringify(audits)).not.toContain('Saved policy contents');
  });

  it('treats the same forced state and normalized reason as a no-op', async () => {
    const first = await invoke({
      overrideState: 'force_enabled',
      reason: 'Support exception',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: null,
    });
    const firstBody = await first.json();

    const retry = await invoke({
      overrideState: 'force_enabled',
      reason: '  Support exception  ',
      expectedOverrideState: 'force_enabled',
      expectedOverrideAuditId:
        firstBody.bookingExperienceEntitlement.overrideAuditId,
    });
    const retryBody = await retry.json();

    expect(retry.status).toBe(200);
    expect(retryBody.changed).toBe(false);
    expect(retryBody.bookingExperienceEntitlement.overrideAuditId).toBe(
      firstBody.bookingExperienceEntitlement.overrideAuditId,
    );
    expect(await getEntitlementAudits()).toHaveLength(1);
  });

  it('audits a changed reason even when the forced state is unchanged', async () => {
    const first = await invoke({
      overrideState: 'force_disabled',
      reason: 'Initial reason',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: null,
    });
    const firstBody = await first.json();

    const changedReason = await invoke({
      overrideState: 'force_disabled',
      reason: 'Replacement reason',
      expectedOverrideState: 'force_disabled',
      expectedOverrideAuditId:
        firstBody.bookingExperienceEntitlement.overrideAuditId,
    });
    const changedBody = await changedReason.json();

    expect(changedReason.status).toBe(200);
    expect(changedBody.changed).toBe(true);
    expect(changedBody.bookingExperienceEntitlement).toMatchObject({
      overrideState: 'force_disabled',
      reason: 'Replacement reason',
    });
    expect(changedBody.bookingExperienceEntitlement.overrideAuditId).not.toBe(
      firstBody.bookingExperienceEntitlement.overrideAuditId,
    );
    expect(await getEntitlementAudits()).toHaveLength(2);
  });

  it('leaves Default-to-Default unchanged and stores no reason', async () => {
    const response = await invoke({
      overrideState: 'default',
      reason: 'Ignored',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: null,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.changed).toBe(false);
    expect(body.bookingExperienceEntitlement).toMatchObject({
      overrideState: 'default',
      overrideAuditId: null,
      reason: null,
    });
    expect(await getEntitlementAudits()).toHaveLength(0);
  });

  it.each([
    {
      label: 'state',
      expectedOverrideState: 'force_disabled',
      expectedOverrideAuditId: null,
    },
    {
      label: 'audit pointer',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: 'stale-audit-id',
    },
  ] as const)('returns a typed conflict for a stale expected $label', async (expected) => {
    const before = await getSalon();

    const response = await invoke({
      overrideState: 'force_enabled',
      reason: 'Should conflict',
      expectedOverrideState: expected.expectedOverrideState,
      expectedOverrideAuditId: expected.expectedOverrideAuditId,
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: 'ENTITLEMENT_OVERRIDE_CONFLICT',
      current: {
        bookingExperienceEntitlement: {
          overrideState: 'default',
          overrideAuditId: null,
        },
      },
    });
    expect(await getSalon()).toEqual(before);
    expect(await getEntitlementAudits()).toHaveLength(0);
  });

  it('rolls back the feature change if the audit insert fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const duplicateAuditId = '00000000-0000-4000-8000-000000000001';
    await testDb.insert(schema.salonAuditLogSchema).values({
      id: duplicateAuditId,
      salonId: SALON_ID,
      action: 'updated',
      performedBy: 'existing-admin',
      metadata: { field: 'unrelated' },
    });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      duplicateAuditId,
    );
    const before = await getSalon();

    const response = await invoke({
      overrideState: 'force_enabled',
      reason: 'Audit must be atomic',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: null,
    });

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      'Error updating Booking Experience entitlement override:',
      expect.anything(),
    );
    expect(await getSalon()).toEqual(before);
    expect(await getEntitlementAudits()).toHaveLength(0);
  });

  it('does not expose provenance through a cross-salon audit pointer', async () => {
    const crossSalonAuditId = 'audit-owned-by-other-salon';
    await testDb.insert(schema.salonAuditLogSchema).values({
      id: crossSalonAuditId,
      salonId: OTHER_SALON_ID,
      action: 'booking_experience_entitlement_override_changed',
      performedBy: 'other-admin',
      performedByEmail: 'other@example.test',
      metadata: {
        field: 'booking_experience_customization',
        newValue: {
          overrideState: 'force_enabled',
          reason: 'Other salon secret reason',
        },
      },
    });
    await testDb
      .update(schema.salonSchema)
      .set({
        features: {
          ...ORIGINAL_FEATURES,
          booking: {
            ...ORIGINAL_FEATURES.booking,
            customization: true,
            customizationOverrideAuditId: crossSalonAuditId,
          },
        },
      })
      .where(eq(schema.salonSchema.id, SALON_ID));

    const response = await invoke({
      overrideState: 'force_disabled',
      reason: 'Will conflict before mutation',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: crossSalonAuditId,
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.current.bookingExperienceEntitlement).toMatchObject({
      overrideState: 'force_enabled',
      overrideAuditId: crossSalonAuditId,
      reason: null,
      actor: null,
      updatedAt: null,
      provenanceRecorded: false,
    });
    expect(JSON.stringify(body)).not.toContain('Other salon secret reason');
    expect(JSON.stringify(body)).not.toContain('other@example.test');
  });

  it('changes only the salon selected by the trusted route parameter', async () => {
    const otherBefore = await getSalon(OTHER_SALON_ID);

    const response = await invoke({
      overrideState: 'force_enabled',
      reason: 'Targeted exception',
      expectedOverrideState: 'default',
      expectedOverrideAuditId: null,
    }, SALON_ID);

    expect(response.status).toBe(200);
    expect(await getSalon(OTHER_SALON_ID)).toEqual(otherBefore);
    expect(await getEntitlementAudits(OTHER_SALON_ID)).toHaveLength(0);
  });
});
