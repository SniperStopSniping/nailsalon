import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, PATCH, PUT } from './route';

const {
  requireAdminSalonFromRequest,
  getSalonPolicy,
  getSuperAdminPolicy,
  patchSalonPolicy,
  upsertSalonPolicy,
} = vi.hoisted(() => ({
  requireAdminSalonFromRequest: vi.fn(),
  getSalonPolicy: vi.fn(),
  getSuperAdminPolicy: vi.fn(),
  patchSalonPolicy: vi.fn(),
  upsertSalonPolicy: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalonFromRequest,
}));

vi.mock('@/core/appointments/policyRepo', () => ({
  getSalonPolicy,
  getSuperAdminPolicy,
  patchSalonPolicy,
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

const policiesRequest = (search = '') =>
  new Request(`http://localhost/api/admin/policies${search}`);

describe('admin policies active salon guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSalonPolicy.mockResolvedValue(salonPolicy);
    getSuperAdminPolicy.mockResolvedValue(superAdminPolicy);
    patchSalonPolicy.mockResolvedValue(salonPolicy);
    upsertSalonPolicy.mockResolvedValue(salonPolicy);
  });

  it('rejects unauthorized admins', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
      admin: null,
    });

    const response = await GET(policiesRequest());

    expect(response.status).toBe(401);
  });

  it('reads policy for the active salon selection', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });

    const response = await GET(policiesRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getSalonPolicy).toHaveBeenCalledWith(undefined, 'salon_active');
    expect(body.data.salonId).toBe('salon_active');
    expect(body.data.salonName).toBe('Active Salon');
  });

  it('updates policy for the active salon selection', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
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

  it('keeps concurrent photo and social updates isolated', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });
    const canonicalPolicy = { ...salonPolicy };
    patchSalonPolicy.mockImplementation(async (_db, _salonId, patch) => {
      Object.assign(canonicalPolicy, patch);
      return { ...canonicalPolicy };
    });

    const [photoResponse, socialResponse] = await Promise.all([
      PATCH(new Request('http://localhost/api/admin/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireBeforePhotoToStart: 'optional' }),
      })),
      PATCH(new Request('http://localhost/api/admin/policies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoPostEnabled: true }),
      })),
    ]);

    expect(photoResponse.status).toBe(200);
    expect(socialResponse.status).toBe(200);
    expect(patchSalonPolicy).toHaveBeenCalledWith(
      undefined,
      'salon_active',
      { requireBeforePhotoToStart: 'optional' },
    );
    expect(patchSalonPolicy).toHaveBeenCalledWith(
      undefined,
      'salon_active',
      { autoPostEnabled: true },
    );
    expect(canonicalPolicy.requireBeforePhotoToStart).toBe('optional');
    expect(canonicalPolicy.autoPostEnabled).toBe(true);
  });

  it('rejects an empty partial update', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_active', name: 'Active Salon' },
      admin: { id: 'admin_1' },
    });

    const response = await PATCH(new Request('http://localhost/api/admin/policies', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);
    expect(patchSalonPolicy).not.toHaveBeenCalled();
  });

  // AG-security-tenancy-03 / AG-w2-settings-integrations-07: the URL's salon
  // must reach the guard, so a link naming salon A cannot read or write the
  // salon the active-salon cookie happens to hold.
  it('passes the requested salon slug to the guard on read', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: null,
      salon: { id: 'salon_requested', name: 'Requested Salon' },
      admin: { id: 'admin_1' },
    });

    const request = policiesRequest('?salonSlug=requested-salon');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireAdminSalonFromRequest).toHaveBeenCalledWith(request);
    expect(getSalonPolicy).toHaveBeenCalledWith(undefined, 'salon_requested');
    expect(body.data.salonId).toBe('salon_requested');
  });

  it('refuses a requested salon the caller may not edit', async () => {
    requireAdminSalonFromRequest.mockResolvedValue({
      error: new Response(
        JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
      salon: null,
      admin: { id: 'admin_1' },
    });

    const response = await PUT(
      new Request('http://localhost/api/admin/policies?salon=someone-else', {
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

    expect(response.status).toBe(403);
    expect(upsertSalonPolicy).not.toHaveBeenCalled();
  });
});
