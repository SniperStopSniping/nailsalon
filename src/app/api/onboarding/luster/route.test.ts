/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  currentUser,
  db,
  insertValues,
  isClerkUserMissing,
  queueSelectResults,
  transaction,
  tx,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const selectQuery = {
    from: vi.fn(() => selectQuery),
    where: vi.fn(() => selectQuery),
    limit: vi.fn(async () => selectResults.shift() ?? []),
    then: (resolve: (value: unknown[]) => unknown) => resolve(selectResults.shift() ?? []),
  };
  const insertValues = vi.fn(async () => undefined);
  const returning = vi.fn(async () => [{}]);
  const tx = {
    execute: vi.fn(async () => undefined),
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
    isClerkUserMissing: vi.fn(),
    queueSelectResults: (...rows: unknown[][]) => {
      selectResults.splice(0, selectResults.length, ...rows);
    },
    transaction,
    tx,
  };
});

vi.mock('@clerk/nextjs/server', () => ({ currentUser }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/libs/clerkIdentity.server', () => ({ isClerkUserMissing }));
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
      emailAddresses: [{
        id: 'email_1',
        emailAddress: 'owner@example.com',
        verification: { status: 'verified' },
      }],
    });
    process.env.LUSTER_ROOT_DOMAIN = 'luster.com';
    process.env.TENANT_SUBDOMAINS_ENABLED = 'true';
    transaction.mockImplementation(callback => callback(tx));
    isClerkUserMissing.mockResolvedValue(false);
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
      plan: 'free',
    }));
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      clerkUserId: 'clerk_owner_1',
      email: 'owner@example.com',
    }));
    expect(body.data).toMatchObject({
      slug: 'isla-nails',
      publicUrl: 'https://isla-nails.luster.com/',
    });
  });

  it('claims an unowned salon in place without changing its id or slug', async () => {
    queueSelectResults(
      [{
        id: 'invite_1',
        invitedEmail: 'owner@example.com',
        campaignSource: 'legacy-salon-recovery',
        intent: 'claim_existing',
        salonId: 'salon_best',
      }],
      [],
      [],
      [{
        id: 'salon_best',
        name: 'best',
        slug: 'best',
        ownerEmail: 'owner@example.com',
        ownerClerkUserId: null,
      }],
      [{ count: 0 }],
      [{ count: 0 }],
    );

    const response = await POST(request({
      ...validSetup,
      salonName: 'Changed name is ignored',
      slug: 'changed-slug',
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ salonId: 'salon_best', slug: 'best' });
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'salon_best' }));
    expect(tx.update).toHaveBeenCalledTimes(4);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      salonId: 'salon_best',
      role: 'owner',
    }));
  });

  it('reuses an existing Clerk owner and adds another salon membership', async () => {
    queueSelectResults(
      [{
        id: 'invite_2',
        invitedEmail: 'owner@example.com',
        campaignSource: 'second-salon',
        intent: 'create_salon',
      }],
      [{ id: 'admin_existing', clerkUserId: 'clerk_owner_1', email: 'owner@example.com' }],
      [],
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.dashboardUrl).toContain('/en/admin?salon=isla-nails');
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({
      clerkUserId: 'clerk_owner_1',
    }));
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 'admin_existing',
      role: 'owner',
    }));
  });

  it('links an existing verified-email owner to Clerk without replacing memberships', async () => {
    queueSelectResults(
      [{
        id: 'invite_3',
        invitedEmail: 'owner@example.com',
        intent: 'create_salon',
      }],
      [{ id: 'admin_unlinked', clerkUserId: null, email: 'owner@example.com' }],
      [],
    );

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(tx.update).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 'admin_unlinked',
      role: 'owner',
    }));
  });

  it('returns the completed salon on a safe retry without creating duplicate records', async () => {
    queueSelectResults(
      [{
        id: 'invite_used',
        invitedEmail: 'owner@example.com',
        intent: 'create_salon',
        consumedAt: new Date(),
        consumedByAdminId: 'admin_existing',
        resultSalonId: 'salon_existing',
      }],
      [{ id: 'admin_existing', clerkUserId: 'clerk_owner_1', email: 'owner@example.com' }],
      [{ id: 'salon_existing', slug: 'existing', customDomain: null }],
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ salonId: 'salon_existing', slug: 'existing' });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('rejects an email already linked to a different Clerk identity', async () => {
    queueSelectResults(
      [{ id: 'invite_4', invitedEmail: 'owner@example.com', intent: 'create_salon' }],
      [{ id: 'admin_existing', clerkUserId: 'clerk_someone_else', email: 'owner@example.com' }],
    );

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('OWNER_ACCOUNT_CONFLICT');
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('safely relinks a deleted Clerk identity and preserves the owner for another salon', async () => {
    isClerkUserMissing.mockResolvedValue(true);
    queueSelectResults(
      [{ id: 'invite_5', invitedEmail: 'owner@example.com', intent: 'create_salon' }],
      [{ id: 'admin_existing', clerkUserId: 'clerk_deleted', email: 'owner@example.com' }],
      [],
    );

    const response = await POST(request({
      ...validSetup,
      salonName: 'Second Salon',
      slug: 'second-salon',
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({ slug: 'second-salon' });
    expect(isClerkUserMissing).toHaveBeenCalledWith('clerk_deleted');
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({
      clerkUserId: 'clerk_owner_1',
    }));
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 'admin_existing',
      role: 'owner',
    }));
  });

  it('requires the primary Clerk email to be verified', async () => {
    currentUser.mockResolvedValue({
      id: 'clerk_owner_1',
      primaryEmailAddressId: 'email_1',
      emailAddresses: [{
        id: 'email_1',
        emailAddress: 'owner@example.com',
        verification: { status: 'unverified' },
      }],
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(transaction).not.toHaveBeenCalled();
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
      message: 'Sign in with the email address that received this invitation.',
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
