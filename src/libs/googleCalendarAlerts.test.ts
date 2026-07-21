/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { selectRows, sendTransactionalEmail } = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  sendTransactionalEmail: vi.fn(async (_payload: { to: string; subject: string; text: string; html: string }) => true),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/libs/email', () => ({ sendTransactionalEmail }));
vi.mock('@/libs/DB', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = async () => selectRows.shift() ?? [];
      return chain;
    },
  },
}));

import { sendGoogleCalendarDisconnectedEmail } from './googleCalendarAlerts';
import { classifyTokenRefreshFailure } from './googleCalendarFailure';

const CLASSIFICATION = classifyTokenRefreshFailure({
  httpStatus: 400,
  error: 'invalid_grant',
  errorDescription: 'Token has been expired',
});

describe('sendGoogleCalendarDisconnectedEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows.length = 0;
    process.env.PUBLIC_APP_URL = 'https://app.luster.test';
  });

  it('emails the owner with a direct reconnect link', async () => {
    selectRows.push([{ name: 'Isla Nail Studio', slug: 'isla', ownerEmail: 'owner@example.invalid', email: null }]);

    await expect(sendGoogleCalendarDisconnectedEmail({ salonId: 's1', classification: CLASSIFICATION }))
      .resolves.toBe(true);

    const payload = sendTransactionalEmail.mock.calls[0]![0];

    expect(payload.to).toBe('owner@example.invalid');
    expect(payload.subject).toContain('Google Calendar disconnected');
    expect(payload.text).toContain('https://app.luster.test/admin/integrations');
    expect(payload.html).toContain('Reconnect Google Calendar');
  });

  it('explains the cause so the owner knows what to do', async () => {
    selectRows.push([{ name: 'Isla', slug: 'isla', ownerEmail: 'owner@example.invalid', email: null }]);

    await sendGoogleCalendarDisconnectedEmail({ salonId: 's1', classification: CLASSIFICATION });

    const payload = sendTransactionalEmail.mock.calls[0]![0];

    expect(payload.text).toContain('Token has been expired');
    // And says why booking stopped, rather than leaving them guessing.
    expect(payload.text).toMatch(/paused/i);
    expect(payload.text).toMatch(/double-book/i);
  });

  it('falls back to the salon email when no owner email is set', async () => {
    selectRows.push([{ name: 'Isla', slug: 'isla', ownerEmail: null, email: 'salon@example.invalid' }]);

    await sendGoogleCalendarDisconnectedEmail({ salonId: 's1', classification: CLASSIFICATION });

    expect(sendTransactionalEmail.mock.calls[0]![0].to).toBe('salon@example.invalid');
  });

  it('sends nothing when there is no address to reach', async () => {
    selectRows.push([{ name: 'Isla', slug: 'isla', ownerEmail: null, email: null }]);

    await expect(sendGoogleCalendarDisconnectedEmail({ salonId: 's1', classification: CLASSIFICATION }))
      .resolves.toBe(false);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when the salon is missing', async () => {
    selectRows.push([]);

    await expect(sendGoogleCalendarDisconnectedEmail({ salonId: 'gone', classification: CLASSIFICATION }))
      .resolves.toBe(false);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('never includes credential material', async () => {
    selectRows.push([{ name: 'Isla', slug: 'isla', ownerEmail: 'owner@example.invalid', email: null }]);

    await sendGoogleCalendarDisconnectedEmail({ salonId: 's1', classification: CLASSIFICATION });

    const payload = sendTransactionalEmail.mock.calls[0]![0];

    expect(`${payload.text}${payload.html}`).not.toMatch(/refresh_token|client_secret|Bearer |access_token/i);
  });
});
