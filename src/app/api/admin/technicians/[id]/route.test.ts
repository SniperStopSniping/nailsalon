import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, requireAdminSalon, setSelectPlan, updateSetSpy } = vi.hoisted(() => {
  let selectPlan: unknown[] = [];
  const updateSetSpy = vi.fn();

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectPlan.shift() ?? []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: updateSetSpy.mockImplementation(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{
            id: 'tech_1',
            name: 'Daniela',
            email: null,
            phone: null,
            avatarUrl: null,
            bio: null,
            role: 'tech',
            skillLevel: 'standard',
            currentStatus: 'available',
            isActive: true,
            acceptingNewClients: true,
            commissionRate: '0.4',
            displayOrder: 0,
            notes: null,
            onboardingStatus: 'active',
            rating: '4.9',
            reviewCount: 12,
            weeklySchedule: null,
            updatedAt: new Date('2026-03-29T12:00:00.000Z'),
          }]),
        })),
      })),
    })),
  };

  return {
    db,
    requireAdminSalon: vi.fn(),
    setSelectPlan: (plan: unknown[]) => {
      selectPlan = [...plan];
    },
    updateSetSpy,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { PUT } from './route';

describe('PUT /api/admin/technicians/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1' },
    });
    setSelectPlan([[
      {
        id: 'tech_1',
        salonId: 'salon_1',
        email: null,
        isActive: true,
        rating: '4.9',
        reviewCount: 12,
      },
    ]]);
  });

  it('rejects unknown keys', async () => {
    const response = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          rating: 4.8,
          unexpectedField: true,
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects string ratings', async () => {
    const response = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          rating: '4.8',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    expect(response.status).toBe(400);
  });

  it('rejects array and object ratings', async () => {
    const arrayResponse = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          rating: [4.8],
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    const objectResponse = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          rating: { value: 4.8 },
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    expect(arrayResponse.status).toBe(400);
    expect(objectResponse.status).toBe(400);
  });

  it('rejects non-finite numeric rating payloads', async () => {
    const response = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: '{"salonSlug":"salon-a","rating":1e999}',
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('returns not found when the technician is outside the requested salon', async () => {
    setSelectPlan([[]]);

    const response = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_2', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          reviewCount: 12,
          rating: 4.9,
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_2' }) },
    );

    expect(response.status).toBe(404);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('preserves existing rating and reviewCount when those fields are omitted', async () => {
    const response = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          acceptingNewClients: false,
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    expect(response.status).toBe(200);
    const updatePayload = updateSetSpy.mock.calls[0]?.[0];
    expect(updatePayload).not.toHaveProperty('rating');
    expect(updatePayload).not.toHaveProperty('reviewCount');
    expect(updatePayload).toHaveProperty('acceptingNewClients', false);
  });

  it('forces rating to null when reviewCount is zero', async () => {
    const response = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          rating: 4.8,
          reviewCount: 0,
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({
      rating: null,
      reviewCount: 0,
    }));
  });

  it('requires rating when reviewCount is greater than zero', async () => {
    const response = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          rating: null,
          reviewCount: 7,
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    expect(response.status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('normalizes stored rating to one decimal place when reviews exist', async () => {
    const response = await PUT(
      new Request('http://localhost/api/admin/technicians/tech_1', {
        method: 'PUT',
        body: JSON.stringify({
          salonSlug: 'salon-a',
          rating: 4.94,
          reviewCount: 12,
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateSetSpy).toHaveBeenCalledWith(expect.objectContaining({
      rating: '4.9',
      reviewCount: 12,
    }));
  });
});
