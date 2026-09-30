import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_REBOOKING_REMINDER_MESSAGE } from '@/libs/rebookingReminders';

import { GET, PATCH } from './route';

const mocks = vi.hoisted(() => ({ requireSalon: vi.fn(), session: vi.fn(), read: vi.fn(), save: vi.fn(), audit: vi.fn() }));
vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon: mocks.requireSalon, getAdminSession: mocks.session }));
vi.mock('@/libs/rebookingReminders.server', () => ({ getRebookingReminderSettings: mocks.read, saveRebookingReminderSettings: mocks.save }));
vi.mock('@/libs/auditLog', () => ({ logAuditEvent: mocks.audit }));

const request = (method: 'GET' | 'PATCH', salonSlug: string, body?: unknown) => new Request(`https://luster.test/api/admin/rebooking-reminders?salonSlug=${salonSlug}`, {
  method,
  ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
});

describe('rebooking reminder settings authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ id: 'admin-a' });
    mocks.read.mockResolvedValue({ enabled: false, defaultIntervalWeeks: 3, messageTemplate: DEFAULT_REBOOKING_REMINDER_MESSAGE, enabledAt: null });
  });

  it('rejects a salon the admin cannot access before reading or changing data', async () => {
    mocks.requireSalon.mockResolvedValue({ error: Response.json({}, { status: 403 }) });

    expect((await GET(request('GET', 'salon-b'))).status).toBe(403);
    expect((await PATCH(request('PATCH', 'salon-b', { enabled: true, defaultIntervalWeeks: 3, messageTemplate: 'Book {{booking_link}}' }))).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('uses the authorized salon id for reads and writes', async () => {
    mocks.requireSalon.mockResolvedValue({ salon: { id: 'salon-a' } });
    mocks.save.mockResolvedValue({ enabled: true, defaultIntervalWeeks: 4, messageTemplate: 'Book {{booking_link}}', enabledAt: new Date('2026-09-30T14:00:00Z') });

    expect((await GET(request('GET', 'salon-a'))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith('salon-a');
    expect((await PATCH(request('PATCH', 'salon-a', { enabled: true, defaultIntervalWeeks: 4, messageTemplate: 'Book {{booking_link}}' }))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith('salon-a', { enabled: true, defaultIntervalWeeks: 4, messageTemplate: 'Book {{booking_link}}' });
  });

  it('rejects invalid or unknown variables before saving', async () => {
    mocks.requireSalon.mockResolvedValue({ salon: { id: 'salon-a' } });
    const response = await PATCH(request('PATCH', 'salon-a', { enabled: true, defaultIntervalWeeks: 3, messageTemplate: 'Hi {{client_secret}}' }));

    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
