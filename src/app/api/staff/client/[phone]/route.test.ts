import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const {
  requireStaffOrAdminSalonAccess,
  resolveSalonClientIdentityByPhone,
  db,
  selectQueue,
} = vi.hoisted(() => {
  const selectQueue: unknown[] = [];
  const consume = vi.fn(async () => selectQueue.shift() ?? []);
  const where = vi.fn(() => ({
    limit: consume,
    orderBy: consume,
    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown,
    ) => consume().then(resolve, reject),
  }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin, where }));
  const select = vi.fn(() => ({ from }));

  return {
    requireStaffOrAdminSalonAccess: vi.fn(),
    resolveSalonClientIdentityByPhone: vi.fn(),
    selectQueue,
    db: {
      select,
    },
  };
});

vi.mock('@/libs/routeAccessGuards', () => ({
  requireStaffOrAdminSalonAccess,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('@/libs/queries', () => ({
  resolveSalonClientIdentityByPhone,
}));

vi.mock('@/libs/visibilityPolicy', () => ({
  getEffectiveVisibility: vi.fn(() => 'full_access'),
}));

vi.mock('@/libs/redact', () => ({
  isFullAccess: vi.fn(() => true),
  redactClientForStaff: vi.fn(client => client),
}));

describe('GET /api/staff/client/[phone]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue.length = 0;
    resolveSalonClientIdentityByPhone.mockResolvedValue(null);
  });

  it('rejects unauthenticated access', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: { phone: '5551234567' } },
    );

    expect(response.status).toBe(401);
  });

  it('rejects wrong-tenant access', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: { phone: '5551234567' } },
    );

    expect(response.status).toBe(403);
  });

  it('allows authorized staff to view scoped client data', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
      },
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'salon_client_1',
        phone: '5551234567',
        hasGoogleReview: false,
        mergedIntoClientId: null,
      },
      clientIds: ['salon_client_1'],
      normalizedPhones: ['5551234567'],
      phoneVariants: ['5551234567', '15551234567', '+15551234567'],
      resolvedFromClientId: null,
    });
    selectQueue.push(
      [{ visibility: null }],
      // The resolver gates this URL's salon relationship before global lookup.
      [{ firstName: 'Ava', createdAt: new Date('2026-01-01T00:00:00Z') }],
      [],
      [],
    );

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: { phone: '5551234567' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveSalonClientIdentityByPhone).toHaveBeenCalledWith(
      'salon_1',
      '5551234567',
    );
    expect(body).toEqual({
      data: {
        client: {
          phone: '5551234567',
          name: 'Ava',
          memberSince: '2026-01-01T00:00:00.000Z',
          hasGoogleReview: false,
        },
        stats: {
          totalVisits: 0,
          totalSpent: 0,
          lastVisit: null,
        },
        preferences: null,
        appointments: [],
        photos: [],
      },
    });
  });

  it('does not disclose another salon\'s client identity for an unknown phone', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
      },
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    // No salon-scoped record for this phone at salon_1 — even though a global
    // client record exists (created by another salon), it must not be read.
    selectQueue.push(
      [{ visibility: null }],
      [], // preferences
      [], // appointments
    );

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: { phone: '5551234567' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.client.name).toBeNull();
    expect(body.data.client.memberSince).toBeNull();
  });

  it('resolves an old merged-source phone to primary flags and combined salon history', async () => {
    requireStaffOrAdminSalonAccess.mockResolvedValue({
      ok: true,
      actorRole: 'admin',
      salon: {
        id: 'salon_1',
        slug: 'salon-a',
      },
      session: {
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
    });
    resolveSalonClientIdentityByPhone.mockResolvedValue({
      client: {
        id: 'salon_client_primary',
        phone: '5559876543',
        hasGoogleReview: true,
        mergedIntoClientId: null,
      },
      clientIds: ['salon_client_primary', 'salon_client_source'],
      normalizedPhones: ['5551234567', '5559876543'],
      phoneVariants: [
        '5551234567',
        '15551234567',
        '+15551234567',
        '5559876543',
        '15559876543',
        '+15559876543',
      ],
      resolvedFromClientId: 'salon_client_source',
    });

    const appointments = [
      {
        id: 'appt_primary',
        salonId: 'salon_1',
        salonClientId: 'salon_client_primary',
        clientPhone: '5559876543',
        clientName: 'Current Ava',
        technicianId: null,
        status: 'completed',
        totalPrice: 7000,
        startTime: new Date('2026-06-01T10:00:00Z'),
        endTime: new Date('2026-06-01T11:00:00Z'),
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
      {
        id: 'appt_legacy',
        salonId: 'salon_1',
        salonClientId: null,
        clientPhone: '+15551234567',
        clientName: 'Old-login Ava',
        technicianId: null,
        status: 'completed',
        totalPrice: 5000,
        startTime: new Date('2025-06-01T10:00:00Z'),
        endTime: new Date('2025-06-01T11:00:00Z'),
        createdAt: new Date('2025-05-01T10:00:00Z'),
      },
    ];
    selectQueue.push(
      [{ visibility: null }],
      [{
        firstName: 'Old-login Ava',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      }],
      [{
        favoriteTechId: null,
        favoriteServices: ['manicure'],
        nailShape: 'oval',
        nailLength: 'short',
        finishes: [],
        colorFamilies: [],
        preferredBrands: [],
        sensitivities: 'latex',
        musicPreference: null,
        conversationLevel: null,
        beveragePreference: null,
        techNotes: 'Old-login preference',
        appointmentNotes: null,
      }],
      appointments,
      [{ serviceName: 'Gel', priceAtBooking: 7000 }],
      [{ serviceName: 'Classic', priceAtBooking: 5000 }],
      [{
        id: 'photo_legacy',
        salonId: 'salon_1',
        appointmentId: 'appt_legacy',
        photoType: 'after',
        imageUrl: 'https://example.test/photo.jpg',
        thumbnailUrl: null,
        caption: null,
        createdAt: new Date('2025-06-01T11:00:00Z'),
      }],
    );

    const response = await GET(
      new Request('http://localhost/api/staff/client/5551234567?salonSlug=salon-a'),
      { params: { phone: '5551234567' } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveSalonClientIdentityByPhone).toHaveBeenCalledWith(
      'salon_1',
      '5551234567',
    );
    expect(body.data.client).toMatchObject({
      phone: '5551234567',
      name: 'Old-login Ava',
      hasGoogleReview: true,
    });
    expect(body.data.preferences).toMatchObject({
      favoriteServices: ['manicure'],
      techNotes: 'Old-login preference',
    });
    expect(body.data.stats).toEqual({
      totalVisits: 2,
      totalSpent: 12000,
      lastVisit: '2026-06-01T10:00:00.000Z',
    });
    expect(
      body.data.appointments.map((appointment: { id: string }) => appointment.id),
    ).toEqual(['appt_primary', 'appt_legacy']);
    expect(body.data.photos).toEqual([
      expect.objectContaining({
        id: 'photo_legacy',
        appointmentId: 'appt_legacy',
      }),
    ]);
  });
});
