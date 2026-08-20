import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const { processAppointmentReminders, sweepExpiredApprovalRequests } = vi.hoisted(() => ({
  processAppointmentReminders: vi.fn(),
  sweepExpiredApprovalRequests: vi.fn(),
}));

vi.mock('@/libs/appointmentReminders', () => ({
  processAppointmentReminders,
}));

// L1 PR5 — the approval-request sweep piggybacks on this cron (vercel.json
// stays zero-diff); mocked here exactly like appointmentReminders above so
// this suite stays focused on the route's own auth/wiring behaviour.
vi.mock('@/libs/approvalRequestSweeper', () => ({
  sweepExpiredApprovalRequests,
}));

const EMPTY_APPROVAL_SWEEP_SUMMARY = {
  scanned: 0,
  expired: 0,
  alreadyExpired: 0,
  skipped: 0,
};

describe('POST /api/reminders/process', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    sweepExpiredApprovalRequests.mockResolvedValue(EMPTY_APPROVAL_SWEEP_SUMMARY);
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it('returns 500 when CRON_SECRET is missing', async () => {
    const response = await POST(new Request('http://localhost/api/reminders/process', {
      method: 'POST',
    }));

    expect(response.status).toBe(500);
    expect(processAppointmentReminders).not.toHaveBeenCalled();
    expect(sweepExpiredApprovalRequests).not.toHaveBeenCalled();
  });

  it('returns 401 when the cron secret is invalid', async () => {
    process.env.CRON_SECRET = 'expected-secret';

    const response = await POST(new Request('http://localhost/api/reminders/process', {
      method: 'POST',
      headers: {
        'x-cron-secret': 'wrong-secret',
      },
    }));

    expect(response.status).toBe(401);
    expect(processAppointmentReminders).not.toHaveBeenCalled();
    expect(sweepExpiredApprovalRequests).not.toHaveBeenCalled();
  });

  it('accepts x-cron-secret and returns the reminder summary plus the approval-request sweep summary', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    processAppointmentReminders.mockResolvedValue({
      scanned: 3,
      dayBeforeSent: 1,
      dayBeforeEmail: 1,
      dayBeforeSms: 0,
      sameDaySent: 1,
      skipped: 1,
      failures: 0,
    });
    sweepExpiredApprovalRequests.mockResolvedValue({
      scanned: 2,
      expired: 1,
      alreadyExpired: 0,
      skipped: 1,
    });

    const response = await POST(new Request('http://localhost/api/reminders/process', {
      method: 'POST',
      headers: {
        'x-cron-secret': 'expected-secret',
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: {
        scanned: 3,
        dayBeforeSent: 1,
        dayBeforeEmail: 1,
        dayBeforeSms: 0,
        sameDaySent: 1,
        skipped: 1,
        failures: 0,
        approvalRequests: {
          scanned: 2,
          expired: 1,
          alreadyExpired: 0,
          skipped: 1,
        },
      },
    });
    expect(processAppointmentReminders).toHaveBeenCalledTimes(1);
    expect(sweepExpiredApprovalRequests).toHaveBeenCalledTimes(1);
  });

  it('accepts bearer auth for cron callers', async () => {
    process.env.CRON_SECRET = 'expected-secret';
    processAppointmentReminders.mockResolvedValue({
      scanned: 0,
      dayBeforeSent: 0,
      dayBeforeEmail: 0,
      dayBeforeSms: 0,
      sameDaySent: 0,
      skipped: 0,
      failures: 0,
    });

    const response = await POST(new Request('http://localhost/api/reminders/process', {
      method: 'POST',
      headers: {
        authorization: 'Bearer expected-secret',
      },
    }));

    expect(response.status).toBe(200);
    expect(processAppointmentReminders).toHaveBeenCalledTimes(1);
    expect(sweepExpiredApprovalRequests).toHaveBeenCalledTimes(1);
  });
});
