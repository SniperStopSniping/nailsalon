/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireStaffSession, requireAdmin, requireActiveAdminSalon, getClientSession, getSalonBySlug, appointmentQueue } = vi.hoisted(() => ({
  requireStaffSession: vi.fn(),
  requireAdmin: vi.fn(),
  requireActiveAdminSalon: vi.fn(),
  getClientSession: vi.fn(),
  getSalonBySlug: vi.fn(),
  appointmentQueue: [] as unknown[][],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/staffAuth', () => ({ requireStaffSession }));
vi.mock('@/libs/adminAuth', () => ({ requireAdmin, requireActiveAdminSalon }));
vi.mock('@/libs/clientAuth', () => ({ getClientSession }));
vi.mock('@/libs/clientApiGuards', () => ({ normalizeClientPhone: (phone: string) => phone }));
vi.mock('@/libs/queries', () => ({ getSalonBySlug }));
vi.mock('@/libs/DB', () => ({
  db: {
    select: vi.fn(() => {
      const chain: any = {};
      for (const method of ['from', 'where', 'limit']) {
        chain[method] = vi.fn(() => chain);
      }
      chain.then = (resolve: any, reject: any) =>
        Promise.resolve(appointmentQueue.shift() ?? []).then(resolve, reject);
      return chain;
    }),
  },
}));

import { requireAppointmentManagerAccess } from './routeAccessGuards';

const HINTED_SALON = { id: 'salon_hinted', slug: 'hinted-salon' };
const ACTIVE_SALON = { id: 'salon_active', slug: 'active-salon' };
const ADMIN = { id: 'admin_1', salonIds: ['salon_hinted', 'salon_active'] };
const APPOINTMENT = { id: 'appt_1', salonId: 'salon_hinted', technicianId: 'tech_1' };

describe('requireAppointmentManagerAccess salon hint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appointmentQueue.length = 0;
    requireStaffSession.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    getClientSession.mockResolvedValue(null);
    getSalonBySlug.mockResolvedValue(HINTED_SALON);
    requireAdmin.mockResolvedValue({ ok: true, admin: ADMIN });
    requireActiveAdminSalon.mockResolvedValue({ salon: ACTIVE_SALON, admin: ADMIN, error: null });
  });

  it('resolves the appointment in the hinted salon when the admin belongs to it', async () => {
    appointmentQueue.push([APPOINTMENT]);

    const access = await requireAppointmentManagerAccess('appt_1', { salonSlugHint: 'hinted-salon' });

    expect(access.ok).toBe(true);
    expect(requireAdmin).toHaveBeenCalledWith('salon_hinted');
    // The hint short-circuits — the active-salon cookie is never consulted.
    expect(requireActiveAdminSalon).not.toHaveBeenCalled();
    if (access.ok) {
      expect(access.actorRole).toBe('admin');
      expect(access.appointment).toEqual(APPOINTMENT);
    }
  });

  it('never grants access through a hint for a salon the admin does not belong to', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    // Fallback active-salon path finds nothing for this appointment.
    appointmentQueue.push([]);

    const access = await requireAppointmentManagerAccess('appt_1', { salonSlugHint: 'hinted-salon' });

    expect(access.ok).toBe(false);
    if (!access.ok) {
      expect(access.response.status).toBe(404);
    }
    // It fell back to the verified active-salon path instead of trusting the hint.
    expect(requireActiveAdminSalon).toHaveBeenCalled();
  });

  it('ignores unknown hinted slugs and uses the active salon', async () => {
    getSalonBySlug.mockResolvedValue(null);
    appointmentQueue.push([{ ...APPOINTMENT, salonId: 'salon_active' }]);

    const access = await requireAppointmentManagerAccess('appt_1', { salonSlugHint: 'ghost-salon' });

    expect(access.ok).toBe(true);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(requireActiveAdminSalon).toHaveBeenCalled();
  });

  it('behaves exactly as before when no hint is provided', async () => {
    appointmentQueue.push([{ ...APPOINTMENT, salonId: 'salon_active' }]);

    const access = await requireAppointmentManagerAccess('appt_1');

    expect(access.ok).toBe(true);
    expect(getSalonBySlug).not.toHaveBeenCalled();
    expect(requireActiveAdminSalon).toHaveBeenCalled();
  });
});
