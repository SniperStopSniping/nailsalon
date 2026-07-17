import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const { mintAppointmentManageLink, requireAppointmentManagerAccess } = vi.hoisted(() => ({
  mintAppointmentManageLink: vi.fn(),
  requireAppointmentManagerAccess: vi.fn(),
}));

vi.mock('@/libs/appointmentManageLink', () => ({ mintAppointmentManageLink }));
vi.mock('@/libs/routeAccessGuards', () => ({ requireAppointmentManagerAccess }));

const appointment = {
  id: 'appt_1',
  salonId: 'salon_1',
  status: 'confirmed',
  endTime: new Date('2026-07-18T20:00:00.000Z'),
};

describe('POST /api/appointments/[id]/manage-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment,
      actorRole: 'admin',
    });
    mintAppointmentManageLink.mockResolvedValue('https://salon.test/manage/token');
  });

  it('uses the explicit salon hint and returns a customer management link', async () => {
    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/manage-link?salonSlug=glow'),
      { params: { id: 'appt_1' } },
    );

    expect(requireAppointmentManagerAccess).toHaveBeenCalledWith('appt_1', expect.objectContaining({
      assignedOnly: true,
      salonSlugHint: 'glow',
    }));
    expect(mintAppointmentManageLink).toHaveBeenCalledWith(appointment);
    await expect(response.json()).resolves.toMatchObject({
      data: { manageUrl: 'https://salon.test/manage/token' },
    });
  });

  it('preserves authorization failures', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }),
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/manage-link'),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(403);
    expect(mintAppointmentManageLink).not.toHaveBeenCalled();
  });

  it('does not mint links for finished appointments', async () => {
    requireAppointmentManagerAccess.mockResolvedValue({
      ok: true,
      appointment: { ...appointment, status: 'cancelled' },
      actorRole: 'admin',
    });

    const response = await POST(
      new Request('https://app.test/api/appointments/appt_1/manage-link'),
      { params: { id: 'appt_1' } },
    );

    expect(response.status).toBe(409);
    expect(mintAppointmentManageLink).not.toHaveBeenCalled();
  });
});
