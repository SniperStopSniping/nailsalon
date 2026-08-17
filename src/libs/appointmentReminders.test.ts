import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDayBeforeReminderDue,
  isSameDayReminderDue,
  processAppointmentReminders,
} from './appointmentReminders';

vi.mock('server-only', () => ({}));

const {
  mintAppointmentManageLink,
  resolveAppointmentOperationalEmailRecipient,
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
  isSmsEnabled,
  sendAppointmentOperationalEmailOnce,
  sendTransactionalEmail,
  getAppointmentServiceNames,
  sendAppointmentReminder,
  insert,
  select,
  updateSet,
  updateWhere,
  queueSelectResults,
  queueSmsAttemptResults,
  setCurrentReminderState,
  getSmsClaimKeys,
  emailClaims,
  resetEmailClaims,
  resetSmsClaims,
} = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const smsAttemptResults: unknown[][] = [];
  const currentReminderState = new Map<string, Record<string, unknown>>();
  const candidateStartTimes = new Map<string, number>();
  const emailClaims = new Map<string, {
    deliveryId: string;
    status: 'failed' | 'queued' | 'sent';
  }>();
  const smsClaims = new Map<string, {
    createdAt: Date;
    id: string;
    retryable: boolean;
    status: string;
    updatedAt: Date;
  }>();
  const smsClaimKeysById = new Map<string, string>();
  let lastConflictedSmsClaimKey: string | null = null;
  const staticResult = (rows: () => unknown[], onResolve?: (rows: unknown[]) => void) => {
    const chain: any = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (value: unknown[]) => void) => {
      const result = rows();
      onResolve?.(result);
      resolve(result);
    };
    return chain;
  };
  const select = vi.fn((fields?: Record<string, unknown>) => {
    const keys = Object.keys(fields ?? {}).sort().join(',');
    if (
      keys
      === 'dayBeforeReminderSentAt,deletedAt,salonSettings,sameDayReminderSentAt,startTime,status'
    ) {
      return staticResult(() => {
        const current = currentReminderState.values().next().value;
        return current ? [current] : [];
      });
    }
    if (keys === 'status') {
      return staticResult(() => [{ status: 'granted' }]);
    }
    if (keys === 'retryable,status') {
      return staticResult(() => smsAttemptResults.shift() ?? []);
    }
    if (keys === 'id,status') {
      return staticResult(() => {
        if (!lastConflictedSmsClaimKey) {
          return [];
        }
        const existing = smsClaims.get(lastConflictedSmsClaimKey);
        lastConflictedSmsClaimKey = null;
        return existing ? [existing] : [];
      });
    }
    return staticResult(
      () => selectResults.shift() ?? [],
      (rows) => {
        for (const row of rows) {
          if (
            row
            && typeof row === 'object'
            && 'appointmentId' in row
            && 'startTime' in row
            && typeof row.appointmentId === 'string'
          ) {
            currentReminderState.clear();
            candidateStartTimes.clear();
            currentReminderState.set(row.appointmentId, {
              ...row,
              deletedAt: null,
              status: 'confirmed',
            });
            if (row.startTime instanceof Date) {
              candidateStartTimes.set(row.appointmentId, row.startTime.getTime());
            }
          }
        }
      },
    );
  });

  const updateWhere = vi.fn();
  const updateSet = vi.fn((values: Record<string, unknown>) => {
    const chain: any = {};
    const applyUpdate = (reclaim: boolean) => {
      for (const [deliveryId, key] of smsClaimKeysById) {
        const current = smsClaims.get(key);
        if (
          current?.id === deliveryId
          && (!reclaim || (
            current.status === 'failed'
            && current.retryable === true
          ))
        ) {
          smsClaims.set(key, {
            ...current,
            ...(reclaim ? { updatedAt: new Date() } : {}),
            ...(typeof values.status === 'string'
              ? { status: values.status }
              : {}),
            ...(typeof values.retryable === 'boolean'
              ? { retryable: values.retryable }
              : {}),
          });
          if (reclaim) {
            return smsClaims.get(key);
          }
        }
      }
      return null;
    };
    chain.where = vi.fn((...args: unknown[]) => {
      updateWhere(...args);
      return chain;
    });
    chain.returning = vi.fn(async () => {
      const marker = 'dayBeforeReminderSentAt' in values
        ? 'dayBeforeReminderSentAt'
        : 'sameDayReminderSentAt' in values
          ? 'sameDayReminderSentAt'
          : null;
      if (marker) {
        const entry = currentReminderState.entries().next().value as
          | [string, Record<string, unknown>]
          | undefined;
        const currentStart = entry?.[1].startTime;
        if (
          !entry
          || entry[1][marker] != null
          || entry[1].deletedAt != null
          || !['pending', 'confirmed'].includes(String(entry[1].status))
          || !(currentStart instanceof Date)
          || currentStart.getTime() !== candidateStartTimes.get(entry[0])
        ) {
          return [];
        }
        const next = { ...entry[1], ...values };
        currentReminderState.set(entry[0], next);
        return [next];
      }
      const reclaimed = applyUpdate(true);
      if (reclaimed) {
        lastConflictedSmsClaimKey = null;
      }
      return reclaimed ? [reclaimed] : [];
    });
    chain.then = (resolve: (value: unknown[]) => void) => {
      applyUpdate(false);
      resolve([]);
    };
    return chain;
  });
  const update = vi.fn(() => ({ set: updateSet }));
  const insert = vi.fn(() => {
    let values: Record<string, unknown> | null = null;
    const chain: any = {
      values: vi.fn((nextValues: Record<string, unknown>) => {
        values = nextValues;
        return chain;
      }),
      onConflictDoNothing: vi.fn(() => chain),
      returning: vi.fn(async () => {
        const dedupeKey = typeof values?.dedupeKey === 'string'
          ? values.dedupeKey
          : null;
        const id = typeof values?.id === 'string' ? values.id : null;
        if (!dedupeKey || !id) {
          return [];
        }
        const existing = smsClaims.get(dedupeKey);
        if (existing) {
          lastConflictedSmsClaimKey = dedupeKey;
          return [];
        }
        const row = {
          createdAt: new Date(),
          id,
          retryable: values?.retryable === true,
          status: typeof values?.status === 'string' ? values.status : 'queued',
          updatedAt: new Date(),
        };
        smsClaims.set(dedupeKey, row);
        smsClaimKeysById.set(id, dedupeKey);
        return [row];
      }),
    };
    return chain;
  });

  return {
    mintAppointmentManageLink: vi.fn(),
    resolveAppointmentOperationalEmailRecipient: vi.fn(),
    resolveOperationalSalonClientContact: vi.fn(),
    resolveOperationalSalonClientContactByPhone: vi.fn(),
    isSmsEnabled: vi.fn(),
    sendAppointmentOperationalEmailOnce: vi.fn(),
    sendTransactionalEmail: vi.fn(),
    getAppointmentServiceNames: vi.fn(),
    sendAppointmentReminder: vi.fn(),
    insert,
    select,
    updateSet,
    updateWhere,
    queueSelectResults: (...rows: unknown[][]) => {
      selectResults.splice(0, selectResults.length, ...rows);
    },
    queueSmsAttemptResults: (...rows: unknown[][]) => {
      smsAttemptResults.splice(0, smsAttemptResults.length, ...rows);
    },
    setCurrentReminderState: (
      appointmentId: string,
      values: Record<string, unknown>,
    ) => {
      currentReminderState.set(appointmentId, {
        ...(currentReminderState.get(appointmentId) ?? {}),
        ...values,
      });
    },
    getSmsClaimKeys: () => [...smsClaims.keys()],
    resetEmailClaims: () => {
      emailClaims.clear();
    },
    resetSmsClaims: () => {
      smsClaims.clear();
      smsClaimKeysById.clear();
      smsAttemptResults.length = 0;
      lastConflictedSmsClaimKey = null;
    },
    emailClaims,
    db: {
      insert,
      select,
      update,
    },
  };
});

vi.mock('@/libs/email', () => ({
  sendTransactionalEmail,
}));

vi.mock('@/libs/clientLifecycleStabilization', () => ({
  resolveAppointmentOperationalEmailRecipient,
  resolveOperationalSalonClientContact,
  resolveOperationalSalonClientContactByPhone,
  sendAppointmentOperationalEmailOnce,
}));

vi.mock('@/libs/appointmentManageLink', () => ({
  mintAppointmentManageLink,
}));

vi.mock('@/libs/queries', () => ({
  getAppointmentServiceNames,
}));

vi.mock('@/libs/salonStatus', () => ({
  isSmsEnabled,
}));

vi.mock('@/libs/SMS', () => ({
  sendAppointmentReminder,
}));

vi.mock('@/libs/DB', () => ({
  db: {
    insert,
    select,
    update: vi.fn(() => ({ set: updateSet })),
    // Gate C1 orphan sweep runs one raw UPDATE ... RETURNING per pass.
    execute: vi.fn(async () => ({ rows: [] })),
  },
}));

// This suite pins the LEGACY dual-window BYO reminder path (owner decision
// 2.2: active BYO salons keep it byte-identical). Shared-mode candidates
// route to the rule-based reconciler, which has its own PGlite suite
// (appointmentReminders.reconciler.test.ts).
vi.mock('@/libs/communicationMaterialization', () => ({
  resolveSalonCommunicationContext: vi.fn(async () => ({
    settings: null,
    mode: 'connected_byo',
    smsEligible: false,
    timeZone: null,
    salonName: null,
  })),
  reconcileAppointmentReminders: vi.fn(async () => ({ materialized: [], skipped: [], canceledStale: 0 })),
  formatIntentStartTime: vi.fn(() => 'Wed Aug 26, 12:30 PM'),
  loadAppointmentClientEmail: vi.fn(async () => null),
}));

describe('appointment reminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueSelectResults();
    resetEmailClaims();
    resetSmsClaims();
    isSmsEnabled.mockResolvedValue(true);
    getAppointmentServiceNames.mockResolvedValue(['BIAB Fill']);
    resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'terminal_current',
      email: 'current@example.test',
      terminalClientId: 'primary_client',
    });
    sendTransactionalEmail.mockResolvedValue(true);
    sendAppointmentOperationalEmailOnce.mockImplementation(async (input) => {
      const key = [
        input.purpose,
        input.appointmentId,
        input.eventVersion,
      ].join(':');
      const existing = emailClaims.get(key);
      if (existing?.status === 'sent') {
        return {
          status: 'sent',
          deliveryId: existing.deliveryId,
          claimed: false,
        };
      }
      if (existing?.status === 'queued' || (existing && !input.retryFailed)) {
        return {
          status: 'duplicate',
          deliveryId: existing.deliveryId,
          claimed: false,
        };
      }
      const deliveryId = existing?.deliveryId ?? `email_delivery_${emailClaims.size + 1}`;
      emailClaims.set(key, { deliveryId, status: 'queued' });
      let content;
      try {
        content = await input.prepare();
      } catch {
        emailClaims.set(key, { deliveryId, status: 'failed' });
        return { status: 'failed', deliveryId, claimed: true };
      }
      const recipient = await resolveAppointmentOperationalEmailRecipient({
        salonId: input.salonId,
        appointmentId: input.appointmentId,
      });
      if (recipient.status === 'unavailable') {
        emailClaims.set(key, { deliveryId, status: 'failed' });
        return {
          status: 'unavailable',
          deliveryId,
          claimed: true,
        };
      }
      let valid = true;
      try {
        valid = await input.validateBeforeDelivery?.() ?? true;
      } catch {
        valid = false;
      }
      if (!valid) {
        emailClaims.set(key, { deliveryId, status: 'failed' });
        return { status: 'failed', deliveryId, claimed: true };
      }
      const sent = await sendTransactionalEmail({
        to: recipient.email,
        ...content,
      }).catch(() => false);
      emailClaims.set(key, { deliveryId, status: sent ? 'sent' : 'failed' });
      return {
        status: sent ? 'sent' : 'failed',
        deliveryId,
        claimed: true,
      };
    });
    sendAppointmentReminder.mockResolvedValue(true);
    mintAppointmentManageLink.mockResolvedValue(
      'https://app.luster.test/en/isla-nail-studio1/manage/TEST_TOKEN_NOT_A_REAL_CAPABILITY',
    );
    resolveOperationalSalonClientContact.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165550198',
      email: 'current@example.test',
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });
    resolveOperationalSalonClientContactByPhone.mockResolvedValue(null);
  });

  it('detects the day-before 6 PM local reminder window', () => {
    const due = isDayBeforeReminderDue({
      now: new Date('2026-03-31T22:05:00.000Z'),
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      timeZone: 'America/Toronto',
    });

    expect(due).toBe(true);
  });

  it('detects the 2-hour same-day reminder window', () => {
    const due = isSameDayReminderDue({
      now: new Date('2026-04-01T16:55:00.000Z'),
      startTime: new Date('2026-04-01T19:00:00.000Z'),
    });

    expect(due).toBe(true);
  });

  it('sends guaranteed day-before email and attempts consent-gated SMS', async () => {
    queueSelectResults([{
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'current@example.test',
      subject: 'Reminder: Your appointment tomorrow at Isla Nail Studio',
    }));
    expect(sendAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      kind: 'day_before',
      phone: '4165551234',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      dayBeforeReminderChannel: 'email',
    }));
    expect(result).toEqual({
      scanned: 1,
      dayBeforeSent: 1,
      dayBeforeEmail: 1,
      dayBeforeSms: 0,
      sameDaySent: 0,
      skipped: 0,
      failures: 0,
      intentsMaterialized: 0,
      intentsCanceledStale: 0,
      orphanIntentsCanceled: 0,
    });
  });

  it('falls back to SMS when the day-before email send fails', async () => {
    sendTransactionalEmail.mockResolvedValue(false);
    queueSelectResults([{
      appointmentId: 'appt_2',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      kind: 'day_before',
      phone: '4165551234',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      dayBeforeReminderChannel: 'sms',
    }));
    expect(result.dayBeforeSms).toBe(1);
    expect(result.failures).toBe(0);
  });

  it('uses terminal current phone without rewriting historical reminder email', async () => {
    queueSelectResults([{
      appointmentId: 'appt_merged',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '4165550100',
      appointmentEmail: 'historical@example.test',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'source@example.test',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(resolveOperationalSalonClientContact).toHaveBeenCalledWith({
      salonId: 'salon_1',
      clientId: 'merged_source',
      allowArchived: true,
    });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'current@example.test' }),
    );
    expect(sendAppointmentReminder).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165550198' }),
    );
    expect(result.dayBeforeSent).toBe(1);
  });

  it('uses a unique same-salon alias for a null-ID appointment', async () => {
    resolveOperationalSalonClientContactByPhone.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165550198',
      email: 'current@example.test',
      archivedAt: null,
      redirectedFromClientId: 'merged_source',
      lineagePath: ['merged_source', 'primary_client'],
    });
    queueSelectResults([{
      appointmentId: 'appt_legacy',
      salonId: 'salon_1',
      salonClientId: null,
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '4165550100',
      appointmentEmail: 'historical@example.test',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(resolveOperationalSalonClientContactByPhone).toHaveBeenCalledWith({
      salonId: 'salon_1',
      phone: '4165550100',
      allowArchived: true,
    });
    expect(sendAppointmentReminder).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165550198' }),
    );
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'current@example.test' }),
    );
    expect(result.dayBeforeSent).toBe(1);
  });

  it('does not send or mark a null-ID reminder with ambiguous lifecycle contact', async () => {
    resolveOperationalSalonClientContactByPhone.mockRejectedValue(
      new Error('ambiguous lifecycle state'),
    );
    queueSelectResults([{
      appointmentId: 'appt_ambiguous',
      salonId: 'salon_1',
      salonClientId: null,
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '4165550100',
      appointmentEmail: null,
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      salonClientEmail: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
    expect(result.failures).toBe(1);
  });

  it('fails closed without marking a reminder when terminal contact is invalid', async () => {
    resolveOperationalSalonClientContact.mockRejectedValueOnce(
      new Error('invalid lifecycle state'),
    );
    queueSelectResults([{
      appointmentId: 'appt_invalid',
      salonId: 'salon_1',
      salonClientId: 'merged_source',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '4165550100',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      salonClientEmail: null,
      appointmentEmail: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
    expect(result.failures).toBe(1);
  });

  it('sends the 2-hour reminder by email and attempts consent-gated SMS', async () => {
    queueSelectResults([{
      appointmentId: 'appt_3',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: new Date('2026-03-31T22:05:00.000Z'),
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-04-01T16:55:00.000Z'),
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'current@example.test',
      subject: 'Your Isla Nail Studio appointment is today',
    }));
    expect(sendAppointmentReminder).toHaveBeenCalledWith('salon_1', expect.objectContaining({
      kind: 'same_day',
      phone: '4165551234',
    }));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      sameDayReminderChannel: 'email',
    }));
    expect(result.sameDaySent).toBe(1);
  });

  it.each([
    {
      label: 'day-before',
      now: new Date('2026-03-31T22:05:00.000Z'),
      dayBeforeReminderSentAt: null,
      expectedSubject: 'Reminder: Your appointment tomorrow at Isla Nail Studio',
    },
    {
      label: 'same-day',
      now: new Date('2026-04-01T16:55:00.000Z'),
      dayBeforeReminderSentAt: new Date('2026-03-31T22:05:00.000Z'),
      expectedSubject: 'Your Isla Nail Studio appointment is today',
    },
  ])('uses an explicit zero-candidate orphan snapshot for $label email without rewriting snapshots', async ({
    now,
    dayBeforeReminderSentAt,
    expectedSubject,
  }) => {
    resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'appointment_snapshot',
      email: 'orphan@example.test',
      terminalClientId: null,
      identityResolution: 'zero_identity_candidates',
    });
    queueSelectResults([{
      appointmentId: 'orphan_appointment',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: null,
      appointmentEmail: 'orphan@example.test',
      dayBeforeReminderSentAt,
      sameDayReminderSentAt: null,
    }]);

    await processAppointmentReminders({ now });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'orphan@example.test',
        subject: expectedSubject,
      }),
    );
    expect(sendAppointmentReminder).toHaveBeenCalledTimes(1);

    for (const [values] of updateSet.mock.calls) {
      expect(values).not.toHaveProperty('clientEmail');
      expect(values).not.toHaveProperty('clientPhone');
      expect(values).not.toHaveProperty('appointmentEmail');
      expect(values).not.toHaveProperty('salonClientEmail');
    }
  });

  it('never uses a global identity fallback when canonical email is unavailable', async () => {
    resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'unavailable',
      reason: 'unsupported_client_identity',
    });
    queueSelectResults([{
      appointmentId: 'appt_4',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: null,
      salonClientEmail: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).toHaveBeenCalledWith(
      'salon_1',
      expect.objectContaining({ phone: '4165551234' }),
    );
  });

  it('puts the canonical management link in both reminder emails', async () => {
    const candidate = {
      appointmentId: 'appt_link',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };

    queueSelectResults([candidate]);
    await processAppointmentReminders({ now: new Date('2026-03-31T22:05:00.000Z') });

    queueSelectResults([{ ...candidate, dayBeforeReminderSentAt: new Date('2026-03-31T22:05:00.000Z') }]);
    await processAppointmentReminders({ now: new Date('2026-04-01T16:55:00.000Z') });

    expect(mintAppointmentManageLink).toHaveBeenCalledWith({
      id: 'appt_link',
      salonId: 'salon_1',
      endTime: candidate.endTime,
    });

    const bodies = sendTransactionalEmail.mock.calls.map(call => (call[0] as { text: string }).text);

    expect(bodies).toHaveLength(2);

    for (const body of bodies) {
      expect(body).toContain('https://app.luster.test/en/isla-nail-studio1/manage/TEST_TOKEN_NOT_A_REAL_CAPABILITY');
      expect(body).not.toMatch(/\/book\//);
    }

    for (const [, reminder] of sendAppointmentReminder.mock.calls) {
      expect(reminder).toEqual(expect.objectContaining({
        manageUrl: 'https://app.luster.test/en/isla-nail-studio1/manage/TEST_TOKEN_NOT_A_REAL_CAPABILITY',
      }));
    }

    expect(resolveAppointmentOperationalEmailRecipient).toHaveBeenCalledTimes(2);
  });

  it('still sends the reminder when the management link cannot be minted', async () => {
    mintAppointmentManageLink.mockRejectedValue(new Error('SALON_NOT_FOUND'));
    queueSelectResults([{
      appointmentId: 'appt_nolink',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({ now: new Date('2026-03-31T22:05:00.000Z') });

    expect(result.dayBeforeSent).toBe(1);
    expect((sendTransactionalEmail.mock.calls[0]![0] as { text: string }).text)
      .toContain('please contact the salon');
  });

  it('does not resend a day-before reminder that is already marked as sent', async () => {
    queueSelectResults([{
      appointmentId: 'appt_5',
      salonId: 'salon_1',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      technicianName: 'Daniela',
      salonClientEmail: 'ava@example.com',
      dayBeforeReminderSentAt: new Date('2026-03-31T22:00:00.000Z'),
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).not.toHaveBeenCalled();
    expect(resolveAppointmentOperationalEmailRecipient).not.toHaveBeenCalled();
    expect(updateWhere).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('resolves the current email only after the private manage link is ready', async () => {
    let releaseManageLink!: () => void;
    let signalManageLinkStarted!: () => void;
    const manageLinkStarted = new Promise<void>((resolve) => {
      signalManageLinkStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseManageLink = resolve;
    });
    mintAppointmentManageLink.mockImplementation(async () => {
      signalManageLinkStarted();
      await release;
      return 'https://app.luster.test/en/salon/manage/FRESH_TOKEN';
    });
    queueSelectResults([{
      appointmentId: 'appt_fresh_recipient',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const processing = processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    await manageLinkStarted;
    resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'terminal_current',
      email: 'changed@example.test',
      terminalClientId: 'primary_client',
    });
    releaseManageLink();
    await processing;

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'changed@example.test' }),
    );
    expect(sendTransactionalEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'current@example.test' }),
    );
  });

  it('does not resend a successful reminder after the current email changes', async () => {
    const candidate = {
      appointmentId: 'appt_email_changed',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };
    resolveOperationalSalonClientContact.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '',
      email: 'current@example.test',
      archivedAt: null,
      redirectedFromClientId: null,
      lineagePath: ['primary_client'],
    });
    const firstSend = sendAppointmentOperationalEmailOnce.getMockImplementation()!;
    sendAppointmentOperationalEmailOnce
      .mockImplementationOnce(firstSend)
      .mockResolvedValueOnce({
        status: 'sent',
        deliveryId: 'delivery_1',
        claimed: false,
      });
    queueSelectResults([candidate], [candidate]);

    await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    resolveAppointmentOperationalEmailRecipient.mockResolvedValue({
      status: 'terminal_current',
      email: 'changed@example.test',
      terminalClientId: 'primary_client',
    });
    await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'current@example.test' }),
    );
  });

  it('records email success even when the consent-gated SMS attempt fails', async () => {
    sendAppointmentReminder.mockRejectedValue(new Error('SMS unavailable'));
    queueSelectResults([{
      appointmentId: 'appt_partial_channel',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(result.dayBeforeEmail).toBe(1);
    expect(result.failures).toBe(0);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      dayBeforeReminderChannel: 'email',
    }));
  });

  it('allows one concurrent worker to claim each email and SMS reminder event', async () => {
    const candidate = {
      appointmentId: 'appt_concurrent_reminder',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };
    resolveOperationalSalonClientContact.mockResolvedValue({
      id: 'primary_client',
      salonId: 'salon_1',
      phone: '4165551234',
      email: 'current@example.test',
      archivedAt: null,
      redirectedFromClientId: null,
      lineagePath: ['primary_client'],
    });
    let claimed = false;
    let releaseWinner!: () => void;
    let signalClaimed!: () => void;
    const winnerClaimed = new Promise<void>((resolve) => {
      signalClaimed = resolve;
    });
    const winnerRelease = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    sendAppointmentOperationalEmailOnce.mockImplementation(async (input) => {
      if (claimed) {
        return {
          status: 'duplicate',
          deliveryId: 'delivery_1',
          claimed: false,
        };
      }
      claimed = true;
      const content = await input.prepare();
      if (await input.validateBeforeDelivery?.() === false) {
        return {
          status: 'failed',
          deliveryId: 'delivery_1',
          claimed: true,
        };
      }
      signalClaimed();
      await winnerRelease;
      await sendTransactionalEmail({
        to: 'current@example.test',
        ...content,
      });
      return {
        status: 'sent',
        deliveryId: 'delivery_1',
        claimed: true,
      };
    });
    queueSelectResults([candidate], [candidate]);

    const winner = processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    await winnerClaimed;
    const loser = processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    await loser;
    releaseWinner();
    await winner;

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendAppointmentReminder).toHaveBeenCalledTimes(1);
  });

  it('uses an independent SMS claim and repairs the marker without resending', async () => {
    const candidate = {
      appointmentId: 'appt_sms_claim',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };
    sendAppointmentOperationalEmailOnce.mockResolvedValue({
      status: 'unavailable',
      deliveryId: 'email_delivery_1',
      claimed: false,
    });
    queueSelectResults([candidate], [candidate]);

    const first = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    const markerWritesAfterFirst = updateSet.mock.calls.filter(
      ([values]) => values.dayBeforeReminderChannel === 'sms',
    ).length;
    const second = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendAppointmentReminder).toHaveBeenCalledTimes(1);
    expect(first.dayBeforeSms).toBe(1);
    expect(second.dayBeforeSms).toBe(1);
    expect(markerWritesAfterFirst).toBe(1);
    expect(updateSet.mock.calls.filter(
      ([values]) => values.dayBeforeReminderChannel === 'sms',
    )).toHaveLength(2);
  });

  it('reclaims consecutive proven retryable SMS failures until delivery succeeds', async () => {
    const candidate = {
      appointmentId: 'appt_sms_retry',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };
    sendAppointmentOperationalEmailOnce.mockResolvedValue({
      status: 'unavailable',
      deliveryId: 'email_delivery_retry',
      claimed: false,
    });
    sendAppointmentReminder
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    queueSmsAttemptResults(
      [{
        status: 'failed',
        retryable: true,
      }],
      [{
        status: 'failed',
        retryable: true,
      }],
    );
    queueSelectResults([candidate], [candidate], [candidate]);

    const first = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    const second = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    const third = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(first.failures).toBe(1);
    expect(second.failures).toBe(1);
    expect(third.dayBeforeSms).toBe(1);
    expect(sendAppointmentReminder).toHaveBeenCalledTimes(3);
  });

  it('does not retry an SMS failure the provider classified as ambiguous', async () => {
    const candidate = {
      appointmentId: 'appt_sms_ambiguous',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: null,
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };
    sendAppointmentOperationalEmailOnce.mockResolvedValue({
      status: 'unavailable',
      deliveryId: 'email_delivery_ambiguous',
      claimed: false,
    });
    sendAppointmentReminder.mockResolvedValue(false);
    queueSmsAttemptResults([{
      status: 'failed',
      retryable: false,
    }]);
    queueSelectResults([candidate], [candidate]);

    await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendAppointmentReminder).toHaveBeenCalledTimes(1);
  });

  it('refuses a superseded old-time candidate and leaves the moved time eligible', async () => {
    const oldStart = new Date('2026-04-01T19:00:00.000Z');
    const newStart = new Date('2026-04-01T19:15:00.000Z');
    const candidate = {
      appointmentId: 'appt_moved_during_reminder',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: oldStart,
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };
    queueSelectResults([candidate]);

    const staleResult = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
      beforeDeliveryGuard: async () => {
        setCurrentReminderState(candidate.appointmentId, {
          startTime: newStart,
          endTime: new Date('2026-04-01T20:15:00.000Z'),
        });
      },
    });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(sendAppointmentReminder).not.toHaveBeenCalled();
    expect(updateSet.mock.calls.filter(([values]) => (
      'dayBeforeReminderSentAt' in values
      || 'sameDayReminderSentAt' in values
    ))).toHaveLength(0);
    expect(staleResult).toEqual(expect.objectContaining({
      scanned: 1,
      skipped: 1,
      failures: 0,
      dayBeforeSent: 0,
    }));

    queueSelectResults([{
      ...candidate,
      startTime: newStart,
      endTime: new Date('2026-04-01T20:15:00.000Z'),
    }]);
    const currentResult = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(currentResult.dayBeforeSent).toBe(1);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendAppointmentOperationalEmailOnce.mock.calls.at(-1)?.[0])
      .toEqual(expect.objectContaining({ eventVersion: newStart.toISOString() }));
  });

  it('delivers an exact current candidate and commits its sent marker through CAS', async () => {
    const startTime = new Date('2026-04-01T19:00:00.000Z');
    queueSelectResults([{
      appointmentId: 'appt_exact_current',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime,
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    }]);

    const result = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendAppointmentReminder).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      dayBeforeReminderChannel: 'email',
      dayBeforeReminderSentAt: new Date('2026-03-31T22:05:00.000Z'),
    }));
    expect(result).toEqual(expect.objectContaining({
      dayBeforeSent: 1,
      dayBeforeEmail: 1,
      skipped: 0,
    }));
  });

  it('pins email and SMS reminder identity to the candidate start time', async () => {
    const oldStart = new Date('2026-04-01T19:00:00.000Z');
    const newStart = new Date('2026-04-01T19:15:00.000Z');
    const candidate = {
      appointmentId: 'appt_event_version',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: oldStart,
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };

    for (const startTime of [oldStart, oldStart, newStart]) {
      queueSelectResults([{
        ...candidate,
        startTime,
        endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
      }]);
      await processAppointmentReminders({
        now: new Date('2026-03-31T22:05:00.000Z'),
      });
    }

    const emailVersions = sendAppointmentOperationalEmailOnce.mock.calls.map(
      ([input]) => input.eventVersion,
    );

    expect(emailVersions).toEqual([
      oldStart.toISOString(),
      oldStart.toISOString(),
      newStart.toISOString(),
    ]);
    expect(new Set(emailVersions).size).toBe(2);

    const smsKeys = getSmsClaimKeys();

    expect(smsKeys).toHaveLength(2);
    expect(smsKeys.some(key => key.endsWith(oldStart.toISOString()))).toBe(true);
    expect(smsKeys.some(key => key.endsWith(newStart.toISOString()))).toBe(true);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(sendAppointmentReminder).toHaveBeenCalledTimes(2);
  });

  it('allows concurrent workers at most one provider call per current channel', async () => {
    const candidate = {
      appointmentId: 'appt_default_durable_concurrency',
      salonId: 'salon_1',
      salonClientId: 'primary_client',
      salonName: 'Isla Nail Studio',
      salonSettings: { booking: { timezone: 'America/Toronto' } },
      clientName: 'Ava',
      clientPhone: '+14165551234',
      startTime: new Date('2026-04-01T19:00:00.000Z'),
      endTime: new Date('2026-04-01T20:00:00.000Z'),
      technicianName: 'Daniela',
      dayBeforeReminderSentAt: null,
      sameDayReminderSentAt: null,
    };
    let signalEmailProvider!: () => void;
    let releaseEmailProvider!: () => void;
    const emailProviderStarted = new Promise<void>((resolve) => {
      signalEmailProvider = resolve;
    });
    const emailProviderRelease = new Promise<void>((resolve) => {
      releaseEmailProvider = resolve;
    });
    sendTransactionalEmail.mockImplementation(async () => {
      signalEmailProvider();
      await emailProviderRelease;
      return true;
    });
    queueSelectResults([candidate], [candidate]);

    const first = processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    await emailProviderStarted;
    const secondResult = await processAppointmentReminders({
      now: new Date('2026-03-31T22:05:00.000Z'),
    });
    releaseEmailProvider();
    const firstResult = await first;

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendAppointmentReminder).toHaveBeenCalledTimes(1);
    expect(firstResult.dayBeforeSent + secondResult.dayBeforeSent).toBe(1);
  });
});
