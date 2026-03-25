import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requireStaffSession,
  requireAdminSalon,
  select,
  queueSelectResults,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const queryResult = {
    leftJoin: vi.fn(() => queryResult),
    orderBy: vi.fn(() => queryResult),
    where: vi.fn(() => queryResult),
    limit: vi.fn(() => queryResult),
    then: (resolve: (value: unknown[]) => void) => resolve(selectResults.shift() ?? []),
  };
  const from = vi.fn(() => queryResult);
  const select = vi.fn(() => ({ from }));

  return {
    requireStaffSession: vi.fn(),
    requireAdminSalon: vi.fn(),
    select,
    queueSelectResults: (...rows: unknown[][]) => {
      selectResults.splice(0, selectResults.length, ...rows);
    },
  };
});

vi.mock('@/libs/staffAuth', () => ({
  requireStaffSession,
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdmin: vi.fn(),
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db: {
    select,
    query: {},
  },
}));

vi.mock('@/libs/queries', () => ({
  getSalonBySlug: vi.fn(),
}));

vi.mock('@/libs/featureGating', () => ({
  getEffectiveStaffVisibility: vi.fn(),
}));

vi.mock('@/libs/redact', () => ({
  redactAppointmentForStaff: vi.fn((appointment) => appointment),
}));

import { GET } from './route';

describe('GET /api/appointments access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueSelectResults();
    requireStaffSession.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });
  });

  it('rejects filter-driven reads when no authenticated staff or admin context is present', async () => {
    const response = await GET(
      new Request('http://localhost/api/appointments?salonSlug=salon-a&technicianId=tech_1'),
    );

    expect(response.status).toBe(401);
    expect(requireAdminSalon).toHaveBeenCalledWith('salon-a');
  });

  it('rejects unauthenticated reads without falling back to public salon filters', async () => {
    const response = await GET(new Request('http://localhost/api/appointments?date=today'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Staff or admin authentication is required',
      },
    });
    expect(requireAdminSalon).not.toHaveBeenCalled();
  });

  it('allows explicit admin access for the resolved salon', async () => {
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1', slug: 'salon-a' },
    });

    const response = await GET(
      new Request('http://localhost/api/appointments?salonSlug=salon-a&date=today'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        appointments: [],
      },
    });
  });

  it('loads staff appointment details without per-appointment DB fetch chains', async () => {
    requireStaffSession.mockResolvedValue({
      ok: true,
      session: {
        salonId: 'salon_1',
        technicianId: 'tech_1',
      },
    });

    queueSelectResults(
      [{ features: null, settings: null }],
      [
        {
          id: 'appt_1',
          clientName: 'Alex',
          clientPhone: '5551112222',
          startTime: new Date('2026-03-15T10:00:00Z'),
          endTime: new Date('2026-03-15T11:00:00Z'),
          status: 'confirmed',
          technicianId: 'tech_1',
          totalPrice: 5000,
        },
        {
          id: 'appt_2',
          clientName: 'Jordan',
          clientPhone: '5553334444',
          startTime: new Date('2026-03-15T12:00:00Z'),
          endTime: new Date('2026-03-15T13:00:00Z'),
          status: 'in_progress',
          technicianId: 'tech_1',
          totalPrice: 6500,
        },
      ],
      [
        { appointmentId: 'appt_1', name: 'Gel Manicure' },
        { appointmentId: 'appt_2', name: 'BIAB Short' },
      ],
      [
        {
          id: 'photo_1',
          appointmentId: 'appt_2',
          imageUrl: 'https://example.com/after.jpg',
          thumbnailUrl: 'https://example.com/after-thumb.jpg',
          photoType: 'after',
        },
      ],
    );

    const response = await GET(new Request('http://localhost/api/appointments?date=today'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        appointments: [
          {
            id: 'appt_1',
            clientName: 'Alex',
            clientPhone: '5551112222',
            startTime: '2026-03-15T10:00:00.000Z',
            endTime: '2026-03-15T11:00:00.000Z',
            status: 'confirmed',
            technicianId: 'tech_1',
            totalPrice: 5000,
            services: [{ name: 'Gel Manicure' }],
            photos: [],
          },
          {
            id: 'appt_2',
            clientName: 'Jordan',
            clientPhone: '5553334444',
            startTime: '2026-03-15T12:00:00.000Z',
            endTime: '2026-03-15T13:00:00.000Z',
            status: 'in_progress',
            technicianId: 'tech_1',
            totalPrice: 6500,
            services: [{ name: 'BIAB Short' }],
            photos: [
              {
                id: 'photo_1',
                imageUrl: 'https://example.com/after.jpg',
                thumbnailUrl: 'https://example.com/after-thumb.jpg',
                photoType: 'after',
              },
            ],
          },
        ],
      },
    });
    expect(select).toHaveBeenCalledTimes(4);
  });
});
