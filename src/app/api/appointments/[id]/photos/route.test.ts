import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAppointmentManagerAccess,
  isCloudinaryConfigured,
  uploadAppointmentPhoto,
  insertValues,
  db,
} = vi.hoisted(() => {
  const insertValues = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));

  return {
    requireAppointmentManagerAccess: vi.fn(),
    isCloudinaryConfigured: vi.fn(),
    uploadAppointmentPhoto: vi.fn(),
    insertValues,
    db: {
      insert,
      query: {
        appointmentPhotoSchema: {
          findMany: vi.fn(async () => []),
        },
      },
    },
  };
});

vi.mock('@/libs/routeAccessGuards', () => ({
  requireAppointmentManagerAccess,
}));

vi.mock('@/libs/Cloudinary', () => ({
  isCloudinaryConfigured,
  uploadAppointmentPhoto,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

import { GET, POST } from './route';

describe('appointment photo route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated uploads', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const formData = new FormData();
    formData.set('file', new File(['image'], 'photo.jpg', { type: 'image/jpeg' }));

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/photos', {
        method: 'POST',
        body: formData,
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(401);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('rejects wrong-role access to photo reads', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const response = await GET(
      new Request('http://localhost/api/appointments/appt_1/photos'),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(403);
  });

  it('derives uploadedByTechId from the authenticated staff session', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '+15551234567',
      },
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        clientPhone: '+15551234567',
      },
    });
    isCloudinaryConfigured.mockReturnValue(true);
    uploadAppointmentPhoto.mockResolvedValue({
      publicId: 'cloudinary_1',
      imageUrl: 'https://cdn.example.com/photo.jpg',
      thumbnailUrl: 'https://cdn.example.com/photo-thumb.jpg',
    });

    const formData = new FormData();
    formData.set('file', new File(['image'], 'photo.jpg', { type: 'image/jpeg' }));
    formData.set('photoType', 'after');
    formData.set('caption', 'done');
    formData.set('uploadedByTechId', 'spoofed_tech');

    const response = await POST(
      new Request('http://localhost/api/appointments/appt_1/photos', {
        method: 'POST',
        body: formData,
      }),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(201);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      uploadedByTechId: 'tech_1',
    }));
    expect(insertValues).not.toHaveBeenCalledWith(expect.objectContaining({
      uploadedByTechId: 'spoofed_tech',
    }));
  });
});
