/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  currentUser,
  db,
  insertValues,
  queueSelectResults,
  transaction,
  tx,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const selectQuery = {
    from: vi.fn(() => selectQuery),
    where: vi.fn(() => selectQuery),
    limit: vi.fn(async () => selectResults.shift() ?? []),
  };
  const insertValues = vi.fn(async () => undefined);
  const returning = vi.fn(async () => [{}]);
  const tx = {
    select: vi.fn(() => selectQuery),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning })),
      })),
    })),
  };
  const transaction = vi.fn();
  return {
    currentUser: vi.fn(),
    db: { transaction },
    insertValues,
    queueSelectResults: (...rows: unknown[][]) => {
      selectResults.splice(0, selectResults.length, ...rows);
    },
    transaction,
    tx,
  };
});

vi.mock('@clerk/nextjs/server', () => ({ currentUser }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('server-only', () => ({}));

import { POST } from './route';

const validSetup = {
  inviteToken: 'a-secure-invitation-token-value',
  salonName: 'Isla Nail Studio',
  ownerName: 'Isla Owner',
  ownerPhone: '4165550199',
  slug: 'isla-nails',
  timezone: 'America/Toronto',
  address: '123 Queen Street',
  city: 'Toronto',
  province: 'Ontario',
  postalCode: 'M5V 2B6',
  businessHours: {
    monday: { open: '09:00', close: '17:00' },
    tuesday: { open: '09:00', close: '17:00' },
    wednesday: { open: '09:00', close: '17:00' },
    thursday: { open: '09:00', close: '17:00' },
    friday: { open: '09:00', close: '17:00' },
    saturday: null,
    sunday: null,
  },
  services: [{
    name: 'Builder Gel',
    priceCents: 6500,
    durationMinutes: 75,
    category: 'builder_gel',
  }],
};

function request(body = validSetup) {
  return new Request('http://localhost/api/onboarding/luster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/onboarding/luster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.mockResolvedValue({
      id: 'clerk_owner_1',
      primaryEmailAddressId: 'email_1',
      emailAddresses: [{ id: 'email_1', emailAddress: 'owner@example.com' }],
    });
    transaction.mockImplementation(callback => callback(tx));
  });

  it('creates the complete solo salon and consumes the invitation atomically', async () => {
    queueSelectResults(
      [{
        id: 'invite_1',
        invitedEmail: 'owner@example.com',
        campaignSource: 'builder-gel-sample',
      }],
      [],
      [],
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.insert).toHaveBeenCalledTimes(7);
    expect(tx.update).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'isla-nails',
      freeSoloEnabled: true,
      publicationStatus: 'published',
      plan: 'free_solo',
    }));
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      clerkUserId: 'clerk_owner_1',
      email: 'owner@example.com',
    }));
    expect(body.data).toMatchObject({
      slug: 'isla-nails',
      publicUrl: 'https://isla-nails.luster.com',
    });
  });

  it('rejects an expired, reused, or unknown invitation before creating records', async () => {
    queueSelectResults([]);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('INVITE_INVALID');
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('requires the signed-in Clerk email to match the invitation', async () => {
    queueSelectResults([{
      id: 'invite_1',
      invitedEmail: 'invited@example.com',
      campaignSource: null,
    }]);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({
      code: 'INVITE_EMAIL_MISMATCH',
      message: 'Sign in with the invited email: invited@example.com',
    });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('maps a concurrent slug uniqueness violation to a stable conflict response', async () => {
    transaction.mockRejectedValue(Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'salon_slug_idx',
    }));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('SLUG_TAKEN');
  });
});
