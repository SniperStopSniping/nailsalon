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

  it('sends through an active salon connection and records notification history', async () => {
    queueSelectResults(
      [{ status: 'granted' }],
      [activeConnection],
      [],
    );
    queueInsertResults([{ id: 'delivery_1' }]);

    const result = await sendSmartAppointmentReminder('salon_1', params);

    expect(result).toMatchObject({
      outcome: 'sent',
      phone: '4165550198',
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining(
        'View, reschedule, or cancel: https://islanailsalon.com/en/isla/manage/token',
      ),
      messagingServiceSid: 'MG_service',
      to: '+14165550198',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'accepted',
      providerMessageId: 'SM_reminder',
    }));
  });

  it('returns a manual draft when transactional consent is unavailable', async () => {
    queueSelectResults([]);

    const result = await sendSmartAppointmentReminder('salon_1', params);

    expect(result).toMatchObject({
      outcome: 'manual',
      reason: 'SMS_CONSENT_REQUIRED',
      phone: '4165550198',
      body: expect.stringContaining('BIAB Fill'),
    });
    expect(twilio).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does not use the legacy Twilio sender when the salon connection is unavailable', async () => {
    queueSelectResults([{ status: 'granted' }], []);

    const result = await sendSmartAppointmentReminder('salon_1', params);

    expect(result).toMatchObject({
      outcome: 'manual',
      reason: 'TWILIO_UNAVAILABLE',
    });
    expect(twilio).not.toHaveBeenCalled();
  });

  it('suppresses a rapid duplicate without another provider call', async () => {
    queueSelectResults(
      [{ status: 'granted' }],
      [activeConnection],
      [{ status: 'accepted', updatedAt: new Date('2026-07-22T17:59:30.000Z') }],
    );

    const result = await sendSmartAppointmentReminder('salon_1', params);

    expect(result).toEqual(expect.objectContaining({
      outcome: 'duplicate',
      sentAt: '2026-07-22T17:59:30.000Z',
    }));
    expect(db.insert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps a provider failure distinct from known manual fallback cases', async () => {
    queueSelectResults(
      [{ status: 'granted' }],
      [activeConnection],
      [],
    );
    queueInsertResults([{ id: 'delivery_1' }]);
    create.mockRejectedValue(Object.assign(new Error('Twilio timed out'), {
      code: 30008,
      status: 503,
    }));

    const result = await sendSmartAppointmentReminder('salon_1', params);

    expect(result).toMatchObject({
      outcome: 'provider_failure',
      errorCode: '30008',
      phone: '4165550198',
      body: expect.stringContaining('BIAB Fill'),
    });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorCode: '30008',
      retryable: true,
    }));
  });

  it('does not report a failed dedupe-key collision as a successful duplicate', async () => {
    queueSelectResults(
      [{ status: 'granted' }],
      [activeConnection],
      [],
      [{
        status: 'failed',
        errorCode: '30008',
        updatedAt: new Date('2026-07-22T17:59:30.000Z'),
      }],
    );
    queueInsertResults([]);

    const result = await sendSmartAppointmentReminder('salon_1', params);

    expect(result).toMatchObject({
      outcome: 'provider_failure',
      errorCode: '30008',
      phone: '4165550198',
      body: expect.stringContaining('BIAB Fill'),
    });
    expect(create).not.toHaveBeenCalled();
  });
});
