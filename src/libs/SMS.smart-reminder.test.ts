/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  create,
  db,
  isSmsEnabled,
  queueInsertResults,
  queueSelectResults,
  twilio,
  updateSet,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const insertResults: unknown[][] = [];
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(async () => selectResults.shift() ?? []),
  };
  const insertChain = {
    values: vi.fn(() => insertChain),
    onConflictDoNothing: vi.fn(() => insertChain),
    returning: vi.fn(async () => insertResults.shift() ?? []),
  };
  const updateWhere = vi.fn(async () => []);
  const updateSet = vi.fn(() => ({ where: updateWhere }));

  return {
    create: vi.fn(),
    db: {
      select: vi.fn(() => query),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => ({ set: updateSet })),
    },
    isSmsEnabled: vi.fn(),
    queueInsertResults: (...rows: unknown[][]) => {
      insertResults.splice(0, insertResults.length, ...rows);
    },
    queueSelectResults: (...rows: unknown[][]) => {
      selectResults.splice(0, selectResults.length, ...rows);
    },
    twilio: vi.fn(),
    updateSet,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/salonStatus', () => ({ isSmsEnabled }));
vi.mock('@/libs/Env', () => ({
  Env: {
    NEXT_PUBLIC_APP_URL: 'https://app.luster.test',
    TWILIO_ACCOUNT_SID: 'legacy_sid',
    TWILIO_AUTH_TOKEN: 'twilio_token',
    TWILIO_PHONE_NUMBER: '+15551234567',
  },
}));
vi.mock('twilio', () => ({ default: twilio }));

import { sendSmartAppointmentReminder } from './SMS';

const params = {
  phone: '(416) 555-0198',
  clientName: 'Ava',
  appointmentId: 'appt_1',
  salonName: 'Isla Nail Studio',
  startTime: '2026-07-22T21:00:00.000Z',
  hoursUntil: 3,
  services: ['BIAB Fill'],
  technicianName: 'Daniela',
  timeZone: 'America/Toronto',
  manageUrl: 'https://islanailsalon.com/en/isla/manage/token',
  now: new Date('2026-07-22T18:00:00.000Z'),
};

const activeConnection = {
  salonId: 'salon_1',
  connectAccountSid: 'AC_connected',
  messagingServiceSid: 'MG_service',
  phoneNumber: null,
  status: 'active',
};

describe('sendSmartAppointmentReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSmsEnabled.mockResolvedValue(true);
    create.mockResolvedValue({ sid: 'SM_reminder', status: 'accepted' });
    twilio.mockReturnValue({ messages: { create } });
    queueSelectResults();
    queueInsertResults();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each([false, true])('returns an unsent draft for a retired active connection even with force=%s', async (force) => {
    queueSelectResults([{ status: 'granted' }], [activeConnection]);
    const result = await sendSmartAppointmentReminder('salon_1', { ...params, force });

    expect(result).toMatchObject({ outcome: 'manual', reason: 'TWILIO_UNAVAILABLE', body: expect.stringContaining('BIAB Fill') });
    expect(create).not.toHaveBeenCalled();
    expect(twilio).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('returns a draft when consent is unavailable without contacting any provider', async () => {
    queueSelectResults([]);

    expect(await sendSmartAppointmentReminder('salon_1', params)).toMatchObject({ outcome: 'manual', reason: 'SMS_CONSENT_REQUIRED' });
    expect(twilio).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('never falls back to the platform number when there is no connection', async () => {
    queueSelectResults([{ status: 'granted' }], []);

    expect(await sendSmartAppointmentReminder('salon_1', params)).toMatchObject({ outcome: 'manual', reason: 'TWILIO_UNAVAILABLE' });
    expect(twilio).not.toHaveBeenCalled();
  });
});
