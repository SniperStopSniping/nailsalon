import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { GET, PUT } from './route';

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
      onlineBooking: true,
      rewards: true,
      visibilityControls: true,
    });
  });

  it('persists feature entitlements on update instead of dropping them', async () => {
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
    expect(getLastUpdatePayload()).toMatchObject({
      features: {
        onlineBooking: true,
        rewards: true,
        visibilityControls: true,
      },
    });
    expect(body.salon.features).toEqual({
      onlineBooking: true,
      rewards: true,
      visibilityControls: true,
    });
  });
});
