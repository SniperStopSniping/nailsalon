import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE } from './route';

const {
  requireAppointmentManagerAccess,
  deleteAppointmentPhoto,
  logAppointmentChange,
  db,
  photoRows,
} = vi.hoisted(() => {
  const photoRows: unknown[] = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => photoRows.splice(0, photoRows.length)),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
  };
  return {
    requireAppointmentManagerAccess: vi.fn(),
    deleteAppointmentPhoto: vi.fn(async () => undefined),
    logAppointmentChange: vi.fn(async () => undefined),
    db,
    photoRows,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));
vi.mock('@/libs/Cloudinary', () => ({ deleteAppointmentPhoto }));
vi.mock('@/libs/appointmentAudit', () => ({ logAppointmentChange }));

const PHOTO = {
  id: 'photo_1',
  appointmentId: 'appt_1',
  salonId: 'salon_1',
  photoType: 'after',
  cloudinaryPublicId: 'pub_1',
  imageUrl: 'https://img.test/1.jpg',
  uploadedByTechId: 'tech_1',
};

function deleteRequest() {
  return new Request('http://localhost/api/appointments/appt_1/photos/photo_1', {
    method: 'DELETE',
  });
}

const ADMIN_ACCESS = {
  ok: true,
  actorRole: 'admin',
  admin: { id: 'admin_1', name: 'Olive Owner' },
  appointment: { id: 'appt_1', salonId: 'salon_1', technicianId: 'tech_1' },
};

describe('DELETE /api/appointments/[id]/photos/[photoId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    photoRows.length = 0;
  });

  it('404s when the photo does not exist on this appointment', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(ADMIN_ACCESS);

    const response = await DELETE(deleteRequest(), {
      params: { id: 'appt_1', photoId: 'photo_1' },
    });

    expect(response.status).toBe(404);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('lets an admin remove any photo, cleans Cloudinary, and audits', async () => {
    requireAppointmentManagerAccess.mockResolvedValue(ADMIN_ACCESS);
    photoRows.push(PHOTO);

    const response = await DELETE(deleteRequest(), {
      params: { id: 'appt_1', photoId: 'photo_1' },
    });

    expect(response.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(deleteAppointmentPhoto).toHaveBeenCalledWith('pub_1');
    expect(logAppointmentChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'photo_removed' }),
    );
  });

  it('lets staff remove only their own uploads', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      session: {
        technicianId: 'tech_2',
        technicianName: 'Other Tech',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '4165550100',
      },
      appointment: { id: 'appt_1', salonId: 'salon_1', technicianId: 'tech_2' },
    });
    photoRows.push(PHOTO); // uploaded by tech_1

    const forbidden = await DELETE(deleteRequest(), {
      params: { id: 'appt_1', photoId: 'photo_1' },
    });

    expect(forbidden.status).toBe(403);
    expect(db.delete).not.toHaveBeenCalled();

    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      actorRole: 'staff',
      session: {
        technicianId: 'tech_1',
        technicianName: 'Uploader',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '4165550100',
      },
      appointment: { id: 'appt_1', salonId: 'salon_1', technicianId: 'tech_1' },
    });
    photoRows.push(PHOTO);

    const allowed = await DELETE(deleteRequest(), {
      params: { id: 'appt_1', photoId: 'photo_1' },
    });

    expect(allowed.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
