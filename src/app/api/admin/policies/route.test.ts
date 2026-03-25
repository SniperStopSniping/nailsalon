import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireActiveAdminSalon,
  getSalonPolicy,
  getSuperAdminPolicy,
  upsertSalonPolicy,
} = vi.hoisted(() => ({
  requireActiveAdminSalon: vi.fn(),
  getSalonPolicy: vi.fn(),
  getSuperAdminPolicy: vi.fn(),
  upsertSalonPolicy: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireActiveAdminSalon,
}));

vi.mock('@/core/appointments/policyRepo', () => ({
  getSalonPolicy,
  getSuperAdminPolicy,
  upsertSalonPolicy,
}));

vi.mock('@/core/appointments/policyResolver', () => ({
  resolveEffectivePolicy: vi.fn(({ salon }) => ({
    requireBeforePhotoToStart: salon.requireBeforePhotoToStart,
    requireAfterPhotoToFinish: salon.requireAfterPhotoToFinish,
    requireAfterPhotoToPay: salon.requireAfterPhotoToPay,
    autoPostEnabled: salon.autoPostEnabled,
    autoPostPlatforms: salon.autoPostPlatforms,
    autoPostIncludePrice: salon.autoPostIncludePrice,
    autoPostIncludeColor: salon.autoPostIncludeColor,
    autoPostIncludeBrand: salon.autoPostIncludeBrand,
    autoPostAIcaptionEnabled: salon.autoPostAIcaptionEnabled,
  })),
}));

import { GET, PUT } from './route';

const salonPolicy = {
  requireBeforePhotoToStart: 'required',
  requireAfterPhotoToFinish: 'required',
  requireAfterPhotoToPay: 'optional',
  autoPostEnabled: false,
  autoPostPlatforms: ['instagram'],
  autoPostIncludePrice: false,
  autoPostIncludeColor: true,
  autoPostIncludeBrand: false,
  autoPostAiCaptionEnabled: true,
  isDefault: false,
  updatedAt: new Date('2026-03-14T10:00:00.000Z'),
};

const superAdminPolicy = {
  requireBeforePhotoToStart: 'optional',
  requireAfterPhotoToFinish: 'required',
  requireAfterPhotoToPay: 'optional',
  autoPostEnabled: false,
  autoPostAiCaptionEnabled: true,
};

describe('admin policies active salon guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonPolicy.mockResolvedValue(salonPolicy);
    getSuperAdminPolicy.mockResolvedValue(superAdminPolicy);
    upsertSalonPolicy.mockResolvedValue(salonPolicy);
  });

  it('rejects unauthorized admins', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
      admin: null,
    });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it('reads policy for the active salon selection', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getSalonPolicy).toHaveBeenCalledWith(undefined, 'salon_active');
    expect(body.data.salonId).toBe('salon_active');
    expect(body.data.salonName).toBe('Active Salon');
  });

  it('updates policy for the active salon selection', async () => {
    requireActiveAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });

    const response = await PUT(
      new Request('http://localhost/api/admin/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requireBeforePhotoToStart: 'required',
          requireAfterPhotoToFinish: 'required',
          requireAfterPhotoToPay: 'optional',
          autoPostEnabled: false,
          autoPostPlatforms: ['instagram'],
          autoPostIncludePrice: false,
          autoPostIncludeColor: true,
          autoPostIncludeBrand: false,
          autoPostAiCaptionEnabled: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upsertSalonPolicy).toHaveBeenCalledWith(undefined, 'salon_active', expect.any(Object));
  });
});
