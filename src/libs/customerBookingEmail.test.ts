/* eslint-disable import/first */
import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueuedResult = unknown[];
type QueuedSelectResult = QueuedResult | Error;
type QueuedUpdateResult = QueuedResult | Error;

const state = vi.hoisted(() => ({
  deliveryClaimed: false,
  evidenceQueue: [] as QueuedSelectResult[],
  eligibilityQueue: [] as QueuedSelectResult[],
  insertQueue: [] as QueuedResult[],
  insertedValues: [] as Array<{ table: unknown; values: unknown }>,
  recipient: {
    status: 'terminal_current',
    email: 'current@example.com',
    terminalClientId: 'client_1',
  } as
  | {
    status: 'terminal_current' | 'appointment_snapshot';
    email: string;
    terminalClientId: string;
  }
  | {
    status: 'appointment_snapshot';
    email: string;
    terminalClientId: null;
    identityResolution: 'zero_identity_candidates';
  }
  | {
    status: 'unavailable';
    reason: 'email_unavailable';
  },
  resolveAppointmentOperationalEmailRecipient: vi.fn(),
  resolveBookingConfigFromSettings: vi.fn(),
  selectProjections: [] as string[][],
  selectQueue: [] as QueuedSelectResult[],
  settingsQueue: [] as QueuedSelectResult[],
  sendTransactionalEmailDetailed: vi.fn(),
  updateQueue: [] as QueuedUpdateResult[],
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
}));

const { dbMock } = vi.hoisted(() => {
  function selectChain(nextRows: () => QueuedSelectResult) {
    const chain: Record<string, any> = {};
    for (const method of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const next = nextRows();
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next))
        .then(resolve, reject);
    };
    return chain;
  }
  function insertChain(table: unknown) {
    const chain: Record<string, any> = {};
    chain.values = vi.fn((values: unknown) => {
      state.insertedValues.push({ table, values });
      return chain;
    });
    chain.onConflictDoNothing = vi.fn(() => chain);
    chain.returning = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(state.insertQueue.shift() ?? [{}]).then(resolve, reject);
    return chain;
  }
  function updateChain(table: unknown) {
    const chain: Record<string, any> = {};
    let updateValues: Record<string, unknown> = {};
    chain.set = vi.fn((values: Record<string, unknown>) => {
      updateValues = values;
      state.updates.push({ table, set: values });
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.returning = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const isClaim = updateValues.status === 'queued'
        && updateValues.retryable === false
        && updateValues.errorCode === 'EMAIL_DELIVERY_STATE_UNKNOWN';
      const next = state.updateQueue.length
        ? state.updateQueue.shift()!
        : isClaim && !state.deliveryClaimed
          ? [{ id: 'delivery_1' }]
          : [];
      if (!(next instanceof Error)) {
        if (isClaim && next.length) {
          state.deliveryClaimed = true;
        } else if (
          updateValues.status === 'failed'
          && updateValues.retryable === true
        ) {
          state.deliveryClaimed = false;
        }
      }
      return (next instanceof Error ? Promise.reject(next) : Promise.resolve(next))
        .then(resolve, reject);
    };
    return chain;
  }
  return {
    dbMock: {
      insert: vi.fn((table: unknown) => insertChain(table)),
      select: vi.fn((fields?: Record<string, unknown>) => {
        state.selectProjections.push(Object.keys(fields ?? {}));
        const eligibilityProjection = fields
          && Object.keys(fields).length === 3
          && 'status' in fields
          && 'deletedAt' in fields
          && 'startTime' in fields;
        const settingsProjection = fields
          && Object.keys(fields).length === 3
          && 'plan' in fields
          && 'features' in fields
          && 'settings' in fields;
        const evidenceProjection = fields
          && Object.keys(fields).length === 5
          && 'title' in fields
          && 'policyText' in fields
          && 'acknowledgmentText' in fields
          && 'version' in fields
          && 'acknowledgedAt' in fields;
        return selectChain(() => {
          if (eligibilityProjection) {
            return state.eligibilityQueue.shift() ?? [{
              status: 'confirmed',
              deletedAt: null,
              startTime: new Date('2099-07-01T18:00:00Z'),
            }];
          }
          if (settingsProjection) {
            return state.settingsQueue.shift() ?? [{
              plan: 'single_salon',
              features: null,
              settings: null,
            }];
          }
          if (evidenceProjection) {
            return state.evidenceQueue.shift() ?? [];
          }
          return state.selectQueue.shift() ?? [];
        });
      }),
      update: vi.fn((table: unknown) => updateChain(table)),
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('./DB', () => ({ db: dbMock }));
vi.mock('./clientLifecycleStabilization', () => ({
  resolveAppointmentOperationalEmailRecipient:
    state.resolveAppointmentOperationalEmailRecipient,
}));
vi.mock('./email', () => ({
  sendTransactionalEmailDetailed: state.sendTransactionalEmailDetailed,
}));
vi.mock('./bookingConfig', () => ({
  resolveBookingConfigFromSettings: state.resolveBookingConfigFromSettings,
}));
vi.mock('./lusterSecurity', () => ({
  createOpaqueToken: vi.fn(() => ({
    token: 'opaque-token-value',
    tokenHash: 'token-hash-value',
  })),
}));

import {
  appointmentAccessTokenSchema,
  appointmentBookingPolicyAcknowledgmentSchema,
  appointmentSchema,
  clientCommunicationSchema,
  integrationOutboxSchema,
  notificationDeliverySchema,
} from '@/models/Schema';

import {
  resendCustomerBookingConfirmationEmail,
  retryCustomerBookingConfirmationEmail,
  sendCustomerBookingConfirmationEmail,
} from './customerBookingEmail';

const appointmentRow = {
  appointment: {
    id: 'appointment_1',
    clientEmail: 'historical@example.com',
    clientName: 'Client',
    status: 'confirmed',
    deletedAt: null,
    startTime: new Date('2099-07-01T18:00:00Z'),
    endTime: new Date('2099-07-01T19:00:00Z'),
  },
  salonName: 'Salon',
  salonSlug: 'salon',
  customDomain: null,
  salonPlan: 'single_salon',
  salonFeatures: null,
  salonSettings: null,
};

function settingsWithConfirmationMessage(message: string) {
  return {
    bookingExperience: {
      primaryColor: null,
      bookingMessage: null,
      policy: {
        enabled: false,
        title: null,
        text: null,
        showOnServicePage: true,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: true,
      },
      quickFacts: {
        appointmentOnly: {
          enabled: false,
          label: null,
        },
        depositNotice: {
          enabled: false,
          label: null,
        },
        cancellationNotice: {
          enabled: false,
          label: null,
        },
      },
      socialLinks: {
        instagram: null,
        facebook: null,
        tiktok: null,
      },
      confirmationMessage: message,
    },
  };
}

function settingsWithEmailPolicy(input?: {
  enabled?: boolean;
  showInConfirmationEmail?: boolean;
  title?: string | null;
  text?: string | null;
}) {
  return {
    bookingExperience: {
      primaryColor: null,
      bookingMessage: null,
      policy: {
        enabled: input?.enabled ?? true,
        title: input?.title ?? 'Deposit & cancellation policy',
        text: input?.text
          ?? 'Please provide 24 hours’ notice. <No-shows> may lose their deposit.',
        showOnServicePage: true,
        showBeforeConfirmation: true,
        showAfterConfirmation: true,
        showInConfirmationEmail: input?.showInConfirmationEmail ?? true,
      },
      quickFacts: {
        appointmentOnly: {
          enabled: false,
          label: null,
        },
        depositNotice: {
          enabled: false,
          label: null,
        },
        cancellationNotice: {
          enabled: false,
          label: null,
        },
      },
      socialLinks: {
        instagram: null,
        facebook: null,
        tiktok: null,
      },
      confirmationMessage: null,
    },
  };
}

function initialInput() {
  return {
    salonId: 'salon_1',
    appointmentId: 'appointment_1',
    salonName: 'Salon',
    clientName: 'Client',
    serviceNames: ['Manicure'],
    startTime: '2099-07-01T18:00:00Z',
    timeZone: 'America/Toronto',
    manageUrl: 'https://salon.example/manage/token',
  };
}

function validPolicyEvidence(overrides?: Partial<{
  title: string;
  policyText: string;
  acknowledgmentText: string;
  version: string;
  acknowledgedAt: Date;
}>) {
  const title = overrides?.title ?? 'Stored booking policy';
  const policyText = overrides?.policyText ?? 'Stored policy terms.';
  const acknowledgmentText = overrides?.acknowledgmentText
    ?? 'I acknowledge the stored policy.';
  const canonicalPayload = JSON.stringify({
    schemaVersion: 1,
    title,
    text: policyText,
    acknowledgmentText,
  });

  return {
    title,
    policyText,
    acknowledgmentText,
    version: overrides?.version ?? `policy-v1:${createHash('sha256')
      .update(canonicalPayload, 'utf8')
      .digest('hex')}`,
    acknowledgedAt: new Date('2099-06-01T12:30:00Z'),
    id: 'internal-evidence-id',
    requestHash: 'sensitive-request-hash',
    attemptId: 'sensitive-attempt-id',
    reservationRevision: 42,
    ...(overrides?.acknowledgedAt
      ? { acknowledgedAt: overrides.acknowledgedAt }
      : {}),
  };
}

describe('customer booking operational email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.deliveryClaimed = false;
    state.evidenceQueue.length = 0;
    state.eligibilityQueue.length = 0;
    state.insertQueue.length = 0;
    state.insertedValues.length = 0;
    state.selectQueue.length = 0;
    state.settingsQueue.length = 0;
    state.updateQueue.length = 0;
    state.updates.length = 0;
    state.recipient = {
      status: 'terminal_current',
      email: 'current@example.com',
      terminalClientId: 'client_1',
    };
    state.resolveAppointmentOperationalEmailRecipient.mockImplementation(
      async () => state.recipient,
    );
    state.resolveBookingConfigFromSettings.mockReturnValue({
      timezone: 'America/Toronto',
    });
    state.selectProjections.length = 0;
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: true,
      providerMessageId: 'message_1',
      errorCode: null,
    });
  });

  it('resolves the current recipient before the initial confirmation send', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.resolveAppointmentOperationalEmailRecipient).toHaveBeenCalledWith({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'current@example.com' }),
    );
  });

  it('appends the normalized shared message after unchanged initial HTML and plain-text content', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.settingsQueue.push([{
      plan: 'single_salon',
      features: null,
      settings: settingsWithConfirmationMessage(
        'Please arrive <early>.\nBring your confirmation & ID.',
      ),
    }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.subject).toBe('Salon booking confirmed');
    expect(email.text).toBe(
      'Hi Client,\n\n'
      + 'Your Manicure appointment with Salon is confirmed for Wednesday, July 1 at 2:00 PM.\n\n'
      + 'View, reschedule, or cancel: https://salon.example/manage/token\n\n'
      + 'Please arrive <early>.\nBring your confirmation & ID.',
    );
    expect(email.html).toContain(
      '<p><a href="https://salon.example/manage/token">View, reschedule, or cancel your appointment</a></p>',
    );
    expect(email.html).toContain(
      '<p>Please arrive &lt;early&gt;.<br />Bring your confirmation &amp; ID.</p>',
    );
    expect(email.html).not.toContain('<early>');
  });

  it('places the current enabled policy beneath appointment details in the initial email', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.settingsQueue.push([{
      plan: 'single_salon',
      features: null,
      settings: settingsWithEmailPolicy(),
    }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).toContain(
      'Deposit & cancellation policy\n'
      + 'Please provide 24 hours’ notice. <No-shows> may lose their deposit.\n\n'
      + 'View, reschedule, or cancel:',
    );
    expect(email.html).toContain(
      '<div><p><strong>Deposit &amp; cancellation policy</strong></p>'
      + '<p>Please provide 24 hours’ notice. &lt;No-shows&gt; may lose their deposit.</p></div>'
      + '<p><a href="https://salon.example/manage/token">',
    );
    expect(email.html).not.toContain('<No-shows>');
    expect(email.text).not.toContain('Booking policy acknowledged');
    expect(email.html).not.toContain('Booking policy acknowledged');
  });

  it('uses only valid stored acknowledgment snapshots for the initial policy section', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.settingsQueue.push([{
      plan: 'free',
      features: null,
      settings: settingsWithEmailPolicy({
        title: 'Current policy must not render',
        text: 'Current terms must not render.',
      }),
    }]);
    const evidence = validPolicyEvidence({
      title: 'Stored <policy> & "rules"',
      policyText: 'Stored line <one>\nLine & two',
      acknowledgmentText: 'I "acknowledge" \'<this>\'.\nSecond line.',
    });
    state.evidenceQueue.push([evidence]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).toContain(
      'Booking policy acknowledged\n'
      + 'Stored <policy> & "rules"\n'
      + 'Stored line <one>\nLine & two\n\n'
      + 'Acknowledgment shown when this appointment was originally booked:\n'
      + 'I "acknowledge" \'<this>\'.\nSecond line.',
    );
    expect(email.text).not.toContain('Current policy must not render');
    expect(email.html).toContain(
      '<div><p><strong>Booking policy acknowledged</strong></p>'
      + '<p><strong>Stored &lt;policy&gt; &amp; &quot;rules&quot;</strong></p>'
      + '<p>Stored line &lt;one&gt;<br />Line &amp; two</p>'
      + '<p>Acknowledgment shown when this appointment was originally booked:<br />'
      + 'I &quot;acknowledge&quot; &#39;&lt;this&gt;&#39;.<br />Second line.</p></div>',
    );
    expect(email.html).not.toContain('<policy>');
    expect(email.html).not.toContain('<this>');
    expect(email.html).not.toContain('Current policy must not render');
    expect(email.text).not.toContain(evidence.version);
    expect(email.text).not.toContain('2099-06-01');
    expect(email.text).not.toContain('sensitive-request-hash');
    expect(email.text).not.toContain('sensitive-attempt-id');
    expect(email.text).not.toContain('internal-evidence-id');
    expect(email.text).not.toContain('reservationRevision');
    expect(email.text).not.toMatch(
      /legal consent|payment authorization|saved-card|cancellation-fee|no-show fee/iu,
    );
    expect(state.insertedValues).toContainEqual({
      table: notificationDeliverySchema,
      values: expect.objectContaining({
        dedupeKey: 'email:booking-confirmation:appointment_1',
      }),
    });

    const evidenceProjection = state.selectProjections.find(
      projection => projection.includes('acknowledgedAt'),
    );

    expect(evidenceProjection).toEqual([
      'title',
      'policyText',
      'acknowledgmentText',
      'version',
      'acknowledgedAt',
    ]);
    expect(evidenceProjection).not.toContain('requestHash');
    expect(evidenceProjection).not.toContain('attemptId');
    expect(evidenceProjection).not.toContain('reservationRevision');
    expect(evidenceProjection).not.toContain('id');
  });

  it.each([
    ['blank title', 'malformed', [validPolicyEvidence({ title: '   ' })]],
    ['blank policy', 'malformed', [validPolicyEvidence({ policyText: '' })]],
    ['blank acknowledgment', 'malformed', [validPolicyEvidence({
      acknowledgmentText: '\n',
    })]],
    ['oversized policy', 'malformed', [validPolicyEvidence({
      policyText: 'p'.repeat(1_501),
    })]],
    ['invalid version', 'malformed', [validPolicyEvidence({
      version: `policy-v1:${'A'.repeat(64)}`,
    })]],
    ['mismatched version', 'malformed', [validPolicyEvidence({
      version: `policy-v1:${'b'.repeat(64)}`,
    })]],
    ['invalid timestamp', 'malformed', [validPolicyEvidence({
      acknowledgedAt: new Date('invalid'),
    })]],
    ['duplicate rows', 'duplicate', [validPolicyEvidence(), validPolicyEvidence({
      title: 'Second stored policy',
    })]],
  ])('omits all policy content for %s acknowledgment evidence', async (
    _case,
    reason,
    evidenceRows,
  ) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.settingsQueue.push([{
      plan: 'single_salon',
      features: null,
      settings: settingsWithEmailPolicy({
        title: 'Current fallback policy',
        text: 'Current fallback terms.',
      }),
    }]);
    state.evidenceQueue.push(evidenceRows);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).not.toContain('Booking policy acknowledged');
    expect(email.text).not.toContain('Stored booking policy');
    expect(email.text).not.toContain('Current fallback policy');
    expect(email.html).not.toContain('Stored booking policy');
    expect(email.html).not.toContain('Current fallback policy');
    expect(warn).toHaveBeenCalledWith(
      '[BOOKING CONFIRMATION] Booking policy evidence ignored',
      {
        operation: 'booking_confirmation_policy_evidence',
        salonId: 'salon_1',
        appointmentId: 'appointment_1',
        reason: `${reason}_evidence`,
      },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Current fallback');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Stored policy terms');

    warn.mockRestore();
  });

  it('queues an ID-only retry and skips the provider when the evidence query fails', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }], [{}]);
    state.evidenceQueue.push(new Error('evidence lookup timed out'));

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual(expect.objectContaining({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'OPERATIONAL_EMAIL_RESOLUTION_FAILED',
        retryable: true,
      }),
    }));
    expect(state.insertedValues).toContainEqual({
      table: integrationOutboxSchema,
      values: expect.objectContaining({
        salonId: 'salon_1',
        appointmentId: 'appointment_1',
        operation: 'retry_booking_confirmation',
        dedupeKey: 'email:booking-confirmation-retry:appointment_1',
        payload: { deliveryId: expect.any(String) },
      }),
    });
  });

  it.each([
    ['the email placement is off', 'single_salon', settingsWithEmailPolicy({
      showInConfirmationEmail: false,
    })],
    ['the salon entitlement is locked', 'free', settingsWithEmailPolicy()],
  ])('omits the informational policy when %s', async (
    _reason,
    plan,
    settings,
  ) => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.settingsQueue.push([{ plan, features: null, settings }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).not.toContain('Deposit & cancellation policy');
    expect(email.html).not.toContain('Deposit &amp; cancellation policy');
  });

  it('omits the saved message from an initial email when the salon plan is locked', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.settingsQueue.push([{
      plan: 'free',
      features: null,
      settings: settingsWithConfirmationMessage('Saved free-plan note.'),
    }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).not.toContain('Saved free-plan note.');
    expect(email.html).not.toContain('Saved free-plan note.');
  });

  it('restores the saved initial-email message as soon as plan entitlement returns', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }], [{ id: 'delivery_2' }]);
    const settings = settingsWithConfirmationMessage('Preserved salon note.');
    state.settingsQueue.push(
      [{ plan: 'free', features: null, settings }],
      [{ plan: 'single_salon', features: null, settings }],
    );

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);
    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    const lockedEmail = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];
    const restoredEmail = state.sendTransactionalEmailDetailed.mock.calls[1]?.[0];

    expect(lockedEmail.text).not.toContain('Preserved salon note.');
    expect(restoredEmail.text).toContain('\n\nPreserved salon note.');
    expect(restoredEmail.html).toContain('<p>Preserved salon note.</p>');
  });

  it('honors an explicit enable override for an initial email on the free plan', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.settingsQueue.push([{
      plan: 'free',
      features: { booking: { customization: true } },
      settings: settingsWithConfirmationMessage('Support-enabled note.'),
    }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('\n\nSupport-enabled note.'),
        html: expect.stringContaining('<p>Support-enabled note.</p>'),
      }),
    );
  });

  it('omits customization and still sends when the optional settings lookup fails', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.settingsQueue.push(new Error('settings unavailable'));

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith({
      to: 'current@example.com',
      subject: 'Salon booking confirmed',
      text:
        'Hi Client,\n\n'
        + 'Your Manicure appointment with Salon is confirmed for Wednesday, July 1 at 2:00 PM.\n\n'
        + 'View, reschedule, or cancel: https://salon.example/manage/token',
      html:
        '<p>Hi Client,</p><p>Your <strong>Manicure</strong> appointment with Salon is confirmed for '
        + '<strong>Wednesday, July 1 at 2:00 PM</strong>.</p>'
        + '<p><a href="https://salon.example/manage/token">View, reschedule, or cancel your appointment</a></p>',
    });
  });

  it('fails closed without blocking the initial email when entitlement resolution throws', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    const features = Object.defineProperty({}, 'booking', {
      get() {
        throw new Error('unexpected entitlement failure');
      },
    });
    state.settingsQueue.push([{
      plan: 'single_salon',
      features,
      settings: settingsWithConfirmationMessage('Must not be rendered.'),
    }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining('Must not be rendered.'),
        html: expect.not.stringContaining('Must not be rendered.'),
      }),
    );
  });

  it('uses an explicit zero-candidate orphan snapshot for the initial confirmation without mutating snapshots', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.recipient = {
      status: 'appointment_snapshot',
      email: 'orphan@example.com',
      terminalClientId: null,
      identityResolution: 'zero_identity_candidates',
    };

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'orphan@example.com' }),
    );
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
    expect(state.insertedValues.some(entry =>
      entry.table === appointmentSchema
      || entry.table === clientCommunicationSchema)).toBe(false);
  });

  it('records a terminal failure and does not call the provider when no recipient is supported', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.recipient = {
      status: 'unavailable',
      reason: 'email_unavailable',
    };

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
  });

  it('does not prepare an initial confirmation for an appointment that is already terminal', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.eligibilityQueue.push([{
      status: 'cancelled',
      deletedAt: null,
      startTime: new Date('2099-07-01T18:00:00Z'),
    }]);

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.resolveAppointmentOperationalEmailRecipient).not.toHaveBeenCalled();
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
        retryable: false,
      }),
    });
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('queues an ID-only retry when initial recipient resolution fails transiently', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }], [{}]);
    state.resolveAppointmentOperationalEmailRecipient.mockRejectedValueOnce(
      new Error('transient database failure'),
    );

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'OPERATIONAL_EMAIL_RESOLUTION_FAILED',
        retryable: true,
      }),
    });

    const outbox = state.insertedValues.find(
      entry => entry.table === integrationOutboxSchema,
    )!.values as { payload: unknown };

    expect(outbox.payload).toEqual({ deliveryId: expect.any(String) });
    expect(JSON.stringify(outbox)).not.toContain('@');
  });

  it('does not retry an ambiguous initial network result', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(false);

    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'RESEND_NETWORK_ERROR',
        retryable: false,
      }),
    });
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('does not enqueue a duplicate after an accepted initial send when the ledger write fails', async () => {
    state.insertQueue.push([{ id: 'delivery_1' }]);
    state.updateQueue.push(new Error('delivery ledger unavailable'));

    await expect(sendCustomerBookingConfirmationEmail(initialInput()))
      .resolves.toBe(true);

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('does not retry a business event already recorded as sent', async () => {
    state.selectQueue.push([{ status: 'sent' }]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: true,
      errorCode: null,
      providerMessageId: null,
    });

    expect(state.resolveAppointmentOperationalEmailRecipient).not.toHaveBeenCalled();
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('does not use another tenant delivery or salon entitlement during retry', async () => {
    state.selectQueue.push([]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_2',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('BOOKING_EMAIL_DELIVERY_NOT_FOUND');

    expect(state.resolveAppointmentOperationalEmailRecipient).not.toHaveBeenCalled();
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it('re-resolves a changed current email for a pending retry', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);
    state.recipient = {
      status: 'terminal_current',
      email: 'changed@example.com',
      terminalClientId: 'client_1',
    };

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'changed@example.com' }),
    );
  });

  it('uses the latest saved shared message for a retry and preserves its system content', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        salonSettings: settingsWithConfirmationMessage(
          'Latest salon note.\nPlease use the side entrance.',
        ),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.subject).toBe('Salon booking confirmed');
    expect(email.text).toContain('View, reschedule, or cancel:');
    expect(email.text).toMatch(
      /View, reschedule, or cancel: .+\n\nLatest salon note\.\nPlease use the side entrance\.$/,
    );
    expect(email.html).toMatch(
      /View, reschedule, or cancel<\/a><\/p><p>Latest salon note\.<br \/>Please use the side entrance\.<\/p>$/,
    );
  });

  it('uses the current enabled informational policy for a confirmation retry', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        salonSettings: settingsWithEmailPolicy({
          title: 'Current booking policy',
          text: 'Please contact us before cancelling.',
        }),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).toMatch(
      /Current booking policy\nPlease contact us before cancelling\.\n\nView, reschedule, or cancel:/,
    );
    expect(email.html).toContain(
      '<div><p><strong>Current booking policy</strong></p>'
      + '<p>Please contact us before cancelling.</p></div><p><a href=',
    );
    expect(email.text).not.toContain('Booking policy acknowledged');
  });

  it('uses original acknowledgment snapshots while retrying current appointment data', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        salonName: 'Renamed Salon',
        appointment: {
          ...appointmentRow.appointment,
          startTime: new Date('2099-07-02T20:30:00Z'),
          endTime: new Date('2099-07-02T21:30:00Z'),
        },
        salonSettings: settingsWithEmailPolicy({
          title: 'New current policy',
          text: 'New current policy terms.',
        }),
      }],
      [{ name: 'Updated Manicure' }],
      [],
    );
    state.evidenceQueue.push([validPolicyEvidence({
      title: 'Original booking policy',
      policyText: 'Original policy line one.\nOriginal policy line two.',
      acknowledgmentText: 'I acknowledged the original policy.',
    })]);
    state.insertQueue.push([{}]);
    state.recipient = {
      status: 'terminal_current',
      email: 'latest@example.com',
      terminalClientId: 'client_1',
    };

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.to).toBe('latest@example.com');
    expect(email.subject).toBe('Renamed Salon booking confirmed');
    expect(email.text).toContain(
      'Your Updated Manicure appointment with Renamed Salon is confirmed',
    );
    expect(email.text).toContain('Thursday, July 2 at 4:30 PM');
    expect(email.text).toContain(
      'Booking policy acknowledged\n'
      + 'Original booking policy\n'
      + 'Original policy line one.\nOriginal policy line two.\n\n'
      + 'Acknowledgment shown when this appointment was originally booked:\n'
      + 'I acknowledged the original policy.',
    );
    expect(email.text).toContain('View, reschedule, or cancel:');
    expect(email.text).toContain('/manage/opaque-token-value');
    expect(email.text).not.toContain('New current policy');
    expect(state.updates.some(
      update => update.table === appointmentBookingPolicyAcknowledgmentSchema,
    )).toBe(false);
  });

  it('sends a retry without any policy section when evidence is malformed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        salonSettings: settingsWithEmailPolicy({
          title: 'Current fallback policy',
          text: 'Current fallback terms.',
        }),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.evidenceQueue.push([validPolicyEvidence({
      version: 'policy-v1:NOT-A-VALID-HASH',
    })]);
    state.insertQueue.push([{}]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).not.toContain('Booking policy acknowledged');
    expect(email.text).not.toContain('Stored booking policy');
    expect(email.text).not.toContain('Current fallback policy');
    expect(warn).toHaveBeenCalledWith(
      '[BOOKING CONFIRMATION] Booking policy evidence ignored',
      expect.objectContaining({ reason: 'malformed_evidence' }),
    );

    warn.mockRestore();
  });

  it('restores retryability without calling the provider when evidence lookup fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [{ name: 'Manicure' }],
    );
    state.evidenceQueue.push(new Error('evidence read unavailable'));

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('evidence read unavailable');

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual(expect.objectContaining({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'BOOKING_EMAIL_PREPARATION_FAILED',
        retryable: true,
      }),
    }));
  });

  it('omits the saved message from a retry when the salon plan is locked', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        salonPlan: 'free',
        salonSettings: settingsWithConfirmationMessage('Saved locked retry note.'),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining('Saved locked retry note.'),
        html: expect.not.stringContaining('Saved locked retry note.'),
      }),
    );
  });

  it('honors an explicit disable override for a retry on an entitled plan', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        salonFeatures: { booking: { customization: false } },
        salonSettings: settingsWithConfirmationMessage('Disabled override note.'),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining('Disabled override note.'),
        html: expect.not.stringContaining('Disabled override note.'),
      }),
    );
  });

  it('fails closed without blocking a retry when entitlement resolution throws', async () => {
    const features = Object.defineProperty({}, 'booking', {
      get() {
        throw new Error('unexpected entitlement failure');
      },
    });
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        salonFeatures: features,
        salonSettings: settingsWithConfirmationMessage('Must not be rendered.'),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining('Must not be rendered.'),
        html: expect.not.stringContaining('Must not be rendered.'),
      }),
    );
  });

  it('uses an explicit zero-candidate orphan snapshot for a pending confirmation retry', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [{ name: 'Manicure' }],
      [],
    );
    state.insertQueue.push([{}]);
    state.recipient = {
      status: 'appointment_snapshot',
      email: 'orphan@example.com',
      terminalClientId: null,
      identityResolution: 'zero_identity_candidates',
    };

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'orphan@example.com' }),
    );
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
  });

  it('marks an unavailable retry terminal without putting contact data in the outbox', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.recipient = {
      status: 'unavailable',
      reason: 'email_unavailable',
    };

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      providerMessageId: null,
    });

    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
  });

  it.each([
    'cancelled',
    'completed',
    'no_show',
    'in_progress',
  ])('classifies a %s appointment as non-retryable on the first worker attempt', async (status) => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        appointment: {
          ...appointmentRow.appointment,
          status,
        },
      }],
    );

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      providerMessageId: null,
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
        retryable: false,
      }),
    });
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
  });

  it.each([
    ['deleted', {
      ...appointmentRow,
      appointment: {
        ...appointmentRow.appointment,
        deletedAt: new Date('2099-06-01T12:00:00Z'),
      },
    }],
    ['past', {
      ...appointmentRow,
      appointment: {
        ...appointmentRow.appointment,
        startTime: new Date('2020-07-01T18:00:00Z'),
      },
    }],
    ['missing', null],
  ])('classifies a %s appointment as non-retryable', async (_reason, row) => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      row ? [row] : [],
    );

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
        retryable: false,
      }),
    });
  });

  it('does not retry or duplicate side effects after a terminal appointment is classified', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [{
        ...appointmentRow,
        appointment: {
          ...appointmentRow.appointment,
          status: 'cancelled',
        },
      }],
      [{
        status: 'failed',
        retryable: false,
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      }],
    );

    const input = {
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    };

    await expect(retryCustomerBookingConfirmationEmail(input)).resolves.toEqual({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      providerMessageId: null,
    });
    await expect(retryCustomerBookingConfirmationEmail(input)).resolves.toMatchObject({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates.filter(
      update => update.set.status === 'queued',
    )).toHaveLength(1);
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema
        || entry.table === integrationOutboxSchema,
    )).toHaveLength(0);
  });

  it('revokes the fresh token and stops when an appointment becomes terminal before delivery', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [{ name: 'Manicure' }],
    );
    state.eligibilityQueue.push([{
      status: 'cancelled',
      deletedAt: null,
      startTime: new Date('2099-07-01T18:00:00Z'),
    }]);
    state.insertQueue.push([{}]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
      providerMessageId: null,
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'APPOINTMENT_NOT_CONFIRMABLE',
        retryable: false,
      }),
    });
  });

  it('revokes the fresh token and throws on provider failure so the outbox backs off', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
      [],
    );
    state.evidenceQueue.push([validPolicyEvidence()]);
    state.insertQueue.push([{}]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_HTTP_500',
    });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('RESEND_HTTP_500');

    expect(state.updates).toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });
    expect(state.updates.some(
      update => update.table === appointmentBookingPolicyAcknowledgmentSchema,
    )).toBe(false);
  });

  it('does not reopen retry when fresh-token cleanup fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.insertQueue.push([{}]);
    state.updateQueue.push(
      [{ id: 'delivery_1' }],
      new Error('token cleanup unavailable'),
    );
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_HTTP_500',
    });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('BOOKING_CAPABILITY_CLEANUP_FAILED');

    state.selectQueue.push([{
      status: 'failed',
      retryable: false,
      errorCode: 'BOOKING_CAPABILITY_CLEANUP_FAILED',
    }]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'BOOKING_CAPABILITY_CLEANUP_FAILED',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('keeps the fresh token and stops retrying on an ambiguous network result', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.insertQueue.push([{}]);
    state.sendTransactionalEmailDetailed.mockResolvedValue({
      ok: false,
      providerMessageId: null,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    });

    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);

    state.selectQueue.push([{
      status: 'failed',
      retryable: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    }]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'RESEND_NETWORK_ERROR',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('does not revoke or retry after provider success when the sent-state write fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.updateQueue.push(
      [{ id: 'delivery_1' }],
      new Error('delivery ledger unavailable'),
    );

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    )).toHaveLength(0);

    state.selectQueue.push([{
      status: 'queued',
      retryable: false,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    }]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'EMAIL_DELIVERY_STATE_UNKNOWN',
    });
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
  });

  it('resolves before token creation and again immediately before provider delivery', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'before-token@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'changed@example.com',
        terminalClientId: 'client_1',
      });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'changed@example.com' }),
    );
    expect(state.updates).not.toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });

    const tokenInsertIndex = dbMock.insert.mock.calls.findIndex(
      ([table]) => table === appointmentAccessTokenSchema,
    );

    expect(tokenInsertIndex).toBeGreaterThanOrEqual(0);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[0],
    ).toBeLessThan(dbMock.insert.mock.invocationCallOrder[tokenInsertIndex]!);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[1],
    ).toBeGreaterThan(dbMock.insert.mock.invocationCallOrder[tokenInsertIndex]!);
    expect(
      state.resolveAppointmentOperationalEmailRecipient.mock.invocationCallOrder[1],
    ).toBeLessThan(state.sendTransactionalEmailDetailed.mock.invocationCallOrder[0]!);
  });

  it('mints no fresh token when final recipient resolution is unavailable', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'email_unavailable',
      });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.updates.filter(
      update => update.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
  });

  it('revokes a fresh token when the immediate pre-send recipient becomes unavailable', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.insertQueue.push([{}]);
    state.resolveAppointmentOperationalEmailRecipient
      .mockResolvedValueOnce({
        status: 'terminal_current',
        email: 'before-token@example.com',
        terminalClientId: 'client_1',
      })
      .mockResolvedValueOnce({
        status: 'unavailable',
        reason: 'email_unavailable',
      });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toEqual({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
      providerMessageId: null,
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: appointmentAccessTokenSchema,
      set: { revokedAt: expect.any(Date) },
    });
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: false,
      }),
    });
  });

  it('restores retryability without minting a token when preparation fails', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      [appointmentRow],
      [],
    );
    state.resolveBookingConfigFromSettings.mockImplementationOnce(() => {
      throw new Error('invalid salon configuration');
    });

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('invalid salon configuration');

    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        retryable: true,
        errorCode: 'BOOKING_EMAIL_PREPARATION_FAILED',
      }),
    });
  });

  it('keeps a temporary appointment read failure retryable', async () => {
    state.selectQueue.push(
      [{ status: 'failed', retryable: true }],
      new Error('temporary database failure'),
    );

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).rejects.toThrow('temporary database failure');

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual({
      table: notificationDeliverySchema,
      set: expect.objectContaining({
        status: 'failed',
        errorCode: 'BOOKING_EMAIL_PREPARATION_FAILED',
        retryable: true,
      }),
    });
  });

  it('does not send when another retry already owns the delivery claim', async () => {
    state.selectQueue.push([{
      status: 'failed',
      retryable: true,
      errorCode: 'RESEND_HTTP_500',
    }]);
    state.updateQueue.push([]);

    await expect(retryCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      deliveryId: 'delivery_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'RESEND_HTTP_500',
    });

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(0);
  });

  it('allows exactly one concurrent retry to invoke the provider', async () => {
    const retryableDelivery = {
      status: 'failed',
      retryable: true,
      errorCode: 'RESEND_HTTP_500',
    };
    state.selectQueue.push(
      [retryableDelivery],
      [retryableDelivery],
      [appointmentRow],
      [],
      [],
    );
    state.insertQueue.push([{}]);

    const results = await Promise.all([
      retryCustomerBookingConfirmationEmail({
        salonId: 'salon_1',
        appointmentId: 'appointment_1',
        deliveryId: 'delivery_1',
      }),
      retryCustomerBookingConfirmationEmail({
        salonId: 'salon_1',
        appointmentId: 'appointment_1',
        deliveryId: 'delivery_1',
      }),
    ]);

    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(1);
    expect(state.insertedValues.filter(
      entry => entry.table === appointmentAccessTokenSchema,
    )).toHaveLength(1);
  });

  it('does not queue a manual retry when canonical resolution is unavailable', async () => {
    state.insertQueue.push([{}]);
    state.selectQueue.push([{
      status: 'failed',
      retryable: true,
      errorCode: 'MANUAL_RESEND_REQUESTED',
    }], [appointmentRow], []);
    state.recipient = {
      status: 'unavailable',
      reason: 'email_unavailable',
    };

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'OPERATIONAL_EMAIL_UNAVAILABLE',
    });

    const outboxRows = state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    );

    expect(outboxRows).toHaveLength(0);
  });

  it('uses an explicit zero-candidate orphan snapshot for manual confirmation resend', async () => {
    state.insertQueue.push([{}], [{}]);
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'MANUAL_RESEND_REQUESTED',
      }],
      [{
        ...appointmentRow,
        salonSettings: settingsWithConfirmationMessage(
          'Updated resend instructions.',
        ),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.recipient = {
      status: 'appointment_snapshot',
      email: 'orphan@example.com',
      terminalClientId: null,
      identityResolution: 'zero_identity_candidates',
    };

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'orphan@example.com',
        text: expect.stringContaining(
          '\n\nUpdated resend instructions.',
        ),
        html: expect.stringContaining(
          '<p>Updated resend instructions.</p>',
        ),
      }),
    );
    expect(state.updates.some(update =>
      update.table === appointmentSchema
      || update.table === clientCommunicationSchema)).toBe(false);
  });

  it('uses the current enabled informational policy for a manual resend', async () => {
    state.insertQueue.push([{}], [{}]);
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'MANUAL_RESEND_REQUESTED',
      }],
      [{
        ...appointmentRow,
        salonSettings: settingsWithEmailPolicy({
          title: 'Resend booking policy',
          text: 'Give at least 24 hours’ notice.',
        }),
      }],
      [{ name: 'Manicure' }],
      [],
    );

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          'Resend booking policy\nGive at least 24 hours’ notice.\n\n'
          + 'View, reschedule, or cancel:',
        ),
        html: expect.stringContaining(
          '<div><p><strong>Resend booking policy</strong></p>'
          + '<p>Give at least 24 hours’ notice.</p></div><p><a href=',
        ),
      }),
    );
    expect(
      state.sendTransactionalEmailDetailed.mock.calls[0]?.[0].text,
    ).not.toContain('Booking policy acknowledged');
  });

  it('uses original acknowledgment snapshots for a manual resend', async () => {
    state.insertQueue.push([{}], [{}]);
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'MANUAL_RESEND_REQUESTED',
      }],
      [{
        ...appointmentRow,
        salonSettings: settingsWithEmailPolicy({
          title: 'Edited current policy',
          text: 'Edited current policy terms.',
        }),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.evidenceQueue.push([validPolicyEvidence({
      title: 'Original policy snapshot',
      policyText: 'Original policy terms.',
      acknowledgmentText: 'I acknowledged these original terms.',
    })]);

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({ ok: true });

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).toContain(
      'Booking policy acknowledged\n'
      + 'Original policy snapshot\n'
      + 'Original policy terms.\n\n'
      + 'Acknowledgment shown when this appointment was originally booked:\n'
      + 'I acknowledged these original terms.',
    );
    expect(email.text).not.toContain('Edited current policy');
    expect(state.updates.some(
      update => update.table === appointmentBookingPolicyAcknowledgmentSchema,
    )).toBe(false);
  });

  it('keeps repeated manual resends independently deliverable', async () => {
    const queueManualResendReads = () => {
      state.selectQueue.push(
        [{
          status: 'failed',
          retryable: true,
          errorCode: 'MANUAL_RESEND_REQUESTED',
        }],
        [appointmentRow],
        [{ name: 'Manicure' }],
        [],
      );
    };

    queueManualResendReads();

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({ ok: true });

    state.deliveryClaimed = false;
    queueManualResendReads();

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({ ok: true });

    const manualDeliveries = state.insertedValues
      .filter(entry => entry.table === notificationDeliverySchema)
      .map(entry => entry.values as {
        purpose?: string;
        dedupeKey?: string;
      })
      .filter(values => values.purpose === 'booking_confirmation_resend');
    const dedupeKeys = manualDeliveries.map(values => values.dedupeKey);

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledTimes(2);
    expect(manualDeliveries).toHaveLength(2);
    expect(new Set(dedupeKeys).size).toBe(2);
    expect(dedupeKeys).toEqual([
      expect.stringMatching(
        /^email:booking-confirmation-resend:appointment_1:[0-9a-f-]+$/u,
      ),
      expect.stringMatching(
        /^email:booking-confirmation-resend:appointment_1:[0-9a-f-]+$/u,
      ),
    ]);
  });

  it('sends a manual resend without policy content for duplicate evidence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.insertQueue.push([{}], [{}]);
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'MANUAL_RESEND_REQUESTED',
      }],
      [{
        ...appointmentRow,
        salonSettings: settingsWithEmailPolicy({
          title: 'Current fallback policy',
          text: 'Current fallback terms.',
        }),
      }],
      [{ name: 'Manicure' }],
      [],
    );
    state.evidenceQueue.push([
      validPolicyEvidence(),
      validPolicyEvidence({ title: 'Duplicate stored policy' }),
    ]);

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({ ok: true });

    const email = state.sendTransactionalEmailDetailed.mock.calls[0]?.[0];

    expect(email.text).not.toContain('Booking policy acknowledged');
    expect(email.text).not.toContain('Stored booking policy');
    expect(email.text).not.toContain('Current fallback policy');
    expect(warn).toHaveBeenCalledWith(
      '[BOOKING CONFIRMATION] Booking policy evidence ignored',
      expect.objectContaining({ reason: 'duplicate_evidence' }),
    );

    warn.mockRestore();
  });

  it('queues the existing manual retry when evidence lookup fails', async () => {
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'MANUAL_RESEND_REQUESTED',
      }],
      [appointmentRow],
      [{ name: 'Manicure' }],
    );
    state.evidenceQueue.push(new Error('manual evidence lookup failed'));

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).rejects.toThrow('manual evidence lookup failed');

    expect(state.sendTransactionalEmailDetailed).not.toHaveBeenCalled();

    const outboxRows = state.insertedValues.filter(
      entry => entry.table === integrationOutboxSchema,
    );

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.values).toEqual(expect.objectContaining({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
      operation: 'retry_booking_confirmation',
      payload: { deliveryId: expect.any(String) },
    }));
    expect(Object.keys(
      (outboxRows[0]?.values as { payload: Record<string, unknown> }).payload,
    )).toEqual(['deliveryId']);
  });

  it('omits the saved message from a manual resend while the salon is locked', async () => {
    state.insertQueue.push([{}], [{}]);
    state.selectQueue.push(
      [{
        status: 'failed',
        retryable: true,
        errorCode: 'MANUAL_RESEND_REQUESTED',
      }],
      [{
        ...appointmentRow,
        salonPlan: 'free',
        salonSettings: settingsWithConfirmationMessage(
          'Saved manual-resend note.',
        ),
      }],
      [{ name: 'Manicure' }],
      [],
    );

    await expect(resendCustomerBookingConfirmationEmail({
      salonId: 'salon_1',
      appointmentId: 'appointment_1',
    })).resolves.toMatchObject({ ok: true });

    expect(state.sendTransactionalEmailDetailed).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining('Saved manual-resend note.'),
        html: expect.not.stringContaining('Saved manual-resend note.'),
      }),
    );
  });
});
